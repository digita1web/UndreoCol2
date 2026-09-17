# TASKS — 045: lectores-vista

**Plan aprobado:** 2026-09-16

**Quién ejecuta:** Claude, directamente.

## T-001 — Re-vestido + cierre

**Archivos:** `frontend/app/app/lectores/page.tsx`, `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md`

**Verificación:**
```
cd frontend && npm run build && npm run lint && npm run knip
cd backend && npm test && npm run build && npx wrangler deploy --dry-run
```

**Estado:** HECHO — Sesión 057. Implementado directamente por Claude. Frontend: `npm run build`
limpio, `npm run lint` sin hallazgos, `npm run knip` sin hallazgos nuevos (los 2 existentes —
`buttonVariants`/`ButtonProps` de shadcn — son preexistentes, ya revisados, CHANGELOG.md línea
102). Backend confirmado intacto: 251 tests en verde, `tsc --noEmit` limpio, `wrangler deploy
--dry-run` exitoso. CA-1/CA-3 verificados por tipos (sin datos ni estados nuevos). CA-2/CA-4
pendientes de verificación manual de Mateo con `wrangler dev` + `next dev` reales — mismo criterio
de proporcionalidad que 039-044.
