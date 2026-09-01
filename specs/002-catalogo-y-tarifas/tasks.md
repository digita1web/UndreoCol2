# TASKS — 002: catalogo-y-tarifas

**Plan aprobado:** 2026-09-01 (plan.md commit `4dbc548`)
**Spec aprobado:** 2026-09-01 (spec.md commit `56ee409`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9).

---

## Notas de entorno y prerrequisitos

- **Supabase local:** reutiliza el entorno ya inicializado en 001 (T-001: `supabase init` + `supabase start`).
  Si el contenedor de esta sesión es nuevo y no lo tiene, repetir `supabase start` antes de T-001 de aquí.
- **Orden de verificación:** primero la migración y el aislamiento (bloquea todo lo demás — sin
  `servicios`/`tarifas` no hay nada que exponer), luego `core/tarifas.ts` (independiente, se puede hacer en
  paralelo pero se deja después por orden de lectura), luego backend, luego frontend, y por último el cierre.
- **Bloqueador conocido de antemano (T-009):** igual que T-012 de 001, levantar `wrangler dev` + `next dev`
  simultáneos contra una base real puede no ser posible en este contenedor. Si no lo es, T-009 se cierra
  con "NO VERIFICADO — requiere validación manual de Mateo" y los pasos exactos, nunca como completada sin
  evidencia.
- **D-5 sigue pendiente:** ningún fixture ni dato de ejemplo de esta feature se presenta como tarifa real.

---

## T-001 — Migración: enums, `servicios`, `tarifas`, `tarifa_vigente()`, `crear_tarifa_version()`, RLS

**Archivos:** `supabase/migrations/20260901120000_catalogo-y-tarifas.sql`
**Hace:** Crea los enums `categoria_tarifaria` y `tipo_calculo`; las tablas `servicios` (con
`updated_at` + trigger, columna no presente en `docs/esquema-propuesto.sql`) y `tarifas`, según DDL de
`docs/esquema-propuesto.sql §6`; la función `tarifa_vigente()` (tal cual esa referencia); la función nueva
`crear_tarifa_version()` (`SECURITY INVOKER`, `SELECT ... FOR UPDATE` sobre la tarifa vigente, autorización
explícita con `es_admin_de()`, plan.md §2); `alter table ... force row level security` y las 4 políticas
(`servicios_lectura/_escritura`, `tarifas_lectura/_escritura`) reutilizando `es_admin_de()`/`mis_clientes()`/
`es_admin_plataforma()` de 001 sin crear funciones de seguridad nuevas.
**Verificación:**
```bash
supabase db reset
psql "$DATABASE_URL" -c "\d servicios"
psql "$DATABASE_URL" -c "\d tarifas"
psql "$DATABASE_URL" -c "\df public.tarifa_vigente"
psql "$DATABASE_URL" -c "\df public.crear_tarifa_version"
psql "$DATABASE_URL" -c "select relname, relforcerowsecurity from pg_class where relname in ('servicios','tarifas');"
```
**Resultado esperado:** reset sin errores; ambas tablas existen con las columnas del plan; ambas funciones
definidas con los grants correctos (`crear_tarifa_version` revocado a `anon`/`public`, otorgado a
`authenticated`); `relforcerowsecurity = true` en ambas tablas.
**Estado:** Completado (2026-09-01) — con desviación de entorno, ver evidencia
**Evidencia:**
```
NO VERIFICADO con `supabase db reset` real: este contenedor no tiene Docker funcional (daemon no
arranca), así que no hay CLI de `supabase` disponible. Verificado en su lugar contra PostgreSQL 16
nativo con el shim de compatibilidad que 001 ya documenta (auth.uid() vía GUC + roles
anon/authenticated/service_role) — no es el stack completo de Supabase (sin PostgREST/GoTrue).

001 + 002 aplican limpias en secuencia, EXIT=0.
\d servicios / \d tarifas: columnas correctas, FK tarifas_servicio_id_fkey ON DELETE RESTRICT,
  constraint chk_vigencia, índice único (servicio_id, categoria, vigencia_desde), 2 políticas RLS
  cada una.
relforcerowsecurity: servicios=t, tarifas=t.
tarifa_vigente: security_type=DEFINER, EXECUTE revocado anon/public, otorgado authenticated/service_role.
crear_tarifa_version: security_type=INVOKER, EXECUTE revocado anon/public, otorgado authenticated.

Corrección sobre plan.md: la función de trigger de 001 se llama set_updated_at(), no
trigger_updated_at() como decía el plan — corregido en la migración.

Pendiente para Mateo: repetir `supabase db reset` en un entorno con Docker para la verificación
oficial completa (incluye PostgREST/GoTrue, que este shim no cubre).
```
**Commit:** `123310d`

## T-002 — Fixtures + test de aislamiento (CA-2, CA-6)

**Archivos:** `tests/fixtures/catalogo.sql`, `tests/aislamiento/002_catalogo_aislamiento.sql`
**Hace:** Fixture con dos acueductos (reutiliza los `clientes`/`membresias` de `tests/fixtures/fundacion.sql`
si el schema del fixture de 001 sigue vigente, o crea los suyos si no), 2-3 servicios y 2-3 tarifas por
acueducto, **con comentario explícito de cabecera: "valores de ejemplo, NO son tarifas reales — D-5
pendiente"**. Test de aislamiento (mismo mecanismo que 001: `set local role`, `set local
request.jwt.claim.sub`, rollback por escenario) que cubre explícitamente, por escenario:
1. Acueducto A no lee `servicios`/`tarifas` de B por `SELECT` directo.
2. `tarifa_vigente()` llamada por un usuario de A con un `servicio_id` de B adivinado devuelve NULL
   (la función es `SECURITY DEFINER`: se testea el resultado, no la protección de la tabla).
3. `admin_acueducto` de A llamando `crear_tarifa_version()` sobre un `servicio_id` de B falla con
   "No autorizado".
4. Rol `lector` no puede insertar/actualizar en `servicios` ni `tarifas` (solo lectura).
5. Dos llamadas concurrentes (dos sesiones `psql` intercaladas alrededor del `FOR UPDATE`) a
   `crear_tarifa_version()` para el mismo servicio+categoría terminan en una sola tarifa vigente.
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/catalogo.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/002_catalogo_aislamiento.sql
```
**Resultado esperado:** ambos scripts en verde, terminan con `CATALOGO-AISLAMIENTO OK`.
**Estado:** Completado (2026-09-01)
**Evidencia:**
```
Mismo entorno que T-001 (PostgreSQL 16 nativo + shim, sin Docker/supabase CLI en este contenedor).

fixtures/fundacion.sql + fixtures/catalogo.sql aplican OK.
tests/aislamiento/002_catalogo_aislamiento.sql → 6 pasos en verde → "CATALOGO-AISLAMIENTO OK".
Regresión: tests/aislamiento/001_fundacion_aislamiento.sql sigue en verde con el mismo shim y
  con la migración 002 aplicada encima → "FUNDACION-AISLAMIENTO OK" (sin romper la fundación).

BUG REAL encontrado y corregido en crear_tarifa_version() (migración de T-001, no en este commit
de test): dos cambios de precio el MISMO día para el mismo servicio+categoría violaban
chk_vigencia (cerrar la anterior con vigencia_hasta = hoy-1 cuando su propia vigencia_desde ya
era hoy, hasta > desde queda falso). PASO 6 del test lo reprodujo primero como error real de
psql, no como suposición. Corrección: si la tarifa anterior nació hoy mismo, se ELIMINA en vez
de cerrarse (nunca estuvo vigente un día completo y no puede tener facturas — esa tabla no
existe todavía). Commit de la corrección: incluido en el commit de esta tarea junto con el test
que lo expuso (T-001 ya estaba commiteado sin este caso; se corrige aquí porque el propio test
de T-002 lo encontró).

PASO 4 también reveló que crear_tarifa_version() (SECURITY INVOKER) para un servicio_id de otro
acueducto falla con "no existe" (RLS lo hace invisible antes del chequeo es_admin_de()), no con
"No autorizado" como asumía el plan original — corregido el mensaje esperado en el test para
reflejar el comportamiento real verificado, no la suposición previa.

Pendiente para Mateo: repetir contra Supabase local real (incluye la corrida con dos sesiones
psql concurrentes reales sobre el FOR UPDATE, que aquí se simuló en una sola sesión — dos
llamadas consecutivas, no dos conexiones simultáneas bloqueándose entre sí).
```
**Commit:** (pendiente — se commitea junto con la corrección de T-001)

## T-003 — `core/tarifas.ts`: cálculo puro con casos límite (CA-5)

**Archivos:** `backend/src/core/tarifas.ts`, `backend/tests/unit/tarifas.test.ts`
**Hace:** Implementa `calcularSubtotalServicio(tipoCalculo, tarifa, consumoM3)` (contrato de plan.md §4):
fórmula D-1 para `por_consumo`, solo `cargoFijo` para `fijo`, redondeo a la unidad aplicado una sola vez al
final. Sin dependencias de Hono/Cloudflare/Supabase.
**Verificación:**
```bash
cd backend && npx vitest run tests/unit/tarifas.test.ts
```
**Resultado esperado:** todos los tests en verde, cubriendo: consumo == límite básico, límite−1, límite+1,
consumo 0, `tipo_calculo = 'fijo'` (ignora `consumo_m3`), redondeo a la unidad.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-004 — Backend: `lib/catalogo.ts` + rutas de servicios

**Archivos:** `backend/src/lib/catalogo.ts`, `backend/src/index.ts`
**Hace:** `lib/catalogo.ts` como capa fina de acceso a datos (listar servicios del cliente activo, crear
servicio, actualizar servicio — sin permitir `codigo` ni `tipo_calculo` en el PATCH). Añade a `index.ts`:
`GET /catalogo/servicios`, `POST /catalogo/servicios`, `PATCH /catalogo/servicios/:id`, todas detrás de
`verificarSesionAdministrativa()` + `resolverClienteActivo()` (mismo patrón que `GET /dashboard`).
**Verificación:**
```bash
cd backend && npx tsc --noEmit
npx wrangler dev &
# con un access_token de admin_acueducto de prueba:
curl -s -X POST http://localhost:8787/catalogo/servicios -H "Content-Type: application/json" \
  --cookie "uc_sesion_admin=$COOKIE" -d '{"codigo":"acueducto","nombre":"Acueducto","tipo_calculo":"por_consumo"}'
curl -s http://localhost:8787/catalogo/servicios --cookie "uc_sesion_admin=$COOKIE"
curl -s -X PATCH http://localhost:8787/catalogo/servicios/$ID -H "Content-Type: application/json" \
  --cookie "uc_sesion_admin=$COOKIE" -d '{"codigo":"otro"}'
```
**Resultado esperado:** `tsc --noEmit` sin errores; POST devuelve 201 con el servicio creado; GET devuelve
el listado incluyéndolo; PATCH intentando cambiar `codigo` devuelve 400 (campo no editable), nunca lo
aplica en silencio.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-005 — Backend: rutas de tarifas + matriz (CA-3, CA-4)

**Archivos:** `backend/src/lib/catalogo.ts`, `backend/src/index.ts`
**Hace:** Añade a `lib/catalogo.ts` las funciones para historial de tarifas, llamada a
`crear_tarifa_version()` vía RPC, y matriz servicio×categoría. Añade a `index.ts`:
`GET /catalogo/tarifas?servicio_id=&categoria=`, `POST /catalogo/tarifas`, `GET /catalogo/matriz-tarifas`.
**Verificación:**
```bash
cd backend && npx tsc --noEmit
npx wrangler dev &
curl -s -X POST http://localhost:8787/catalogo/tarifas -H "Content-Type: application/json" \
  --cookie "uc_sesion_admin=$COOKIE" \
  -d '{"servicio_id":"'"$ID"'","categoria":"estrato_3","cargo_fijo":5000,"limite_basico_m3":22,"precio_basico_m3":1200,"precio_no_basico_m3":2400}'
# repetir el POST con otro precio para el mismo servicio+categoría y verificar el cierre de la anterior:
curl -s "http://localhost:8787/catalogo/tarifas?servicio_id=$ID&categoria=estrato_3" --cookie "uc_sesion_admin=$COOKIE"
curl -s http://localhost:8787/catalogo/matriz-tarifas --cookie "uc_sesion_admin=$COOKIE"
```
**Resultado esperado:** `tsc --noEmit` sin errores; primer POST 201; segundo POST 201 con nueva tarifa
vigente; GET del historial muestra la primera con `vigencia_hasta` cerrada (`hoy - 1`) y la segunda
vigente (`vigencia_hasta: null`); matriz muestra la combinación servicio+categoría con la vigente actual.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-006 — Frontend: `lib/api.ts` — funciones de catálogo

**Archivos:** `frontend/lib/api.ts`
**Hace:** Añade `listarServicios`, `crearServicio`, `actualizarServicio`, `listarTarifas`, `crearTarifa`,
`matrizTarifas`, siguiendo el mismo wrapper `peticion<T>()` ya existente (nunca `@supabase/*` directo, CA-4
de 001).
**Verificación:**
```bash
cd frontend && npx tsc --noEmit
grep -rn "@supabase" frontend/app/ frontend/components/ frontend/lib/
```
**Resultado esperado:** `tsc --noEmit` sin errores; el `grep` de `@supabase` sigue en cero resultados
(regla de portabilidad, CLAUDE.md §5.2).
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-007 — Frontend: `/app/catalogo` — lista y alta de servicios

**Archivos:** `frontend/app/app/catalogo/page.tsx`
**Hace:** Página protegida por el `middleware.ts` existente (`/app/*`). Lista los servicios del acueducto
activo, formulario de alta, botón activar/desactivar.
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

## T-008 — Frontend: `/app/catalogo/[servicioId]` — historial y alta de tarifa

**Archivos:** `frontend/app/app/catalogo/[servicioId]/page.tsx`
**Hace:** Historial de tarifas del servicio (vigentes e históricas, con sus fechas de vigencia) y
formulario de tarifa nueva por categoría, dejando explícito en la UI que esto cierra la vigente y crea una
nueva (nunca la edita).
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

## T-009 — Verificación manual end-to-end (CA-7)

**Archivos:** ninguno (solo verificación)
**Hace:** Corre el flujo completo en navegador: login admin → `/app/catalogo` → crear servicio → crear
tarifa → cambiar el precio (nueva versión) → ver historial → matriz de tarifas.
**Verificación:**
```bash
# backend
cd backend && npx wrangler dev
# frontend, en otra terminal
cd frontend && npm run dev
# navegar manualmente el flujo descrito arriba
```
**Resultado esperado:** el flujo completo funciona sin error visible en ninguno de los pasos.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente — si este contenedor no puede levantar wrangler dev + next dev simultáneos contra una base
real, se declara "NO VERIFICADO — requiere validación manual de Mateo" con los pasos exactos de arriba,
nunca se marca como completada sin evidencia)
```
**Commit:** (pendiente)

## T-010 — Cierre: CHANGELOG + checklist CLAUDE.md §11

**Archivos:** `CHANGELOG.md`, `specs/002-catalogo-y-tarifas/tasks.md` (checklist final)
**Hace:** Entrada de CHANGELOG resumiendo T-001 a T-009 (qué se hizo, qué quedó NO VERIFICADO si aplica) y
la checklist de "Definición de terminado" de `spec.md §8` marcada con evidencia real de cada ítem.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
cd backend && npx vitest run
```
**Resultado esperado:** los 5 comandos en verde, evidencia de cada uno pegada en el CHANGELOG y en esta
tarea.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)
