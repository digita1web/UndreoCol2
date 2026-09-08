# TASKS — 018: panel-plataforma

**Spec aprobado:** 2026-09-08 (decisiones §0.3 = alta directa, §0.4 = ruta `/plataforma`)
**Plan aprobado:** 2026-09-08 (incluida la decisión §5.1: sin transacción atómica única entre
`auth.users` y Postgres, orden de pasos que minimiza el daño de un fallo a mitad de camino)
**Alcance confirmado:** solo el mecanismo de alta directa con contraseña temporal. La invitación por
correo (Opción A de la spec §0.3) queda **fuera de 018**, para una feature futura (019) cuando haga
falta — decisión explícita de Mateo en conversación, no se construye aquí.

Una tarea = un commit. Sin evidencia no hay commit (`CLAUDE.md §4` y §9). La IA no hace `push` salvo
autorización expresa de Mateo (§9.1). Los hashes van en la Bitácora de cierre (T-007), no en cada
tarea (mismo criterio que 011 y 017: escribir el propio hash dentro del commit es circular).

---

## Notas de entorno y prerrequisitos

- **Origen:** petición directa de Mateo + dos hallazgos de esta sesión (no existe panel de plataforma;
  bug en `resolverClienteActivo`). Es **prerrequisito de producción**: sin esto, dar de alta el
  acueducto piloto solo se puede hacer por SQL manual (lo que se hizo una vez, como excepción, para
  bootstrapear el superadmin).
- **Base de datos local:** mismo método que 017 — PostgreSQL 16 nativo (no hay Docker ni CLI de
  Supabase aquí), cluster propio con roles `anon`/`authenticated`/`service_role` (`BYPASSRLS`),
  esquema `auth` mínimo con `auth.uid()` leyendo `request.jwt.claim.sub`, y los *default privileges*
  reales de Supabase. Las migraciones aplican de cero y las suites de aislamiento corren sobre él.
- **Diferencia importante respecto de 017: esta sesión SÍ tiene acceso de escritura a la base de
  producción real** (`undreocol-produccion`, `dutudjchhhmqadjowibj`, vía MCP de Supabase) y a la
  cuenta de Cloudflare (vía MCP, pero **sin** una herramienta de despliegue — solo lectura de
  Workers/D1/R2/KV). Aun así, **se mantiene la misma disciplina que en las 5 migraciones aplicadas
  antes en esta sesión**: todo se construye y verifica primero contra el clúster local; la aplicación
  a producción real es un paso aparte, explícito, y solo con autorización expresa de Mateo en la
  conversación en el momento — no se hereda de "aplica todo ahora" de una tarea anterior (§9.1).
- **`wrangler dev` real sigue sin ser viable aquí** (no hay CLI de Wrangler autenticada ni forma de
  levantar el Worker localmente en este entorno). El extremo HTTP real (`curl` contra el Worker
  desplegado) queda **NO VERIFICADO — requiere validación manual de Mateo**, con los pasos exactos.
- **Regresión obligatoria** en toda tarea que toque `backend/src/`: `npx vitest run` completo, más
  `npm run build` (tsc), `npm run lint` y `npx wrangler deploy --dry-run -c wrangler.toml`. En toda
  tarea que toque el esquema: todas las migraciones desde cero + las suites de aislamiento 001-012,
  900, 901, 902 y 903, método canónico de la Sesión 026.
- **Frontend:** `npm run build`/`npm run lint` siguen **NO VERIFICABLES en este contenedor**
  (`xlsx` desde `cdn.sheetjs.com`, bloqueado por el proxy — mismo bloqueo documentado en 017 T-006).
  Se compensa con `tsc --strict` sobre los archivos nuevos y, donde aplique, ejecución real de la
  lógica pura extraída a una función.
- **Lección de C-1, aplicable a T-001:** las dos funciones nuevas son `security invoker`, no
  `definer` (plan §2) — precisamente para no tener superficie de "identificador desnudo" que auditar.
  Se audita igual: ninguna debe funcionar si el llamante no es `es_admin_plataforma()` vía RLS.
- **Orden de dependencia:** T-001 (esquema) bloquea T-002 (aislamiento) y T-003 (`lib/plataforma.ts`).
  T-004 (`lib/tenant.ts`) es independiente de T-001/T-003 pero bloquea T-005 (rutas, que usa
  `esAdminPlataforma`). T-003 también bloquea T-005. T-005 bloquea T-006 (frontend, consume las
  rutas nuevas y el campo nuevo del 400). T-007 cierra.

---

## T-001 — Migración: política `perfiles_alta_plataforma` + 2 funciones

**Archivos:** `supabase/migrations/20260919090000_panel-plataforma.sql` (crear)
**Hace:** (plan §2) Política `perfiles_alta_plataforma on perfiles for insert with check
(es_admin_plataforma())` — el único permiso que le faltaba al superadmin en las 4 tablas. Funciones
`crear_acueducto_base(p_nombre_cliente text, p_slug text) returns uuid` y
`asignar_admin_acueducto(p_cliente_id uuid, p_usuario_id uuid, p_nombre text, p_email text) returns
void`, ambas `security invoker set search_path = public` (NO `definer`: RLS ya autoriza todo lo que
tocan). `revoke all ... from public, anon` + `grant execute ... to authenticated` en las dos, por
higiene y consistencia con B-3, aunque la protección real la da RLS.

**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260919090000_panel-plataforma.sql
psql "$DATABASE_URL" -c "select polname, polcmd, polqual from pg_policy where polrelid = 'perfiles'::regclass;"
psql "$DATABASE_URL" -c "select proname, prosecdef, proconfig, has_function_privilege('public', oid, 'EXECUTE') as publico,
                                 has_function_privilege('anon', oid, 'EXECUTE') as anon,
                                 has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated
                            from pg_proc where proname in ('crear_acueducto_base','asignar_admin_acueducto');"
```
**Resultado esperado:** migración EXIT=0; `perfiles` tiene 3 políticas (`perfiles_lectura`,
`perfiles_update_propio`, `perfiles_alta_plataforma` — esta última `INSERT`); las 2 funciones con
`prosecdef = f` (invoker), `publico = f`, `anon = f`, `authenticated = t`.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-002 — Suite de aislamiento `903`

**Archivos:** `tests/aislamiento/903_panel_plataforma_aislamiento.sql` (crear)
**Hace:** (plan §8) Los 6 pasos: `perfiles` sigue sin `insert` para nadie salvo `es_admin_plataforma()`
(CA-2); un `admin_acueducto` de un cliente cualquiera no logra ejecutar ninguna de las 2 funciones con
efecto real, aunque tenga `EXECUTE` — RLS lo bloquea igual (CA-2); un superadmin real crea
`clientes`+`configuracion` con `crear_acueducto_base`, y un slug duplicado falla limpio sin dejar
residuo (CA-1, CA-5); `asignar_admin_acueducto` crea `perfiles`+`membresias` correctos para un
`usuario_id` de prueba (CA-1); el admin nuevo, con su propia sesión, ve solo su acueducto (CA-4);
con solo la membresía `administrador`, `resolverClienteActivo` (probado vía SQL equivalente a su
consulta) da `lista=[]` (CA-3, ver también T-004).
Serie 900+ porque 018, igual que 017, no está en el roadmap original (plan §1).

**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/903_panel_plataforma_aislamiento.sql
for f in 001..012 900 901 902 903; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/$f*.sql; done
```
**Resultado esperado:** `PANEL-PLATAFORMA-AISLAMIENTO OK`; regresión completa en verde, cero en rojo.
**Prueba de que la suite sirve:** romper a propósito cada guarda (quitar la política nueva; usar
`security definer` sin guarda equivalente; usar un slug repetido sin capturar la excepción) y
confirmar que el paso correcto falla; restaurar y confirmar verde.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-003 — `lib/plataforma.ts` y sus tests unitarios

**Archivos:** `backend/src/lib/plataforma.ts` (crear), `backend/tests/unit/plataforma.test.ts` (crear)
**Hace:** (plan §4) `generarContrasenaTemporal()` (Web Crypto, 20 caracteres, alfabeto sin
ambigüedad visual); `crearAcueductoBase`, `signUpAdminAcueducto` (`crearClienteAnon`, nunca
`service_role` — CLAUDE.md §12), `asignarAdminAcueducto` — las tres lanzan tal cual el error de la
RPC/GoTrue, sin envolver ni silenciar (`CLAUDE.md §7`, sin `catch` vacío).

**Verificación:**
```bash
cd backend
npx vitest run tests/unit/plataforma.test.ts
npx vitest run
npm run build && npm run lint
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** tests nuevos en verde (Supabase falso, patrón de
`cierre-facturacion-tenant.test.ts`); suite completa en verde; tsc, lint, dry-run EXIT=0;
`generarContrasenaTemporal` sin colisiones en 1000 llamadas y sin caracteres ambiguos.
**Prueba de que los tests sirven:** invertir el propagado-de-error a silencioso y confirmar que caen
los tests que lo vigilan.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-004 — `lib/tenant.ts`: corregir `resolverClienteActivo` (cierra el bug de esta sesión)

**Archivos:** `backend/src/lib/tenant.ts` (editar)
**Hace:** (plan §4, §5.2) Excluye `cliente_id IS NULL` de `lista`/`activo`; agrega
`esAdminPlataforma: boolean` al resultado. Campo aditivo: se revisan los dos únicos callers
(`index.ts:290` y `:329`, verificado en plan §0) para confirmar que desestructurar `{ activo, lista }`
sigue compilando sin tocarlos todavía (T-005 sí los toca).

**Verificación:**
```bash
cd backend
npx vitest run tests/unit/tenant.test.ts   # si no existe, se crea aquí: caso con solo membresía
                                            # 'administrador' -> lista=[], activo=null, esAdminPlataforma=true
npx vitest run && npm run build && npm run lint
```
**Resultado esperado:** el caso nuevo en verde; suite completa sin regresión; tsc/lint EXIT=0.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-005 — Rutas: `GET /dashboard` (editar), `GET /plataforma`, `POST /plataforma/acueductos`

**Archivos:** `backend/src/index.ts` (editar)
**Hace:** (plan §3) Agrega `esAdminPlataforma` al `400 Sin acueducto` de `GET /dashboard`. Helper
`requerirAdminPlataforma` (mismo patrón que `requerirClienteActivo`, `index.ts:322`). `GET
/plataforma`: lista de `clientes`. `POST /plataforma/acueductos`: valida body, ejecuta el orden de 3
pasos del plan §3 (`crearAcueductoBase` → `signUpAdminAcueducto` → `asignarAdminAcueducto`), devuelve
`201` con la contraseña temporal **una sola vez** o el error correspondiente en cada paso (incluido el
mensaje de "acueducto creado sin administrador" si falla después del paso 1, plan §5.1).

**Verificación:**
```bash
cd backend
npx vitest run tests/unit/plataforma-rutas.test.ts   # nuevo: 401/403/201/400 de las 2 rutas,
                                                       # con app.fetch real y dependencias sustituidas
                                                       # (mismo método que auth-login-limite.test.ts de 017)
npx vitest run && npm run build && npm run lint
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** casos nuevos en verde: sin sesión → 401; sesión sin rol plataforma → 403;
alta completa → 201 con `clienteId`/`contrasenaTemporal`; slug duplicado → 400 sin tocar Auth; fallo
en `signUp` → 500 con el mensaje de "sin administrador"; `GET /dashboard` con solo membresía
`administrador` → 400 con `esAdminPlataforma: true`. Suite completa sin regresión.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**NO VERIFICADO — requiere validación manual de Mateo (con `wrangler dev`/Worker desplegado +
Supabase real):**
```bash
curl -s -X POST http://localhost:8787/plataforma/acueductos \
  -H 'Content-Type: application/json' -H "Cookie: uc_sesion_admin=<cookie del superadmin>" \
  -d '{"nombre":"Acueducto Prueba","slug":"acueducto-prueba","nombreAdmin":"Admin Prueba","correoAdmin":"admin-prueba-2@undreocol.app"}'
```
debe devolver `201` con `contrasenaTemporal`; un login inmediato con esa contraseña debe devolver
`200` con `membresias` conteniendo `rol: 'admin_acueducto'` del acueducto recién creado.
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-006 — Frontend: `/plataforma` y redirección desde el dashboard

**Archivos:** `frontend/app/app/dashboard/page.tsx` (editar), `frontend/app/plataforma/page.tsx`
(crear), `frontend/components/plataforma-form.tsx` (crear)
**Hace:** (plan §5.5) `dashboard/page.tsx`: si el `400` trae `esAdminPlataforma: true`, redirige a
`/plataforma` en vez de `/onboarding`. `plataforma/page.tsx`: server component, mismo patrón que
`dashboard/page.tsx` (lee la cookie, llama al backend, `401` → `/login`, `403` → mensaje de no
autorizado). `plataforma-form.tsx`: client component con `useHidratado()` y
`disabled={!hidratado || cargando}` (`CLAUDE.md §7`), muestra la contraseña temporal devuelta **una
sola vez** tras el alta exitosa.

**Verificación:**
```bash
cd frontend
npm run build && npm run lint      # NO VERIFICABLE aquí, ver notas de entorno
grep -n "hidratado" components/plataforma-form.tsx
tsc --noEmit --strict --lib ES2022,DOM --types node <archivos nuevos que sean TS puro>
```
**Resultado esperado:** `disabled={!hidratado || cargando}` presente; type-check estricto de lo que
sea verificable aquí EXIT=0.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**NO VERIFICADO — `npm run build`/`npm run lint` del frontend, requiere Mateo** (mismo bloqueo de
`cdn.sheetjs.com` documentado en 017 T-006).
**NO VERIFICADO — comprobación visual en navegador real, requiere Mateo:** login del superadmin lleva
a `/plataforma`; el formulario crea un acueducto y muestra la contraseña temporal una sola vez; el
admin nuevo, con esa contraseña, entra a su propio `/app/dashboard`.
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-007 — Cierre: documentación y checklist

**Archivos:** `specs/018-panel-plataforma/spec.md` (CA-1 a CA-5 con su evidencia o su NO VERIFICADO),
`docs/ESPECIFICACION-FUNCIONAL.md` (párrafo nuevo sobre el panel de plataforma), `.specify/config.md`
(fila 018 con la nota de prerrequisito de producción, y una fila 019 reservada para "invitación por
correo (Opción A descartada en 018 §0.3)" en estado Pendiente, para no perder la decisión), `CHANGELOG.md`,
este `tasks.md` (bitácora).
**Hace:** Cierra la feature. Dado que el bootstrap del superadmin ya se hizo por SQL manual esta
misma sesión (antes de que existiera este panel), se documenta ese hecho aquí como parte de la
trazabilidad, no como una tarea de esta feature.
**Verificación:** revisión del diff completo + checklist de `CLAUDE.md §11` punto por punto.
**Resultado esperado:** ningún punto de §11 sin marcar o sin justificar por qué no aplica.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## Bitácora de cierre

| Tarea | Commit | Estado |
|---|---|---|
| T-001 migración: política + 2 funciones | — | Pendiente |
| T-002 suite de aislamiento 903 | — | Pendiente |
| T-003 `lib/plataforma.ts` | — | Pendiente |
| T-004 `lib/tenant.ts` (fix del bug) | — | Pendiente |
| T-005 rutas `/dashboard`, `/plataforma` | — | Pendiente |
| T-006 frontend `/plataforma` | — | Pendiente |
| T-007 cierre | — | Pendiente |

### Pendiente de Mateo (se completa según avancen las tareas)

1. Alta real de un acueducto vía `curl` contra el Worker desplegado + Supabase real (T-005).
2. Login del admin nuevo con la contraseña temporal, confirmando `rol: 'admin_acueducto'` (T-005).
3. `npm run build`/`npm run lint` del frontend en un entorno con acceso a `cdn.sheetjs.com` (T-006).
4. Comprobación visual completa en navegador: superadmin → `/plataforma` → alta → login del admin
   nuevo → su propio dashboard (T-006).
5. Aplicar la migración `20260919090000_panel-plataforma.sql` a producción real — solo con
   autorización expresa en el momento (§9.1), no automática.
