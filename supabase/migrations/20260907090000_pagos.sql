-- =============================================================================
-- UndreoCol — Migración 007: Pagos y cartera
-- Referencia: specs/007-pagos-y-cartera/plan.md (aprobado 2026-09-07) y spec.md
--
-- Depende de 001 (clientes, perfiles, RLS, es_admin_de()/mis_clientes()/
-- es_admin_plataforma()), 003 (usuarios_servicio) y 005 (facturas con
-- total_pagado/estado; trg_factura_inmutable ya permite el UPDATE exclusivo de
-- total_pagado y estado para esta feature). 007 no toca notificaciones (006).
--
-- Alcance: enum metodo_pago y tablas pagos/pago_aplicaciones
-- (docs/esquema-propuesto.sql §10); trigger de integridad de aplicaciones;
-- RPCs transaccionales registrar_pago/anular_pago (SECURITY INVOKER +
-- SELECT FOR UPDATE, patrón de 002/003) con reversión RECALCULADA desde los
-- pagos vigentes (nunca resta a ciegas); RLS FORCE + políticas.
--
-- DESVIACIÓN TÉCNICA documentada frente al plan.md §2: la RPC registrar_pago
-- recibe p_aplicaciones jsonb (lista {factura_id, valor} calculada por
-- core/pagos.ts en el Worker) en vez de distribuir el valor en SQL. Razón:
-- CLAUDE.md §5.3 — el cálculo del dinero (cuánto se abona a cada factura y el
-- remanente) vive en core/ (puro, unit-testeado); la RPC VALIDA y aplica con
-- bloqueo atómico sobre el estado real. El comportamiento observable del spec
-- (más antigua primero cuando no se elige, sobrante a favor, total/parcial)
-- es idéntico: el Worker resuelve la distribución con core.distribuirPago.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum
-- -----------------------------------------------------------------------------

create type metodo_pago as enum ('efectivo','transferencia','consignacion','pse','otro');

-- -----------------------------------------------------------------------------
-- 2. Pagos
-- -----------------------------------------------------------------------------

create table pagos (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  valor               numeric(12,2) not null check (valor > 0),
  fecha_pago          date not null default current_date,
  metodo              metodo_pago not null default 'efectivo',
  referencia          text,
  recibido_por        uuid references perfiles(id) on delete restrict, -- quién registra (trazabilidad)
  anulado             boolean not null default false,
  motivo_anulacion    text,
  observaciones       text,
  created_at          timestamptz not null default now()
);

create index on pagos (cliente_id, fecha_pago desc);
create index on pagos (usuario_servicio_id) where not anulado;

comment on table pagos is
  'Pago de un suscriptor. Nunca se edita ni se borra: se anula (anulado=true +
  motivo_anulacion) revirtiendo sus efectos. La suma de pago_aplicaciones de un
  pago puede ser menor que valor: el remanente queda a favor del suscriptor
  (CLAUDE.md §10 punto 14: el sobrante no se pierde).';

-- -----------------------------------------------------------------------------
-- 3. Aplicaciones del pago a facturas
-- -----------------------------------------------------------------------------

create table pago_aplicaciones (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  pago_id    uuid not null references pagos(id) on delete cascade,
  factura_id uuid not null references facturas(id) on delete restrict,
  valor      numeric(12,2) not null check (valor > 0),
  unique (pago_id, factura_id)  -- un pago abona una sola vez por factura
);

create index on pago_aplicaciones (factura_id);
create index on pago_aplicaciones (pago_id);

comment on table pago_aplicaciones is
  'Cuánto de un pago se aplica a cada factura. Un pago puede abonar a una o
  varias facturas. Sum(pago_aplicaciones.valor) <= pagos.valor; el sobrante
  queda a favor del suscriptor.';

-- -----------------------------------------------------------------------------
-- 4. Trigger de integridad de las aplicaciones (red de seguridad; la RPC
--    valida y bloquea antes — este trigger cubre cualquier INSERT directo)
-- -----------------------------------------------------------------------------

create function validar_pago_aplicacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cliente_pago     uuid;
  v_usuario_pago     uuid;
  v_anulado_pago     boolean;
  v_valor_pago       numeric(12,2);
  v_cliente_factura  uuid;
  v_usuario_factura  uuid;
  v_estado_factura   text;
  v_total            numeric(12,2);
  v_total_pagado     numeric(12,2);
  v_saldo            numeric(12,2);
  v_sum_aplicaciones numeric(12,2);
begin
  select cliente_id, usuario_servicio_id, anulado, valor
    into v_cliente_pago, v_usuario_pago, v_anulado_pago, v_valor_pago
    from pagos where id = new.pago_id;
  if v_cliente_pago is null then
    raise exception 'El pago % no existe', new.pago_id;
  end if;
  if v_anulado_pago then
    raise exception 'No se puede aplicar un abono a un pago anulado';
  end if;
  if v_cliente_pago is distinct from new.cliente_id then
    raise exception 'El pago pertenece a otro cliente';
  end if;

  select cliente_id, usuario_servicio_id, estado, total, total_pagado
    into v_cliente_factura, v_usuario_factura, v_estado_factura, v_total, v_total_pagado
    from facturas where id = new.factura_id;
  if v_cliente_factura is null then
    raise exception 'La factura % no existe', new.factura_id;
  end if;
  if v_cliente_factura is distinct from new.cliente_id then
    raise exception 'La factura pertenece a otro cliente';
  end if;
  if v_usuario_factura is distinct from v_usuario_pago then
    raise exception 'El pago y la factura pertenecen a suscriptores distintos';
  end if;
  if v_estado_factura = 'anulada' then
    raise exception 'No se puede abonar a una factura anulada';
  end if;

  v_saldo := v_total - v_total_pagado;
  if new.valor > v_saldo then
    raise exception 'El abono % supera el saldo vivo de la factura (%)', new.valor, v_saldo;
  end if;

  select coalesce(sum(valor), 0) into v_sum_aplicaciones
    from pago_aplicaciones where pago_id = new.pago_id;
  if tg_op = 'UPDATE' then
    v_sum_aplicaciones := v_sum_aplicaciones - old.valor;
  end if;
  if v_sum_aplicaciones + new.valor > v_valor_pago then
    raise exception 'La suma de abonos (%) supera el valor del pago (%)',
                    v_sum_aplicaciones + new.valor, v_valor_pago;
  end if;

  return new;
end $$;

create trigger trg_pago_aplicacion_valida
  before insert or update on pago_aplicaciones
  for each row execute function validar_pago_aplicacion();

-- -----------------------------------------------------------------------------
-- 5. RPC registrar_pago — aplica un pago a sus facturas en UNA transacción
--    SECURITY INVOKER (RLS gobierna), patrón de 002/003. Recibe las
--    aplicaciones YA distribuidas por core/pagos.ts (desviación documentada en
--    la cabecera): la RPC valida cada abono contra el estado real (SELECT FOR
--    UPDATE) y aplica. Devuelve { pago, aplicaciones, remanente, facturas }.
-- -----------------------------------------------------------------------------

create or replace function registrar_pago(
  p_cliente_id          uuid,
  p_usuario_servicio_id uuid,
  p_valor               numeric,
  p_aplicaciones        jsonb,          -- [{"factura_id": uuid, "valor": n}]
  p_recibido_por        uuid,           -- perfil autenticado que registra (obligatorio)
  p_fecha_pago          date default current_date,
  p_metodo              metodo_pago default 'efectivo',
  p_referencia          text default null,
  p_observaciones       text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_suscriptor uuid;
  v_pago_id            uuid;
  v_suma_aplicada      numeric(12,2);
  v_remanente          numeric(12,2);
  v_aplicaciones       jsonb := '[]'::jsonb;
  v_facturas           jsonb := '[]'::jsonb;
  r                    record;
  v_f_id               uuid;
  v_f_cliente          uuid;
  v_f_usuario          uuid;
  v_f_estado           text;
  v_f_total            numeric(12,2);
  v_f_pagado           numeric(12,2);
  v_f_saldo            numeric(12,2);
begin
  if p_valor is null or p_valor <= 0 then
    raise exception 'El valor del pago debe ser mayor que cero';
  end if;
  if p_recibido_por is null then
    raise exception 'Falta el perfil que registra el pago';
  end if;

  -- el suscriptor debe existir y ser del cliente (el SELECT ... FOR UPDATE
  -- aplica la política de UPDATE de usuarios_servicio: un ajeno no lo ve)
  select cliente_id into v_cliente_suscriptor
    from usuarios_servicio where id = p_usuario_servicio_id for update;
  if v_cliente_suscriptor is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if v_cliente_suscriptor is distinct from p_cliente_id then
    raise exception 'El suscriptor no pertenece al cliente';
  end if;
  if not es_admin_de(p_cliente_id) then
    raise exception 'No autorizado';
  end if;

  -- suma de los abonos solicitados <= valor del pago (el resto es remanente)
  select coalesce(sum((e->>'valor')::numeric), 0)
    into v_suma_aplicada
    from jsonb_array_elements(coalesce(p_aplicaciones, '[]'::jsonb)) e
   where (e->>'valor')::numeric > 0;
  if v_suma_aplicada > p_valor then
    raise exception 'La suma de los abonos (%) supera el valor del pago (%)',
                    v_suma_aplicada, p_valor;
  end if;

  insert into pagos (cliente_id, usuario_servicio_id, valor, fecha_pago, metodo,
                     referencia, recibido_por, observaciones)
  values (p_cliente_id, p_usuario_servicio_id, p_valor, p_fecha_pago, p_metodo,
          p_referencia, p_recibido_por, p_observaciones)
  returning id into v_pago_id;

  for r in
    select (e->>'factura_id')::uuid as factura_id, (e->>'valor')::numeric as valor
      from jsonb_array_elements(coalesce(p_aplicaciones, '[]'::jsonb)) e
     where (e->>'valor')::numeric > 0
  loop
    select cliente_id, usuario_servicio_id, estado, total, total_pagado
      into v_f_cliente, v_f_usuario, v_f_estado, v_f_total, v_f_pagado
      from facturas where id = r.factura_id for update;
    if v_f_cliente is null then
      raise exception 'La factura % no existe', r.factura_id;
    end if;
    if v_f_cliente is distinct from p_cliente_id
       or v_f_usuario is distinct from p_usuario_servicio_id then
      raise exception 'La factura % no pertenece al suscriptor de este pago', r.factura_id;
    end if;
    if v_f_estado = 'anulada' then
      raise exception 'No se puede abonar a la factura anulada %', r.factura_id;
    end if;
    v_f_saldo := v_f_total - v_f_pagado;
    if r.valor > v_f_saldo then
      raise exception 'El saldo vivo de la factura % cambió (%): reintente',
                      r.factura_id, v_f_saldo;
    end if;

    insert into pago_aplicaciones (cliente_id, pago_id, factura_id, valor)
    values (p_cliente_id, v_pago_id, r.factura_id, r.valor);

    update facturas
       set total_pagado = total_pagado + r.valor,
           estado       = case when total_pagado + r.valor >= total
                               then 'pagada'::estado_factura
                               else estado end
     where id = r.factura_id;

    v_aplicaciones := v_aplicaciones || jsonb_build_object('factura_id', r.factura_id, 'valor', r.valor);
    v_facturas := v_facturas || jsonb_build_object(
      'factura_id', r.factura_id,
      'total', v_f_total,
      'total_pagado', v_f_pagado + r.valor,
      'estado', case when v_f_pagado + r.valor >= v_f_total then 'pagada' else 'pendiente' end
    );
  end loop;

  v_remanente := p_valor - v_suma_aplicada;

  return jsonb_build_object(
    'pago', jsonb_build_object(
      'id', v_pago_id,
      'cliente_id', p_cliente_id,
      'usuario_servicio_id', p_usuario_servicio_id,
      'valor', p_valor,
      'fecha_pago', p_fecha_pago,
      'metodo', p_metodo,
      'referencia', p_referencia,
      'recibido_por', p_recibido_por,
      'observaciones', p_observaciones
    ),
    'aplicaciones', v_aplicaciones,
    'remanente', v_remanente,
    'facturas', v_facturas
  );
end $$;

comment on function registrar_pago is
  'Registra un pago y aplica sus abonos a las facturas del suscriptor en UNA '
  'transacción con SELECT FOR UPDATE (dos pagos concurrentes no aplican el mismo '
  'saldo). Las aplicaciones llegan calculadas por core/pagos.ts (CLAUDE.md §5.3); '
  'la RPC valida contra el estado real y aplica. El remanente (p_valor - suma de '
  'abonos) queda a favor del suscriptor (regla 14): nunca se pierde.';

-- -----------------------------------------------------------------------------
-- 6. RPC anular_pago — un pago no se borra ni se edita: se anula con motivo y
--    responsable. Revierte las facturas abonadas RECALCULANDO total_pagado desde
--    los pagos vigentes restantes (nunca resta a ciegas: correcto cuando hay
--    varios pagos sobre la misma factura) y deriva su estado.
-- -----------------------------------------------------------------------------

create or replace function anular_pago(
  p_cliente_id uuid,
  p_pago_id    uuid,
  p_motivo     text,
  p_perfil     uuid
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_pago            pagos%rowtype;
  v_facturas        jsonb := '[]'::jsonb;
  r                 record;
  v_pagado          numeric(12,2);
  v_total_factura   numeric(12,2);
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de anulación es obligatorio';
  end if;
  if p_perfil is null then
    raise exception 'Falta el perfil responsable de la anulación';
  end if;
  if not es_admin_de(p_cliente_id) then
    raise exception 'No autorizado';
  end if;

  -- FOR UPDATE aplica la política de UPDATE de pagos: un ajeno no lo ve
  select * into v_pago from pagos
   where id = p_pago_id and cliente_id = p_cliente_id
   for update;
  if v_pago.id is null then
    raise exception 'El pago % no existe o ya fue anulado', p_pago_id;
  end if;
  if v_pago.anulado then
    raise exception 'El pago % ya fue anulado', p_pago_id;
  end if;

  update pagos
     set anulado = true,
         motivo_anulacion = btrim(p_motivo)
   where id = p_pago_id;

  -- Reversión recalculada para cada factura abonada por este pago
  for r in
    select factura_id from pago_aplicaciones where pago_id = p_pago_id
  loop
    select coalesce(sum(a.valor), 0), max(f.total)
      into v_pagado, v_total_factura
      from pago_aplicaciones a
      join pagos p on p.id = a.pago_id
      join facturas f on f.id = a.factura_id
     where a.factura_id = r.factura_id
       and not p.anulado;

    -- total_pagado y estado se derivan de los pagos vigentes (nunca de restar a ciegas)
    update facturas
       set total_pagado = v_pagado,
           estado       = case when v_pagado >= total
                               then 'pagada'::estado_factura
                               else 'pendiente'::estado_factura end
     where id = r.factura_id;

    v_facturas := v_facturas || jsonb_build_object(
      'factura_id', r.factura_id,
      'total', v_total_factura,
      'total_pagado', v_pagado,
      'estado', case when v_pagado >= v_total_factura then 'pagada' else 'pendiente' end
    );
  end loop;

  return jsonb_build_object(
    'pago', jsonb_build_object(
      'id', v_pago.id,
      'valor', v_pago.valor,
      'anulado', true,
      'motivo_anulacion', btrim(p_motivo)
    ),
    'facturas', v_facturas
  );
end $$;

comment on function anular_pago is
  'Anula un pago vigente con motivo obligatorio y responsable. Las facturas '
  'abonadas se revierten RECALCULANDO total_pagado desde los pagos vigentes '
  'restantes y derivando su estado (pendiente si queda saldo, pagada si otros '
  'pagos la cubren). El pago anulado permanece visible en el historial.';

-- -----------------------------------------------------------------------------
-- 7. RLS FORCE + políticas (patrón 001-006): lectura para miembros del cliente
--    o plataforma; escritura solo admin_acueducto. El rol lector lee pagos de su
--    cliente pero NO escribe (CLAUDE.md §10 punto 24).
-- -----------------------------------------------------------------------------

alter table pagos enable row level security;
alter table pagos force row level security;
alter table pago_aplicaciones enable row level security;
alter table pago_aplicaciones force row level security;

create policy pagos_lectura on pagos for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy pagos_admin on pagos for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy pago_aplicaciones_lectura on pago_aplicaciones for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy pago_aplicaciones_admin on pago_aplicaciones for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

-- -----------------------------------------------------------------------------
-- 8. Ejecución de las RPC: solo authenticated (el Worker llama con el JWT del
--    admin; las RPC validan es_admin_de) — patrón de crear_tarifa_version/
--    reemplazar_contador. anon/public nunca.
-- -----------------------------------------------------------------------------

revoke execute on function registrar_pago(uuid, uuid, numeric, jsonb, uuid, date, metodo_pago, text, text) from anon, public;
grant  execute on function registrar_pago(uuid, uuid, numeric, jsonb, uuid, date, metodo_pago, text, text) to authenticated;

revoke execute on function anular_pago(uuid, uuid, text, uuid) from anon, public;
grant  execute on function anular_pago(uuid, uuid, text, uuid) to authenticated;

-- PostgREST (los roles autenticados del proyecto usan authenticated).
-- grant usage on schema public no hace falta: ya existe para authenticated.
