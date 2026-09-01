# TASKS — 001: Fundación

**Plan aprobado:** 2026-09-01 (plan.md commit `5ee6ce9`)
**Spec aprobado:** 2026-08-31

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9).

---

## Notas de entorno y prerrequisitos

- **Supabase local:** requiere Docker con el plugin `docker compose` v2. Verificado el 2026-09-01: Docker
  29.1.3 con daemon OK, pero **falta el plugin compose** (ni `docker compose` ni `docker-compose`).
  Instalarlo antes de T-001: `sudo apt install docker-compose-plugin` (Ubuntu) o el binario oficial de
  Compose v2. Hasta no tenerlo, las tareas de base de datos quedan **NO VERIFICADAS**.
- **Credenciales de Mateo (despliegue real, no bloquean las tareas locales):**
  - Cloudflare: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` → `wrangler deploy` real de los 4 Workers
    y `wrangler r2` (bucket `undreocol-backups`).
  - GitHub: `SUPABASE_DB_URL` (Session Pooler, puerto 6543), `CLOUDFLARE_ACCOUNT_ID`,
    `CLOUDFLARE_API_TOKEN` → ejecutar `backup-diario.yml` (CA-10).
  - Supabase: proyecto Free creado por Mateo (dev usa el CLI local; el proyecto remoto es para los Workers
    y el backup).
- **Flujo de verificación de cada tarea:** primero la migración y el aislamiento (CA-1/2/7/8/9 de
  esquema), luego backend, luego frontend, luego el workflow, y por último el flujo manual (CA-11).
- Orden del roadmap según `.specify/config.md`: esta feature queda en estado "plan aprobado, pendiente
  /tasks" hasta el commit de `tasks.md`.

---

## T-001 — Entorno Supabase local (init + reset de referencia)

**Archivos:** `supabase/config.toml` (generado por `supabase init`), ajustes de `.gitignore` si aplican
**Hace:** Inicializa el proyecto Supabase local y confirma que la migración actual (secciones 1–9) aplica
de cero (referencia para CA-3).
**Verificación:**
```bash
supabase init && supabase start && supabase db reset
```
**Resultado esperado:** `supabase db reset` termina sin errores; el esquema de la fundación se reconstruye
completo sin intervención manual.
**Estado:** Completado (2026-09-01)
**Evidencia:**
```
supabase init → "Finished supabase init."
supabase start → 12 contenedores Up (healthy): supabase_db, rest, auth, kong, storage, realtime, ...
                DB: postgresql://postgres:postgres@127.0.0.1:54322/postgres
supabase db reset → "Finished supabase db reset on branch main." EXIT=0
Verificación psql: 6 tablas (clientes, configuracion, membresias, perfiles, planes, usuarios_servicio)
                  6/6 con RLS+FORCE = true
```
**Commit:** `71f7da3`

## T-002 — Migración: §10 onboarding transaccional + §11 soporte D-7

**Archivos:** `supabase/migrations/20260831150000_fundacion-tenancy.sql`
**Hace:** Añade `crear_tenant_con_admin()` (SECURITY DEFINER, grants a `authenticated`) y la sección D-7
(`_keepalive` singleton con RLS+FORCE sin políticas, `tamano_base_mb()` con revoke a
anon/authenticated y grant a `service_role`). Actualiza el comentario de cabecera (referencia al plan
nuevo).
**Verificación:**
```bash
supabase db reset
psql "$DATABASE_URL" -c "select id, ultimo_ping from _keepalive;"
psql "$DATABASE_URL" -c "\df public.tamano_base_mb"
psql "$DATABASE_URL" -c "\df public.crear_tenant_con_admin"
```
**Resultado esperado:** reset OK; fila singleton en `_keepalive`; ambas funciones definidas con sus
grants (anon/authenticated revocados de `tamano_base_mb`).
**Estado:** Completado (2026-09-01)
**Evidencia:**
```
supabase db reset → "Finished supabase db reset on branch main." EXIT=0
_keepalive: (1, 2026-09-01 03:30:58+00) — fila singleton
\df: crear_tenant_con_admin(text,text,text) volatile; tamano_base_mb() stable
tamano_base_mb: EXECUTE solo postgres y service_role (revoke a anon, authenticated, public)
  anon → ERROR: permission denied for function tamano_base_mb
  service_role → 10.91 MB
crear_tenant_con_admin: EXECUTE solo authenticated/service_role/postgres
```
**Commit:** `c662cc7`

## T-003 — Test de aislamiento: pasos 12–14 + brechas de CA-2

**Archivos:** `tests/aislamiento/001_fundacion_aislamiento.sql`
**Hace:** Añade PASO 12 (CA-8 de esquema: `_keepalive` con RLS+FORCE, cero políticas, singleton,
simulación del worker con `set local role service_role`), PASO 13 (CA-9 de esquema: `tamano_base_mb()`
>0, permisos anon/authenticated denegados, % vs 500 MB < 80%), PASO 14 (CA-7: `crear_tenant_con_admin`
crea cliente+membresía+configuración; slug duplicado y usuario con acueducto → error sin huérfanos) y
amplía el PASO 9 con las 2 brechas de CA-2 (rol `administrador` para otro perfil de A; `update` de
`clientes.plan_id/estado_cuenta` sin efecto). Actualiza la cabecera del script (referencias al plan).
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/001_fundacion_aislamiento.sql
```
**Resultado esperado:** salida con `FUNDACION-AISLAMIENTO OK` cubriendo pasos 2–14. Esto cierra CA-1,
CA-2, CA-7 y el soporte de esquema de CA-8 y CA-9.
**Estado:** Completado (2026-09-01)
**Evidencia:**
```
psql fixture → BEGIN ... COMMIT (2 planes, 2 clientes, 5 perfiles, 5 membresias,
               2 configuraciones, 3 usuarios_servicio). EXIT=0
psql aislamiento → pasos 2–14 en verde → "FUNDACION-AISLAMIENTO OK". EXIT=0
Correcciones incluidas: 4 RAISE con parámetro sin placeholder (preexistentes, PASO 7/10/11),
  anon lee _keepalive 0 filas (RLS filtra, no error), PASO 14 separado en DO blocks
  (subtransacción del handler) y conteo de huérfanos como postgres (bypasa RLS).
```
**Commit:** (este commit)

## T-004 — Backend base: scaffolding Hono + `GET /salud`

**Archivos:** `backend/package.json`, `backend/tsconfig.json`, `backend/wrangler.toml`,
`backend/.env.example`, `backend/.gitignore`, `backend/src/index.ts`, `backend/src/lib/db.ts`
**Hace:** Proyecto Hono en TypeScript estricto con `wrangler.toml` para el Worker `undreocol-api`, CORS
(only `ALLOWED_ORIGIN`, `credentials: true`), `GET /salud` que verifica conectividad con Supabase usando
el cliente **anon** (nunca `service_role`), y los dos constructores de cliente (`crearClienteSuscriptor`,
`crearClienteServicio`).
**Verificación:**
```bash
cd backend && npm ci
npm run lint
npx wrangler deploy --dry-run -c wrangler.toml
npx wrangler dev -c wrangler.toml &   # con Supabase local arriba
curl -s -i http://localhost:8787/salud
```
**Resultado esperado:** lint limpio; `deploy --dry-run` exitoso; `/salud` → `200 {"estado":"ok"}` (y el
origen CORS configurado responde el header correcto).
**Estado:** Completado (2026-09-01)
**Evidencia:**
```
npm run lint → LINT_EXIT=0
npm run build (tsc --noEmit) → BUILD_EXIT=0
wrangler deploy --dry-run → Total Upload: 770.86 KiB / gzip: 152.65 KiB; DRYRUN_EXIT=0
wrangler dev + curl /salud →
  HTTP/1.1 200 OK
  Access-Control-Allow-Origin: http://localhost:3000
  Access-Control-Allow-Credentials: true
  {"estado":"ok"}
Nota: compatibility_date fijada en 2026-05-03 (máx. del runtime local de wrangler 4.86.0).
```
**Commit:** (este commit)

## T-005 — Backend auth: sesión administrativa + contrato del suscriptor

**Archivos:** `backend/src/lib/auth.ts`, `backend/src/lib/sesion-suscriptor.ts`, rutas en
`backend/src/index.ts`
**Hace:** Implementa la sesión administrativa con cookie HttpOnly `uc_sesion_admin` (rutas
`POST /auth/registro`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/recuperar`,
`GET /auth/sesion` con refresco del token) y declara el contrato reservado de la sesión del suscriptor
(funciones que lanzan `ErrorSesionSuscriptorPendiente`).
**Verificación:**
```bash
cd backend && npm run lint && npx wrangler deploy --dry-run -c wrangler.toml
# flujo manual contra Supabase local (dev): registro → login → /auth/sesion → logout
curl -s -X POST http://localhost:8787/auth/registro -H 'Content-Type: application/json' -d '{"email":"admin-a@test.local","password":"clave-segura"}'
curl -s -i -c /tmp/cookies.txt -X POST http://localhost:8787/auth/login -d '{"email":"admin-a@test.local","password":"clave-segura"}'
curl -s -i -b /tmp/cookies.txt http://localhost:8787/auth/sesion
curl -s -i -b /tmp/cookies.txt -c /tmp/cookies.txt -X POST http://localhost:8787/auth/logout
```
**Resultado esperado:** cookie `uc_sesion_admin` en `/tmp/cookies.txt`; `/auth/sesion` devuelve el perfil
autenticado; logout limpia la cookie. Credenciales inválidas → error explícito en español.
**Estado:** Completado (2026-09-01)
**Evidencia:**
```
npm run lint → 0 | npm run build (tsc) → 0 | wrangler deploy --dry-run → gzip 155.39 KiB
POST /auth/registro admin-d@test.local → 201 {"ok":true,"usuarioId":"e3da5e3b-..."}
POST /auth/login → 200 {sesion:{tipo:administrativa,...}, perfil:null, membresias:[]}
  Set-Cookie: uc_sesion_admin=...; HttpOnly; Secure; SameSite=Lax; Max-Age=604800
GET  /auth/sesion → 200 (misma sesión)
POST /auth/login con password incorrecta → 401 {"error":"Credenciales inválidas"}
POST /auth/logout → 200 {"ok":true}; GET /auth/sesion tras logout → 401 "No autenticado"
```
**Commit:** (este commit)

## T-006 — Backend onboarding + dashboard

**Archivos:** `backend/src/lib/tenant.ts`, rutas `POST /onboarding` y `GET /dashboard` en
`backend/src/index.ts`
**Hace:** `resolverClienteActivo(perfilId)` (1 cliente → activo; 0 → onboarding; varios → lista);
onboarding vía `rpc('crear_tenant_con_admin')`; `GET /dashboard` con nombre del acueducto, nombre/rol del
usuario y conteo de `usuarios_servicio`.
**Verificación:**
```bash
cd backend && npm run lint && npx wrangler deploy --dry-run -c wrangler.toml
# con sesión de un usuario nuevo (sin acueducto)
curl -s -i -b /tmp/cookies.txt -X POST http://localhost:8787/onboarding -H 'Content-Type: application/json' -d '{"nombre":"Acueducto A","slug":"acueducto-a"}'
# slug duplicado
curl -s -i -b /tmp/cookies.txt -X POST http://localhost:8787/onboarding -d '{"nombre":"Acueducto A","slug":"acueducto-a"}'
# dashboard
curl -s -b /tmp/cookies.txt http://localhost:8787/dashboard
```
**Resultado esperado:** onboarding `201 {clienteId}`; slug duplicado → `409` (o 400) y **sin huérfanos**
(verificar conteos con `psql` antes/después); `/dashboard` devuelve el payload del spec §4.7.
**Estado:** Completado (2026-09-01)
**Evidencia:**
```
npm run lint → 0 | npm run build (tsc) → 0 | wrangler deploy --dry-run → gzip 155.99 KiB
POST /auth/registro admin-e@test.local → 201; login → 200
POST /onboarding {nombre:"Acueducto E", slug:"acueducto-e"} → 201 {"clienteId":"4ae18ae4-..."}
GET  /dashboard → 200 {cliente:{clienteId,rol:"admin_acueducto",nombre:"Acueducto E"},
                        perfil:{...,nombre:"Acueducto E"}, conteoUsuariosServicio:0}
POST /onboarding 2ª vez (mismo usuario) → 409 "El usuario ya tiene un acueducto"
POST /onboarding admin-f con slug "acueducto-e" → 409 "El slug ya está en uso"
GET  /dashboard admin-f (sin acueducto) → 400 "Sin acueducto" clientes:[]
BD: cliente acueducto-e tiene membresía admin_acueducto y su configuracion (sin huérfanos);
    total clientes = 3 (A, B y E)
```
**Commit:** (este commit)

## T-007 — Cron keepalive (CA-8)

**Archivos:** `backend/src/cron/keepalive.ts`, `backend/wrangler.keepalive.toml`
**Hace:** Worker `undreocol-keepalive` (cron diario `0 5 * * *`) que actualiza `_keepalive.ultimo_ping`
con el cliente de servicio y **lanza excepción si el update falla o afecta 0 filas** (falla visible en
logs).
**Verificación:**
```bash
cd backend && npx wrangler dev --test-scheduled -c wrangler.keepalive.toml
psql "$DATABASE_URL" -c "select ultimo_ping, now() as ahora from _keepalive;"
```
**Resultado esperado:** el log del Worker muestra el ping; `ultimo_ping` queda ≈ `ahora` (CA-8 con
evidencia). El despliegue real (`wrangler deploy -c wrangler.keepalive.toml`) y el secreto
`SUPABASE_SERVICE_ROLE_KEY` requieren a Mateo → **NO VERIFICADO** hasta entonces.
**Estado:** Pendiente
**Evidencia:**
```
<salida de wrangler dev --test-scheduled + consulta psql>
```
**Commit:** (tras completar)

## T-008 — Cron monitor-db + unit test (CA-9)

**Archivos:** `backend/src/cron/monitor-db.ts`, `backend/wrangler.monitor-db.toml`,
`backend/tests/unit/monitor-db.test.ts`
**Hace:** Función pura `calcularNivel(tamanoMb)` (porcentaje vs 500 MB y nivel en 300/400/480 MB) con su
test unit; Worker `undreocol-monitor-db` (cron diario `30 5 * * *`) que llama `tamano_base_mb()`, loguea
el resultado y dispara la **alerta stub** (console.error + TODO Email Service) si `nivel >= alerta`.
**Verificación:**
```bash
cd backend && npx vitest run
npx wrangler dev --test-scheduled -c wrangler.monitor-db.toml
psql "$DATABASE_URL" -c "select public.tamano_base_mb() as mb;"
```
**Resultado esperado:** tests verdes (100→ok, 300→atencion, 400→alerta, 480→critico); salida del Worker
con MB y % (CA-9). Despliegue real con secreto `SUPABASE_SERVICE_ROLE_KEY` → requiere Mateo
(**NO VERIFICADO** hasta entonces).
**Estado:** Pendiente
**Evidencia:**
```
<salida de vitest run + wrangler dev --test-scheduled + psql>
```
**Commit:** (tras completar)

## T-009 — Cron limpieza (base, D-7)

**Archivos:** `backend/src/cron/limpieza.ts`, `backend/wrangler.limpieza.toml`
**Hace:** Base del Worker `undreocol-limpieza` (cron semanal `0 6 * * 0`): verificación de conexión y log
de "sin tablas que purgar". Los objetivos de purga (sesiones, auditoría, trabajos, notificaciones) quedan
documentados para la feature 015.
**Verificación:**
```bash
cd backend && npx wrangler dev --test-scheduled -c wrangler.limpieza.toml
```
**Resultado esperado:** ejecución OK con el log de la base; sin errores. Despliegue real → requiere Mateo.
**Estado:** Pendiente
**Evidencia:**
```
<salida de wrangler dev --test-scheduled>
```
**Commit:** (tras completar)

## T-010 — Frontend base: Next.js 15 + Tailwind + shadcn (CA-6, parte frontend)

**Archivos:** `frontend/package.json`, `frontend/tsconfig.json`, `frontend/next.config.ts`,
`frontend/postcss.config.mjs`, `frontend/tailwind.config.ts`, `frontend/eslint.config.mjs`,
`frontend/.env.example`, `frontend/.gitignore`, `frontend/components.json`, `frontend/app/layout.tsx`,
`frontend/app/globals.css`, `frontend/app/page.tsx`, `frontend/components/ui/{button,input,card,label}.tsx`
**Hace:** Proyecto Next.js 15 (App Router, TS estricto) con el adaptador `@opennextjs/cloudflare`, Tailwind
CSS y los componentes shadcn/ui **solo usados** (button, input, card, label). Layout raíz y redirección a
`/login`.
**Verificación:**
```bash
cd frontend && npm ci && npm run build
```
**Resultado esperado:** build sin errores ni warnings de TypeScript (CA-6, parte frontend).
**Nota:** verificar en `/implement` que la versión instalada de `@opennextjs/cloudflare` es compatible con
Next 15 y sigue vigente (riesgo del plan §10). Si no es viable: **detener y reportar** (decisión de Mateo).
**Estado:** Pendiente
**Evidencia:**
```
<salida de npm run build>
```
**Commit:** (tras completar)

## T-011 — Frontend auth: login + middleware + api (CA-4, CA-5)

**Archivos:** `frontend/app/login/page.tsx`, `frontend/components/login-form.tsx`, `frontend/lib/api.ts`,
`frontend/middleware.ts`
**Hace:** Página de login con formulario cliente que llama a `POST /auth/login` (fetch con credentials),
wrapper `api.ts` (nunca `@supabase/*`) y `middleware.ts` que protege `/app/*` (sin cookie →
`/login`).
**Verificación:**
```bash
cd frontend && npm run build
grep -rn "@supabase" frontend/app/ frontend/components/   # CA-4
grep -rn "SERVICE_ROLE" frontend/                          # CA-5
```
**Resultado esperado:** build OK; ambos grep devuelven **cero resultados** (CA-4 y CA-5 con salida pegada).
**Estado:** Pendiente
**Evidencia:**
```
<salida de build + de ambos grep>
```
**Commit:** (tras completar)

## T-012 — Frontend onboarding + dashboard protegido

**Archivos:** `frontend/app/onboarding/page.tsx`, `frontend/components/onboarding-form.tsx`,
`frontend/app/app/layout.tsx`, `frontend/app/app/dashboard/page.tsx`
**Hace:** Formulario de creación del acueducto (`POST /onboarding`) y dashboard server component que llama
a `GET /dashboard` (nombre del acueducto, nombre/rol, conteo de `usuarios_servicio`). Sin acueducto →
`/onboarding`; con sesión → `/app/dashboard`.
**Verificación:**
```bash
cd frontend && npm run build
# flujo manual en navegador contra wrangler dev (backend) + next dev (frontend):
# registro → onboarding → dashboard → logout → login → dashboard
```
**Resultado esperado:** build OK; flujo completo navegable en local (prepara CA-11).
**Estado:** Pendiente
**Evidencia:**
```
<salida de build + captura del flujo>
```
**Commit:** (tras completar)

## T-013 — Workflow de backup diario (CA-10)

**Archivos:** `.github/workflows/backup-diario.yml`
**Hace:** Workflow con `schedule` diario + `workflow_dispatch`: `pg_dump --format=custom --no-owner`
vía **Session Pooler** (`SUPABASE_DB_URL`, puerto 6543) en contenedor `postgres:16-alpine`, comprime con
`gzip`, sube a R2 (`wrangler r2 object put undreocol-backups/...`) y documenta la retención de 30 días
(lifecycle de R2).
**Verificación:**
```bash
# 1) sintaxis YAML (local)
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/backup-diario.yml')); print('YAML OK')"
# 2) CA-10 (requiere secretos de GitHub, los pone Mateo): workflow_dispatch → listado
npx wrangler r2 object list undreocol-backups
```
**Resultado esperado:** YAML OK; tras `workflow_dispatch`, el listado de R2 muestra `undreocol-backup-<fecha>-<sha>.sql.gz` con su tamaño. **NO VERIFICADO** hasta que Mateo configure los secretos
(`SUPABASE_DB_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) y el bucket `undreocol-backups` con
su regla lifecycle.
**Estado:** Pendiente
**Evidencia:**
```
<salida de validación YAML + listado R2>
```
**Commit:** (tras completar)

## T-014 — Restaurar `docs/INFRAESTRUCTURA.md` (D-10)

**Archivos:** `docs/INFRAESTRUCTURA.md`
**Hace:** Reemplaza el contenido actual (copia corrupta de `ARQUITECTURA.md`) por el documento operativo
con las secciones referenciadas en todo el repo: §1 monitor de uptime (UptimeRobot), §5 keepalive (ping
diario, excepción si falla), §6 backup diario a R2 (Session Pooler, retención 30 días, restauración), §7
ritual mensual de restauración, §8 monitoreo de tamaño 300/400/480 MB, §9 limpieza semanal, §10 sesión
del portal (D-4), §11 cierre de facturación en Queues, §12 portabilidad. Consistente con D-7 y
`ESTRATEGIA-CALIDAD.md`.
**Verificación:** revisión del documento: cada sección referenciada por CLAUDE.md/DECISIONES.md/spec
existe y coincide con los valores de D-7 (300/400/480, retención 30 días, Session Pooler).
**Resultado esperado:** el documento operativo vuelve a ser la fuente de la configuración operativa.
**Estado:** Pendiente
**Evidencia:**
```
<revisión de secciones / diff>
```
**Commit:** `docs:` (tras completar)

## T-015 — Cierre: CHANGELOG + flujo manual CA-11 + push

**Archivos:** `CHANGELOG.md`
**Hace:** Actualiza `CHANGELOG.md` con la feature completa; documenta y ejecuta el flujo manual CA-11
(registro → onboarding → dashboard → logout → login → dashboard) — **requiere a Mateo en el navegador**;
verifica el checklist de "terminado" de CLAUDE.md §11; entrega el comando de push.
**Verificación:** checklist de CLAUDE.md §11 completo, con la salida de cada verificación pegada. Evidencia
final de CA-11 por Mateo.
**Resultado esperado:** los 11 CA con evidencia; `CHANGELOG.md` actualizado; todos los commits de la
feature hechos.
**Estado:** Pendiente
**Evidencia:**
```
<checklist completo con salidas>
```
**Commit:** (tras completar)

---

### Resumen de commits planeados (uno por tarea)

| Tarea | Tipo de commit | CA que cierra |
|---|---|---|
| T-001 | `chore(001-fundacion): entorno supabase local` | CA-3 (referencia) |
| T-002 | `feat(001-fundacion): migración onboarding transaccional y soporte D-7` | CA-3 |
| T-003 | `test(001-fundacion): aislamiento cubre CA-7/8/9 y brechas de CA-2` | CA-1, CA-2, CA-7 |
| T-004 | `feat(001-fundacion): backend Hono con ruta de salud` | — |
| T-005 | `feat(001-fundacion): sesión administrativa y contrato de suscriptor` | — |
| T-006 | `feat(001-fundacion): onboarding y dashboard` | — |
| T-007 | `feat(001-fundacion): worker keepalive` | CA-8 |
| T-008 | `feat(001-fundacion): worker monitor-db con unit test` | CA-9 |
| T-009 | `feat(001-fundacion): worker de limpieza (base)` | — |
| T-010 | `feat(001-fundacion): frontend Next.js con OpenNext` | CA-6 |
| T-011 | `feat(001-fundacion): login, middleware y api wrapper` | CA-4, CA-5 |
| T-012 | `feat(001-fundacion): onboarding y dashboard en frontend` | — |
| T-013 | `ci(001-fundacion): backup diario a R2` | CA-10 (con Mateo) |
| T-014 | `docs(001-fundacion): restaura INFRAESTRUCTURA.md (D-10)` | — |
| T-015 | `docs(001-fundacion): CHANGELOG y cierre de la feature` | CA-11 (con Mateo) |

**Definición de terminado de `tasks.md`:** aprobación explícita de Mateo de este documento antes de
ejecutar T-001 (flujo SDD: `/tasks → tasks.md → [CHECKPOINT] → /implement`).

