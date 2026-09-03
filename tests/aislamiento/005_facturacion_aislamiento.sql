-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de facturación (plan.md §8)
-- Referencia: specs/005-facturacion/plan.md y tasks.md T-002
-- Cubre CA-2: aislamiento multi-tenant de facturas/detalles/factura_lecturas,
-- permisos por rol (admin escribe/anula, lector solo lee), los unique
-- (uq_factura_ciclo y (cliente_id, numero)) y el trigger de inmutabilidad
-- (editar/borrar bloqueado; anulación con motivo).
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql,
-- lecturas.sql y facturacion.sql aplicados. Mismo mecanismo que 001-004:
-- cada escenario abre una transacción, simula el rol/sesión con
--   set local role <anon|authenticated>
--   set local request.jwt.claim.sub = '<uuid del perfil>'
-- ejecuta sus aserciones y hace rollback. Contra Supabase local real.
--
-- Debe terminar con 'FACTURACION-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/005_facturacion_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existen las 3 tablas, con RLS FORCE y el trigger de inmutabilidad
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from information_schema.tables
    where table_schema = 'public' and table_name in ('facturas','factura_detalles','factura_lecturas');
  if n <> 3 then raise exception 'PASO 1 FALLÓ: se encontraron % de las 3 tablas', n; end if;

  select count(*) into n from pg_class
    where relname in ('facturas','factura_detalles','factura_lecturas') and relforcerowsecurity;
  if n <> 3 then raise exception 'PASO 1 FALLÓ: % de las 3 tablas tienen FORCE RLS', n; end if;

  select count(*) into n from pg_trigger
    where tgname = 'trg_factura_inmutable' and not tgisinternal;
  if n <> 1 then raise exception 'PASO 1 FALLÓ: falta trg_factura_inmutable'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: admin de A ve su factura y no las de B; admin de B no ve las de A
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  select count(*) into n from facturas;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin A ve % facturas (esperaba 1)', n; end if;
  select count(*) into n from facturas where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin A ve facturas del cliente B'; end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
do $$
declare
  n integer;
begin
  select count(*) into n from facturas;
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin B ve % facturas de A (esperaba 0)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: admin de A NO puede insertar una factura del cliente B
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into facturas (cliente_id, usuario_servicio_id, periodo_id, tipo, numero,
                          snapshot_suscriptor, total, fecha_vencimiento)
    values ('b0000000-0000-0000-0000-000000000002',
            'd0000000-0000-0000-0000-0000000000b1',
            'e0000000-0000-0000-0000-0000000000b1',
            'ciclo', 'FAC-2026-00099', '{}', 0, current_date + 30);
    raise exception 'PASO 3 FALLÓ: admin A pudo insertar una factura del cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: el lector de A LEE la factura de A pero NO puede insertar ni anular
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
declare
  n integer;
begin
  -- lee (SELECT sobre facturas de su cliente)
  select count(*) into n from facturas;
  if n <> 1 then raise exception 'PASO 4 FALLÓ: lector A ve % facturas (esperaba 1)', n; end if;

  -- no puede insertar (RLS: INSERT con with check falla)
  begin
    insert into facturas (cliente_id, usuario_servicio_id, periodo_id, tipo, numero,
                          snapshot_suscriptor, total, fecha_vencimiento)
    values ('a0000000-0000-0000-0000-000000000001',
            'd0000000-0000-0000-0000-0000000000a1',
            'e0000000-0000-0000-0000-0000000000a1',
            'ciclo', 'FAC-2026-00098', '{}', 0, current_date + 30);
    raise exception 'PASO 4 FALLÓ: lector A pudo insertar una factura';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;

  -- no puede anular (UPDATE silencioso: la política solo deja a es_admin_de; el
  -- lector no la cumple → 0 filas afectadas)
  update facturas set estado = 'anulada', motivo_anulacion = 'intento lector'
    where id = 'ff000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PASO 4 FALLÓ: lector A anuló % factura', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: un segundo ciclo del mismo (suscriptor, periodo) viola uq_factura_ciclo
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into facturas (cliente_id, usuario_servicio_id, periodo_id, tipo, numero,
                          snapshot_suscriptor, total, fecha_vencimiento)
    values ('a0000000-0000-0000-0000-000000000001',
            'd0000000-0000-0000-0000-0000000000a1',
            'e0000000-0000-0000-0000-0000000000a1',
            'ciclo', 'FAC-2026-00002', '{}', 0, current_date + 30);
    raise exception 'PASO 5 FALLÓ: se aceptó un segundo ciclo para A1 en el periodo';
  exception when others then
    if sqlerrm not like '%uq_factura_ciclo%' and sqlerrm not like '%duplicate%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 6: un numero duplicado del cliente viola el unique (cliente_id, numero)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into facturas (cliente_id, usuario_servicio_id, periodo_id, tipo, numero,
                          snapshot_suscriptor, total, fecha_vencimiento)
    values ('a0000000-0000-0000-0000-000000000001',
            'd0000000-0000-0000-0000-0000000000a2',   -- otro suscriptor del mismo cliente
            null, 'ajuste', 'FAC-2026-00001', '{}', 0, current_date + 30);
    raise exception 'PASO 6 FALLÓ: se aceptó un numero duplicado del cliente';
  exception when others then
    if sqlerrm not like '%duplicate key%' and sqlerrm not like '%unique%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 7: la factura emitida es inmutable (editar valores, borrar y anular sin
-- motivo son rechazados por trg_factura_inmutable)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  -- editar el total (valores) → rechazado
  begin
    update facturas set total = 1 where id = 'ff000000-0000-0000-0000-0000000000a1';
    raise exception 'PASO 7 FALLÓ: se editó el total de una factura emitida';
  exception when others then
    if sqlerrm not like '%inmutable%' then raise; end if;
  end;

  -- borrar → rechazado
  begin
    delete from facturas where id = 'ff000000-0000-0000-0000-0000000000a1';
    raise exception 'PASO 7 FALLÓ: se borró una factura emitida';
  exception when others then
    if sqlerrm not like '%no se borra%' then raise; end if;
  end;

  -- anular sin motivo → rechazado
  begin
    update facturas set estado = 'anulada',
                        anulada_por = 'a0000000-0000-0000-0000-0000000000a1'
      where id = 'ff000000-0000-0000-0000-0000000000a1';
    raise exception 'PASO 7 FALLÓ: se anuló una factura sin motivo';
  exception when others then
    if sqlerrm not like '%motivo%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 8: admin de A SÍ puede anular una factura con motivo (la base registra
-- motivo y responsable)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  update facturas
     set estado = 'anulada',
         motivo_anulacion = 'error de emisión',
         anulada_por = 'a0000000-0000-0000-0000-0000000000a1'
   where id = 'ff000000-0000-0000-0000-0000000000a1';
  select count(*) into n from facturas
    where id = 'ff000000-0000-0000-0000-0000000000a1' and estado = 'anulada';
  if n <> 1 then raise exception 'PASO 8 FALLÓ: la anulación con motivo no se aplicó'; end if;
end $$;
rollback;

\echo 'FACTURACION-AISLAMIENTO OK'

