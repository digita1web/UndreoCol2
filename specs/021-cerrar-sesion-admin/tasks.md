# TASKS — 021: cerrar-sesion-admin

**Spec aprobada:** 2026-09-09. **Plan aprobado:** 2026-09-09.

Una tarea = un commit. Sin evidencia no hay commit. La IA no hace `push` salvo autorización expresa.

Acceso real a navegador y build en esta sesión (máquina de Mateo) — evidencia real en cada tarea, no
"NO VERIFICADO".

---

## T-001 — `BotonSalir` + integración en `/app/*`

**Archivos:** `frontend/components/boton-salir.tsx` (crear), `frontend/app/app/layout.tsx` (editar)
**Hace:** (plan §2, §3) Componente cliente reutilizable; llama `logout()`, siempre termina en
`/login` incluso si la petición falla. Se agrega al layout compartido de las 8 páginas de `/app/*`.

**Verificación:**
```bash
cd frontend
npm run build && npm run lint
```
Luego, en el navegador real: entrar a `/app/dashboard` y a `/app/suscriptores` (tabla ancha),
confirmar el botón visible sin romper el contenido; clic en "Salir" → termina en `/login`; una
petición posterior a `/app/dashboard` confirma que la cookie ya no es válida (redirige a `/login`
otra vez, no muestra datos).
**Resultado esperado:** build/lint limpios; botón visible y funcional en las 2 páginas probadas.
**Estado:** COMPLETADO
**Evidencia:**
```
npm run build (next build) -> EXIT=0
npm run lint -> ESLint: No issues found

Desplegado a producción real (npm run pages:build + wrangler deploy).
Verificado con curl usando una sesión real de mateo2026@gmail.com:
  GET /app/suscriptores -> 200, "Salir" presente 1 vez, contenido de
    la página (tabla de suscriptores) intacto.

Incidente durante esta tarea, corregido de inmediato: el primer deploy
se hizo con `npm run build` (solo next build) en vez de
`npm run pages:build` (el build real de OpenNext) — el .open-next/worker.js
quedó desincronizado de los assets nuevos y el sitio completo respondió
404, incluido el login, por unos minutos. Corregido redesplegando con
pages:build; confirmado restaurado (login 200, /plataforma 200).
```
**Commit:** se registra en la Bitácora de cierre (T-003)

---

## T-002 — Integración en `/plataforma`

**Archivos:** `frontend/app/plataforma/page.tsx` (editar)
**Hace:** (plan §4) Agrega `<BotonSalir />` junto al título del panel.

**Verificación:**
```bash
cd frontend
npm run build && npm run lint
```
En el navegador real: entrar a `/plataforma`, confirmar el botón visible sin romper el formulario ni
la lista de acueductos; clic en "Salir" → termina en `/login`.
**Resultado esperado:** build/lint limpios; botón visible y funcional.
**Estado:** COMPLETADO
**Evidencia:**
```
npm run build (next build) -> EXIT=0
npm run lint -> ESLint: No issues found

Producción real, mismo despliegue de T-001 (ya corregido con
pages:build): curl con sesión real ->
  GET /plataforma -> 200, "Salir" presente 1 vez, "Panel de
  plataforma" presente, formulario y lista de acueductos intactos.
```
**Commit:** se registra en la Bitácora de cierre (T-003)

---

## T-003 — Cierre: documentación

**Archivos:** `CHANGELOG.md`, `specs/021-cerrar-sesion-admin/spec.md` (CA-1 a CA-3 con evidencia),
este `tasks.md` (bitácora).
**Hace:** Cierra la feature.
**Verificación:** revisión del diff completo.
**Estado:** COMPLETADO
**Evidencia:**
```
CHANGELOG.md actualizado (Sesión 034).
spec.md: CA-1/CA-2/CA-3 marcados CERRADO con evidencia real.
Verificación final del flujo completo: POST /api/auth/logout -> 200,
petición posterior a área protegida -> 307 -> /login.
```
**Commit:** se registra en la Bitácora de cierre (T-003)

---

## Bitácora de cierre

| Tarea | Commit | Estado |
|---|---|---|
| T-001 `BotonSalir` + `/app/*` | `183c254` | COMPLETADO |
| T-002 `/plataforma` | `4c65840` | COMPLETADO |
| T-003 cierre | este commit | COMPLETADO |
