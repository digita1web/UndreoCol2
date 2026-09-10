# TASKS — 027: panel-principal

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit. Los hashes van en la Bitácora de cierre (T-004).

## T-001 — `indicadores-dashboard.tsx`: KpiCard + variación real de recaudo (mejora propia)
**Archivos:** `frontend/components/indicadores-dashboard.tsx`
**Hace:** las 4 tarjetas usan `KpiCard`; "Cartera" se separa en "Cartera vencida" (`danger`, con
`usuariosEnMora` como texto de apoyo) y "Por vencer" (`warning`); "Recaudo del mes" calcula y
muestra `↑/↓ N% vs. mes anterior` real desde `tendencia`, sin línea si el mes anterior fue $0;
gráfico y "Suscriptores por estado" re-vestidos con los tokens de 026 (`bg-accent` en vez de
`bg-blue-600`).
**Verificación:** `cd frontend && npx tsc --noEmit && npm run lint`
**Estado:** Pendiente

## T-002 — `dashboard/page.tsx`: encabezado con saludo real
**Archivos:** `frontend/app/app/dashboard/page.tsx`
**Hace:** eyebrow "RESUMEN" + saludo según la hora real + `datos.perfil.nombre`; el estado "No
autorizado" del lector se re-viste sin cambiar su mensaje.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Estado:** Pendiente

## T-003 — Verificación de integración real
**Archivos:** ninguno
**Hace:** contra `wrangler dev` + `next dev` reales: sesión de `admin_acueducto` real — las 4
cifras coinciden con la respuesta cruda de `GET /dashboard/indicadores`, la variación de recaudo
coincide con el cálculo manual sobre esos mismos datos; sesión de `lector` — sigue viendo "No
autorizado" sin ninguna cifra (regresión).
**Verificación:** curl real comparado contra el cálculo esperado.
**Estado:** Pendiente

## T-004 — Cierre: CHANGELOG y checklist completo
**Archivos:** `CHANGELOG.md`
**Hace:** entrada de la sesión, Bitácora de cierre con los commits, checklist de CLAUDE.md §11.
**Verificación:** `npm run build && npm run lint` (frontend) limpios.
**Estado:** Pendiente
