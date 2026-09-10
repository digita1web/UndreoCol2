# TASKS — 024: permisos-lector

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit.

## T-001 — Migración: elimina 10 políticas de lectura sobre-amplias + función `usuarios_servicio_lector`
**Archivos:** `supabase/migrations/20260921090000_permisos-lector.sql`
**Hace:** `drop policy` de las 10 `_lectura` (facturas, factura_detalles, pagos,
pago_aplicaciones, tarifas, configuracion, cortes_reconexiones, notificaciones,
importaciones_suscriptores, reemplazos_contador, usuarios_servicio); crea
`usuarios_servicio_lector(p_cliente_id, p_estado)`.
**Verificación:**
```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260921090000_permisos-lector.sql
-- lector de A: 0 filas en las 10 tablas
-- admin_acueducto de A: mismos conteos que antes (regresión)
-- usuarios_servicio_lector(cliente A) desde lector: filas de A, 5 columnas
```
**Estado:** Hecho
**Evidencia:**
```
Aplicada contra Postgres 17 descartable, desde cero, junto a las otras 20 migraciones — sin error.

Lector de A (jwt sub a2): facturas=0, factura_detalles=0, pagos=0, pago_aplicaciones=0, tarifas=0,
configuracion=0, cortes_reconexiones=0, notificaciones=0, importaciones_suscriptores=0,
reemplazos_contador=0, usuarios_servicio=0  (11/11 en cero)

Admin de A (jwt sub a1), regresión — mismos conteos que antes de 024:
  facturas=9, pagos=8, tarifas=1, configuracion=1, usuarios_servicio=6

usuarios_servicio_lector('cliente A') desde lector de A: 6 filas, solo
  {id, codigo_suscriptor, nombre, contador_actual_id, estado} — sin PII
usuarios_servicio_lector('cliente B') desde lector de A: 0 filas (aislamiento intacto)

Aplicada también con `supabase migration up --local --yes` sobre el Supabase local con fixtures.
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-002 — Backend: `listarSuscriptores` usa la RPC para `lector`
**Archivos:** `backend/src/lib/suscriptores.ts`, `backend/src/index.ts`
**Hace:** `listarSuscriptores(supabase, clienteId, estado?, soloLector?)`: si `soloLector`, llama
`usuarios_servicio_lector` en vez de `.from('usuarios_servicio')`, mapea a la forma `Suscriptor`
con los campos sensibles en `null`. `GET /suscriptores` pasa `ctx.rol === 'lector'`.
**Verificación:** `cd backend && npx tsc --noEmit && npx vitest run`
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit   → sin errores
$ npx vitest run     → 215 passed (20 archivos)
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-003 — Backend: guard de rol en las 4 rutas de facturación por cola
**Archivos:** `backend/src/index.ts`
**Hace:** `POST /facturacion/periodos/:id/simular`, `.../emitir`, `.../enviar-correo`, `POST
/facturas/:id/enviar-correo`: `if (ctx.rol !== 'admin_acueducto') return c.json({error:...}, 403)`,
mismo patrón que `GET /dashboard/indicadores`.
**Verificación:** `cd backend && npx tsc --noEmit && npx vitest run && npx wrangler deploy --dry-run`
**Estado:** Pendiente

## T-004 — Test de aislamiento 014
**Archivos:** `tests/aislamiento/014_permisos_lector_aislamiento.sql`
**Hace:** los 4 pasos de plan.md §8, contra PostgreSQL real, con la prueba de que el test SIRVE
(relajar algo a propósito, ver caer el paso, restaurar).
**Verificación:** `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/014_permisos_lector_aislamiento.sql`
**Estado:** Pendiente

## T-005 — Verificación de integración real (wrangler dev + next dev)
**Archivos:** ninguno (solo verificación)
**Hace:** confirma con sesiones reales (`admin-a@test.local`, y un `lector` real de A) que: `GET
/suscriptores` con lector devuelve solo 5 campos; las 4 rutas de facturación dan `403` a lector y
funcionan igual para admin; `/app/lecturas` arma su desplegable igual que antes.
**Verificación:** curl real contra `wrangler dev` + carga real de `/app/lecturas` contra `next dev`.
**Estado:** Pendiente

## T-006 — Cierre: PLAN-PRODUCCION.md, CHANGELOG, regresión completa
**Archivos:** `docs/PLAN-PRODUCCION.md`, `CHANGELOG.md`
**Hace:** marca M-2 y M-2b resueltos con su evidencia; entrada de CHANGELOG; corre la definición de
"terminado" completa (spec §8).
**Verificación:**
```
cd backend && npm test && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
psql "$DATABASE_URL" -f (las 18 suites de aislamiento, regresión completa)
```
**Estado:** Pendiente
