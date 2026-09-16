# TASKS — 042: cortes-vista

**Plan aprobado:** 2026-09-16

Una tarea = un commit. Sin evidencia no hay commit.

**Quién ejecuta:** Claude, directamente.

---

## T-001 — Re-vestido + cierre

**Archivos:** `frontend/app/app/cortes/page.tsx`, `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md`

**Hace:** Implementa `plan.md` completo (pantalla chica, una sola tarea cubre implementación y
cierre — mismo criterio de proporcionalidad que el resto de la spec).

**Verificación:**
```
cd frontend && npm run build && npm run lint && npm run knip
cd backend && npm test && npm run build && npx wrangler deploy --dry-run
```

**Estado:** HECHO — Sesión 056. Implementado directamente por Claude (autorización expresa, no pasó
por Luna). Build/lint/knip/tests/dry-run en verde. CA-1/CA-2/CA-3 quedan pendientes de verificación
manual de Mateo contra `wrangler dev` real.
