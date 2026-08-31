# CLAUDE.md — Reglas de desarrollo de UndreoCol

Lectura obligatoria antes de cualquier acción. Si algo aquí contradice una
instrucción del chat, **este archivo manda** y hay que señalar la contradicción
antes de continuar.

---

## 1. Qué es este proyecto

UndreoCol: SaaS colombiano para acueductos comunitarios y pequeñas empresas de
servicios públicos. Facturación por consumo, lecturas, pagos, cortes, RRHH,
dashboard. Fundador: Mateo Castro.

**Proyecto nuevo, carpeta vacía.** Existe un sistema anterior en Frappe
(`Mateo2888/UndreoCol`) que funciona y sirve como **especificación funcional**,
nunca como código a trasplantar. Nada de Python, DocTypes ni convenciones de
Frappe entra aquí.

**No hay producción ni clientes todavía.** Hay libertad total de esquema y tiempo
para hacerlo bien.

**Los datos que maneja son dinero real de gente real.** Un error en una tarifa le
cobra de más a una familia de estrato 1. Ese es el estándar de cuidado.

### Documentos de referencia
- `docs/ESPECIFICACION-FUNCIONAL.md` — qué debe hacer el sistema
- `docs/esquema-propuesto.sql` — esquema completo de referencia
- `specs/NNN-nombre/` — spec, plan y tasks de cada feature
- `CHANGELOG.md` — historial de sesiones

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript estricto |
| Estilos | Tailwind CSS + shadcn/ui |
| Base de datos | PostgreSQL (Supabase) |
| Autenticación | Supabase Auth |
| Autorización | Row Level Security nativo de PostgreSQL |
| PDF | pdfme (MIT) |
| Hosting | Vercel + Supabase Cloud |

**Criterio de rentabilidad:** el costo de infraestructura de toda la plataforma se
mantiene por debajo de USD $30/mes hasta superar los 5.000 suscriptores facturados.
En desarrollo el costo es **cero**: Supabase CLI local con Docker + `npm run dev`.
No se paga infraestructura hasta que haya un cliente pagando.

Ninguna dependencia nueva sin licencia MIT, Apache 2.0, BSD o ISC.

---

## 3. Metodología: Harness SDD

```
/specify  →  /plan  →  /tasks  →  /implement
```

Estructura: `specs/NNN-nombre-feature/spec.md`, `plan.md`, `tasks.md`.

- **No se escribe código sin un `spec.md` aprobado.** Ni boilerplate.
- Entre cada fase hay **checkpoint humano explícito**. Al terminar una fase se
  detiene y se espera aprobación. No se encadenan fases por iniciativa propia.
- Si a mitad de `/implement` aparece algo fuera del spec, **se detiene y se
  reporta**. No se improvisa alcance.

| Fase | Contiene | NO contiene |
|---|---|---|
| `spec.md` | Qué, por qué, criterios de aceptación verificables, fuera de alcance | Archivos, código, librerías |
| `plan.md` | Archivos, esquema SQL, contratos de funciones, decisiones y alternativas descartadas | Implementación |
| `tasks.md` | Tareas atómicas, cada una con su comando de verificación | Ejecución |
| `/implement` | Ejecución tarea por tarea con evidencia pegada | Tareas no listadas |

---

## 4. Regla de verificación (la más importante)

> **Nunca se acepta ni se afirma "debería funcionar".**

Evidencia **válida**: salida real de un comando, de un test ejecutado, de una
consulta SQL, o el código de estado real de una petición HTTP.

Evidencia **inválida**: "el código se ve correcto", "esto debería compilar", "la
lógica es equivalente", un test escrito pero no ejecutado.

Si algo no se puede verificar automáticamente, se declara:
*"NO VERIFICADO — requiere validación manual de Mateo: [pasos exactos]"*.
Nunca se marca como completo.

---

## 5. Arquitectura

### 5.1 Estructura

```
app/          Rutas Next.js. NUNCA importa @supabase/*
components/   UI. NUNCA importa @supabase/*
lib/          ÚNICA capa que toca servicios externos
  auth.ts     login, logout, sesión
  db.ts       cliente de base de datos
  storage.ts  archivos
  tenant.ts   resolución del cliente activo
core/         Lógica de negocio PURA. Sin dependencias externas
  consumo.ts       rollover, reemplazo de contador, anomalías
  tarifas.ts       cálculo básico / no básico por servicio
  facturacion.ts   armado de factura, mora, saldos
  incapacidades.ts tramos legales colombianos
worker/       Procesos pesados: cierre de periodo, PDFs, correos
supabase/migrations/   SQL versionado. FUENTE DE VERDAD del esquema
tests/        aislamiento/ · integracion/ · fixtures/
specs/        SDD por feature
docs/         Especificación funcional, runbook, legal
```

### 5.2 Portabilidad — no negociable

1. Ningún archivo en `app/` o `components/` importa `@supabase/*`. Si se necesita
   algo que `lib/` no expone, se amplía `lib/`, no se salta.
2. Cero Edge Functions de Supabase. La lógica de servidor vive en Next.js.
3. Cero APIs propietarias de Vercel. El proyecto debe correr con
   `next build && next start` en un contenedor.
4. Todo el esquema en `supabase/migrations/`, versionado. **Prohibido cambiar la
   base a mano desde el panel web.** Si se hizo, se escribe la migración
   equivalente antes de cerrar la tarea.

### 5.3 Lógica de negocio pura

`core/` no importa Next.js, ni Supabase, ni nada de `lib/`. Recibe datos como
argumentos y devuelve resultados.

- Es el **único** lugar donde se calcula dinero. Nunca en un componente ni en una
  consulta SQL ad-hoc.
- Toda función de `core/` tiene tests unitarios antes de considerarse terminada.

### 5.4 Multi-tenant

- Toda tabla de negocio lleva `cliente_id`. Sin excepciones.
- Toda tabla lleva RLS con `FORCE`. Sin excepciones.
- El `service_role_key` **jamás** se usa en código de aplicación. Solo en
  migraciones y en el worker, con justificación escrita.
- Toda tabla nueva incorpora, en la misma tarea, su test de aislamiento.

### 5.5 Dinero y decimales

- Valores monetarios en `numeric`, **nunca** `float`.
- El peso colombiano no usa centavos en facturación de servicios: se redondea a
  la unidad. La regla de redondeo se define una vez, se aplica en `core/` y se
  testea.
- Una factura emitida es **inmutable**. Si está mal se anula (con motivo y
  responsable) y se emite la corrección. Un pago no se borra: se anula.
- Un periodo cerrado no se reabre.

---

## 6. Reglas de código

- TypeScript estricto. Prohibido `any`; si es inevitable, se comenta la razón.
- Nada de `console.log` en código entregado.
- Errores explícitos. Prohibido `catch {}` vacío o `catch (e) { return null }`.
  Un error de facturación silencioso es peor que una caída.
- Nombres de tablas, columnas, variables, funciones y comentarios **en español**,
  coherentes con el dominio y legibles por el fundador.
- Sin archivos de más: nada de READMEs por carpeta, ejemplos ni `utils.ts`
  genéricos. Si no está en `plan.md`, no se crea.

---

## 7. Comunicación

- Respuestas en español.
- Si algo no se sabe, se dice. No se inventa una API, una función de PostgreSQL
  ni una opción de configuración.
- Si una instrucción parece equivocada, se dice **antes** de ejecutarla, con la
  razón. Obedecer en silencio una mala instrucción es un fallo.
- Si una tarea sale mal, se reporta el fallo completo. No se oculta ni se reduce
  el alcance para que pase.
- Sin adulación. Al grano.

---

## 8. Control de versiones (regla obligatoria)

**La IA hace `commit`. Mateo hace `push`. Sin excepciones.**

1. Un commit por tarea completada **y verificada**.
2. `git add` solo de los archivos de esa tarea. Nunca `git add .` a ciegas.
3. Mensaje en español, Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`,
   `refactor:`, `chore:`. El cuerpo describe qué se verificó y cómo.
4. **La IA NUNCA ejecuta `git push`.**
5. Se cierra la respuesta entregando el comando de push, listo para copiar:

```
Commit realizado: <hash corto> — <mensaje>

Para publicar:

    git push origin <rama>
```

Prohibido: `git push --force`, `git reset --hard` sobre trabajo no commiteado,
reescribir historial publicado, y commitear con tests en rojo o el build fallando.

**Sin evidencia de verificación (§4) no hay commit.**

Ramas: `main` para lo estable; `NNN-nombre-feature` para el trabajo de cada spec.

---

## 9. Casos límite del dominio

Vienen de la especificación funcional y de bugs ya descubiertos en el sistema
anterior. Toda implementación relacionada debe manejarlos **y testearlos**.

### Lecturas y consumo
1. **Rollover.** Solo si `lectura_actual < lectura_anterior` **Y**
   `lectura_anterior > capacidad_maxima × umbral_rollover_pct/100`.
   Consumo = `(capacidad_maxima − anterior) + actual`.
2. **Lectura menor sin cumplir la condición de rollover.** Es error de digitación
   o contador dañado. Se rechaza; no se factura en negativo ni en cero en silencio.
3. **Lectura duplicada** del mismo contador en el mismo periodo: se bloquea.
4. **Lectura fuera de orden cronológico**: se bloquea.
5. **Consumo alto.** `> factor_consumo_alto%` del promedio histórico **Y**
   `> piso_consumo_alto_m3`. Marca para revisión, **no bloquea el guardado**.
   El piso existe porque pasar de 2 a 4 m³ triplica el promedio sin ser anomalía.
6. **Consumo bajo o cero.** `< factor_consumo_bajo%` del promedio, o cero. Marca
   para revisión, no bloquea.
7. **Reemplazo de contador a mitad de periodo.** Consumo =
   `(lectura_final_anterior − última lectura del saliente) + (lectura del nuevo −
   lectura_inicial_nuevo)`. **Una sola factura**, vinculada a ambas lecturas, sin
   duplicar ni perder consumo.
8. **Reenvío de lectura desde el celular.** Idempotente vía `id_cliente_offline`.
   Nunca se duplica.

### Tarifas
0. **Las tarifas se versionan, nunca se editan.** Al cambiar un precio el sistema
   crea una nueva fila con `vigencia_desde = hoy` y cierra la anterior con
   `vigencia_hasta = ayer`. Garantizado por índice único en
   `(servicio_id, categoria, vigencia_desde)`.
0b. **Una sola tarifa activa por servicio + categoría en cada momento.** Si el
   sistema encuentra dos vigentes para el mismo servicio/categoría en una fecha,
   es un bug de consistencia que hay que reportar, no ignorar.
0c. **La tarifa a usar en el cierre es la vigente en la fecha de ejecución del
   cierre**, no la del inicio del periodo. Si el admin cambió la tarifa a mitad
   del periodo, el cambio aplica al cierre completo.
0d. **Una tarifa con facturas emitidas nunca se elimina.** Solo se cierra.
   `factura_detalles.tarifa_id` es una referencia permanente.

### Facturación
9. **Un solo periodo abierto por cliente.** Garantizado por índice parcial único.
9b. **Número de factura generado en transacción atómica.** `SELECT FOR UPDATE`
   sobre `configuracion` antes de incrementar `consecutivo_factura`. El índice
   único `(cliente_id, numero)` es el último guardián. Nunca se genera el
   número fuera de una transacción.
9c. **Consecutivo reinicia el 1 de enero.** Al primer cierre del año se compara
   `configuracion.anio_consecutivo` con el año actual. Si difieren, se resetea
   `consecutivo_factura = 0` y se actualiza `anio_consecutivo`. Esto ocurre
   dentro de la misma transacción de generación.
9d. **Suscriptor sin tarifa configurada.** Si `tarifa_vigente()` devuelve NULL,
   el cierre registra la anomalía en el dry-run y **no emite** la factura.
   Nunca se emite una factura con total $0 ni se lanza una excepción sin
   capturar. El suscriptor aparece en la lista de anomalías con el motivo
   "sin tarifa configurada para la categoría X".
10. **Desglose por servicio.** Cada servicio activo genera su renglón sobre el
    **mismo** `consumo_m3`. Si `tipo_calculo = 'fijo'`, el subtotal es el cargo
    fijo sin importar el consumo.
11. **Recargo por mora.** `porcentaje_mora %` sobre el saldo vencido del **mismo**
    suscriptor, **excluyendo la factura actual**. Este es el error clásico: no
    cobrar mora sobre la factura que se está emitiendo.
12. **Tarifa vigente.** Se usa la vigente en la fecha del periodo, y queda
    registrada en `factura_detalles.tarifa_id`.
13. **Cambio de categoría del suscriptor.** Las facturas históricas no se alteran:
    se usa `facturas.snapshot_suscriptor`.
14. **Pago parcial y sobrante.** Un pago aplica a varias facturas y puede sobrar.
    El sobrante no se pierde.
15. **`limite_basico_m3` es INCLUSIVO** (decisión D-1, 2026-08-31).
    `consumo_basico_m3 = min(consumo_m3, limite_basico_m3)` y
    `consumo_no_basico_m3 = max(0, consumo_m3 − limite_basico_m3)`.
    Con límite 22 y consumo 25: 22 m³ básicos + 3 m³ no básicos. El m³ 22 se
    cobra a precio básico. Testear el límite exacto, uno menos y uno más.

### Cortes
16. **Corte** automático por umbral de días de mora configurable, o manual.
17. Al ejecutar el corte el suscriptor pasa a `cortado` y **sale del ciclo normal**
    de lecturas y facturación.
18. **Reconexión bloqueada** con deuda vencida, salvo excepción explícita que
    exige motivo y autorizador (queda rastro en la orden).
19. La reconexión genera **factura independiente** (`tipo = 'reconexion'`), fuera
    del ciclo, con el cargo configurable.

### Notificaciones
20. Un fallo de envío **nunca** bloquea la facturación. Cola desacoplada, con
    reintentos y registro del error. Un suscriptor sin email no rompe nada.

### RRHH
21. **Tramos legales:** días 1–2 al 66.67% empleador (no recobrable); 3–90 al
    66.67% EPS; 91–180 al 50% EPS; accidente o enfermedad laboral al 100% ARL
    desde el día 1; día 181+ **no se calcula automático**, se marca para gestión
    manual.
22. **Prórroga.** Continúa el conteo acumulado del certificado original, no
    reinicia en el día 1. Una prórroga que arranca en el día 91 se liquida al 50%.

### Sesión del portal
22b. **La sesión del suscriptor es un JWT firmado con `SESSION_SECRET`**, no un
   token de Supabase. Duración 30 días. Cookie HttpOnly + Secure + SameSite=Lax.
22c. **El JWT del suscriptor lleva `tipo: "suscriptor"`**. Un middleware verifica
   este campo antes de servir cualquier ruta del portal. Un JWT sin este campo,
   o con `tipo: "admin"`, no puede acceder al portal, y viceversa.
22d. **El servidor verifica el estado del suscriptor en cada petición.** Si el
   usuario pasó a `inactivo` después de emitir el JWT, la petición se rechaza.
22e. **`SESSION_SECRET` nunca va en variables `NEXT_PUBLIC_`** ni llega al
   navegador. Rotarla invalida todas las sesiones activas del portal.

### Permisos
23. El **admin del acueducto nunca** puede otorgar el rol `administrador`, ni a
    otros ni a sí mismo. Se bloquea en RLS, no solo en la interfaz.
24. El **lector** solo crea/ve lecturas y ejecuta órdenes **asignadas a él**.
25. El **suscriptor no es un usuario del sistema de identidad** (decisión D-2,
    2026-08-31). No tiene cuenta en `auth.users` ni rol en `membresias`. El
    portal valida cédula + `codigo_suscriptor` contra `usuarios_servicio` en el
    servidor y emite su propia sesión firmada. El aislamiento del portal se
    resuelve del lado servidor, no con `auth.uid()`. `lib/auth.ts` contempla dos
    tipos de sesión: administrativa (Supabase Auth) y de suscriptor (propia).

---

## 10. Definición de "terminado"

- [ ] Hace lo que dice el spec, ni más ni menos
- [ ] `npm run build` sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] Tests de la tarea en verde, con la salida pegada
- [ ] Si toca base de datos: migración versionada + test de aislamiento en verde
- [ ] Si toca `core/`: tests de los casos límite, no solo del caso feliz
- [ ] Evidencia pegada en la conversación
- [ ] `CHANGELOG.md` actualizado
- [ ] Commit hecho; comando de push entregado a Mateo

---

## 11. Prohibiciones absolutas

- Copiar código de Frappe (Python, DocTypes) a este proyecto
- Commitear claves, tokens o `.env`
- Desactivar RLS "temporalmente para probar"
- Usar `service_role_key` en el navegador
- Marcar una tarea como completa sin evidencia
- Cambiar el alcance de un spec aprobado sin volver a `/specify`
- Ejecutar `git push`
