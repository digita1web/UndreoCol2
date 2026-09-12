# PLAN — 031: detalle-factura

**Spec aprobado:** 2026-09-12

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/lib/formato-factura.ts` | Nuevo | `formatearCategoria()` (movida desde 030) y `configuracionEstado` (mapeo `EstadoFactura` → `Badge`, movido desde 030) — ahora con 2 consumidores reales, se justifica extraerlos |
| `frontend/app/app/facturacion/page.tsx` | Modificado | Importa `formatearCategoria`/`configuracionEstado` de `lib/formato-factura` en vez de definirlas localmente (030 ya cerrado y commiteado; este cambio es solo mover, cero comportamiento nuevo) |
| `frontend/app/app/facturacion/[facturaId]/page.tsx` | Modificado | Encabezado re-vestido, `Badge` de estado, `window.confirm()` antes de anular factura/pago, resto de bloques re-vestidos sin cambiar lógica |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero archivos de backend — spec §3.1, confirmado: se usan los mismos endpoints que ya existen.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna nueva. Reutilizadas: `GET /facturas/:id`, `GET /facturas/:id/pagos`, `GET /acueducto`,
`GET /dashboard`, `POST /facturas/:id/anular`, `POST /pagos/:id/anular`,
`POST /facturas/:id/enviar-correo`, `GET /facturas/:id/pdf` (vía `urlPdfFactura`).

## 4. Contratos de core/

Ninguno.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `formatearCategoria`/`configuracionEstado` se mueven a `frontend/lib/formato-factura.ts`, archivo nuevo y puntual (no `lib/utils.ts`) | Agregarlas a `lib/utils.ts` existente | `utils.ts` es el `cn()` genérico de shadcn — mezclar ahí un formateo de dominio (`categoria_tarifaria`, `estado_factura`) lo convierte en un cajón de sastre, justo lo que CLAUDE.md §7 prohíbe ("nada de utils.ts genéricos") |
| `window.confirm()` antes de anular muestra el número de factura y el `total` (no el saldo ni otro cálculo nuevo) | Repetir todos los datos de la factura en el diálogo | El número y el monto alcanzan para confirmar "esto es lo que estoy por anular" sin sobrecargar un `confirm()` nativo, que no soporta formato |
| Para anular un pago, el `confirm()` muestra `p.valor` (el valor del pago), no el total de la factura | Mostrar el total de la factura | Es la anulación del pago, no de la factura — el monto relevante para confirmar es el del pago mismo |
| El bloque de marca del acueducto (logo, `colorAcento`, NIT/municipio) de 023 no se toca en su lógica, solo se reordena dentro del nuevo encabezado | Rehacerlo desde cero con el layout del prototipo | Ya funciona, ya tiene su propio spec (023) — moverlo es seguro, reescribirlo no aporta nada |
| `PagoForm` no se re-viste (spec §4) | Re-vestirlo ya que se está tocando esta pantalla | Es compartido con `/app/pagos` (Cartera); cambiarlo acá cambia Cartera sin que tenga su propio spec todavía |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — sin cambios de backend.

## 8. Estrategia de pruebas

- **Unitarias/aislamiento:** no aplica.
- **Integración (manual, `wrangler dev` + `next dev` reales):**
  - Comparar cada campo de "Datos" contra la respuesta cruda de `GET /facturas/:id` (CA-1).
  - Verificar el `Badge` de estado en una factura de cada uno de los 4 estados (CA-2).
  - Registrar un pago real, confirmar que el saldo y el historial se actualizan; anular un pago
    real y confirmar que aparece tachado con su motivo (CA-3).
  - Anular una factura de prueba: confirmar que aparece el `window.confirm()` con número y monto
    antes de la llamada real, y que cancelarlo no anula nada (CA-4); mismo criterio para anular un
    pago (CA-4b).
  - Ver PDF, Imprimir y Enviar por correo siguen funcionando igual (CA-5).
  - Imprimir (`window.print()` o vista previa del navegador) y confirmar que las acciones y "Pagos
    aplicados" no aparecen (CA-6, ya marcados `print:hidden`).
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (sigue sin
  Chromium/Playwright en este entorno).
