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
**Commit:** `[pendiente de este mensaje]`

## T-002 — Fixtures + test de aislamiento

**Archivos:** `tests/fixtures/notificaciones-generales.sql`, `tests/aislamiento/010_notificaciones_aislamiento.sql`
**Hace:** Fixture con: una factura `pendiente` de un suscriptor del cliente A con `fecha_vencimiento`
dentro del umbral de recordatorio, una factura `pendiente` ya vencida del mismo cliente (para el
aviso de mora), y equivalentes del cliente B (para el aislamiento). Test de aislamiento (SQL puro,
sin depender de las rutas HTTP que llegan en T-006) cubriendo:
1. Con `auth.uid()` del admin de A: `SELECT` sobre `notificaciones` no devuelve filas del cliente B.
2. Con `auth.uid()` del admin de B: simétrico.
3. Un `INSERT` directo en `notificaciones` con un `cliente_id` ajeno al propio, desde el rol
   `authenticated` de un admin, es rechazado por RLS.
4. El `CHECK` de T-001 sigue rechazando un tipo inválido (regresión, no reimplementación).
5. Regresión completa 001-009/012 sobre el estado final.
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/notificaciones-generales.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/010_notificaciones_aislamiento.sql
```
**Resultado esperado:** ambos scripts en verde, terminan con `NOTIFICACIONES-AISLAMIENTO OK`; la
regresión 001-009/012 (re-corrida en la misma pasada, mismo patrón que 009 T-002) también en verde.
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** —

## T-003 — `core/notificaciones.ts`: contenido por tipo + `computarActualizacionNotificacion` movido

**Archivos:** `backend/src/core/notificaciones.ts` (nuevo), `backend/tests/unit/notificaciones.test.ts`
(nuevo), `backend/src/lib/email.ts` (se retiran `computarActualizacionNotificacion`/
`MAX_INTENTOS_ENVIO`), `backend/tests/unit/email.test.ts` (se retiran los tests movidos, sin tocar los
que quedan)
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
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** —

## T-004 — `lib/email.ts`: `enviarCorreo()` genérico + `lib/notificaciones.ts`: `encolarNotificacion()`

**Archivos:** `backend/src/lib/email.ts` (editado), `backend/src/lib/notificaciones.ts` (nuevo),
`backend/src/lib/db.ts` (editado: `TipoMensajeFacturaCierre` + `MensajeFacturaCierre`)
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
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** —

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
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** —

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
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** —

## T-007 — `cron/avisos-vencimiento.ts`: recordatorio de vencimiento + aviso de mora (CA-5)

**Archivos:** `backend/src/cron/avisos-vencimiento.ts` (nuevo), `backend/wrangler.avisos-vencimiento.toml` (nuevo)
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
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** —

## T-008 — `cron/monitor-db.ts`: alerta real (CA-8)

**Archivos:** `backend/src/cron/monitor-db.ts` (editado), `backend/wrangler.monitor-db.toml` (editado)
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
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
```
**Commit:** —

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
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí al ejecutar>
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
