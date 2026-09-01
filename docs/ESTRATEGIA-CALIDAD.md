# ESTRATEGIA-CALIDAD.md — UndreoCol

**Versión:** 2.0
**Fecha:** 2026-08-31
**Estado:** Vigente

Este documento define cómo UndreoCol previene, detecta y contiene errores. Es de
aplicación obligatoria: toda fase del roadmap se cierra contra los controles aquí
definidos.

---

## 0. Principio rector

> UndreoCol le cobra dinero real a familias reales. Un error de cálculo no es un
> bug de software: es un cobro indebido a una familia de estrato 1.

De ahí se derivan tres reglas:

1. **Lo que se puede verificar en la base de datos, no se confía al código.**
2. **Lo que se puede simular antes de emitir, se simula.**
3. **Lo que toca dinero, no se edita: se ajusta y queda registrado.**

Con la arquitectura sin servidor (Cloudflare + Supabase, `docs/DECISIONES.md`
D-6), se agrega una cuarta regla:

4. **La ausencia de un servidor propio no exime de disciplina operativa.** Los
   controles que normalmente daría un equipo de DevOps (backups, monitoreo,
   disponibilidad) se implementan como código — Workers programados y workflows
   de GitHub Actions — no se dejan como "ya lo hace el proveedor".

---

## 1. Dataset dorado: los cálculos como oráculo

Este proyecto es nuevo, sin datos de producción previos. El oráculo no es un
sistema anterior en producción, sino:

- El **código y la especificación funcional** extraídos del sistema Frappe
  (rama `frappe-legacy`), que documentan 3+ años de reglas de negocio ya
  descubiertas.
- **Casos calculados a mano** con las tarifas reales del sector, verificados
  antes de escribir el código que debe reproducirlos.

### Mecanismo

Se construyen 30–50 casos en `tests/fixtures/dataset-dorado/`, cubriendo a
propósito los casos límite documentados en `CLAUDE.md §10`: rollover, reemplazo
de contador a mitad de periodo, consumo en el borde exacto de un rango de
tarifa, usuario vinculado a mitad de periodo, pago parcial, saldo anterior,
cambio de tarifa entre periodos.

**Tolerancia cero** en los campos monetarios y de consumo al comparar el
resultado del sistema contra el cálculo esperado. Cualquier diferencia es un
bug que se investiga antes de continuar.

**Pendiente bloqueante:** las tarifas reales verificadas (D-5). Sin ellas, el
dataset dorado usa valores de referencia marcados explícitamente como
provisionales.

---

## 2. Invariantes en la base de datos

El código tiene bugs; una constraint de PostgreSQL no. Toda regla que pueda
expresarse como constraint, se expresa como constraint.

### Ya implementadas en el esquema

- Un solo contador activo por usuario de servicio (índice parcial único)
- Una sola factura por usuario y periodo (unique)
- Consumo no negativo (check)
- Contador retirado obliga a `fecha_retiro` y `lectura_final` (check)
- Rango de tarifa válido (check)
- Valor de pago mayor que cero (check)
- Estrato entre 1 y 6 (check)
- Un solo periodo abierto por acueducto (índice parcial único)

### A implementar como triggers

| Invariante | Comportamiento |
|---|---|
| `facturas.total` = suma de `factura_detalles` | Recalcular en trigger; nunca aceptar el valor enviado por la API |
| `facturas.total_pagado` ≤ `facturas.total` | Excepción si se excede |
| Suma de `pago_aplicaciones` de un pago ≤ `pagos.valor` | Excepción si se excede |
| No insertar ni modificar `lecturas` de un periodo cerrado | Excepción |
| No emitir ni modificar `facturas` de un periodo cerrado | Excepción |
| `facturas.estado` derivado de `total_pagado` vs `total` | Recalcular en trigger |

**Regla:** si un bug de la API intenta escribir algo incoherente, la base de
datos lo rechaza en lugar de guardarlo.

---

## 3. Inmutabilidad del dinero

### Facturas
Inmutables tras emitir. Corrección = anulación (con motivo y responsable) +
factura de ajuste.

### Pagos
No se borran. Se anulan.

### Periodos
Un periodo cerrado no se reabre.

### Beneficio
Siempre se puede reconstruir qué pasó, cuándo y quién lo hizo.

---

## 4. Simulación antes de emitir (dry-run)

**Es la funcionalidad de mayor retorno de todo el sistema.**

El cierre de facturación (ejecutado vía Cloudflare Queues, ver
`INFRAESTRUCTURA.md §11` y `CLAUDE.md §5.5`) tiene dos modos:

### Modo simulación
Calcula todas las facturas del periodo sin persistir nada. Presenta resumen
agregado (total de usuarios, consumo total, facturación total, comparación
contra el periodo anterior) y lista de anomalías (consumo atípico, consumo
cero, lectura menor sin rollover, usuario sin lectura, factura de valor
cero o negativo, variación total > 20%).

### Modo emisión
Solo se habilita después de correr la simulación del mismo periodo. Requiere
confirmación explícita del administrador.

**Regla:** ninguna factura llega a un suscriptor (impresa o por correo) sin que
un humano haya visto el resumen de la simulación.

---

## 5. Estrategia de pruebas

### Nivel 1 — `core/` (lógica pura). Obligatorio y exhaustivo.

Ejecutable con `vitest` sin necesidad de Cloudflare Workers ni de base de datos
— es la ventaja de mantener `core/` sin dependencias externas (`CLAUDE.md §5.3`).

| Módulo | Qué se prueba |
|---|---|
| `core/consumo.ts` | Rollover con distintos dígitos de capacidad; contador reemplazado; lectura menor sin rollover; primera lectura de un contador nuevo |
| `core/tarifas.ts` | Casos con las tarifas reales verificadas; consumo exactamente en el borde de cada rango; consumo 0; los 6 estratos; todos los tipos de uso |
| `core/facturacion.ts` | Suma de renglones; saldo anterior; mora excluyendo la factura actual |
| `core/incapacidades.ts` | Tramos de días; accidente de trabajo desde día 1; prórrogas |

Property-based testing (`fast-check`) para consumo: el resultado nunca es
negativo, nunca supera la capacidad máxima, y facturar el mismo insumo dos
veces produce el mismo resultado (determinismo).

### Nivel 2 — Aislamiento multi-tenant. Obligatorio por cada tabla nueva.

Se ejecuta con SQL directo contra Supabase (local o staging), no a través de la
API de Hono — se está probando RLS, no el código de la aplicación.

### Nivel 3 — Integración. Los flujos que mueven dinero.

- Cierre de periodo completo con el dataset dorado, vía el consumidor de
  Cloudflare Queues en `wrangler dev` local
- Registro de pago aplicado a varias facturas, con sobrante
- Anulación de factura y emisión de la corrección
- Reenvío de lectura desde la PWA (idempotencia)
- Envío de correo con PDF adjunto (D-8/D-9), verificando que un fallo de envío
  no revierte el cierre del periodo

### Nivel 4 — Manual. Lo que no se automatiza.

Checklist ejecutado por Mateo antes de cada despliegue a producción. Incluye
verificar visualmente el formato de impresión de la factura (D-8) — el diseño
de impresión no se automatiza con tests unitarios.

---

## 6. Controles operativos de infraestructura

Con la arquitectura sin servidor propio (`docs/DECISIONES.md` D-6, D-7), estos
controles reemplazan lo que normalmente daría un VPS administrado. Se
implementan desde la Fase 1 del roadmap, no como mejora futura.

| Riesgo | Control implementado | Documentado en |
|---|---|---|
| Supabase Free se pausa por inactividad | Worker de keepalive, ping diario real | `INFRAESTRUCTURA.md §5` |
| Supabase Free no tiene backups automáticos | Backup diario vía GitHub Actions → R2, retención 30 días | `INFRAESTRUCTURA.md §6` |
| No saber cuándo la base se acerca al límite de 500 MB | Worker de monitoreo con alertas en 300/400/480 MB | `INFRAESTRUCTURA.md §8` |
| Tablas de sistema crecen sin control | Worker de limpieza semanal (sesiones, auditoría, trabajos, notificaciones) | `INFRAESTRUCTURA.md §9` |
| No saber si el sistema está caído | UptimeRobot, ping cada 5 minutos | `INFRAESTRUCTURA.md §1` |
| Backup nunca probado | Ritual mensual de restauración obligatorio | `INFRAESTRUCTURA.md §7.3` |

### Ritual mensual de restauración

**Un backup sin restaurar no es un backup.** El primer lunes de cada mes:

1. Tomar el backup más reciente de R2
2. Restaurarlo en el proyecto de staging de Supabase
3. Verificar conteos de filas y que las políticas RLS siguen activas
4. Levantar la aplicación de staging contra la base restaurada y hacer login
5. Registrar el resultado en `CHANGELOG.md`

Si la restauración falla, es una prioridad inmediata — no una tarea pendiente.

---

## 7. Entornos

| Entorno | Base de datos | Backend | Frontend |
|---|---|---|---|
| Local | Supabase CLI (Docker) | `wrangler dev` | `npm run dev` |
| Staging | Proyecto Supabase Free #2 | Worker de staging | Cloudflare Pages (preview) |
| Producción | Supabase Free → Pro (según disparador de `ARQUITECTURA.md §6`) | Worker de producción | Cloudflare Pages (main) |

Costo adicional de staging: **cero**, mismo modelo de planes gratuitos que
desarrollo.

**Regla absoluta:** nunca se ejecuta un cierre de facturación de prueba contra
la base de producción. Nunca.

---

## 8. Observabilidad

- **Sentry** (plan gratuito) para errores no capturados en el frontend Next.js
  y en los Workers de Hono.
- **Logging estructurado** en el consumidor de Cloudflare Queues: cada lote de
  cierre registra ítems procesados, ítems fallidos, y el motivo de cada fallo.
- **Alerta por correo** (vía Cloudflare Email Service) cuando:
  - Un consumidor de Queue falla al procesar un lote
  - El cierre de un periodo termina con ítems en error
  - La variación de facturación de un acueducto supera el 20% respecto al
    periodo anterior
  - El Worker de keepalive falla (riesgo de pausa de Supabase)
  - El Worker de monitoreo de base de datos cruza el umbral de 400 MB
- **Tabla `auditoria`** para todo cambio en facturas, pagos, tarifas y
  periodos.

---

## 9. Rituales

| Frecuencia | Ritual |
|---|---|
| Por commit | Tests de `core/` en verde (`vitest run`) |
| Por commit que toca backend | `wrangler deploy --dry-run` exitoso |
| Por feature | Test de aislamiento de las tablas nuevas + prueba de paridad con el dataset dorado |
| Antes de cada despliegue | Checklist manual de `docs/CHECKLIST-DESPLIEGUE.md` (pendiente de redactar) |
| Diario (automatizado) | Keepalive de Supabase, monitoreo de tamaño de base, backup a R2 |
| Semanal (automatizado) | Limpieza de tablas de sistema |
| Mensual | **Restauración de backup verificada en staging** |
| Mensual | Revisión de la tabla `auditoria`: cambios inesperados en facturas o tarifas |
| Antes de cada cierre real | Simulación (dry-run) revisada por un humano |

---

## 10. Qué hacer cuando aparece un bug en producción

1. **No corregir el dato a mano.** Registrar primero qué pasó.
2. Reproducir el caso en staging con los datos reales del caso (restaurando un
   backup si es necesario).
3. Escribir un test que falle por esa razón.
4. Corregir el código hasta que el test pase.
5. Agregar el caso al dataset dorado si es un patrón, no un accidente.
6. Corregir el dato en producción **mediante ajuste, no mediante edición**.
7. Documentar en `CHANGELOG.md`: qué pasó, por qué, qué se cambió, qué lo
   previene.

El paso 3 no es opcional. Un bug corregido sin test es un bug que vuelve.
