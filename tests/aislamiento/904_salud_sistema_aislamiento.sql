-- =============================================================================
-- UndreoCol — Panel maestro: planes/estado de cuenta y salud del sistema (035)
-- Migración: 20260925090000_panel-maestro-planes-salud.sql
-- Serie 900+: 035 no está en el roadmap original, igual que 017/018.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/904_salud_sistema_aislamiento.sql
-- Requiere tests/fixtures/fundacion.sql (clientes A/B, perfiles, membresías,
-- incluida la de plataforma c0000000-0000-0000-0000-000000000001).
--
-- HALLAZGO REAL de esta sesión (055), que este test fija como regresión: el
-- GRANT de columna nuevo (plan_id, estado_cuenta) por sí solo dejaba a un
-- admin_acueducto cambiar el plan/estado de SU PROPIO acueducto, porque
-- clientes_color_acento (023) ya autoriza UPDATE sobre esa fila y RLS no
-- distingue por columna dentro de una fila ya autorizada por otra política.
-- El trigger bloquear_cambio_plan_estado() es la mitigación — este test
-- confirma que sigue activa.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- PASO 1: admin_acueducto (A) no puede leer _salud_sistema ni _keepalive
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
  select count(*) into n from _salud_sistema;
  reset role;
  if n <> 0 then
    raise exception 'PASO 1 FALLÓ: admin_acueducto leyó % fila(s) de _salud_sistema', n;
  end if;
end $$;

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
  select count(*) into n from _keepalive;
  reset role;
  if n <> 0 then
    raise exception 'PASO 1 FALLÓ: admin_acueducto leyó % fila(s) de _keepalive', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: anon tampoco puede leer ninguna de las dos
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  select count(*) into n from _salud_sistema;
  reset role;
  if n <> 0 then
    raise exception 'PASO 2 FALLÓ: anon leyó % fila(s) de _salud_sistema', n;
  end if;
end $$;

do $$
declare n int;
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub','',true);
  select count(*) into n from _keepalive;
  reset role;
  if n <> 0 then
    raise exception 'PASO 2 FALLÓ: anon leyó % fila(s) de _keepalive', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3: es_admin_plataforma() SÍ lee ambas
-- ---------------------------------------------------------------------------
do $$
declare n_salud int; declare n_keepalive int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
  select count(*) into n_salud from _salud_sistema;
  select count(*) into n_keepalive from _keepalive;
  reset role;
  if n_salud <> 1 then
    raise exception 'PASO 3 FALLÓ: el superadmin no pudo leer _salud_sistema (filas=%)', n_salud;
  end if;
  if n_keepalive <> 1 then
    raise exception 'PASO 3 FALLÓ: el superadmin no pudo leer _keepalive (filas=%)', n_keepalive;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 4: admin_acueducto (A) NO puede cambiar el plan/estado de cuenta de
--   SU PROPIO acueducto, aunque clientes_color_acento (023) ya lo autorice
--   sobre esa misma fila para otras columnas (hallazgo real, ver cabecera)
-- ---------------------------------------------------------------------------
do $$
declare bloqueado boolean := false;
declare estado_antes text; declare estado_despues text;
begin
  select estado_cuenta into estado_antes from clientes where id = 'a0000000-0000-0000-0000-000000000001';
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
    update clientes set estado_cuenta = 'suspendida' where id = 'a0000000-0000-0000-0000-000000000001';
    reset role;
  exception when others then
    reset role;
    if sqlerrm like 'Solo el superadmin de la plataforma%' then
      bloqueado := true;
    else
      raise;
    end if;
  end;
  select estado_cuenta into estado_despues from clientes where id = 'a0000000-0000-0000-0000-000000000001';
  if not bloqueado then
    raise exception 'PASO 4 FALLÓ: admin_acueducto pudo cambiar estado_cuenta de su propio acueducto';
  end if;
  if estado_antes <> estado_despues then
    raise exception 'PASO 4 FALLÓ: estado_cuenta cambió pese al bloqueo (% -> %)', estado_antes, estado_despues;
  end if;
end $$;

do $$
declare bloqueado boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
    update clientes set plan_id = '10000000-0000-0000-0000-000000000002' where id = 'a0000000-0000-0000-0000-000000000001';
    reset role;
  exception when others then
    reset role;
    if sqlerrm like 'Solo el superadmin de la plataforma%' then
      bloqueado := true;
    else
      raise;
    end if;
  end;
  if not bloqueado then
    raise exception 'PASO 4 FALLÓ: admin_acueducto pudo cambiar plan_id de su propio acueducto';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 5 (regresión, no de esta feature): admin_acueducto sigue pudiendo
--   cambiar color_acento de su propio acueducto — el trigger nuevo NO debe
--   bloquear lo que 023 ya permitía
-- ---------------------------------------------------------------------------
do $$
declare color_despues text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
  update clientes set color_acento = '#654321' where id = 'a0000000-0000-0000-0000-000000000001';
  reset role;
  select color_acento into color_despues from clientes where id = 'a0000000-0000-0000-0000-000000000001';
  if color_despues <> '#654321' then
    raise exception 'PASO 5 FALLÓ (regresión de 023): admin_acueducto no pudo cambiar color_acento';
  end if;
  -- deshacer, no dejar residuo
  update clientes set color_acento = '#14408C' where id = 'a0000000-0000-0000-0000-000000000001';
end $$;

-- ---------------------------------------------------------------------------
-- PASO 6: es_admin_plataforma() SÍ puede cambiar plan_id y estado_cuenta de
--   cualquier acueducto — sin residuo, se deshace al final
-- ---------------------------------------------------------------------------
do $$
declare estado_real text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);
  update clientes set estado_cuenta = 'vencida' where id = 'b0000000-0000-0000-0000-000000000002';
  reset role;
  select estado_cuenta into estado_real from clientes where id = 'b0000000-0000-0000-0000-000000000002';
  if estado_real <> 'vencida' then
    raise exception 'PASO 6 FALLÓ: el superadmin no pudo cambiar estado_cuenta de Acueducto B';
  end if;
  -- deshacer, no dejar residuo
  update clientes set estado_cuenta = 'activa' where id = 'b0000000-0000-0000-0000-000000000002';
end $$;

rollback;

\echo '904: SALUD-SISTEMA-AISLAMIENTO OK — RLS de _salud_sistema/_keepalive, trigger de plan/estado_cuenta y regresión de color_acento (023) verificados'
