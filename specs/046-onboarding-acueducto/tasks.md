# TASKS — 046: onboarding-acueducto

**Plan aprobado:** 2026-09-17

**Quién ejecuta:** Claude, directamente.

## T-001 — Backend: `conteoServicios` en `GET /dashboard`

**Archivos:** `backend/src/index.ts`, test correspondiente

**Verificación:**
```
cd backend && npx tsc --noEmit && npx vitest run && npx wrangler deploy --dry-run
```

**Estado:** HECHO. `tsc` limpio, 272 tests (269 + 3 nuevos en
`dashboard-conteo-servicios.test.ts`) en verde, `wrangler deploy --dry-run` exitoso, `knip` sin
hallazgos nuevos.

## T-002 — Frontend: checklist de onboarding + wiring en el dashboard

**Archivos:** `frontend/components/panel/checklist-onboarding.tsx`,
`frontend/app/app/dashboard/page.tsx`

**Verificación:**
```
cd frontend && npm run build && npm run lint && npm run knip
```

**Estado:** HECHO. Build/lint/knip limpios (2 hallazgos preexistentes de shadcn, ya revisados).
Verificado visualmente con Playwright real (Chromium instalado de forma aislada) contra una ruta
temporal nunca commiteada: estado `vacio=true` (checklist siempre visible, 3 pasos pendientes) y
`vacio=false` (colapsado detrás de "Ver guía de inicio", que al hacer clic expande y muestra
Catálogo/Suscriptores como hechos y Lector pendiente, tal como corresponde a los conteos pasados).

## T-003 — Cierre: CHANGELOG + verificación manual contra el acueducto piloto real

**Archivos:** `CHANGELOG.md`

**Verificación:** los 5 CA probados contra producción real (Idroredes del Sur, que hoy mismo está
vacío — condición perfecta para CA-1 sin necesitar datos de prueba).

**Estado:** CHANGELOG.md actualizado. **CA-1 a CA-5 contra producción real (Idroredes del Sur):
NO VERIFICADO — requiere que Mateo lo confirme una vez desplegado** (necesita sesión real de
Jaider en `/app/dashboard`; esta sesión no tiene sus credenciales). Pasos exactos: entrar como
Jaider a `/app/dashboard` → confirmar que aparece el checklist en vez de indicadores (CA-1) →
cargar un servicio en `/app/catalogo` y volver a `/app/dashboard`, confirmar que "Catálogo y
tarifas" pasa a hecho (CA-2) → confirmar que cada botón del checklist lleva a la pantalla correcta
(CA-3) → cargar el primer suscriptor real y confirmar que el checklist desaparece solo y aparecen
los indicadores (CA-4) → click en "Ver guía de inicio" y confirmar que reabre (CA-4b) → entrar con
una sesión de `secretaria` (si existe una) y confirmar que no ve el checklist (CA-5).
