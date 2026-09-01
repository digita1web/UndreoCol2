-- =============================================================================
-- UndreoCol — Migración 004: Periodos y lecturas
-- Referencia: specs/004-lecturas-y-consumo/plan.md (aprobado 2026-09-04) y spec.md
--
-- Depende de 001 (políticas/roles, configuracion con los umbrales de anomalía y
-- rollover, es_admin_de()/mis_clientes()/tiene_rol()/es_admin_plataforma()/
-- set_updated_at()), 002 (servicios/tarifas — no usados aquí directamente pero
-- parte del pipeline) y 003 (contadores, reemplazos_contador).
--
-- Alcance: enums estado_periodo/revision_lectura; tablas periodos/lecturas
-- (docs/esquema-propuesto.sql §8); índice único parcial uq_periodo_abierto
-- (un solo periodo abierto por cliente, CLAUDE.md §10 punto 9); trigger
-- bloquear_lectura_periodo_cerrado() (SECURITY DEFINER: solo lee estado de
-- periodos, plan.md §2); unique (contador_id, periodo_id) + unique
-- id_cliente_offline (idempotencia); RLS FORCE + políticas en ambas tablas.
--
-- El consumo_m3 SIEMPRE lo calcula core/consumo.ts (CLAUDE.md §5.3). La
-- migración solo garantiza contraints de integridad (consumo >= 0, no duplicar,
-- no insertar en periodo cerrado). La ruta no escribe consumo a mano.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

create type estado_periodo as enum ('abierto','cerrado');

create type revision_lectura as enum
  ('normal','consumo_alto','consumo_bajo','consumo_cero');

-- -----------------------------------------------------------------------------
-- 2. Periodo de facturación
-- -----------------------------------------------------------------------------

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

create unique index uq_periodo_abierto
  on periodos (cliente_id) where estado = 'abierto';

create index on periodos (cliente_id, estado);

create trigger trg_periodos_updated before update on periodos
  for each row execute function set_updated_at();

comment on table periodos is
  'Un solo periodo abierto por acueducto (uq_periodo_abierto). Un periodo '
  'cerrado es inmutable: no acepta lecturas (trigger bloquear_lectura_periodo_cerrado) '
  'ni se reabre. El cierre masivo de facturación (005) consumirá el estado cerrado.';

-- -----------------------------------------------------------------------------
-- 3. Lecturas
-- -----------------------------------------------------------------------------

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
  id_cliente_offline text unique,                 -- idempotencia app móvil (014)
  created_at         timestamptz not null default now(),
  unique (contador_id, periodo_id),               -- bloquea duplicadas (CLAUDE.md §10 punto 3)
  constraint chk_consumo check (consumo_m3 >= 0)  -- nunca consumo negativo
);

create index on lecturas (cliente_id, periodo_id);
create index on lecturas (contador_id, fecha_lectura desc);
create index on lecturas (cliente_id, revision)
  where revision <> 'normal' and not revisada;     -- cola de revisión de anomalías

comment on column lecturas.revision is
  'consumo_alto: > factor_consumo_alto% del promedio Y > piso_consumo_alto_m3. '
  'consumo_bajo: < factor_consumo_bajo% del promedio. consumo_cero: consumo = 0. '
  'Marcan para revisión, NUNCA bloquean el guardado (CLAUDE.md §10 puntos 5 y 6). ';
comment on column lecturas.consumo_m3 is
  'Siempre calculado por core/consumo.ts (rollover, rechazo, reemplazo, anomalía). '
  'La ruta solo persiste el resultado; nunca escribe este valor a mano.';
comment on column lecturas.id_cliente_offline is
  'UUID generado en el celular (PWA lector, feature 014). Si la app reenvía por '
  'falla de red, el unique evita duplicar (CLAUDE.md §10 punto 8).';

-- -----------------------------------------------------------------------------
-- 4. Bloqueo de lectura en periodo cerrado (plan.md §2)
--    Un CHECK no puede referenciar otra tabla, así que se usa trigger BEFORE
--    INSERT + función SECURITY DEFINER acotada (solo lee `estado` de periodos).
--    SECURITY DEFINER: el trigger corre con el rol del llamador (que inserta la
--    lectura), y por spec §5 el rol `lector` no gestiona periodos; debe poder
--    validar que su lectura cae en un periodo `abierto`. El owner (postgres,
--    superuser con BYPASSRLS) ejecuta el SELECT superando la RLS FORCE de
--    periodos. Es el único acceso que este constructor abre y queda testeado en
--    tests/aislamiento/004_lecturas_consumo_aislamiento.sql.
-- -----------------------------------------------------------------------------

create function bloquear_lectura_periodo_cerrado() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado estado_periodo;
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

-- -----------------------------------------------------------------------------
-- 5. RLS FORCE + políticas (plan.md §2)
--    periodos: lector solo lee; admin gestiona. (CLAUDE.md §10 punto 24: el
--    lector no gestiona periodos.)
--    lecturas: lector puede insertar y leer de su cliente; revisión/borrado
--    solo admin_acueducto (las anomalías las revisa el admin, no el lector).
-- -----------------------------------------------------------------------------

alter table periodos enable row level security;
alter table periodos force row level security;

create policy periodos_lectura on periodos for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy periodos_admin on periodos for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

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

-- La regla de "no borrar una lectura con factura emitida" es de 005 (límite
-- conocido transferido en plan.md §2): aquí solo se restringe el delete por RLS
-- a admin_acueducto.

