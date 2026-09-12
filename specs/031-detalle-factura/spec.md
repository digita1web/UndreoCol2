# SPEC — 031: detalle-factura

**Estado:** Borrador para aprobación
**Depende de:** 006-impresion-y-correo-factura, 007-pagos-y-cartera, 023-personalizacion-factura,
026-shell-panel-admin, 030-facturacion-lista

## 1. Objetivo

Re-vestir `/app/facturacion/[facturaId]` con el sistema visual de 026, cuarta pantalla del
rediseño. A diferencia de 030, esta pantalla hoy tiene **mucha más funcionalidad real** que la
propuesta (`propuesta-referencia.html#factura-detail`) — registrar pago, historial de pagos, anular
pago, anular factura, todo con permisos por rol — así que el objetivo es re-vestir manteniendo el
100% de esa funcionalidad, no achicarla a lo que muestra el mockup estático.

## 2. Por qué ahora

Continúa el rediseño en el orden que Mateo definió, inmediatamente después de la lista de
Facturación (030) — es la pantalla a la que esa lista enlaza.

## 3. Alcance

### 3.1 Re-vestido puro, cero endpoints nuevos
Usa exactamente lo que ya devuelven `GET /facturas/:id`, `GET /facturas/:id/pagos`,
`GET /acueducto`, `GET /dashboard` (rol). Ninguna ruta de backend cambia. Todas las acciones
(`anularFactura`, `anularPago`, `enviarCorreoFactura`, `urlPdfFactura`) se reutilizan sin cambios de
contrato.

### 3.2 Encabezado con marca del acueducto (mantiene 023, re-viste el resto)
El bloque de marca (logo, nombre con `colorAcento`, NIT/municipio/teléfono/dirección) ya existe
desde 023 y no se toca en su lógica — se le aplica el `page-head` visual (eyebrow "Detalle de
factura", `<h1>Factura {numero}</h1>`, subtítulo con suscriptor + código, siguiendo el patrón real
de 027/030: `text-xs font-bold uppercase tracking-wide text-accent` para el eyebrow, no el
`page-head` del prototipo estático que no existe en el CSS de esta app — mismo hallazgo de la
auditoría de 030, no se repite el error). Los botones Ver PDF / Imprimir / Enviar por correo /
Anular factura se reubican ahí, con `print:hidden` igual que hoy.

### 3.3 Sección "Datos" con `Badge` de estado
Reemplaza el `<p><strong>Estado:</strong> {factura.estado}</p>` de texto plano por el mismo `Badge`
y mapeo de 030 (`pendiente`→warning, `pagada`→success, `vencida`→danger, `anulada`→gray). El resto
de la tarjeta ("Datos") se re-viste con los tokens de 026 sin cambiar qué campos muestra: categoría
(con el mismo formateo de "Estrato N" de 030, ver §3.6), consumo, subtotal, recargo de mora, saldo
anterior, total (con `colorAcento`, sin tocar — 023), pagado/saldo, fechas de emisión/vencimiento,
motivo de anulación si aplica.

### 3.4 Desglose por servicio: se conserva, re-vestido
Misma lista de renglones (`detalles`), mismos datos (`consumo_basico_m3`/`no_basico_m3` o "Cargo
fijo"), solo con las tarjetas/tokens de 026.

### 3.5 Pagos aplicados: se conserva íntegro, re-vestido
Registrar pago, historial de pagos (con método, referencia, quién lo recibió, anulados tachados con
motivo), anular pago (solo `admin_acueducto`, sin cambios de permiso) — toda la lógica intacta,
solo el contenedor y las filas re-vestidos. **`PagoForm` (el formulario en sí) queda fuera de
alcance** (§4) — es compartido con `/app/pagos` (Cartera, sin re-vestir todavía); tocar su estilo
interno aquí lo cambiaría ahí también sin que sea su spec.

### 3.6 Categoría: reutiliza el formateo de 030
La función `formatearCategoria` que 030 definió localmente en `facturacion/page.tsx` se necesita
acá también — se extrae a un lugar compartido (a decidir en `/plan`: `frontend/lib/formato.ts` o
similar) en vez de duplicarla. Con dos consumidores reales, la extracción ya se justifica (a
diferencia de 030, donde con un solo consumidor no correspondía).

### 3.7 Anular factura y anular pago: se reubican, con una guarda nueva
Siguen visibles solo para `admin_acueducto`, con las mismas condiciones de hoy
(`factura.estado !== 'anulada'` para la factura), y el mismo `window.prompt` para el motivo — se
reubica el botón de anular factura al encabezado (§3.2).

### 3.8 Mejora propia: confirmación explícita antes de anular (factura o pago)
Hoy `alAnular`/`alAnularPago` piden el motivo por `window.prompt()` y, si se llena, **anulan de
una** — sin un paso de "¿estás seguro?" intermedio, a diferencia de `alEmitir` (facturación-lista,
030) que sí tiene su `window.confirm()` antes de encolar la emisión. Anular una factura o un pago es
igual de irreversible que emitir un periodo completo (CLAUDE.md: "los datos que maneja son dinero
real de gente real") y hoy tiene menos fricción que emitir, no más. Se agrega un
`window.confirm()` con el monto y el número de factura (o el valor del pago) antes de llamar a
`anularFactura`/`anularPago`, mismo patrón que ya usa `alEmitir` — el `motivo` se sigue pidiendo con
`window.prompt()` igual que hoy, el `confirm()` va después, mostrando exactamente qué se va a
anular.

## 4. Fuera de alcance

- **`PagoForm`** (el componente compartido) — su propio spec, cuando se re-vista Cartera.
- **Cambiar cualquier regla de negocio**: quién puede anular, cuándo se puede registrar un pago,
  cómo se calcula el saldo — nada de esto cambia, es 100% visual + reubicación.
- **La vista impresa (`@media print`, D-8)** — sigue siendo la hoja con estilos de impresión ya
  existente; el rediseño de 026 es para la pantalla, no para lo que sale por impresora. Se verifica
  que `window.print()` siga funcionando igual, no se rediseña el layout de impresión.
- **Cartera (`/app/pagos`)** — pantalla propia, su propio spec futuro.

## 5. Reglas de negocio que aplican

- Una factura emitida es inmutable salvo anulación con motivo y responsable (CLAUDE.md §10 punto 9).
- Solo `admin_acueducto` anula facturas y pagos (`bloquear_factura_inmutable`, `anular_pago`) — el
  `Badge`/reubicación no cambia esa guarda, ya la aplica el backend y el frontend la refleja sin
  tocarla.
- Un pago no se borra, se anula (CLAUDE.md §10 punto 14) — el historial tachado con motivo ya
  refleja esto, no se toca.

## 6. Criterios de aceptación

### CA-1 — Los datos de la factura coinciden con `GET /facturas/:id`
Todos los campos de la sección "Datos" muestran los valores reales de la respuesta, sin inventar
ninguno nuevo.

### CA-2 — El `Badge` de estado usa el mismo mapeo que 030
Mismo color/etiqueta para los 4 estados, verificado con una factura de cada estado.

### CA-3 — Registrar pago, ver historial y anular pago funcionan igual que hoy
Regresión: registrar un pago actualiza el saldo y el historial; anular un pago lo tacha con su
motivo; el botón "Registrar pago"/"Anular" respeta los mismos permisos y condiciones de hoy
(`estado !== 'anulada'`, `total_pagado < total`, rol `admin_acueducto` para anular).

### CA-4 — Anular factura funciona igual que hoy, reubicado, con confirmación nueva
Mismo flujo (`window.prompt` con motivo obligatorio), mismo resultado, visible solo para
`admin_acueducto` y solo si la factura no está ya anulada. Nuevo (§3.8): tras ingresar el motivo,
aparece un `window.confirm()` mostrando el número de factura y el monto antes de llamar a la API;
cancelarlo no anula nada.

### CA-4b — Anular pago pide la misma confirmación nueva
Mismo criterio que CA-4 para `anularPago`: `window.confirm()` con el valor del pago antes de
llamar a la API, después del `window.prompt()` del motivo.

### CA-5 — Ver PDF, Imprimir y Enviar por correo siguen funcionando
Los tres siguen operando exactamente igual (mismo enlace de PDF, mismo `window.print()`, mismo
encolado de correo), solo reubicados en el encabezado.

### CA-6 — La vista impresa no se rompió
`window.print()` sigue ocultando los elementos marcados `print:hidden` (acciones, pagos aplicados,
botón anular) — regresión visual simple: los elementos con esa clase no aparecen al imprimir.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Esta pantalla tiene mucha más lógica real que 030 — más superficie para romper algo al reubicar | Cada bloque (Datos, Desglose, Pagos, acciones) se mueve como unidad, sin tocar su lógica interna; CA-3/CA-4/CA-5 son regresión explícita de todo lo que ya funciona |
| Extraer `formatearCategoria` a un archivo compartido podría arrastrar otro import roto si no se hace con cuidado | Se verifica con `npm run build` (falla en tiempo de compilación si algo quedó mal importado, no en producción) |
| `PagoForm` fuera de alcance podría verse visualmente distinto al resto de la pantalla ya re-vestida | Aceptado a propósito (§4) — es preferible una inconsistencia temporal y documentada a romper `/app/pagos` sin su propio spec |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de `admin_acueducto` (CA-3,
      CA-4) y de un rol sin permiso de anular (regresión de que el botón no aparece)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
