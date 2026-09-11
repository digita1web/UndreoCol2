-- Test real de autorización temporal y de un solo uso para tarifas (029).
\set ON_ERROR_STOP on

insert into perfiles (id, nombre, email)
values ('a0000000-0000-0000-0000-0000000000a3', 'Secretaria A', 'secretaria-029@test.local')
on conflict (id) do update set nombre = excluded.nombre, email = excluded.email;
delete from membresias where perfil_id = 'a0000000-0000-0000-0000-0000000000a3';
insert into membresias (perfil_id, cliente_id, rol)
values ('a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'secretaria');

-- Admin A crea autorización; secretaria la consume una sola vez.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare v_id uuid;
begin
  v_id := crear_autorizacion_tarifa(
    'f0000000-0000-0000-0000-0000000000a1', 'estrato_3',
    'Ajuste tarifario autorizado 029', now() + interval '2 days');
  if v_id is null then raise exception 'PASO 1 FALLÓ: no creó autorización'; end if;
end $$;
commit;


begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a3';
do $$
declare v_id uuid; v_tarifa uuid; n integer;
begin
  select id into v_id from autorizaciones_tarifa
   where cliente_id = 'a0000000-0000-0000-0000-000000000001'
     and usada_en is null and revocada_en is null;
  if v_id is null then raise exception 'PASO 2 FALLÓ: secretaria no ve autorización'; end if;
  v_tarifa := usar_autorizacion_tarifa(v_id, 5100, 22, 1250, 2500);
  if v_tarifa is null then raise exception 'PASO 2 FALLÓ: no aplicó tarifa'; end if;
  select count(*) into n from auditoria_tarifas_autorizadas where autorizacion_id = v_id;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: falta bitácora'; end if;
  begin
    perform usar_autorizacion_tarifa(v_id, 5200, 22, 1300, 2600);
    raise exception 'PASO 2 FALLÓ: autorización reutilizada';
  exception when others then
    if sqlerrm not like '%ya fue usada%' then raise; end if;
  end;
end $$;
commit;

-- Secretaria sin autorización no puede usar el RPC directo de tarifas.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a3';
do $$
begin
  begin
    perform crear_tarifa_version('f0000000-0000-0000-0000-0000000000a1', 'estrato_3', 1, 1, 1, 1);
    raise exception 'PASO 3 FALLÓ: secretaria usó RPC directa';
  exception when others then
    if sqlerrm not like '%No autorizado%' then raise; end if;
  end;
end $$;
rollback;

-- No se permiten autorizaciones abiertas solapadas; revocación funciona.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare v_id uuid;
begin
  v_id := crear_autorizacion_tarifa('f0000000-0000-0000-0000-0000000000a1', 'estrato_3', 'Primera', now() + interval '1 day');
  begin
    perform crear_autorizacion_tarifa('f0000000-0000-0000-0000-0000000000a1', 'estrato_3', 'Duplicada', now() + interval '1 day');
    raise exception 'PASO 4 FALLÓ: permitió autorización solapada';
  exception when others then
    if sqlerrm not like '%Ya existe%' then raise; end if;
  end;
  perform revocar_autorizacion_tarifa(v_id);
end $$;
rollback;

-- Bitácora append-only para authenticated.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    delete from auditoria_tarifas_autorizadas;
    raise exception 'PASO 5 FALLÓ: borró bitácora';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

delete from membresias where perfil_id = 'a0000000-0000-0000-0000-0000000000a3';
delete from auditoria_tarifas_autorizadas;
delete from autorizaciones_tarifa;
delete from perfiles where id = 'a0000000-0000-0000-0000-0000000000a3';
\echo 'AUTORIZACION-TARIFAS-AISLAMIENTO OK'