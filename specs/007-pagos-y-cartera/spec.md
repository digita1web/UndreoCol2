# SPEC — 007: pagos-y-cartera

**Estado:** Borrador para aprobación
**Depende de:** 005-facturacion (facturas emitidas con `total`, `total_pagado` default 0, `estado`,
`fecha_vencimiento`, `numero`, `snapshot_suscriptor`, `factura_detalles`; el trigger
`bloquear_factura_inmutable` ya excluye de la inmutabilidad el `total_pagado` y el `estado` para que
esta feature los actualice); 006-impresion-y-correo-factura (solo se referencia: el cierre ya emitió
las facturas del periodo cerrado sobre las que se paga); 001-fundacion (`clientes`, `perfiles`,
`configuracion` con `porcentaje_mora` y `dias_umbral_corte`); 003 (`usuarios_servicio`). Aplica las
reglas de `docs/ESPECIFICACION-FUNCIONAL.md §2.9/§2.10/§2.12/§2.15` y `CLAUDE.md §10` puntos 11 y
14. El esquema de referencia de `pagos`/`pago_aplicaciones` está en `docs/esquema-propuesto.sql §10`
(aún NO creado en Supabase: 005 dejó solo `facturas` con el enum `estado_factura`; el enum
`metodo_pago` y las tablas de pagos no existen todavía — se verificó contra la base local).

## 1. Objetivo

Registrar los **pagos de los suscriptores contra sus facturas** (005 ya las emitió) y mantener el
estado de cada factura al día de forma automática. Un pago puede ser **total o parcial** y puede
aplicarse a **una o varias facturas** del mismo suscriptor (por ejemplo, pagar la factura del mes más
parte de la deuda anterior). Al pagar se actualiza `facturas.total_pagado` y, cuando
`total_pagado = total`, el estado pasa a `pagada`. Un pago **no se borra**: se anula con motivo y
responsable, revirtiendo sus efectos. Sobre esta base se construyen el **reporte de cartera**
(pendiente y vencida por suscriptor, con días de mora) y el **historial de pagos** por factura y por
suscriptor, que alimentarán después al dashboard (2.15), a los cortes por mora (009) y al portal
(008).

## 2. Por qué ahora

Según el roadmap (`.specify/config.md`), 007 depende de 005 (cerrada) y precede a 008 (portal), 009
(cortes/reconexiones) y al dashboard. 005 dejó cada factura con `total_pagado = 0` y `estado =
'pendiente'`, y el plan de 005 reservó expresamente que *el estado `pagada` lo deriva 007*. Sin 007
no existe ni el recaudo, ni la cartera que dispara el recargo de mora del siguiente cierre (regla
11), ni los cortes por mora (009). Es el punto donde el ciclo económico del acueducto se cierra:
emitir (005) → entregar (006) → **cobrar (007)**.

## 3. Alcance

### 3.1 Esquema de pagos (`pagos` + `pago_aplicaciones`)
- Enum nuevo `metodo_pago`: `efectivo` · `transferencia` · `consignacion` · `pse` · `otro`
  (del `docs/esquema-propuesto.sql §10`).
- Tabla `pagos`: `cliente_id` (aislamiento), `usuario_servicio_id` (a quién se le abona),
  `valor` (`> 0`), `fecha_pago`, `metodo`, `referencia` (opcional: número de consignación/
  transferencia), `recibido_por` (perfil autenticado que registra), `anulado` (boolean),
  `motivo_anulacion`, `observaciones`, `created_at`.
- Tabla `pago_aplicaciones`: un renglón por cada factura a la que el pago abona: `pago_id`,
  `factura_id`, `valor` (`> 0`). Un pago puede tener **una o varias** aplicaciones.
- Integridad garantizada en la base (checks y transacción):
  - La suma de las aplicaciones de un pago **no supera** `pagos.valor`.
  - Una factura recibe aplicaciones solo por su **saldo pendiente** (`total − total_pagado`):
    aplicar de más genera el sobrante como remanente a favor (regla 3.3), nunca un `total_pagado > total`.
  - No se aplica un pago a una factura **anulada** ni a facturas de **otro suscriptor/acueducto**.
  - Un pago se registra **una sola vez** (no se duplica por reenvío).
- RLS `FORCE` + políticas del patrón 001–006: lectura para miembros del cliente/plataforma; escritura
  solo `admin_acueducto`. Índices por `(cliente_id, fecha_pago)` y por suscriptor de los pagos no
  anulados; `pago_aplicaciones` por `factura_id` y por `pago_id`.

### 3.2 Registro de un pago y su aplicación
- El administrador registra un pago de un suscriptor: valor, método (y referencia si aplica), fecha,
  observaciones. El valor se registra en **pesos sin centavos** (regla única de redondeo de
  `core/`, `CLAUDE.md §5.6`).
- Selecciona las facturas a abonar (del mismo suscriptor, no anuladas y con saldo pendiente) **o**
  deja que el sistema aplique por defecto a la **más antigua primero** (orden por
  `fecha_vencimiento` ascendente), que es la práctica usual del recaudo. Si indica facturas y sobra
  valor, se sigue aplicando a la siguiente factura pendiente más antigua del suscriptor.
- Pago **total**: cubre por completo una o varias facturas. Pago **parcial**: abona parte del saldo
  de una factura (queda saldo para el siguiente ciclo, que 005 arrastra como `saldo_anterior`).
- La operación es atómica: insertar el pago + sus aplicaciones y actualizar `facturas.total_pagado`
  de las facturas abonadas ocurre en una sola transacción, con bloqueo de las facturas afectadas para
  que dos pagos concurrentes no se pisen (la base nunca deja `total_pagado > total`).

### 3.3 Actualización automática del estado de la factura y sobrante
- Tras aplicar un pago:
  - `total_pagado = total` → estado **`pagada`**.
  - `total_pagado < total` → la factura **sigue sin pagar** (queda `pendiente`; en cartera se
    clasifica como vencida si ya pasó su `fecha_vencimiento`, ver 3.5). No hay estado intermedio.
- **Sobrante (regla 14):** si el valor del pago supera la suma de los saldos de las facturas a las
  que se aplica, el **remanente no se pierde**: queda a favor del suscriptor asociado al pago
  (aplicaciones < valor del pago) y es visible en la cartera del suscriptor y en su historial. La
  aplicación **automática** de ese saldo a favor al siguiente cierre (rebajando el total de la
  siguiente factura) queda fuera de esta feature (ver §4); en 007 el saldo a favor es consultable y
  se puede aplicar manualmente como abono a una factura posterior del mismo suscriptor.

### 3.4 Anulación de un pago
- Un pago **no se borra ni se edita**: se anula con `motivo_anulacion` obligatorio y el responsable
  identificado (perfil autenticado). Sin motivo → rechazo.
- Anular un pago **revierte sus aplicaciones**: resta el valor aplicado de `facturas.total_pagado`
  de cada factura abonada y recalcula el estado: si queda `total_pagado < total`, la factura vuelve a
  `pendiente` (y se reporta vencida si ya pasó su vencimiento); si la factura fue pagada por completo
  por otros pagos que no se anulan, conserva `pagada`.
- Operación atómica (misma transacción); el rastro queda en `pagos.anulado`/`motivo_anulacion` — el
  historial muestra el pago anulado, nunca lo borra.

### 3.5 Reporte de cartera por suscriptor
- Dado el acueducto, lista los suscriptores con deuda (facturas **no anuladas** con saldo
  `total − total_pagado > 0`), agrupando por suscriptor:
  - **Por vencer:** saldo de facturas `pendiente` cuya `fecha_vencimiento` no ha pasado.
  - **Vencida:** saldo de facturas `pendiente` cuya `fecha_vencimiento` ya pasó, con **días de mora**
    (`hoy − fecha_vencimiento`) y la antigüedad de la factura vencida más antigua.
  - Total adeudado por el suscriptor y estado actual del suscriptor (activo/suspendido/cortado).
- El estado efectivo **`vencida` se deriva de la fecha** (`pendiente` + `fecha_vencimiento < hoy`):
  no hay un job que mute masivamente el estado; la transición persistida a `pagada`/`anulada` ocurre
  solo por eventos (pago/anulación). La cartera alimenta el indicador "cartera vencida / usuarios en
  mora" (2.15) y, más adelante, los cortes automáticos (009).
- También expone el **saldo a favor** acumulado de cada suscriptor (remanente de pagos vigentes,
  regla 14).

### 3.6 Historial de pagos
- **Por factura:** todas las aplicaciones de esa factura (fecha, valor abonado, método, referencia,
  quién registró, estado del pago: vigente/anulado), el total pagado y el saldo pendiente.
- **Por suscriptor:** todos sus pagos (vigentes y anulados) con sus aplicaciones a cada factura y el
  valor sin aplicar (saldo a favor), ordenados por fecha.
- RLS: solo el propio acueducto (o plataforma) consulta; es la fuente que usará el portal del
  suscriptor (008).

### 3.7 Panel administrativo (frontend)
- Registrar pago desde el detalle de una factura y desde la vista de cartera del suscriptor (método,
  valor, referencia opcional, fecha, observaciones; selección de facturas con la aplicación por
  defecto a la más antigua).
- Vista de **cartera** del acueducto con el desglose por suscriptor (por vencer / vencida con días de
  mora / total) y el saldo a favor.
- Detalle de factura con su **historial de pagos** y la acción para anular un pago (motivo
  obligatorio).
- Vista de historial de pagos por suscriptor.

## 4. Fuera de alcance

- **Aplicación automática del saldo a favor al siguiente cierre** (descontar el sobrante del total de
  la factura nueva): toca el cálculo del cierre de 005 y se define cuando exista el flujo de saldos
  (iteración futura / 008). En 007 el saldo a favor queda registrado, visible y aplicable manualmente.
- **Notificación de "confirmación de pago"** (evento de 2.12) y su envío por correo: subsistema de
  notificaciones/plantillas, feature 010. 007 no crea filas en `notificaciones`.
- **Recibo/constancia de pago dedicado**: no hay plantilla de recibo en esta feature (la vista del
  pago es imprimible con `@media print` del panel).
- **Indicadores del dashboard** (2.15: recaudo del mes, usuarios en mora, tendencias): feature de
  dashboard; la cartera de 007 es su fuente.
- **Cortes y reconexiones por mora** (2.11): feature 009; consume la cartera de 007.
- **Portal del suscriptor** (2.13: que el suscriptor vea su cartera/historial): feature 008; 007 solo
  expone las consultas que ese portal consumirá.
- **Pasarelas de pago en línea / conciliación bancaria**: fase posterior (el funcional lo declara
  fuera del sistema en §4).
- **Recálculo del recargo de mora de facturas ya emitidas** más allá de lo que el siguiente cierre
  (005) cobra por regla 11: 007 no modifica `recargo_mora` de facturas emitidas.
- **Edición de un pago**: no existe; solo anulación con motivo.

## 5. Reglas de negocio que aplican

De `docs/ESPECIFICACION-FUNCIONAL.md`:
- §2.9 — Estados de la factura (`pendiente`·`pagada`·`vencida`·`anulada`); la factura emitida es
  **inmutable**; el saldo vivo de una factura es `total − total_pagado` y el siguiente cierre lo
  arrastra como `saldo_anterior`.
- §2.10 — **Pago**: aplica a una o varias facturas; puede sobrar y el sobrante va a favor del
  suscriptor para la siguiente factura; registrar un pago **actualiza el estado de la factura
  automáticamente**; un pago **no se borra: se anula** con motivo y responsable.
- §2.12 — La "confirmación de pago" es un evento de notificación (fuera de alcance, 010).
- §2.15 — La **cartera vencida** se define como el total de facturas vencidas o pendientes con mora,
  y los **usuarios en mora** son suscriptores con deuda vencida; la cartera de 007 es su fuente.
- §4 — Sin pasarelas de pago en línea (fuera del sistema).

De `CLAUDE.md`:
- §5.6 — Dinero en `numeric`, redondeo a la unidad definido una sola vez en `core/` y testeado; una
  factura emitida es inmutable; **un pago no se borra: se anula**.
- §5.3 — La lógica de distribución/anulación de pagos que calcula dinero va en `core/` (pura,
  testeada con `vitest`), no en una ruta ni en SQL ad-hoc.
- §5.4 — Tablas nuevas con `cliente_id` y RLS `FORCE` + test de aislamiento en la misma feature.
- §10 punto 11 — El recargo por mora del cierre usa el **saldo vencido del mismo suscriptor
  excluyendo la factura actual**: ese saldo vencido lo calcula la cartera de 007.
- §10 punto 14 — **Pago parcial y sobrante**: el sobrante no se pierde.
- §8 — Si algo no se puede verificar (flujo en navegador, etc.), se declara NO VERIFICADO con pasos
  exactos; nunca "debería funcionar".

Del esquema de referencia (`docs/esquema-propuesto.sql §10`): tablas `pagos` y `pago_aplicaciones`
con `metodo_pago`, FKs y checks `valor > 0`; la suma aplicada por pago no excede su `valor`.

## 6. Criterios de aceptación

Cada uno cerrado con evidencia ejecutada y pegada.

### CA-1 — Migración: `metodo_pago` + `pagos` + `pago_aplicaciones`
Migración versionada crea el enum `metodo_pago` y las tablas `pagos`/`pago_aplicaciones` (de
`docs/esquema-propuesto.sql §10`) con `cliente_id`, RLS `FORCE`, FKs coherentes (`usuarios_servicio`
RESTRICT; `perfiles` para `recibido_por`; `facturas` RESTRICT en aplicaciones), los checks
(`valor > 0`; suma de aplicaciones `<= pagos.valor`; no aplicar más del saldo de la factura; no
aplicar a anuladas ni de otro suscriptor) e índices. Verificado contra Supabase local real
(`supabase db reset --local`) + `\d pagos`/`\d pago_aplicaciones` + un INSERT que viola cada check.

### CA-2 — Test de aislamiento de las tablas de pagos
El acueducto A no lee/escribe pagos de B; el `admin_acueducto` registra y anula pagos de su cliente;
el `lector` lee su cliente pero **no** escribe pagos. Archivo
`tests/aislamiento/007_pagos_aislamiento.sql` + fixtures de pagos. Regresión de 001–006 en verde
sobre el mismo estado final.

### CA-3 — Registrar pagos (total, parcial y a varias facturas) y actualizar la factura
- Pago total de una factura → `total_pagado = total`, estado `pagada`.
- Pago parcial → `total_pagado` crece, la factura sigue sin pagar (`pendiente`).
- Pago que abona a **varias** facturas (deuda del mes + saldo de la anterior) → cada factura recibe
  su abono y las cubiertas pasan a `pagada`.
- Pago de un suscriptor que intenta aplicar a facturas de otro suscriptor/acueducto o a una anulada →
  rechazo (400/409) sin efectos parciales.
Verificación real con curl/wrangler dev contra Supabase local (factura real del fixture de 005) y
consulta SQL del estado final.

### CA-4 — Sobrante a favor del suscriptor
Un pago mayor que la deuda de las facturas indicadas deja el remanente **a favor del suscriptor**:
la suma de las aplicaciones es menor que `pagos.valor`, no se pierde, aparece en la cartera como
saldo a favor y puede aplicarse como abono a una factura posterior del mismo suscriptor. La base
nunca deja `total_pagado > total`. Verificación real contra la base.

### CA-5 — Anulación de un pago
Anular un pago sin motivo → rechazo. Con motivo y responsable → revierte sus aplicaciones
(`total_pagado` se resta) y el estado de las facturas afectadas se recalcula (vuelven a `pendiente` o
se mantienen `pagada` si otros pagos las cubren). El pago anulado permanece visible en el historial
con su motivo. Verificación real contra la base.

### CA-6 — Reporte de cartera y estado derivado `vencida`
El reporte por suscriptor del acueducto devuelve, por suscriptor con deuda: por vencer, vencida (con
días de mora y antigüedad de la factura más vieja), total adeudado y saldo a favor. Una factura
`pendiente` con `fecha_vencimiento` pasada se clasifica **vencida** (derivada de la fecha) y cuadra
con `Σ(total − total_pagado)` de las facturas no anuladas. Verificación real con una factura del
fixture cuyo vencimiento ya pasó (consulta SQL + endpoint).

### CA-7 — Historial de pagos por factura y por suscriptor
El historial de una factura muestra sus aplicaciones (fecha, valor, método, referencia, quién
registró, si el pago fue anulado) y el saldo. El historial de un suscriptor muestra todos sus pagos
(vigentes y anulados) con sus aplicaciones y el valor sin aplicar. Verificación real con curl.

### CA-8 — Panel administrativo
Registrar pago (desde el detalle de la factura y desde la cartera del suscriptor), vista de cartera,
historiales y anulación de pago en la UI. `npm run build`/`lint` limpios. El flujo click-a-click
queda "NO VERIFICADO — requiere validación manual de Mateo: [pasos con `next dev` + `wrangler dev`]"
si el entorno no permite correr ambos.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un pago se registra dos veces (reenvío del request) o dos pagos concurrentes duplican el abono | Registro atómico en una transacción con bloqueo de las facturas afectadas; la base nunca permite `total_pagado > total` ni aplicar por más del saldo; la idempotencia del registro se define en el plan |
| Un error de caja (valor, factura equivocada) queda sin corregir | El pago nunca se borra/edita: se anula con motivo y responsable, revirtiendo aplicaciones con trazabilidad completa (regla del funcional §2.10) |
| Anular un pago deja la factura con estado incorrecto (p. ej. `pagada` sin estar cubierta) | El recálculo del estado es parte de la misma transacción y se testea en CA-5 (incluye el caso de varios pagos sobre la misma factura) |
| El sobrante se pierde o se mezcla entre suscriptores | El remanente queda atado al pago y al suscriptor (checks + RLS); la cartera y el historial lo exponen; la aplicación automática al cierre es futura y documentada |
| El estado `vencida` exige un job/cron y se desfasa | Se **deriva** de `fecha_vencimiento` en las consultas de cartera (sin job): siempre está al día; la transición persistida solo ocurre por eventos de pago/anulación |
| La cartera filtra datos entre acueductos o muestra deudas de facturas anuladas | RLS `FORCE` por `cliente_id` + filtro de facturas no anuladas con saldo > 0 (testeado en CA-2 y CA-6) |
| Redondear en la ruta en vez de en `core/` (regla única) | La validación/redondeo del valor del pago vive en `core/` con unit tests (§5.3/§5.6) |
| El reporte de cartera es lento con muchos suscriptores en el fetch del Worker | Consultas acotadas al `cliente_id` con los índices de (3.1) y paginación; sin procesar lotes en una sola invocación (regla 5.5) |

## 8. Definición de terminado

- [ ] Todos los CA (1-8) con evidencia real — CA-1 a CA-7 contra Supabase local + curl/wrangler dev;
      CA-8 (flujo en navegador) con pasos exactos si el entorno no permite `next dev` + `wrangler dev`.
- [ ] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios.
- [ ] Tests en verde: unit de la lógica de pagos de `core/` + test de aislamiento `007_pagos` con
      regresión de 001-006.
- [ ] Test de aislamiento de las tablas nuevas (`pagos`, `pago_aplicaciones`) en verde.
- [ ] `CHANGELOG.md` actualizado en el cierre de la feature.
- [ ] Aprobación explícita de Mateo — spec, plan y tasks aprobados antes de cada fase.
- [ ] Un commit por tarea completada y verificada; sin `git push` (Mateo lo aplica / bundle si aplica).





