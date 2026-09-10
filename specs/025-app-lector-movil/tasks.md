# TASKS — 025: app-lector-movil

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit. Los hashes van en la Bitácora de cierre (T-006).

## T-001 — `obtenerContextoUsuario()` en `lib/api.ts`
**Archivos:** `frontend/lib/api.ts`
**Hace:** llama `GET /dashboard` desde el cliente, tipa `{ cliente: { rol, nombre }, perfil }`.
**Verificación:** `cd frontend && npx tsc --noEmit`
**Estado:** Pendiente

## T-002 — `shell-lector.tsx`: encabezado + navegación inferior
**Archivos:** `frontend/components/lector/shell-lector.tsx`
**Hace:** header "AquaLectura" (SVG de gota) + indicador en línea/sin conexión (`navigator.onLine`)
+ barra inferior de 4 pestañas.
**Verificación:** `cd frontend && npx tsc --noEmit && npm run lint`
**Estado:** Pendiente

## T-003 — Las 4 vistas del lector
**Archivos:** `frontend/components/lector/inicio-lector.tsx`,
`nueva-lectura-lector.tsx`, `pendientes-lector.tsx`, `historial-lector.tsx`
**Hace:** cada una consume las funciones ya existentes de `lib/api.ts` (`obtenerAcueducto`,
`listarPeriodos`, `listarSuscriptores`, `listarLecturas`, `crearLectura`). Pendientes no muestra
botón de acción (CA-4).
**Verificación:** `cd frontend && npx tsc --noEmit && npm run build`
**Estado:** Pendiente

## T-004 — `lecturas/page.tsx` decide el shell según el rol
**Archivos:** `frontend/app/app/lecturas/page.tsx`
**Hace:** pide el rol al montar; `lector` → `<ShellLector />`; cualquier otro rol → el JSX actual,
sin cambios.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Estado:** Pendiente

## T-005 — Verificación de integración real
**Archivos:** ninguno
**Hace:** contra `wrangler dev` + `next dev` reales: sesión de `lector` real ve el shell nuevo con
datos reales (acueducto, periodo, suscriptores, lecturas); sesión de `admin_acueducto` ve
`/app/lecturas` sin cambios.
**Verificación:** curl real + confirmación de las respuestas que cada pestaña consume.
**Estado:** Pendiente

## T-006 — Cierre: CHANGELOG y checklist completo
**Archivos:** `CHANGELOG.md`
**Hace:** entrada de la sesión, Bitácora de cierre con los commits, checklist de CLAUDE.md §11.
**Verificación:** `npm run build && npm run lint` (frontend) limpios.
**Estado:** Pendiente
