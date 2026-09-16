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
Backend se corre igual para confirmar que de verdad no se tocó.

Más, con Playwright + Chromium (instalable en este entorno, confirmado Sesión 056): ruta de prueba
temporal (nunca commiteada) con datos mockeados cubriendo los 4 valores de `revision`, sesión
`admin_acueducto` y `secretaria`, confirmando CA-1 a CA-6 de `spec.md` §6 contra un navegador real.

**Estado:** PENDIENTE — sin empezar todavía.
