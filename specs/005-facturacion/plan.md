# PLAN — 005: facturacion

**Spec aprobado:** 2026-09-05 (ver `specs/005-facturacion/spec.md`, 6 criterios de aceptación)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` ni código hasta esa aprobación.

---

## 0. Punto de partida

De `supabase/migrations/20260831150000_fundacion-tenancy.sql` (001), reutilizado sin tocar:
- `configuracion` con `prefijo_factura`, `prefijo_reconexion`, `consecutivo_factura`,
  `anio_consecutivo`, `porcentaje_mora`, `dias_vencimiento` (D-3 y punto 9b/9c).
- Funciones de seguridad `es_admin_de`, `mis_clientes`, `tiene_rol`, `es_admin_plataforma`, y el
  patrón de trigger `set_updated_at`.

De `supabase/migrations/20260901120000_catalogo-y-tarifas.sql` (002), reutilizado sin tocar:
- Tablas `servicios`/`tarifas`, función `tarifa_vigente()`, enum `categoria_tarifaria`/`tipo_calculo`,
  y `core/tarifas.ts` (`calcularSubtotalServicio`, D-1) con sus unit tests.

De `supabase/migrations/20260902090000_suscriptores-contadores.sql` (003):
- `usuarios_servicio`, `contadores`, `reemplazos_contador` (datos del suscriptor para el snapshot).

De `supabase/migrations/20260904090000_lecturas-consumo.sql` (004):
- `periodos` (con `cerrado` y trigger de periodo cerrado) y `lecturas` (`consumo_m3`, `revision`,
  `id_cliente_offline`).

**NO existe todavía** (lo crea 005, `docs/esquema-propuesto.sql §9`): enums `tipo_factura`/
`estado_factura`, tablas `facturas`/`factura_detalles`/`factura_lecturas`, y `backend/src/queues/`
(consumidor de Cloudflare Queues, reservado en `CLAUDE.md §5.1`).

### Nota de entorno (verificado 2026-09-05)

Se demostró empíricamente con un mini-worker temporal que **Cloudflare Queues funciona en local**
con `wrangler dev` (miniflare/workerd 4.86.0): al declarar `[[queues.producers]]` y
`[[queues.consumers]]` de la misma cola, `env.MI_COLA.send(...)` dispara la función `queue(batch, env)`
automáticamente en el mismo worker. No hay credenciales de Cuenta Cloudflare en el entorno (sin
`~/.wrangler/config`), así que las colas remotas reales / `wrangler queues list` NO están disponibles;
el despliegue real a Cloudflare y la latencia/cron en la nube son el pendiente de Mateo.

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260905090000_facturacion.sql` | crear | enums `tipo_factura`/`estado_factura`; tablas `facturas` (con `uq_factura_ciclo`, unique `(cliente_id, numero)`, check `total_pagado <= total`, FKs `ON DELETE RESTRICT`), `factura_detalles` (CASCADE a factura, `tarifa_id`/`servicio_id` SET NULL permanente), `factura_lecturas` (PK compuesta); triggers de integridad (no emitir/modificar de periodo cerrado; `total` = suma de detalles); RLS `FORCE` + políticas |
| `tests/fixtures/facturacion.sql` | crear | periodos con lecturas, servicios/tarifas y suscriptores listos para un cierre de simulación/emisión |
| `tests/aislamiento/005_facturacion_aislamiento.sql` | crear | CA-2 (aislamiento RLS + unique + regla `uq_factura_ciclo`) |
| `backend/src/core/facturacion.ts` | crear | Cálculo puro: subtotal por servicio (reusa `core/tarifas.ts`), recargo mora excluyendo factura actual, saldo anterior, total, snapshot del suscriptor, redondeo del peso una sola vez |
| `backend/tests/unit/facturacion.test.ts` | crear | CA-3 (unit) |
| `backend/src/queues/cierre-facturacion.ts` | crear | Consumidor de Cloudflare Queues: recibe un mensaje por factura y la emite |
| `backend/src/lib/facturacion.ts` | crear | Capa fina de acceso a datos para simulación/emisión/anulación (sin lógica de negocio) |
| `backend/wrangler.facturacion.toml` | crear | Worker consumidor del cierre (producer+consumer de la cola de facturación), mismo patrón que `wrangler.monitor-db.toml` |
| `backend/src/index.ts` | editar | Rutas del panel de facturación (simular/emitir/listar/anular) |
| `frontend/lib/api.ts` | editar | Funciones de facturación |
| `frontend/app/app/facturacion/page.tsx` | crear | Panel `/app/facturacion` (CA-6) |
| `frontend/app/app/facturacion/[facturaId]/page.tsx` | crear | Vista de detalle de una factura |
| `CHANGELOG.md` | editar | Cierre de la feature |
## 2. Esquema de base de datos

### Migraciones

| Archivo | Contenido |
|---|---|
| `20260905090000_facturacion.sql` | `create type tipo_factura` (`ciclo`/`reconexion`/`ajuste`) y `estado_factura` (`pendiente`/`pagada`/`vencida`/`anulada`); tabla `facturas` con unique `(cliente_id, numero)` + índice parcial `uq_factura_ciclo` + check `total_pagado <= total`; tabla `factura_detalles` (referencia permanente `tarifa_id`/`servicio_id`, `ON DELETE SET NULL`); tabla `factura_lecturas` (PK `(factura_id, lectura_id)`); funciones+triggers de integridad; RLS `FORCE` + políticas |

### Tablas

```sql
create type tipo_factura    as enum ('ciclo','reconexion','ajuste');
create type estado_factura  as enum ('pendiente','pagada','vencida','anulada');

create table facturas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  periodo_id          uuid references periodos(id) on delete restrict, -- null en reconexion/ajuste fuera de ciclo
  tipo                tipo_factura not null default 'ciclo',
  numero              text not null,                -- {prefijo}-{YYYY}-{NNNNN} (D-3)
  snapshot_suscriptor jsonb not null,               -- datos del suscriptor al emitir (nombre, dirección, categoría, código, estado)
  consumo_m3          numeric(12,2) not null default 0,
  subtotal_servicios  numeric(12,2) not null default 0,
  recargo_mora        numeric(12,2) not null default 0,
  saldo_anterior      numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0,
  total_pagado        numeric(12,2) not null default 0,
  fecha_emision       date not null default current_date,
  fecha_vencimiento   date not null,
  estado              estado_factura not null default 'pendiente',
  motivo_anulacion    text,
  anulada_por         uuid references perfiles(id),
  pdf_url             text,                          -- lo puebla la feature 006
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (cliente_id, numero),
  constraint chk_total_pagado check (total_pagado <= total)
);
create unique index uq_factura_ciclo
  on facturas (usuario_servicio_id, periodo_id) where tipo = 'ciclo';
create index on facturas (cliente_id, estado);
create index on facturas (usuario_servicio_id, fecha_emision desc);

create table factura_detalles (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references clientes(id) on delete cascade,
  factura_id           uuid not null references facturas(id) on delete cascade,
  servicio_id          uuid references servicios(id) on delete set null, -- referencia permanente
  tarifa_id            uuid references tarifas(id) on delete set null,   -- referencia permanente
  orden                smallint not null default 0,
  descripcion          text not null,
  tipo_calculo         tipo_calculo not null,
  consumo_m3           numeric(12,2) not null default 0,
  cargo_fijo           numeric(12,2) not null default 0,
  consumo_basico_m3    numeric(12,2) not null default 0,
  valor_basico         numeric(12,2) not null default 0,
  consumo_no_basico_m3 numeric(12,2) not null default 0,
  valor_no_basico      numeric(12,2) not null default 0,
  subtotal             numeric(12,2) not null default 0
);
create index on factura_detalles (factura_id, orden);

create table factura_lecturas (
  factura_id uuid not null references facturas(id) on delete cascade,
  lectura_id uuid not null references lecturas(id) on delete restrict,
  cliente_id uuid not null references clientes(id) on delete cascade,
  primary key (factura_id, lectura_id)
);
```

### Triggers de integridad (ESTRATEGIA-CALIDAD §2)

1. **No emitir/modificar facturas de un periodo cerrado** (`trg_factura_periodo_cerrado`,
   `BEFORE INSERT OR UPDATE` sobre `facturas`): si `NEW.periodo_id` referencia un periodo con
   `estado = 'cerrado'`, la operación se rechaza, CON la excepción de la anulación (update que solo
   pone `estado = 'anulada'` con motivo/responsable — corregir algo de un periodo cerrado se hace
   anulándolo, no reabriéndolo). Mismo patrón `SECURITY DEFINER` acotado que 004 usó en lecturas.
2. **`facturas.total` consistente con `factura_detalles`** — decisión en §5 (recalcular por trigger
   `AFTER` en `factura_detalles`, `SECURITY DEFINER` al dueño).
3. Check `total_pagado <= total` ya en la tabla (el estado `pagada` lo deriva 007).

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| `POST` | `/facturacion/periodos/:id/simular` | admin_acueducto | Modo simulación (dry-run). No persiste; devuelve resumen agregado + anomalías |
| `POST` | `/facturacion/periodos/:id/emitir` | admin_acueducto | Modo emisión. Solo si el periodo ya fue simulado y no está emitido. Encola una factura por mensaje; devuelve 202 |
| `GET` | `/facturacion/periodos/:id/facturas` | admin o lector | Lista facturas de un periodo |
| `GET` | `/facturas/:id` | admin o lector | Detalle de una factura + renglones + snapshot |
| `POST` | `/facturas/:id/anular` | admin_acueducto | Anula una factura (motivo obligatorio; la base registra responsable) |
| `GET` | `/facturacion/simulaciones/:periodoId` | admin | Última simulación del periodo (gate de la emisión) |

Para el modo emisión local: `backend/wrangler.toml` declara `[[queues.producers]]` (binding
`FACTURACION_COLA`) y el mismo worker declara el `consumer` de esa cola — verificado que en local
miniflare ejecuta `queue(batch, env)` tras un `send()`. El número se genera dentro del consumidor
con `SELECT FOR UPDATE` sobre `configuracion` (punto 9b).

## 4. Contratos de `core/facturacion.ts`

Lógica pura (CLAUDE.md §5.3). Reutiliza `calcularSubtotalServicio` de `core/tarifas.ts` (D-1). El
dinero en pesos sin centavos (redondeo a la unidad una vez, al final); consumos en m³ con 2 decimales.

```ts
export interface RenglonFactura {
  servicioId: string;
  descripcion: string;
  tipoCalculo: 'por_consumo' | 'fijo';
  tarifaId: string;
  consumoM3: number;
  cargoFijo: number;
  consumoBasicoM3: number;
  valorBasico: number;
  consumoNoBasicoM3: number;
  valorNoBasico: number;
  subtotal: number; // redondeado
}

export interface DatosTarifaVigente { ... } // la forma que devuelve tarifa_vigente() (vía lib)

// Arma los renglones de TODOS los servicios activos sobre un mismo consumoM3
// (CLAUDE.md §10 punto 10); llama calcularSubtotalServicio (punto 15, D-1).
export function armarRenglones(input: {
  servicios: Array<{ id: string; nombre: string; tipoCalculo: 'por_consumo' | 'fijo' }>;
  tarifasVigentes: Map<string, Tarifa>;
  consumoM3: number;
}): RenglonFactura[];

// Mora sobre el saldo vencido EXCLUYENDO la factura actual (punto 11).
export function calcularRecargoMora(porcentajeMoraPct: number, saldoVencido: number): number;

// Total = subtotal_servicios + recargo_mora + saldo_anterior (ESPECIFICACION §2.9).
export function componerTotal(i: { subtotalServicios: number; recargoMora: number; saldoAnterior: number }): number;

// Número {prefijo}-{YYYY}-{NNNNN}, 5 dígitos (D-3). Puro.
export function componerNumeroFactura(prefijo: string, anio: number, consecutivo: number): string;

// Anomalías de simulación (espec §3.3): consumo atípico/cero, usuario sin
// lectura, sin tarifa, total <= 0, variación vs periodo anterior > 20%.
export type AnomaliaFacturacion = ...; // union tipada (definición en tasks)
export function clasificarAnomaliasFacturacion(...): AnomaliaFacturacion[];
```

`recargo_mora` sobre `saldoVencido` (deuda previa) y `saldo_anterior` los administra 007; en 005 se
reciben como dato de entrada del consumidor (el mensaje de la cola lleva lo que el cierre ya
resolvió del suscriptor). La query de la simulación y la construcción del snapshot viven en
`lib/facturacion.ts` (capa fina), no en `core/` — pero el *cálculo* económico siempre pasa por
`core/`.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| La emisión ingresa por Cloudflare Queues, una factura por mensaje | Un `fetch` que recorre todos los suscriptores | CLAUDE.md §5.5 e INFRAESTRUCTURA §11: el cierre nunca se procesa en un solo fetch; el consumidor local se verificó que funciona |
| La simulación calcula en memoria (en la ruta) y NO persiste nada | Simular persistindo y luego borrar | El modo simulación es solo para que el humano vea el resumen; no debe dejar rastro parcial que pueda confundirse con facturas reales. El resumen de la última simulación se guarda para el gate de emisión |
| El gate de la emisión se apoya en "se guardó un resultado de simulación de este periodo (y no hay facturas emitidas de él)" | Marcar el periodo con un estado 'simulado' | No hay un estado `simulado` en `estado_periodo` (solo abierto/cerrado); el hecho observable es: hay una simulación registrada y cero facturas de ese periodo. Sencillo y verificable |
| Número atómico con `SELECT FOR UPDATE` sobre la fila de `configuracion` del cliente dentro del consumidor (por mensaje) | Generar el número fuera de transacción o con un contador por suscriptor | La unicidad la garantiza el unique `(cliente_id, numero)` + la transacción; el consecutivo anual (D-3) vive en `configuracion.consecutivo_factura/anio_consecutivo` |
| `facturas.total` se recalcula con trigger `AFTER ... ON factura_detalles` (suma) y, al hacer INSERT de la factura, se recomputa de detalles | Aceptar el `total` que manda la API | ESTRATEGIA-CALIDAD §2: `total` = suma de detalles es una invariante que la base debe garantizar. El "dinero" no se confía a la capa |
| La anulación es permitida aunque el periodo esté cerrado (solo `estado → anulada` + motivo) | Bloquear todo update sobre periodo cerrado | Debe poder corregirse un error sin reabrir el periodo; eso exige anular (inmutabilidad del dinero) no editar valores |
| `snapshot_suscriptor` se construye en la emisión a partir de `usuarios_servicio` + `contadores` (nombre, dirección, categoría, código, estado) | Guardar solo una FK al suscriptor | Punto 13: si el suscriptor cambia de categoría/dirección, la factura histórica queda congelada con lo que era al emitir |
| `consumir una o dos lecturas` vía `factura_lecturas` (reemplazo de contador) | Guardar el consumo como texto en la factura | Trazabilidad: la factura apunta a sus lecturas concretas; una factura `ciclo` puede ver 2 lecturas (saliente+entrante), y `lecturas` tiene `ON DELETE RESTRICT` |


## 6. Dependencias nuevas

| Paquete | Versión | Licencia | Por qué | Alternativa descartada |
|---|---|---|---|---|
| (ninguna) | — | — | Cloudflare Queues es una primitiva del Workers runtime (bindings via wrangler.toml), no una dependencia npm. `core/facturacion.ts` es lógica pura; `lib/facturacion.ts` usa `@supabase/supabase-js` ya presente | Añadir un ORM/cola externa (innecesario) |

## 7. Límites de Cloudflare Workers a considerar

- El cierre NUNCA se procesa en un solo fetch: producer encola una factura por mensaje, consumer
  procesa en batches (CLAUDE.md §5.5). Máx. mensajes por batch local configurable (para no exceder
  CPU/memoria por invocación del consumer).
- La simulación se ejecuta en una sola invocación (lectura de lecturas+tars + cálculo), pero es de
  solo lectura para un cliente típico de ~1000 suscriptores — dentro de límites. Si un cliente
  creciera mucho, se particiona; no es el caso de diseño ahora.
- El número atómico por factura cae dentro del tiempo normal del consumer (una fila de
  `configuracion` + un insert).

## 8. Estrategia de pruebas

- **Unitarias (`core/facturacion.ts`, CA-3, `vitest` sin Workers/base):** `armarRenglones` sobre un
  mismo consumo (reusa D-1; límite exacto/±1); `calcularRecargoMora` (0% sin deuda; excluye factura
  actual); `componerTotal`; `componerNumeroFactura` (formato 5 dígitos, prefijo FAC/REC);
  `clasificarAnomaliasFacturacion`; redondeo del peso una sola sola vez.
- **Aislamiento (RLS, CA-2):** `tests/aislamiento/005_facturacion_aislamiento.sql`, mismo mecanismo
  que 004 (`set local role`, `set local request.jwt.claim.sub`, transacción+rollback, Supabase local
  real). A no lee/escribe facturas de B; solo `admin_acueducto` escribe/anula; el `lector` lee pero
  no escribe; `uq_factura_ciclo` y `(cliente_id, numero)` rechazan duplicados; el trigger de periodo
  cerrado rechaza emitir/modificar salvo anulación; `total_pagado <= total`.
- **Integración (CA-4/CA-5):** round-trip local de Queues (verificado que funciona): con `wrangler
  dev` del consumidor, disparar un endpoint HTTP que simula/encola y confirmar (a través del log y
  de un SELECT a `facturas`) que el consumidor emitió. Si el entorno no permite correr el worker
  consumidor con su toml + Cola local (p. ej. por algún detalle de bindings en este contenedor), se
  declara "NO VERIFICADO" con pasos exactos, igual que en 002/003.
- **Manual (requiere Mateo/Cloudflare):** el despliegue real a Cloudflare (crear la cola en su
  account, conectar productor/consumidor) y el flujo completo con cron real en la nube. T-SQL de la
  simulación/emisión sí es 100% local.

### Orden de verificación (para `/tasks`)

1. Migración `facturacion.sql` + fixtures + aislamiento (CA-1/CA-2) contra Supabase local.
2. `core/facturacion.ts` + unit (CA-3).
3. `lib/facturacion.ts` + rutas de simulación/lista/anular (CA-4 sim, CA-5).
4. Consumidor `src/queues/cierre-facturacion.ts` + `wrangler.facturacion.toml` + emisión (round-trip
   local de Queues, CA-4 emisión).
5. Frontend `/app/facturacion` (CA-6).
6. Cierre CHANGELOG.

