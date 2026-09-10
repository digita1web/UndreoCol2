-- Test de aislamiento de 028-rol-secretaria. Requiere fixtures 001-006.
\set ON_ERROR_STOP on

insert into perfiles (id, nombre, email)
values ('a0000000-0000-0000-0000-0000000000a3', 'Secretaria A', 'secretaria-a@test.local')
on conflict (id) do update set nombre = excluded.nombre, email = excluded.email;
delete from membresias where perfil_id = 'a0000000-0000-0000-0000-0000000000a3';
insert into membresias (perfil_id, cliente_id, rol)
values ('a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'secretaria')
;

-- PASO 1: secretaria A ve A, no B, y no es admin.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a3';
do $$
declare n integer;
begin
  if not es_staff_de('a0000000-0000-0000-0000-000000000001') then raise exception 'PASO 1 FALLÓ: no es staff'; end if;
  if es_admin_de('a0000000-0000-0000-0000-000000000001') then raise exception 'PASO 1 FALLÓ: es admin'; end if;
  select count(*) into n from facturas where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'PASO 1 FALLÓ: factura A (%)', n; end if;
  select count(*) into n from tarifas where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n = 0 then raise exception 'PASO 1 FALLÓ: tarifas A'; end if;
  select count(*) into n from facturas where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 1 FALLÓ: fuga B (%)', n; end if;
end $$;
rollback;

-- PASO 2: escritura administrativa e importación dentro de A.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a3';
do $$
declare n integer; v_id uuid;
begin
  update usuarios_servicio set telefono = '3000000099' where id = 'd0000000-0000-0000-0000-0000000000a1';
  if not found then raise exception 'PASO 2 FALLÓ: update A'; end if;
  insert into usuarios_servicio (cliente_id, codigo_suscriptor, nombre)
  values ('a0000000-0000-0000-0000-000000000001', 'A-028', 'Suscriptor 028') returning id into v_id;
  if v_id is null then raise exception 'PASO 2 FALLÓ: insert A'; end if;
  perform importar_suscriptores('a0000000-0000-0000-0000-000000000001',
    '[{"codigo_suscriptor":"A-029","nombre":"Importado 028","categoria":"estrato_3"}]'::jsonb,
    '[]'::jsonb, 'secretarias.xlsx', 'a0000000-0000-0000-0000-0000000000a3');
  select count(*) into n from usuarios_servicio
   where cliente_id = 'a0000000-0000-0000-0000-000000000001'
     and codigo_suscriptor in ('A-028','A-029');
  if n <> 2 then raise exception 'PASO 2 FALLÓ: altas (%)', n; end if;
  begin
    update usuarios_servicio set nombre = 'Fuga B' where id = 'd0000000-0000-0000-0000-0000000000b1';
    if found then raise exception 'PASO 2 FALLÓ: update B'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- PASO 3: reemplazo de contador de A funciona para staff.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a3';
do $$
declare v_id uuid;
begin
  v_id := reemplazar_contador('d0000000-0000-0000-0000-0000000000a1', 'SERIAL-028', null, 99999, 100, 0, 'Reemplazo 028');
  if v_id is null then raise exception 'PASO 3 FALLÓ: reemplazo'; end if;
end $$;
rollback;

-- PASO 4: secretaria registra pago completo, pero no anula pago ni factura.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a3';
do $$
declare r jsonb; n integer; v_pago uuid;
begin
  r := registrar_pago('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1', 1000,
    jsonb_build_array(jsonb_build_object('factura_id','ff000000-0000-0000-0000-0000000000a1','valor',1000)),
    'a0000000-0000-0000-0000-0000000000a3');
  v_pago := (r->'pago'->>'id')::uuid;
  select count(*) into n from pagos where id = v_pago;
  if n <> 1 then raise exception 'PASO 4 FALLÓ: pago'; end if;
  select count(*) into n from pago_aplicaciones where pago_id = v_pago;
  if n <> 1 then raise exception 'PASO 4 FALLÓ: aplicación'; end if;
  begin
    perform anular_pago('a0000000-0000-0000-0000-000000000001', v_pago, 'Intento', 'a0000000-0000-0000-0000-0000000000a3');
    raise exception 'PASO 4 FALLÓ: anuló pago';
  exception when others then
    if sqlerrm not like '%No autorizado%' then raise; end if;
  end;
  begin
    update facturas set estado = 'anulada', motivo_anulacion = 'Intento' where id = 'ff000000-0000-0000-0000-0000000000a1';
    raise exception 'PASO 4 FALLÓ: anuló factura';
  exception when others then
    if sqlerrm not like '%Solo el administrador del acueducto puede anular%' then raise; end if;
  end;
end $$;
rollback;

-- PASO 5: cortes, reconexiones y tarifas siguen restringidos a admin.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a3';
do $$
declare v_id uuid;
begin
  begin
    perform registrar_corte('d0000000-0000-0000-0000-0000000000a1', 'Intento', 'a0000000-0000-0000-0000-0000000000a3');
    raise exception 'PASO 5 FALLÓ: corte';
  exception when others then if sqlerrm not like '%No autorizado%' then raise; end if; end;
  begin
    perform reconectar('d0000000-0000-0000-0000-0000000000a1', 0, null, 'a0000000-0000-0000-0000-0000000000a3');
    raise exception 'PASO 5 FALLÓ: reconexión';
  exception when others then if sqlerrm not like '%No autorizado%' then raise; end if; end;
  begin
    v_id := crear_tarifa_version('f0000000-0000-0000-0000-0000000000a1', 'estrato_3', 5000, 22, 1300, 2600);
    raise exception 'PASO 5 FALLÓ: tarifa %', v_id;
  exception when others then if sqlerrm not like '%No autorizado%' then raise; end if; end;
end $$;
rollback;

-- PASO 6: admin A conserva la anulación y no ve B.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare n integer;
begin
  select count(*) into n from facturas where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 6 FALLÓ: admin A ve B'; end if;
  update facturas set estado = 'anulada', motivo_anulacion = 'Regresión' where id = 'ff000000-0000-0000-0000-0000000000a1';
end $$;
rollback;

delete from membresias where perfil_id = 'a0000000-0000-0000-0000-0000000000a3';
delete from perfiles where id = 'a0000000-0000-0000-0000-0000000000a3';
\echo 'ROL-SECRETARIA-AISLAMIENTO OK'