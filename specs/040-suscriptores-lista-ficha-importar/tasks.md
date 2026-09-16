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

**Archivos:** `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (contador de rediseño a 7/15... en realidad
cuenta como 3 pantallas más funcionalidad nueva — a definir el conteo real al cerrar).

**Estado:** PENDIENTE — sin empezar todavía.
