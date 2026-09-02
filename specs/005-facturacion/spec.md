# SPEC — 005: facturacion

**Estado:** Borrador para aprobación
**Depende de:** 004-lecturas-y-consumo (tabla `periodos` con estado `abierto`/`cerrado`; tabla
`lecturas` con `consumo_m3`/`revision`; `id_cliente_offline`); 003-suscriptores-contadores
(`usuarios_servicio`, `contadores`); 002-catalogo-y-tarifas (servicios, tarifas con
`limite_basico_m3` INCLUSIVO D-1, función `tarifa_vigente()`); 001-fundacion (tabla `configuracion`
con `prefijo_factura`, `consecutivo_factura`, `anio_consecutivo`, `porcentaje_mora`,
`dias_vencimiento`; RLS, funciones de seguridad).

## 1. Objetivo

Implementar el **cierre de facturación** del periodo: calcular y emitir las facturas de tipo `ciclo`
de todos los suscriptores del acueducto, sobre el consumo ya registrado en 004, con las tarifas
vigentes de 002. El cierre tiene dos modos obligatorios — **simulación** (dry-run: calcula todo sin
persistir, presenta resumen agregado y la lista de anomalías) y **emisión** (solo se habilita después
de haber corrido la simulación y la confirmación explícita del administrador) — porque ninguna
factura llega a un suscriptor sin que un humano haya visto el resumen (ESTRATEGIA-CALIDAD §4, la
funcionalidad de mayor retorno del sistema). El cierre masivo **nunca** se procesa en una sola
invocación de Worker: se encola una factura por mensaje en Cloudflare Queues (`CLAUDE.md §5.5`,
`INFRAESTRUCTURA.md §11`). El número de factura se genera en transacción atómica
(`SELECT FOR UPDATE` sobre `configuracion`, `CLAUDE.md §10` punto 9b) con el formato D-3.

## 2. Por qué ahora

Según el roadmap (`.specify/config.md`), 005-facturacion depende de 004 (ya cerrada) y es el
prerequisito de 006 (impresión/correo de factura), 007 (pagos), 008 (portal), 009 (cortes).
Cada feature anterior dejó dispuesta su pieza: 004 deja lecturas con `consumo_m3` calculado y
`periodos` con estado `cerrado` cuando el admin cierra; 002 deja `tarifa_vigente()` y `core/tarifas.ts`
(fórmula D-1); 001 deja la `configuracion` con los prefijos/consecutivo/mora/días de vencimiento.
005 es el punto donde **ese consumo se convierte en dinero cobrado** — el corazón del negocio, y el
primer lugar donde un error de tarifa cobra de más a una familia de estrato 1. Por eso el modo de
simulación y las invariantes de integridad son innegociables.
## 3. Alcance

### 3.1 Esquema de facturación
- Enums nuevos `tipo_factura` (`ciclo`·`reconexion`·`ajuste`) y `estado_factura`
  (`pendiente`·`pagada`·`vencida`·`anulada`), del `docs/esquema-propuesto.sql §9`.
- Tabla `facturas`: `usuario_servicio_id` (FK `ON DELETE RESTRICT`), `periodo_id` (FK `ON DELETE
  RESTRICT`, NULL para `reconexion`/`ajuste` fuera de ciclo), `tipo`, `numero` (único por cliente),
  `snapshot_suscriptor` (jsonb inmutable: nombre, dirección, categoría, código y estado al emitir),
  `consumo_m3`, `subtotal_servicios`, `recargo_mora`, `saldo_anterior`, `total`, `total_pagado`
  (default 0), `fecha_emision`, `fecha_vencimiento`, `estado`, `motivo_anulacion`, `anulada_por`,
  `pdf_url` (lo puebla 006).
- **Una sola factura `ciclo` por suscriptor y periodo** — índice único parcial
  `uq_factura_ciclo` sobre `(usuario_servicio_id, periodo_id) where tipo = 'ciclo'`.
- Tabla `factura_detalles`: un renglón por servicio activo del acueducto, **todos** sobre el mismo
  `consumo_m3` (`factura_id` ON DELETE CASCADE; `servicio_id`/`tarifa_id` como referencia
  **permanente**, ON DELETE SET NULL — nunca se borran, se mantiene el rastro). Guarda cantidades y
  valores por bloque (básico/no básico) para auditar el cálculo años después
  (`factura_detalles` de `docs/esquema-propuesto.sql §9`).
- Tabla `factura_lecturas`: vínculo factura ↔ lectura(s). Una factura `ciclo` puede consumir una o
  **dos** lecturas (caso reemplazo de contador a mitad de periodo, 004).
- RLS `FORCE` en las 3 tablas + políticas (mismo patrón de 001–004): lectura para miembros del
  cliente o plataforma; escritura solo `admin_acueducto`.

### 3.2 Cálculo puro (`core/facturacion.ts`)
- Lógica pura sin Hono/Cloudflare/Supabase (`CLAUDE.md §5.3`). Reutiliza `core/tarifas.ts`
  (`calcularSubtotalServicio`, fórmula D-1).
- Funciones obligatorias (firmas en `/plan`):
  - Subtotal por servicio: valor básico + valor no básico + cargo fijo, sobre el mismo `consumo_m3`.
  - `recargo_mora`: `porcentaje_mora %` sobre el saldo vencido del **mismo** suscriptor,
    **excluyendo la factura actual** (el saldo real lo computa 007; 005 calcula la fórmula sobre el
    dato de deuda previa del suscriptor).
  - Composición del total: `total = subtotal_servicios + recargo_mora + saldo_anterior`.
  - Redondeo a la unidad del peso una sola vez, al final (CLAUDE.md §5.6).
- El número de factura (`{prefijo}-{YYYY}-{NNNNN}`, D-3) se compone **fuera** de `core/` (depende de
  la transacción sobre `configuracion`), pero su formato y la validación del consecutivo anual se
  testean.

### 3.3 Cierre de facturación (simulación + emisión vía Queues)
- **Modo simulación (dry-run):** calcula para cada suscriptor del periodo su factura de ciclo SIN
  persistir nada. Devuelve un resumen agregado (total de usuarios, consumo total, facturación
  total, comparación contra el periodo anterior) y la lista de anomalías (consumo atípico, consumo
  cero, lectura menor sin rollover, usuario sin lectura, sin tarifa configurada, factura de valor
  cero o negativo, variación total > 20%). **Nada se inserta.**
- **Modo emisión:** solo se habilita tras haber corrido la simulación del mismo periodo, con
  confirmación explícita del admin. Encargo **una factura por mensaje** en Cloudflare Queues
  (`CLAUDE.md §5.5`, `INFRAESTRUCTURA.md §11`); el consumidor (`backend/src/queues/cierre-facturacion.ts`,
  que la feature crea) procesa cada mensaje y emite esa factura.
- **Regla 9d:** si `tarifa_vigente()` devuelve NULL (suscriptor sin tarifa configurada), el cierre
  registra la anomalía y **no emite** la factura de ese suscriptor.
- El suscriptor cortado (estado `cortado`) sale del ciclo normal de facturación (005 no emite para
  él); el flujo de cortes/reconexiones es 009.
- Número de factura en transacción atómica: `SELECT FOR UPDATE` sobre la fila de `configuracion`
  del cliente antes de incrementar `consecutivo_factura`; el único `(cliente_id, numero)` garantiza
  unicidad. El consecutivo reinicia el 1 de enero (comparando `anio_consecutivo` con el año actual).


### 3.4 Inmutabilidad y anulación
- Una factura emitida es **inmutable**: no se editan `subtotal`/`total`/`consumo` por la API. Solo se
  cambia el `estado` (a `anulada`) con `motivo_anulacion` y `anulada_por`, o — al recibir pagos
  (007) — el `total_pagado` y el estado derivado `pagada`.
- Anular una factura mal emitida: `estado = 'anulada'`, con motivo y responsable. El periodo cerrado
  **no se reabre**; la corrección se emite como una factura de tipo `ajuste` en un periodo
  `abierto` posterior (alcance de 005: permitir la creación de una factura de ajuste manual
  administrativa; la corrección automática auditada queda documentada para fases de facturación
  avanzada).

### 3.5 Triggers de integridad (ESTRATEGIA-CALIDAD §2)
- `facturas.total` se calcula en la ruta/cierre y se valida en la base contra la suma de
  `factura_detalles.subtotal` (trigger `BEFORE INSERT OR UPDATE` que recalcula o rechaza si no
  coincide, según el diseño de `/plan`).
- No se puede emitir ni modificar una `facturas` de un `periodo` `cerrado` (trigger/constraint).
- `total_pagado` nunca supera `total` (check). El estado `pagada`/`vencida` lo derivará 007 al
  aplicar pagos; en 005 el estado nace `pendiente`.

### 3.6 Frontend admin
- Panel `/app/facturacion`: seleccionar el periodo cerrado → botón **Simular** → ver el resumen
  agregado + la lista de anomalías → botón **Confirmar emisión** (solo visible si el periodo ya fue
  simulado y está en estado no emitido) → listado de facturas emitidas con sus totales.
- Vista de una factura (detalle + renglones + `snapshot_suscriptor`). La **impresión** y el PDF son
  de 006 (D-8/D-9), no de 005.


## 4. Fuera de alcance

- **Pagos, cartera y mora real** (`pagos`, `pago_aplicaciones`, aplicación de pagos a varias
  facturas, sobrante, derivación del estado `pagada`/`vencida`) — feature 007.
- **Impresión, PDF y envío por correo de la factura** (D-8/D-9) — feature 006.
- **Factura de reconexión** (se genera al reconectar) y cortes/reconexiones — feature 009. El valor
  de `tipo = 'reconexion'` existe en el enum y no tiene flujo propio en 005.
- **Portal del suscriptor y su sesión propia** — feature 008.
- **Dashboard de indicadores** (consumo promedio, recaudo, cartera) — feature 011.
- **Notificaciones transaccionales** — feature 010.
- **Auditoría formal de todos los cambios de facturas** — se ancla en los triggers de integridad y
  el `snapshot_suscriptor`; una tabla de `auditoria` completa es de una fase posterior.
- **Suscriptor con saldo/cartera** (recargo de mora real sobre deuda) — requiere 007; 005 calcula la
  fórmula sobre el dato de deuda previa pero no administra pagos.

## 5. Reglas de negocio que aplican

De `CLAUDE.md §10` (sección **Facturación**):
- 9. **Un solo periodo abierto por cliente** (ya garantizado en 004).
- 9b. **Número de factura generado en transacción atómica.** `SELECT FOR UPDATE` sobre
  `configuracion` antes de incrementar `consecutivo_factura`.
- 9c. **Consecutivo reinicia el 1 de enero.**
- 9d. **Suscriptor sin tarifa configurada.** Si `tarifa_vigente()` devuelve NULL, el cierre registra
  la anomalía y **no emite** la factura.
- 10. **Desglose por servicio.** Cada servicio activo genera su renglón sobre el **mismo**
  `consumo_m3`.
- 11. **Recargo por mora.** `porcentaje_mora %` sobre el saldo vencido del **mismo** suscriptor,
  **excluyendo la factura actual**.
- 12. **Tarifa vigente.** Se usa la vigente en la fecha del periodo, registrada en
  `factura_detalles.tarifa_id`.
- 13. **Cambio de categoría.** Las facturas históricas no se alteran: se usa
  `facturas.snapshot_suscriptor`.
- 15. **`limite_basico_m3` es INCLUSIVO** (D-1). Testear el límite exacto, uno menos y uno más.

De `docs/ESPECIFICACION-FUNCIONAL.md §2.9`:
- Tipos `ciclo`/`reconexion`/`ajuste`; **una sola factura `ciclo` por suscriptor y periodo**.
- Formato de número D-3 `{prefijo}-{YYYY}-{NNNNN}` (5 dígitos, reinicia cada año; ciclo y reconexión
  comparten consecutivo anual con prefijos distintos).
- Composición: `total = subtotal_servicios + recargo_mora + saldo_anterior`.
- `snapshot_suscriptor` inmutable (nombre, dirección, categoría, código).
- Estados `pendiente`·`pagada`·`vencida`·`anulada`; emisión inmutable.

De `docs/ESTRATEGIA-CALIDAD.md §2` (invariantes trigger), `§4` (modo simulación y emisión, ninguna
factura sin resumen humano) y `§5` (unit de `core/facturacion.ts`: suma de renglones, saldo anterior,
mora excluyendo la factura actual).

De `CLAUDE.md §5.5` y `INFRAESTRUCTURA.md §11`: el cierre masivo de facturación va por Cloudflare
Queues, una factura por mensaje; **nunca** un lote completo en una sola invocación de fetch.

De `docs/DECISIONES.md`: **D-1** (límite básico inclusivo); **D-3** (formato de número de factura y
consecutivo anual atómico); **D-5** (las tarifas de los fixtures son provisionales, nunca se
presentan como reales — aplica a cualquier caso del dataset de pruebas de simulación).


## 6. Criterios de aceptación

Cada uno cerrado con evidencia ejecutada y pegada.

### CA-1 — Migración: enums + tablas `facturas`/`factura_detalles`/`factura_lecturas`
Migración versionada crea enums `tipo_factura`/`estado_factura` y las 3 tablas con RLS `FORCE`,
las FKs (`ON DELETE RESTRICT` a `usuarios_servicio`/`periodos`/`tarifas`; `CASCADE` a
`factura_detalles`/`factura_lecturas`), el índice único parcial `uq_factura_ciclo`, el unique
`(cliente_id, numero)`, los checks (`total_pagado <= total`) y los triggers de integridad
(no emitir de periodo cerrado; `total` = suma de detalles). Verificado contra Supabase local real
(`supabase db reset --local`, patrón 004) + `\d facturas`/`\d factura_detalles`.

### CA-2 — Test de aislamiento de las tablas de facturación
El acueducto A no lee/escribe facturas de B; el `admin_acueducto` puede crear/anular facturas de su
cliente; el `lector` lee su cliente pero no escribe facturas; un `numero` duplicado del cliente y un
segundo `ciclo` del mismo `(usuario_servicio, periodo)` violan sus unique. Archivo
`tests/aislamiento/005_facturacion_aislamiento.sql` + fixtures `facturacion.sql` que completan los
de 001–004. Regresión de 001–004 en verde sobre el mismo estado final.

### CA-3 — `core/facturacion.ts` (unit, `vitest`)
Tests de: subtotal por servicio sobre un mismo `consumo_m3` (reusa `core/tarifas.ts`, D-1 límite
inclusivo exacto/±1); `recargo_mora` excluyendo la factura actual; `saldo_anterior`; composición del
`total`; `snapshot_suscriptor`; y que el redondeo del peso se aplica una sola vez al final. `npm
test` en verde (sin Workers ni base).

### CA-4 — Simulación (dry-run) y número de factura atómico
- La simulación de un periodo con datos calcula el resumen agregado y la lista de anomalías, y
  **no inserta** ninguna fila en `facturas`.
- El `numero` se genera como `{prefijo}-{YYYY}-{NNNNN}` con consecutivo de 5 dígitos y reinicio
  anual (D-3); un INSERT directo de un `numero` duplicado del cliente se rechaza.
- Dos emisiones concurrentes no producen números duplicados (unicidad garantizada por el único y la
  transacción `SELECT FOR UPDATE` sobre `configuracion`).
Verificado contra Supabase local real + `vitest`/integración; el cierre por Queues (worker real) y
el flujo en navegador quedan "NO VERIFICADO" si el entorno no permite correr el consumidor, con
pasos exactos.

### CA-5 — Emisión inmutable y anulación
Una factura emitida no se puede editar en `subtotal`/`total`/`consumo` (rechazo). Se puede **anular**
con `motivo_anulacion` y `anulada_por`; anulada NO se reemite sobre el mismo periodo cerrado; la
corrección se crea como `ajuste` en un periodo abierto. `total_pagado > total` y un `ciclo` duplicado
se rechazan por la base. Verificación real contra la base.

### CA-6 — Frontend: panel de facturación
`/app/facturacion` protegido por el middleware: seleccionar periodo cerrado → simular (resumen +
anomalías) → confirmar emisión (solo tras simular) → listado de facturas. `npm run build`/`lint`
limpios; flujo en navegador "NO VERIFICADO" si el entorno no permite, con los pasos exactos.


## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un error de tarifa (límite, redondeo, bloque) cobra de más a una familia | `core/facturacion.ts` + `core/tarifas.ts` unit-testados con casos límite (D-1 exacto/±1) y el modo simulación fuerza a un humano a ver el resumen antes de emitir (ESTRATEGIA-CALIDAD §4). Tolerancia cero en los campos monetarios frente al cálculo esperado |
| Emitir con un número duplicado o un segundo `ciclo` rompería la integridad | Unique `(cliente_id, numero)` + `uq_factura_ciclo` en la base, y el consecutivo atómico con `SELECT FOR UPDATE` (CLAUDE.md §10 punto 9b) |
| Procesar el cierre masivo en un solo fetch agota el tiempo/CPU del Worker | El cierre encola **una factura por mensaje** en Cloudflare Queues; el consumidor procesa en batches. Regla innegociable de CLAUDE.md §5.5 |
| Emitir facturas de un periodo que aún no fue simulado (protege contra errores del admin) | La emisión solo se habilita tras correr la simulación del mismo periodo; se marca en estado no emitido y requiere confirmación explícita |
| Emitir factura a un suscriptor sin tarifa configurada (duplicaría la regla del cierre) | `tarifa_vigente()` regresa NULL → el cierre registra la anomalía y **no emite** (CLAUDE.md §10 punto 9d). La única fuente de verdad del bloqueo es esa función |
| Modificar/borrar cantidades de una factura ya emitida | Inmutabilidad: la API no edita valores; la base rechaza cambios en periodo cerrado; la anulación exige motivo y responsable. `snapshot_suscriptor` y `factura_detalles` preservan el cálculo por siempre |
| Los fixtures usan tarifas "provisionales" y se confunden con reales | D-5: ningún caso del dataset de simulación se presenta como tarifa real; queda marcado |

## 8. Definición de terminado

- [ ] Todos los CA (1–6) con evidencia — CA-1 a CA-5 verificados contra Supabase local real + tests
  de aislamiento/unit; CA-4 y CA-6 (Queues real y navegador) con su estado real y pasos exactos si
  el entorno no permite
- [ ] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios
- [ ] Tests en verde: `vitest` de `core/facturacion.ts` + test de aislamiento `005_facturacion`
- [ ] Test de aislamiento de las tablas nuevas (`facturas`, `factura_detalles`, `factura_lecturas`)
  con regresión de 001–004 en verde
- [ ] `CHANGELOG.md` actualizado en el cierre de la feature
- [ ] Aprobación explícita de Mateo — spec, plan y tasks aprobados antes de cada fase
- [ ] Un commit por tarea completada y verificada; sin `git push` (Mateo lo aplica / bundle si aplica)

