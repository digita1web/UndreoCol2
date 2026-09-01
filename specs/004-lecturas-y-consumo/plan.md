# PLAN — 004: lecturas-y-consumo

**Spec aprobado:** 2026-09-04 (ver `specs/004-lecturas-y-consumo/spec.md`, 6 criterios de aceptación)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` ni código hasta esa aprobación.

---

## 0. Punto de partida

De `supabase/migrations/20260831150000_fundacion-tenancy.sql` (001), reutilizado sin tocar:
- `configuracion` con los umbrales que 004 usa: `factor_consumo_alto`, `piso_consumo_alto_m3`,
  `factor_consumo_bajo`, `umbral_rollover_pct`. La fila de `configuracion` de cada acueducto es la
  única fuente de estos valores.
- Funciones de seguridad: `es_admin_de(cliente_id)`, `mis_clientes()`, `tiene_rol()`,
  `es_admin_plataforma()`, `set_updated_at()`.
- Roles del enum `rol_usuario`: `administrador`, `admin_acueducto`, `lector`.

De `supabase/migrations/20260902090000_suscriptores-contadores.sql` (003), reutilizado sin tocar:
- `contadores` con `capacidad_maxima` (techo de rollover), `lectura_inicial`, `estado`
  (`activo`/`danado`/`reemplazado`), `usuario_servicio_id`.
- `reemplazos_contador` con `contador_anterior_id`, `contador_nuevo_id`, `lectura_final_anterior`,
  `lectura_inicial_nuevo`, `fecha_reemplazo`.
- `usuarios_servicio.contador_actual_id`.

**NO existe todavía** (lo crea 004, `docs/esquema-propuesto.sql §8`): enums `estado_periodo` y
`revision_lectura`, tablas `periodos` y `lecturas`. El campo `factura_lecturas` (vínculo factura↔
lectura) es de 005, fuera de alcance (spec §4).

Referencia de RLS para `lecturas` en el esquema propuesto:
`create policy lecturas_lector_inserta on lecturas for insert with check (tiene_rol(cliente_id, array['lector']...))`
— 004 lo implementa, adaptado a "el lector inserta lecturas pero no marca revisiones ni gestiona
periodos" (spec §5, CLAUDE.md §10 punto 24).

### Fixtures que extiende (ids ya fijos del entorno de test)

De `tests/fixtures/fundacion.sql`: cliente A `a0000000-...0001`, cliente B `b0000000-...0002`;
admin A `a0000000-...0a1`, lector A `a0000000-...0a2`, admin B `b0000000-...0b1`, lector B
`b0000000-...0b2`.
De `tests/fixtures/suscriptores.sql`: A1 `d0000000-...0a1` (contador activo `c0000000-...0a1`,
`capacidad_maxima = 99999`, `lectura_inicial = 0`), B1 `d0000000-...0b1` (contador activo
`c0000000-...0b1`). 004 usa A1/B1; A2 se deja sin contador a propósito (spec de 003).

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260904090000_lecturas-consumo.sql` | crear | enums `estado_periodo`/`revision_lectura`; tablas `periodos`/`lecturas`; índice único parcial `uq_periodo_abierto`; trigger `bloquear_lectura_periodo_cerrado()`; RLS + políticas |
| `tests/fixtures/lecturas.sql` | crear | periodos y lecturas de ejemplo para el test de aislamiento (completa `tests/fixtures/suscriptores.sql`) |
| `tests/aislamiento/004_lecturas_consumo_aislamiento.sql` | crear | CA-2 y CA-5 |
| `backend/src/core/consumo.ts` | crear | Cálculo puro de consumo: rollover, rechazos, reemplazo, anomalías (CLAUDE.md §5.3) |
| `backend/tests/unit/consumo.test.ts` | crear | CA-3, `vitest` |
| `backend/src/lib/lecturas.ts` | crear | Acceso a datos: periodos y lecturas (capa fina, sin lógica — toda en `core/`) |
| `backend/src/index.ts` | editar | Rutas `/periodos*` y `/lecturas*` |
| `frontend/lib/api.ts` | editar | Funciones de periodos/lecturas |
| `frontend/app/app/lecturas/page.tsx` | crear | Panel de lecturas por periodo y revisión de anomalías (CA-6) |
| `frontend/app/app/lecturas/periodo/page.tsx` (o integrado en el anterior) | crear | Alta/cierre de periodo del mes (CA-6) |
| `CHANGELOG.md` | editar | Cierre de la feature |
## 2. Esquema de base de datos

### Migraciones

| Archivo | Contenido |
|---|---|
| `20260904090000_lecturas-consumo.sql` | `create type estado_periodo` (`abierto`/`cerrado`); `create type revision_lectura` (`normal`/`consumo_alto`/`consumo_bajo`/`consumo_cero`); tabla `periodos` con unique `(cliente_id, anio, mes)` + `uq_periodo_abierto` parcial + `chk_rango`; tabla `lecturas` con FKs `ON DELETE RESTRICT` a `contadores`/`periodos`, unique `(contador_id, periodo_id)`, unique `id_cliente_offline`, `chk_consumo >= 0`; función+trigger `bloquear_lectura_periodo_cerrado`; RLS `FORCE` + políticas en ambas tablas |

### Tablas

```sql
create type estado_periodo as enum ('abierto','cerrado');
create type revision_lectura as enum ('normal','consumo_alto','consumo_bajo','consumo_cero');

create table periodos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  nombre            text not null,                -- 'Enero 2026'
  anio              smallint not null,
  mes               smallint not null check (mes between 1 and 12),
  fecha_inicio      date not null,
  fecha_fin         date not null,
  fecha_vencimiento date not null,
  estado            estado_periodo not null default 'abierto',
  fecha_cierre      timestamptz,
  cerrado_por       uuid references perfiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cliente_id, anio, mes),
  constraint chk_rango check (fecha_fin >= fecha_inicio)
);
create unique index uq_periodo_abierto on periodos (cliente_id) where estado = 'abierto';

create table lecturas (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references clientes(id) on delete cascade,
  contador_id        uuid not null references contadores(id) on delete restrict,
  periodo_id         uuid not null references periodos(id) on delete restrict,
  fecha_lectura      date not null,
  lectura_anterior   numeric(12,2) not null,
  lectura_actual     numeric(12,2) not null,
  consumo_m3         numeric(12,2) not null,      -- SIEMPRE calculado por core/consumo.ts
  hubo_rollover      boolean not null default false,
  revision           revision_lectura not null default 'normal',
  promedio_historico numeric(12,2),
  revisada           boolean not null default false,
  revisada_por       uuid references perfiles(id),
  tomada_por         uuid references perfiles(id),
  foto_url           text,
  latitud            numeric(10,7),
  longitud           numeric(10,7),
  observaciones      text,
  id_cliente_offline text unique,                 -- idempotencia app móvil
  created_at         timestamptz not null default now(),
  unique (contador_id, periodo_id),               -- bloquea duplicadas (cláusula punto 3)
  constraint chk_consumo check (consumo_m3 >= 0)
);
create index on lecturas (cliente_id, periodo_id);
create index on lecturas (contador_id, fecha_lectura desc);
create index on lecturas (cliente_id, revision)
  where revision <> 'normal' and not revisada;     -- cola de revisión de anomalías
```

**Bloqueo de lectura en periodo cerrado:** un CHECK no puede referenciar otra tabla, así que se usa
una función + trigger `BEFORE INSERT` (decisión que el spec deja a `/plan`):

```sql
create function bloquear_lectura_periodo_cerrado() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_estado estado_periodo;
begin
  select p.estado into v_estado from periodos p where p.id = new.periodo_id;
  if v_estado is null then
    raise exception 'Periodo % no existe', new.periodo_id;
  end if;
  if v_estado = 'cerrado' then
    raise exception 'El periodo está cerrado: no se aceptan lecturas';
  end if;
  return new;
end $$;
create trigger trg_lectura_periodo_cerrado before insert on lecturas
  for each row execute function bloquear_lectura_periodo_cerrado();
```

Razón de `SECURITY DEFINER`: el trigger se ejecuta con el rol del llamador (que inserta la lectura),
y por spec §5 el rol `lector` **no** gestiona `periodos` (no puede leerlos con RLS de escritura);
aun así necesita validar que su lectura cae en un periodo `abierto`. `SECURITY DEFINER` lee el
`estado` del periodo al margen de la RLS de `periodos` — es el único acceso que este constructor
abre, y queda documentado en la migración y testeado en la tarea de aislamiento.

### Políticas RLS

Tabla **`periodos`** (el lector solo lee el periodo abierto para saber qué periodo es; solo
`admin_acueducto` crea/cierra):

| Rol | Select | Insert/Update/Delete |
|---|---|---|
| `administrador` | ✅ (plataforma) | ✅ |
| `admin_acueducto` | ✅ (miembro de su cliente) | ✅ (solo su cliente) |
| `lector` | ✅ (miembro de su cliente) | ❌ |

```sql
alter table periodos enable row level security;
alter table periodos force row level security;
create policy periodos_lectura on periodos for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy periodos_admin on periodos for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
```

Tabla **`lecturas`** (el lector puede insertar y leer lecturas del cliente — CLAUDE.md §10 punto 24 —
pero NO marcar revisiones; esas son de `admin_acueducto`):

| Rol | Select | Insert | Update (revisión) / Delete |
|---|---|---|---|
| `administrador` | ✅ | ✅ | ✅ |
| `admin_acueducto` | ✅ | ✅ | ✅ (revisar = actualizar `revisada`/`revisada_por`) |
| `lector` | ✅ (miembro del cliente) | ✅ (solo `tiene_rol(...'lector')`) | ❌ |

```sql
alter table lecturas enable row level security;
alter table lecturas force row level security;
create policy lecturas_lectura on lecturas for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy lecturas_inserta on lecturas for insert
  with check (
    es_admin_de(cliente_id)
    or tiene_rol(cliente_id, array['lector']::rol_usuario[])
  );
create policy lecturas_admin on lecturas for update
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
create policy lecturas_admin_delete on lecturas for delete
  using (es_admin_de(cliente_id));
```

**Límite conocido (transferido a 005):** el `delete` queda restringido por RLS a `admin_acueducto`,
pero la regla de negocio de "no borrar una lectura que ya tiene factura emitida" es de la feature
005 (facturación). 004 no implementa ese vínculo todavía.

## 3. Rutas de la API (Hono)

Todas exigen sesión administrativa autenticada y `requerirClienteActivo` (patrón 002/003: JWT de
Supabase + `ctx.clienteId`). Toda escritura de `consumo_m3` pasa por `core/consumo.ts`; `lib/lecturas.ts`
solo persiste el resultado. Si `core/` devuelve un rechazo, la ruta responde 400 con el motivo
(`error: 'lectura_menor_sin_rollover' | ...`).

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| `POST` | `/periodos` | admin_acueducto | Crear el periodo abierto del mes (único `abierto` por cliente). Rechaza si ya hay uno abierto |
| `GET` | `/periodos` | admin o lector | Listar periodos del cliente |
| `PATCH` | `/periodos/:id/cerrar` | admin_acueducto | Cerrar el periodo (`estado = 'cerrado'`, `fecha_cierre`, `cerrado_por`). No reabre |
| `GET` | `/lecturas?periodo_id=` | admin o lector | Listar lecturas del periodo; filtro `revision` si se pide la cola de anomalías |
| `POST` | `/lecturas` | admin o lector | Crear una lectura. Calcula consumo y anomalía en `core/`; respeta `id_cliente_offline` (si ya existe el mismo, devuelve la existente, no duplica) |
| `PATCH` | `/lecturas/:id/revisar` | admin_acueducto | Marcar una lectura como `revisada` con `revisada_por` |

Validaciones de entrada en la ruta: `contador_id`, `periodo_id`, `fecha_lectura`, `lectura_actual`,
opcionalmente `id_cliente_offline`. La `lectura_anterior` no llega del cliente como dato libre: se
resuelve en `lib/lecturas.ts` con la última lectura del mismo contador (o `contadores.lectura_inicial`
si es la primera / tras un reemplazo), y se pasa a `core/consumo.ts`. Esto evita que el lector
"invente" la base del consumo.

## 4. Contratos de `core/consumo.ts`

Lógica pura (CLAUDE.md §5.3): no importa Hono/Cloudflare/Supabase. Recibe `number` y devuelve
resultados tipados. El consumo se maneja en **m³ con 2 decimales** (nunca `float`; ver spec §5.6).

```ts
// Resultado de calcular el consumo de una lectura SIN reemplazo de contador.
export type ResultadoConsumo =
  | { ok: true; consumoM3: number; huboRollover: boolean }
  | { ok: false; error: ErrorLectura };

export type ErrorLectura =
  | 'lectura_menor_sin_rollover'  // cláusula punto 2
  | 'lectura_mayor_capacidad'     // lectura_actual > capacidad_maxima (no puede pasar en un display real)
  | 'datos_invalidos';            // capacidad o umbral no positivos

// Cláusula punto 1 (rollover) y punto 2 (rechazo).
export function calcularConsumoPeriodo(input: {
  lecturaAnterior: number;
  lecturaActual: number;
  capacidadMaxima: number;
  umbralRolloverPct: number; // % de la capacidad, ej. 90
}): ResultadoConsumo;
// Regla: si lecturaActual < lecturaAnterior Y lecturaAnterior > capacidadMaxima * umbralRolloverPct/100
//  → huboRollover, consumoM3 = (capacidadMaxima - lecturaAnterior) + lecturaActual
// si lecturaActual < lecturaAnterior pero NO cumple la condición → rechazo 'lectura_menor_sin_rollover'
// si lecturaActual >= capacidadMaxima → rechazo 'lectura_mayor_capacidad'
// en caso sano (no rollover): consumoM3 = lecturaActual - lecturaAnterior

// Cláusula punto 7 (reemplazo a mitad de periodo). Una sola declaración por periodo.
// El consumo combina el tramo del contador saliente y el del entrante.
export function calcularConsumoConReemplazo(input: {
  lecturaFinalAnterior: number;      // de reemplazos_contador (lo que marcó el saliente al retirarlo)
  ultimaLecturaSaliente: number;     // última lectura real del contador saliente en el periodo
  lecturaInicialNuevo: number;       // de reemplazos_contador (lo que marcó el nuevo al instalarse)
  lecturaActualEntrante: number;     // lectura que se está registrando en el contador nuevo
}): ResultadoConsumo;
// consumoM3 = (lecturaFinalAnterior - ultimaLecturaSaliente) + (lecturaActualEntrante - lecturaInicialNuevo)
// (sin rollover en el tramo individual por simplicidad acordada: el reemplazo reinicia el display;
//  el rollover vuelve a aplicarse en periodos siguientes del contador nuevo).
// Si algún tramo da negativo, devuelve rechazo 'datos_invalidos'.

// Cláusulas puntos 5 y 6 (anomalías). Devuelve la revisión; NUNCA bloquea el guardado.
export type VerificacionAnomalia = 'normal' | 'consumo_alto' | 'consumo_bajo' | 'consumo_cero';
export function clasificarAnomalia(input: {
  consumoM3: number;
  factorConsumoAltoPct: number;  // de configuracion, ej. 150
  pisoConsumoAltoM3: number;     // de configuracion, ej. 100
  factorConsumoBajoPct: number;  // de configuracion, ej. 20
  promedioHistoricoM3: number | null; // si no hay histórico (primera lectura), se asume sin anomalía relativa
}): VerificacionAnomalia;
// consumo_cero: consumoM3 === 0
// consumo_alto: promedioHistoricoM3 != null
//   Y consumoM3 > promedioHistoricoM3 * factorConsumoAltoPct/100
//   Y consumoM3 > pisoConsumoAltoM3
// consumo_bajo: promedioHistoricoM3 != null
//   Y consumoM3 < promedioHistoricoM3 * factorConsumoBajoPct/100
//   (excluye consumo_cero ya atrapado arriba)
// normal: resto
```

**Definición del `promedio_historico` (decisión diferida del spec §4 que se fija aquí):** media
aritmética simple del `consumo_m3` de las **lecturas previas del mismo contador** (por
`contador_id`, orden cronológico, excluyendo la lectura actual y excluyendo periodos cerrados con
consumo que no correspondieran por reemplazo). Tras un **reemplazo de contador**, el promedio se
reinicia sobre el contador **nuevo** (las lecturas del saliente son de otro display y no son una
base comparable). Si no hay lecturas previas en el contador → `promedioHistoricoM3 = null` (no se
marca anomalía relativa; el `consumo_cero` sí aplica). Este promedio se guarda en
`lecturas.promedio_historico` para trazabilidad.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `periodos` con unique `(cliente_id, anio, mes)` + índice parcial `uq_periodo_abierto` | Solo el parcial sin unique completo, o validación en la app | El unique completo evita re-abrir duplicados por error (cláusula punto 9b/9c: un solo periodo abierto, un solo periodo por mes); el parcial garantiza "un solo `abierto`". Indices de la app no bastan para garantizar la invariante |
| Bloqueo de lectura en periodo cerrado con trigger `BEFORE INSERT` + `SECURITY DEFINER` | CHECK constraint, o validación solo en la capa de aplicación | Un `CHECK` no puede leer `periodos`. La app no basta: hay que proteger la invariante incluso frente a INSERT directo/offline. El `SECURITY DEFINER` es acotado (solo lee `estado`) y se documenta/testea |
| `consumo_m3` calculado siempre en `core/consumo.ts` y guardado con 2 decimales; el redondeo monetario final se deja a 005 | Recalcular/redondear en la ruta o en SQL | `CLAUDE.md §5.3/§5.6`: el dinero se calcula solo en `core/`; el peso se redondea a la unidad una sola vez al facturar (005). Entender m³ con 2 decimales es exacto y 006+ no duplica la regla |
| La `lectura_anterior` la resuelve el backend (última lectura del contador o `lectura_inicial`) y no se acepta del cliente | Dejar que el lector envíe `lectura_anterior` | Evita que un lector "invente" la base; el servidor es la única fuente de la lectura previa (rechaza manipulaciones y mantiene coherencia del histórico) |
| Anomalía relativa (alto/bajo) compara contra promedio de las lecturas **previas del mismo contador**, reiniciada tras reemplazo; `null` si no hay histórico | Promedio del último periodo cerrado del acueducto, o promedio de N últimos del contador | Reiniciar tras reemplazo es lo correcto: el display nuevo no es comparable al saliente. Definición determinista y trazable (se guarda `promedio_historico`). El `consumo_cero` no depende de histórico |
| El `lector` puede INSERT de `lecturas` pero no UPDATE/cerrar periodos; `revisada` solo `admin_acueducto` | Dar al lector escritura plena en lecturas | `CLAUDE.md §10` punto 24: el lector "solo crea/ve lecturas"; la revisión es una tarea de control del admin. Mínimo privilegio |
| `reemplazos` da lugar a UNA sola lectura/consumo por periodo (declaración combinada por `calcularConsumoConReemplazo`) | Dos lecturas independientes | spec §5 punto 7: una sola factura vincula ambos tramos; no se duplica ni se pierde consumo |

## 6. Dependencias nuevas

| Paquete | Versión | Licencia | Por qué | Alternativa descartada |
|---|---|---|---|---|
| (ninguna) | — | — | `core/consumo.ts` es lógica pura; `lib/lecturas.ts` usa `@supabase/supabase-js` ya presente; Hono ya está en `backend/src/index.ts` | Añadir una librería de decimales / validación externa (no hace falta; `numeric` y `number` cubren el caso, igual que `core/tarifas.ts`) |

## 7. Límites de Cloudflare Workers a considerar

- `POST /lecturas` y `PATCH /lecturas/:id/revisar` procesan **una fila** por invocación (CPU
  trivial). Ninguna ruta hace cierres ni cálculos masivos en un solo fetch.
- `GET /lecturas` listado acotado a un periodo de un cliente (miles de filas como máximo): índice en
  `(cliente_id, periodo_id)`; sin riesgo de bundle ni de memoria.
- El cierre masivo de facturación (005) es el único lote real y debe usar Cloudflare Queues — fuera
  del alcance de 004 (CLAUDE.md §5.5). El "cerrar periodo" de 004 solo voltea `estado`; no calcula
  facturas.

## 8. Estrategia de pruebas

- **Unitarias (`core/consumo.ts`):** `backend/tests/unit/consumo.test.ts` con `vitest` (CA-3), sin
  Workers ni base:
  - Rollover en umbral exacto / por encima / por debajo; dígitos 5 (99999) y 6 (999999).
  - `lectura_menor_sin_rollover` → `{ ok: false, error }`; no vende negativo ni cero.
  - Primera lectura: `lecturaAnterior = lecturaInicial`.
  - `calcularConsumoConReemplazo`: tramo saliente + entrante, valores exactos; tramo negativo →
    rechazo.
  - `clasificarAnomalia`: alto (con/sin piso), bajo, cero, normal, y `promedioHistoricoM3 = null`.
  - Propiedad (`ESTRATEGIA-CALIDAD.md` §5.4): el consumo nunca negativo ni > capacidad; determinismo
    (mismo insumo → mismo resultado).
- **Aislamiento (RLS):** `tests/aislamiento/004_lecturas_consumo_aislamiento.sql` (CA-2/CA-5), mismo
  mecanismo que 001–003 (`set local role`, `set local request.jwt.claim.sub`, transacción+rollback,
  shim de compatibilidad si no hay Docker): A no lee/escribe periodos ni lecturas de B; solo un
  `abierto` por cliente; único insert de lectura lo pueden hacer admin y lector, pero el lector no
  marca revisiones ni crea/cierra periodos; insert en periodo cerrado falla; `id_cliente_offline`
  duplicado no produce dos filas; `(contador_id, periodo_id)` duplicado viola unique.
- **Integración:** peticiones HTTP reales contra `wrangler dev` para las 6 rutas de §3, mismo
  mecanismo manual que 002/003 (curl con cookie de sesión). Si el contenedor no tiene Docker/
  PostgREST, se declara "NO VERIFICADO" con pasos exactos, igual que en 002 T-004/T-005.
- **Manual (requiere Mateo):** CA-6 (paneles en navegador real) si el entorno no permite
  `wrangler dev` + `next dev` contra una base real.

### Orden de verificación (para `/tasks`)

Migración + aislamiento primero (bloquea todo lo demás), luego `core/consumo.ts` + unit, luego
`lib/lecturas.ts` + rutas, luego frontend, luego cierre CHANGELOG.

