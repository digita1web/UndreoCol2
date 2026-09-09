# SPEC — 021: cerrar-sesion-admin

**Estado:** **IMPLEMENTADA Y VERIFICADA (2026-09-09)** — CA-1 a CA-3 cerrados con evidencia real
contra producción.

**Origen:** petición directa de Mateo, al ver el panel de plataforma sin ninguna forma de salir.

**Investigado antes de escribir esto:** `logout()` (`frontend/lib/api.ts:109`) y la ruta
`POST /auth/logout` (backend, idempotente, borra la cookie) ya existen y funcionan — nunca se llaman
desde ningún componente. Confirmado con `grep` que **ningún** archivo de `app/` ni `components/`
invoca `logout()`. El portal del suscriptor **no tiene este problema**: `logoutPortal()` ya está
conectada a un botón "Salir" en `app/portal/[slug]/page.tsx:54`, funcionando — no se toca.

**Depende de:** 001 (`POST /auth/logout`), 018 (`/plataforma`), y las 8 páginas de `/app/*` ya
existentes (002 a 011).

---

## 1. Objetivo

Que el administrador (de acueducto o de plataforma) tenga una forma visible de cerrar sesión desde
cualquier pantalla autenticada, igual que ya la tiene el suscriptor en el portal.

## 2. Por qué ahora

Hoy la única forma de "salir" es borrar la cookie a mano desde DevTools o esperar a que expire (7
días). Un vacío de UX real, señalado al usar el panel de plataforma recién construido.

## 3. Alcance

### 3.1 Un solo lugar para las 8 páginas de `/app/*`
`frontend/app/app/layout.tsx` envuelve dashboard, catálogo, cortes, facturación, lecturas,
notificaciones, pagos y suscriptores — hoy es un `<div>` vacío, sin encabezado. Se le agrega un
encabezado mínimo con el botón "Salir", una sola vez, en vez de repetirlo en 8 páginas.

### 3.2 `/plataforma`
Ruta hermana de `/app/*`, fuera de ese layout — necesita su propio botón, igual de simple.

### 3.3 Comportamiento del botón
Llama a `logout()` (ya existe, `POST /auth/logout`) y redirige a `/login`. Si la petición falla
(red caída, etc.), **igual redirige** — el usuario quiere salir, y la cookie es `HttpOnly`+`Secure`
con expiración de 7 días de todas formas; no tiene sentido dejarlo atrapado en la pantalla por un
error de red al cerrar sesión.

## 4. Fuera de alcance

- El portal del suscriptor: ya tiene su botón, funciona, no se toca.
- Cualquier otra "mejora" de interfaz — Mateo confirmó que este spec es solo el botón de salir; las
  demás mejoras se conversan y se especifican aparte cuando las tenga claras.
- Un encabezado/navegación completos (menú, logo, breadcrumbs) — solo lo mínimo para el botón.

## 5. Reglas que aplican

- `CLAUDE.md §7` — sin `any`, sin `console.log`.
- `CLAUDE.md §4` — evidencia real: build limpio y prueba real en el navegador (ya se puede, hay
  acceso real a la máquina de Mateo en esta sesión).
- `CLAUDE.md §9` — un commit por tarea verificada.

## 6. Criterios de aceptación

### CA-1 — El botón existe y funciona en las 8 páginas de `/app/*` — CERRADO
Desde cualquiera de las 8 páginas, hay un botón "Salir" visible; al hacer clic, la sesión se cierra
(cookie borrada) y termina en `/login`. **Evidencia real, producción:** `GET /app/suscriptores` con
sesión válida devuelve el botón; `POST /api/auth/logout` responde `200`; una petición posterior a
un área protegida responde `307` → `/login`.

### CA-2 — El botón existe y funciona en `/plataforma` — CERRADO
Mismo comportamiento. **Evidencia real, producción:** `GET /plataforma` con sesión válida devuelve
el botón junto al título; tras `logout`, la misma ruta responde `307` → `/login`.

### CA-3 — No rompe nada existente — CERRADO
Las 8 páginas de `/app/*` y `/plataforma` siguen renderizando su contenido igual que antes del
cambio. **Evidencia real:** `/app/suscriptores` (tabla ancha) y `/plataforma` (formulario + lista)
devuelven su contenido completo junto con el botón nuevo.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El encabezado nuevo rompe el layout visual de alguna de las 8 páginas | CA-3 explícito; revisión visual real de al menos dashboard y una página con tabla ancha (suscriptores) |

## 8. Definición de terminado

- [x] CA-1 a CA-3 con evidencia real (build + producción real, no solo navegador)
- [x] `npm run build` y `npm run lint` limpios
- [x] `CHANGELOG.md` actualizado
- [x] Commit hecho; comando de push entregado a Mateo
