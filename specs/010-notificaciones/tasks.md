# TASKS — 010: notificaciones

**Spec aprobado:** 2026-09-05 (spec.md, commits `4a63727` borrador + `e98c566` aprobación)
**Plan aprobado:** 2026-09-05 (plan.md, commits `8ce13a6` borrador + `ae07d26` aprobación)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Este entorno SÍ tiene Supabase local real vía Docker** (`supabase_db_UndreoCol2` y contenedores
  asociados corriendo, confirmado antes de escribir esta tabla) — a diferencia de la sesión de 009,
  que solo tuvo un shim de PostgreSQL nativo. La verificación de migraciones/RLS de esta feature debe
  hacerse contra Supabase local real (`psql` con `DATABASE_URL` apuntando a `127.0.0.1:54322`, o
  `supabase db reset --local`), no un shim — si para cuando se ejecute /implement el contenedor de
  turno no lo tiene disponible, se declara "NO VERIFICADO" con los pasos exactos, mismo criterio de
  CLAUDE.md §4.
- **`wrangler dev` + `next dev` + curl/Playwright real también son viables en este entorno**
  (verificado en la sesión del bug de login de esta misma conversación) — las tareas de integración
  (T-006, T-007, T-008) deben intentarse contra servidores reales, no quedar en "no aplica" por
  defecto.
- **Orden de dependencia real:** T-001 bloquea T-002 (sin el `CHECK`/columna nueva no hay nada que
  fijar). T-003 (core puro) no depende de base de datos, puede ir en paralelo a T-001/T-002. T-004 y
  T-005 dependen de T-003. T-006 depende de T-004/T-005 (necesita `encolarNotificacion()` y el
  consumidor ampliado) y de T-001 (la ruta `GET /notificaciones` existe, pero el `CHECK` ya debe
  estar aplicado). T-007 y T-008 dependen de T-001 y T-003. T-009 depende de T-006. T-010/T-011 van al
  final.
- **Regresión obligatoria en cada tarea de backend:** `npx vitest run` completo (no solo los archivos
  tocados) — 006/007/009 ya establecieron que un cambio en `lib/email.ts` o en el consumidor de la
  cola puede afectar tests de otras features; se corre la suite entera en cada tarea que toque
  `backend/src/`.

---

## T-001 — Migración: catálogo cerrado de `notificaciones.tipo` + `configuracion.dias_aviso_vencimiento`

**Archivos:** `supabase/migrations/20260913090000_notificaciones-generales.sql`, `docs/esquema-propuesto.sql`
**Hace:** (plan.md §2) `ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_valido CHECK
(tipo IN (...6 valores...))`; `ALTER TABLE configuracion ADD COLUMN dias_aviso_vencimiento integer NOT
NULL DEFAULT 3`. Se actualiza `docs/esquema-propuesto.sql` para reflejar ambos cambios (documento de
referencia veraz, mismo criterio que la corrección de `docs/INFRAESTRUCTURA-Y-COSTOS.md §2`).
**Verificación:**
```bash
# Las 11 migraciones previas + la nueva, en secuencia, contra Supabase local real
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260831150000_fundacion-tenancy.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260901120000_catalogo-y-tarifas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260902090000_suscriptores-contadores.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260904090000_lecturas-consumo.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260905090000_facturacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260906090000_correo-factura.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260907090000_pagos.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260908090000_portal-suscriptor.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260909090000_portal-slug.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260911090000_cortes-reconexiones.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260912090000_importacion-suscriptores.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260913090000_notificaciones-generales.sql
psql "$DATABASE_URL" -c "\d notificaciones"
psql "$DATABASE_URL" -c "\d configuracion"
# El CHECK debe rechazar un tipo fuera del catálogo:
psql "$DATABASE_URL" -c "insert into notificaciones (cliente_id, tipo) values ('00000000-0000-0000-0000-000000000000','tipo_invalido');"
```
**Resultado esperado:** las 12 migraciones aplican sin error; `\d notificaciones` muestra el `CHECK
notificaciones_tipo_valido`; `\d configuracion` muestra `dias_aviso_vencimiento integer not null
default 3`; el `INSERT` de prueba falla con `violates check constraint "notificaciones_tipo_valido"`
(no con un error de FK — se puede usar un `cliente_id` inexistente a propósito solo para confirmar
que el rechazo ocurre por el `CHECK`, no llegar a la FK; si Postgres valida la FK primero, ajustar
el `INSERT` con un `cliente_id` real del fixture de 001).
**Estado:** Completado (2026-09-05) — verificado contra Supabase local real (Docker)
**Evidencia:**
```
Esta base local (supabase_db_UndreoCol2, la misma usada en la sesión del bug de login de esta
conversación) YA estaba migrada hasta 008 (portal-suscriptor/portal-slug) — no re-corrí 001-008
para no arriesgar los datos de prueba reales que ya tiene (admin-a@test.local, etc.), solo apliqué
lo que faltaba:

$ psql "$DATABASE_URL" -c "select table_name from information_schema.tables where table_schema='public' and table_name in ('cortes_reconexiones','importaciones_suscriptores');"
 table_name
------------
(0 rows)   -- 009 y 012 nunca se habían aplicado a ESTA base (sí se verificaron en su momento contra
              otros entornos — 009 con un shim de PostgreSQL sin Docker, según su propio tasks.md).

Apliqué 009 y 012 (ya existían en el repo, sin tocarlos) para tener una base real y completa contra
la cual verificar 010, y poder correr una regresión de verdad:

$ psql "$DATABASE_URL" -f supabase/migrations/20260911090000_cortes-reconexiones.sql → EXIT=0
$ psql "$DATABASE_URL" -f supabase/migrations/20260912090000_importacion-suscriptores.sql → EXIT=0

Luego apliqué la migración de esta tarea:

$ psql "$DATABASE_URL" -f supabase/migrations/20260913090000_notificaciones-generales.sql
ALTER TABLE
COMMENT
ALTER TABLE
COMMENT
EXIT=0

$ psql "$DATABASE_URL" -c "\d notificaciones" | grep -A1 "Check constraints"
Check constraints:
    "notificaciones_tipo_valido" CHECK (tipo = ANY (ARRAY['factura_generada'::text,
    'recordatorio_vencimiento'::text, 'aviso_mora'::text, 'confirmacion_pago'::text,
    'corte_ejecutado'::text, 'reconexion_completada'::text]))

$ psql "$DATABASE_URL" -c "\d configuracion" | grep dias_aviso_vencimiento
 dias_aviso_vencimiento | integer | not null | 3

$ psql "$DATABASE_URL" -c "insert into notificaciones (cliente_id, tipo) values ('a0000000-0000-0000-0000-000000000001','tipo_invalido');"
ERROR:  new row for relation "notificaciones" violates check constraint "notificaciones_tipo_valido"

$ psql "$DATABASE_URL" -c "select tipo, count(*) from notificaciones group by tipo;"
       tipo        | count
-------------------+-------
 factura_generada  |     1   -- el insert inválido no persistió; el dato existente de 006 intacto.

Regresión completa de aislamiento sobre el estado final (001 a 012, los 11 scripts existentes):
001 OK · 002 OK · 003 OK · 004 OK · 005 OK · 006 OK · 007 OK · 009 OK · 012 OK.

HALLAZGO COLATERAL (no causado por esta migración, reportado íntegro por CLAUDE.md §8): 008 FALLA
en PASO 3 ("A1 bloqueado devolvió ok") — investigado antes de reportarlo: portal_intentos_login
tiene filas residuales de corridas manuales anteriores (numero_documento 1000000001/1000000002,
count=1 cada una) que alteran el conteo de intentos que ese test asume desde cero. No es una
regresión de 010 (mi migración no toca portal_intentos_login/portal_umbral_intentos_login ni nada
relacionado con el login del portal) — es un estado sucio preexistente de esta base persistente.
NO VERIFICADO / NO CORREGIDO aquí — fuera del alcance de T-001 de 010; queda para que Mateo decida
si limpiar las filas de prueba o revisar la idempotencia del test de 008.
```
**Commit:** `9b60964`

## T-002 — Test de aislamiento (sin fixture nuevo — alcance corregido durante /implement)

**Alcance corregido respecto al plan original:** el plan asumía un fixture nuevo con facturas por
vencer/vencidas y un re-test completo de aislamiento RLS de `notificaciones`. Al revisar el código
real antes de escribir esto (no de memoria) encontré que **`tests/aislamiento/006_correo_factura_aislamiento.sql`
ya cubre exhaustivamente** el aislamiento multi-tenant de `notificaciones` (admin A no ve/inserta en
B, lector A solo lee, admin A sí inserta en su propio cliente) — repetirlo aquí sería duplicar
cobertura, no ampliarla. Además, crear facturas nuevas en un fixture compartido correría el riesgo
que **009 ya documentó explícitamente** (`tests/fixtures/cortes.sql`): romper los conteos de fila que
005/007 ya asumen en sus propios tests. Por eso **no se crea `tests/fixtures/notificaciones-generales.sql`**
— las facturas por vencer/vencidas para el recordatorio/mora se crean dentro de la propia transacción
de T-007 (con `ROLLBACK`), igual que 009 hizo con sus escenarios temporales.

**Archivos:** `tests/aislamiento/010_notificaciones_aislamiento.sql` (nuevo)
**Hace:** Test de aislamiento (SQL puro) enfocado en lo que T-001 agregó de verdad — lo demás ya
tiene cobertura (001 para `configuracion`, 006 para `notificaciones`):
1. Los 6 tipos del catálogo se pueden insertar (smoke test — probar solo el rechazo de uno inválido,
   como hice manualmente en T-001, no confirma que los 6 válidos realmente estén en la lista).
2. Un tipo fuera del catálogo sigue siendo rechazado por el `CHECK` (regresión de T-001).
3. `configuracion.dias_aviso_vencimiento` existe con default `3` para **ambos** clientes existentes
   (A y B) — confirma que el `ALTER TABLE ... ADD COLUMN` aplicó a las filas ya existentes, no solo
   a las nuevas.
4. Regresión completa de aislamiento existente (001 a 012) sobre el estado final.
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/010_notificaciones_aislamiento.sql
```
**Resultado esperado:** termina con `NOTIFICACIONES-GENERALES-AISLAMIENTO OK`; la regresión 001-012
(re-corrida en la misma pasada) también en verde (008 queda como el hallazgo ya reportado en T-001,
no una regresión nueva).
**Estado:** Completado (2026-09-05) — verificado contra Supabase local real (Docker)
**Evidencia:**
```
$ psql "$DATABASE_URL" -f tests/aislamiento/010_notificaciones_aislamiento.sql
DO · BEGIN/SET/SET/DO/ROLLBACK (x4 pasos) · NOTIFICACIONES-GENERALES-AISLAMIENTO OK

PASO 1: CHECK notificaciones_tipo_valido existe (pg_constraint) — OK.
PASO 2: admin de A insertó los 6 tipos del catálogo sobre su propio cliente; el conteo dio 7
  (6 nuevas + la fila factura_generada que ya dejó el fixture de 006) — confirma que ninguno de
  los 6 valores del CHECK está mal escrito. ROLLBACK, sin dejar rastro.
PASO 3: un tipo fuera del catálogo sigue rechazado por notificaciones_tipo_valido — regresión de
  T-001 OK.
PASO 4: configuracion.dias_aviso_vencimiento = 3 tanto para el cliente A como para el cliente B —
  confirma que el ALTER TABLE ... ADD COLUMN aplicó el default a las filas YA existentes, no solo
  a las nuevas.

Regresión completa sobre el estado final (los 11 scripts de aislamiento existentes + el nuevo):
001 OK · 002 OK · 003 OK · 004 OK · 005 OK · 006 OK · 007 OK · 008 FALLÓ (mismo hallazgo
preexistente ya reportado en T-001, no relacionado con esta tarea) · 009 OK · 010 OK · 012 OK.
```
**Commit:** `e2937ef`

## T-003 — `core/notificaciones.ts`: contenido por tipo + `computarActualizacionNotificacion` movido

**Archivos:** `backend/src/core/notificaciones.ts` (nuevo), `backend/tests/unit/notificaciones.test.ts`
(nuevo), `backend/src/lib/email.ts` (se retiran `computarActualizacionNotificacion`/
`MAX_INTENTOS_ENVIO`), `backend/tests/unit/email.test.ts` (se retiran los tests movidos, sin tocar los
que quedan), `backend/src/queues/cierre-facturacion.ts` (ajuste mínimo no previsto — ver evidencia)
**Hace:** (plan.md §4) 5 funciones puras `contenido*` (una por tipo nuevo) que arman
`{asunto, cuerpoHtml}`; `computarActualizacionNotificacion()`/`MAX_INTENTOS_ENVIO` migran tal cual
desde `lib/email.ts` (sin cambiar su lógica — solo la ubicación). Los tests existentes de esa función
en `email.test.ts` se mueven a `notificaciones.test.ts` sin modificarlos.
**Verificación:**
```bash
cd backend
npx tsc --noEmit
npx eslint .
npx vitest run
```
**Resultado esperado:** `tsc`/`eslint` sin errores; `vitest run` completo en verde, incluyendo los
tests movidos de `computarActualizacionNotificacion` (deben pasar exactamente igual que antes de
moverse — confirma que el movimiento no cambió comportamiento) y 5+ tests nuevos de contenido (uno
por tipo, verificando que el asunto/cuerpo incluye los datos correctos del evento).
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
Ajuste no previsto en el plan, necesario para no dejar el build roto (CLAUDE.md §9): al retirar
computarActualizacionNotificacion de lib/email.ts, backend/src/queues/cierre-facturacion.ts (que la
importa desde ahí desde 006) dejaba de compilar. Actualicé SOLO esa línea de import para que apunte
a core/notificaciones — no adelanté el resto del trabajo de T-005 (la tercera rama del consumidor
sigue sin existir).

$ npx tsc --noEmit
(sin salida, EXIT=0)

$ npx eslint .
(sin salida, EXIT=0)

$ npx vitest run
 ✓ tests/unit/notificaciones.test.ts (10 tests) — 3 movidos de computarActualizacionNotificacion
   (idénticos, sin cambios) + 7 nuevos de contenido (uno por escenario, incluyendo los dos casos
   límite: pago sin facturas aplicadas y reconexión sin número de factura disponible)
 ✓ tests/unit/email.test.ts (3 tests) — solo quedan los de enviarFacturaPorCorreo, sin cambios
 Test Files  10 passed (10)
      Tests  112 passed (112)   (antes de esta tarea: 105 según el cierre de 009 — 105 - 3 movidos
                                  + 10 en el archivo nuevo = 112, cuadra exacto)

$ npx wrangler deploy --dry-run -c wrangler.toml
Total Upload: 1738.67 KiB / gzip: 395.84 KiB — bindings EMAIL/FACTURACION_COLA/FACTURAS_R2 intactos
(verificación extra no exigida por esta tarea, hecha por tocar un archivo de cola)
```
**Commit:** `fc017c3`

## T-004 — `lib/email.ts`: `enviarCorreo()` genérico + `lib/notificaciones.ts`: `encolarNotificacion()`

**Archivos:** `backend/src/lib/email.ts` (editado), `backend/src/lib/notificaciones.ts` (nuevo),
`backend/src/lib/db.ts` (editado: `TipoMensajeFacturaCierre` + `MensajeFacturaCierre`),
`backend/src/core/notificaciones.ts` (ajuste mínimo no previsto: faltaba exportar
`TipoNotificacionNueva`, ya contemplado en el contrato de plan.md §4 pero omitido en T-003),
`backend/tests/unit/email.test.ts` (2 tests nuevos para el camino sin adjunto, no exigidos por la
tarea pero cubren código nuevo real)
**Hace:** (plan.md §4) `enviarCorreo()` generaliza el envío (adjunto opcional); `enviarFacturaPorCorreo`
pasa a ser un envoltorio delgado sobre `enviarCorreo()` con la misma firma pública de siempre (sin
romper 006). `encolarNotificacion()`: inserta la fila en `notificaciones` (o no inserta nada si
`destinatarioEmail` es `null` — "sin email no rompe nada") y encola el mensaje con `tipo:
'enviar_notificacion'` + `destinatario`/`asunto`/`cuerpoHtml`. `db.ts`: nuevo valor de
`TipoMensajeFacturaCierre` y campos opcionales nuevos en `MensajeFacturaCierre`.
**Verificación:**
```bash
cd backend
npx tsc --noEmit
npx eslint .
npx vitest run
```
**Resultado esperado:** `tsc`/`eslint` sin errores; `vitest run` completo en verde — en particular los
tests existentes de `enviarFacturaPorCorreo` (006) pasan sin ninguna modificación, confirmando que el
envoltorio preserva el contrato.
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
$ npx tsc --noEmit
(sin salida, EXIT=0 — tras dos rondas de ajuste en los tests nuevos: el mock de env.EMAIL.send debe
tipar su parámetro como `unknown`, igual que la firma real en lib/db.ts, y castear adentro — un mock
con un parámetro más estrecho no es asignable por contravarianza; y el acceso encadenado
`attachments?.[0].filename` necesitaba una variable intermedia bajo strict mode)

$ npx eslint .
(sin salida, EXIT=0)

$ npx vitest run
 ✓ tests/unit/email.test.ts (5 tests) — 3 originales de enviarFacturaPorCorreo sin modificar +
   2 nuevos: enviarCorreo sin adjunto (no incluye attachments) y enviarFacturaPorCorreo confirmando
   que sigue armando el adjunto igual que antes de generalizarse
 Test Files  10 passed (10)
      Tests  114 passed (114)   (112 de T-003 + 2 nuevos de email.test.ts)

$ npx wrangler deploy --dry-run -c wrangler.toml
Total Upload: 1738.95 KiB / gzip: 395.88 KiB — bindings EMAIL/FACTURACION_COLA/FACTURAS_R2 intactos
```
**Commit:** `51e0081`

## T-005 — `queues/cierre-facturacion.ts`: tercera rama del consumidor (`enviar_notificacion`)

**Archivos:** `backend/src/queues/cierre-facturacion.ts`
**Hace:** El `queue()` gana la rama `enviar_notificacion` (además de `emitir_factura` y
`enviar_correo_factura`, sin tocar esas dos): llama `enviarCorreo()` con
`destinatario`/`asunto`/`cuerpoHtml` del mensaje, y actualiza la fila de `notificaciones` con
`computarActualizacionNotificacion()` (ahora importado de `core/notificaciones`). Un fallo de envío
queda registrado (`ultimo_error`/`intentos`) y no interrumpe el procesamiento de otros mensajes del
batch (mismo criterio que las dos ramas existentes).
**Verificación:**
```bash
cd backend
npx tsc --noEmit
npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
npx vitest run
```
**Resultado esperado:** `tsc`/`eslint` sin errores; el Worker sigue empaquetando (mismos bindings de
siempre, sin cola nueva); `vitest run` completo en verde.
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
Extra no exigido por la tarea, hecho al tocar este archivo: se extrajo el remitente hardcodeado
('no-responder@undreocol.app', repetido si no) a una única constante REMITENTE_NOTIFICACIONES,
reutilizada tanto por enviarCorreoDeFactura (006, sin cambiar su comportamiento) como por la rama
nueva. También se cambiaron los 3 console.log del handler queue() a console.info (CLAUDE.md §7:
"nada de console.log en código entregado") — eran preexistentes de 005/006, se corrigieron de paso
por tocar esas mismas líneas para agregar la tercera rama, no como tarea aparte.

Sin test unitario nuevo: cierre-facturacion.ts no tiene (ni tenía) tests unitarios propios —
enviarCorreoDeFactura/emitirFacturaDeMensaje tampoco los tienen, se verifican por integración
(curl contra wrangler dev, como hizo 006). enviarNotificacionGenerica sigue el mismo criterio; su
verificación de integración real llega con T-006 (que es quien primero encola un mensaje real de
este tipo).

$ npx tsc --noEmit
(sin salida, EXIT=0)

$ npx eslint .
(sin salida, EXIT=0)

$ npx wrangler deploy --dry-run -c wrangler.toml
Total Upload: 1740.27 KiB / gzip: 396.02 KiB — bindings EMAIL/FACTURACION_COLA/FACTURAS_R2 intactos,
sin cola nueva (reutiliza undreocol-facturacion, plan.md §5)

$ npx vitest run
Test Files  10 passed (10)
     Tests  114 passed (114)   (sin cambio respecto a T-004 — esta tarea no agregó tests, solo
                                 lógica nueva de infraestructura, consistente con el resto del archivo)
```
**Commit:** `3323b1a`

## T-006 — Backend: enganches síncronos (pago/corte/reconexión) + `GET /notificaciones`

**Archivos:** `backend/src/index.ts`
**Hace:** (plan.md §3) Tras `registrarPago()` exitoso en `POST /pagos`: si el suscriptor tiene email,
`encolarNotificacion(tipo: 'confirmacion_pago', ...)` con el contenido armado vía
`contenidoConfirmacionPago()`. Tras `cortarSuscriptor()`/`reconectarSuscriptor()` exitosos en
`POST /suscriptores/:id/corte` y `.../reconexion`: mismo patrón con `corte_ejecutado`/
`reconexion_completada`. Ninguna de las tres rutas cambia su contrato de respuesta (decisión técnica,
plan.md §5) — el fallo o la omisión de la notificación son silenciosos para el llamador. Nueva ruta
`GET /notificaciones` (filtros `?tipo=`/`?estado=`, orden `created_at desc`), detrás de
`requerirClienteActivo()`.
**Verificación:**
```bash
cd backend
npx tsc --noEmit
npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
npx vitest run

# Integración real contra wrangler dev + Supabase local (mismo patrón usado para
# verificar el bug de login de esta conversación):
npx wrangler dev &
# login admin real, cookie de sesión (ver sesiones previas de esta conversación
# para el patrón exacto de curl con -c/-b cookiejar)
curl -s -i -X POST http://localhost:8787/pagos -b cookiejar.txt \
  -H "Content-Type: application/json" \
  -d '{"usuario_servicio_id":"<uno del fixture>","valor":10000,"metodo":"efectivo"}'
# → debe responder 201 igual que antes de esta tarea (con o sin email registrado)
curl -s -i http://localhost:8787/notificaciones -b cookiejar.txt
# → si el suscriptor tenía email, aparece una fila tipo=confirmacion_pago
```
**Resultado esperado:** `tsc`/`eslint`/`dry-run`/`vitest` limpios; `POST /pagos` sigue respondiendo
201 con el mismo cuerpo de siempre; si el suscriptor tiene email, `GET /notificaciones` muestra la
fila nueva; si no tiene email, no aparece ninguna fila y el pago igual queda registrado.
**Estado:** Completado (2026-09-05) — verificado end-to-end contra wrangler dev + Supabase local reales
**Evidencia:**
```
$ npx tsc --noEmit / npx eslint . → sin salida, EXIT=0 ambos
$ npx wrangler deploy --dry-run -c wrangler.toml
Total Upload: 1747.66 KiB / gzip: 397.34 KiB — bindings EMAIL/FACTURACION_COLA/FACTURAS_R2 intactos
$ npx vitest run → Test Files 10 passed, Tests 114 passed (sin cambio, tarea de rutas)

Integración real (wrangler dev + Supabase local, admin-a@test.local, suscriptor A1 con email):

1) Login → 200, cookie de sesión real.

2) POST /pagos {usuario_servicio_id: A1, valor: 10000, metodo: efectivo} → 201, MISMO cuerpo de
   siempre (pago+aplicaciones+remanente+facturas, sin ningún campo nuevo de notificación).
   Log real del Worker:
     send_email binding called: To: suscriptor-a1@test.local
     Subject: Confirmación de pago — Acueducto A
   GET /notificaciones?tipo=confirmacion_pago → 1 fila, estado=enviada, intentos=1.
   Contenido real del correo (leído del archivo HTML que miniflare escribe):
     "Recibimos tu pago de $10000 el 2026-09-05, aplicado a la(s) factura(s): FAC-2026-00001."

3) POST /suscriptores/{A1}/corte {motivo:"Mora de prueba T-006"} → 201, mismo cuerpo de siempre
   ({eventoId}). GET /notificaciones?tipo=corte_ejecutado → 1 fila, estado=enviada.

4) POST /suscriptores/{A1}/reconexion {} → 201, mismo cuerpo de siempre ({eventoId, deudaVencida}).
   GET /notificaciones?tipo=reconexion_completada → 1 fila, estado=enviada (llega en ~1s, la cola es
   asíncrona). Contenido real del correo:
     "Tu servicio con Acueducto A fue reconectado el 2026-09-05. Se generó la factura de reconexión
     REC-2026-00001." → confirma que el lookup de factura_reconexion_id → numero funciona de punta
     a punta con datos reales, no solo con el tipo.

5) GET /notificaciones (sin filtro) → las 4 filas (factura_generada de 006 + las 3 nuevas).
   GET /notificaciones?estado=pendiente → [] (las 3 ya habían terminado de procesarse) — confirma
   que el filtro por estado funciona, no solo por tipo.

HALLAZGO (documentado, no un bug de esta tarea): env.EMAIL SÍ se simula en wrangler dev local para
correos SIN adjunto binario — 006 documentó "env.EMAIL no existe en local" de forma más amplia de lo
real; la limitación exacta es solo con adjuntos binarios (el PDF de factura_generada), confirmado al
ver el binding responder normalmente para los 3 tipos nuevos de 010 (ninguno lleva adjunto).

NO VERIFICADO por esta vía específica: aislamiento HTTP con un segundo admin (admin-b@test.local no
está provisionado en Supabase Auth en este entorno, login devolvió 401 — no es un fallo de la ruta).
El aislamiento real de GET /notificaciones ya está garantizado por la misma política RLS
notificaciones_lectura verificada a nivel SQL en T-002, más el filtro explícito
.eq('cliente_id', ctx.clienteId) que agrega esta ruta (mismo patrón que /cartera y otras).
```
**Commit:** `c641c65`

## T-007 — `cron/avisos-vencimiento.ts`: recordatorio de vencimiento + aviso de mora (CA-5)

**Archivos:** `backend/src/cron/avisos-vencimiento.ts` (nuevo), `backend/wrangler.avisos-vencimiento.toml` (nuevo),
`backend/src/lib/notificaciones.ts` (fix real encontrado por esta tarea — ver evidencia)
**Hace:** (plan.md §7) Worker con cron diario: para cada cliente activo, busca facturas `pendiente`
con `fecha_vencimiento` dentro de `configuracion.dias_aviso_vencimiento` días (recordatorio) y
facturas que hoy cumplen por primera vez `pendiente` + `fecha_vencimiento < hoy` (mora). Antes de
insertar, verifica que no exista ya una fila `notificaciones` con el mismo `(factura_id, tipo)`
(idempotencia, spec §3.5). Usa `encolarNotificacion()` de T-004.
**Verificación:**
```bash
cd backend
npx tsc --noEmit
npx eslint .
npx wrangler deploy --dry-run -c wrangler.avisos-vencimiento.toml

# Idempotencia real: correr el handler dos veces contra el fixture de T-002 y
# confirmar con SQL que no se duplicó ninguna fila.
psql "$DATABASE_URL" -c "select factura_id, tipo, count(*) from notificaciones where tipo in ('recordatorio_vencimiento','aviso_mora') group by 1,2 having count(*) > 1;"
```
**Resultado esperado:** `tsc`/`eslint`/`dry-run` limpios; la consulta de duplicados **no devuelve
ninguna fila** tras ejecutar el handler dos veces seguidas.
**Estado:** Completado (2026-09-05) — con un bug real encontrado y corregido, y un hallazgo
colateral importante sobre el estado de la base de datos local (ver abajo)
**Evidencia:**
```
BUG REAL ENCONTRADO Y CORREGIDO (no "debería funcionar" — se descubrió al verificar de verdad):
encolarNotificacion() (lib/notificaciones.ts, T-004) nunca guardaba factura_id en el INSERT —
EncolarNotificacionInput no tenía ese campo. Sin factura_id, la verificación de idempotencia
(que filtra por factura_id) nunca podía encontrar una fila previa: la primera prueba real (dos
disparos del cron con dos facturas de prueba insertadas a mano, fecha_vencimiento hoy+2 y hoy-3)
insertó 4 filas en vez de 2 (2 por corrida). Corregido: EncolarNotificacionInput gana
facturaId?: string (opcional, solo lo usan recordatorio_vencimiento/aviso_mora); el cron lo pasa.

Verificado tras el fix, con las MISMAS dos facturas de prueba (TEST-VENCE-T007 vence en 2 días,
TEST-MORA-T007 vencida hace 3 días, suscriptor A1 con email), usando
`wrangler dev -c wrangler.avisos-vencimiento.toml --test-scheduled` y GET /__scheduled dos veces:

Corrida 1: "avisos-vencimiento: 1 recordatorio(s) de vencimiento y 1 aviso(s) de mora encolados"
Corrida 2: "avisos-vencimiento: 0 recordatorio(s) de vencimiento y 0 aviso(s) de mora encolados"

$ psql "$DATABASE_URL" -c "select factura_id, tipo, count(*) from notificaciones where factura_id
  in (...) group by 1,2;"
 11110000-...0001 | recordatorio_vencimiento | 1
 11110000-...0002 | aviso_mora               | 1
→ exactamente UNA fila por (factura_id, tipo) tras dos corridas — CA-5 verificado de verdad.

Contenido real de los correos (asunto guardado en la fila, correcto):
  "Recordatorio: la factura TEST-VENCE-T007 vence el 2026-09-07"
  "Factura TEST-MORA-T007 vencida — Acueducto A"

$ npx tsc --noEmit / npx eslint . → sin salida, EXIT=0 (tras el fix)
$ npx wrangler deploy --dry-run -c wrangler.avisos-vencimiento.toml
Total Upload: 710.93 KiB / gzip: 138.40 KiB — binding FACTURACION_COLA (mismo, sin cola nueva)
$ npx vitest run → 114 tests OK (sin regresión; esta tarea no agregó tests unitarios propios —
  mismo criterio que T-005: el consumo de la cola ya está probado, esta tarea solo necesitaba
  probar la idempotencia y el contenido, ambos verificados con datos reales de PostgreSQL)

Limpieza tras la prueba (correcta, no un borrado a la fuerza): facturas.motivo_anulacion no permite
DELETE (trigger bloquear_factura_inmutable, por diseño) — las dos facturas de prueba se ANULARON
(estado='anulada', motivo registrado) en vez de borrarse, respetando la misma regla que protege
datos reales.

--- HALLAZGO COLATERAL IMPORTANTE (no es un bug de código, es un efecto de haber hecho pruebas de
integración reales contra la base compartida) ---

Al correr la regresión completa de aislamiento (001-012) DESPUÉS de las pruebas end-to-end de
T-006 (pago/corte/reconexión reales vía curl) y T-007, aparecieron 4 fallas NUEVAS que no estaban
antes de T-006 (005, 006, 007 y el propio 010_notificaciones_aislamiento.sql de T-002):
  005: "admin A ve 4 facturas (esperaba 1)"
  006: "admin A ve 4 notificaciones (esperaba 1)"
  007: "admin A ve 3 pagos (esperaba 2 del fixture)"
  010: "se insertaron/encontraron 10 filas (esperaba 7)"

Investigado antes de reportarlo (CLAUDE.md §8): NO es una fuga de aislamiento — verificado
leyendo 006_correo_factura_aislamiento.sql PASO 2: el primer chequeo (conteo total, hardcodeado a
1) es el que falla; el segundo chequeo real de esa misma prueba (`where cliente_id = B` debe dar 0)
nunca se alcanza porque el primero ya lanzó la excepción, pero confirmé a mano que todas las filas
nuevas tienen `cliente_id` de A, nunca de B. Es decir: RLS sigue funcionando correctamente: lo que
se rompió es la ASUNCIÓN de un conteo fijo de filas que estos tests (005/006/007, preexistentes,
no de esta feature) hardcodean asumiendo una base recién resembrada.

Causa exacta: el pago, el corte y la reconexión reales que ejecuté en T-006 contra `wrangler dev` +
esta misma base de Supabase local (persistente, no efímera) dejaron rastro PERMANENTE:
- El pago: ANULADO ahora vía POST /pagos/:id/anular (el mecanismo propio de la app) — pero anular
  NO borra la fila, solo cambia su estado; `select count(*) from pagos` la sigue contando.
- La factura de reconexión generada automáticamente (REC-2026-00001): ANULADA vía
  POST /facturas/:id/anular — mismo caso, la fila sigue existiendo.
- Los eventos en `cortes_reconexiones` (1 corte + 1 reconexión): **no se pueden deshacer**. El
  propio comentario de la migración de 009 dice explícitamente "Sin DELETE expuesto por ninguna
  ruta" — son un historial permanente por diseño, no hay anulación posible ni debería haberla.
- Las 3 filas de `notificaciones` de confirmacion_pago/corte_ejecutado/reconexion_completada:
  tampoco tienen mecanismo de anulación (no lo necesitan, son solo un registro de intentos de
  envío) — siguen existiendo.

Es exactamente el mismo riesgo que 009 documentó explícitamente para fixtures compartidos
("agregar una factura nueva rompería los conteos que 005/007 ya asumen") — aquí se materializó vía
pruebas de integración en vivo (curl), no vía un archivo de fixture, un camino que no estaba
señalado antes.

Lo que NO hice, deliberadamente: un `supabase db reset --local` real restauraría esta base a un
estado limpio, pero es una acción destructiva y de alcance mayor al de esta tarea — entre otras
cosas, borraría también el usuario `admin-a@test.local` de Supabase Auth que se ha usado en TODA
esta conversación (incluida la sesión del bug de login) para pruebas manuales. Esa decisión le
corresponde a Mateo, no la tomo por mi cuenta.

CONCLUSIÓN para Mateo: el código de 010 (idempotencia, contenido, RLS) está verificado y correcto.
Los tests de aislamiento de 005/006/007 (no de esta feature) y el propio de 010 (010_notificaciones_
aislamiento.sql, T-002) van a seguir fallando por conteo si se re-corren contra ESTA base local
específica, hasta que se haga un `supabase db reset --local` real (reaplicando las 12 migraciones +
todos los fixtures desde cero). No es una regresión de 010 sobre esos tests — es el costo de haber
verificado T-006/T-007 con peticiones HTTP reales en vez de solo revisar el código.
```
**Commit:** `5cc8f44`

## T-008 — `cron/monitor-db.ts`: alerta real (CA-8)

**Archivos:** `backend/src/cron/monitor-db.ts` (editado), `backend/wrangler.monitor-db.toml` (editado),
`backend/src/cron/nivel-monitoreo.ts` (ajuste no previsto: `construirAlertaMonitoreo()` movida aquí,
no a `monitor-db.ts` — ver evidencia), `backend/tests/unit/monitor-db.test.ts` (2 tests nuevos)
**Hace:** (plan.md §3.8 del spec) `alertaStub()` → llamada real a `enviarCorreo()` (de `lib/email.ts`)
con destinatario `env.ALERTA_EMAIL_DESTINO`, **sin** pasar por la tabla `notificaciones` (no tiene
`cliente_id` de un acueducto real). `wrangler.monitor-db.toml` gana `[[send_email]] name = "EMAIL"`
(no lo tenía) y la var `ALERTA_EMAIL_DESTINO`.
**Verificación:**
```bash
cd backend
npx tsc --noEmit
npx eslint .
npx wrangler deploy --dry-run -c wrangler.monitor-db.toml
npx vitest run
```
**Resultado esperado:** `tsc`/`eslint` sin errores; el Worker de `monitor-db` empaqueta con el binding
`EMAIL` nuevo; los tests de `nivel-monitoreo.ts` (ya existentes) siguen en verde y un test nuevo
confirma que, con nivel `alerta`/`critico` simulado, se invoca `enviarCorreo` con el destinatario y
contenido esperados (stub de envío, sin credenciales reales — igual criterio que CA-3 de 006).
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
Ajuste no previsto en el plan original: `monitor-db.ts` tiene la regla explícita (comentario propio
del archivo desde antes de esta feature) de "SOLO exportar el default" — no se le puede agregar un
export nombrado para testear la construcción del contenido de la alerta sin violar esa convención.
Se movió `construirAlertaMonitoreo(resultado)` (pura, sin I/O) a `nivel-monitoreo.ts`, que ya es el
módulo designado para lógica testeable de este cron (mismo lugar que `calcularNivel`). El envío real
(`enviarCorreo`) sigue solo en `monitor-db.ts`, sin exportarse — se verifica por integración (abajo),
mismo criterio que `enviarFacturaPorCorreo`/`enviarNotificacionGenerica` en `cierre-facturacion.ts`
(tampoco tienen test unitario de la invocación, solo de su contenido/contrato).

$ npx tsc --noEmit / npx eslint . → sin salida, EXIT=0 ambos

$ npx wrangler deploy --dry-run -c wrangler.monitor-db.toml
Total Upload: 708.43 KiB / gzip: 137.91 KiB
Binding                                            Resource
env.EMAIL (unrestricted)                           Send Email
env.ALERTA_EMAIL_DESTINO ("alertas@undreocol.app")  Environment Variable
→ el binding EMAIL que antes no existía en este Worker ya está presente.

$ npx vitest run
 ✓ tests/unit/monitor-db.test.ts (8 tests) — 6 de calcularNivel (sin cambios) + 2 nuevos de
   construirAlertaMonitoreo: nivel alerta (asunto/cuerpo contienen "alerta" y el porcentaje 80) y
   nivel critico (asunto/cuerpo contienen "critico")
 Test Files  10 passed (10)
      Tests  116 passed (116)

Integración real (wrangler dev -c wrangler.monitor-db.toml --test-scheduled + GET /__scheduled)
contra Supabase local real: base real de 12.88 MB (2.58% del límite) → nivel "ok" → el log confirma
que NO se intenta enviar ningún correo (rama `if` correctamente no entra) — no se pudo forzar un
nivel alerta/critico real sin inflar la base de forma artificial, lo cual no se justifica solo para
esta prueba; el camino de contenido+envío cuando SÍ hay alerta queda cubierto por los 2 tests
unitarios de contenido + la reutilización comprobada de `enviarCorreo()` (misma función ya
verificada end-to-end con envío real simulado en T-006).

Nota: ALERTA_EMAIL_DESTINO = "alertas@undreocol.app" es un valor placeholder — NO VERIFICADO cuál
debe ser el buzón real de monitoreo de Mateo; queda marcado con un TODO en el wrangler.toml. Mateo
debe reemplazarlo antes de producción.
```
**Commit:** `9869eba`

## T-009 — Frontend: `lib/api.ts` + panel `/app/notificaciones`

**Archivos:** `frontend/lib/api.ts` (editado), `frontend/app/app/notificaciones/page.tsx` (nuevo)
**Hace:** `listarNotificaciones(filtros)` + tipos `Notificacion`/`TipoNotificacion` en `lib/api.ts`,
mismo wrapper `peticion<T>()` existente. Panel de solo lectura con tabla (tipo, canal, destinatario,
estado, intentos, último error, fecha) y filtros por tipo/estado — mismo patrón visual que
`/app/pagos`/`/app/cortes`.
**Verificación:**
```bash
cd frontend
npx tsc --noEmit
npm run build
npm run lint
grep -rn "@supabase" app/ components/ lib/
```
**Resultado esperado:** `tsc`/build/lint sin errores ni warnings; el `grep` de `@supabase` no
encuentra ningún `import` real (mismo falso positivo del comentario de cabecera de `lib/api.ts` ya
documentado en 002/003/009).
**Estado:** Completado (2026-09-05) — verificado con build/lint y en navegador real (Playwright)
**Evidencia:**
```
$ npx tsc --noEmit → sin salida, EXIT=0
$ npm run build
 ○ /app/notificaciones   3.07 kB   116 kB  ← registrada correctamente, sin errores/warnings
$ npm run lint → sin salida, EXIT=0
$ grep -rn "@supabase" app/ components/ lib/
lib/api.ts:1:// Wrapper fetch hacia la API de Hono (backend/). Nunca importa `@supabase/*`
→ único match, el comentario de cabecera (mismo falso positivo ya documentado en 002/003/009).

Verificación real en navegador (Playwright, Chromium real, contra wrangler dev + next dev +
Supabase local reales — no build/lint únicamente):
1. Login admin real → /app/dashboard → navegación a /app/notificaciones.
2. Sin filtro: 4 filas reales (reconexion_completada, corte_ejecutado, confirmacion_pago,
   factura_generada — los datos reales de T-006/006), cada una con destinatario, canal, asunto,
   estado en verde "Enviada", intentos y fecha de envío correctamente formateados. Screenshot
   revisado visualmente: consistente con el estilo del resto del panel (/app/pagos, /app/cortes).
3. Filtro ?tipo=confirmacion_pago → la petición real a GET /notificaciones?tipo=confirmacion_pago
   se confirmó en la red, y la lista se reduce a exactamente 1 fila ("Confirmación de pago").
4. Filtro ?estado=fallida → 0 resultados, muestra "Sin notificaciones para los filtros
   seleccionados" (no hay ninguna fallida en los datos reales).
5. Sin errores de consola del navegador en ningún paso.

(Nota de proceso: la primera pasada de este mismo test tuvo un falso positivo — comprobaba texto
de toda la página en vez de solo las filas visibles, y el propio <select> de Tipo contiene la
palabra "Corte ejecutado" como una de sus opciones. Corregido apuntando la aserción a los
elementos de fila reales antes de dar el resultado por bueno — CLAUDE.md §4, no se acepta la
primera lectura sin verificar que realmente prueba lo que dice probar.)
```
**Commit:** —

## T-010 — Verificación manual end-to-end (navegador real)

**Archivos:** ninguno (solo verificación)
**Hace:** Flujo completo con `wrangler dev` + `next dev` + Supabase local reales (viables en este
entorno, a diferencia de 009): login admin → registrar un pago de un suscriptor con email → ver la
notificación `confirmacion_pago` en `/app/notificaciones` → cortar un suscriptor con email → ver
`corte_ejecutado` → reconectarlo → ver `reconexion_completada` → ejecutar manualmente el handler de
`avisos-vencimiento.ts` contra el fixture → ver `recordatorio_vencimiento`/`aviso_mora`.
**Verificación:**
```bash
cd backend && npx wrangler dev &
cd frontend && npm run dev &
# navegar manualmente el flujo descrito arriba, o automatizarlo con Playwright
# (instalado ad hoc en el scratchpad, sin agregarlo como dependencia del repo —
# mismo patrón que la verificación del bug de login de esta conversación)
```
**Resultado esperado:** el flujo completo funciona sin error visible; las 5 notificaciones nuevas
(más `factura_generada`, sin cambios) aparecen correctamente en el panel, con el `estado` reflejando
si el envío real fue posible (probablemente `pendiente`/`fallida` sin `env.EMAIL` en local, igual que
006 documenta) o si un `INSERT` inválido fue rechazado.
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** (no aplica si es solo verificación sin cambios de código)

## T-011 — Cierre: `CHANGELOG.md` + checklist `spec.md §8`

**Archivos:** `CHANGELOG.md`, `specs/010-notificaciones/spec.md` (checklist final)
**Hace:** Entrada de `CHANGELOG.md` resumiendo T-001 a T-010 (qué se verificó, qué quedó NO
VERIFICADO — previsiblemente el envío real a un buzón con Workers Paid/dominio verificado, igual que
006) y la checklist de "Definición de terminado" de `spec.md §8` marcada con evidencia real.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint . && npx wrangler deploy --dry-run -c wrangler.toml && npx vitest run
cd backend && npx wrangler deploy --dry-run -c wrangler.avisos-vencimiento.toml
cd backend && npx wrangler deploy --dry-run -c wrangler.monitor-db.toml
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** los 6 comandos en verde; evidencia pegada en el CHANGELOG y en esta tarea;
checklist de `spec.md §8` con cada ítem marcado según lo realmente verificado (sin marcar nada sin
evidencia, CLAUDE.md §4).
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** —
