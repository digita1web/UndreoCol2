# TASKS — 003: suscriptores-contadores

**Plan aprobado:** 2026-09-01 (plan.md commit `3a32763`)
**Spec aprobado:** 2026-09-01 (spec.md commit `1f5d4d0`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9).

---

## Notas de entorno y prerrequisitos

- **Mismo entorno que 002:** este contenedor no tiene Docker funcional ni PostgREST. La verificación
  de esquema/RLS/funciones se hace contra PostgreSQL 16 nativo con el shim de compatibilidad ya usado
  en 002 (`auth.uid()` vía GUC, roles `anon`/`authenticated`/`service_role`). Las rutas HTTP (curl
  real contra `wrangler dev`) y el flujo en navegador quedan "NO VERIFICADO — requiere validación
  manual de Mateo" si el contenedor de turno sigue sin esas piezas, con los pasos exactos.
- **Orden de verificación:** migración + aislamiento primero (bloquea todo lo demás), luego backend,
  luego frontend, luego cierre. No hay `core/` nuevo en esta feature (plan.md §4).
- **Riesgo señalado en el plan (§0 y §5):** `usuarios_servicio` ya tiene filas de los fixtures de
  001/002. T-001 corre explícitamente contra esos fixtures para confirmar que la migración no los
  rompe, no solo contra una base vacía.

---

## T-001 — Migración: `usuarios_servicio` ampliada, `contadores`, `reemplazos_contador`, `reemplazar_contador()`, RLS

**Archivos:** `supabase/migrations/20260902090000_suscriptores-contadores.sql`
**Hace:** `ALTER TABLE usuarios_servicio ADD COLUMN` (10 columnas nuevas, nullable — plan.md §5);
enum `estado_contador`; tabla `contadores` con índice único parcial de contador activo y su trigger
`updated_at`; `ALTER TABLE usuarios_servicio ADD CONSTRAINT fk_contador_actual`; tabla
`reemplazos_contador` (`ON DELETE RESTRICT` en ambos contadores); función `reemplazar_contador()`
(`SECURITY INVOKER`, `SELECT FOR UPDATE` sobre `usuarios_servicio`); RLS `FORCE` + políticas en
`contadores`/`reemplazos_contador` reutilizando `es_admin_de()`/`mis_clientes()`/`es_admin_plataforma()`.
**Verificación:**
```bash
# aplicar 001 + 002 primero, luego los fixtures existentes, luego esta migración
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260831150000_fundacion-tenancy.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260901120000_catalogo-y-tarifas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/catalogo.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260902090000_suscriptores-contadores.sql
psql "$DATABASE_URL" -c "select count(*) from usuarios_servicio;"   # debe seguir en 3 (fixture 001)
psql "$DATABASE_URL" -c "\d usuarios_servicio"
psql "$DATABASE_URL" -c "\d contadores"
psql "$DATABASE_URL" -c "\d reemplazos_contador"
psql "$DATABASE_URL" -c "\df public.reemplazar_contador"
psql "$DATABASE_URL" -c "select relname, relforcerowsecurity from pg_class where relname in ('contadores','reemplazos_contador');"
```
**Resultado esperado:** la migración aplica sobre una base con datos existentes sin perder filas de
`usuarios_servicio`; las 3 tablas y la función quedan con la forma del plan; RLS `FORCE` en ambas
tablas nuevas.
**Estado:** Completado (2026-09-02) — con desviación de entorno, ver evidencia
**Evidencia:**
```
Mismo entorno de 002 (PostgreSQL 16 nativo + shim, sin Docker/PostgREST en este contenedor).

001 + 002 + fixtures de 001/002 + 003 aplican en secuencia, EXIT=0.
select count(*) from usuarios_servicio antes de 003: 3. Después: 3 (sin pérdida de filas).
Las 3 filas del fixture conservan codigo_suscriptor/nombre/estado; columnas nuevas quedan NULL
  (numero_documento, categoria, etc.) tal como se esperaba de columnas NULLABLE agregadas sobre
  filas existentes.

\d usuarios_servicio: 10 columnas nuevas, todas NULLABLE salvo fecha_vinculacion (default
  current_date); FK fk_contador_actual ON DELETE SET NULL.
\d contadores: uq_contador_activo (único parcial WHERE estado='activo'), chk_capacidad,
  FK usuario_servicio_id ON DELETE RESTRICT, trigger trg_contadores_updated.
\d reemplazos_contador: chk_distintos, ambas FKs de contador ON DELETE RESTRICT.
reemplazar_contador: security_type=INVOKER, EXECUTE revocado anon/public, otorgado authenticated.
relforcerowsecurity: contadores=t, reemplazos_contador=t.

Pendiente para Mateo: repetir `supabase db reset` en un entorno con Docker para la verificación
oficial completa (mismo pendiente que 002 T-001).
```
**Commit:** `f7053c8`

## T-002 — Fixtures + test de aislamiento (CA-2, CA-5)

**Archivos:** `tests/fixtures/suscriptores.sql`, `tests/aislamiento/003_suscriptores_aislamiento.sql`
**Hace:** Fixture con suscriptores y contadores de ejemplo para los acueductos A y B (reutiliza
`usuarios_servicio` de `tests/fixtures/fundacion.sql`, les agrega los datos ampliados y un contador
activo a cada uno). Test de aislamiento cubriendo:
1. Acueducto A no lee/escribe suscriptores, contadores ni reemplazos de B por `SELECT`/`INSERT` directo.
2. `reemplazar_contador()` llamado por admin A sobre un `usuario_servicio_id` de B falla con "no existe".
3. Dos llamadas sucesivas a `reemplazar_contador()` para el mismo suscriptor dejan exactamente un
   contador `activo` (CA-5); intento de `INSERT` directo de un segundo contador `activo` para el
   mismo suscriptor viola `uq_contador_activo`.
4. Rol `lector` no puede escribir en `usuarios_servicio` (ya cubierto en 001, se re-verifica con las
   columnas nuevas), `contadores` ni `reemplazos_contador`.
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/suscriptores.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/003_suscriptores_aislamiento.sql
```
**Resultado esperado:** ambos scripts en verde, terminan con `SUSCRIPTORES-AISLAMIENTO OK`.
**Estado:** Completado (2026-09-02)
**Evidencia:**
```
Mismo entorno de T-001. Reconstrucción completa desde cero (001+002+003+grants+fixtures 001/002/003)
antes de correr el test, para validar el archivo final tal cual queda commiteado.

tests/aislamiento/003_suscriptores_aislamiento.sql → 7 pasos en verde → "SUSCRIPTORES-AISLAMIENTO OK".
Regresión: 001_fundacion_aislamiento.sql → "FUNDACION-AISLAMIENTO OK";
           002_catalogo_aislamiento.sql → "CATALOGO-AISLAMIENTO OK" (sin romper nada).

HALLAZGO REAL (no anticipado en el plan): PASO 5 mostró que reemplazar_contador() nunca llega a
su propio chequeo es_admin_de() cuando lo llama un lector del MISMO acueducto — no por un bug,
sino porque PostgreSQL aplica la política RLS de ESCRITURA (usuarios_servicio_escritura, que
exige es_admin_de()) a la cláusula SELECT ... FOR UPDATE, no la de lectura. Confirmado
directamente: un SELECT plano de lector A sobre un suscriptor de A devuelve la fila; el mismo
SELECT ... FOR UPDATE devuelve 0 filas. El mensaje real es "no existe", no "No autorizado" como
asumía el plan/test original — corregido el test para reflejarlo, y se agregó un comentario en
la migración (T-001, mismo commit) explicando por qué el chequeo es_admin_de() queda como
defensa adicional en vez de ruta principal para este caso.

Pendiente para Mateo: repetir contra Supabase local real (mismo pendiente que T-001).
```
**Commit:** `6203a60`

## T-003 — Backend: `lib/suscriptores.ts` + CRUD de suscriptores

**Archivos:** `backend/src/lib/suscriptores.ts`, `backend/src/index.ts`
**Hace:** Acceso a datos: listar/crear/obtener/actualizar suscriptor (rechaza `codigo_suscriptor` en
el PATCH). Rutas `GET/POST /suscriptores`, `GET/PATCH /suscriptores/:id`.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** `tsc`/`eslint` sin errores; el Worker sigue empaquetando.
**Estado:** Completado (2026-09-02) — implementada junto con T-004, mismo archivo, ver evidencia
**Evidencia:**
```
$ npx tsc --noEmit → sin salida, sin errores
$ npx eslint .     → sin salida, sin errores
$ npx wrangler deploy --dry-run -c wrangler.toml
  Total Upload: 803.22 KiB / gzip: 158.87 KiB — sin errores

Nota de alcance: se quitó una ruta GET /suscriptores/:id/contadores que no estaba en plan.md §3
(6 rutas exactas) — GET /suscriptores/:id ya devuelve el contador activo y el historial de
reemplazos, que es lo que pide spec.md §3.4; se eliminó la función historialContadores() de
lib/suscriptores.ts por quedar sin uso tras esa corrección.
```
**Commit:** `42305e2`

## T-004 — Backend: alta de contador + reemplazo (CA-4)

**Archivos:** `backend/src/lib/suscriptores.ts`, `backend/src/index.ts`
**Hace:** Añade a `lib/suscriptores.ts` el alta de contador y la llamada RPC a
`reemplazar_contador()`. Rutas `POST /suscriptores/:id/contador`,
`POST /suscriptores/:id/reemplazar-contador`.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** igual que T-003.
**Estado:** Completado (2026-09-02) — implementada junto con T-003, mismo commit
**Evidencia:**
```
Misma corrida que T-003 (un solo tsc/eslint/dry-run cubre ambas rutas nuevas del mismo archivo).
```
**Commit:** `42305e2`

## T-005 — Frontend: `lib/api.ts` — funciones de suscriptores y contadores

**Archivos:** `frontend/lib/api.ts`
**Hace:** Añade `listarSuscriptores`, `crearSuscriptor`, `obtenerSuscriptor`, `actualizarSuscriptor`,
`crearContador`, `reemplazarContador`, mismo wrapper `peticion<T>()` existente.
**Verificación:**
```bash
cd frontend && npx tsc --noEmit
grep -rn "@supabase" frontend/app/ frontend/components/ frontend/lib/
```
**Resultado esperado:** `tsc` sin errores; el `grep` de `@supabase` no encuentra ningún `import`
real (el comentario de cabecera de `lib/api.ts` sigue siendo el único match esperado, como en 002 T-006).
**Estado:** Completado (2026-09-02)
**Evidencia:**
```
$ npx tsc --noEmit → sin salida, sin errores
$ grep -rn "@supabase" frontend/app/ frontend/components/ frontend/lib/
lib/api.ts:1:// Wrapper fetch hacia la API de Hono (backend/). Nunca importa `@supabase/*`
1 resultado, mismo falso positivo documentado en 002 T-006 (comentario, no import real).
```
**Commit:** `80644ec`

## T-006 — Frontend: `/app/suscriptores` — lista y alta

**Archivos:** `frontend/app/app/suscriptores/page.tsx`, `frontend/components/suscriptor-form.tsx`
**Hace:** Página protegida por el `middleware.ts` existente. Lista suscriptores del acueducto activo
(filtro por estado), formulario de alta.
**Verificación:**
```bash
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** build y lint sin errores ni warnings de TypeScript.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-007 — Frontend: `/app/suscriptores/[id]` — detalle, contador y reemplazo

**Archivos:** `frontend/app/app/suscriptores/[id]/page.tsx`, `frontend/components/contador-form.tsx`,
`frontend/components/reemplazo-contador-form.tsx`
**Hace:** Detalle del suscriptor, edición, contador activo (alta si no tiene), historial de
reemplazos, formulario de reemplazo. Advertencia visible (no bloqueo) si la categoría del suscriptor
no tiene tarifa vigente configurada (consulta `matrizTarifas()` de 002).
**Verificación:**
```bash
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** build y lint sin errores ni warnings de TypeScript.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-008 — Verificación manual end-to-end (CA-6)

**Archivos:** ninguno (solo verificación)
**Hace:** Flujo completo en navegador: login admin → `/app/suscriptores` → crear suscriptor → entrar
al detalle → crear contador → reemplazar contador → ver historial de reemplazos.
**Verificación:**
```bash
cd backend && npx wrangler dev
cd frontend && npm run dev
# navegar manualmente el flujo descrito arriba
```
**Resultado esperado:** el flujo completo funciona sin error visible en ningún paso.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente — si este contenedor no puede levantar wrangler dev + next dev simultáneos contra una base
real, se declara "NO VERIFICADO — requiere validación manual de Mateo" con los pasos exactos de arriba)
```
**Commit:** (no aplica si queda NO VERIFICADO — tarea sin cambios de código)

## T-009 — Cierre: CHANGELOG + checklist CLAUDE.md §11

**Archivos:** `CHANGELOG.md`, `specs/003-suscriptores-contadores/spec.md` (checklist final)
**Hace:** Entrada de CHANGELOG resumiendo T-001 a T-008 (qué se hizo, qué quedó NO VERIFICADO) y la
checklist de "Definición de terminado" de `spec.md §8` marcada con evidencia real.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx wrangler deploy --dry-run -c wrangler.toml
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** los 4 comandos en verde (no hay `vitest` nuevo: 003 no agrega `core/`),
evidencia pegada en el CHANGELOG y en esta tarea.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)
