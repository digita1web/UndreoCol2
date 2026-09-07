-- =============================================================================
-- UndreoCol — Privilegios de las funciones SECURITY DEFINER
-- Migración: 20260918090000_endurecer-privilegios-funciones.sql
-- Cierra el hallazgo B-3 y la observación abierta en 017 T-001.
-- Serie 900+: corrección de seguridad transversal, no una feature del roadmap.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/902_privilegios_funciones_aislamiento.sql
-- Requiere tests/fixtures/fundacion.sql y catalogo.sql (servicios de A y de B).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- PASO 1: las 6 funciones del portal solo las ejecuta `anon`
--   No basta revocar de `public`: los default privileges de Supabase otorgan
--   toda función nueva a `authenticated`, y ese grant sobrevive al revoke de
--   public. Este paso es el que destapó el mismo fallo en 017 T-001.
-- ---------------------------------------------------------------------------
do $$
declare f text; o oid;
begin
  foreach f in array array[
    'portal_validar_credenciales(uuid, text, text)',
    'portal_facturas_suscriptor(uuid, text, text)',
    'portal_factura_completa(uuid, text, text, uuid)',
    'portal_saldo_favor_suscriptor(uuid, text, text)',
    'portal_consumo_suscriptor(uuid, text, text)',
    'portal_cliente_por_slug(text)'] loop
    o := f::regprocedure::oid;
    if has_function_privilege('public', o, 'EXECUTE') then
      raise exception 'PASO 1 FALLÓ: % es ejecutable por PUBLIC', f;
    end if;
    if has_function_privilege('authenticated', o, 'EXECUTE') then
      raise exception 'PASO 1 FALLÓ: % conserva el EXECUTE heredado por authenticated', f;
    end if;
    if not has_function_privilege('anon', o, 'EXECUTE') then
      raise exception 'PASO 1 FALLÓ: % ya no es ejecutable por anon — el portal dejaría de funcionar', f;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: el portal sigue vivo tras el revoke (no se rompió nada)
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  if portal_cliente_por_slug('acueducto-a') is null then
    raise exception 'PASO 2 FALLÓ: anon ya no puede resolver el slug del portal';
  end if;
  v := portal_facturas_suscriptor('a0000000-0000-0000-0000-000000000001','1000000001','A-001');
  reset role;
  if v is null then
    raise exception 'PASO 2 FALLÓ: anon ya no puede leer las facturas del portal';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3 (B-3): tarifa_vigente ya no filtra el tarifa_id de otro acueducto
-- ---------------------------------------------------------------------------
do $$
declare bloqueado boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
    perform tarifa_vigente('f0000000-0000-0000-0000-0000000000b1','estrato_3'::categoria_tarifaria, current_date);
    reset role;
  exception when insufficient_privilege then
    reset role; bloqueado := true;
  end;
  if not bloqueado then
    raise exception 'PASO 3 FALLÓ (B-3): un usuario sin membresía obtuvo el tarifa_id de otro acueducto';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 4: los TRES caminos legítimos de tarifa_vigente siguen funcionando.
--   Romper esto sería peor que el hallazgo: dejaría sin facturar al acueducto.
-- ---------------------------------------------------------------------------
do $$
declare
  serv_a uuid := (select id from servicios where cliente_id='a0000000-0000-0000-0000-000000000001' limit 1);
  serv_b uuid := 'f0000000-0000-0000-0000-0000000000b1';
  v uuid;
begin
  -- admin del acueducto (cambio de tarifas, emisión)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
  v := tarifa_vigente(serv_a,'estrato_3'::categoria_tarifaria, current_date);
  reset role;
  if v is null then raise exception 'PASO 4 FALLÓ: el admin de A no obtiene la tarifa de SU acueducto'; end if;

  -- LECTOR: llega aquí por la simulación de periodo. La guarda es de
  -- pertenencia al acueducto, NO de rol, justamente para no romper esta ruta.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a2',true);
  v := tarifa_vigente(serv_a,'estrato_3'::categoria_tarifaria, current_date);
  reset role;
  if v is null then raise exception 'PASO 4 FALLÓ: el lector de A no obtiene la tarifa — la simulación de periodo quedaría rota'; end if;

  -- service_role: el cierre de facturación masivo, sin JWT
  set local role service_role;
  perform set_config('request.jwt.claim.sub','',true);
  v := tarifa_vigente(serv_b,'estrato_3'::categoria_tarifaria, current_date);
  reset role;
  if v is null then raise exception 'PASO 4 FALLÓ: service_role no obtiene la tarifa — el cierre masivo quedaría roto'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 5: un servicio inexistente devuelve NULL, no lanza y no revela nada
--   (si lanzara distinto que un servicio ajeno, sería un oráculo de existencia)
-- ---------------------------------------------------------------------------
do $$
declare v uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
  v := tarifa_vigente('00000000-0000-0000-0000-000000000000','estrato_3'::categoria_tarifaria, current_date);
  reset role;
  if v is not null then
    raise exception 'PASO 5 FALLÓ: un servicio inexistente devolvió una tarifa';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 6: anon NO puede ejecutar tarifa_vigente (la clave anon es pública)
-- ---------------------------------------------------------------------------
do $$
declare bloqueado boolean := false;
begin
  begin
    set local role anon;
    perform set_config('request.jwt.claim.sub','',true);
    perform tarifa_vigente('f0000000-0000-0000-0000-0000000000b1','estrato_3'::categoria_tarifaria, current_date);
    reset role;
  exception when insufficient_privilege then
    reset role; bloqueado := true;
  end;
  if not bloqueado then
    raise exception 'PASO 6 FALLÓ: anon puede ejecutar tarifa_vigente';
  end if;
end $$;

rollback;

\echo 'PRIVILEGIOS-FUNCIONES-AISLAMIENTO OK'
