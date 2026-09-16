# TASKS — 039: lecturas-vista-admin

**Plan aprobado:** 2026-09-16

Una tarea = un commit. Sin evidencia no hay commit.

**Quién ejecuta:** Claude, directamente (autorización expresa de Mateo, no pasa por Luna — mismo
acuerdo que 036/037/038).

---

## T-001 — Re-vestido de `VistaAdmin`

**Archivos:** `frontend/app/app/lecturas/page.tsx` (solo la función `VistaAdmin`)

**Hace:** Implementa el contrato completo de `plan.md` §4/§5: `page-head` con eyebrow/h1/subtítulo,
selector de periodo + checkbox "Solo anomalías" reubicados, dos tarjetas rápidas (atajos de scroll),
tabla con `Badge` de revisión y cruce suscriptor↔contador, formulario "Nueva lectura" con
`Input`/`Label`. Sin tocar `VistaLector`, sin rutas nuevas.

**Verificación:**
```
cd frontend && npm run build && npm run lint && npm run knip
```

**Estado:** Pendiente

---

## T-002 — Cierre: verificación real, CHANGELOG

**Archivos:** `CHANGELOG.md`

**Verificación real:**
```
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
```
Backend se corre igual para confirmar que de verdad no se tocó — 251 tests, build, dry-run, los tres
en verde.

**Decisión de proporcionalidad, no de límite de herramientas:** a diferencia de 036/037/038, esta
pantalla no se probó con Playwright de punta a punta. A diferencia de esas tres features (lógica
async real: OCR, cola offline, RLS por sector), el riesgo real acá es bajo y ya cubierto por dos
vías reales:
1. **CA-3 (mapeo de `Badge`) verificado por tipos, no por ejecución:** `BADGE_REVISION` es
   `Partial<Record<Lectura['revision'], ...>>` — TypeScript exige que cada clave sea del union real
   de `revision`; un typo o un valor no contemplado no compila (`npm run build` ya lo prueba).
2. **CA-4 (permiso de "Marcar revisada")** no cambió de código respecto a la condición que ya
   existía (`rol === 'admin_acueducto'`) — sin comportamiento nuevo que probar.

Quedan sin verificar con navegador real: CA-1/CA-2 (datos reales en pantalla), CA-5 (el atajo de la
tarjeta "Anomalías" activa el filtro y hace scroll), CA-6 (regresión visual del formulario) — mismo
tipo de verificación manual que 023/025/026/027/030/031/032 ya dejaron pendiente de Mateo. Si se
quiere la misma verificación con Chromium real que 036/037/038, es cuestión de pedirla.

**Estado:** HECHO — Sesión 056. T-001 implementado directamente por Claude (autorización expresa,
no pasó por Luna). Build/lint/knip/tests/dry-run en verde. CA-1/CA-2/CA-5/CA-6 quedan pendientes de
verificación manual de Mateo (ver nota de proporcionalidad arriba).
