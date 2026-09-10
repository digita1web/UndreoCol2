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
**Estado:** Hecho
**Evidencia:**
```
GET /dashboard/indicadores real (admin_acueducto):
  recaudoMes=362000, carteraVencida=290000, usuariosEnMora=2, carteraPendiente=178600
  tendencia: ...mes 8=120000, mes 9=362000 (los 2 últimos)

Cálculo manual: (362000-120000)/120000*100 = 201,6667% -> "↑ 201,7% vs. mes anterior"

HTML servido real (SSR) contiene exactamente:
  KpiCard Recaudo del mes: variacion="↑ 201,7% vs. mes anterior", variacionColor="success"
  KpiCard Cartera vencida: valor="$ 290.000", variacion="2 suscriptores en mora",
    variacionColor="danger", href="/app/pagos"
  KpiCard Por vencer: valor="$ 178.600", href="/app/pagos"
  Eyebrow "Resumen" presente; saludo SSR = "Hola, Admin A" (se corrige a Buenos
    días/tardes/noches en el cliente tras hidratar, sin parpadeo — diseño a propósito)

Sesión de lector (regresión): "No autorizado" presente; ninguna de "Recaudo del mes",
"Cartera vencida", "Por vencer" aparece en el HTML.
```
**Commit:** se registra en la Bitácora de cierre (T-004)

## T-004 — Cierre: CHANGELOG y checklist completo
**Archivos:** `CHANGELOG.md`
**Hace:** entrada de la sesión, Bitácora de cierre con los commits, checklist de CLAUDE.md §11.
**Verificación:** `npm run build && npm run lint` (frontend) limpios.
**Estado:** Pendiente
