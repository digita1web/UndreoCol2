# TASKS — 026: shell-panel-admin

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit. Los hashes van en la Bitácora de cierre (T-006).

## T-001 — Tokens de color nuevos
**Archivos:** `frontend/app/globals.css`, `frontend/tailwind.config.ts`
**Hace:** agrega `--accent`/`-soft`, `--success`/`-soft`, `--warning`/`-soft`, `--danger`/`-soft`,
`--info`/`-soft` sin tocar los tokens existentes de shadcn; los expone como utilidades de Tailwind.
**Verificación:** `cd frontend && npm run build` (nada debería cambiar de color todavía — los
tokens nuevos no los usa ningún componente aún)
**Estado:** Pendiente

## T-002 — `badge.tsx` y `kpi-card.tsx`
**Archivos:** `frontend/components/ui/badge.tsx`, `frontend/components/ui/kpi-card.tsx`
**Hace:** dos componentes reutilizables nuevos, sin conectar a ninguna pantalla todavía.
**Verificación:** `cd frontend && npx tsc --noEmit && npm run lint`
**Estado:** Pendiente

## T-003 — 9 íconos SVG del menú (mejora propia, plan.md §5)
**Archivos:** `frontend/components/panel/iconos.tsx`
**Hace:** reemplaza los glifos Unicode del prototipo por SVG en línea con `aria-hidden`.
**Verificación:** `cd frontend && npx tsc --noEmit && npm run lint`
**Estado:** Pendiente

## T-004 — `sidebar-panel.tsx` con estado activo por ruta real
**Archivos:** `frontend/components/panel/sidebar-panel.tsx`
**Hace:** barra lateral con los 9 enlaces reales, `usePathname()` para resaltar la sección activa
por prefijo (cubre sub-páginas), operador + botón Salir al pie.
**Verificación:** `cd frontend && npx tsc --noEmit && npm run lint`
**Estado:** Pendiente

## T-005 — `app/app/layout.tsx` usa el shell nuevo
**Archivos:** `frontend/app/app/layout.tsx`
**Hace:** reemplaza el header simple por `<SidebarPanel>` + cabecera superior; carga Inter con
`next/font/google`, acotado a este layout.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Estado:** Pendiente

## T-006 — Verificación de integración real + cierre
**Archivos:** `CHANGELOG.md`
**Hace:** recorre las 9 pantallas reales con sesión de `admin_acueducto` real contra `wrangler dev`
+ `next dev`, confirma estado activo correcto en sub-páginas, "Salir" funcional, regresión de las
9 pantallas. Cierra con CHANGELOG, Bitácora y checklist de CLAUDE.md §11.
**Verificación:** curl real + navegación de las 9 rutas; `npm run build && npm run lint` finales.
**Estado:** Pendiente
