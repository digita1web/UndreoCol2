# TASKS — 026: shell-panel-admin

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit. Los hashes van en la Bitácora de cierre (T-006).

## T-001 — Tokens de color nuevos
**Archivos:** `frontend/app/globals.css`, `frontend/tailwind.config.ts`
**Hace:** agrega `--accent`/`-soft`, `--success`/`-soft`, `--warning`/`-soft`, `--danger`/`-soft`,
`--info`/`-soft` sin tocar los tokens existentes de shadcn; los expone como utilidades de Tailwind.
**Verificación:** `cd frontend && npm run build` (nada debería cambiar de color todavía — los
tokens nuevos no los usa ningún componente aún)
**Estado:** Hecho
**Evidencia:** `npm run build` → 18/18 páginas, sin errores. `.next` limpiado y `next dev`
reiniciado después (misma rutina de las sesiones anteriores).
**Commit:** se registra en la Bitácora de cierre (T-006)

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
**Archivos:** `frontend/app/app/layout.tsx`, `frontend/components/panel/topbar-panel.tsx` (no
estaba en plan.md — la cabecera superior se separó en su propio componente cliente para que
`layout.tsx` siga siendo Server Component, en vez de escribirla en línea)
**Hace:** reemplaza el header simple ("← Inicio"/Salir, ya cubierto por el enlace "Panel" de la
barra lateral) por `<SidebarPanel>` + `<TopbarPanel>` (en línea/sin conexión + nombre del
acueducto); carga Inter con `next/font/google`, acotado a este layout.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit → sin errores
$ npm run build    → 18/18 páginas, sin errores
$ npm run lint     → ESLint: No issues found
```
.next limpiado y next dev reiniciado después del build.
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-006 — Verificación de integración real + cierre
**Archivos:** `CHANGELOG.md`
**Hace:** recorre las 9 pantallas reales con sesión de `admin_acueducto` real contra `wrangler dev`
+ `next dev`, confirma estado activo correcto en sub-páginas, "Salir" funcional, regresión de las
9 pantallas. Cierra con CHANGELOG, Bitácora y checklist de CLAUDE.md §11.
**Verificación:** curl real + navegación de las 9 rutas; `npm run build && npm run lint` finales.
**Estado:** Hecho
**Evidencia:**
```
Contra wrangler dev + next dev reales, sesión de admin_acueducto:
  Las 9 pantallas + 5 sub-páginas (facturación/[id], pagos/[id], lecturas/periodo,
  suscriptores/[id], suscriptores/importar) -> HTTP 200

  HTML servido en /app/dashboard contiene: UndreoCol, Gestión de acueductos, los 9 enlaces
  reales, En línea, Salir.

  Estado activo verificado en el HTML real (no solo en teoría):
    /app/dashboard                                     -> <a href="/app/dashboard" class="...
                                                            bg-accent-soft font-bold text-accent">
    /app/facturacion/ff000000-...-0a1 (sub-página)     -> <a href="/app/facturacion" class="...
                                                            bg-accent-soft font-bold text-accent">
  (la mejora propia de detección por prefijo de ruta funciona en ambos casos)

$ cd backend && npm test                → 215 passed (sin cambios, feature de frontend)
$ npx wrangler deploy --dry-run         → EXIT=0
$ cd frontend && npm run build          → 18/18 páginas
$ npm run lint                          → ESLint: No issues found
CHANGELOG.md: Sesión 040.
```
**Commit:** este commit (cierre)

## Bitácora de cierre

| Tarea | Commit | Estado |
|---|---|---|
| T-001 tokens de color nuevos | `572f66a` | COMPLETADO |
| T-002 `Badge` y `KpiCard` | `91e529e` | COMPLETADO |
| T-003 9 íconos SVG (mejora propia) | `90535ca` | COMPLETADO |
| T-004 `SidebarPanel` con estado activo por ruta real | `16056d2` | COMPLETADO |
| T-005 `layout.tsx` usa el shell nuevo | `256ffd2` | COMPLETADO |
| T-006 cierre | este commit | COMPLETADO |

### Checklist de `CLAUDE.md §11`

- [x] Hace lo que dice el spec, ni más ni menos — solo el marco compartido, ninguna pantalla de
      contenido se re-vistió (confirmado: CA-2, las 14 rutas responden 200 sin cambios internos)
- [x] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [x] `npx wrangler deploy --dry-run` (backend) exitoso — sin cambios de backend
- [x] `npm run lint` limpio
- [x] Tests en verde — 215/215 backend (sin cambios), build/lint frontend
- [x] Si toca base de datos: no aplica
- [x] Si toca `core/`: no aplica
- [x] Evidencia pegada en la conversación y en este documento
- [x] `CHANGELOG.md` actualizado (Sesión 040)
- [x] Commit hecho por tarea verificada; sin `push` salvo autorización expresa (§9.1)

### Desviaciones respecto del plan, señaladas en su commit

1. **T-005:** `topbar-panel.tsx` no estaba en la lista de archivos de `plan.md` — se separó en su
   propio componente cliente para que `layout.tsx` siguiera siendo Server Component.
