# TASKS — 028: rol-secretaria

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit. Los hashes van en la Bitácora de cierre (T-007).

## T-001 — Migración: rol, `es_staff_de()`, políticas de solo lectura ampliada
**Archivos:** `supabase/migrations/20260923090000_rol-secretaria.sql` (parte 1)
**Hace:** `alter type rol_usuario add value 'secretaria'`; `es_staff_de()` (con `rol::text` por la
restricción transaccional de PostgreSQL); políticas SELECT nuevas
en `facturas`, `factura_detalles`, `tarifas`, `cortes_reconexiones`, `notificaciones`.
**Verificación:** aplicar contra Postgres descartable desde cero (mismo método de 023-027) +
`select count(*) from facturas` con sesión de `secretaria` de A → filas de A visibles.
**Estado:** COMPLETADO — verificación real: reset local desde cero + fixtures; `ROL-SECRETARIA-AISLAMIENTO OK`.

## T-002 — Migración: escritura ampliada (`usuarios_servicio`, importación, reemplazos)
**Archivos:** `supabase/migrations/20260923090000_rol-secretaria.sql` (parte 2)
**Hace:** amplía a `es_staff_de` las políticas de `usuarios_servicio`, `importaciones_suscriptores`,
`reemplazos_contador` y `contadores`; redefine las guardas internas de `importar_suscriptores()` y
`reemplazar_contador()` para no bloquear a `secretaria`.
**Verificación:** `secretaria` de A puede `INSERT`/`UPDATE` en `usuarios_servicio` de A; `secretaria`
de B no puede tocar filas de A.
**Estado:** COMPLETADO — verificación real dentro de `015`: insert/update/importación y aislamiento A/B.

## T-003 — Migración: `pagos`/`pago_aplicaciones` separados por comando + trigger de `facturas`
**Archivos:** `supabase/migrations/20260923090000_rol-secretaria.sql` (parte 3)
**Hace:** políticas nuevas de lectura/insert para staff en `pagos`/`pago_aplicaciones`; acota
`pagos_admin` de `ALL` a `UPDATE, DELETE`; política `facturas_staff_actualiza` (UPDATE, staff);
redefine `registrar_pago()` con `es_staff_de()` y actualiza `bloquear_factura_inmutable()` para
exigir `es_admin_de` en la rama de anulación. `anular_pago()` permanece solo para admin.
**Verificación:** con sesión de `secretaria` de A: `registrar_pago()` completo (INSERT en pagos +
pago_aplicaciones + UPDATE de facturas.total_pagado) funciona; `anular_pago()` falla; un intento
directo de `UPDATE facturas SET estado='anulada'` falla con el mensaje de rol, no con el de motivo.
**Estado:** COMPLETADO — verificación real dentro de `015`: registro completo, anulaciones bloqueadas y regresión admin.

## T-004 — Backend: guard explícito en anular factura/pago
**Archivos:** `backend/src/index.ts`
**Hace:** `POST /facturas/:id/anular`, `POST /pagos/:id/anular`, `POST /suscriptores/:id/corte` y
`POST /suscriptores/:id/reconexion` devuelven `403` explícito para `secretaria` antes de tocar la base.
**Verificación:** `cd backend && npm run build && npm run lint && npm test` — 217/217 tests.
**Estado:** COMPLETADO

## T-005 — Frontend: ocultar acciones exclusivas de `admin_acueducto`
**Archivos:** `frontend/components/panel/sidebar-panel.tsx`, `frontend/app/app/dashboard/page.tsx`,
`frontend/app/app/facturacion/page.tsx`, `frontend/app/app/facturacion/[facturaId]/page.tsx`,
`frontend/app/app/lecturas/page.tsx`, `frontend/app/app/suscriptores/[id]/page.tsx`.
**Hace:** oculta Configuración, indicadores, anulación, emisión masiva, revisión de lecturas y
corte/reconexión cuando `rol === 'secretaria'`; conserva las tareas permitidas, incluida la gestión
administrativa del contador.
**Verificación:** `cd frontend && npm run build && npm run lint && npx tsc --noEmit` — todo verde.
**Estado:** COMPLETADO

## T-006 — Test de aislamiento 015 + verificación de integración real
**Archivos:** `tests/aislamiento/015_rol_secretaria_aislamiento.sql`
**Hace:** toda la matriz principal del spec contra PostgreSQL real, incluyendo registro de pago,
anulaciones, acciones admin-only, regresión y aislamiento A/B.
**Verificación:** reset local desde cero + fixtures 001-006 +
`psql ... -f tests/aislamiento/015_rol_secretaria_aislamiento.sql` → `ROL-SECRETARIA-AISLAMIENTO OK`.
**Estado:** COMPLETADO. Pendiente manual: curl contra `wrangler dev`/`next dev` y navegador real.

## T-007 — Cierre: PLAN-PRODUCCION.md, CHANGELOG, checklist completo
**Archivos:** `docs/PLAN-PRODUCCION.md`, `CHANGELOG.md`
**Hace:** marca "rol secretaria" resuelto en el pendiente consolidado; entrada de CHANGELOG;
Bitácora de cierre; checklist de CLAUDE.md §11.
**Verificación:**
```
cd backend && npm test && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
(regresión completa de las 18+1 suites de aislamiento)
```
**Estado:** COMPLETADO — evidencia documental añadida; la validación visual/integración real queda pendiente de Mateo.
