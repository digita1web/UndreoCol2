# TASKS — 029: autorización temporal de tarifas para `secretaria`

Una tarea = un commit. Sin evidencia no hay commit.

## T-001 — Esquema, RLS y RPC de autorización de un solo uso

**Archivo:** `supabase/migrations/20260924090000_autorizacion-tarifas-secretaria.sql`

Crear tablas de autorizaciones y bitácora, políticas RLS, índices de unicidad de
autorizaciones abiertas y `usar_autorizacion_tarifa()`.

**Estado:** COMPLETADO — migración aplicada desde cero; `AUTORIZACION-TARIFAS-AISLAMIENTO OK`.

## T-002 — API

**Archivos:** `backend/src/index.ts`, `backend/src/lib/catalogo.ts`

Crear/listar/revocar autorizaciones y aplicar una tarifa autorizada. Mantener el
endpoint directo de tarifa exclusivo para admin/superadmin.

**Estado:** COMPLETADO — build/lint y 217/217 tests backend en verde.

## T-003 — Frontend

**Archivos:** `frontend/lib/api.ts`, `frontend/components/tarifa-form.tsx`,
`frontend/app/app/catalogo/[servicioId]/page.tsx`

Admin crea/revoca autorizaciones; secretaria selecciona una autorización vigente
y ejecuta el cambio; todos ven historial de tarifas.

**Estado:** COMPLETADO — lint, TypeScript y build frontend en verde.

## T-004 — Aislamiento y cierre

**Archivos:** `tests/aislamiento/016_autorizacion_tarifas_aislamiento.sql`,
`CHANGELOG.md`

Cubrir expiración, revocación, uso único, cruce de tenant, admin, superadmin y
bitácora inmutable.

**Estado:** COMPLETADO — suite SQL 016 en verde; pendiente solo revisión visual manual y flujo multiacueducto visual del superadmin.