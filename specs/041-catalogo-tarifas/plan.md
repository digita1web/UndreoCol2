# PLAN — 041: catalogo-tarifas

**Spec aprobado:** 2026-09-16

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/catalogo/page.tsx` | Modificado | `page-head`, grid de tarjetas con `Badge` de activo/inactivo, homologa `Button` → `<button>` (spec §3.1) |
| `frontend/app/app/catalogo/[servicioId]/page.tsx` | Modificado | `page-head`, `Badge` de vigente/histórica en el historial, re-vestido de las dos tarjetas de autorización |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero archivos de backend, cero `core/`, cero componentes nuevos (`ServicioForm`/`TarifaForm` sin
tocar — spec §4).

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna nueva. Reutilizadas tal cual: `listarServicios()`, `actualizarServicio()`,
`listarTarifas()`, `crearAutorizacionTarifa()`, `listarAutorizacionesTarifa()`,
`revocarAutorizacionTarifa()`, `obtenerContextoUsuario()`.

## 4. Contratos de `core/`

Ninguno.

### `Badge` de servicio — constante en `catalogo/page.tsx`

```ts
const BADGE_SERVICIO: Record<'activo' | 'inactivo', { variante: 'success' | 'gray'; etiqueta: string }> = {
  activo: { variante: 'success', etiqueta: 'Vigente' },
  inactivo: { variante: 'gray', etiqueta: 'Inactivo' },
};
```

Se indexa con `servicio.activo ? 'activo' : 'inactivo'` (el campo real es `boolean`, no un string —
la constante usa las dos claves como etiquetas legibles, no el tipo de `Servicio.activo`
directamente).

### `Badge` de tarifa — constante en `[servicioId]/page.tsx`

```ts
function badgeVigencia(tarifa: Tarifa): { variante: 'success' | 'gray'; etiqueta: string } {
  return tarifa.vigencia_hasta === null
    ? { variante: 'success', etiqueta: 'Vigente' }
    : { variante: 'gray', etiqueta: 'Histórica' };
}
```

Función, no un `Record`, porque la clave no es un valor discreto (`vigencia_hasta` es `string | null`,
no un union chico) — mismo criterio que 039 con `suscriptorDelContador`.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `/app/catalogo` pasa de `Button` (componente) a `<button>` con clases de Tailwind sueltas | Dejar `Button`, ya que técnicamente funciona | Homologa al patrón real de 030/032/039/040 (verificado antes del spec, no asumido) — consistencia entre las pantallas ya re-vestidas por sobre preservar una inconsistencia que ya existía antes del rediseño |
| Grid de tarjetas de servicio (`grid-cols-2` en pantallas anchas) en vez de la lista vertical actual | Mantener la lista vertical actual, solo agregar `Badge` | La propuesta (`id="catalogo"`) usa explícitamente un grid de 2 columnas para los servicios — es la pantalla del rediseño con más correspondencia directa a la propuesta visual de todas las que quedan, se sigue de cerca |
| El historial de tarifas se mantiene como lista vertical (no tabla), mismo layout que hoy | Convertirlo a `<table>` como 030/039/040 | El historial es 1 columna real de información por fila (rango de vigencia + 4 cifras en una sola línea de texto) — una tabla de una sola fila de datos por columna sería más ceremonia que la lista actual, que ya es legible; no hay precedente de la propuesta para esta pantalla específica (spec §3.2) |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — sin cambios de backend.

## 8. Estrategia de pruebas

- **Unitarias/aislamiento:** no aplica (sin backend/`core/` nuevo).
- **CA-1/CA-2 verificables por tipos + inspección:** `BADGE_SERVICIO`/`badgeVigencia` cubren
  exhaustivamente los dos casos posibles de cada campo (`boolean`, `string | null` reducido a
  vigente/histórica) — `npm run build` ya lo prueba.
- **Integración manual (`wrangler dev` + `next dev` reales), con evidencia real:**
  - CA-2: crear una tarifa real para una categoría que ya tenía una vigente — confirmar que la
    anterior pasa a "Histórica" sin recargar (el índice único `(servicio_id, categoria,
    vigencia_desde)` y el cierre automático de la anterior ya lo garantiza el backend, 004/002 —
    esto solo confirma que la UI lo refleja).
  - CA-3/CA-4/CA-5: regresión de activar/desactivar servicio, autorizar/revocar/aplicar tarifa como
    `secretaria`, y crear tarifa directa como `admin_acueducto` — mismo resultado que antes del
    re-vestido.
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (mismo criterio de
  proporcionalidad que 039/040 — el riesgo real de esta pantalla es de negocio, no de UI, y las
  reglas de negocio no se tocan).
