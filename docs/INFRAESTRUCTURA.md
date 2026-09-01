# ARQUITECTURA.md — UndreoCol

**Versión:** 3.0 — Arquitectura definitiva (Cloudflare + Supabase, sin VPS)
**Fecha:** 2026-08-31
**Estado:** Vigente. Reemplaza toda versión anterior de este documento.

---

## 1. Qué es UndreoCol

SaaS colombiano para la gestión de acueductos comunitarios y pequeñas empresas de
servicios públicos: facturación por consumo, lecturas de contador, pagos, cortes y
reconexiones, RRHH e indicadores. Fundador: Mateo Castro.

**Estado del proyecto:** nuevo, sin producción, sin clientes todavía. El repositorio
anterior en Frappe Framework (`Mateo2888/UndreoCol`, ahora en la rama `frappe-legacy`)
es **especificación funcional de referencia**, nunca código a trasplantar.

---

## 2. Principio rector

> El costo de infraestructura no debe ser un obstáculo para conseguir el primer
> cliente, y no debe crecer más rápido que los ingresos después de conseguirlo.

De ahí se derivan tres reglas que gobiernan toda decisión técnica de este documento:

1. **Cero infraestructura de pago hasta el primer cliente.** El desarrollo, las
   demos y las pruebas corren enteramente en planes gratuitos.
2. **El primer gasto es mínimo y justificado.** Se activa un componente de pago
   solo cuando cubre un riesgo real (uso comercial, backups), nunca por
   comodidad.
3. **Ningún componente de pago se activa "por si acaso".** Cada aumento de costo
   tiene un disparador medible y documentado en este archivo.

---

## 3. Decisión de arquitectura: sin VPS

Se descartó explícitamente un VPS propio (Hetzner, Hostinger, LightNode) como base
de producción. Motivo: para una aplicación liviana como UndreoCol (CRUD con cálculos
aritméticos, sin IA, sin procesamiento pesado), un servidor propio implica pagar por
capacidad ociosa la mayor parte del tiempo, además de asumir en solitario el trabajo
de actualizar el sistema operativo, renovar certificados, vigilar el uptime y
reaccionar a caídas — todo esto sin ingresos que lo respalden en los primeros meses.

La arquitectura elegida traslada esa responsabilidad operativa a proveedores que la
asumen como su negocio principal (Cloudflare, Supabase), y cuyo modelo de costos
empieza en cero y crece solo con el uso real.

**Documentado como decisión D-6.** Ver `docs/DECISIONES.md`.

---

## 4. Stack definitivo

| Capa | Tecnología | Rol |
|---|---|---|
| Frontend administrativo y portal | Next.js 15 (App Router) + TypeScript | Interfaz del acueducto y del suscriptor |
| Frontend del lector | Next.js + PWA (Service Worker) | App instalable en Android, offline-first |
| Hosting del frontend | Cloudflare Pages | Entrega global, SSL automático, gratis |
| API y lógica de negocio | Hono.js | Framework ligero para Cloudflare Workers |
| Ejecución de la API | Cloudflare Workers | Cómputo en el edge, sin servidor |
| Procesos por lotes | Cloudflare Queues | Cierre de facturación masivo |
| Base de datos | Supabase PostgreSQL (Free) | Fuente de verdad de los datos |
| Autenticación administrativa | Supabase Auth | Login del admin de acueducto y del lector |
| Sesión del portal del suscriptor | JWT propio firmado en Worker | Sin cuenta en el sistema de identidad (D-2) |
| Autorización | Row Level Security (PostgreSQL nativo) | Aislamiento multi-tenant |
| Archivos (fotos, adjuntos) | Cloudflare R2 | Sin cobro de egress |
| Correo transaccional | Cloudflare Email Service | Envío de factura por correo (secundario) |
| Entrega principal de factura | Impresión (CSS `@media print`) | Flujo dominante en Colombia |
| Estilos | Tailwind CSS + shadcn/ui | — |
| Backups | GitHub Actions + `pg_dump` → R2 | Suple la ausencia de backups en Supabase Free |
| Monitoreo de base de datos | Cloudflare Cron Worker | Alerta antes de llegar al límite de 500 MB |
| Disponibilidad de Supabase | Cloudflare Cron Worker (ping diario) | Evita la pausa por inactividad |
| Observabilidad de errores | Sentry (plan gratuito) | Frontend y Workers |
| Verificación de caída | UptimeRobot (plan gratuito) | Alerta si el sistema no responde |

Todas las piezas tienen plan gratuito suficiente para el desarrollo, las demos, y
un primer cliente en producción durante un periodo largo (ver sección 6).

---

## 5. Diagrama de arquitectura

```
                         Usuario (Colombia)
                                │
                                ▼
                   Cloudflare (DNS · CDN · WAF · SSL)
                                │
                 ┌──────────────┴───────────────┐
                 │                               │
          Cloudflare Pages                Cloudflare Workers (Hono.js)
       ┌─────────┴─────────┐                     │
       │                   │           ┌─────────┼─────────────┐
   Next.js admin      Next.js PWA      │         │             │
   + portal           (lector)      Queues       R2      Supabase PostgreSQL
                                   (cierre de   (fotos,      + Auth + RLS
                                  facturación)    PDFs)     (Free tier)
                                                                  │
                                              ┌───────────────────┼───────────────┐
                                              │                   │               │
                                     Cron: ping diario   Cron: monitor tamaño   GitHub Actions:
                                     (evita pausa)        (alerta > 400MB)      backup diario a R2
```

---

## 6. Umbrales de costo — cuándo se activa cada gasto

Ninguno de estos gastos se activa "por adelantado". Cada uno tiene un disparador
concreto y verificable.

| Componente | Disparador | Costo que se activa |
|---|---|---|
| Cloudflare Workers Paid | El sistema entra en uso comercial (primer cliente pagando) | USD $5/mes |
| Cloudflare Email Service | Incluido en Workers Paid | USD $0 adicional hasta 3.000 correos/mes |
| Supabase Pro | La base de datos supera 400 MB (80% del límite de 500 MB), **o** se necesita backup gestionado con SLA | USD $25/mes |
| Cloudflare R2 de pago | Almacenamiento supera 10 GB | Variable, muy bajo (~$0.015/GB) |

**Estimación para 1 acueducto de ~1.000 suscriptores:** con el modelo de datos de
UndreoCol (sin fotos por defecto, ver `ESPECIFICACION-FUNCIONAL.md`), la base de
datos crece aproximadamente 30-50 MB por año de operación completa. **El umbral de
Supabase Pro no se alcanza antes de varios años con un solo cliente de ese tamaño.**
Esta proyección se revisa trimestralmente contra el uso real (ver
`INFRAESTRUCTURA.md` §5).

---

## 7. Costos por etapa — resumen

| Etapa | Componentes de pago | Costo/mes |
|---|---|---|
| Desarrollo y demos | Ninguno | **USD $0** |
| Primer cliente pagando | Cloudflare Workers Paid | **USD $5** |
| Base de datos > 400 MB | + Supabase Pro | **USD $30** |

---

## 8. Entrega de facturas

**Flujo principal: impresión.** La mayoría de acueductos colombianos entregan la
factura impresa en papel. El sistema renderiza la factura en pantalla con una hoja
de estilos de impresión (`@media print`) y el administrador imprime con el navegador,
sin generación de PDF ni librería adicional. Costo adicional: cero.

**Flujo secundario: correo electrónico.** Para el subconjunto de suscriptores con
email registrado, el sistema puede enviar la factura por correo usando Cloudflare
Email Service, con el contenido en HTML o como PDF generado con `pdf-lib` (no
`pdfme`, ver `docs/DECISIONES.md` D-9). Este flujo es opcional y de baja frecuencia.

Documentado como decisión **D-8**.

---

## 9. Roadmap de features

Ver `.specify/config.md` para el detalle completo del flujo Spec-Driven Development
y la lista de features en orden. La Fase 0 (inventario desde Frappe) y la Fase 1
(fundación) están especificadas en `specs/`.

---

## 10. Documentos relacionados

| Documento | Contiene |
|---|---|
| `docs/DECISIONES.md` | Registro completo de decisiones (D-1 a D-9), con contexto, opciones evaluadas y razón |
| `docs/INFRAESTRUCTURA.md` | Configuración operativa: keepalive, backups, monitoreo, variables de entorno, despliegue |
| `docs/ESPECIFICACION-FUNCIONAL.md` | Comportamiento completo del sistema |
| `docs/ESTRATEGIA-CALIDAD.md` | Prevención y contención de errores |
| `CLAUDE.md` | Reglas de desarrollo obligatorias |
| `docs/esquema-propuesto.sql` | Esquema PostgreSQL de referencia |