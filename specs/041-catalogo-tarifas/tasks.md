# TASKS — 041: catalogo-tarifas

**Plan aprobado:** 2026-09-16

Una tarea = un commit. Sin evidencia no hay commit.

**Quién ejecuta:** Claude, directamente (autorización expresa de Mateo, no pasa por Luna).

---

## T-001 — Lista de servicios re-vestida

**Archivos:** `frontend/app/app/catalogo/page.tsx`

**Hace:** `page-head`, grid de 2 columnas con `Badge` de activo/inactivo, homologa `Button` →
`<button>`. Sin tocar `actualizarServicio`/`ServicioForm`.

**Estado:** Pendiente

---

## T-002 — Historial de tarifas + autorización re-vestidos

**Archivos:** `frontend/app/app/catalogo/[servicioId]/page.tsx`

**Hace:** `page-head`, `Badge` de vigente/histórica en cada tarifa del historial, re-vestido de las
tarjetas de autorización (`admin_acueducto`/`secretaria`). Sin tocar `TarifaForm` ni las funciones
de `lib/api.ts`.

**Estado:** Pendiente

---

## T-003 — Cierre: verificación real, CHANGELOG

**Verificación real:**
```
cd frontend && npm run build && npm run lint && npm run knip
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
```

**Archivos:** `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (contador de rediseño a 11/15).

**Estado:** PENDIENTE — sin empezar todavía.
