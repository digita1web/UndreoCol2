-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de importación de suscriptores (plan.md §8)
-- Referencia: specs/012-importacion-suscriptores-excel/plan.md y tasks.md T-003
-- Cubre CA-4 (aislamiento multi-tenant de importaciones_suscriptores e
-- importar_suscriptores() como función SECURITY INVOKER) y re-verifica CA-6
-- (atomicidad del lote, ya probado funcionalmente en T-002) dentro de la
-- suite formal de aislamiento.
--
-- Requiere tests/fixtures/fundacion.sql .. tests/fixtures/cortes.sql y
-- tests/fixtures/importacion.sql (no-op) aplicados antes. Mismo mecanismo
-- que 001-009: cada escenario abre una transacción y hace ROLLBACK.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/012_importacion_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existe importaciones_suscriptores, con RLS FORCE
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from information_schema.tables
    where table_schema = 'public' and table_name = 'importaciones_suscriptores';
  if n <> 1 then
    raise exception 'PASO 1 FALLÓ: no se encontró la tabla importaciones_suscriptores';
  end if;
  select count(*) into n from pg_class
    where relname = 'importaciones_suscriptores' and relforcerowsecurity;
  if n <> 1 then
    raise exception 'PASO 1 FALLÓ: importaciones_suscriptores no tiene FORCE ROW LEVEL SECURITY';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: admin A no puede llamar importar_suscriptores() con el cliente_id
-- de B — el chequeo es_admin_de() explícito rechaza antes de insertar nada.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  v_before integer;
  v_after  integer;
begin
  select count(*) into v_before from usuarios_servicio where cliente_id = 'b0000000-0000-0000-0000-000000000002';

  begin
    perform importar_suscriptores(
      'b0000000-0000-0000-0000-000000000002',
      '[{"codigo_suscriptor":"INTRUSO-1","nombre":"Intruso","numero_documento":"1","direccion":"X","categoria":"estrato_1"}]'::jsonb,
      '[]'::jsonb, 'intento.xlsx', 'a0000000-0000-0000-0000-0000000000a1'
    );
    raise exception 'PASO 2 FALLÓ: admin A pudo importar suscriptores al cliente B';
  exception when others then
    if sqlerrm not like '%No autorizado%' then raise; end if;
  end;

  select count(*) into v_after from usuarios_servicio where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if v_after <> v_before then
    raise exception 'PASO 2 FALLÓ: quedó algo insertado en el cliente B (% -> %)', v_before, v_after;
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: admin A no puede leer el historial de importaciones de B.
-- ---------------------------------------------------------------------------
begin;
-- inserta como postgres (bypassrls, rol de la sesión por defecto) un registro
-- de historial de B para confirmar que admin A no lo ve.
insert into importaciones_suscriptores (id, cliente_id, nombre_archivo, filas_intentadas,
                                         filas_importadas, filas_con_error, realizado_por)
values ('c0000000-0000-0000-0000-000000000b01', 'b0000000-0000-0000-0000-000000000002',
        'de-b.xlsx', 1, 1, 0, 'b0000000-0000-0000-0000-0000000000b1');

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  if exists (select 1 from importaciones_suscriptores where id = 'c0000000-0000-0000-0000-000000000b01') then
    raise exception 'PASO 3 FALLÓ: admin A pudo leer el historial de importación del cliente B';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: rol lector no puede llamar importar_suscriptores() sobre su propio
-- cliente (solo admin_acueducto puede).
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2'; -- Lector A
do $$
begin
  begin
    perform importar_suscriptores(
      'a0000000-0000-0000-0000-000000000001',
      '[{"codigo_suscriptor":"LECTOR-1","nombre":"X","numero_documento":"1","direccion":"X","categoria":"estrato_1"}]'::jsonb,
      '[]'::jsonb, 'intento.xlsx', 'a0000000-0000-0000-0000-0000000000a2'
    );
    raise exception 'PASO 4 FALLÓ: lector A pudo importar suscriptores';
  exception when others then
    if sqlerrm not like '%No autorizado%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5 (CA-6, re-verificado en la suite formal): un lote con una fila que
-- viola el constraint único de codigo_suscriptor revierte TODO el lote.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  v_before integer;
  v_after  integer;
begin
  select count(*) into v_before from usuarios_servicio where cliente_id = 'a0000000-0000-0000-0000-000000000001';

  begin
    perform importar_suscriptores(
      'a0000000-0000-0000-0000-000000000001',
      '[{"codigo_suscriptor":"IMP-VALIDO","nombre":"Válido","numero_documento":"5550001","direccion":"X","categoria":"estrato_3"},
        {"codigo_suscriptor":"A-001","nombre":"Duplicado","numero_documento":"5550002","direccion":"Y","categoria":"estrato_3"}]'::jsonb,
      '[]'::jsonb, 'con-duplicado.xlsx', 'a0000000-0000-0000-0000-0000000000a1'
    );
    raise exception 'PASO 5 FALLÓ: se importó un lote con un codigo_suscriptor duplicado';
  exception when others then
    if sqlerrm not like '%duplicate key%' and sqlerrm not like '%unique%' then raise; end if;
  end;

  select count(*) into v_after from usuarios_servicio where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if v_after <> v_before then
    raise exception 'PASO 5 FALLÓ: el lote dejó % suscriptores nuevos en vez de revertir todo', v_after - v_before;
  end if;
  if exists (select 1 from usuarios_servicio where codigo_suscriptor = 'IMP-VALIDO') then
    raise exception 'PASO 5 FALLÓ: la fila válida quedó insertada pese a que el lote falló';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 6: importación exitosa solo afecta al cliente del llamante.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  v_id uuid;
  v_before_b integer;
  v_after_b  integer;
begin
  select count(*) into v_before_b from usuarios_servicio where cliente_id = 'b0000000-0000-0000-0000-000000000002';

  select importar_suscriptores(
    'a0000000-0000-0000-0000-000000000001',
    '[{"codigo_suscriptor":"IMP-OK","nombre":"Nuevo","numero_documento":"5550010","direccion":"Z","categoria":"estrato_3"}]'::jsonb,
    '[]'::jsonb, 'ok.xlsx', 'a0000000-0000-0000-0000-0000000000a1'
  ) into v_id;

  if not exists (select 1 from usuarios_servicio where codigo_suscriptor = 'IMP-OK' and cliente_id = 'a0000000-0000-0000-0000-000000000001') then
    raise exception 'PASO 6 FALLÓ: el suscriptor no quedó insertado en el cliente correcto';
  end if;

  select count(*) into v_after_b from usuarios_servicio where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if v_after_b <> v_before_b then
    raise exception 'PASO 6 FALLÓ: la importación de A afectó al cliente B';
  end if;

  if not exists (select 1 from importaciones_suscriptores where id = v_id and cliente_id = 'a0000000-0000-0000-0000-000000000001') then
    raise exception 'PASO 6 FALLÓ: no quedó el registro de historial esperado';
  end if;
end $$;
rollback;

\echo 'IMPORTACION-AISLAMIENTO OK'
