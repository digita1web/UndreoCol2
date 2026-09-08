-- =============================================================================
-- UndreoCol — Panel de plataforma: alta de acueductos (018)
-- Migración: 20260919090000_panel-plataforma.sql
-- Serie 900+: 018 no está en el roadmap original (plan §1), igual que 017.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/903_panel_plataforma_aislamiento.sql
-- Requiere tests/fixtures/fundacion.sql (clientes A/B, perfiles, membresías,
-- incluida la de plataforma c0000000-0000-0000-0000-000000000001).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- PASO 1: perfiles sigue sin INSERT para nadie que no sea es_admin_plataforma()
-- ---------------------------------------------------------------------------
do $$
declare bloqueado boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true); -- admin_acueducto A
    insert into perfiles (id, nombre, email)
      values ('e0000000-0000-0000-0000-000000000001','Intruso','intruso@test.local');
    reset role;
  exception when insufficient_privilege then
    reset role; bloqueado := true;
  end;
  if not bloqueado then
    raise exception 'PASO 1 FALLÓ: un admin_acueducto pudo insertar en perfiles';
  end if;
end $$;

do $$
declare bloqueado boolean := false;
begin
  begin
    set local role anon;
    perform set_config('request.jwt.claim.sub','',true);
    insert into perfiles (id, nombre, email)
      values ('e0000000-0000-0000-0000-000000000002','Intruso Anon','intruso-anon@test.local');
    reset role;
  exception when insufficient_privilege then
    reset role; bloqueado := true;
  end;
  if not bloqueado then
    raise exception 'PASO 1 FALLÓ: anon pudo insertar en perfiles';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: un admin_acueducto (no plataforma) no logra efecto real con las 2
--   funciones nuevas, aunque tenga EXECUTE otorgado a `authenticated` — RLS
--   bloquea el INSERT subyacente igual que en PASO 1.
-- ---------------------------------------------------------------------------
do $$
declare bloqueado boolean := false;
declare n_clientes_antes int; declare n_clientes_despues int;
begin
  select count(*) into n_clientes_antes from clientes;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
    perform crear_acueducto_base('Acueducto Intruso','acueducto-intruso');
    reset role;
  exception when insufficient_privilege then
    reset role; bloqueado := true;
  end;
  select count(*) into n_clientes_despues from clientes;
  if not bloqueado then
    raise exception 'PASO 2 FALLÓ: un admin_acueducto pudo ejecutar crear_acueducto_base con efecto';
  end if;
  if n_clientes_antes <> n_clientes_despues then
    raise exception 'PASO 2 FALLÓ: crear_acueducto_base dejó residuo tras el bloqueo (% -> %)', n_clientes_antes, n_clientes_despues;
  end if;
end $$;

do $$
declare bloqueado boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
    perform asignar_admin_acueducto(
      'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003',
      'Intruso Asignado','intruso-asignado@test.local');
    reset role;
  exception when insufficient_privilege then
    reset role; bloqueado := true;
  end;
  if not bloqueado then
    raise exception 'PASO 2 FALLÓ: un admin_acueducto pudo ejecutar asignar_admin_acueducto con efecto';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3: el superadmin SÍ crea clientes+configuracion; slug duplicado falla
--   limpio, sin residuo (CA-1, CA-5)
-- ---------------------------------------------------------------------------
do $$
declare v_cliente_id uuid;
declare n_config int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true); -- plataforma
  v_cliente_id := crear_acueducto_base('Acueducto Nuevo Test','acueducto-nuevo-test');
  reset role;
  if v_cliente_id is null then
    raise exception 'PASO 3 FALLÓ: crear_acueducto_base no devolvió cliente_id';
  end if;
  select count(*) into n_config from configuracion where cliente_id = v_cliente_id;
  if n_config <> 1 then
    raise exception 'PASO 3 FALLÓ: configuracion no se creó junto con clientes (filas=%)', n_config;
  end if;
  -- Fila fuera del bloque `do` para que el PASO 4 pueda usar el id real.
  perform set_config('panel_plataforma.cliente_test_id', v_cliente_id::text, false);
end $$;

do $$
declare fallo_capturado boolean := false;
declare n_clientes_antes int; declare n_clientes_despues int;
begin
  select count(*) into n_clientes_antes from clientes;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
    perform crear_acueducto_base('Acueducto Duplicado','acueducto-a'); -- slug de la fixture A
    reset role;
  exception when others then
    reset role;
    if sqlerrm = 'El slug ya está en uso' then
      fallo_capturado := true;
    else
      raise;
    end if;
  end;
  select count(*) into n_clientes_despues from clientes;
  if not fallo_capturado then
    raise exception 'PASO 3 FALLÓ: un slug duplicado no lanzó el mensaje esperado';
  end if;
  if n_clientes_antes <> n_clientes_despues then
    raise exception 'PASO 3 FALLÓ: el slug duplicado dejó residuo en clientes (% -> %)', n_clientes_antes, n_clientes_despues;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 4: asignar_admin_acueducto crea perfiles+membresias correctos
-- ---------------------------------------------------------------------------
do $$
declare v_cliente_id uuid := current_setting('panel_plataforma.cliente_test_id')::uuid;
declare v_usuario_id uuid := 'e0000000-0000-0000-0000-000000000099';
declare n_perfiles int; declare n_membresias int; declare v_rol rol_usuario;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
  perform asignar_admin_acueducto(v_cliente_id, v_usuario_id, 'Admin Nuevo Test','admin-nuevo-test@test.local');
  reset role;
  select count(*) into n_perfiles from perfiles where id = v_usuario_id;
  select count(*), max(rol) into n_membresias, v_rol from membresias
    where perfil_id = v_usuario_id and cliente_id = v_cliente_id;
  if n_perfiles <> 1 then
    raise exception 'PASO 4 FALLÓ: asignar_admin_acueducto no creó el perfil (filas=%)', n_perfiles;
  end if;
  if n_membresias <> 1 or v_rol <> 'admin_acueducto' then
    raise exception 'PASO 4 FALLÓ: la membresía no quedó como admin_acueducto (filas=%, rol=%)', n_membresias, v_rol;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 5: el admin nuevo, con su propia sesión, ve solo SU acueducto — no
--   los de A ni B (aislamiento estándar, igual que las suites 001-012)
-- ---------------------------------------------------------------------------
do $$
declare v_cliente_id uuid := current_setting('panel_plataforma.cliente_test_id')::uuid;
declare v_usuario_id uuid := 'e0000000-0000-0000-0000-000000000099';
declare n_visibles int; declare n_propio int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_usuario_id::text, true);
  select count(*) into n_visibles from clientes;
  select count(*) into n_propio from clientes where id = v_cliente_id;
  reset role;
  if n_propio <> 1 then
    raise exception 'PASO 5 FALLÓ: el admin nuevo no ve su propio acueducto';
  end if;
  if n_visibles <> 1 then
    raise exception 'PASO 5 FALLÓ: el admin nuevo ve % acueductos, debería ver solo el suyo', n_visibles;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 6: con solo la membresía 'administrador' (cliente_id NULL), la
--   consulta que usa resolverClienteActivo() (lib/tenant.ts, T-004) devuelve
--   exactamente 1 fila con cliente_id NULL — la base del fix del bug real
--   de esta sesión (CA-3). El propio TypeScript se prueba en T-004; esto
--   confirma la forma de datos de la que parte.
-- ---------------------------------------------------------------------------
do $$
declare n_filas int; declare n_cliente_id_null int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
  select count(*) into n_filas from membresias where perfil_id = auth.uid() and activo = true;
  select count(*) into n_cliente_id_null from membresias
    where perfil_id = auth.uid() and activo = true and cliente_id is null;
  reset role;
  if n_filas <> 1 or n_cliente_id_null <> 1 then
    raise exception 'PASO 6 FALLÓ: la membresía de plataforma no tiene la forma esperada (filas=%, cliente_id_null=%)', n_filas, n_cliente_id_null;
  end if;
end $$;

rollback;

\echo 'PANEL-PLATAFORMA-AISLAMIENTO OK'
