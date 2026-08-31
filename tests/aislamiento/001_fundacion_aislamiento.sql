-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de la fundación (plan §6.1, pasos 2-11)
-- Referencia: specs/001-fundacion/plan.md §6.1 y tasks.md T-13/T-14
--
-- Requiere tests/fixtures/fundacion.sql aplicado antes.
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/001_fundacion_aislamiento.sql
--
-- Mecánica: cada escenario abre una transacción, simula el rol y la sesión con
--   set local role <anon|authenticated>
--   set local request.jwt.claim.sub = '<uuid del perfil>'
-- (mecanismo nativo de Supabase: auth.uid() lee ese GUC), ejecuta sus
-- aserciones y hace rollback para no ensuciar el fixture. Cualquier aserción
-- fallida lanza raise exception y corta el script con ON_ERROR_STOP=1.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 2: existen las 6 tablas de la fundación
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('planes','clientes','perfiles','membresias',
                         'configuracion','usuarios_servicio');
  if n <> 6 then
    raise exception 'PASO 2 FALLÓ: se encontraron % de las 6 tablas de la fundación', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3: rol_usuario tiene EXACTAMENTE 3 valores
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
begin
  select string_agg(enumlabel, ',' order by enumlabel) into v
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'rol_usuario';
  if v <> 'admin_acueducto,administrador,lector' then
    raise exception 'PASO 3 FALLÓ: rol_usuario = "%", se esperan exactamente 3 valores (administrador, admin_acueducto, lector)', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 4: usuarios_servicio NO tiene columna perfil_id (D-2)
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n
    from information_schema.columns
    where table_schema = 'public' and table_name = 'usuarios_servicio'
      and column_name = 'perfil_id';
  if n <> 0 then
    raise exception 'PASO 4 FALLÓ: usuarios_servicio.perfil_id existe (viola D-2)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 5: RLS habilitado + FORCE en las 6 tablas
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n
    from pg_class c
    join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public'
      and c.relname in ('planes','clientes','perfiles','membresias',
                        'configuracion','usuarios_servicio')
      and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 6 then
    raise exception 'PASO 5 FALLÓ: % de 6 tablas con RLS+FORCE', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 6: rol anon no lee datos de negocio (planes es lectura pública)
-- ---------------------------------------------------------------------------
begin;
set local role anon;
set local request.jwt.claim.sub = '';
do $$
declare
  n integer;
begin
  select count(*) into n from clientes;
  if n <> 0 then raise exception 'PASO 6 FALLÓ: anon ve % clientes', n; end if;
  select count(*) into n from perfiles;
  if n <> 0 then raise exception 'PASO 6 FALLÓ: anon ve % perfiles', n; end if;
  select count(*) into n from membresias;
  if n <> 0 then raise exception 'PASO 6 FALLÓ: anon ve % membresias', n; end if;
  select count(*) into n from configuracion;
  if n <> 0 then raise exception 'PASO 6 FALLÓ: anon ve % configuraciones', n; end if;
  select count(*) into n from usuarios_servicio;
  if n <> 0 then raise exception 'PASO 6 FALLÓ: anon ve % usuarios_servicio', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 7: admin_acueducto A ve SOLO los datos de A
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  select count(*) into n from clientes;
  if n <> 1 then raise exception 'PASO 7 FALLÓ: admin A ve % clientes (esperaba 1)', n; end if;
  select count(*) into n from clientes where id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 7 FALLÓ: admin A ve el cliente B', n; end if;
  select count(*) into n from configuracion;
  if n <> 1 then raise exception 'PASO 7 FALLÓ: admin A ve % configuraciones (esperaba 1)', n; end if;
  select count(*) into n from usuarios_servicio;
  if n <> 2 then raise exception 'PASO 7 FALLÓ: admin A ve % usuarios_servicio (esperaba 2)', n; end if;
  select count(*) into n from membresias;
  if n <> 2 then raise exception 'PASO 7 FALLÓ: admin A ve % membresias (esperaba 2)', n; end if;
  select count(*) into n from perfiles where id = 'a0000000-0000-0000-0000-0000000000a1';
  if n <> 1 then raise exception 'PASO 7 FALLÓ: admin A no ve su propio perfil', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 8: admin_acueducto A NO puede insertar/editar datos del cliente B
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  -- insertar un usuario de servicio en el cliente B
  begin
    insert into usuarios_servicio (id, cliente_id, codigo_suscriptor, nombre)
    values ('e0000000-0000-0000-0000-0000000000b9', 'b0000000-0000-0000-0000-000000000002', 'B-999', 'Intruso');
    raise exception 'PASO 8 FALLÓ: admin A pudo insertar un usuario en el cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;
  -- actualizar un usuario de servicio del cliente B (RLS filtra en USING)
  update usuarios_servicio set nombre = 'hackeado'
    where id = 'd0000000-0000-0000-0000-0000000000b1';
  if found then
    raise exception 'PASO 8 FALLÓ: admin A pudo actualizar un usuario del cliente B';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 9: admin_acueducto A NO puede otorgar rol 'administrador'
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  -- rol administrador: bloqueado por chk_ambito_rol y/o por la política RLS
  begin
    insert into membresias (perfil_id, cliente_id, rol)
    values ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'administrador');
    raise exception 'PASO 9 FALLÓ: admin A pudo otorgar el rol administrador';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%chk_ambito_rol%' then raise; end if;
  end;
  -- membresía en el cliente B (debe violar la política RLS)
  begin
    insert into membresias (perfil_id, cliente_id, rol)
    values ('a0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000002', 'lector');
    raise exception 'PASO 9 FALLÓ: admin A pudo crear una membresía en el cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 10: el administrador de plataforma ve y gestiona todo
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-000000000001';
do $$
declare
  n integer;
begin
  select count(*) into n from clientes;
  if n <> 2 then raise exception 'PASO 10 FALLÓ: plataforma ve % clientes (esperaba 2)', n; end if;
  select count(*) into n from configuracion;
  if n <> 2 then raise exception 'PASO 10 FALLÓ: plataforma ve % configuraciones (esperaba 2)', n; end if;
  select count(*) into n from usuarios_servicio;
  if n <> 3 then raise exception 'PASO 10 FALLÓ: plataforma ve % usuarios_servicio (esperaba 3)', n; end if;
  -- la plataforma gestiona planes y clientes
  insert into planes (id, nombre, valor_suscriptor) values
    ('10000000-0000-0000-0000-000000000099', 'TestPlataforma', 1);
  insert into clientes (id, nombre, slug) values
    ('c0000000-0000-0000-0000-0000000000c1', 'Cliente Temporal', 'cliente-temporal');
  select count(*) into n from clientes;
  if n <> 3 then raise exception 'PASO 10 FALLÓ: plataforma no pudo insertar un cliente', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 11: planes es lectura pública; escritura solo para la plataforma
-- ---------------------------------------------------------------------------
begin;
set local role anon;
set local request.jwt.claim.sub = '';
do $$
declare
  n integer;
begin
  select count(*) into n from planes;
  if n < 2 then raise exception 'PASO 11 FALLÓ: anon no ve los planes públicos', n; end if;
  begin
    insert into planes (id, nombre, valor_suscriptor) values
      ('10000000-0000-0000-0000-000000000077', 'AnonPlanes', 1);
    raise exception 'PASO 11 FALLÓ: anon pudo escribir en planes';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into planes (id, nombre, valor_suscriptor) values
      ('10000000-0000-0000-0000-000000000078', 'AdminAPlanes', 1);
    raise exception 'PASO 11 FALLÓ: admin de A pudo escribir en planes';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;
end $$;
rollback;

\echo 'FUNDACION-AISLAMIENTO OK'


