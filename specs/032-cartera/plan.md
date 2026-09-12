# PLAN — 032: cartera

**Spec aprobado:** 2026-09-12

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/pagos/page.tsx` | Modificado | Encabezado, resumen agregado, orden por urgencia, filtros, tabla con `Badge` |
| `frontend/components/pago-form.tsx` | Modificado | Solo el contenedor visual (`border`/`padding`/tokens de 026) — inputs, validación y flujo de envío intactos |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero archivos de backend — spec §3.1, confirmado: se usa el mismo endpoint que ya existe.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna nueva. Reutilizadas: `GET /pagos/cartera` (vía `obtenerCartera`),
`POST /pagos` (vía `registrarPago`, dentro de `PagoForm`, sin cambios de contrato).

## 4. Contratos de core/

Ninguno. El `Badge` de urgencia y el orden/resumen son cálculos de presentación sobre cifras que
`core/` ya calculó y el backend ya devolvió — no hay dinero nuevo que calcular.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| El `Badge` de urgencia se arma con una función pura `badgeUrgencia(fila: FilaCartera)` en el propio archivo, no en `lib/formato-factura.ts` | Meterlo en `formato-factura.ts` | Es cartera, no facturas — mismo criterio de nombrar por dominio (CLAUDE.md §7); si en el futuro alguna otra pantalla de cartera lo necesita, se extrae recién ahí |
| El orden por urgencia se aplica con `.slice().sort(...)` sobre el arreglo ya cargado, antes del filtro de búsqueda (para que el orden se mantenga al filtrar) | Ordenar después de filtrar | El orden es una propiedad de la lista completa; filtrar no debería cambiar el criterio de orden relativo entre las filas que quedan |
| El resumen agregado usa la cartera **completa ya cargada** (antes del filtro de búsqueda), no la filtrada | Recalcularlo sobre lo filtrado | Es un resumen de la cartera del acueducto, no de "lo que estoy viendo ahora mismo" — filtrar por nombre no debería cambiar cuánta plata hay vencida en total |
| `PagoForm` solo cambia clases de contenedor (el `<form>` en sí, `border border-border p-4` hoy) | Reescribir el formulario con `Card` | Ya funciona en 3 pantallas; un cambio de biblioteca/estructura ahí es más riesgo del que justifica un re-vestido visual |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — sin cambios de backend.

## 8. Estrategia de pruebas

- **Unitarias/aislamiento:** no aplica.
- **Integración (manual, `wrangler dev` + `next dev` reales):**
  - Comparar la tabla contra la respuesta cruda de `GET /pagos/cartera` (CA-1).
  - Con datos de fixture o reales que cubran los 3 casos (`vencida>0`, solo `porVencer>0`, solo
    `saldoFavor>0`), confirmar el `Badge` correcto en cada uno (CA-2).
  - Marcar/desmarcar "Solo morosos" y confirmar que dispara una petición nueva a
    `GET /pagos/cartera` (CA-3, regresión).
  - Buscar por nombre/código y confirmar que no hay petición de red nueva (CA-4).
  - Registrar un pago real desde una fila, confirmar aviso de sobrante si aplica y actualización de
    la fila (CA-5, regresión).
  - Con al menos 2 suscriptores con `vencida` distinta, confirmar el orden (mayor primero) y el
    texto del resumen agregado (CA-6).
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (sigue sin
  Chromium/Playwright en este entorno).
