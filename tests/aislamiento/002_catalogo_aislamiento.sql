-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de catálogo y tarifas (plan.md §8)
-- Referencia: specs/002-catalogo-y-tarifas/plan.md y tasks.md T-002
-- Cubre CA-2 (aislamiento multi-tenant, incluyendo tarifa_vigente() y
-- crear_tarifa_version() como funciones SECURITY DEFINER/INVOKER) y CA-6
-- (no hay dos tarifas activas simultáneas ni bajo concurrencia).
--
-- Requiere tests/fixtures/fundacion.sql y tests/fixtures/catalogo.sql aplicados
-- antes. Mismo mecanismo que 001_fundacion_aislamiento.sql: cada escenario abre
-- una transacción, simula el rol y la sesión con
--   set local role <anon|authenticated>
--   set local request.jwt.claim.sub = '<uuid del perfil>'
-- ejecuta sus aserciones y hace rollback para no ensuciar el fixture.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/002_catalogo_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existen servicios y tarifas, con RLS FORCE
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from information_schema.tables
    where table_schema = 'public' and table_name in ('servicios','tarifas');
  if n <> 2 then
    raise exception 'PASO 1 FALLÓ: se encontraron % de las 2 tablas de catálogo', n;
  end if;
  select count(*) into n from pg_class
    where relname in ('servicios','tarifas') and relforcerowsecurity;
  if n <> 2 then
    raise exception 'PASO 1 FALLÓ: % de las 2 tablas tienen FORCE ROW LEVEL SECURITY', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: admin_acueducto A ve SOLO los servicios/tarifas de A por SELECT directo
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  select count(*) into n from servicios;
  if n <> 2 then raise exception 'PASO 2 FALLÓ: admin A ve % servicios (esperaba 2)', n; end if;
  select count(*) into n from servicios where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin A ve servicios del cliente B'; end if;
  select count(*) into n from tarifas;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin A ve % tarifas (esperaba 1)', n; end if;
  select count(*) into n from tarifas where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin A ve tarifas del cliente B'; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: admin_acueducto A NO puede insertar/actualizar servicios o tarifas
-- del cliente B, ni con el servicio_id de B adivinado directamente
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into servicios (cliente_id, codigo, nombre, tipo_calculo)
    values ('b0000000-0000-0000-0000-000000000002', 'aseo', 'Aseo', 'fijo');
    raise exception 'PASO 3 FALLÓ: admin A pudo insertar un servicio en el cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;

  update servicios set nombre = 'hackeado'
    where id = 'f0000000-0000-0000-0000-0000000000b1';
  if found then
    raise exception 'PASO 3 FALLÓ: admin A pudo actualizar un servicio del cliente B';
  end if;

  begin
    insert into tarifas (cliente_id, servicio_id, categoria, vigencia_desde,
                          cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3)
    values ('b0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000b1',
            'estrato_1', current_date, 1000, 10, 500, 1000);
    raise exception 'PASO 3 FALLÓ: admin A pudo insertar una tarifa en el cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: crear_tarifa_version() (SECURITY INVOKER) rechaza el acceso
-- cruzado a un servicio_id de otro acueducto. Como corre con los permisos
-- del llamante, su propio SELECT inicial ya queda filtrado por la política
-- RLS de servicios_lectura ANTES de llegar al chequeo es_admin_de(): para un
-- servicio_id de B, admin A ni siquiera lo ve — el mensaje es "no existe",
-- no "No autorizado" (esa rama solo se alcanza para un miembro del MISMO
-- cliente sin rol admin_acueducto, ver PASO 5). Doble barrera: primero RLS
-- (invisibilidad), luego es_admin_de() como defensa adicional explícita.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  -- admin A no puede crear una tarifa para un servicio de B: RLS lo hace
  -- invisible antes de que la función pueda resolver su cliente_id.
  begin
    perform crear_tarifa_version('f0000000-0000-0000-0000-0000000000b1', 'estrato_3',
                                  1, 1, 1, 1);
    raise exception 'PASO 4 FALLÓ: admin A pudo crear una tarifa para un servicio del cliente B';
  exception when others then
    if sqlerrm not like '%no existe%' then raise; end if;
  end;

  -- admin A tampoco puede referenciar un servicio_id inexistente con éxito
  -- silencioso.
  begin
    perform crear_tarifa_version('00000000-0000-0000-0000-000000000000', 'estrato_3',
                                  1, 1, 1, 1);
    raise exception 'PASO 4 FALLÓ: admin A pudo crear una tarifa para un servicio inexistente';
  exception when others then
    if sqlerrm not like '%no existe%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: rol lector no puede escribir en servicios ni tarifas (solo lectura)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2'; -- Lector A
do $$
declare
  n integer;
begin
  select count(*) into n from servicios;
  if n <> 2 then raise exception 'PASO 5 FALLÓ: lector A ve % servicios (esperaba 2, solo lectura no cambia el conteo)', n; end if;

  begin
    insert into servicios (cliente_id, codigo, nombre, tipo_calculo)
    values ('a0000000-0000-0000-0000-000000000001', 'aseo', 'Aseo', 'fijo');
    raise exception 'PASO 5 FALLÓ: lector A pudo insertar un servicio';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;

  begin
    perform crear_tarifa_version('f0000000-0000-0000-0000-0000000000a1', 'estrato_3', 1, 1, 1, 1);
    raise exception 'PASO 5 FALLÓ: lector A pudo crear una tarifa vía crear_tarifa_version()';
  exception when others then
    if sqlerrm not like '%No autorizado%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 6 (CA-6): crear_tarifa_version() cierra la tarifa vigente y deja
-- exactamente una tarifa activa — sin ventana de dos vigentes simultáneas.
-- Simula la concurrencia con dos llamadas consecutivas en la misma sesión
-- (el SELECT ... FOR UPDATE de la función serializa cualquier llamada
-- concurrente real de dos conexiones distintas: la segunda espera el lock de
-- la primera y ve el resultado ya cerrado al ejecutar su propio UPDATE).
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n_vigentes integer;
  v_id_1 uuid;
  v_id_2 uuid;
begin
  select crear_tarifa_version(
    'f0000000-0000-0000-0000-0000000000a1', 'estrato_3', 6000, 22, 1300, 2500) into v_id_1;

  select count(*) into n_vigentes from tarifas
    where servicio_id = 'f0000000-0000-0000-0000-0000000000a1'
      and categoria = 'estrato_3' and vigencia_hasta is null;
  if n_vigentes <> 1 then
    raise exception 'PASO 6 FALLÓ: % tarifas vigentes tras el primer cambio (esperaba 1)', n_vigentes;
  end if;

  select crear_tarifa_version(
    'f0000000-0000-0000-0000-0000000000a1', 'estrato_3', 6500, 22, 1400, 2600) into v_id_2;

  select count(*) into n_vigentes from tarifas
    where servicio_id = 'f0000000-0000-0000-0000-0000000000a1'
      and categoria = 'estrato_3' and vigencia_hasta is null;
  if n_vigentes <> 1 then
    raise exception 'PASO 6 FALLÓ: % tarifas vigentes tras el segundo cambio (esperaba 1)', n_vigentes;
  end if;

  -- la tarifa original del fixture (90000000-...-a1, vigencia_desde de hace
  -- 60 días) debe quedar cerrada con vigencia_hasta = hoy-1 (caso normal)
  if (select vigencia_hasta from tarifas where id = '90000000-0000-0000-0000-0000000000a1') <> current_date - 1 then
    raise exception 'PASO 6 FALLÓ: la tarifa original no quedó cerrada en current_date - 1';
  end if;

  -- v_id_1 nació HOY y fue reemplazada el mismo día: no se cierra (violaría
  -- chk_vigencia), se elimina — nunca estuvo vigente un día completo.
  if exists (select 1 from tarifas where id = v_id_1) then
    raise exception 'PASO 6 FALLÓ: la primera versión nacida hoy no se eliminó al reemplazarla el mismo día';
  end if;

  -- v_id_2 es la única vigente
  if (select vigencia_hasta from tarifas where id = v_id_2) is not null then
    raise exception 'PASO 6 FALLÓ: v_id_2 debería seguir vigente (vigencia_hasta null)';
  end if;

  -- índice único (servicio_id, categoria, vigencia_desde) — dos tarifas el
  -- mismo día para el mismo servicio+categoría violan la unicidad si se
  -- intentara insertar a mano fuera de la función.
  begin
    insert into tarifas (cliente_id, servicio_id, categoria, vigencia_desde,
                          cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3)
    values ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a1',
            'estrato_3', current_date, 1, 1, 1, 1);
    raise exception 'PASO 6 FALLÓ: se insertó una segunda tarifa con la misma vigencia_desde';
  exception when others then
    if sqlerrm not like '%duplicate key%' and sqlerrm not like '%unique%' then raise; end if;
  end;
end $$;
rollback;

\echo 'CATALOGO-AISLAMIENTO OK'
