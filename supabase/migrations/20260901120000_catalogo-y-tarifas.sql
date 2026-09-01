-- =============================================================================
-- UndreoCol — Migración 002: Catálogo de servicios y tarifas
-- Referencia: specs/002-catalogo-y-tarifas/plan.md (aprobado 2026-09-01)
--
-- Depende de 20260831150000_fundacion-tenancy.sql: reutiliza clientes,
-- trigger_updated_at(), es_admin_plataforma(), mis_clientes(), tiene_rol(),
-- es_admin_de(). No crea funciones de seguridad nuevas.
--
-- Alcance: enums categoria_tarifaria/tipo_calculo; tablas servicios/tarifas
-- (DDL de docs/esquema-propuesto.sql §6, con updated_at añadida a servicios);
-- tarifa_vigente() tal cual esa referencia; crear_tarifa_version() (nueva,
-- SECURITY INVOKER, SELECT FOR UPDATE — cierre atómico de la tarifa vigente
-- al crear una nueva versión, CLAUDE.md §10 puntos 0/0b/0c/0d); RLS FORCE +
-- políticas siguiendo el mismo patrón que configuracion/usuarios_servicio.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos enumerados
-- -----------------------------------------------------------------------------

create type categoria_tarifaria as enum (
  'estrato_1','estrato_2','estrato_3','estrato_4','estrato_5','estrato_6',
  'comercial','industrial','oficial'
);

create type tipo_calculo as enum ('por_consumo','fijo');

-- -----------------------------------------------------------------------------
-- 2. Catálogo de servicios
-- -----------------------------------------------------------------------------

create table servicios (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references clientes(id) on delete cascade,
  codigo       text not null,
  nombre       text not null,
  tipo_calculo tipo_calculo not null,
  facturable_en_ciclo boolean not null default true,
  orden        smallint not null default 0,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (cliente_id, codigo)
);

comment on table servicios is
  'Catálogo configurable. Un acueducto factura solo agua; otro agua + alcantarillado + aseo. '
  'codigo y tipo_calculo no se editan tras la creación (plan.md §5): un servicio con tarifas '
  'asociadas que cambiara de tipo_calculo dejaría columnas de esas tarifas sin sentido retroactivo.';

create trigger servicios_updated_at
  before update on servicios
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Tarifas — versionadas por vigencia (estructura básico/no básico, CRA)
-- -----------------------------------------------------------------------------

create table tarifas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  servicio_id         uuid not null references servicios(id) on delete restrict,
  categoria           categoria_tarifaria not null,
  vigencia_desde      date not null,
  vigencia_hasta      date,
  cargo_fijo          numeric(12,2) not null default 0,
  limite_basico_m3    numeric(10,2) not null default 0,
  precio_basico_m3    numeric(12,4) not null default 0,
  precio_no_basico_m3 numeric(12,4) not null default 0,
  created_at          timestamptz not null default now(),
  constraint chk_vigencia check (vigencia_hasta is null or vigencia_hasta > vigencia_desde),
  unique (servicio_id, categoria, vigencia_desde)
);

-- on delete restrict (no cascade, a diferencia de docs/esquema-propuesto.sql):
-- un servicio con tarifas nunca se elimina físicamente, solo se desactiva
-- (plan.md §5) — un borrado en cascada silencioso de tarifas es inaceptable
-- (CLAUDE.md §10, punto 0d aplicado también al servicio).

create index on tarifas (cliente_id, servicio_id, categoria, vigencia_desde desc);

comment on table tarifas is
  'Versionada por vigencia: una tarifa nunca se edita, se cierra y se crea una nueva. '
  'Al cambiar un precio: vigencia_hasta de la anterior = hoy-1, vigencia_desde de la nueva = hoy. '
  'Una factura histórica siempre se recalcula con su tarifa original via factura_detalles.tarifa_id.';
comment on column tarifas.vigencia_desde is
  'Primer día en que esta tarifa aplica. Gestionado automáticamente por crear_tarifa_version(), nunca por el usuario directamente.';
comment on column tarifas.vigencia_hasta is
  'Último día de vigencia. null = tarifa activa hoy. Se cierra automáticamente al crear una nueva versión. Nunca se puede eliminar si tiene facturas emitidas.';
comment on column tarifas.limite_basico_m3 is
  'INCLUSIVO (D-1). consumo_basico = min(consumo, limite). consumo_no_basico = max(0, consumo - limite). Con límite 22 y consumo 25: 22 básicos + 3 no básicos.';

-- -----------------------------------------------------------------------------
-- 4. tarifa_vigente() — SECURITY DEFINER (docs/esquema-propuesto.sql §6)
-- -----------------------------------------------------------------------------

create or replace function tarifa_vigente(
  p_servicio_id uuid,
  p_categoria   categoria_tarifaria,
  p_fecha       date default current_date
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from tarifas
  where servicio_id    = p_servicio_id
    and categoria      = p_categoria
    and vigencia_desde <= p_fecha
    and (vigencia_hasta is null or vigencia_hasta >= p_fecha)
  order by vigencia_desde desc
  limit 1;
$$;

comment on function tarifa_vigente is
  'Devuelve el id de la tarifa vigente para un servicio+categoría en una fecha. '
  'El cierre de facturación la llama con la fecha de ejecución del cierre. '
  'Si devuelve NULL, el cierre debe marcar al suscriptor como sin tarifa configurada, '
  'registrar la anomalía y no emitir la factura. '
  'SECURITY DEFINER: no filtra por cliente_id del llamante a propósito (el cierre de '
  'facturación conoce el servicio_id de su propio cliente); la protección multi-tenant '
  'es responsabilidad del llamante — nunca se expone esta función directamente al público, '
  'solo a través de rutas que ya resolvieron el cliente activo del usuario autenticado.';

revoke execute on function tarifa_vigente(uuid, categoria_tarifaria, date) from anon, public;
grant  execute on function tarifa_vigente(uuid, categoria_tarifaria, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. crear_tarifa_version() — SECURITY INVOKER (plan.md §2, §5)
--    Cierra la tarifa vigente y crea la nueva en una sola transacción.
--    SELECT ... FOR UPDATE: mismo patrón que el consecutivo de factura
--    (CLAUDE.md §10, punto 9b) — evita que dos cambios de precio
--    concurrentes dejen dos tarifas activas (CA-6).
--    SECURITY INVOKER (no DEFINER, a diferencia de tarifa_vigente()): no
--    necesita saltarse RLS — el llamante ya tiene permiso de escritura en
--    tarifas por política; se mantiene mínima la superficie de funciones
--    que se saltan RLS. La autorización explícita con es_admin_de() es
--    además de las políticas RLS, no en lugar de ellas.
-- -----------------------------------------------------------------------------

create or replace function crear_tarifa_version(
  p_servicio_id         uuid,
  p_categoria           categoria_tarifaria,
  p_cargo_fijo          numeric,
  p_limite_basico_m3    numeric,
  p_precio_basico_m3    numeric,
  p_precio_no_basico_m3 numeric
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_tarifa_anterior_id uuid;
  v_nueva_id uuid;
begin
  select cliente_id into v_cliente_id from servicios where id = p_servicio_id;
  if v_cliente_id is null then
    raise exception 'Servicio % no existe', p_servicio_id;
  end if;
  if not es_admin_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;

  select id into v_tarifa_anterior_id
    from tarifas
    where servicio_id = p_servicio_id and categoria = p_categoria
      and vigencia_hasta is null
    for update;

  if v_tarifa_anterior_id is not null then
    update tarifas set vigencia_hasta = current_date - 1
      where id = v_tarifa_anterior_id;
  end if;

  insert into tarifas (cliente_id, servicio_id, categoria, vigencia_desde,
                        cargo_fijo, limite_basico_m3, precio_basico_m3,
                        precio_no_basico_m3)
  values (v_cliente_id, p_servicio_id, p_categoria, current_date,
          p_cargo_fijo, p_limite_basico_m3, p_precio_basico_m3,
          p_precio_no_basico_m3)
  returning id into v_nueva_id;

  return v_nueva_id;
end;
$$;

comment on function crear_tarifa_version is
  'Única forma soportada de crear/cambiar una tarifa. Cierra automáticamente '
  'la tarifa vigente del mismo servicio+categoría (vigencia_hasta = hoy-1) y '
  'crea la nueva (vigencia_desde = hoy) en una sola transacción con SELECT '
  'FOR UPDATE. Nunca hay UPDATE directo de cargo_fijo/precio_*_m3 sobre una '
  'fila existente (CLAUDE.md §10, punto 0).';

revoke execute on function crear_tarifa_version(uuid, categoria_tarifaria, numeric, numeric, numeric, numeric) from anon, public;
grant  execute on function crear_tarifa_version(uuid, categoria_tarifaria, numeric, numeric, numeric, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. RLS FORCE + políticas (mismo patrón que configuracion/usuarios_servicio)
-- -----------------------------------------------------------------------------

alter table servicios enable row level security;
alter table servicios force row level security;
alter table tarifas   enable row level security;
alter table tarifas   force row level security;

create policy servicios_lectura on servicios for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy servicios_escritura on servicios for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy tarifas_lectura on tarifas for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy tarifas_escritura on tarifas for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

-- Ninguna política ni ruta expone DELETE de tarifas (CLAUDE.md §10, punto 0d):
-- tarifas_escritura permite ALL (incluye delete) a es_admin_de(), pero la API
-- (backend/src/index.ts) nunca implementa una ruta DELETE /catalogo/tarifas —
-- la única baja de precio soportada es crear_tarifa_version().
