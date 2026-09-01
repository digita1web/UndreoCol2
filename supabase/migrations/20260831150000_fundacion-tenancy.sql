-- =============================================================================
-- UndreoCol — Migración 001: Fundación multi-tenant
-- Referencia: specs/001-fundacion/plan.md §2 (aprobado 2026-09-01)
--
-- Alcance: las 6 tablas de la fundación más el soporte operativo:
--   planes, clientes, perfiles, membresias, configuracion, usuarios_servicio
--   §10 crear_tenant_con_admin() — onboarding transaccional (CA-7)
--   §11 _keepalive + tamano_base_mb() — soporte D-7 (Workers de mantenimiento)
-- Reglas de la fundación:
--   - RLS con FORCE en todas las tablas desde esta migración.
--   - rol_usuario con EXACTAMENTE 3 valores (decisión D-2: sin 'suscriptor').
--   - usuarios_servicio SIN columna perfil_id (decisión D-2).
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Tipos enumerados (solo los de la fundación)
-- -----------------------------------------------------------------------------

create type rol_usuario as enum (
  'administrador',      -- Dueño del software. Acceso total, todos los clientes
  'admin_acueducto',    -- El cliente. Gestiona SU acueducto, nunca otros
  'lector'              -- Fontanero. Lecturas y órdenes asignadas, desde celular
);
-- NOTA (D-2): los suscriptores NO son usuarios del sistema de identidad.

create type estado_cuenta as enum ('activa','vencida','suspendida','cancelada');

create type estado_suscriptor as enum ('activo','suspendido','cortado','inactivo');

-- -----------------------------------------------------------------------------
-- 2. Tablas del panel maestro (nivel plataforma, sin cliente_id)
-- -----------------------------------------------------------------------------

create table planes (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null unique,
  limite_usuarios  integer,                      -- null = ilimitado
  valor_suscriptor numeric(12,2) not null,       -- COP por suscriptor/mes
  valor_minimo_mes numeric(12,2) not null default 0,
  activo           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table clientes (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  slug              text not null unique,
  nit               text,
  direccion         text,
  municipio         text,
  departamento      text,
  telefono          text,
  email_contacto    text,
  logo_url          text,
  plan_id           uuid references planes(id),
  estado_cuenta     estado_cuenta not null default 'activa',
  fecha_alta        date not null default current_date,
  fecha_vencimiento date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_slug check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table clientes is
  'Cada acueducto cliente. clientes.id es el tenant_id que aísla todos los datos.';

-- -----------------------------------------------------------------------------
-- 3. Identidad y roles
-- -----------------------------------------------------------------------------

create table perfiles (
  id         uuid primary key,                   -- = auth.users.id en Supabase
  nombre     text not null,
  email      text not null,
  telefono   text,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- El rol 'administrador' (dueño del software) se registra con cliente_id NULL.
create table membresias (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid not null references perfiles(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete cascade,
  rol        rol_usuario not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_ambito_rol check (
    (rol = 'administrador' and cliente_id is null) or
    (rol <> 'administrador' and cliente_id is not null)
  )
);

create unique index uq_membresia on membresias
  (perfil_id, coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index on membresias (cliente_id, rol) where activo;
create index on membresias (perfil_id) where activo;

-- -----------------------------------------------------------------------------
-- 4. Configuración por cliente
-- -----------------------------------------------------------------------------

create table configuracion (
  cliente_id           uuid primary key references clientes(id) on delete cascade,
  porcentaje_mora      numeric(6,3) not null default 2.0,   -- % sobre saldo vencido
  dias_vencimiento     integer not null default 30,
  dias_umbral_corte    integer not null default 60,
  valor_reconexion     numeric(12,2) not null default 0,
  factor_consumo_alto  numeric(6,2) not null default 150.0,
  piso_consumo_alto_m3 numeric(10,2) not null default 100.0,
  factor_consumo_bajo  numeric(6,2) not null default 20.0,
  umbral_rollover_pct  numeric(6,2) not null default 90.0,
  prefijo_factura      text not null default 'FAC',
  prefijo_reconexion   text not null default 'REC',
  consecutivo_factura  integer not null default 0,
  anio_consecutivo     smallint not null
    default extract(year from current_date)::smallint,
  updated_at           timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. usuarios_servicio — versión MÍNIMA (solo para verificar aislamiento RLS)
--    SIN columna perfil_id (D-2). Se amplía en la feature de suscriptores.
-- -----------------------------------------------------------------------------

create table usuarios_servicio (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  codigo_suscriptor text not null,
  nombre            text not null,
  estado            estado_suscriptor not null default 'activo',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cliente_id, codigo_suscriptor)
);

create index on usuarios_servicio (cliente_id, estado);

comment on table usuarios_servicio is
  'Mínima en la fundación: su único propósito es verificar el aislamiento RLS (D-2).';

-- -----------------------------------------------------------------------------
-- 6. Funciones de seguridad (SECURITY DEFINER: evitan recursión en políticas RLS)
-- -----------------------------------------------------------------------------

create or replace function es_admin_plataforma()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias
    where perfil_id = auth.uid() and rol = 'administrador' and activo);
$$;

create or replace function mis_clientes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select cliente_id from membresias
  where perfil_id = auth.uid() and activo and cliente_id is not null;
$$;

create or replace function tiene_rol(p_cliente_id uuid, p_roles rol_usuario[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias
    where perfil_id = auth.uid() and cliente_id = p_cliente_id
      and activo and rol = any(p_roles));
$$;

create or replace function es_admin_de(p_cliente_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select es_admin_plataforma()
      or tiene_rol(p_cliente_id, array['admin_acueducto']::rol_usuario[]);
$$;

-- -----------------------------------------------------------------------------
-- 7. Trigger updated_at
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_clientes_updated before update on clientes
  for each row execute function set_updated_at();
create trigger trg_perfiles_updated before update on perfiles
  for each row execute function set_updated_at();
create trigger trg_usuarios_servicio_updated before update on usuarios_servicio
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- 8. RLS con FORCE — desde la primera migración (CLAUDE.md §5.4)
--    FORCE aplica las políticas incluso al dueño de la tabla.
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'planes','clientes','perfiles','membresias','configuracion','usuarios_servicio'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Políticas RLS
-- -----------------------------------------------------------------------------

-- --- Panel maestro -----------------------------------------------------------

-- planes: lectura pública (cualquier sesión); escritura solo plataforma.
create policy planes_lectura on planes for select using (true);
create policy planes_escritura on planes for all
  using (es_admin_plataforma()) with check (es_admin_plataforma());

-- clientes: lectura para miembros del propio cliente o plataforma;
--           escritura SOLO plataforma en la fundación (decisión D-8 del plan).
create policy clientes_lectura on clientes for select
  using (es_admin_plataforma() or id in (select mis_clientes()));
create policy clientes_plataforma on clientes for all
  using (es_admin_plataforma()) with check (es_admin_plataforma());

-- --- Identidad ---------------------------------------------------------------

create policy perfiles_lectura on perfiles for select
  using (
    id = auth.uid()
    or es_admin_plataforma()
    or exists (select 1 from membresias m
         where m.perfil_id = perfiles.id and m.cliente_id in (select mis_clientes()))
  );
create policy perfiles_update_propio on perfiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy membresias_lectura on membresias for select
  using (perfil_id = auth.uid() or es_admin_plataforma()
         or cliente_id in (select mis_clientes()));

-- REGLA CRÍTICA (CLAUDE.md §9-23): el admin del acueducto crea usuarios de SU
-- acueducto, pero NUNCA puede otorgar el rol 'administrador', ni a otros ni a sí
-- mismo. Se bloquea en RLS, no solo en la interfaz.
create policy membresias_gestion_acueducto on membresias for all
  using (
    cliente_id is not null
    and tiene_rol(cliente_id, array['admin_acueducto']::rol_usuario[])
    and rol in ('admin_acueducto','lector')
  )
  with check (
    cliente_id is not null
    and tiene_rol(cliente_id, array['admin_acueducto']::rol_usuario[])
    and rol in ('admin_acueducto','lector')
  );

create policy membresias_plataforma on membresias for all
  using (es_admin_plataforma()) with check (es_admin_plataforma());

-- --- Tablas tenantizadas estándar --------------------------------------------
-- configuracion y usuarios_servicio: lectura para miembros del cliente o
-- plataforma; escritura para admin del acueducto o plataforma.

create policy configuracion_lectura on configuracion for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy configuracion_escritura on configuracion for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy usuarios_servicio_lectura on usuarios_servicio for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy usuarios_servicio_escritura on usuarios_servicio for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

-- -----------------------------------------------------------------------------
-- 10. Onboarding transaccional (spec §4.5, CA-7)
-- -----------------------------------------------------------------------------
-- Crea cliente + perfil + membresia(admin_acueducto) + configuracion en UNA
-- transacción. SECURITY DEFINER: la política clientes_plataforma solo permite
-- escritura de clientes a la plataforma, así que el onboarding del admin del
-- acueducto pasa por esta función. Revoca a anon; otorga a authenticated.

create or replace function crear_tenant_con_admin(
  p_nombre_cliente text,
  p_slug          text,
  p_email         text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cliente_id uuid;
begin
  -- Solo el propio usuario autenticado (auth.uid()) puede crear SU tenant.
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  -- Un usuario con membresía activa no crea otro acueducto (el multi-tenant por
  -- usuario lo gestiona el panel maestro de la plataforma, feature posterior).
  if exists (select 1 from membresias where perfil_id = auth.uid() and activo) then
    raise exception 'El usuario ya tiene un acueducto';
  end if;
  begin
    insert into clientes (nombre, slug) values (p_nombre_cliente, p_slug)
      returning id into v_cliente_id;
  exception when unique_violation then
    -- Duplicado de slug (unique clientes.slug): revierte TODO por atomicidad.
    raise exception 'El slug ya está en uso';
  end;
  insert into perfiles (id, nombre, email) values (auth.uid(), p_nombre_cliente, p_email);
  insert into membresias (perfil_id, cliente_id, rol)
    values (auth.uid(), v_cliente_id, 'admin_acueducto');
  insert into configuracion (cliente_id) values (v_cliente_id);
  return v_cliente_id;
end $$;

revoke execute on function crear_tenant_con_admin(text, text, text) from anon, public;
grant  execute on function crear_tenant_con_admin(text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Soporte D-7 — Supabase Free explotado al máximo
--     Ver docs/DECISIONES.md D-7 e INFRAESTRUCTURA.md §5 y §8.
--     (equivalente a la sección 18 de docs/esquema-propuesto.sql)
-- -----------------------------------------------------------------------------

-- --- Worker de keepalive (INFRAESTRUCTURA.md §5) -----------------------------
-- Evita que el proyecto se pause tras 7 días de inactividad en el plan Free.

create table if not exists _keepalive (
  id           smallint primary key default 1,
  ultimo_ping  timestamptz not null default now(),
  constraint chk_singleton check (id = 1)
);

insert into _keepalive (id, ultimo_ping) values (1, now())
  on conflict (id) do nothing;

comment on table _keepalive is
  'Tabla técnica de soporte para el Worker de keepalive (D-7). '
  'Sin cliente_id ni RLS de negocio: solo accesible con service_role_key '
  'desde el Worker de cron, nunca desde una ruta de la API pública.';

alter table _keepalive enable row level security;
alter table _keepalive force row level security;
-- Sin políticas: por defecto nadie (anon/authenticated) puede tocarla.
-- service_role bypasea RLS por diseño de Supabase.

-- --- Worker de monitoreo de tamaño de base (INFRAESTRUCTURA.md §8) ----------
-- Alerta antes de llegar al límite de 500 MB del plan Free.

create or replace function tamano_base_mb()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2);
$$;

comment on function tamano_base_mb is
  'Tamaño actual de la base de datos en MB. Usada por el Worker de '
  'monitoreo (INFRAESTRUCTURA.md §8) para alertar en 300/400/480 MB, '
  'antes del límite de 500 MB del plan Free de Supabase (D-7).';

revoke execute on function tamano_base_mb from anon, authenticated, public;
grant execute on function tamano_base_mb to service_role;

-- -----------------------------------------------------------------------------
-- COMPATIBILIDAD SELF-HOSTED (sin Supabase) — solo documentación
-- -----------------------------------------------------------------------------
-- La única dependencia de Supabase es auth.uid(). Para correr sin Supabase,
-- crear ANTES de esta migración (no se cambia nada más del esquema):
--
--   create schema if not exists auth;
--   create or replace function auth.uid() returns uuid language sql stable as $$
--     select nullif(current_setting('app.perfil_id', true), '')::uuid;
--   $$;
--
-- Y la aplicación ejecuta al inicio de cada transacción:
--   set local app.perfil_id = '<uuid del usuario autenticado>';
-- =============================================================================



