# TASKS — 008: portal-suscriptor

**Spec aprobado:** 2026-09-03 (spec.md commit `d015ee0`)
**Plan aprobado:** 2026-09-03 (plan.md commit `310949f`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Entorno:** Supabase local real (CLI, PostgreSQL) + Docker. La base se reconstruye con
  `supabase db reset --local` (001→008 migraciones) y se cargan los fixtures 001-008 antes de cada
  paso que lo requiera. `http_proxy` sin NO_PROXY da 502 a 127.0.0.1 → usar `curl --noproxy '*'` y
  lanzar `wrangler dev` con `env -u http_proxy -u https_proxy`.
- **Credenciales reales ya disponibles desde 001/003** (sin esperar un fixture nuevo): A1 =
  `cliente_id a0000000-...0001`, `numero_documento '1000000001'`, `codigo_suscriptor 'A-001'`; A2 =
  `numero_documento '1000000002'`, `codigo_suscriptor 'A-002'`; B1 (cliente B) =
  `numero_documento '2000000001'`, `codigo_suscriptor 'B-001'`. `clientes.slug`: `acueducto-a` /
  `acueducto-b` (fixture de 001). Suficiente para probar las funciones desde T-001 sin depender del
  fixture nuevo de T-002.
- **D-10 (obligatorio):** ninguna ruta del portal usa `SUPABASE_SERVICE_ROLE_KEY`. El Worker llama las
  funciones del portal con `crearClienteAnon`. Cada función revalida `numero_documento`+
  `codigo_suscriptor` internamente — nunca confía en un id recibido como único parámetro.
  `SESSION_SECRET` nunca se commitea (vive en `.dev.vars`, gitignored, y en secretos de Mateo en
  producción).
- **Orden de verificación (plan.md §8):** migración + smoke de las funciones (CA-6/CA-7/CA-9 lógica) →
  fixture + aislamiento (CA-2/CA-9 completo, regresión 001-007) → `sesion-suscriptor.ts` + unit JWT →
  `lib/portal.ts` + rutas + curl/wrangler dev (CA-1, CA-3 a CA-7) → regenerar código (CA-8) →
  frontend (CA-10) → cierre.

---

## T-001 — Migración: `configuracion` (umbral) + `portal_intentos_login` + funciones `SECURITY DEFINER` (D-10)

**Archivos:** `supabase/migrations/20260908090000_portal-suscriptor.sql`
**Hace:** (plan.md §2) `alter table configuracion add column portal_umbral_intentos_login smallint
not null default 8, add column portal_bloqueo_minutos integer not null default 15`; tabla
`portal_intentos_login` (`cliente_id`, `numero_documento`, `intentos`, `bloqueado_hasta`,
`ultimo_intento`, unique `(cliente_id, numero_documento)`) con RLS `FORCE` y una única política de
`select` para `es_admin_plataforma()` (sin política de escritura: solo la tocan las funciones
`security definer`, que bypasean RLS como su dueño); funciones `security definer`
`portal_validar_credenciales`, `portal_facturas_suscriptor`, `portal_factura_completa`,
`portal_saldo_favor_suscriptor`, `portal_consumo_suscriptor` (plan.md §2, todas revalidan
`numero_documento`+`codigo_suscriptor`+`estado <> 'inactivo'` contra `usuarios_servicio` del
`cliente_id` recibido); `revoke all ... from public` + `grant execute ... to anon` en las cinco.
**Verificación:**
```bash
supabase db reset --local
DB="$DATABASE_URL"
psql "$DB" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
psql "$DB" -v ON_ERROR_STOP=1 -f tests/fixtures/catalogo.sql
psql "$DB" -v ON_ERROR_STOP=1 -f tests/fixtures/suscriptores.sql
psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
\d configuracion
\d portal_intentos_login
select proname, prosecdef from pg_proc where proname like 'portal_%';
select routine_name, grantee, privilege_type from information_schema.routine_privileges
  where routine_name like 'portal_%';
SQL
```
**Resultado esperado:** reset 001→008 desde cero; `configuracion` tiene las 2 columnas nuevas con sus
defaults (8/15); `portal_intentos_login` existe con `relforcerowsecurity`; las 5 funciones existen con
`prosecdef = true`; `anon` tiene `EXECUTE` en las 5 y ningún otro rol lo tiene por `PUBLIC`.

Smoke funcional (rol `anon`, con las credenciales reales de 001/003 — ver Notas de entorno):
- P1 `portal_validar_credenciales(cliente_a, '1000000001', 'A-001')` → `{estado:'ok', usuario_servicio_id: d0000000-...0a1}`
- P2 mismo cliente, código incorrecto → `{estado:'invalido'}` (mensaje genérico, no distingue campo)
- P3 código correcto de A1 pero `cliente_id` de B → `{estado:'invalido'}` (el slug manda, spec §3.1)
- P4 `portal_facturas_suscriptor`/`portal_saldo_favor_suscriptor`/`portal_consumo_suscriptor` con
  credenciales de A1 sin facturas/pagos/lecturas todavía → `[]`/`0`/`[]` (no error)
- P5 `select * from portal_intentos_login` como `anon` → rechazado por RLS (sin política de select
  para `anon`); como `es_admin_plataforma()` → visible
- P6 8 llamadas seguidas con código incorrecto para el mismo `(cliente_id, numero_documento)` → la
  9.ª devuelve `{estado:'bloqueado', reintentar_en:...}` **aunque el código de la 9.ª sea correcto**;
  limpiar la fila de `portal_intentos_login` de prueba al terminar (no debe quedar en el estado que
  hereda T-002)
**Estado:** Completado (2026-09-03)
**Evidencia:**
```
$ supabase db reset --local → Finished (001→008 migraciones aplicadas desde cero, sin errores)
$ psql -f tests/fixtures/fundacion.sql / catalogo.sql / suscriptores.sql → cada uno COMMIT (0 errores)

\d configuracion → portal_umbral_intentos_login smallint not null default 8,
                    portal_bloqueo_minutos integer not null default 15
\d portal_intentos_login → tabla creada, RLS forced, única política
                            "portal_intentos_login_plataforma" (select, es_admin_plataforma())
                            — SIN política de insert/update para ningún rol
select proname, prosecdef from pg_proc where proname like 'portal_%' →
  las 5 funciones (portal_validar_credenciales, portal_facturas_suscriptor,
  portal_factura_completa, portal_saldo_favor_suscriptor, portal_consumo_suscriptor)
  con prosecdef = true
routine_privileges → anon tiene EXECUTE en las 5 (junto con authenticated/postgres/
  service_role, que ya lo tenían implícito); revoke from public aplicado correctamente
  (sin la revocación, PUBLIC también habría quedado con EXECUTE por defecto de Postgres)

Smoke funcional (rol anon, transacción con ROLLBACK — nada persiste):
  P1 OK  credenciales correctas de A1 → {"estado":"ok","usuario_servicio_id":"d0000000-...0a1"}
  P2 OK  código incorrecto → {"estado":"invalido"}
  P3 OK  código correcto de A1 + cliente_id de B → {"estado":"invalido"} (el slug manda)
  P4 OK  facturas/saldo/consumo de A1 (sin fixtures de 004-007 aún) → [] / 0 / []
  P5 OK  `select * from portal_intentos_login` como anon → 0 filas (RLS sin política para anon)
  P6 OK  8 intentos fallidos seguidos (numero_documento 1000000002) → el 9.º intento, CON el
    código correcto ('A-002'), devuelve {"estado":"bloqueado","reintentar_en":"..."} — confirma
    que el bloqueo se evalúa ANTES de revisar las credenciales
  P7 OK  (adicional, no listado arriba) estado='inactivo' en A1 (UPDATE dentro de la misma
    transacción con rollback): login devuelve {"estado":"inactivo"} (no "invalido"); el CA-9
    counter NO sube (0 filas en portal_intentos_login para ese numero_documento) — un acierto de
    credenciales sobre una cuenta inactiva no cuenta como intento fallido; y
    portal_facturas_suscriptor con las mismas credenciales devuelve [] (pierde acceso de
    inmediato, CLAUDE.md §10-22d, sin verificación aparte)
```
**Commit:** (tras completar)

## T-002 — Fixture `portal.sql` + aislamiento `008_` (CA-2, CA-9)

**Archivos:** `tests/fixtures/portal.sql`, `tests/aislamiento/008_portal_aislamiento.sql`
**Hace:** Fixture sobre el estado de 001-007 (no muta lo que los aislamientos previos asumen — regla
de 005/007): solo deja dos filas de `portal_intentos_login` (tabla nueva de 008, sin política de
lectura para anon): A1 `'1000000001'` con **bloqueo vigente** (rechaza aunque la credencial sea
correcta) y A2 `'1000000002'` con **bloqueo vencido** (permite reintentar) — para probar los bordes
de CA-9 sin repetir 8 intentos en cada corrida. El **historial de dos contadores** que usa CA-7
(consumo sin cortes) NO se agrega al fixture (un contador o lectura extra de A1 rompería los conteos
del aislamiento 003 «1 contador» y del 004 «1 lectura»): lo crea el aislamiento 008 dentro de una
transacción con ROLLBACK (periodo histórico de 2025-12 cerrado temporalmente el periodo actual para
respetar `uq_periodo_abierto`) y la verificación de T-004 lo creará antes del curl. Test de
aislamiento (CA-2/CA-9; se llama a las funciones `SECURITY DEFINER` como `anon` con distintas
combinaciones, sin `auth.uid()`): credenciales de A1 → solo datos de A1 (factura/saldo/consumo);
`portal_factura_completa` de A1 con el id de una factura de A2 o de B1 → `null` (IDOR); credenciales
de A1 con `cliente_id` de B → nada; bloqueo vigente de A1 rechaza con credencial correcta; bloqueo
vencido de A2 permite; consumo con dos contadores devuelve 2 lecturas ordenadas. Regresión 001-007 en
verde sobre el mismo estado final.
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/lecturas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/facturacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/correo-factura.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/pagos.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/portal.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/008_portal_aislamiento.sql
for f in 001_fundacion 002_catalogo 003_suscriptores 004_lecturas_consumo 005_facturacion 006_correo_factura 007_pagos; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/${f}_aislamiento.sql
done
```
**Resultado esperado:** `PORTAL-AISLAMIENTO OK` y los 7 previos en verde sobre el mismo estado final.
**Estado:** Completado (2026-09-08)
**Evidencia:**
```
Fixtures 001-008 (fundacion..portal) cargados sobre la base recién reseteada (001→008):
  cada fixture termina con COMMIT (0 errores).

$ tests/aislamiento/008_portal_aislamiento.sql → PORTAL-AISLAMIENTO OK (línea final)
  PASO 1 5 funciones SECURITY DEFINER con EXECUTE para anon + columnas de configuracion
         + 2 filas de portal_intentos_login del fixture
  PASO 2 anon: login de A2 (bloqueo vencido) → ok; facturas de A1 → solo FAC-2026-00001;
         saldo a favor de A1 → 2000 (fixture 007); consumo de A1 → 1 lectura
  PASO 3 anon: login de A1 (bloqueo VIGENTE) → bloqueado con reintentar_en, aunque la
         credencial ('A-001') sea correcta
  PASO 4 anon: credenciales A1 + cliente_id de B → facturas [] y consumo []
  PASO 5 anon: portal_factura_completa de A1 con factura de A2 y de B1 (creadas en la
         transacción) → null (IDOR); su propia factura → FAC-2026-00001
  PASO 6 anon: con un contador histórico reemplazado + lectura de 2025-12 (creados en la
         transacción) portal_consumo devuelve las 2 lecturas de ambos contadores en orden

Regresión sobre el mismo estado final (fixtures 001-008):
  001_fundacion=1 · 002_catalogo=1 · 003_suscriptores=1 · 004_lecturas_consumo=1
  005_facturacion=1 · 006_correo_factura=1 · 007_pagos=1 — todos OK

NOTA DE DISEÑO (regla aprendida en 005/007): el fixture de portal NO agrega contadores/
lecturas de A1 (el aislamiento 003 espera 1 contador del cliente A y el 004 espera 1
lectura). El histórico de dos contadores de CA-7 se crea en el aislamiento 008 con
ROLLBACK (cerrando temporalmente el periodo actual para respetar uq_periodo_abierto) y la
verificación de T-004 lo creará antes del curl de consumo.
```
**Commit:** (tras completar)

## T-003 — `sesion-suscriptor.ts` (JWT propio, D-4/D-10) + unit tests

**Archivos:** `backend/src/lib/db.ts`, `backend/.dev.vars`, `backend/src/lib/sesion-suscriptor.ts`,
`backend/tests/unit/sesion-suscriptor.test.ts`
**Hace:** `Env.SESSION_SECRET: string` en `db.ts`; `SESSION_SECRET` generado localmente en
`.dev.vars` (nunca al repo). Implementa `iniciarSesionSuscriptor`/`verificarSesionSuscriptor`/
`renovarSesionSuscriptor` (plan.md §4): JWT firmado con `hono/utils/jwt` (HS256, `SESSION_SECRET`),
claims `sub`/`cid`/`doc`/`cod`/`tipo`/`exp`; cookie `uc_sesion_suscriptor`
(`HttpOnly+Secure+SameSite=Lax`, `DURACION_SESION_SUSCRIPTOR_SEG`); `verificarSesionSuscriptor` nunca
lanza (inválida/vencida/`tipo` incorrecto → `null`) y renueva automáticamente si quedan menos de
`UMBRAL_RENOVACION_SUSCRIPTOR_SEG`. Elimina `ErrorSesionSuscriptorPendiente` (ya no aplica). Unit
tests del round-trip sin Workers ni base (`vitest`).
**Verificación:**
```bash
cd backend && npx vitest run tests/unit/sesion-suscriptor.test.ts
npx tsc --noEmit && npx eslint src/lib/sesion-suscriptor.ts tests/unit/sesion-suscriptor.test.ts
```
**Resultado esperado:** unit en verde: firmar+verificar devuelve los mismos claims; `tipo` distinto de
`'suscriptor'` → `null`; firma con secreto distinto → `null`; `exp` vencido → `null`; con menos de 7
días de vida, `verificarSesionSuscriptor` devuelve una sesión con `expiraEn` renovado (mayor); con más
de 7 días, `expiraEn` no cambia. `tsc`/`eslint` sin errores.
**Estado:** Completado (2026-09-08)
**Evidencia:**
```
$ npx vitest run tests/unit/sesion-suscriptor.test.ts → 10 passed
  round-trip: iniciar escribe cookie uc_sesion_suscriptor (HttpOnly/Secure/SameSite=Lax) y
    verificar devuelve los claims (sub/cid/doc/cod)
  sin cookie → null · tipo 'administrativa' → null (22c) · secreto distinto → null ·
  exp vencido → null
  con exp a 3 días (< 7) → renueva: expiraEn ~ 30 días y reescribe la cookie
  con exp a 20 días (> 7) → NO renueva (mismo expiraEn, sin Set-Cookie)
  renovarSesionSuscriptor → expiraEn futuro + cookie · cerrar → Max-Age=0
$ npm test → 9 files / 90 tests OK (80 previos + 10 de la sesión del portal)
$ npx tsc --noEmit → sin salida · $ npx eslint → sin salida

Nota de implementación: hono 4 exporta sign/verify desde 'hono/jwt' (no 'hono/utils/jwt',
que no existe en la v4.6 instalada) — se verificó con tsc. SESSION_SECRET generado con
crypto.randomBytes(32) y agregado a backend/.dev.vars (gitignored — nunca al repo);
Env.SESSION_SECRET es requerido (db.ts).
```
**Commit:** (tras completar)

## T-004 — `lib/portal.ts` + rutas `/portal/*` + verificación curl (CA-1, CA-3 a CA-7)

**Archivos:** `backend/src/lib/portal.ts`, `backend/src/index.ts`,
`supabase/migrations/20260909090000_portal-slug.sql`
**Hace:** `lib/portal.ts`: `resolverClientePorSlug`, `validarCredencialesPortal`,
`obtenerFacturasPortal` (separa la más
reciente no anulada como "actual" del resto como historial, CA-4), `obtenerFacturaCompletaPortal`
(para el PDF), `obtenerSaldoFavorPortal`, `obtenerConsumoPortal` — todas llaman a las funciones
`security definer` de T-001 con `crearClienteAnon` (D-10, nunca `service_role`). Middleware
`requerirSesionSuscriptor` (espejo de `requerirClienteActivo`). Rutas (plan.md §3):
`POST /portal/:slug/login` (resuelve `cliente_id` por `clientes.slug`, 401/403/429 según el `estado`
de `portal_validar_credenciales`), `POST /portal/logout`, `GET /portal/facturas`,
`GET /portal/facturas/:id/pdf` (404 si `portal_factura_completa` devuelve `null` — IDOR; reutiliza
`generarPdfFactura` de 006 y la misma clave de R2 como caché, sin actualizar `facturas.pdf_url` —
simplificación aceptada, plan.md §5), `GET /portal/saldo-favor`, `GET /portal/consumo`.
DESVIACIÓN DE IMPLEMENTACIÓN: el plan §3 dice "resuelve cliente_id por clientes.slug", pero anon NO
puede leer `clientes` (RLS; verificado contra la base). Se añadió la función `SECURITY DEFINER`
`portal_cliente_por_slug(slug)` en una migración NUEVA (20260909090000) — no se reescribió la 008
publicada en T-001 — con grant solo a anon (el slug es público: está en la URL).
**Verificación:**
```bash
# con wrangler dev (:8787, env sin proxy) + Supabase local con fixtures 001-008
curl -sS --noproxy '*' -c cookie -X POST localhost:8787/portal/acueducto-a/login \
  -H 'Content-Type: application/json' -d '{"numero_documento":"1000000001","codigo_suscriptor":"A-001"}' \
  -w '\nHTTP %{http_code}\n'
curl -sS --noproxy '*' -b cookie localhost:8787/portal/facturas -w '\nHTTP %{http_code}\n'
curl -sS --noproxy '*' -b cookie localhost:8787/portal/facturas/<id-de-A2-o-de-B1>/pdf -o /dev/null -w '\nHTTP %{http_code}\n'
curl -sS --noproxy '*' -b cookie localhost:8787/portal/facturas/<id-propio>/pdf -o factura.pdf -w '\nHTTP %{http_code}\n'
curl -sS --noproxy '*' -b cookie localhost:8787/portal/saldo-favor -w '\nHTTP %{http_code}\n'
curl -sS --noproxy '*' -b cookie localhost:8787/portal/consumo -w '\nHTTP %{http_code}\n'
curl -sS --noproxy '*' -X POST localhost:8787/portal/acueducto-a/login -d '{"numero_documento":"1000000001","codigo_suscriptor":"mala"}' -w '\nHTTP %{http_code}\n'
```
**Resultado esperado:** login correcto → 200 + `Set-Cookie uc_sesion_suscriptor`; `/portal/facturas`
devuelve `facturaActual`/`historial` coherentes con el estado real de A1 (mismos totales que ve el
admin); PDF de una factura ajena → 404 sin servir bytes; PDF propio → 200 `application/pdf` válido;
saldo a favor coincide con `GET /suscriptores/:id/pagos` (007) para A1; consumo incluye las lecturas
de ambos contadores del fixture de T-002 sin huecos; login con código incorrecto → 401 mensaje
genérico; bloqueo por 8 fallos → 429 en el 9.º intento; logout → 401 con la misma cookie.
**Estado:** Completado (2026-09-08)
**Evidencia:**
```
$ npx tsc --noEmit → sin salida · $ npx eslint → sin salida
$ npx wrangler deploy --dry-run -c wrangler.toml → Total Upload 1723.96 KiB / gzip 392.87 KiB

Camino feliz (wrangler dev :8787 + Supabase local con fixtures 001-008):
  POST /portal/acueducto-a/login (A1: 1000000001/A-001) → 200 {sesion:{tipo:'suscriptor',...}}
    + Set-Cookie uc_sesion_suscriptor (HttpOnly/Secure/SameSite=Lax)
  GET /portal/facturas (A1) → facturaActual FAC-2026-00001 (saldo 28.600, pendiente) +
    historial [FAC-2026-00002, derivada 'vencida'] — mismos totales que ve el admin
  GET /portal/saldo-favor → {saldoFavor:2000} (coincide con GET /suscriptores/:id/pagos de 007)
  GET /portal/consumo → 1 lectura (0→25 m³)
  GET /portal/facturas/<f1-propia>/pdf → 200 application/pdf (%PDF-, 1859 bytes)

ATAQUES IDOR (sesiones reales de A1, A2 y B1 — tres cookies distintas):
  A2 → PDF de la factura de A1 (ff000000-...0a1):  HTTP 404 bytes=33 (JSON de error, sin PDF)
  A1 → PDF de la factura de A2 (ff000000-...0a2):  HTTP 404 bytes=33
  B1 (OTRO acueducto) → PDF de la factura de A1:    HTTP 404 bytes=33
  CONTROL B1 → PDF de SU propia factura:            HTTP 200 bytes=1529 (%PDF-)
  Listados aislados: A2 solo ve FAC-2026-00003 · A1 solo 00001/00002 · B1 solo 00004
  Sin cookie → /portal/facturas 401 · login con código incorrecto → 401 genérico
  Fuerza bruta (CA-9): 8 fallos → 401×8 · 9.º intento CON 'A-001' → 429 {reintentar_en}
  POST /portal/logout → 200 y la MISMA cookie deja de funcionar (401)
```
**Commit:** (tras completar)

## T-005 — Regenerar código de suscriptor (admin, CA-8)

**Archivos:** `backend/src/lib/suscriptores.ts`, `backend/src/index.ts`
**Hace:** `regenerarCodigoSuscriptor(supabase, clienteId, usuarioServicioId, codigoNuevo)` — `UPDATE`
directo sobre `usuarios_servicio` con el cliente ya autenticado del admin (la RLS existente
`usuarios_servicio_escritura` ya lo permite, plan.md §2 — sin RPC nueva). Ruta
`POST /suscriptores/:id/regenerar-codigo` (`requerirClienteActivo`): `{codigo_nuevo}` → 200
`{suscriptor}`; 409 si el código ya existe en el cliente (`unique (cliente_id, codigo_suscriptor)`);
el `lector` recibe 403 (RLS, no solo la interfaz).
**Verificación:**
```bash
# admin A autenticado (cookie de sesión administrativa)
curl -sS --noproxy '*' -b cookie_admin_a -X POST localhost:8787/suscriptores/<A2-id>/regenerar-codigo \
  -H 'Content-Type: application/json' -d '{"codigo_nuevo":"A-002-NUEVO"}' -w '\nHTTP %{http_code}\n'
# login del portal con el código viejo (debe fallar) y con el nuevo (debe funcionar)
curl -sS --noproxy '*' -X POST localhost:8787/portal/acueducto-a/login -d '{"numero_documento":"1000000002","codigo_suscriptor":"A-002"}' -w '\nHTTP %{http_code}\n'
curl -sS --noproxy '*' -X POST localhost:8787/portal/acueducto-a/login -d '{"numero_documento":"1000000002","codigo_suscriptor":"A-002-NUEVO"}' -w '\nHTTP %{http_code}\n'
# lector A intentando regenerar código → 403
curl -sS --noproxy '*' -b cookie_lector_a -X POST localhost:8787/suscriptores/<A1-id>/regenerar-codigo -d '{"codigo_nuevo":"X"}' -w '\nHTTP %{http_code}\n'
# repetir el código de otro suscriptor del mismo cliente → 409
```
**Resultado esperado:** regenerar código funciona para el admin (200); el login viejo deja de servir
(401), el nuevo funciona (200); el `lector` rechazado con 403; duplicar un código existente en el
mismo cliente → 409.
CORRECCIÓN del resultado esperado original con evidencia (D-10): una sesión de portal obtenida ANTES
del cambio NO recibe 401 (el JWT sigue siendo válido), pero las funciones del portal revalidan
`numero_documento`+`codigo_suscriptor` en cada llamada, así que con el código viejo la sesión deja de
ver datos (facturaActual null, historial []) — la regeneración invalida DE FACTO el acceso de la
sesión previa, que es más seguro que lo previsto originalmente ("el JWT no lleva el código"; el plan
008 §4/§5 lo amplió para llevarlo por D-10).
**Estado:** Completado (2026-09-08)
**Evidencia:**
```
$ npx tsc --noEmit → sin salida · $ npx eslint → sin salida
$ npx wrangler deploy --dry-run -c wrangler.toml → OK

Con wrangler dev :8787 (admin A y lector A con sesión administrativa; portal A2):
  POST /suscriptores/<A2>/regenerar-codigo {A-002-NUEVO} (admin) → 200 {suscriptor.codigo_suscriptor: A-002-NUEVO}
  login portal con 'A-002' (viejo) → 401 {error:'Credenciales incorrectas'}
  login portal con 'A-002-NUEVO' → 200 {sesion codigoSuscriptor: A-002-NUEVO}
  POST /suscriptores/<A1>/regenerar-codigo (LECTOR) → 403
    {error:'No autorizado: solo el administrador...'}  (chequeo de membresía + RLS)
  POST /suscriptores/<A2>/regenerar-codigo {A-001} (duplicado) → 409
    {error:'Ese código ya existe en este acueducto'}
  Sesión portal de A2 emitida ANTES del cambio (cookie válida, cod A-002):
    GET /portal/facturas → 200 {facturaActual:null, historial:[]} — sin 401 pero SIN datos
    (D-10 revalida el código en cada llamada → la regeneración invalida de facto)
  Admin vuelve a regenerar (A-002-FINAL) → 200 (sigue operativo)
  Al final se restauró A2 a 'A-002' en la base local.
```
**Commit:** (tras completar)

## T-006 — Frontend: login, página del portal y botón de regenerar código (CA-10)

**Archivos:** `frontend/middleware.ts`, `frontend/lib/api.ts`,
`frontend/app/portal/[slug]/login/page.tsx` (crear), `frontend/app/portal/[slug]/page.tsx` (crear),
`frontend/app/app/suscriptores/[id]/page.tsx` (editar)
**Hace:** `middleware.ts`: matcher `/portal/:slug/:path*` que exige la cookie `uc_sesion_suscriptor`
salvo en `/portal/:slug/login`, redirige ahí si falta (independiente del matcher `/app/:path*`
existente). `api.ts`: tipos y funciones `loginPortal`, `logoutPortal`, `obtenerFacturasPortal`,
`obtenerSaldoFavorPortal`, `obtenerConsumoPortal`, `urlPdfFacturaPortal`, `regenerarCodigoSuscriptor`.
Página `/portal/[slug]/login`: formulario `numero_documento` + `codigo_suscriptor`, mensaje de error
genérico. Página `/portal/[slug]`: factura actual (monto/vencimiento/estado), historial, saldo a
favor, historial de consumo, enlace de descarga de PDF por factura, botón salir. Detalle de
suscriptor (admin): botón "Regenerar código" (pide el código nuevo, confirma antes de enviar).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint . && npm test
npx wrangler deploy --dry-run -c wrangler.toml
cd frontend && npm run build && npm run lint && npx tsc --noEmit
```
**Resultado esperado:** `build`/`lint`/`tsc` limpios (páginas nuevas del portal y el botón de
suscriptores compilan); `wrangler deploy --dry-run` sin errores. Verificado con evidencia real que la
sesión de suscriptor y la de administrador NUNCA se mezclan en el navegador (cookies con nombres
distintos + middleware por área). El flujo click-a-click queda "NO VERIFICADO — requiere validación
manual de Mateo: [pasos exactos]" si el entorno no permite `next dev` + `wrangler dev` (la API ya
quedó verificada en T-004/T-005 vía curl).
**Estado:** Completado (2026-09-08)
**Evidencia:**
```
$ npx tsc --noEmit (frontend) → sin salida
$ npx next build → ✓ Compiled successfully (12 páginas + Middleware 34.3 kB) · lint OK
$ npx wrangler deploy --dry-run -c wrangler.toml → OK

Cambios: middleware.ts matcher ['/app/:path*','/portal/:slug/:path*'] con cookies DISTINTAS
(uc_sesion_admin para /app; uc_sesion_suscriptor para /portal, salvo /portal/:slug/login);
api.ts (loginPortal, logoutPortal, obtenerFacturasPortal, obtenerSaldoFavorPortal,
obtenerConsumoPortal, urlPdfFacturaPortal, regenerarCodigoSuscriptor); páginas
/portal/[slug]/login y /portal/[slug]; botón "Regenerar código" en el detalle del suscriptor.

SEPARACIÓN DE SESIONES verificada con curl contra next dev (:3000) con cookies REALES
emitidas por el backend (login portal A1 y login admin A):
  /portal/acueducto-a/login sin cookie           → 200 (login público)
  /portal/acueducto-a SIN cookie                 → 307 → /portal/acueducto-a/login
  /portal/acueducto-a con cookie SUSCRIPTOR      → 200 (el suscriptor ve el portal)
  /portal/acueducto-a con cookie ADMIN SOLO      → 307 → /portal/acueducto-a/login
        (un admin NO ve el portal como si fuera suscriptor)
  /app SIN cookie                                → 307 → /login
  /app con cookie SUSCRIPTOR SOLO                → 307 → /login
        (un suscriptor NO ve el panel admin)
  /app/facturacion con cookie ADMIN              → 200 (el admin ve su área)
  AMBAS cookies a la vez: /portal/acueducto-a → 200 y /app/facturacion → 200
        (cada middleware usa SOLO su cookie; nunca se confunden)

El flujo click-a-click (formularios/prompt) NO se ejecutó en navegador: pasos para Mateo =
next dev (:3000) + wrangler dev (:8787) → abrir /portal/acueducto-a/login, ingresar con
1000000001/A-001, ver factura/saldo/consumo/PDF y Salir; luego /login del admin y regenerar
el código de un suscriptor.
```
**Commit:** (tras completar)

## T-007 — Cierre: CHANGELOG + checklist CLAUDE.md §11

**Archivos:** `CHANGELOG.md`, `specs/008-portal-suscriptor/spec.md` (checklist §8)
**Hace:** Entrada de CHANGELOG (Sesión 015) y checklist de `spec.md §8` con evidencia real. Queda
documentado el pendiente de Mateo (flujo click-a-click; la lógica del portal quedó verificada por
SQL/RPC + curl contra Supabase local).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint . && npm test
npx wrangler deploy --dry-run -c wrangler.toml
cd frontend && npm run build && npm run lint
for f in 001_fundacion 002_catalogo 003_suscriptores 004_lecturas_consumo 005_facturacion 006_correo_factura 007_pagos 008_portal; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/${f}_aislamiento.sql
done
```
**Resultado esperado:** builds/tests/aislamientos en verde sobre el estado final; evidencia pegada.
**Estado:** Completado (2026-09-03)
**Evidencia:**
```
CHANGELOG.md — Sesión 015: 008-portal-suscriptor completa (T-001 a T-007), con D-10, la desviación
  de portal_cliente_por_slug y el hallazgo de la sesión previa sin datos al regenerar (CA-8/D-10).
spec.md §8 — checklist completo con evidencia (CA-1..CA-10) y la lista de commits de la feature.

Regresión completa desde cero:
  $ supabase db reset --local → Finished · 9 migraciones aplicadas (001→009)
  fixtures 001-008 (fundacion..portal) → todos COMMIT
  aislamientos 001-008 → todos OK (001..007 = 1 · 008 = PORTAL-AISLAMIENTO OK;
    el PASO 1 del 008 se actualizó a 6 funciones portal por la migración 009/T-004)

Estado final verificado:
  - npm test (backend) → 90 tests OK · tsc/eslint limpios
  - wrangler deploy --dry-run → OK (Total Upload 1725.97 KiB / gzip 393.26 KiB)
  - next build (frontend) → 12 páginas + Middleware 34.3 kB (T-006)
```
**Commit:** (tras completar)
