# PLAN — 007: pagos-y-cartera

**Spec aprobado:** 2026-09-06 (commit `fae4457`; ver `specs/007-pagos-y-cartera/spec.md`, CA-1..CA-8)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` ni código
hasta esa aprobación.

---

## 0. Punto de partida

De `supabase/migrations/20260905090000_facturacion.sql` (005) + corrección de 006, reutilizado SIN
tocar (verificado contra la base local el 2026-09-06):

- **`facturas`** con `total_pagado` (default 0), `estado` (enum `estado_factura`: `pendiente` ·
  `pagada` · `vencida` · `anulada`), `fecha_emision`, `fecha_vencimiento`, `numero`, `snapshot_suscriptor`,
  `cliente_id`/`usuario_servicio_id`, check `total_pagado <= total`, unique `(cliente_id, numero)`,
  índice parcial `uq_factura_ciclo`, RLS `FORCE` (lectura miembros del cliente/plataforma; escritura
  solo `admin_acueducto`).
- **El trigger `trg_factura_inmutable` (versión vigente, reescrita por 006)** ya permite el UPDATE que
  cambia SOLO `pdf_url` (006), `total_pagado` y/o `estado` (007) sin tocar valores económicos —
  reservado expresamente por 005 para esta feature.
- Función `recalcular_total_factura`/trigger de detalles (invariante `total` = suma de detalles).
- Funciones de seguridad de 001 (`es_admin_de`, `mis_clientes`, `es_admin_plataforma`, `tiene_rol`),
  tablas `perfiles` (para `recibido_por`/`anulada_por`), `configuracion` (para la cartera con los
  umbrales de 009 en el futuro).
- Patrón de **RPCs transaccionales** ya usado en 001/002/003: `crear_tenant_con_admin` (definer),
  `crear_tarifa_version` y `reemplazar_contador` (`SECURITY INVOKER` + `SELECT FOR UPDATE`; `revoke`
  anon/public + `grant` authenticated). Las RPC de 007 siguen ese patrón de INVOKER.
- 006 dejó `notificaciones`; 007 **no la toca** (la confirmación de pago es de 010, decisión de
  alcance aprobada).

**NO existe todavía** (lo crea 007, `docs/esquema-propuesto.sql §10`, verificado contra la base local):
el enum `metodo_pago`, ni las tablas `pagos`/`pago_aplicaciones`.

**Notas de entorno (verificadas en sesiones 005/006):** el round-trip local de Cloudflare Queues
funciona con `wrangler dev`; las colas remotas reales no están disponibles (sin cuenta Cloudflare).
Para 007 **no se usan colas** (el registro/anulación de un pago es una transacción por request; la
cartera/historiales son consultas de lectura), así que el único límite es el de un Worker normal.

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260907090000_pagos.sql` | crear | Enum `metodo_pago`; tablas `pagos`/`pago_aplicaciones` (de `docs/esquema-propuesto.sql §10`) con RLS `FORCE`; trigger de integridad sobre `pago_aplicaciones`; RPCs transaccionales `registrar_pago`/`anular_pago` (`SECURITY INVOKER`, `SELECT FOR UPDATE`) |
| `tests/fixtures/pagos.sql` | crear | Pagos de A1 contra la factura del fixture 005 (total/parcial), una factura vencida (`ajuste`, `fecha_vencimiento` pasada) y un pago con remanente (saldo a favor); deja el estado para el aislamiento y la cartera |
| `tests/aislamiento/007_pagos_aislamiento.sql` | crear | CA-2 (RLS + permisos por rol + checks/RPCs; regresión 001-006) |
| `backend/src/core/pagos.ts` | crear | CA-3/CA-4/CA-5 unit: lógica pura de pagos — redondeo, distribución FIFO con remanente, estado derivado tras pago/anulación (CLAUDE.md §5.3) |
| `backend/tests/unit/pagos.test.ts` | crear | Unit tests de `core/pagos.ts` (casos límite del spec) |
| `backend/src/lib/pagos.ts` | crear | Capa fina de acceso a datos: llamadas a las RPC `registrar_pago`/`anular_pago`, consultas de cartera por suscriptor e historiales (por factura y por suscriptor) |
| `backend/src/index.ts` | editar | Rutas: `POST /pagos`, `POST /pagos/:id/anular`, `GET /cartera`, `GET /facturas/:id/pagos`, `GET /suscriptores/:id/pagos` |
| `frontend/lib/api.ts` | editar | Tipos `Pago`/`AplicacionPago`/`FilaCartera` + funciones `registrarPago`, `anularPago`, `obtenerCartera`, `obtenerPagosDeFactura`, `obtenerPagosDeSuscriptor` |
| `frontend/app/app/pagos/page.tsx` | crear | Vista de cartera del acueducto por suscriptor (por vencer/vencida con días de mora/total/saldo a favor) + registrar pago desde la fila |
| `frontend/app/app/facturacion/[facturaId]/page.tsx` | editar | Historial de pagos de la factura + botón registrar pago y anular pago (motivo) |
| `frontend/app/app/pagos/[suscriptorId]/page.tsx` | crear | Historial de pagos del suscriptor con sus aplicaciones y saldo a favor |

**Decisión estructural:** el registro/anulación de un pago es una **RPC atómica de la base** (mismo
patrón que `crear_tarifa_version`/`reemplazar_contador`): insertar el pago + sus aplicaciones +
actualizar `facturas.total_pagado`/`estado` en UNA transacción con `SELECT FOR UPDATE` de las
facturas afectadas. **Nunca** pasos sueltos desde el Worker (rompería la atomicidad y la regla de
concurrencia del spec §3.2).

## 2. Esquema de base de datos

### Migraciones

| Archivo | Contenido |
|---|---|
| `20260907090000_pagos.sql` | `create type metodo_pago`; tablas `pagos`/`pago_aplicaciones`; trigger de integridad `trg_pago_aplicacion_valida`; RPCs transaccionales `registrar_pago`/`anular_pago`; RLS `FORCE` + políticas |

### Tablas

```sql
create type metodo_pago as enum ('efectivo','transferencia','consignacion','pse','otro');

create table pagos (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  valor               numeric(12,2) not null check (valor > 0),
  fecha_pago          date not null default current_date,
  metodo              metodo_pago not null default 'efectivo',
  referencia          text,
  recibido_por        uuid references perfiles(id) on delete restrict,  -- quién registra (trazabilidad)
  anulado             boolean not null default false,
  motivo_anulacion    text,
  observaciones       text,
  created_at          timestamptz not null default now()
);

create index on pagos (cliente_id, fecha_pago desc);
create index on pagos (usuario_servicio_id) where not anulado;

create table pago_aplicaciones (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  pago_id    uuid not null references pagos(id) on delete cascade,
  factura_id uuid not null references facturas(id) on delete restrict,
  valor      numeric(12,2) not null check (valor > 0),
  unique (pago_id, factura_id)          -- un pago abona una sola vez por factura
);

create index on pago_aplicaciones (factura_id);
create index on pago_aplicaciones (pago_id);
```

Notas:
- `pagos` solo tiene `created_at` (un pago nunca se edita: se anula) — igual que el esquema propuesto.
- El unique `(pago_id, factura_id)` impide aplicar el mismo pago dos veces a la misma factura.

### Trigger de integridad (red de seguridad para INSERTs directos)

`trg_pago_aplicacion_valida` (BEFORE INSERT OR UPDATE, por fila, en `pago_aplicaciones`) rechaza con
mensajes explícitos:
1. que el pago no exista, esté `anulado`, o sea de otro `cliente_id` que la aplicación;
2. que la factura sea de otro cliente o de **otro `usuario_servicio_id`** que el pago;
3. que la factura esté `anulada`;
4. `valor_aplicado > facturas.total − facturas.total_pagado` (no abonar más del saldo vivo);
5. `sum(pago_aplicaciones.valor del pago, incluida la fila) > pagos.valor` (el sobrante es remanente,
   nunca rompe el check `total_pagado <= total`).

La **concurrencia real** la garantiza la RPC (bloquea las facturas con `SELECT FOR UPDATE` antes de
aplicar); el trigger es la invariante para cualquier INSERT directo.

### RPCs transaccionales (`SECURITY INVOKER`, patrón 002/003)

```sql
-- Registra un pago y lo aplica a las facturas del suscriptor en UNA transacción.
-- Devuelve { pago, aplicaciones, remanente, facturas } (las facturas con su estado nuevo).
create or replace function registrar_pago(
  p_cliente_id          uuid,
  p_usuario_servicio_id uuid,
  p_valor               numeric,
  p_fecha_pago          date default current_date,
  p_metodo              metodo_pago default 'efectivo',
  p_referencia          text default null,
  p_recibido_por        uuid,
  p_observaciones       text default null,
  p_factura_ids         uuid[] default null  -- null = aplicar a las pendientes (más antigua primero)
) returns jsonb
language plpgsql security invoker set search_path = public as $$ ... $$;

-- Anula un pago vigente: motivo obligatorio. Revierte el total_pagado de las facturas
-- afectadas (recalculado desde los pagos vigentes restantes) y su estado.
create or replace function anular_pago(
  p_cliente_id uuid,
  p_pago_id    uuid,
  p_motivo     text,
  p_perfil     uuid
) returns jsonb
language plpgsql security invoker set search_path = public as $$ ... $$;
```

Comportamiento de `registrar_pago` (todas las validaciones lanzan `raise exception` → la ruta
responde 400 sin efectos parciales):
- `core/pagos.ts` redondea `p_valor` a la unidad del peso ANTES de llamar; la RPC solo valida `> 0`.
- Carga las facturas **candidatas** del suscriptor — `estado <> 'anulada'` y `total > total_pagado`,
  ordenadas por `fecha_vencimiento asc` (más antigua primero) — con `SELECT ... FOR UPDATE`
  (serializa pagos concurrentes sobre la misma factura).
- Aplica el valor en ese orden: si vino `p_factura_ids`, primero a esas (las que estén entre las
  candidatas) y el sobrante sigue a las demás candidatas (spec §3.2). Si no vino, aplica a todas.
- Inserta `pagos` y sus `pago_aplicaciones`; por cada factura abonada actualiza
  `total_pagado = total_pagado + valor_aplicado` y `estado = 'pagada'` si `total_pagado = total`
  (el trigger de inmutabilidad vigente permite este UPDATE).
- Sin candidatas (suscriptor sin deuda) el pago se registra **sin aplicaciones** (100% remanente a
  favor) — regla 14, decisión técnica §5.

Comportamiento de `anular_pago`:
- `p_motivo` obligatorio; solo pagos vigentes (`anulado = false`) del cliente; `p_perfil` es el
  responsable.
- Marca `anulado = true` + `motivo_anulacion` (conservando `recibido_por` original).
- Por cada factura abonada: recalcula `total_pagado = sum(valor)` de las aplicaciones de **pagos
  vigentes** a esa factura y deriva `estado = 'pagada'` si `total_pagado = total`, si no
  `'pendiente'` (`vencida` se deriva por fecha en las consultas, nunca se persiste — spec §3.5).
- Devuelve el pago anulado + las facturas con su estado nuevo.

### RLS

- `pagos` y `pago_aplicaciones`: `enable row level security` + `force row level security`.
- Lectura: `es_admin_plataforma() or cliente_id in (select mis_clientes())` (patrón 001-006).
- Escritura (insert/update/delete): `es_admin_de(cliente_id)` — solo `admin_acueducto`; el `lector`
  lee su cliente pero no escribe (CLAUDE.md §10 punto 24).
- `revoke execute on function registrar_pago(...)` / `anular_pago(...) from anon, public;`
  `grant execute ... to authenticated;` (mismo patrón que `crear_tarifa_version`/`reemplazar_contador`).

## 3. Rutas de la API (Hono)

Todas con `requerirClienteActivo` (sesión admin/lector; cookie). Las de escritura solo pasan si la
RLS/RPC autoriza (admin): el `lector` lee cartera/historiales pero registrar/anular devuelve 403.

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| `POST` | `/pagos` | admin_acueducto | Registra un pago: `{usuario_servicio_id, valor, metodo, fecha_pago?, referencia?, observaciones?, factura_ids?}` → 201 `{pago, aplicaciones, remanente, facturas}` (llama a la RPC `registrar_pago`; el body se valida y redondea con `core/pagos.ts`) |
| `POST` | `/pagos/:id/anular` | admin_acueducto | Anula un pago: `{motivo}` → 200 `{pago, facturas}` (RPC `anular_pago`; sin motivo → 400) |
| `GET` | `/cartera` | admin o lector | Cartera del acueducto por suscriptor con deuda: `?suscriptor_id=` y `?solo_morosos=true` opcionales; por suscriptor devuelve por vencer / vencida (días de mora, factura más vieja) / total adeudado / saldo a favor / estado del suscriptor |
| `GET` | `/facturas/:id/pagos` | admin o lector | Historial de pagos aplicados a una factura (aplicaciones con fecha, valor, método, referencia, quién, estado del pago) + total pagado + saldo |
| `GET` | `/suscriptores/:id/pagos` | admin o lector | Historial de pagos de un suscriptor (vigentes y anulados) con sus aplicaciones y el valor sin aplicar |

Respuestas de error del patrón existente: `c.json({ error: ... }, 400|403)`; los `raise exception` de
las RPC llegan como mensaje de error legible.

## 4. Contratos de core/

`backend/src/core/pagos.ts` — lógica pura (sin Hono/Cloudflare/Supabase, CLAUDE.md §5.3):

```ts
export type MetodoPago = 'efectivo' | 'transferencia' | 'consignacion' | 'pse' | 'otro';

// Factura pendiente candidata a recibir un abono (ya filtrada por cliente/suscriptor,
// no anulada y con saldo > 0, ordenada por fecha_vencimiento asc por el caller).
export interface FacturaPendienteParaPago {
  facturaId: string;
  saldo: number;            // total - total_pagado
  fechaVencimiento: string; // solo para ordenar (más antigua primero)
}

export interface AplicacionCalculada {
  facturaId: string;
  valor: number;
}

export interface ResultadoDistribucion {
  aplicaciones: AplicacionCalculada[];
  remanente: number; // valor del pago sin aplicar → a favor del suscriptor
}

// Regla única de redondeo del peso (CLAUDE.md §5.6): el valor del pago se redondea a
// la unidad UNA vez, aquí.
export function redondearPeso(x: number): number;

// Distribuye el valor entre las facturas candidatas (más antigua primero). Si
// facturasSeleccionadas es null se aplica a todas las candidatas; si viene, primero a las
// indicadas (las que existan) y el sobrante sigue a las demás candidatas. Nunca aplica más
// del saldo de una factura. Devuelve aplicaciones y remanente (regla 14: el sobrante no se pierde).
export function distribuirPago(input: {
  candidatas: FacturaPendienteParaPago[];
  facturasSeleccionadas: string[] | null;
  valor: number;
}): ResultadoDistribucion;

// Estado derivado de la factura tras abonar: pagada solo cuando total_pagado >= total.
export function calcularEstadoTrasPago(total: number, totalPagado: number): 'pagada' | 'pendiente';
```

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Registrar/anular pago como **RPC transaccional de la base** (`SECURITY INVOKER`, `SELECT FOR UPDATE`) | Varios INSERT/UPDATE sueltos desde el Worker | Atomicidad y concurrencia (dos pagos simultáneos no pueden aplicar el mismo saldo); mismas invariantes en un solo lugar y patrón ya usado en 002/003; la RPC respeta RLS (rol `authenticated`) |
| El **remanente de un pago** (sobrante) queda a favor del suscriptor: aplicaciones < valor; **pago sin facturas** = 100% remanente | Rechazar pagos mayores a la deuda | Regla 14 (el sobrante no se pierde) + permite anticipos; la aplicación al siguiente cierre es manual y queda fuera (decisión de alcance aprobada) |
| Estado **`vencida` derivado por fecha** en las consultas de cartera; nunca se persiste salvo `pagada`/`anulada` por eventos | Cron/job que mute masivamente `pendiente→vencida` | Decisión del spec §3.5 (sin estado desfasado); el enum conserva `vencida` para el reporte |
| `metodo_pago` como **enum de la base** | Tabla catálogo editable | El esquema propuesto lo define como enum; los métodos son fijos |
| `recibido_por` = perfil autenticado que registra (FK `perfiles`) | Texto libre o token del worker | Trazabilidad de quién registró/quién autoriza anulación (el RLS/`auth.uid()` no da el nombre) |
| Un único abono `(pago_id, factura_id)` | Permitir varias aplicaciones del mismo pago a la misma factura | Evita duplicar el mismo abono por reenvío |
| La **reversión por anulación** recalcula `total_pagado` desde los pagos vigentes (no resta a ciegas) | Restar el valor anulado del `total_pagado` actual | Correcto cuando hay varios pagos sobre la misma factura y se anula uno de ellos |
| Cartera/historiales como **consultas de lectura** acotadas al `cliente_id` (con filtros/paginación) | Materializar estados o procesar en cola | Volumen de un acueducto típico cabe en un fetch de lectura; sin lotes en un solo request (CLAUDE.md §5.5) |

## 6. Dependencias nuevas

| Paquete | Versión | Licencia | Por qué | Alternativa descartada |
|---|---|---|---|---|
| (ninguna) | — | — | Las RPCs y las consultas usan PostgreSQL + `@supabase/supabase-js` ya presente; `core/pagos.ts` es lógica pura sin dependencias | ORM/librería de transacciones externa (innecesaria) |

## 7. Límites de Cloudflare Workers a considerar

- Registrar/anular un pago es **una RPC de pocas filas** por request (1 pago + N aplicaciones
  acotadas a las facturas pendientes del suscriptor) → CPU trivial, sin necesidad de colas.
- `GET /cartera` es una consulta agregada por `cliente_id` con los índices de §2; para un acueducto
  típico (~1.000 suscriptores) cabe en una invocación de fetch. Si un cliente creciera mucho, se
  pagina (filtro `suscriptor_id`/`solo_morosos`) — sin lotes en un solo request (CLAUDE.md §5.5).
- Los historiales por factura/suscriptor son consultas con índices por `factura_id` y
  `(usuario_servicio_id)`; sin procesamiento de lotes.
- Bundle: ninguna dependencia nueva (`core/pagos.ts` puro) — no afecta el tamaño del Worker.

## 8. Estrategia de pruebas

- **Unitarias (`core/pagos.ts`, `vitest` sin Workers/base):** `redondearPeso` (enteros y decimales
  con .5 hacia arriba, regla única); `distribuirPago` — más antigua primero (FIFO), pago exacto,
  pago parcial (la más antigua queda a medias), pago a varias facturas, valor mayor que la deuda
  total → remanente (regla 14), `facturasSeleccionadas` parcial con sobrante que sigue a las demás,
  selección de una factura sin saldo → no recibe abono, cero candidatas → remanente 100%;
  `calcularEstadoTrasPago` (saldo 0 → pagada; saldo > 0 → pendiente).
- **Aislamiento (RLS, CA-2):** `tests/aislamiento/007_pagos_aislamiento.sql`, mismo mecanismo que
  001-006 (`set local role` + `request.jwt.claim.sub`, transacción+rollback, Supabase local real):
  A no lee/escribe pagos de B; solo `admin_acueducto` registra/anula (el `lector` lee pero no
  escribe); las RPC rechazan a un no-admin y a facturas de otro cliente; los checks/trigger rechazan
  valor `<= 0`, aplicar a una factura anulada/de otro suscriptor, aplicar más del saldo y más del
  valor del pago. Regresión 001-006 en verde sobre el mismo estado final.
- **Integración (CA-3/CA-4/CA-5/CA-6/CA-7):** contra Supabase local real + `wrangler dev` con curl y
  cookie del admin A: registrar pago total → factura `pagada`; parcial → `pendiente` con
  `total_pagado` crecido; pago a varias facturas; remanente visible; anulación con/sin motivo;
  cartera con una factura `ajuste` vencida del fixture (deriva `vencida` por fecha y cuadra los
  totales); historiales por factura y por suscriptor. Los fixtures `pagos.sql` dejan el estado
  inicial (factura del fixture 005 pagada/parcial, una vencida, un remanente).
- **Manual (Mateo):** flujo click-a-click en navegador (`next dev` + `wrangler dev`) — "NO VERIFICADO"
  con pasos exactos si el entorno no permite correr ambos (patrón de 005/006).

### Orden de verificación (para `/tasks`)

1. Migración `20260907090000_pagos.sql` + `supabase db reset --local` + fixtures 001-007 +
   aislamiento 007 (CA-1/CA-2).
2. `core/pagos.ts` + unit (CA-3 a CA-5, lógica pura) — `npm test`.
3. `lib/pagos.ts` + rutas + verificación curl/wrangler dev (CA-3 a CA-7).
4. Frontend (`api.ts` + cartera + detalle de factura + historial del suscriptor) — build/lint (CA-8).
5. Cierre: CHANGELOG + checklist spec §8.






