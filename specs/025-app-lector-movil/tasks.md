# TASKS — 025: app-lector-movil

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit. Los hashes van en la Bitácora de cierre (T-006).

## T-001 — `obtenerContextoUsuario()` en `lib/api.ts`
**Archivos:** `frontend/lib/api.ts`
**Hace:** llama `GET /dashboard` desde el cliente, tipa `{ cliente: { rol, nombre }, perfil }`.
**Verificación:** `cd frontend && npx tsc --noEmit`
**Estado:** Hecho
**Evidencia:** `npx tsc --noEmit` sin errores.
**Commit:** `26fbe0f`

## T-002 — `shell-lector.tsx`: encabezado + navegación inferior
**Archivos:** `frontend/components/lector/shell-lector.tsx`
**Hace:** header "AquaLectura" (SVG de gota) + indicador en línea/sin conexión (`navigator.onLine`)
+ barra inferior de 4 pestañas.
**Verificación:** `cd frontend && npx tsc --noEmit && npm run lint`
**Estado:** Hecho
**Evidencia:** `tsc --noEmit` sin errores; `ESLint: No issues found`.
**Commit:** `a4f0893`

## T-003 — Las 4 vistas del lector
**Archivos:** `frontend/components/lector/inicio-lector.tsx`,
`nueva-lectura-lector.tsx`, `pendientes-lector.tsx`, `historial-lector.tsx`
**Hace:** cada una consume las funciones ya existentes de `lib/api.ts` (`obtenerAcueducto`,
`listarPeriodos`, `listarSuscriptores`, `listarLecturas`, `crearLectura`). Pendientes no muestra
botón de acción (CA-4).
**Verificación:** `cd frontend && npx tsc --noEmit && npm run lint` (el `build` completo se corre en T-004,
cuando quedan conectadas a `page.tsx` — hasta entonces no las importa nadie)
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit  → sin errores
$ npm run lint      → ESLint: No issues found
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-004 — `lecturas/page.tsx` decide el shell según el rol
**Archivos:** `frontend/app/app/lecturas/page.tsx`
**Hace:** pide el rol al montar; `lector` → `<ShellLector />`; cualquier otro rol → el JSX actual,
sin cambios.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit → sin errores
$ npm run build    → 18/18 páginas, /app/lecturas 5.83 kB (antes 3.51 kB — el shell nuevo)
$ npm run lint     → ESLint: No issues found
```
Nota: `npm run build` se corrió con `next dev` activo — se limpió `.next` y se reinició `next dev`
después, mismo procedimiento aprendido en la Sesión 037/038 para no repetir el error de MIME type.
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-005 — Verificación de integración real
**Archivos:** ninguno
**Hace:** contra `wrangler dev` + `next dev` reales: sesión de `lector` real ve el shell nuevo con
datos reales (acueducto, periodo, suscriptores, lecturas); sesión de `admin_acueducto` ve
`/app/lecturas` sin cambios.
**Verificación:** curl real + confirmación de las respuestas que cada pestaña consume.
**Estado:** Hecho
**Evidencia:**
```
Contra wrangler dev + next dev reales, sesión de lector (lector-a@test.local):
  GET /dashboard    -> rol: "lector" (decide VistaLector)
  GET /acueducto    -> nombre: "Acueducto A" (pestaña Inicio)
  GET /periodos     -> 3 periodos, incluido "September 2026" (abierto) (Nueva/Historial)
  GET /suscriptores -> 6 (dropdown de Nueva lectura)
  GET /lecturas?periodo_id=<abierto> -> 1 lectura, revision=normal (Inicio/Pendientes)
  GET /app/lecturas (next dev) -> HTTP 200

Sesión de admin_acueducto (regresión):
  GET /dashboard      -> rol: "admin_acueducto" (decide VistaAdmin, sin cambios)
  GET /app/lecturas   -> HTTP 200

Hallazgo colateral de 024, corregido en el camino (commit 2f080be): GET /dashboard contaba
usuarios_servicio con SELECT directo, que para lector daba 0 desde 024 — cambiado a la RPC
usuarios_servicio_lector() (024), correcto para ambos roles (verificado: lector 0->6, admin 6->6).
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-006 — Cierre: CHANGELOG y checklist completo
**Archivos:** `CHANGELOG.md`
**Hace:** entrada de la sesión, Bitácora de cierre con los commits, checklist de CLAUDE.md §11.
**Verificación:** `npm run build && npm run lint` (frontend) limpios.
**Estado:** Pendiente
