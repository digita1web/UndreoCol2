# SPEC — 030: facturacion-lista

**Estado:** Borrador para aprobación
**Depende de:** 005-facturacion, 026-shell-panel-admin, 027-panel-principal

## 1. Objetivo

Re-vestir `/app/facturacion` (la lista de facturas del periodo, no el detalle) con el sistema
visual de 026 — `Badge`, tarjetas y tokens de color —, siguiendo
`specs/026-shell-panel-admin/propuesta-referencia.html` (`id="facturacion"`). Tercera pantalla de
contenido que se re-viste, después del marco compartido (026) y el Panel principal (027).

## 2. Por qué ahora

Mateo lo eligió como la siguiente pantalla del rediseño, por ser la de uso más frecuente día a día
para `admin_acueducto` y `secretaria` (028).

## 3. Alcance

### 3.1 Re-vestido + una mejora chica, cero endpoints nuevos
Todo sale de `GET /facturacion/periodos/:id/facturas` (ya existe, sin cambios) y de `GET
/facturacion/periodos` (selector de periodo, ya existe). La única pieza nueva es la búsqueda y el
filtro por estado de la propuesta — se resuelven **filtrando en el cliente** el arreglo de facturas
que ya se cargó para el periodo, sin ninguna llamada nueva al backend.

### 3.2 Encabezado con acciones (`page-head` de 026)
Eyebrow "Facturación", `<h1>Facturas</h1>`, subtítulo con el nombre y estado del periodo
seleccionado. La propuesta pone dos botones de acción ("Cambiar periodo", "Generar facturación")
pero el flujo real detrás **no es un solo clic**: hoy es selector de periodo → "Simular periodo" →
revisar el resumen y las anomalías → "Confirmar emisión" (medida de seguridad ya existente, con
dinero real de por medio — no se colapsa en un botón). Se adopta la intención visual del
encabezado, no el flujo de dos botones: el selector de periodo y los botones
Simular/Confirmar emisión que ya existen se reubican en el `page-head`, visibles solo para
`admin_acueducto`/`secretaria` (mismo criterio que hoy usa `rol === 'admin_acueducto'` — a
revisar en `/plan` si `secretaria` (028) debe entrar aquí también, ya que sí puede registrar pagos
pero **el spec de 028 no le dio permiso de simular/emitir**; por defecto se mantiene solo para
`admin_acueducto`, igual que hoy).

### 3.3 Filtros: búsqueda + estado (nuevo, cliente-side)
Input de búsqueda (por número de factura o nombre del suscriptor, sobre `snapshot_suscriptor.nombre`
y `numero`) + selector de estado con las 4 categorías reales de `estado_factura`: Pendiente, Pagada,
Vencida, Anulada — **no las 3 de la propuesta** (que omite "Vencida"; se completan las 4 porque son
un estado real del sistema, ocultar una llevaría a confusión).

### 3.4 Tabla con `Badge` de color
Columnas: Suscriptor (nombre + código + categoría, ej. "A-001 · Estrato 3", desde
`snapshot_suscriptor`), Factura (número), Total, Estado, y un botón "Ver" por fila que enlaza a
`/app/facturacion/{id}` (el detalle — pantalla de su propio spec futuro, sin tocar en este). Mapeo
de `estado_factura` a `Badge`: `pendiente` → `warning`, `pagada` → `success`, `vencida` → `danger`,
`anulada` → `gray`. Las etiquetas visibles usan los nombres reales del estado ("Pendiente", no "Por
vencer" como dice la propuesta — evita inventar un estado que no existe en `estado_factura`).

### 3.5b Mejora propia: resumen de urgencia del periodo (sin llamada nueva)
La lista hoy no dice, a simple vista, cuánta plata está vencida — hay que abrir cada factura o
adivinarlo por los `Badge` uno por uno. Se agrega una franja corta en el `page-head`, calculada
100% en el cliente a partir del mismo arreglo ya cargado (mismo criterio de "cero endpoints nuevos"
de §3.1): cantidad de facturas `vencida` y su suma de `total - total_pagado` (saldo real, no el
total bruto — una vencida con abono parcial no debe contarse por el total completo). Ejemplo: "3
facturas vencidas · $ 142.300 por cobrar". Si no hay ninguna vencida, no se muestra la franja (no
hay urgencia que señalar). Con `Badge danger`, mismo color que usa el estado "vencida" en la tabla.

### 3.5 Resumen de la simulación y anomalías: se conservan, re-vestidos
La tarjeta que hoy aparece tras "Simular periodo" (totales + lista de anomalías) no está en la
propuesta, pero es funcionalidad real de 005 que no se elimina — mismo criterio que 027 con el
gráfico de tendencia. Se le aplican los tokens/tarjetas de 026.

### 3.6 `lector`: estado explícito, no degradación silenciosa
Hoy `GET /facturacion/periodos/:id/facturas` no filtra por rol en la ruta — el `lector` obtiene un
arreglo vacío por RLS (`facturas_staff_lectura`, 028, no lo alcanza) y la pantalla de hoy lo muestra
como "Sin facturas emitidas para este periodo", indistinguible de un periodo realmente sin facturas.
Se agrega un estado "No autorizado" explícito para `lector`, con enlace a `/app/lecturas` — mismo
patrón que CA-4 de 027 (`especificación-funcional.md`: el lector "solo puede crear y ver lecturas").

## 4. Fuera de alcance

- **Detalle de factura** (`/app/facturacion/[facturaId]`) — pantalla propia, su propio spec futuro.
- **"Generar facturación" como un solo botón** — el flujo simular→confirmar no se colapsa (§3.2).
- **Anular factura** — vive en el detalle, no en la lista; sin cambios aquí.
- **Paginación o límite del arreglo de facturas** — hoy se carga completo por periodo; si un
  acueducto real tiene tantos suscriptores que esto se vuelve lento, es una feature aparte (no hay
  evidencia hoy de que haga falta — `undreocol-produccion` sigue en 0 suscriptores).
- **Decidir si `secretaria` puede simular/emitir** — 028 no le dio ese permiso; este spec no lo
  cambia, solo reubica visualmente los mismos botones para los mismos roles de hoy.

## 5. Reglas de negocio que aplican

- `estado_factura` tiene exactamente 4 valores: `pendiente`, `pagada`, `vencida`, `anulada`
  (verificado contra el enum real, migración `20260905090000_facturacion.sql`).
- Una factura emitida es inmutable (CLAUDE.md §10 punto 9/`bloquear_factura_inmutable`, 028) — esta
  pantalla es de solo lectura salvo por el flujo de emisión ya existente, no la toca.
- El `lector` solo crea/ve lecturas (CLAUDE.md §10 punto 24) — nunca cifras de facturación, ni
  siquiera degradadas.

## 6. Criterios de aceptación

### CA-1 — La tabla muestra las facturas reales del periodo seleccionado
Con sesión de `admin_acueducto` real y un periodo con facturas emitidas, cada fila coincide con lo
que devuelve `GET /facturacion/periodos/:id/facturas` (número, suscriptor, total, estado).

### CA-2 — El `Badge` de estado usa el color y la etiqueta correctos para los 4 estados
Verificado con facturas reales o de fixture en cada uno de los 4 estados: `pendiente`→warning,
`pagada`→success, `vencida`→danger, `anulada`→gray, con la etiqueta real del estado.

### CA-3 — La búsqueda y el filtro de estado funcionan sobre los datos ya cargados
Escribir en el buscador o elegir un estado filtra la tabla sin ninguna petición nueva al backend
(verificable: ninguna llamada de red nueva al tipear).

### CA-4 — El flujo Simular → Confirmar emisión sigue funcionando igual que hoy
Mismo comportamiento, mismos mensajes de error/éxito, solo reubicado visualmente en el `page-head`.

### CA-5 — El `lector` ve "No autorizado" explícito, no una tabla vacía
Con sesión de `lector` real, `/app/facturacion` no intenta listar facturas — muestra el mensaje
explícito con enlace a `/app/lecturas`.

### CA-6 — El botón "Ver" de cada fila lleva al detalle real de esa factura
Enlaza a `/app/facturacion/{id}` con el `id` correcto de la fila.

### CA-7 — El resumen de urgencia (§3.5b) muestra el saldo real, no el total bruto
Con al menos una factura `vencida` con abono parcial (`total_pagado > 0`), la franja de resumen
suma `total - total_pagado` de cada vencida, no `total`. Con cero facturas vencidas en el periodo,
la franja no aparece.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Agregar el filtro de "No autorizado" para `lector` es una mejora de comportamiento, no solo visual — se sale un poco del "cero cambios de datos" de 027 | Es un cambio de frontend puro (ningún endpoint ni política RLS cambia), y cierra una degradación silenciosa real que ya existe hoy — se documenta explícitamente en vez de colarlo sin decirlo |
| La categoría (`estrato_1`…`oficial`) no siempre es literalmente un "estrato" (comercial/industrial/oficial no lo son) | La etiqueta se arma con el valor real de `categoria` tal cual, sin forzar la palabra "Estrato" cuando no aplica (a resolver el formato exacto en `/plan`) |
| El resumen de urgencia (§3.5b) podría malinterpretarse como una cifra oficial de cartera (que ya calcula 011/027 con su propia lógica de mora) | Es solo la suma de las `vencida` **de este periodo**, no la cartera vencida total del acueducto (que cruza todos los periodos) — la etiqueta debe decir "de este periodo" para no confundirla con la tarjeta del Panel principal |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de `admin_acueducto` y de
      `lector` (CA-5)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
