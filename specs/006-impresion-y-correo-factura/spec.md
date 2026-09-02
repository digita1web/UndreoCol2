# SPEC — 006: impresion-y-correo-factura

**Estado:** Borrador para aprobación
**Depende de:** 005-facturacion (facturas emitidas con `numero`, `snapshot_suscriptor`,
`factura_detalles` y `facturas.pdf_url` reservado); 001-fundacion (tabla `clientes` con `nombre`,
`nit`, `direccion`, `telefono`, `logo_url`); 003 (suscriptores con `email` registrado). Aplica las
decisiones **D-8** (impresión como flujo principal) y **D-9** (PDF del adjunto de correo con
`pdf-lib`, nunca `pdfme` ni Chromium).

## 1. Objetivo

Entregar la factura ya emitida (005) por los dos canales definidos en D-8:
1. **Flujo principal — impresión:** vista en pantalla de la factura con hoja de estilos `@media
   print` (formato carta/media carta, logo y datos del acueducto, desglose completo), para imprimir
   con el navegador. Sin generación de PDF ni librería.
2. **Flujo secundario — correo electrónico:** para el subconjunto de suscriptores con `email`
   registrado y cuando el administrador lo solicite (por factura o por lote de un periodo). Genera el
   PDF del adjunto con **`pdf-lib`** (`backend/src/lib/factura-pdf.ts`, D-9) y lo envía por
   **Cloudflare Email Service** (`backend/src/lib/email.ts`).

Regla crítica: **un fallo de envío nunca bloquea el flujo principal** ni el cierre del periodo
(`CLAUDE.md §10` punto 20, `ESPECIFICACION-FUNCIONAL.md §2.9.1/§2.12`). El envío es desacoplado
(cola), con registro de intentos/errores y reintentos. El diseño del PDF/impresión es
**personalizable por acueducto** (mismo concepto que el Print Format de Frappe: logo, nombre,
dirección y datos del acueducto desde `clientes`), sin editor visual — D-9 dejó la puerta a
reincorporar un editor después, no bloquea el lanzamiento.

## 2. Por qué ahora

Según el roadmap (`.specify/config.md`), 006 depende de 005 (ya cerrada) y precede a 008
(portal-suscriptor, que ofrece "descarga del PDF de la factura generado bajo demanda con pdf-lib" en
`ESPECIFICACION-FUNCIONAL.md §2.13`) y a 010 (notificaciones). 005 dejó las facturas emitidas con
detalles y el campo `facturas.pdf_url` reservado; 006 lo puebla con el PDF real (subido a R2) cuando
se solicita el correo. Es el primer punto donde un artefacto legible por el suscriptor (impreso o por
correo) sale del sistema, por lo que el "nunca bloquear" y la fidelidad de los datos son críticos.

## 3. Alcance

### 3.1 Impresión desde el navegador (flujo principal, D-8)
- La vista de detalle de factura de 005 (`/app/facturacion/[facturaId]`) se amplía con una hoja de
  estilos de impresión (`@media print`) en formato carta o media carta, que el navegador usa al
  imprimir (Ctrl+P). No se genera ningún archivo PDF en este flujo.
- Contenido imprimible: encabezado del acueducto (logo, nombre, NIT, dirección, teléfono —
  desde `clientes`), datos del suscriptor desde `snapshot_suscriptor`, número/periodo/fechas,
  desglose por servicio (renglones de `factura_detalles`), recargo mora, saldo anterior y total.
  Un botón "Imprimir" dispara `window.print()`.
- Al imprimir solo se muestra la factura (sin la navegación del panel).

### 3.2 Generación del PDF del adjunto (`pdf-lib`, D-9)
- `backend/src/lib/factura-pdf.ts`: dado el contexto de una factura (factura + detalles + datos del
  acueducto desde `clientes`), devuelve los bytes del PDF con `pdf-lib`. Plantilla definida
  programáticamente (posiciones de texto, tabla del desglose) — no `pdfme`, no editor visual, no
  Chromium.
- **Personalización por acueducto** (análogo a Print Format de Frappe): el PDF usa logo (si
  `clientes.logo_url` tiene uno), nombre, NIT, dirección, teléfono y municipio del acueducto. Los
  textos fijos (títulos, etiquetas) son la plantilla base compartida.
- El PDF generado se sube a **Cloudflare R2** y `facturas.pdf_url` guarda la URL pública.

### 3.3 Envío por correo (Cloudflare Email Service)
- `backend/src/lib/email.ts`: capa que envía el correo con el PDF adjunto usando la API de
  Cloudflare Email Workers (`SendEmailMessage`). Remitente de un dominio verificado de la cuenta
  Cloudflare de UndreoCol; asunto configurable.
- Envío **por factura individual** (botón en el detalle) y **por lote de un periodo** ("Enviar a los
  suscriptores con email"), solo a quienes tienen `usuarios_servicio.email`.
- El envío nunca ocurre en el request que atiende al admin (desacoplado): se encola un trabajo y un
  worker/consumidor lo procesa. Un fallo no bloquea ni el cierre ni la respuesta al admin.


### 3.4 Registro de envíos y reintentos (tabla `notificaciones`)
- Se crea la tabla `notificaciones` (de `docs/esquema-propuesto.sql`): `factura_id` (nullable),
  `tipo` (`factura_generada` por ahora; `recordatorio`/`mora`/`pago` son de 010), `canal`
  (`email`), `destinatario`, `asunto`, `estado` (`pendiente`/`enviada`/`fallida`/`cancelada`),
  `intentos`, `ultimo_error`, `enviada_en`.
- Cada envío de factura registra una fila. Si falla, queda `pendiente` (reintentable) o `fallida`
  tras agotar reintentos, con `intentos` y `ultimo_error`; el worker reintenta con backoff. El fallo
  es visible en el panel (nunca silencioso).
- RLS `FORCE` + políticas (mismo patrón 001-005).

### 3.5 Cierre de facturación y PDF
- El cierre masivo de 005 **no genera PDF por defecto** (CLAUDE.md §6, punto 20b): solo cuando el
  admin solicita explícitamente el envío por correo de un lote se generan los PDF de ese lote.

### 3.6 Frontend admin
- Detalle de factura (`/app/facturacion/[facturaId]`): botón **Imprimir** y, si el suscriptor tiene
  email, botón **Enviar por correo** (con el estado del último envío desde `notificaciones`).
- Panel de facturas de un periodo: botón **Enviar por correo a los que tienen email**, con aviso de
  cuántos no tienen email (se entregan impresas).

## 4. Fuera de alcance

- **Subsistema general de notificaciones** (recordatorio de vencimiento, aviso de mora, confirmación
  de pago, plantillas de esos eventos, preferencias) — feature 010. 006 solo crea `notificaciones` y
  usa el evento `factura_generada`.
- **Portal del suscriptor** (login `numero_documento`+`codigo_suscriptor`, historial, descarga propia
  del PDF) — feature 008. El PDF se genera aquí; la descarga pública autenticada del suscriptor es
  de 008.
- **Reconexión / factura de reconexión por correo** — feature 009.
- **Editor visual de plantillas de PDF por el administrador** — descartado por D-9 para el
  lanzamiento (reincorporable después, sin bloquear).
- **Personalización del acueducto vía UI** (subir logo/editar textos desde el panel) — 006 usa los
  datos de `clientes` ya existentes.
- **Múltiples plantillas por tipo de documento** — solo factura de ciclo por ahora.


## 5. Reglas de negocio que aplican

De `CLAUDE.md §6` (D-8/D-9): la impresión es el flujo principal y **no genera PDF**; el correo es
solo para suscriptores con email que lo soliciten; el PDF del correo se genera con **`pdf-lib`**
(`backend/src/lib/factura-pdf.ts`) y **nunca** se usa `pdfme` completo, Puppeteer ni Chromium en
ningún Worker.

De `CLAUDE.md §10` (Notificaciones y entrega de factura):
- 20. Un fallo de envío de correo **nunca** bloquea la facturación ni el cierre del periodo. Cola
  desacoplada, con reintentos y registro del error.
- 20b. La **impresión es el flujo principal**. No se genera PDF durante el cierre masivo salvo que el
  correo se solicite explícitamente para ese suscriptor.

De `docs/ESPECIFICACION-FUNCIONAL.md`:
- §2.9.1 (D-8): envío opcional por suscriptor o masivo a petición del administrador; un fallo queda
  registrado como notificación pendiente que se reintenta.
- §2.12: la cola de notificaciones es desacoplada; un suscriptor sin email no rompe nada.
- §2.13: la descarga del PDF bajo demanda del portal usa `pdf-lib` (008 reutiliza esta función).

De `docs/DECISIONES.md`: **D-8** (impresión principal; se elimina pdfme del flujo crítico; el cierre
no genera PDF por defecto) y **D-9** (pdf-lib directo, plantilla programática en
`lib/factura-pdf.ts`, sin editor visual, sin Chromium).

De `CLAUDE.md §7` (reglas de código): sin `console.log` (usar `console.error` para errores reales);
errores explícitos, prohibido `catch {}` vacío; nombres en español.

De `CLAUDE.md §5.5` (límites): el envío masivo va por cola (nunca un solo fetch); la generación de
PDF de un lote ocurre en el consumidor (una factura por mensaje). `pdf-lib` corre en Workers (1-4ms,
bundle acotado — bajo el límite de 10MB Paid).


## 6. Criterios de aceptación

Cada uno cerrado con evidencia ejecutada y pegada.

### CA-1 — Tabla `notificaciones` + RLS
Migración versionada crea `notificaciones` (del esquema propuesto) con RLS `FORCE` y políticas del
patrón 001-005; `factura_id`/`usuario_servicio_id` con `ON DELETE` coherente; índices por
`(cliente_id, estado)` y por `factura_id`. Verificado contra Supabase local real (`supabase db
reset --local`) + test de aislamiento `006_correo_factura_aislamiento.sql` con regresión 001-005.

### CA-2 — `lib/factura-pdf.ts`: generación con `pdf-lib` (D-9)
`generarPdfFactura(factura, detalles, datosAcueducto)` devuelve un `Uint8Array` de PDF válido (el
`pdf-lib` lo puede reabrir y tiene N páginas) con el número, el total y el desglose. Pruebas:
`vitest`/integración con una factura real de la base (la del fixture 005) → se genera el PDF y se
reabre con `pdf-lib` para verificar que contiene el `numero` y el `total`. `tsc`/`eslint` limpios.
Se confirma que NO se usa pdfme/Chromium (revisión de dependencias + bundle del dry-run).

### CA-3 — Envío por correo (contrato verificado + límite real documentado)
`lib/email.ts` expone `enviarFacturaPorCorreo(...)` sobre Cloudflare Email Workers. El envío real
requiere Workers Paid y dominio verificado (no disponible en este entorno): se verifica la firma del
contrato (`tsc`/`eslint`/dry-run) y el comportamiento con un **stub de envío**. El envío real queda
"NO VERIFICADO — requiere la cuenta Cloudflare de Mateo (Workers Paid + dominio verificado)", con
pasos exactos.

### CA-4 — Desacople: un fallo de envío nunca bloquea
Encolar el envío de un lote devuelve 202 aunque algún suscriptor no tenga email o el envío falle; el
registro en `notificaciones` queda `pendiente`/`fallida` con `ultimo_error` e `intentos`, y el worker
reintenta. Verificado con el stub de envío que falla a propósito: la respuesta al admin no falla y la
fila registra el error en la base real.

### CA-5 — Vista de impresión y personalización
`/app/facturacion/[facturaId]` incluye hoja `@media print` con datos del acueducto (logo si existe,
nombre, NIT) y el desglose, más el botón Imprimir. `npm run build`/`lint` limpios. Render real con
`next dev` (HTTP 200 con cookie) cuando el entorno lo permita; si no, pasos exactos.

### CA-6 — Panel: enviar por correo (individual y por periodo)
Botones en el detalle y en el listado del periodo; aviso de cuántos no tienen email. La API detrás se
valida con curl (CA-4); el flujo click-a-click en navegador queda como verificación manual de Mateo
si el entorno no permite `next dev` + `wrangler dev`.


## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| pdfme/Chromium se cuelan en el bundle (prohibición D-9/CLAUDE §12) | El spec fija `pdf-lib`; la revisión de dependencias y el bundle del dry-run lo confirman; nunca se instala pdfme |
| Un fallo de envío bloquea el cierre o la respuesta del admin | Envío desacoplado por cola; la regla 20 se testea con un stub que falla (CA-4) |
| El PDF sale con datos equivocados (factura de A con datos de B o acueducto incorrecto) | CA-2 verifica contra una factura real de la base reabriendo el PDF (número/total/desglose); los datos vienen de `snapshot_suscriptor` (inmutable) y `factura_detalles` |
| Sin Workers Paid/dominio verificado no se puede probar el envío real | Se documenta el límite y se entrega el stub verificado + pasos exactos para Mateo (CA-3) |
| La personalización por acueducto queda dura en el código | Se parametriza desde `clientes` (logo/nombre/datos); el editor visual se documenta como posterior (D-9), sin bloquear |
| El PDF de un lote grande satura el consumidor | Una factura por mensaje en la cola (patrón 005); `pdf-lib` es liviano (~1-4ms por PDF) |

## 8. Definición de terminado

- [ ] Todos los CA (1-6) con evidencia real — CA-1/CA-2 contra Supabase local + `pdf-lib`;
  CA-3/CA-4 con stub de envío y registro en `notificaciones`; el envío real a Cloudflare y el flujo
  click-a-click quedan NO VERIFICADO con pasos exactos (cuenta Cloudflare de Mateo)
- [ ] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios, con el bundle de pdf-lib
  dentro del límite
- [ ] Tests en verde: unit de `factura-pdf` + test de aislamiento `006_`
- [ ] `CHANGELOG.md` actualizado en el cierre de la feature
- [ ] Aprobación explícita de Mateo — spec, plan y tasks aprobados antes de cada fase
- [ ] Un commit por tarea completada y verificada; sin `git push` (Mateo lo aplica / bundle si aplica)

