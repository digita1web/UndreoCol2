-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de la fundación (plan §8.2, pasos 2-14)
-- Referencia: specs/001-fundacion/plan.md §8 y tasks.md T-003
-- Cubre CA-1, CA-2, CA-7 (PASO 14) y el soporte de esquema de CA-8 (PASO 12)
-- y CA-9 (PASO 13). CA-10 y CA-11 se verifican por fuera (workflow + manual).
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
  if n <> 0 then raise exception 'PASO 7 FALLÓ: admin A ve el cliente B'; end if;
  select count(*) into n from configuracion;
  if n <> 1 then raise exception 'PASO 7 FALLÓ: admin A ve % configuraciones (esperaba 1)', n; end if;
  select count(*) into n from usuarios_servicio;
  if n <> 2 then raise exception 'PASO 7 FALLÓ: admin A ve % usuarios_servicio (esperaba 2)', n; end if;
  select count(*) into n from membresias;
  if n <> 2 then raise exception 'PASO 7 FALLÓ: admin A ve % membresias (esperaba 2)', n; end if;
  select count(*) into n from perfiles where id = 'a0000000-0000-0000-0000-0000000000a1';
  if n <> 1 then raise exception 'PASO 7 FALLÓ: admin A no ve su propio perfil'; end if;
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
  -- CA-2 paso 2: rol 'administrador' para OTRO perfil del mismo cliente (lector A)
  begin
    insert into membresias (perfil_id, cliente_id, rol)
    values ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'administrador');
    raise exception 'PASO 9 FALLÓ: admin A otorgó el rol administrador a otro perfil';
  exception when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%chk_ambito_rol%' then raise; end if;
  end;
  -- CA-2 paso 5: admin A NO puede modificar plan_id/estado_cuenta de SU cliente
  update clientes set plan_id = null, estado_cuenta = 'suspendida'
    where id = 'a0000000-0000-0000-0000-000000000001';
  if found then
    raise exception 'PASO 9 FALLÓ: admin A modificó plan_id/estado_cuenta de su cliente';
  end if;
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
  if n <> 3 then raise exception 'PASO 10 FALLÓ: plataforma no pudo insertar un cliente'; end if;
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
  if n < 2 then raise exception 'PASO 11 FALLÓ: anon no ve los planes públicos'; end if;
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

-- ---------------------------------------------------------------------------
-- PASO 12: soporte del Worker keepalive (CA-8, parte de esquema)
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  -- _keepalive existe con RLS + FORCE
  select count(*) into n
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relname = '_keepalive'
      and c.relrowsecurity and c.relforcerowsecurity;
  if n <> 1 then raise exception 'PASO 12 FALLÓ: _keepalive sin RLS+FORCE'; end if;
  -- cero políticas (solo service_role la toca)
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = '_keepalive';
  if n <> 0 then raise exception 'PASO 12 FALLÓ: _keepalive tiene % políticas (esperaba 0)', n; end if;
  -- fila singleton sembrada por la migración
  select count(*) into n from _keepalive;
  if n <> 1 then raise exception 'PASO 12 FALLÓ: _keepalive tiene % filas (esperaba 1)', n; end if;
end $$;

-- anon no puede leer _keepalive (sin políticas, RLS FORCE filtra a 0 filas)
begin;
set local role anon;
set local request.jwt.claim.sub = '';
do $$
declare
  n integer;
begin
  select count(*) into n from _keepalive;
  if n <> 0 then raise exception 'PASO 12 FALLÓ: anon vio % filas de _keepalive', n; end if;
end $$;
rollback;

-- singleton: no se puede insertar un segundo id
begin;
do $$
begin
  insert into _keepalive (id, ultimo_ping) values (2, now());
  raise exception 'PASO 12 FALLÓ: se insertó un segundo id en _keepalive';
exception when others then
  if sqlerrm not like '%chk_singleton%' then raise; end if;
end $$;
rollback;

-- simulación del Worker: service_role actualiza ultimo_ping (mecanismo de cron/keepalive.ts)
begin;
set local role service_role;
do $$
declare
  v_ping timestamptz;
begin
  update _keepalive set ultimo_ping = now() returning ultimo_ping into v_ping;
  if v_ping is null then raise exception 'PASO 12 FALLÓ: el ping no se registró'; end if;
  if now() - v_ping > interval '5 seconds' then
    raise exception 'PASO 12 FALLÓ: ultimo_ping no quedó reciente';
  end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 13: soporte del Worker de monitoreo (CA-9, parte de esquema)
-- ---------------------------------------------------------------------------
begin;
set local role service_role;
do $$
declare
  v_mb numeric;
  v_pct numeric;
begin
  select public.tamano_base_mb() into v_mb;
  if v_mb is null or v_mb <= 0 then
    raise exception 'PASO 13 FALLÓ: tamano_base_mb() = %', v_mb;
  end if;
  v_pct := round(v_mb / 500.0 * 100, 2);
  if v_pct >= 80 then
    raise exception 'PASO 13 FALLÓ: base al % del límite de 500 MB en esta etapa', v_pct;
  end if;
end $$;
rollback;

-- anon no puede ejecutar tamano_base_mb()
begin;
set local role anon;
set local request.jwt.claim.sub = '';
do $$
begin
  perform public.tamano_base_mb();
  raise exception 'PASO 13 FALLÓ: anon ejecutó tamano_base_mb()';
exception when others then
  if sqlerrm not like '%permission denied%' then raise; end if;
end $$;
rollback;

-- authenticated no puede ejecutar tamano_base_mb()
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  perform public.tamano_base_mb();
  raise exception 'PASO 13 FALLÓ: authenticated ejecutó tamano_base_mb()';
exception when others then
  if sqlerrm not like '%permission denied%' then raise; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 14: onboarding transaccional (CA-7)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'e0000000-0000-0000-0000-0000000000e1';
do $$
declare
  v_cliente_id uuid;
  n integer;
begin
  select crear_tenant_con_admin('Acueducto Z', 'acueducto-z', 'z@test.local') into v_cliente_id;
  if v_cliente_id is null then raise exception 'PASO 14 FALLÓ: crear_tenant_con_admin devolvió null'; end if;

  select count(*) into n from clientes where id = v_cliente_id;
  if n <> 1 then raise exception 'PASO 14 FALLÓ: cliente no creado'; end if;
  select count(*) into n from perfiles where id = 'e0000000-0000-0000-0000-0000000000e1';
  if n <> 1 then raise exception 'PASO 14 FALLÓ: perfil no creado'; end if;
  select count(*) into n from membresias
    where perfil_id = 'e0000000-0000-0000-0000-0000000000e1'
      and cliente_id = v_cliente_id and rol = 'admin_acueducto' and activo;
  if n <> 1 then raise exception 'PASO 14 FALLÓ: membresia admin_acueducto no creada'; end if;
  select count(*) into n from configuracion where cliente_id = v_cliente_id;
  if n <> 1 then raise exception 'PASO 14 FALLÓ: configuracion no creada'; end if;
end $$;

-- atomicidad: OTRO usuario (e2, sin acueducto) intenta el MISMO slug → error
-- limpio. Se prueba en DO aparte para que el handler de excepción no revierta
-- la creación de Z del primer bloque (subtransacción del DO).
do $$
begin
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-0000000000e2', true);
  begin
    perform crear_tenant_con_admin('Acueducto Z2', 'acueducto-z', 'z2@test.local');
    raise exception 'PASO 14 FALLÓ: slug duplicado no fue rechazado';
  exception when others then
    if sqlerrm not like '%El slug ya está en uso%' then raise; end if;
  end;
end $$;

-- sin huérfanos: verificación de estado como postgres (superusuario, bypasa RLS)
-- para contar independientemente del aislamiento: quedan A, B y Z (3 filas)
set local role postgres;
do $$
declare n integer;
begin
  select count(*) into n from clientes;
  if n <> 3 then
    raise exception 'PASO 14 FALLÓ: el fallo de slug dejó huérfanos (% clientes, esperaba 3)', n;
  end if;
end $$;
rollback;

-- un usuario con acueducto no crea otro
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  perform crear_tenant_con_admin('Acueducto W', 'acueducto-w', 'admin-a@test.local');
  raise exception 'PASO 14 FALLÓ: un usuario con acueducto creó otro';
exception when others then
  if sqlerrm not like '%El usuario ya tiene un acueducto%' then raise; end if;
end $$;
rollback;

-- anon no puede ejecutar crear_tenant_con_admin
begin;
set local role anon;
set local request.jwt.claim.sub = '';
do $$
begin
  perform crear_tenant_con_admin('X', 'x-slug', 'x@test.local');
  raise exception 'PASO 14 FALLÓ: anon ejecutó crear_tenant_con_admin';
exception when others then
  if sqlerrm not like '%permission denied%' then raise; end if;
end $$;
rollback;

\echo 'FUNDACION-AISLAMIENTO OK'


