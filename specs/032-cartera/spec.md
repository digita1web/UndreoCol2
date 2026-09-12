# SPEC — 032: cartera

**Estado:** Borrador para aprobación
**Depende de:** 007-pagos-y-cartera, 026-shell-panel-admin, 030-facturacion-lista,
031-detalle-factura

## 1. Objetivo

Re-vestir `/app/pagos` (Cartera — la lista de suscriptores con deuda o saldo a favor) con el
sistema visual de 026. Quinta pantalla del rediseño. Cierra el cabo suelto que dejaron 030/031:
`PagoForm` se usa en las tres pantallas de dinero (`facturacion/page.tsx`,
`facturacion/[facturaId]/page.tsx`, `pagos/page.tsx`) y quedó fuera de alcance en las dos
anteriores porque esta es su pantalla natural — acá sí se re-viste su contenedor.

## 2. Por qué ahora

Continúa el rediseño en el orden acordado, inmediatamente después de Facturación y su detalle.

## 3. Alcance

### 3.1 Re-vestido puro, cero endpoints nuevos
Usa exactamente lo que ya devuelve `GET /pagos/cartera` (vía `obtenerCartera`). Ninguna ruta de
backend cambia. `registrarPago` (vía `PagoForm`) se reutiliza sin cambios de contrato.

### 3.2 Encabezado (`page-head` real, no la clase muerta del prototipo)
Eyebrow "Cartera" (`text-xs font-bold uppercase tracking-wide text-accent`, patrón real de
027/030/031), `<h1>Suscriptores con deuda</h1>`, subtítulo "Consulta y registra pagos pendientes."
El link "← Dashboard" se conserva, reubicado ahí.

### 3.3 Filtros: "Solo morosos" (existente) + búsqueda (nueva, cliente-side)
El checkbox "Solo morosos" ya existe y sigue disparando `obtenerCartera({ soloMorosos })` — es un
filtro de servidor, no se toca. Se agrega un buscador de texto (por nombre o código de suscriptor)
igual que en 030: 100% en el cliente, sobre el arreglo `cartera` ya cargado, sin llamada nueva.

### 3.4 Tabla con `Badge` de urgencia
Reemplaza las tarjetas de `<div>` sueltas por una tabla: Suscriptor (nombre + código + estado),
Días de mora (`diasMoraMax`, o "—" si no aplica), Saldo (el campo más relevante según el caso, ver
§3.5), y un botón "Registrar pago" por fila que abre `PagoForm` igual que hoy (no un modal — mismo
patrón de expandir/cerrar inline que ya existe). Se agrega un `Badge` calculado así (no viene del
backend, es una categorización nueva sobre datos reales):
- `vencida > 0` → `danger`, "En mora"
- si no, `porVencer > 0` → `warning`, "Por vencer"
- si no, `saldoFavor > 0` → `info`, "Saldo a favor"

### 3.5 Las 4 cifras reales se conservan, no se reducen a una sola "Saldo"
La propuesta muestra una sola columna "Saldo"; la pantalla real ya distingue 4 cifras (`porVencer`,
`vencida`, `totalAdeudado`, `saldoFavor`) — se conservan las 4, mismo criterio que 027 con "Cartera
vencida"/"Por vencer" (más información real es mejor que menos, aunque la propuesta la simplifique).

### 3.6b Mejora propia: orden por urgencia + resumen agregado
Hoy la lista sale en el orden que devuelve el backend (sin criterio de urgencia) — para "a quién
cobrarle primero" hay que leer fila por fila. Se ordena la tabla, en el cliente, por: 1º más
`vencida` (de mayor a menor), 2º más `porVencer` (de mayor a menor) — así el caso más urgente queda
arriba sin tocar `obtenerCartera`. Se agrega una línea corta en el encabezado con el total agregado:
"N suscriptores en mora · $X vencido en total" (`N` = cantidad con `vencida > 0`, `X` = suma de
`vencida` de esa misma cartera ya cargada) — mismo criterio que el resumen de urgencia de 030, no
aparece si `N` es 0.

### 3.6 `PagoForm`: se re-viste el contenedor, no el formulario en sí
El `<form>` de `PagoForm` ya cumple CLAUDE.md §7 (`useHidratado()`, `disabled={!hidratado ||
cargando}`) — no se toca su lógica ni sus campos. Se le puede ajustar el contenedor visual
(`border`, `padding`) para que combine con las tarjetas de 026, sin cambiar inputs, validaciones ni
el flujo de envío.

## 4. Fuera de alcance

- **Historial de pagos por suscriptor** (`/app/pagos/[suscriptorId]`) — pantalla propia, sin
  prototipo equivalente; su propio spec futuro si se decide re-vestir.
- **Cambiar cómo se calcula la cartera** (`porVencer`, `vencida`, `diasMoraMax`, etc.) — son cifras
  ya calculadas por el backend (007), este spec no las toca.
- **El botón "+ Registrar pago" del encabezado de la propuesta** — hoy no existe un flujo para
  registrar un pago sin partir de un suscriptor puntual (se necesita `usuarioServicioId`); no se
  agrega un botón que no tiene una acción real detrás (mismo criterio que 027 con "Exportar").

## 5. Reglas de negocio que aplican

- Un pago no se borra, se anula (CLAUDE.md §10 punto 14) — no aplica en esta pantalla (acá solo se
  registran, la anulación vive en el detalle de factura, 031).
- El sobrante de un pago no se pierde (CLAUDE.md §10 punto 14) — el aviso de "saldo a favor" tras
  registrar ya lo comunica, sin cambios.

## 6. Criterios de aceptación

### CA-1 — La tabla muestra los suscriptores reales de la cartera
Con sesión de `admin_acueducto` real, cada fila coincide con lo que devuelve `GET /pagos/cartera`
(las 4 cifras, código, estado, días de mora).

### CA-2 — El `Badge` de urgencia usa la categorización correcta
Un suscriptor con `vencida > 0` muestra "En mora" (danger); uno solo con `porVencer > 0` muestra
"Por vencer" (warning); uno solo con `saldoFavor > 0` muestra "Saldo a favor" (info).

### CA-3 — "Solo morosos" sigue disparando la llamada al backend, sin cambios
Marcar/desmarcar el checkbox sigue recargando `obtenerCartera({ soloMorosos })`, igual que hoy.

### CA-4 — La búsqueda nueva filtra sin llamada nueva
Escribir en el buscador filtra la tabla ya cargada sin ninguna petición de red nueva.

### CA-5 — Registrar pago sigue funcionando igual que hoy
Abrir `PagoForm` desde una fila, registrar un pago, ver el aviso de sobrante si aplica, y que la
fila se actualice — mismo comportamiento, solo re-vestido.

### CA-6 — La tabla queda ordenada por urgencia y el resumen agregado es correcto
Con al menos 2 suscriptores en mora con distinto `vencida`, el de mayor `vencida` aparece primero.
La línea de resumen muestra la cantidad correcta de suscriptores con `vencida > 0` y la suma real
de sus `vencida` — y no aparece si ninguno tiene deuda vencida.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El `Badge` de urgencia es una categorización nueva que no viene del backend — podría no coincidir con algún criterio de negocio no documentado | Se basa 100% en las cifras que el backend ya calcula (`vencida`, `porVencer`, `saldoFavor`), sin inventar ningún umbral nuevo; se verifica con casos reales de cada categoría antes de cerrar |
| Re-vestir el contenedor de `PagoForm` sin tocar su lógica interna, usado en 3 pantallas | Cambios de clases CSS únicamente, verificado con `npm run build`/`lint` en las 3 pantallas que lo usan, no solo en esta |
| Ordenar por urgencia podría confundir si alguien esperaba el orden original (¿alfabético? ¿por fecha de alta?) | El orden actual no tiene ningún criterio documentado ni comunicado al usuario — priorizar cobro es más útil que un orden arbitrario sin anunciar, y se puede revisar si Mateo prefiere otro criterio tras verlo |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de `admin_acueducto`
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
