# TASKS — 040: suscriptores-lista-ficha-importar

**Plan aprobado:** 2026-09-16

Una tarea = un commit. Sin evidencia no hay commit.

**Quién ejecuta:** Claude, directamente (autorización expresa de Mateo, no pasa por Luna).

---

## T-001 — `EditarSuscriptorForm` nuevo + exporta `CATEGORIAS`

**Archivos:** `frontend/components/editar-suscriptor-form.tsx` (nuevo),
`frontend/components/suscriptor-form.tsx` (una línea)

**Hace:** Implementa el contrato de `plan.md` §4: formulario pre-llenado, 9 campos editables, PATCH
solo con los campos que cambiaron, nunca `codigo_suscriptor`/`estado`.

**Estado:** Pendiente

---

## T-002 — Ficha re-vestida + "Editar" integrado

**Archivos:** `frontend/app/app/suscriptores/[id]/page.tsx`

**Hace:** `page-head`, `Badge` en estado del suscriptor e historial de cortes/reconexiones, vista de
solo lectura completa (spec §3.4: teléfono/email/sector/notas), botón "Editar" que alterna a
`EditarSuscriptorForm` (mismo patrón que "Ver/Ocultar etiqueta QR"). Sin tocar
`CorteForm`/`ReconexionForm`/`ContadorForm`/`ReemplazoContadorForm`/`EtiquetaQrContador`/
`regenerarCodigoSuscriptor`.

**Estado:** Pendiente

---

## T-003 — Lista e Importar re-vestidos

**Archivos:** `frontend/app/app/suscriptores/page.tsx`, `frontend/app/app/suscriptores/importar/page.tsx`

**Hace:** Lista: `page-head`, búsqueda cliente-side, tabla con `Badge` de estado (sin columna
"Contador", spec §3.1). Importar: solo `page-head` del contenedor.

**Estado:** Pendiente

---

## T-004 — Cierre: verificación real, CHANGELOG

**Verificación real:**
```
cd frontend && npm run build && npm run lint && npm run knip
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
```
Backend se corre igual para confirmar que de verdad no se tocó. `npm run knip` confirma que
`actualizarSuscriptor`/`DatosActualizarSuscriptor` dejan de estar huérfanos.

**Archivos:** `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md`

**Verificado:** 251 tests de backend + build + `wrangler deploy --dry-run` en verde (backend
intacto, `git status` sin cambios ahí). `npm run knip` en frontend confirma que
`actualizarSuscriptor`/`DatosActualizarSuscriptor` dejaron de estar huérfanos.

**Conteo real para PLAN-PRODUCCION.md:** las 3 pantallas (lista, ficha, importar) cuentan como 3 de
las 15 — la edición de suscriptor es funcionalidad nueva dentro de la ficha, no una pantalla aparte.
Contador pasa de 6/15 a 9/15.

**Estado:** HECHO — Sesión 056. T-001 a T-003 implementados directamente por Claude (autorización
expresa, no pasaron por Luna). CA-1/CA-2/CA-5 verificados por tipos/inspección; CA-3/CA-4/CA-6/CA-7
quedan pendientes de verificación manual de Mateo contra `wrangler dev` real (mismo criterio de
proporcionalidad que 039).
