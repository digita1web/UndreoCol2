-- =============================================================================
-- UndreoCol — Test de aislamiento del portal del suscriptor (plan.md §8)
-- Referencia: specs/008-portal-suscriptor/plan.md y tasks.md T-002
-- Cubre CA-2/CA-9: las funciones SECURITY DEFINER del portal (D-10) devuelven
-- SOLO datos del suscriptor cuyas credenciales se pasan; nunca los de otro
-- suscriptor/cliente (IDOR → null); el bloqueo por fuerza bruta vigente rechaza
-- aunque la credencial sea correcta y el bloqueo vencido permite reintentar;
-- portal_consumo_suscriptor une el consumo de TODOS los contadores históricos
-- (CA-7) sin huecos.
--
-- Requiere tests/fixtures/fundacion.sql ... portal.sql aplicados (001-008).
-- A diferencia de 001-007, aquí NO se usa auth.uid(): el portal no tiene JWT de
-- Supabase Auth (D-2). Se invoca cada función con `set local role anon` (la
-- clave anon es pública en producción; D-10) y distintas combinaciones de
-- credenciales. Contra Supabase local real. Debe terminar con
-- 'PORTAL-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/008_portal_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existen las 5 funciones SECURITY DEFINER con grant a anon, las
-- columnas de configuracion, y la tabla portal_intentos_login con 2 filas
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from pg_proc where proname like 'portal\_%';
  if n <> 5 then raise exception 'PASO 1 FALLÓ: % funciones portal (esperaba 5)', n; end if;

  select count(*) into n from pg_proc p
    join pg_roles r on r.oid = p.proowner
   where p.proname like 'portal\_%' and p.prosecdef;
  if n <> 5 then raise exception 'PASO 1 FALLÓ: % de las funciones NO son SECURITY DEFINER', 5 - n; end if;

  select count(*) into n from information_schema.routine_privileges
   where routine_name like 'portal\_%' and grantee = 'anon';
  if n <> 5 then raise exception 'PASO 1 FALLÓ: anon no tiene EXECUTE en las 5 (tiene %)', n; end if;

  select count(*) into n from information_schema.columns
   where table_name = 'configuracion'
     and column_name in ('portal_umbral_intentos_login','portal_bloqueo_minutos');
  if n <> 2 then raise exception 'PASO 1 FALLÓ: faltan columnas de umbral en configuracion'; end if;

  select count(*) into n from portal_intentos_login;
  if n <> 2 then raise exception 'PASO 1 FALLÓ: % filas de portal_intentos_login (esperaba 2 del fixture)', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: datos del portal con credenciales de A1 → SOLO datos de A1
-- (login de A2: bloqueo del fixture ya venció → se permite y queda ok)
-- ---------------------------------------------------------------------------
begin;
set local role anon;
do $$
declare
  v_login   jsonb;
  v_json    jsonb;
  n         integer;
begin
  select portal_validar_credenciales('a0000000-0000-0000-0000-000000000001',
    '1000000002', 'A-002') into v_login;
  if v_login->>'estado' <> 'ok' then
    raise exception 'PASO 2 FALLÓ: login de A2 (bloqueo vencido) devolvió %', v_login->>'estado';
  end if;

  select portal_facturas_suscriptor('a0000000-0000-0000-0000-000000000001',
    '1000000001', 'A-001') into v_json;
  if v_json is null or v_json::text not like '%FAC-2026-00001%' then
    raise exception 'PASO 2 FALLÓ: portal_facturas de A1 no trae su factura';
  end if;
  if v_json::text like '%FAC-2026-00002%' then
    raise exception 'PASO 2 FALLÓ: portal_facturas de A1 trae una factura ajena';
  end if;

  select portal_saldo_favor_suscriptor('a0000000-0000-0000-0000-000000000001',
    '1000000001', 'A-001') into v_json;
  if v_json::numeric <> 2000 then
    raise exception 'PASO 2 FALLÓ: saldo a favor de A1 = % (esperaba 2000 del fixture 007)', v_json;
  end if;

  select portal_consumo_suscriptor('a0000000-0000-0000-0000-000000000001',
    '1000000001', 'A-001') into v_json;
  select jsonb_array_length(v_json) into n;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: consumo de A1 tiene % lecturas (esperaba 1)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: bloqueo VIGENTE de A1 → rechaza aunque la credencial sea correcta
-- ---------------------------------------------------------------------------
begin;
set local role anon;
do $$
declare
  v_login jsonb;
begin
  select portal_validar_credenciales('a0000000-0000-0000-0000-000000000001',
    '1000000001', 'A-001') into v_login;
  if v_login->>'estado' <> 'bloqueado' then
    raise exception 'PASO 3 FALLÓ: A1 bloqueado devolvió %', v_login->>'estado';
  end if;
  if v_login->>'reintentar_en' is null then
    raise exception 'PASO 3 FALLÓ: falta reintentar_en';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: credenciales de A1 con el cliente B → la función no devuelve nada
-- (cada función revalida las credenciales DENTRO del cliente_id recibido)
-- ---------------------------------------------------------------------------
begin;
set local role anon;
do $$
declare
  v_json jsonb;
begin
  select portal_facturas_suscriptor('b0000000-0000-0000-0000-000000000002',
    '1000000001', 'A-001') into v_json;
  if v_json::text not like '[]' then
    raise exception 'PASO 4 FALLÓ: credenciales A1 + cliente B devolvieron datos';
  end if;

  select portal_consumo_suscriptor('b0000000-0000-0000-0000-000000000002',
    '1000000001', 'A-001') into v_json;
  if v_json::text not like '[]' then
    raise exception 'PASO 4 FALLÓ: consumo A1 + cliente B devolvió datos';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: A1 pide portal_factura_completa de una factura de A2 o de B1 → null
-- (IDOR: el Worker respondería 404; su propia factura sí se devuelve)
-- ---------------------------------------------------------------------------
begin;
insert into facturas (id, cliente_id, usuario_servicio_id, tipo, numero, snapshot_suscriptor,
                      subtotal_servicios, recargo_mora, saldo_anterior, total, fecha_vencimiento)
values ('ff000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-0000000000a2', 'ajuste', 'FAC-2026-00003', '{}', 0, 0, 0, 1000,
        current_date + 30);
insert into facturas (id, cliente_id, usuario_servicio_id, tipo, numero, snapshot_suscriptor,
                      subtotal_servicios, recargo_mora, saldo_anterior, total, fecha_vencimiento)
values ('ff000000-0000-0000-0000-0000000000c2', 'b0000000-0000-0000-0000-000000000002',
        'd0000000-0000-0000-0000-0000000000b1', 'ajuste', 'FAC-2026-00004', '{}', 0, 0, 0, 2000,
        current_date + 30);
set local role anon;
do $$
declare
  v_json jsonb;
begin
  select portal_factura_completa('a0000000-0000-0000-0000-000000000001',
    '1000000001', 'A-001', 'ff000000-0000-0000-0000-0000000000c1') into v_json;
  if v_json is not null then
    raise exception 'PASO 5 FALLÓ: A1 obtuvo la factura de A2';
  end if;

  select portal_factura_completa('a0000000-0000-0000-0000-000000000001',
    '1000000001', 'A-001', 'ff000000-0000-0000-0000-0000000000c2') into v_json;
  if v_json is not null then
    raise exception 'PASO 5 FALLÓ: A1 obtuvo una factura del cliente B';
  end if;

  select portal_factura_completa('a0000000-0000-0000-0000-000000000001',
    '1000000001', 'A-001', 'ff000000-0000-0000-0000-0000000000a1') into v_json;
  if v_json is null or v_json->'factura'->>'numero' <> 'FAC-2026-00001' then
    raise exception 'PASO 5 FALLÓ: A1 no pudo ver su propia factura';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 6 (CA-7): portal_consumo une las lecturas de TODOS los contadores
-- históricos del suscriptor, en orden, sin huecos. El periodo histórico se crea
-- en esta transacción (cerrando temporalmente el periodo actual para respetar
-- uq_periodo_abierto) y todo se revierte al final: el estado que heredan los
-- aislamientos 003/004 no se ensucia.
-- ---------------------------------------------------------------------------
begin;
update periodos set estado = 'cerrado'
 where id = 'e0000000-0000-0000-0000-0000000000a1'; -- periodo actual de A: se restaura abajo
insert into contadores (id, cliente_id, usuario_servicio_id, serial, marca, capacidad_maxima,
                        lectura_inicial, fecha_instalacion, estado)
values ('c1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-0000000000a1', 'SERIAL-A1-V0', 'Marca V0', 99999, 0,
        '2025-01-01', 'reemplazado');
insert into periodos (id, cliente_id, nombre, anio, mes, fecha_inicio, fecha_fin,
                      fecha_vencimiento, estado)
values ('e0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
        'Diciembre 2025', 2025, 12, '2025-12-01', '2025-12-31', '2026-01-15', 'abierto');
insert into lecturas (id, cliente_id, contador_id, periodo_id, fecha_lectura, lectura_anterior,
                      lectura_actual, consumo_m3, hubo_rollover, revision, promedio_historico,
                      revisada, tomada_por)
values ('e1000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
        'c1000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000c1',
        '2025-12-31', 0, 40, 40, false, 'normal', null, false, 'a0000000-0000-0000-0000-0000000000a2');
update periodos set estado = 'cerrado', fecha_cierre = now()
 where id = 'e0000000-0000-0000-0000-0000000000c1';
update periodos set estado = 'abierto'
 where id = 'e0000000-0000-0000-0000-0000000000a1'; -- se restaura el periodo actual
set local role anon;
do $$
declare
  v_json jsonb;
  n      integer;
begin
  select portal_consumo_suscriptor('a0000000-0000-0000-0000-000000000001',
    '1000000001', 'A-001') into v_json;
  select jsonb_array_length(v_json) into n;
  -- 2 lecturas: la del contador viejo (2025-12-31) + la del contador actual (fixture 004)
  if n <> 2 then
    raise exception 'PASO 6 FALLÓ: consumo de A1 con 2 contadores tiene % lecturas (esperaba 2)', n;
  end if;
  if v_json->0->>'fecha_lectura' > v_json->1->>'fecha_lectura' then
    raise exception 'PASO 6 FALLÓ: las lecturas no están ordenadas por fecha';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- Cierre
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'PORTAL-AISLAMIENTO OK';
end $$;

