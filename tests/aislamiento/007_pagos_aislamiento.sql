-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de pagos (plan.md §8)
-- Referencia: specs/007-pagos-y-cartera/plan.md y tasks.md T-002
-- Cubre CA-2: aislamiento multi-tenant de pagos/pago_aplicaciones, permisos por
-- rol (admin registra/anula, lector solo lee), las RPC registrar_pago/anular_pago
-- y las reglas de integridad del trigger (aplicar a factura de otro suscriptor,
-- anulada, más del saldo/valor; anular sin motivo).
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql,
-- lecturas.sql, facturacion.sql, correo-factura.sql y pagos.sql aplicados.
-- Mismo mecanismo que 001-006: cada escenario abre una transacción, simula el
-- rol/sesión con
--   set local role <anon|authenticated>
--   set local request.jwt.claim.sub = '<uuid del perfil>'
-- ejecuta sus aserciones y hace rollback. Contra Supabase local real.
--
-- Debe terminar con 'PAGOS-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/007_pagos_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existen las 2 tablas con FORCE RLS, el enum, el trigger y las RPC
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from information_schema.tables
    where table_schema = 'public' and table_name in ('pagos','pago_aplicaciones');
  if n <> 2 then raise exception 'PASO 1 FALLÓ: se encontraron % de las 2 tablas', n; end if;

  select count(*) into n from pg_class
    where relname in ('pagos','pago_aplicaciones') and relforcerowsecurity;
  if n <> 2 then raise exception 'PASO 1 FALLÓ: % de las 2 tablas tienen FORCE RLS', n; end if;

  select count(*) into n from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'metodo_pago';
  if n < 5 then raise exception 'PASO 1 FALLÓ: enum metodo_pago incompleto (%)', n; end if;

  select count(*) into n from pg_trigger
    where tgname = 'trg_pago_aplicacion_valida' and not tgisinternal;
  if n <> 1 then raise exception 'PASO 1 FALLÓ: falta trg_pago_aplicacion_valida'; end if;

  select count(*) into n from pg_proc where proname in ('registrar_pago','anular_pago');
  if n <> 2 then raise exception 'PASO 1 FALLÓ: faltan las RPC (%)', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: el admin de A ve SUS pagos y no los de B; el admin de B no ve los de A
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  -- Por existencia de los 2 IDs originales del fixture, no por conteo total:
  -- fixtures posteriores (011-dashboard) agregan más pagos a A a propósito,
  -- y un conteo fijo se vuelve frágil sin que la RLS esté rota.
  select count(*) into n from pagos
    where id in ('d1000000-0000-0000-0000-0000000000a1', 'd1000000-0000-0000-0000-0000000000a2');
  if n <> 2 then raise exception 'PASO 2 FALLÓ: admin A no ve sus 2 pagos originales (ve %)', n; end if;
  select count(*) into n from pagos where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin A ve pagos del cliente B'; end if;
  select count(*) into n from pago_aplicaciones;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin A ve % aplicaciones (esperaba 1)', n; end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
do $$
declare
  n integer;
begin
  -- Scoped a los pagos DE A (no al total que B ve): 011-dashboard le agrega a
  -- B su propio pago legítimo, así que un conteo total ya no prueba nada.
  select count(*) into n from pagos where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin B ve % pagos de A (esperaba 0)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: el admin de A NO puede insertar un pago del cliente B (RLS)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into pagos (cliente_id, usuario_servicio_id, valor)
    values ('b0000000-0000-0000-0000-000000000002',
            'd0000000-0000-0000-0000-0000000000b1', 5000);
    raise exception 'PASO 3 FALLÓ: admin A insertó un pago del cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: el lector de A VE los pagos de su cliente pero NO escribe
-- (ni INSERT directo ni la RPC registrar_pago)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
declare
  n integer;
begin
  -- Por existencia de los 2 IDs originales, no por conteo total (011-dashboard
  -- agrega más pagos a A a propósito).
  select count(*) into n from pagos
    where id in ('d1000000-0000-0000-0000-0000000000a1', 'd1000000-0000-0000-0000-0000000000a2');
  if n <> 2 then raise exception 'PASO 4 FALLÓ: el lector A no ve sus 2 pagos originales (ve %)', n; end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
begin
  begin
    insert into pagos (cliente_id, usuario_servicio_id, valor)
    values ('a0000000-0000-0000-0000-000000000001',
            'd0000000-0000-0000-0000-0000000000a1', 5000);
    raise exception 'PASO 4 FALLÓ: el lector insertó un pago';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
begin
  begin
    perform registrar_pago('a0000000-0000-0000-0000-000000000001',
      'd0000000-0000-0000-0000-0000000000a1', 5000,
      '[{"factura_id":"ff000000-0000-0000-0000-0000000000a1","valor":5000}]',
      'a0000000-0000-0000-0000-0000000000a2');
    raise exception 'PASO 4 FALLÓ: el lector usó registrar_pago';
  exception when others then
    -- rechazo esperado (no ve el suscriptor para FOR UPDATE, o No autorizado)
    null;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: la RPC del admin de A rechaza aplicar a una factura del cliente B
-- (creada aquí como postgres para el escenario; RLS la oculta al admin A)
-- ---------------------------------------------------------------------------
begin;
insert into facturas (id, cliente_id, usuario_servicio_id, tipo, numero,
                      snapshot_suscriptor, total, fecha_vencimiento)
values ('fb000000-0000-0000-0000-0000000000b1',
        'b0000000-0000-0000-0000-000000000002',
        'd0000000-0000-0000-0000-0000000000b1',
        'ajuste', 'FAC-2026-00099', '{}', 5000, current_date + 30);
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    perform registrar_pago('a0000000-0000-0000-0000-000000000001',
      'd0000000-0000-0000-0000-0000000000a1', 5000,
      '[{"factura_id":"fb000000-0000-0000-0000-0000000000b1","valor":5000}]',
      'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 5 FALLÓ: admin A aplicó un pago a una factura del cliente B';
  exception when others then
    null;  -- rechazo esperado (la RPC no ve la factura ajena)
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 6: el admin de A anula el pago del fixture SIN motivo (rechazo) y CON
-- motivo (revierte ff000000 a total_pagado 0 / pendiente)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    perform anular_pago('a0000000-0000-0000-0000-000000000001',
      'd1000000-0000-0000-0000-0000000000a1', '', 'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 6 FALLÓ: anuló un pago sin motivo';
  exception when others then
    null;
  end;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  v_pagado numeric(12,2);
  v_estado text;
begin
  perform anular_pago('a0000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-0000000000a1', 'Error de caja (aislamiento)',
    'a0000000-0000-0000-0000-0000000000a1');
  select total_pagado, estado::text into v_pagado, v_estado
    from facturas where id = 'ff000000-0000-0000-0000-0000000000a1';
  if v_pagado <> 0 or v_estado <> 'pendiente' then
    raise exception 'PASO 6 FALLÓ: tras anular, factura en % con % pagado', v_estado, v_pagado;
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 7: no se puede registrar un pago contra una factura anulada (RPC)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  update facturas set estado = 'anulada',
                      motivo_anulacion = 'Anulada para el aislamiento 007',
                      anulada_por = 'a0000000-0000-0000-0000-0000000000a1'
   where id = 'ff000000-0000-0000-0000-0000000000a1';
  begin
    perform registrar_pago('a0000000-0000-0000-0000-000000000001',
      'd0000000-0000-0000-0000-0000000000a1', 1000,
      '[{"factura_id":"ff000000-0000-0000-0000-0000000000a1","valor":1000}]',
      'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 7 FALLÓ: registró un pago contra una factura anulada';
  exception when others then
    null;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Cierre
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'PAGOS-AISLAMIENTO OK';
end $$;
