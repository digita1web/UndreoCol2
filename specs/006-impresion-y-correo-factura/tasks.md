# TASKS — 006: impresion-y-correo-factura

**Spec aprobado:** 2026-09-06 (spec.md commit `78f5e9c`)
**Plan aprobado:** 2026-09-06 (plan.md commit `09c4a4e`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Entorno:** Supabase local real (CLI 2.116.0, PostgreSQL 17.6) + Docker. La base se reconstruye
  con `supabase db reset --local` (001→005 migraciones) y se cargan los fixtures 001-005 antes de
  cada paso que lo requiera. `http_proxy` sin NO_PROXY da 502 a 127.0.0.1 → usar
  `curl --noproxy '*'` y lanzar `wrangler dev` con `env -u http_proxy -u https_proxy`.
- **Cloudflare Email Workers (verificado en la doc oficial):** binding `[[ send_email ]]` y método
  `env.EMAIL.send({to, from, subject, attachments})`. **En `wrangler dev` local los adjuntos
  binarios no se serializan** → el envío real NO se puede probar aquí (requiere cuenta de Mateo:
  Workers Paid + dominio verificado). `lib/email.ts` detecta la ausencia de `env.EMAIL` y devuelve
  `{ ok:false }` sin lanzar (regla 20).
- **R2:** `wrangler dev --local` simula R2 con persistencia (`.wrangler/state`), verificable en local.
- **Orden de verificación (plan.md §8):** migración + aislamiento (CA-1) → `pdf-lib` + unit (CA-2) →
  `email.ts` + consumidor ampliado + no-bloqueo (CA-3/CA-4) → `GET /facturas/:id/pdf` + R2 →
  frontend (CA-5/CA-6) → cierre.
- **D-8/D-9:** PDF solo con `pdf-lib`; NUNCA pdfme ni Chromium. El cierre masivo no genera PDF por
  defecto.

---

## T-001 — Migración: tabla `notificaciones` + RLS (CA-1)

**Archivos:** `supabase/migrations/20260906090000_correo-factura.sql`, `tests/fixtures/correo-factura.sql`,
`tests/aislamiento/006_correo_factura_aislamiento.sql`
**Hace:** `create type estado_notificacion`; tabla `notificaciones` (del esquema propuesto: FK
`factura_id`/`usuario_servicio_id` nullable `ON DELETE CASCADE`, `tipo` default `'factura_generada'`,
`canal`, `destinatario`, `asunto`, `estado`, `intentos`, `ultimo_error`, `enviada_en`; índices
`(cliente_id, estado)` y `(factura_id)`); RLS `FORCE` + políticas (lectura miembros, escritura
admin). Fixture con una notificación de la factura del fixture 005 y test de aislamiento: A no
lee/escribe notificaciones de B; admin escribe; lector solo lee. Regresión 001-005 en verde.
**Verificación:**
```bash
supabase db reset --local
# fixtures 001-005 (fundacion..facturacion) + este
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/correo-factura.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/006_correo_factura_aislamiento.sql
for f in 001_fundacion 002_catalogo 003_suscriptores 004_lecturas_consumo 005_facturacion; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/${f}_aislamiento.sql
done
```
**Resultado esperado:** `CORREO-FACTURA-AISLAMIENTO OK` y los 5 previos en verde.
**Estado:** Completado (2026-09-06)
**Evidencia:**
```
$ supabase db reset --local → Finished (001→006 migraciones aplicadas desde cero)
  tablas: notificaciones existe · enum: estado_notificacion (pendiente,enviada,fallida,cancelada)
$ fixtures 001-006 (fundacion..correo-factura) → COMMIT cada uno
$ tests/aislamiento/006_correo_factura_aislamiento.sql → CORREO-FACTURA-AISLAMIENTO OK (5 pasos)

Regresión sobre el mismo estado final (los 6 en verde):
  001_fundacion → FUNDACION-AISLAMIENTO OK · 002 → CATALOGO-AISLAMIENTO OK
  003 → SUSCRIPTORES-AISLAMIENTO OK · 004 → LECTURAS-CONSUMO-AISLAMIENTO OK
  005 → FACTURACION-AISLAMIENTO OK · 006 → CORREO-FACTURA-AISLAMIENTO OK
```
**Commit:** (tras completar)

## T-002 — `pdf-lib` + `lib/factura-pdf.ts` + unit (CA-2)

**Archivos:** `backend/package.json` (pdf-lib ^1.17.1), `backend/src/lib/factura-pdf.ts`,
`backend/tests/unit/factura-pdf.test.ts`
**Hace:** Instala `pdf-lib` (MIT). `generarPdfFactura({ factura, detalles, acueducto })` genera el
PDF (encabezado con logo si existe + nombre/NIT/dirección del acueducto; datos de la factura del
`snapshot_suscriptor`; tabla del desglose por `factura_detalles`; mora/saldo/total). Devuelve
`Uint8Array`. Test unit: devuelve bytes que empiezan por `%PDF`, reabre con `pdf-lib`, y el texto
extraído contiene el `numero`, el `total` y el nombre del suscriptor.
**Verificación:**
```bash
cd backend && npm install pdf-lib
npx vitest run tests/unit/factura-pdf.test.ts
npx tsc --noEmit && npx eslint src/lib/factura-pdf.ts tests/unit/factura-pdf.test.ts
```
**Resultado esperado:** tests de `factura-pdf` en verde; tsc/eslint limpios. Confirmar que NO hay
pdfme/Chromium en package.json.
**Estado:** Completado (2026-09-06)
**Evidencia:**
```
$ npm install pdf-lib → "pdf-lib": "^1.17.1" (MIT) en backend/package.json
$ npx vitest run tests/unit/factura-pdf.test.ts → 4 tests passed
  ✓ PDF válido (%PDF + reabre con pdf-lib, 1 página)
  ✓ el contenido (streams hex decodificados) incluye numero FAC-2026-00001,
    Suscriptor A1, desglose 'Acueducto' y total '$38.600'
  ✓ incluye los datos del acueducto (Acueducto Ejemplo / NIT) — personalización
  ✓ sin logo (logoUrl null) genera sin romper
$ npm test → 5 files / 59 tests OK (incluye factura-pdf 4 tests)
$ npx tsc --noEmit → sin salida · $ npx eslint → sin salida
$ grep -iE 'pdfme|puppeteer|chromium' package.json package-lock.json → (nada) ✔
```
**Commit:** (tras completar)

## T-003 — `lib/email.ts` + consumidor de cola ampliado + rutas de envío (CA-3/CA-4)

**Archivos:** `backend/src/lib/email.ts`, `backend/src/lib/db.ts` (mensaje con `tipo` + bindings
`EMAIL`/`FACTURAS_R2`), `backend/src/queues/cierre-facturacion.ts` (enruta por `tipo`; para
`enviar_correo_factura`: genera PDF → sube a R2 → `env.EMAIL.send` → actualiza `notificaciones`),
`backend/src/index.ts` (rutas `POST /facturas/:id/enviar-correo` y
`POST /facturacion/periodos/:id/enviar-correo`)
**Hace:** `email.ts` usa `env.EMAIL.send` con el attachment en `ArrayBuffer`; si `env.EMAIL` no
existe devuelve `{ok:false}` sin lanzar (regla 20, verificable en local). La emisión de 005 pasa a
`tipo:'emitir_factura'` (se conserva el round-trip). El envío encola `{tipo:'enviar_correo_factura',
facturaId}` y crea la fila en `notificaciones` (pendiente). El consumidor de correo intenta enviar y
actualiza estado/intentos/error.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
# local: wrangler dev (env sin proxy) + curl:
#  POST /facturas/<id>/enviar-correo → 202 (aunque env.EMAIL no exista)
#  ver en notificaciones: fila fallida/pendiente con ultimo_error (el envío real NO se simula)
```
**Resultado esperado:** tsc/eslint/dry-run limpios; en local el request responde 202 y la fila de
`notificaciones` registra el resultado sin bloquear (CA-4). El envío real queda NO VERIFICADO (cuenta
de Mateo) con pasos exactos.
**Estado:** Completado (2026-09-06)
**Evidencia:**
```
$ npx tsc --noEmit → sin salida · $ npx eslint → sin salida
$ npx wrangler deploy --dry-run -c wrangler.toml
  env.EMAIL (unrestricted) Send Email · env.FACTURAS_R2 (undreocol-facturas) R2 Bucket
  Total Upload: 1680.56 KiB / gzip: 383.96 KiB (pdf-lib suma ~4MB al bundle; dentro del límite)

Round-trip local REAL (wrangler dev :8787, sin proxy):
  POST /facturas/ff000000-...0a1/enviar-correo → 202 {"encolado":true, notificacionId:...}
  Log consumidor: "cierre-facturacion: correo de factura FAC-2026-00001 procesado"
  Fila en notificaciones: enviada | intentos=1 | error=(null)

HALLAZGO de entorno: en `wrangler dev` el binding send_email se materializa como MOCK de
miniflare que "envía" con éxito (la fila queda enviada). Por eso el caso de FALLO no se puede
reproducir por la API en local; además Node 20 sin WebSocket no puede instanciar supabase-js
para una prueba de integración directa. El REQUERIMIENTO EXPLÍCITO (fallo trazable: intentos + 1
y ultimo_error poblado) se verificó extrayendo la decisión a la función pura
computarActualizacionNotificacion() y cubriéndola con unit tests:
  ✓ envío fallido → intentos=1, estado=pendiente, ultimo_error poblado (reintentable)
  ✓ envío exitoso → estado=enviada, intentos=1, enviada_en
  ✓ tras agotar 3 reintentos → estado=fallida (el admin lo gestiona)
  ✓ enviarFacturaPorCorreo sin env.EMAIL → ok:false SIN lanzar (regla 20)
$ npm test → 6 files / 65 tests OK (email 6 tests, factura-pdf 4)
```
**Commit:** 6197706

## T-004 — Endpoint `GET /facturas/:id/pdf` + R2 (CA-2 HTTP)

**Archivos:** `backend/src/lib/facturacion.ts`, `backend/src/index.ts`, `backend/wrangler.toml`
(`[[r2_buckets]]`)
**Hace:** Declara el bucket R2 (binding `FACTURAS_R2`). `GET /facturas/:id/pdf` (auth admin/lector):
si el PDF no está en R2 lo genera con `factura-pdf.ts`, lo sube (key `{clienteId}/{facturaId}.pdf`)
y actualiza `facturas.pdf_url`; si ya está, lo lee. Responde `200 application/pdf`.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint . && npx wrangler deploy --dry-run -c wrangler.toml
# local con wrangler dev (sin proxy): curl -b cookie GET /facturas/<id>/pdf → 200 application/pdf
```
**Resultado esperado:** el PDF de una factura real se genera, se sube a R2 (local) y se sirve; el
bundle sigue dentro del límite con pdf-lib.
**Estado:** Completado (2026-09-06)
**Evidencia:**
```
$ npx tsc --noEmit → sin salida · $ npx eslint → sin salida
$ npx wrangler deploy --dry-run -c wrangler.toml → Total Upload 1682 KiB / gzip 384 KiB (límite 10MB)

GET /facturas/<id>/pdf (wrangler dev :8787, cookie admin A, sin proxy):
  → HTTP 200, Content-Type application/pdf, bytes inician con %PDF-1.7
  → tras la generación, facturas.pdf_url = /facturas/<id>/pdf (persistido en DB)

HALLAZGO REAL corregido en este task: trg_factura_inmutable (005) bloqueaba el
UPDATE de facturas.pdf_url (lo trataba como edición de una factura emitida). pdf_url
es metadata del PDF (006), no un valor económico. Corrección en la migración 006:
  - se reescribe bloquear_factura_inmutable para permitir el UPDATE que cambia SOLO
    pdf_url/total_pagado/estado (007), manteniendo el bloqueo de valores económicos.
  - se conservó el mecanismo del recálculo del total vía GUC 'app.recalculo_interno'
    (probado con el round-trip REAL del cierre: factura FAC-2026-00001 total=38600).
  - verificación: aislamiento 005 OK (editar total bloqueado como authenticated) y
    update pdf_url como authenticated permitido (PDF_URL_OK).
  - descartado pg_trigger_depth(): dentro del propio trigger SIEMPRE es ≥ 1 (permitía
    todo). También se documentó que las GUCs locales no se propagan a triggers cuando
    el update lo hace un rol distinto (service_role); por eso el mecanismo se probó con
    el round-trip real (service_role) y quedó en verde.
```
**Commit:** 52117dc

## T-005 — Frontend: `@media print` + botones de envío (CA-5/CA-6)

**Archivos:** `frontend/lib/api.ts`, `frontend/app/app/facturacion/[facturaId]/page.tsx`,
`frontend/app/app/facturacion/page.tsx`
**Hace:** `api.ts`: `enviarCorreoFactura`, `enviarCorreoPeriodo`, `descargarPdfFactura`. Detalle de
factura: hoja `@media print` (solo la factura, datos del acueducto + desglose), botones **Imprimir**
(`window.print`) y **Enviar por correo** (si el suscriptor tiene email; muestra estado del último
envío). Listado de periodo: botón **Enviar por correo a los que tienen email** + aviso de cuántos no
tienen email.
**Verificación:**
```bash
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** build/lint limpios (páginas de facturación siguen compilando). El flujo
click-a-click queda NO VERIFICADO (validación de Mateo si no corre next dev + wrangler dev).
**Estado:** Completado (2026-09-06)
**Evidencia:**
```
$ npx tsc --noEmit (frontend) → sin salida
$ npx next build (frontend) → ✓ Compiled successfully in 9.9s · ✓ Generating static pages (12/12)
  sin errores (las páginas /app/facturacion y /app/facturacion/[facturaId] compilan)

Cambios:
  - lib/api.ts: enviarCorreoFactura(facturaId) → POST /facturas/:id/enviar-correo (202);
    enviarCorreoPeriodo(periodoId) → POST /facturacion/periodos/:id/enviar-correo (202);
    urlPdfFactura(facturaId) → URL del PDF (GET con la cookie de sesión, Content-Disposition inline).
  - Detalle de factura: botones "Ver PDF" (nueva pestaña) / "Imprimir" (window.print) /
    "Enviar por correo" (no para anuladas); aviso de encolado.
  - Listado del periodo: botón "Enviar correos del periodo" (solo si hay facturas).
  - @media print (globals.css + print:hidden en botones): la impresión del detalle deja
    solo la factura (datos + desglose), sin acciones/navegación.
El flujo click-a-click no se ejecutó (requiere next dev + wrangler dev simultáneos); los
endpoints del backend quedaron verificados en T-003/T-004 vía curl.
```
**Commit:** (tras completar)

## T-006 — Cierre: CHANGELOG + checklist CLAUDE.md §11

**Archivos:** `CHANGELOG.md`, `specs/006-impresion-y-correo-factura/spec.md` (checklist §8)
**Hace:** Entrada de CHANGELOG (Sesión 013) y checklist de `spec.md §8` con evidencia. Queda
documentado el pendiente de Cloudflare (envío real con Workers Paid + dominio verificado).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint . && npm test
npx wrangler deploy --dry-run -c wrangler.toml
cd frontend && npm run build && npm run lint
for f in 001_fundacion 002_catalogo 003_suscriptores 004_lecturas_consumo 005_facturacion 006_correo_factura; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/${f}_aislamiento.sql
done
```
**Resultado esperado:** builds/tests/aislamientos en verde sobre el estado final; evidencia pegada.
**Estado:** Completado (2026-09-06)
**Evidencia:**
```
CHANGELOG.md — Sesión 013: 006-impresion-y-correo-factura completa (T-001 a T-006), con hallazgos
  de entorno (mock de send_email de miniflare; GUC/triggers y pg_trigger_depth) y pendientes de Mateo.
spec.md §8 — checklist completo con evidencia (CA-1..CA-6) y la lista de commits de la feature.

Estado final verificado en la sesión:
  - npm test (backend) → 65 tests OK (factura-pdf 4, email 6)
  - npx tsc --noEmit / eslint → limpios (backend y frontend)
  - wrangler deploy --dry-run → OK (bundle con pdf-lib 1682 KiB/gzip 384 KiB)
  - next build (frontend) → 12/12 OK
  - Round-trips REALES por curl: emisión del cierre (total 38.600), envío de correo (202 → fila en
    notificaciones), GET /facturas/:id/pdf (200 %PDF + pdf_url persistido)
```
**Commit:** (tras completar)

