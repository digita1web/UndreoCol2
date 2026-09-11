-- =============================================================================
-- UndreoCol — Migración 029: autorización temporal de tarifas para secretaria
-- =============================================================================

create table autorizaciones_tarifa (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references clientes(id) on delete cascade,
  servicio_id        uuid not null references servicios(id) on delete cascade,
  categoria          categoria_tarifaria not null,
  autorizado_por     uuid not null references perfiles(id),
  motivo             text not null check (btrim(motivo) <> ''),
  expira_en          timestamptz not null,
  usada_en           timestamptz,
  usada_por          uuid references perfiles(id),
  revocada_en        timestamptz,
  revocada_por       uuid references perfiles(id),
  created_at         timestamptz not null default now(),
  constraint chk_autorizacion_fecha check (expira_en > created_at),
  constraint chk_autorizacion_estado check (
    not (usada_en is not null and revocada_en is not null)
  )
);

create unique index uq_autorizacion_tarifa_abierta
  on autorizaciones_tarifa (cliente_id, servicio_id, categoria)
  where usada_en is null and revocada_en is null;
create index idx_autorizaciones_tarifa_cliente
  on autorizaciones_tarifa (cliente_id, created_at desc);

create table auditoria_tarifas_autorizadas (
  id                    uuid primary key default gen_random_uuid(),
  autorizacion_id       uuid not null references autorizaciones_tarifa(id),
  cliente_id            uuid not null references clientes(id),
  servicio_id           uuid not null references servicios(id),
  categoria             categoria_tarifaria not null,
  autorizado_por        uuid not null references perfiles(id),
  ejecutado_por         uuid not null references perfiles(id),
  motivo                text not null,
  cargo_fijo            numeric not null,
  limite_basico_m3      numeric not null,
  precio_basico_m3      numeric not null,
  precio_no_basico_m3   numeric not null,
  tarifa_id             uuid not null references tarifas(id),
  ejecutado_en          timestamptz not null default now()
);

comment on table auditoria_tarifas_autorizadas is
  'Bitácora append-only de cambios de tarifas ejecutados mediante autorización.';

alter table autorizaciones_tarifa enable row level security;
alter table autorizaciones_tarifa force row level security;
alter table auditoria_tarifas_autorizadas enable row level security;
alter table auditoria_tarifas_autorizadas force row level security;

create policy autorizaciones_tarifa_lectura on autorizaciones_tarifa for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy autorizaciones_tarifa_admin_insert on autorizaciones_tarifa for insert
  with check (es_admin_de(cliente_id) and autorizado_por = auth.uid());
create policy autorizaciones_tarifa_admin_update on autorizaciones_tarifa for update
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy auditoria_tarifas_lectura on auditoria_tarifas_autorizadas for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));

create or replace function crear_autorizacion_tarifa(
  p_servicio_id uuid,
  p_categoria categoria_tarifaria,
  p_motivo text,
  p_expira_en timestamptz
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_id uuid;
  v_id uuid;
begin
  select cliente_id into v_cliente_id from servicios where id = p_servicio_id;
  if v_cliente_id is null then raise exception 'Servicio no existe'; end if;
  if not es_admin_de(v_cliente_id) then raise exception 'No autorizado'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'El motivo es obligatorio'; end if;
  if p_expira_en <= now() then raise exception 'La autorización debe expirar en el futuro'; end if;
  if p_expira_en > now() + interval '30 days' then raise exception 'La autorización no puede superar 30 días'; end if;
  if not exists (select 1 from servicios where id = p_servicio_id and cliente_id = v_cliente_id) then
    raise exception 'Servicio fuera del cliente';
  end if;
  insert into autorizaciones_tarifa (cliente_id, servicio_id, categoria, autorizado_por, motivo, expira_en)
  values (v_cliente_id, p_servicio_id, p_categoria, auth.uid(), btrim(p_motivo), p_expira_en)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Ya existe una autorización abierta para servicio y categoría';
end;
$$;

create or replace function revocar_autorizacion_tarifa(p_autorizacion_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  update autorizaciones_tarifa
     set revocada_en = now(), revocada_por = auth.uid()
   where id = p_autorizacion_id
     and es_admin_de(cliente_id)
     and usada_en is null
     and revocada_en is null;
  if not found then raise exception 'Autorización inexistente, usada o no autorizada'; end if;
end;
$$;

create or replace function usar_autorizacion_tarifa(
  p_autorizacion_id uuid,
  p_cargo_fijo numeric,
  p_limite_basico_m3 numeric,
  p_precio_basico_m3 numeric,
  p_precio_no_basico_m3 numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_auth autorizaciones_tarifa%rowtype;
  v_tarifa_id uuid;
  v_caller uuid := auth.uid();
  v_servicio_cliente uuid;
  v_tarifa_anterior_id uuid;
begin
  select * into v_auth from autorizaciones_tarifa
   where id = p_autorizacion_id
   for update;
  if v_auth.id is null then raise exception 'Autorización no existe'; end if;
  if v_auth.usada_en is not null then raise exception 'La autorización ya fue usada'; end if;
  if v_auth.revocada_en is not null then raise exception 'La autorización fue revocada'; end if;
  if v_auth.expira_en <= now() then raise exception 'La autorización expiró'; end if;
  if not es_admin_plataforma() and not tiene_rol(v_auth.cliente_id, array['admin_acueducto','secretaria']::rol_usuario[]) then
    raise exception 'No autorizado';
  end if;
  if not es_admin_plataforma() and not es_admin_de(v_auth.cliente_id)
     and not exists (select 1 from membresias where perfil_id = v_caller and cliente_id = v_auth.cliente_id and activo and rol::text = 'secretaria') then
    raise exception 'No autorizado';
  end if;
  select cliente_id into v_servicio_cliente from servicios where id = v_auth.servicio_id;
  if v_servicio_cliente is null or v_servicio_cliente <> v_auth.cliente_id then
    raise exception 'Servicio fuera del cliente';
  end if;

  select id into v_tarifa_anterior_id
    from tarifas
   where servicio_id = v_auth.servicio_id
     and categoria = v_auth.categoria
     and vigencia_hasta is null
   for update;
  if v_tarifa_anterior_id is not null then
    if (select vigencia_desde from tarifas where id = v_tarifa_anterior_id) = current_date then
      delete from tarifas where id = v_tarifa_anterior_id;
    else
      update tarifas set vigencia_hasta = current_date - 1 where id = v_tarifa_anterior_id;
    end if;
  end if;
  insert into tarifas (
    cliente_id, servicio_id, categoria, vigencia_desde, cargo_fijo,
    limite_basico_m3, precio_basico_m3, precio_no_basico_m3
  ) values (
    v_auth.cliente_id, v_auth.servicio_id, v_auth.categoria, current_date,
    p_cargo_fijo, p_limite_basico_m3, p_precio_basico_m3, p_precio_no_basico_m3
  ) returning id into v_tarifa_id;

  update autorizaciones_tarifa
     set usada_en = now(), usada_por = auth.uid()
   where id = v_auth.id and usada_en is null and revocada_en is null;
  if not found then raise exception 'La autorización ya no está disponible'; end if;

  insert into auditoria_tarifas_autorizadas (
    autorizacion_id, cliente_id, servicio_id, categoria, autorizado_por,
    ejecutado_por, motivo, cargo_fijo, limite_basico_m3, precio_basico_m3,
    precio_no_basico_m3, tarifa_id
  ) values (
    v_auth.id, v_auth.cliente_id, v_auth.servicio_id, v_auth.categoria,
    v_auth.autorizado_por, auth.uid(), v_auth.motivo, p_cargo_fijo,
    p_limite_basico_m3, p_precio_basico_m3, p_precio_no_basico_m3, v_tarifa_id
  );
  return v_tarifa_id;
end;
$$;

revoke execute on function crear_autorizacion_tarifa(uuid, categoria_tarifaria, text, timestamptz) from anon, public;
grant execute on function crear_autorizacion_tarifa(uuid, categoria_tarifaria, text, timestamptz) to authenticated;
revoke execute on function revocar_autorizacion_tarifa(uuid) from anon, public;
grant execute on function revocar_autorizacion_tarifa(uuid) to authenticated;
revoke execute on function usar_autorizacion_tarifa(uuid, numeric, numeric, numeric, numeric) from anon, public;
grant execute on function usar_autorizacion_tarifa(uuid, numeric, numeric, numeric, numeric) to authenticated;

revoke update, delete on auditoria_tarifas_autorizadas from authenticated;