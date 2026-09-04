-- =============================================================================
-- UndreoCol — Migración 008: Portal del suscriptor
-- Referencia: specs/008-portal-suscriptor/plan.md (aprobado 2026-09-03) y spec.md
--
-- Depende de 001 (clientes.slug, configuracion, es_admin_plataforma()), 003
-- (usuarios_servicio.numero_documento/codigo_suscriptor/estado), 004
-- (contadores, lecturas), 005 (facturas, factura_detalles), 007 (pagos,
-- pago_aplicaciones — misma fórmula de saldo a favor que lib/pagos.ts).
--
-- D-10 (docs/DECISIONES.md): el suscriptor del portal NO tiene auth.uid()
-- (D-2) — no hay JWT de Supabase Auth sobre el que apoyar RLS. El portal
-- NUNCA usa SUPABASE_SERVICE_ROLE_KEY (CLAUDE.md §5.4/§12, sin excepción): en
-- su lugar, esta migración crea funciones SECURITY DEFINER acotadas (mismo
-- mecanismo que ya usan es_admin_de()/tarifa_vigente(), aquí invocado
-- directamente por el Worker con la clave anon en vez de como predicado de
-- una política). Cada función recibe numero_documento + codigo_suscriptor
-- REALES y los revalida internamente contra usuarios_servicio — nunca confía
-- en un usuario_servicio_id desnudo como única prueba de identidad, porque la
-- clave anon es pública y cualquiera podría invocarlas directamente.
--
-- Alcance: columnas de configuracion para el umbral de fuerza bruta (CA-9,
-- mismo patrón que porcentaje_mora/dias_umbral_corte); tabla
-- portal_intentos_login; funciones portal_validar_credenciales (login+CA-9),
-- portal_facturas_suscriptor (CA-4), portal_factura_completa (CA-5, para el
-- PDF de 006), portal_saldo_favor_suscriptor (CA-6), portal_consumo_suscriptor
-- (CA-7). "Regenerar código" (CA-8) NO necesita nada de esta migración: la RLS
-- de usuarios_servicio ya permite ese UPDATE al admin_acueducto (003 solo lo
-- bloqueaba a nivel de aplicación) — se resuelve en 008 con una ruta propia
-- sobre el cliente ya autenticado del admin, sin función nueva.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Umbral de fuerza bruta configurable por acueducto (CA-9)
-- -----------------------------------------------------------------------------

alter table configuracion
  add column portal_umbral_intentos_login smallint not null default 8,
  add column portal_bloqueo_minutos       integer  not null default 15;

comment on column configuracion.portal_umbral_intentos_login is
  'Intentos fallidos consecutivos de login del portal (por numero_documento) '
  'antes de bloquear temporalmente. Mismo patrón que porcentaje_mora: ajustable '
  'por acueducto, no un valor global fijo.';
comment on column configuracion.portal_bloqueo_minutos is
  'Minutos de bloqueo tras alcanzar portal_umbral_intentos_login.';

-- -----------------------------------------------------------------------------
-- 2. Contador de intentos fallidos de login del portal
-- -----------------------------------------------------------------------------

create table portal_intentos_login (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references clientes(id) on delete cascade,
  numero_documento text not null,
  intentos         smallint not null default 0,
  bloqueado_hasta  timestamptz,
  ultimo_intento   timestamptz not null default now(),
  unique (cliente_id, numero_documento)
);

alter table portal_intentos_login enable row level security;
alter table portal_intentos_login force row level security;

-- Sin política de insert/update para ningún rol: la escribe únicamente
-- portal_validar_credenciales (security definer, corre como su dueño, que
-- tiene BYPASSRLS — mismo mecanismo que ya usan tarifa_vigente()/es_admin_de()
-- sobre tablas con FORCE RLS). Solo la plataforma puede *leerla* (soporte).
create policy portal_intentos_login_plataforma on portal_intentos_login for select
  using (es_admin_plataforma());

comment on table portal_intentos_login is
  'Contador de intentos fallidos de login del portal por (cliente_id, '
  'numero_documento), CA-9. Solo la escribe portal_validar_credenciales.';

-- -----------------------------------------------------------------------------
-- 3. portal_validar_credenciales — login (CA-1) + mitigación de fuerza bruta (CA-9)
-- -----------------------------------------------------------------------------

create or replace function portal_validar_credenciales(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_umbral  smallint;
  v_minutos integer;
  v_intento portal_intentos_login%rowtype;
  v_usuario usuarios_servicio%rowtype;
begin
  select portal_umbral_intentos_login, portal_bloqueo_minutos
    into v_umbral, v_minutos
    from configuracion where cliente_id = p_cliente_id;
  if v_umbral is null then
    v_umbral := 8;
    v_minutos := 15;
  end if;

  select * into v_intento from portal_intentos_login
   where cliente_id = p_cliente_id and numero_documento = p_numero_documento
   for update;

  if v_intento.bloqueado_hasta is not null and v_intento.bloqueado_hasta > now() then
    return jsonb_build_object('estado', 'bloqueado', 'reintentar_en', v_intento.bloqueado_hasta);
  end if;

  select * into v_usuario from usuarios_servicio
   where cliente_id = p_cliente_id
     and numero_documento = p_numero_documento
     and codigo_suscriptor = p_codigo_suscriptor;

  if v_usuario.id is null then
    -- Credenciales incorrectas: sube el contador (nunca revela cuál campo falló).
    if v_intento.id is null then
      insert into portal_intentos_login (cliente_id, numero_documento, intentos, ultimo_intento)
      values (p_cliente_id, p_numero_documento, 1, now());
    else
      update portal_intentos_login
         set intentos = intentos + 1,
             ultimo_intento = now(),
             bloqueado_hasta = case when intentos + 1 >= v_umbral
                                     then now() + (v_minutos * interval '1 minute')
                                     else bloqueado_hasta end
       where id = v_intento.id;
    end if;
    return jsonb_build_object('estado', 'invalido');
  end if;

  -- Credenciales correctas: reinicia el contador (aunque el estado sea inactivo).
  if v_intento.id is not null then
    update portal_intentos_login
       set intentos = 0, bloqueado_hasta = null, ultimo_intento = now()
     where id = v_intento.id;
  end if;

  if v_usuario.estado = 'inactivo' then
    return jsonb_build_object('estado', 'inactivo');
  end if;

  return jsonb_build_object('estado', 'ok', 'usuario_servicio_id', v_usuario.id);
end $$;

comment on function portal_validar_credenciales is
  'Login del portal (D-2/D-10): valida numero_documento+codigo_suscriptor '
  'dentro del cliente_id ya resuelto por el slug. Nunca revela cuál campo '
  'falló. Aplica el umbral de fuerza bruta de configuracion (CA-9). Devuelve '
  '{estado: ok|invalido|inactivo|bloqueado, ...}.';

-- -----------------------------------------------------------------------------
-- 4. portal_facturas_suscriptor — factura actual + historial (CA-4)
-- -----------------------------------------------------------------------------

create or replace function portal_facturas_suscriptor(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', f.id, 'numero', f.numero, 'tipo', f.tipo, 'total', f.total,
        'total_pagado', f.total_pagado, 'fecha_emision', f.fecha_emision,
        'fecha_vencimiento', f.fecha_vencimiento, 'estado', f.estado
      ) order by f.fecha_emision desc
    ),
    '[]'::jsonb
  )
  from facturas f
  where f.cliente_id = p_cliente_id
    and f.usuario_servicio_id = (
      select u.id from usuarios_servicio u
       where u.cliente_id = p_cliente_id
         and u.numero_documento = p_numero_documento
         and u.codigo_suscriptor = p_codigo_suscriptor
         and u.estado <> 'inactivo'
    );
$$;

comment on function portal_facturas_suscriptor is
  'Todas las facturas del suscriptor (cualquier tipo, incluidas anuladas), más '
  'reciente primero. El Worker toma la primera no anulada como "factura '
  'actual" (CA-4) y deriva vencida por fecha igual que la cartera de 007.';

-- -----------------------------------------------------------------------------
-- 5. portal_factura_completa — factura + detalles + acueducto para el PDF (CA-5)
-- -----------------------------------------------------------------------------

create or replace function portal_factura_completa(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text,
  p_factura_id        uuid
) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'factura', jsonb_build_object(
      'id', f.id, 'cliente_id', f.cliente_id, 'usuario_servicio_id', f.usuario_servicio_id,
      'periodo_id', f.periodo_id, 'tipo', f.tipo, 'numero', f.numero,
      'snapshot_suscriptor', f.snapshot_suscriptor, 'consumo_m3', f.consumo_m3,
      'subtotal_servicios', f.subtotal_servicios, 'recargo_mora', f.recargo_mora,
      'saldo_anterior', f.saldo_anterior, 'total', f.total, 'total_pagado', f.total_pagado,
      'fecha_emision', f.fecha_emision, 'fecha_vencimiento', f.fecha_vencimiento,
      'estado', f.estado, 'motivo_anulacion', f.motivo_anulacion, 'anulada_por', f.anulada_por
    ),
    'detalles', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', d.id, 'factura_id', d.factura_id, 'servicio_id', d.servicio_id,
            'tarifa_id', d.tarifa_id, 'orden', d.orden, 'descripcion', d.descripcion,
            'tipo_calculo', d.tipo_calculo, 'consumo_m3', d.consumo_m3, 'cargo_fijo', d.cargo_fijo,
            'consumo_basico_m3', d.consumo_basico_m3, 'valor_basico', d.valor_basico,
            'consumo_no_basico_m3', d.consumo_no_basico_m3, 'valor_no_basico', d.valor_no_basico,
            'subtotal', d.subtotal
          ) order by d.orden
        ),
        '[]'::jsonb
      )
      from factura_detalles d where d.factura_id = f.id
    ),
    'acueducto', (
      select jsonb_build_object(
        'nombre', c.nombre, 'nit', c.nit, 'direccion', c.direccion,
        'telefono', c.telefono, 'municipio', c.municipio, 'logo_url', c.logo_url
      )
      from clientes c where c.id = f.cliente_id
    )
  )
  from facturas f
  where f.id = p_factura_id
    and f.cliente_id = p_cliente_id
    and f.usuario_servicio_id = (
      select u.id from usuarios_servicio u
       where u.cliente_id = p_cliente_id
         and u.numero_documento = p_numero_documento
         and u.codigo_suscriptor = p_codigo_suscriptor
         and u.estado <> 'inactivo'
    );
$$;

comment on function portal_factura_completa is
  'Factura + detalles + datos del acueducto para generarPdfFactura (006), '
  'SOLO si la factura es del suscriptor autenticado. NULL si no existe o es de '
  'otro suscriptor/cliente — el Worker responde 404, nunca sirve el PDF (CA-5).';

-- -----------------------------------------------------------------------------
-- 6. portal_saldo_favor_suscriptor — mismo cálculo que lib/pagos.ts (007) (CA-6)
-- -----------------------------------------------------------------------------

create or replace function portal_saldo_favor_suscriptor(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.valor - coalesce(a.aplicado, 0)), 0)
  from pagos p
  left join (
    select pago_id, sum(valor) as aplicado
    from pago_aplicaciones
    group by pago_id
  ) a on a.pago_id = p.id
  where p.cliente_id = p_cliente_id
    and not p.anulado
    and p.usuario_servicio_id = (
      select u.id from usuarios_servicio u
       where u.cliente_id = p_cliente_id
         and u.numero_documento = p_numero_documento
         and u.codigo_suscriptor = p_codigo_suscriptor
         and u.estado <> 'inactivo'
    );
$$;

comment on function portal_saldo_favor_suscriptor is
  'Remanente de pagos vigentes sin aplicar (regla 14) — misma fórmula que '
  'obtenerPagosDeSuscriptor de lib/pagos.ts (007); debe coincidir exactamente.';

-- -----------------------------------------------------------------------------
-- 7. portal_consumo_suscriptor — TODOS los contadores históricos (CA-7)
-- -----------------------------------------------------------------------------

create or replace function portal_consumo_suscriptor(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'fecha_lectura', l.fecha_lectura,
        'lectura_anterior', l.lectura_anterior,
        'lectura_actual', l.lectura_actual,
        'consumo_m3', l.consumo_m3
      ) order by l.fecha_lectura
    ),
    '[]'::jsonb
  )
  from lecturas l
  join contadores c on c.id = l.contador_id
  where c.cliente_id = p_cliente_id
    and c.usuario_servicio_id = (
      select u.id from usuarios_servicio u
       where u.cliente_id = p_cliente_id
         and u.numero_documento = p_numero_documento
         and u.codigo_suscriptor = p_codigo_suscriptor
         and u.estado <> 'inactivo'
    );
$$;

comment on function portal_consumo_suscriptor is
  'Lecturas de TODOS los contadores históricos del suscriptor (join por '
  'contadores.usuario_servicio_id, no solo contador_actual_id) — un reemplazo '
  'de contador no corta el historial visualmente (CA-7).';

-- -----------------------------------------------------------------------------
-- 8. Grants — D-10: el Worker llama estas 5 funciones con la clave anon.
--    revoke primero (por defecto Postgres da EXECUTE a PUBLIC en funciones nuevas).
-- -----------------------------------------------------------------------------

revoke all on function portal_validar_credenciales(uuid, text, text) from public;
grant  execute on function portal_validar_credenciales(uuid, text, text) to anon;

revoke all on function portal_facturas_suscriptor(uuid, text, text) from public;
grant  execute on function portal_facturas_suscriptor(uuid, text, text) to anon;

revoke all on function portal_factura_completa(uuid, text, text, uuid) from public;
grant  execute on function portal_factura_completa(uuid, text, text, uuid) to anon;

revoke all on function portal_saldo_favor_suscriptor(uuid, text, text) from public;
grant  execute on function portal_saldo_favor_suscriptor(uuid, text, text) to anon;

revoke all on function portal_consumo_suscriptor(uuid, text, text) from public;
grant  execute on function portal_consumo_suscriptor(uuid, text, text) to anon;
