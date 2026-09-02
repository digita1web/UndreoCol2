-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de periodos y lecturas (plan.md §8)
-- Referencia: specs/004-lecturas-y-consumo/plan.md y tasks.md T-002
-- Cubre CA-2 (aislamiento multi-tenant de periodos/lecturas) y CA-5 (bloqueos
-- de integridad: un solo periodo abierto por cliente; insert en periodo cerrado
-- rechazado por el trigger; unique (contador_id, periodo_id); unique
-- id_cliente_offline; el lector inserta/lee lecturas pero no gestiona periodos).
--
-- Requiere tests/fixtures/fundacion.sql, tests/fixtures/catalogo.sql,
-- tests/fixtures/suscriptores.sql y tests/fixtures/lecturas.sql aplicados.
-- Mismo mecanismo que 001/002/003: cada escenario abre una transacción,
-- simula el rol y la sesión con
--   set local role <anon|authenticated>
--   set local request.jwt.claim.sub = '<uuid del perfil>'
-- ejecuta sus aserciones y hace rollback.
--
-- En este contenedor corre contra Supabase local real (auth.uid() nativo,
-- roles de Supabase). Debe terminar con 'LECTURAS-CONSUMO-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/004_lecturas_consumo_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existen periodos/lecturas, con RLS FORCE y el trigger de periodo
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from information_schema.tables
    where table_schema = 'public' and table_name in ('periodos','lecturas');
  if n <> 2 then
    raise exception 'PASO 1 FALLÓ: se encontraron % de las 2 tablas nuevas', n;
  end if;
  select count(*) into n from pg_class
    where relname in ('periodos','lecturas') and relforcerowsecurity;
  if n <> 2 then
    raise exception 'PASO 1 FALLÓ: % de las 2 tablas tienen FORCE ROW LEVEL SECURITY', n;
  end if;
  select count(*) into n from pg_trigger
    where tgname = 'trg_lectura_periodo_cerrado' and not tgisinternal;
  if n <> 1 then
    raise exception 'PASO 1 FALLÓ: falta el trigger trg_lectura_periodo_cerrado';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: admin de A ve SOLO sus periodos/lecturas (no los de B)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  select count(*) into n from periodos;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin A ve % periodos (esperaba 1)', n; end if;
  select count(*) into n from periodos where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin A ve periodos del cliente B'; end if;
  select count(*) into n from lecturas;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin A ve % lecturas (esperaba 1)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: admin de A NO puede insertar una lectura del cliente B
-- (contador_id y periodo_id de B adivinados directamente)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into lecturas (cliente_id, contador_id, periodo_id, fecha_lectura,
                          lectura_anterior, lectura_actual, consumo_m3)
    values ('b0000000-0000-0000-0000-000000000002',
            'c0000000-0000-0000-0000-0000000000b1',
            'e0000000-0000-0000-0000-0000000000b1',
            current_date, 0, 30, 30);
    raise exception 'PASO 3 FALLÓ: admin A pudo insertar una lectura del cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
  -- idem: insertar un periodo del cliente B
  begin
    insert into periodos (cliente_id, nombre, anio, mes, fecha_inicio, fecha_fin,
                          fecha_vencimiento, estado)
    values ('b0000000-0000-0000-0000-000000000002', 'Intrusión B',
            extract(year from current_date)::smallint, 1, current_date,
            current_date, current_date, 'abierto');
    raise exception 'PASO 3 FALLÓ: admin A pudo crear un periodo del cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: solo un periodo ABIERTO por cliente (uq_periodo_abierto)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into periodos (cliente_id, nombre, anio, mes, fecha_inicio, fecha_fin,
                          fecha_vencimiento, estado)
    values ('a0000000-0000-0000-0000-000000000001', 'Segundo abierto',
            (extract(year from current_date) + 1)::smallint, 1, current_date,
            current_date, current_date, 'abierto');
    raise exception 'PASO 4 FALLÓ: se creó un segundo periodo abierto para el cliente A';
  exception when others then
    if sqlerrm not like '%uq_periodo_abierto%' and sqlerrm not like '%unique%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: el lector de B inserta la primera lectura de SU cliente (periodo B
-- abierto y sin lecturas del fixture); y NO puede crear/cerrar un periodo.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b2';
do $$
declare
  n integer;
begin
  -- el lector ve el periodo de su cliente y ninguna lectura de B todavía
  select count(*) into n from periodos where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'PASO 5 FALLÓ: lector B no ve su periodo abierto'; end if;
  select count(*) into n from lecturas where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 5 FALLÓ: lector B ya veía lecturas de B (esperaba 0)'; end if;

  -- el lector puede INSERTAR la primera lectura de su cliente (política lecturas_inserta)
  insert into lecturas (cliente_id, contador_id, periodo_id, fecha_lectura,
                        lectura_anterior, lectura_actual, consumo_m3, hubo_rollover,
                        revision, promedio_historico, tomada_por)
  values ('b0000000-0000-0000-0000-000000000002',
          'c0000000-0000-0000-0000-0000000000b1',
          'e0000000-0000-0000-0000-0000000000b1',
          current_date, 0, 40, 40, false, 'normal', null,
          'b0000000-0000-0000-0000-0000000000b2');
  select count(*) into n from lecturas where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'PASO 5 FALLÓ: el lector B no pudo insertar su lectura'; end if;

  -- NO puede crear un periodo (solo admin_acueducto gestiona periodos)
  begin
    insert into periodos (cliente_id, nombre, anio, mes, fecha_inicio, fecha_fin,
                          fecha_vencimiento, estado)
    values ('b0000000-0000-0000-0000-000000000002', 'Lector crea periodo',
            (extract(year from current_date) + 1)::smallint, 1, current_date,
            current_date, current_date, 'abierto');
    raise exception 'PASO 5 FALLÓ: lector B pudo crear un periodo';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 6: el lector NO puede marcar una lectura como revisada (solo admin).
-- Como admin SÍ puede (luego se revierte con el rollback).
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
declare
  n integer;
begin
  -- RLS es SILENCIOSO para UPDATE/DELETE: la política lecturas_admin usa
  -- `using (es_admin_de(cliente_id))`, que filtra filas al lector (que no es
  -- admin), así que el UPDATE afecta 0 filas sin lanzar error. (Hallazgo real
  -- verificado: el patrón RLS de Postgres no dispara excepción en UPDATE.)
  update lecturas set revisada = true, revisada_por = 'a0000000-0000-0000-0000-0000000000a2'
    where id = 'e1000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'PASO 6 FALLÓ: el lector A marcó % lectura como revisada (esperaba 0)', n;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  update lecturas set revisada = true, revisada_por = 'a0000000-0000-0000-0000-0000000000a1'
    where id = 'e1000000-0000-0000-0000-0000000000a1';
  select count(*) into n from lecturas where id = 'e1000000-0000-0000-0000-0000000000a1' and revisada;
  if n <> 1 then raise exception 'PASO 6 FALLÓ: el admin A no pudo marcar la lectura como revisada'; end if;
end $$;
rollback;


-- ---------------------------------------------------------------------------
-- PASO 7: una lectura en un periodo CERRADO es rechazada (trigger)
-- El admin B cierra su periodo y, ya cerrado, cualquier insert de lectura
-- falla con el mensaje del trigger.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
do $$
begin
  update periodos set estado = 'cerrado', fecha_cierre = now(),
                      cerrado_por = 'b0000000-0000-0000-0000-0000000000b1'
    where id = 'e0000000-0000-0000-0000-0000000000b1';
  begin
    insert into lecturas (cliente_id, contador_id, periodo_id, fecha_lectura,
                          lectura_anterior, lectura_actual, consumo_m3)
    values ('b0000000-0000-0000-0000-000000000002',
            'c0000000-0000-0000-0000-0000000000b1',
            'e0000000-0000-0000-0000-0000000000b1',
            current_date, 0, 10, 10);
    raise exception 'PASO 7 FALLÓ: se aceptó una lectura en un periodo cerrado';
  exception when others then
    if sqlerrm not like '%periodo está cerrado%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 8: (contador_id, periodo_id) duplicado es rechazado (unique) — CA-5
-- La lectura del contador A1 en el periodo A1 ya existe (fixture); reintentarla
-- desde otra sesión del admin A debe violar el unique.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into lecturas (cliente_id, contador_id, periodo_id, fecha_lectura,
                          lectura_anterior, lectura_actual, consumo_m3)
    values ('a0000000-0000-0000-0000-000000000001',
            'c0000000-0000-0000-0000-0000000000a1',
            'e0000000-0000-0000-0000-0000000000a1',
            current_date, 0, 26, 26);
    raise exception 'PASO 8 FALLÓ: se aceptó una lectura duplicada (mismo contador+periodo)';
  exception when others then
    if sqlerrm not like '%duplicate key%' and sqlerrm not like '%unique%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 9: idempotencia del reenvío offline — CA-5
-- El mismo id_cliente_offline + mismo contador+periodo no debe duplicar la
-- lectura cuando la app reenvía por falla de red. La garantía DB más fuerte es
-- el unique (contador_id, periodo_id); además existe el unique de
-- id_cliente_offline (verificado abajo) que impide que un id se repita en
-- filas distintas. Se prueba sobre el cliente B (periodo B1 abierto sin
-- lecturas en el fixture): el reenvío deja exactamente 1 fila.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
do $$
declare
  n integer;
begin
  -- el unique de id_cliente_offline existe (garantía estructural)
  select count(*) into n from pg_constraint where conname = 'lecturas_id_cliente_offline_key';
  if n <> 1 then raise exception 'PASO 9 FALLÓ: falta el unique de id_cliente_offline'; end if;

  -- primera lectura (reenvío original)
  insert into lecturas (cliente_id, contador_id, periodo_id, fecha_lectura,
                        lectura_anterior, lectura_actual, consumo_m3, id_cliente_offline)
  values ('b0000000-0000-0000-0000-000000000002',
          'c0000000-0000-0000-0000-0000000000b1',
          'e0000000-0000-0000-0000-0000000000b1',
          current_date, 0, 40, 40, 'off-reenvio-b1');

  -- reenvío idéntico: se ignora (do nothing) y no queda duplicado
  insert into lecturas (cliente_id, contador_id, periodo_id, fecha_lectura,
                        lectura_anterior, lectura_actual, consumo_m3, id_cliente_offline)
  values ('b0000000-0000-0000-0000-000000000002',
          'c0000000-0000-0000-0000-0000000000b1',
          'e0000000-0000-0000-0000-0000000000b1',
          current_date, 0, 40, 40, 'off-reenvio-b1')
  on conflict (contador_id, periodo_id) do nothing;

  select count(*) into n
    from lecturas
    where cliente_id = 'b0000000-0000-0000-0000-000000000002'
      and contador_id = 'c0000000-0000-0000-0000-0000000000b1'
      and periodo_id = 'e0000000-0000-0000-0000-0000000000b1'
      and id_cliente_offline = 'off-reenvio-b1';
  if n <> 1 then
    raise exception 'PASO 9 FALLÓ: quedaron % filas para el reenvío offline (esperaba 1)', n;
  end if;
end $$;
rollback;

\echo 'LECTURAS-CONSUMO-AISLAMIENTO OK'

