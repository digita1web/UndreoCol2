-- =============================================================================
-- UndreoCol — Migración 003: Suscriptores y contadores
-- Referencia: specs/003-suscriptores-contadores/plan.md (aprobado 2026-09-01)
--
-- Depende de 001 (usuarios_servicio mínima, RLS, set_updated_at(), es_admin_de(),
-- mis_clientes(), es_admin_plataforma()) y 002 (enum categoria_tarifaria).
--
-- Alcance: ALTER TABLE usuarios_servicio (columnas nuevas NULLABLE — la tabla ya
-- tiene filas de los fixtures de 001/002, un NOT NULL directo rompería el
-- reset; el requerido real se exige en la capa de aplicación para filas
-- nuevas, plan.md §5); enum estado_contador; tablas contadores/
-- reemplazos_contador; reemplazar_contador() (SECURITY INVOKER, SELECT FOR
-- UPDATE sobre usuarios_servicio); RLS FORCE + políticas en las 2 tablas
-- nuevas, mismo patrón que usuarios_servicio (que no se toca: sus políticas
-- ya filtran por cliente_id, no por columna).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. usuarios_servicio — ampliación (plan.md §2)
-- -----------------------------------------------------------------------------

alter table usuarios_servicio
  add column tipo_documento     text,
  add column numero_documento   text,
  add column telefono           text,
  add column email              text,
  add column direccion          text,
  add column sector             text,
  add column categoria          categoria_tarifaria,
  add column contador_actual_id uuid,
  add column fecha_vinculacion  date not null default current_date,
  add column notas              text;

create index on usuarios_servicio (cliente_id, numero_documento);

comment on column usuarios_servicio.numero_documento is
  'NULLABLE a nivel de esquema (la tabla ya tenía filas al agregar esta columna). '
  'Requerido en la capa de aplicación para suscriptores nuevos. Junto con '
  'codigo_suscriptor forma la credencial del portal (D-2, feature 008).';
comment on column usuarios_servicio.categoria is
  'categoria_tarifaria (002). NULLABLE a nivel de esquema por el mismo motivo '
  'que numero_documento; requerida en la capa de aplicación.';

-- -----------------------------------------------------------------------------
-- 2. Contadores
-- -----------------------------------------------------------------------------

create type estado_contador as enum ('activo','danado','reemplazado');

create table contadores (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  serial              text not null,
  marca               text,
  capacidad_maxima    numeric(12,2) not null,
  lectura_inicial     numeric(12,2) not null default 0,
  fecha_instalacion   date not null,
  estado              estado_contador not null default 'activo',
  observaciones       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (cliente_id, serial),
  constraint chk_capacidad check (capacidad_maxima > 0)
);

create unique index uq_contador_activo
  on contadores (usuario_servicio_id) where estado = 'activo';
create index on contadores (cliente_id, usuario_servicio_id);

comment on column contadores.capacidad_maxima is
  'Techo de rollover para 004: si lectura_actual < lectura_anterior Y '
  'lectura_anterior > capacidad_maxima * umbral_rollover_pct/100, hubo vuelta. '
  'Consumo = (capacidad_maxima - anterior) + actual. 003 no calcula esto.';

create trigger trg_contadores_updated before update on contadores
  for each row execute function set_updated_at();

alter table usuarios_servicio
  add constraint fk_contador_actual
  foreign key (contador_actual_id) references contadores(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 3. Reemplazo de contador a mitad de periodo
-- -----------------------------------------------------------------------------

create table reemplazos_contador (
  id                     uuid primary key default gen_random_uuid(),
  cliente_id             uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id    uuid not null references usuarios_servicio(id) on delete restrict,
  contador_anterior_id   uuid not null references contadores(id) on delete restrict,
  contador_nuevo_id      uuid not null references contadores(id) on delete restrict,
  fecha_reemplazo        date not null default current_date,
  lectura_final_anterior numeric(12,2) not null,
  lectura_inicial_nuevo  numeric(12,2) not null default 0,
  motivo                 text,
  registrado_por         uuid references perfiles(id),
  created_at             timestamptz not null default now(),
  constraint chk_distintos check (contador_anterior_id <> contador_nuevo_id)
);

create index on reemplazos_contador (cliente_id, usuario_servicio_id, fecha_reemplazo);

comment on table reemplazos_contador is
  'Solo registra el evento (plan.md §3.3/§4). El cálculo de consumo que '
  'combina lectura_final_anterior y lectura_inicial_nuevo con las lecturas '
  'reales del periodo es de core/consumo.ts en 004 — no existe todavía.';

-- -----------------------------------------------------------------------------
-- 4. reemplazar_contador() — SECURITY INVOKER (plan.md §2, §5)
--    SELECT FOR UPDATE sobre usuarios_servicio (no sobre contadores): es la
--    fila que decide cuál es "el contador activo" del suscriptor. El índice
--    único parcial uq_contador_activo es la segunda barrera.
-- -----------------------------------------------------------------------------

create or replace function reemplazar_contador(
  p_usuario_servicio_id    uuid,
  p_serial_nuevo           text,
  p_marca_nuevo            text,
  p_capacidad_maxima_nuevo numeric,
  p_lectura_final_anterior numeric,
  p_lectura_inicial_nuevo  numeric,
  p_motivo                 text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_contador_anterior_id uuid;
  v_contador_nuevo_id uuid;
  v_reemplazo_id uuid;
begin
  select cliente_id, contador_actual_id into v_cliente_id, v_contador_anterior_id
    from usuarios_servicio where id = p_usuario_servicio_id
    for update;

  if v_cliente_id is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if not es_admin_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;
  if v_contador_anterior_id is null then
    raise exception 'El suscriptor no tiene contador activo para reemplazar';
  end if;

  update contadores set estado = 'reemplazado' where id = v_contador_anterior_id;

  insert into contadores (cliente_id, usuario_servicio_id, serial, marca,
                           capacidad_maxima, lectura_inicial, fecha_instalacion, estado)
  values (v_cliente_id, p_usuario_servicio_id, p_serial_nuevo, p_marca_nuevo,
          p_capacidad_maxima_nuevo, p_lectura_inicial_nuevo, current_date, 'activo')
  returning id into v_contador_nuevo_id;

  update usuarios_servicio set contador_actual_id = v_contador_nuevo_id
    where id = p_usuario_servicio_id;

  insert into reemplazos_contador (cliente_id, usuario_servicio_id, contador_anterior_id,
                                    contador_nuevo_id, lectura_final_anterior,
                                    lectura_inicial_nuevo, motivo)
  values (v_cliente_id, p_usuario_servicio_id, v_contador_anterior_id, v_contador_nuevo_id,
          p_lectura_final_anterior, p_lectura_inicial_nuevo, p_motivo)
  returning id into v_reemplazo_id;

  return v_reemplazo_id;
end;
$$;

comment on function reemplazar_contador is
  'Única forma soportada de reemplazar el contador de un suscriptor: marca el '
  'anterior reemplazado, crea el nuevo activo, actualiza '
  'usuarios_servicio.contador_actual_id y registra el evento — todo en una '
  'transacción con SELECT FOR UPDATE sobre usuarios_servicio.';

revoke execute on function reemplazar_contador(uuid, text, text, numeric, numeric, numeric, text) from anon, public;
grant  execute on function reemplazar_contador(uuid, text, text, numeric, numeric, numeric, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. RLS FORCE + políticas (mismo patrón que usuarios_servicio/tarifas)
-- -----------------------------------------------------------------------------

alter table contadores enable row level security;
alter table contadores force row level security;
alter table reemplazos_contador enable row level security;
alter table reemplazos_contador force row level security;

create policy contadores_lectura on contadores for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy contadores_escritura on contadores for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy reemplazos_contador_lectura on reemplazos_contador for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy reemplazos_contador_escritura on reemplazos_contador for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
