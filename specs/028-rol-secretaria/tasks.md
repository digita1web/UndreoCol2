# TASKS — 028: rol-secretaria

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit. Los hashes van en la Bitácora de cierre (T-007).

## T-001 — Migración: rol, `es_staff_de()`, políticas de solo lectura ampliada
**Archivos:** `supabase/migrations/20260923090000_rol-secretaria.sql` (parte 1)
**Hace:** `alter type rol_usuario add value 'secretaria'`; `es_staff_de()`; políticas SELECT nuevas
en `facturas`, `factura_detalles`, `tarifas`, `cortes_reconexiones`, `notificaciones`.
**Verificación:** aplicar contra Postgres descartable desde cero (mismo método de 023-027) +
`select count(*) from facturas` con sesión de `secretaria` de A → filas de A visibles.
**Estado:** Pendiente

## T-002 — Migración: escritura ampliada (`usuarios_servicio`, importación, reemplazos)
**Archivos:** `supabase/migrations/20260923090000_rol-secretaria.sql` (parte 2)
**Hace:** `alter policy` de `usuarios_servicio_escritura`, `importaciones_suscriptores_escritura`,
`reemplazos_contador_escritura` de `es_admin_de` a `es_staff_de`.
**Verificación:** `secretaria` de A puede `INSERT`/`UPDATE` en `usuarios_servicio` de A; `secretaria`
de B no puede tocar filas de A.
**Estado:** Pendiente

## T-003 — Migración: `pagos`/`pago_aplicaciones` separados por comando + trigger de `facturas`
**Archivos:** `supabase/migrations/20260923090000_rol-secretaria.sql` (parte 3)
**Hace:** políticas nuevas de lectura/insert para staff en `pagos`/`pago_aplicaciones`; acota
`pagos_admin` de `ALL` a `UPDATE, DELETE`; política `facturas_staff_actualiza` (UPDATE, staff);
actualiza `bloquear_factura_inmutable()` para exigir `es_admin_de` en la rama de anulación.
**Verificación:** con sesión de `secretaria` de A: `registrar_pago()` completo (INSERT en pagos +
pago_aplicaciones + UPDATE de facturas.total_pagado) funciona; `anular_pago()` falla; un intento
directo de `UPDATE facturas SET estado='anulada'` falla con el mensaje de rol, no con el de motivo.
**Estado:** Pendiente

## T-004 — Backend: guard explícito en anular factura/pago
**Archivos:** `backend/src/index.ts`
**Hace:** `POST /facturas/:id/anular` y `POST /pagos/:id/anular` devuelven `403` explícito para
`secretaria` antes de tocar la base.
**Verificación:** `cd backend && npx tsc --noEmit && npx vitest run`
**Estado:** Pendiente

## T-005 — Frontend: ocultar acciones exclusivas de `admin_acueducto`
**Archivos:** `frontend/components/panel/sidebar-panel.tsx`,
`frontend/app/app/pagos/page.tsx`, `.../[suscriptorId]/page.tsx`,
`frontend/app/app/facturacion/[facturaId]/page.tsx`, `frontend/app/app/cortes/page.tsx`
**Hace:** cada uno pide el rol (`obtenerContextoUsuario()`, ya existe desde 025) y oculta
Configuración (sidebar), Anular pago, Anular factura, Generar facturación, Ejecutar corte/Reconectar
cuando `rol === 'secretaria'`.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Estado:** Pendiente

## T-006 — Test de aislamiento 015 + verificación de integración real
**Archivos:** `tests/aislamiento/015_rol_secretaria_aislamiento.sql`
**Hace:** toda la matriz del spec, contra PostgreSQL real, con la prueba de que el test SIRVE
(relajar algo a propósito, ver caer el paso, restaurar). Más verificación con `wrangler dev` +
`next dev` reales: sesión de `secretaria` real contra cada ruta de la matriz.
**Verificación:** `psql ... -f tests/aislamiento/015_rol_secretaria_aislamiento.sql` + curl real.
**Estado:** Pendiente

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
**Estado:** Pendiente
