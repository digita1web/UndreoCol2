-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de suscriptores y contadores (plan.md §8)
-- Referencia: specs/003-suscriptores-contadores/plan.md y tasks.md T-002
-- Cubre CA-2 (aislamiento multi-tenant, incluyendo reemplazar_contador() como
-- SECURITY INVOKER) y CA-5 (un solo contador activo por suscriptor, incluso
-- bajo reemplazos sucesivos y bajo INSERT directo).
--
-- Requiere tests/fixtures/fundacion.sql, tests/fixtures/catalogo.sql y
-- tests/fixtures/suscriptores.sql aplicados antes. Mismo mecanismo que
-- 001/002: cada escenario abre una transacción, simula el rol y la sesión con
--   set local role <anon|authenticated>
--   set local request.jwt.claim.sub = '<uuid del perfil>'
-- ejecuta sus aserciones y hace rollback.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/003_suscriptores_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existen contadores/reemplazos_contador, con RLS FORCE
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from information_schema.tables
    where table_schema = 'public' and table_name in ('contadores','reemplazos_contador');
  if n <> 2 then
    raise exception 'PASO 1 FALLÓ: se encontraron % de las 2 tablas nuevas', n;
  end if;
  select count(*) into n from pg_class
    where relname in ('contadores','reemplazos_contador') and relforcerowsecurity;
  if n <> 2 then
    raise exception 'PASO 1 FALLÓ: % de las 2 tablas tienen FORCE ROW LEVEL SECURITY', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: admin_acueducto A ve SOLO los suscriptores/contadores de A
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  -- Por existencia de los 2 IDs originales del fixture, no por conteo total:
  -- fixtures posteriores (011-dashboard) agregan más usuarios_servicio a A a
  -- propósito, y un conteo fijo se vuelve frágil sin que la RLS esté rota.
  select count(*) into n from usuarios_servicio
    where id in ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2');
  if n <> 2 then raise exception 'PASO 2 FALLÓ: admin A no ve sus 2 usuarios_servicio originales (ve %)', n; end if;
  select count(*) into n from contadores;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin A ve % contadores (esperaba 1)', n; end if;
  select count(*) into n from contadores where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin A ve contadores del cliente B'; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: admin_acueducto A NO puede insertar/actualizar contadores del
-- cliente B, ni con el usuario_servicio_id de B adivinado directamente
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into contadores (cliente_id, usuario_servicio_id, serial, capacidad_maxima, fecha_instalacion)
    values ('b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000b1',
            'INTRUSO', 99999, current_date);
    raise exception 'PASO 3 FALLÓ: admin A pudo insertar un contador en el cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;

  update contadores set observaciones = 'hackeado' where id = 'c0000000-0000-0000-0000-0000000000b1';
  if found then
    raise exception 'PASO 3 FALLÓ: admin A pudo actualizar un contador del cliente B';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: reemplazar_contador() (SECURITY INVOKER) rechaza un
-- usuario_servicio_id de otro acueducto — RLS lo hace invisible antes de
-- es_admin_de() (mismo comportamiento verificado en 002 T-002 PASO 4).
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    perform reemplazar_contador('d0000000-0000-0000-0000-0000000000b1', 'NUEVO', 'Marca',
                                 99999, 12345, 0, 'prueba cruzada');
    raise exception 'PASO 4 FALLÓ: admin A pudo reemplazar el contador de un suscriptor del cliente B';
  exception when others then
    if sqlerrm not like '%no existe%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: rol lector no puede escribir en usuarios_servicio, contadores ni
-- reemplazos_contador (solo lectura)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2'; -- Lector A
do $$
begin
  begin
    update usuarios_servicio set nombre = 'hackeado' where id = 'd0000000-0000-0000-0000-0000000000a1';
    if found then raise exception 'PASO 5 FALLÓ: lector A pudo actualizar un suscriptor'; end if;
  end;

  begin
    insert into contadores (cliente_id, usuario_servicio_id, serial, capacidad_maxima, fecha_instalacion)
    values ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a2',
            'LECTOR-INTENTO', 99999, current_date);
    raise exception 'PASO 5 FALLÓ: lector A pudo insertar un contador';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;

  -- reemplazar_contador() hace SELECT ... FOR UPDATE sobre usuarios_servicio:
  -- PostgreSQL aplica ahí la política RLS de ESCRITURA (usuarios_servicio_escritura,
  -- que exige es_admin_de()), no solo la de lectura — confirmado directamente:
  -- un SELECT plano de lector A sobre el suscriptor de A sí devuelve la fila,
  -- pero el mismo SELECT ... FOR UPDATE devuelve 0 filas. Por eso la función
  -- nunca llega a su propio chequeo es_admin_de() para este caso: RLS ya
  -- bloqueó antes, el mensaje es "no existe", no "No autorizado" (esa rama
  -- queda como defensa adicional para un caller que sí pase el FOR UPDATE
  -- pero no sea admin_acueducto — no hay ningún rol en el esquema actual que
  -- cumpla esa condición, pero se mantiene por si el modelo de roles cambia).
  begin
    perform reemplazar_contador('d0000000-0000-0000-0000-0000000000a1', 'NUEVO', 'Marca',
                                 99999, 12345, 0, 'lector no autorizado');
    raise exception 'PASO 5 FALLÓ: lector A pudo reemplazar un contador vía reemplazar_contador()';
  exception when others then
    if sqlerrm not like '%no existe%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 6 (CA-5): reemplazar_contador() dos veces seguidas deja exactamente un
-- contador activo para el suscriptor, y un INSERT directo de un segundo
-- contador activo viola uq_contador_activo.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n_activos integer;
  v_id_reemplazo_1 uuid;
  v_id_reemplazo_2 uuid;
  v_contador_actual uuid;
begin
  select reemplazar_contador('d0000000-0000-0000-0000-0000000000a1', 'SERIAL-A1-V2', 'Marca V2',
                              99999, 55000, 0, 'primer reemplazo') into v_id_reemplazo_1;

  select count(*) into n_activos from contadores
    where usuario_servicio_id = 'd0000000-0000-0000-0000-0000000000a1' and estado = 'activo';
  if n_activos <> 1 then
    raise exception 'PASO 6 FALLÓ: % contadores activos tras el primer reemplazo (esperaba 1)', n_activos;
  end if;

  select reemplazar_contador('d0000000-0000-0000-0000-0000000000a1', 'SERIAL-A1-V3', 'Marca V3',
                              99999, 200, 0, 'segundo reemplazo') into v_id_reemplazo_2;

  select count(*) into n_activos from contadores
    where usuario_servicio_id = 'd0000000-0000-0000-0000-0000000000a1' and estado = 'activo';
  if n_activos <> 1 then
    raise exception 'PASO 6 FALLÓ: % contadores activos tras el segundo reemplazo (esperaba 1)', n_activos;
  end if;

  -- el contador original (c0000000-...-a1) y la primera versión nueva deben
  -- estar 'reemplazado', nunca eliminados (historial preservado)
  if (select estado from contadores where id = 'c0000000-0000-0000-0000-0000000000a1') <> 'reemplazado' then
    raise exception 'PASO 6 FALLÓ: el contador original no quedó reemplazado';
  end if;

  select contador_actual_id into v_contador_actual from usuarios_servicio
    where id = 'd0000000-0000-0000-0000-0000000000a1';
  if (select estado from contadores where id = v_contador_actual) <> 'activo' then
    raise exception 'PASO 6 FALLÓ: contador_actual_id no apunta a un contador activo';
  end if;

  -- 2 filas en reemplazos_contador para este suscriptor
  if (select count(*) from reemplazos_contador where usuario_servicio_id = 'd0000000-0000-0000-0000-0000000000a1') <> 2 then
    raise exception 'PASO 6 FALLÓ: no quedaron 2 registros de reemplazo';
  end if;

  -- INSERT directo de un segundo contador activo viola el índice único parcial
  begin
    insert into contadores (cliente_id, usuario_servicio_id, serial, capacidad_maxima, fecha_instalacion, estado)
    values ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1',
            'INTENTO-DIRECTO', 99999, current_date, 'activo');
    raise exception 'PASO 6 FALLÓ: se insertó un segundo contador activo por INSERT directo';
  exception when others then
    if sqlerrm not like '%duplicate key%' and sqlerrm not like '%unique%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 7: reemplazar_contador() sobre un suscriptor SIN contador activo
-- (A2, del fixture) falla con un mensaje explícito, no en silencio.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    perform reemplazar_contador('d0000000-0000-0000-0000-0000000000a2', 'NUEVO', 'Marca',
                                 99999, 0, 0, 'sin contador previo');
    raise exception 'PASO 7 FALLÓ: reemplazar_contador() tuvo éxito sobre un suscriptor sin contador activo';
  exception when others then
    if sqlerrm not like '%no tiene contador activo%' then raise; end if;
  end;
end $$;
rollback;

\echo 'SUSCRIPTORES-AISLAMIENTO OK'
