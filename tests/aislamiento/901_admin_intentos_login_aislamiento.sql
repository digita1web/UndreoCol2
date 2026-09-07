-- =============================================================================
-- UndreoCol — Test de aislamiento de admin_intentos_login (017, T-002)
-- Referencia: specs/017-rate-limit-login-admin/plan.md §8 y tasks.md T-002
-- Origen: hallazgo A-2 (ALTO) de la auditoría, docs/PLAN-PRODUCCION.md
--
-- NUMERACIÓN: serie 900+, reservada para suites que NO pertenecen a una feature
-- del roadmap. Las suites 001-0NN mapean 1:1 con `.specify/config.md`, donde 013
-- es exportes-contables y 014 rrhh-incapacidades; 017 se numeró fuera de esa
-- serie (spec §0.1), así que su suite también.
--
-- Requiere solo las migraciones aplicadas: esta tabla NO lleva cliente_id, así
-- que no depende de ningún fixture. Se ejecuta dentro de una transacción con
-- rollback y no deja rastro.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/901_admin_intentos_login_aislamiento.sql
--
-- COBERTURA: pasos 1-9 de la tabla del plan §8. El paso 10 (la purga, CA-7) se
-- verifica en T-005 contra el código real de cron/limpieza.ts: la purga se
-- implementa en TypeScript, y repetir aquí su predicado de borrado probaría una
-- copia del predicado, no el código que se despliega.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- PASO 1: RLS habilitado + FORCE, y una sola política, de SELECT
-- ---------------------------------------------------------------------------
do $$
declare r record; n integer;
begin
  select relrowsecurity, relforcerowsecurity into r
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = 'admin_intentos_login';
  if not r.relrowsecurity or not r.relforcerowsecurity then
    raise exception 'PASO 1 FALLÓ: admin_intentos_login sin RLS/FORCE (rls=%, force=%)',
      r.relrowsecurity, r.relforcerowsecurity;
  end if;
  select count(*) into n from pg_policies
   where tablename = 'admin_intentos_login' and cmd <> 'SELECT';
  if n <> 0 then
    raise exception 'PASO 1 FALLÓ: hay % política(s) de escritura; la tabla solo la escriben las funciones', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: privilegios de las dos funciones (CA-6)
--   Ojo: NO basta con revocar de `public`. Los default privileges de Supabase
--   (grant all on functions to postgres, anon, authenticated, service_role)
--   otorgan toda función nueva a `authenticated`. Este paso es exactamente el
--   que destapó ese fallo durante T-001.
-- ---------------------------------------------------------------------------
do $$
declare f text; oid_f oid;
begin
  foreach f in array array['admin_login_estado(text)',
                           'admin_login_registrar(text, boolean)'] loop
    oid_f := f::regprocedure::oid;
    if has_function_privilege('public', oid_f, 'EXECUTE') then
      raise exception 'PASO 2 FALLÓ: % es ejecutable por PUBLIC', f;
    end if;
    if has_function_privilege('authenticated', oid_f, 'EXECUTE') then
      raise exception 'PASO 2 FALLÓ: % es ejecutable por authenticated (default privileges de Supabase)', f;
    end if;
    if not has_function_privilege('anon', oid_f, 'EXECUTE') then
      raise exception 'PASO 2 FALLÓ: % NO es ejecutable por anon (el Worker la llama sin sesión)', f;
    end if;
    if not (select prosecdef from pg_proc where oid = oid_f) then
      raise exception 'PASO 2 FALLÓ: % no es SECURITY DEFINER', f;
    end if;
    if coalesce(array_to_string((select proconfig from pg_proc where oid = oid_f), ','), '')
       <> 'search_path=public' then
      raise exception 'PASO 2 FALLÓ: % sin search_path=public fijo', f;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3: ni anon ni authenticated pueden leer ni escribir la tabla (CA-6)
--   Se siembra una fila y se comprueba que ninguno de los dos roles la ve ni la
--   puede tocar. RLS es SILENCIOSO para UPDATE/DELETE (0 filas, sin error), así
--   que se mide por filas afectadas, no por excepción.
-- ---------------------------------------------------------------------------
insert into admin_intentos_login (email, intentos, bloqueado_hasta, ultimo_intento)
values ('sembrado@test.local', 3, null, now());

do $$
declare rol text; n bigint; bloqueado boolean;
begin
  foreach rol in array array['anon','authenticated'] loop
    execute format('set local role %I', rol);
    perform set_config('request.jwt.claim.sub', '', true);

    select count(*) into n from admin_intentos_login;
    if n <> 0 then
      raise exception 'PASO 3 FALLÓ: % ve % fila(s) de admin_intentos_login', rol, n;
    end if;

    update admin_intentos_login set intentos = 0 where email = 'sembrado@test.local';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'PASO 3 FALLÓ: % actualizó % fila(s)', rol, n; end if;

    delete from admin_intentos_login where email = 'sembrado@test.local';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'PASO 3 FALLÓ: % borró % fila(s)', rol, n; end if;

    reset role;

    -- INSERT sí lanza (WITH CHECK), en su propio bloque para no perder el rol
    begin
      execute format('set local role %I', rol);
      insert into admin_intentos_login (email) values ('inyectado@test.local');
      reset role;
      raise exception 'PASO 3 FALLÓ: % insertó directamente en admin_intentos_login', rol;
    exception when insufficient_privilege then
      reset role;
    end;
  end loop;

  -- La plataforma SÍ lee (única política, para soporte)
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', true);
  select count(*) into n from admin_intentos_login;
  reset role;
  if n = 0 then
    raise exception 'PASO 3 FALLÓ: el administrador de plataforma no puede leer la tabla (soporte)';
  end if;
end $$;

delete from admin_intentos_login where email = 'sembrado@test.local';

-- ---------------------------------------------------------------------------
-- PASO 4: tabla completa del retardo progresivo (CA-1, CA-3)
--   5→1, 6→2, 7→4, 8→8, 9→16, 10→32, 11→60 (techo). 1-4 sin bloqueo.
-- ---------------------------------------------------------------------------
do $$
declare
  esperado integer[] := array[0,0,0,0,1,2,4,8,16,32,60];
  i integer;
  v_min integer;
  v_int integer;
begin
  for i in 1..11 loop
    perform admin_login_registrar('retardo@test.local', false);
    select intentos,
           case when bloqueado_hasta is null then 0
                else round(extract(epoch from (bloqueado_hasta - now()))/60)::integer end
      into v_int, v_min
      from admin_intentos_login where email = 'retardo@test.local';

    if v_int <> i then
      raise exception 'PASO 4 FALLÓ: tras % fallo(s) intentos = % (se esperaba %)', i, v_int, i;
    end if;
    if v_min <> esperado[i] then
      raise exception 'PASO 4 FALLÓ: tras % fallo(s) la espera es % min (se esperaba %)',
        i, v_min, esperado[i];
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 5: con bloqueo vigente, admin_login_estado devuelve `bloqueado` (CA-1)
--   Incluido el caso clave: durante la espera NI SIQUIERA la contraseña
--   correcta entra, porque la ruta corta antes de llamar a GoTrue.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := admin_login_estado('retardo@test.local');
  if v->>'estado' <> 'bloqueado' then
    raise exception 'PASO 5 FALLÓ: con bloqueo vigente el estado es % (se esperaba bloqueado)', v;
  end if;
  if v->>'reintentar_en' is null then
    raise exception 'PASO 5 FALLÓ: el estado bloqueado no trae reintentar_en';
  end if;
  -- La normalización también aplica aquí
  if (admin_login_estado('  RETARDO@Test.Local ')->>'estado') <> 'bloqueado' then
    raise exception 'PASO 5 FALLÓ: la normalización no aplica en admin_login_estado';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 6: el bloqueo expira y el SIGUIENTE es mayor (CA-3)
--   Se mueve bloqueado_hasta al pasado en vez de esperar 60 minutos reales.
--   ultimo_intento se deja reciente para no disparar el olvido del paso 8.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb; v_min integer;
begin
  update admin_intentos_login
     set bloqueado_hasta = now() - interval '1 minute'
   where email = 'retardo@test.local';

  v := admin_login_estado('retardo@test.local');
  if v->>'estado' <> 'ok' then
    raise exception 'PASO 6 FALLÓ: con el bloqueo vencido el estado es % (se esperaba ok)', v;
  end if;

  -- Un fallo más: intentos 11 -> 12, y la espera sigue en el techo (60)
  perform admin_login_registrar('retardo@test.local', false);
  select round(extract(epoch from (bloqueado_hasta - now()))/60)::integer into v_min
    from admin_intentos_login where email = 'retardo@test.local';
  if v_min <> 60 then
    raise exception 'PASO 6 FALLÓ: tras reintentar la espera es % min (se esperaba el techo, 60)', v_min;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 7: un acierto reinicia el contador (CA-2)
--   Antes del umbral y con el bloqueo ya vencido, no durante la espera.
-- ---------------------------------------------------------------------------
do $$
declare v_int integer; v_bloq timestamptz;
begin
  perform admin_login_registrar('reinicio@test.local', false);
  perform admin_login_registrar('reinicio@test.local', false);
  perform admin_login_registrar('reinicio@test.local', false);   -- 3 < umbral 5
  select intentos into v_int from admin_intentos_login where email = 'reinicio@test.local';
  if v_int <> 3 then
    raise exception 'PASO 7 FALLÓ: se esperaban 3 intentos acumulados, hay %', v_int;
  end if;

  perform admin_login_registrar('reinicio@test.local', true);    -- acierto
  select intentos, bloqueado_hasta into v_int, v_bloq
    from admin_intentos_login where email = 'reinicio@test.local';
  if v_int <> 0 or v_bloq is not null then
    raise exception 'PASO 7 FALLÓ: tras el acierto intentos=% bloqueado_hasta=% (se esperaba 0 y NULL)',
      v_int, v_bloq;
  end if;

  -- Un acierto sobre un email sin fila no crea una fila
  perform admin_login_registrar('jamas-fallo@test.local', true);
  if exists (select 1 from admin_intentos_login where email = 'jamas-fallo@test.local') then
    raise exception 'PASO 7 FALLÓ: un login correcto creó una fila innecesaria';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 8: olvido tras 24 h sin actividad
--   Un administrador que falla suelto a lo largo de meses no debe acabar
--   bloqueado sin que haya ningún ataque.
-- ---------------------------------------------------------------------------
do $$
declare v_int integer;
begin
  update admin_intentos_login
     set intentos = 4, ultimo_intento = now() - interval '25 hours', bloqueado_hasta = null
   where email = 'reinicio@test.local';

  perform admin_login_registrar('reinicio@test.local', false);
  select intentos into v_int from admin_intentos_login where email = 'reinicio@test.local';
  if v_int <> 1 then
    raise exception 'PASO 8 FALLÓ: tras 25 h sin actividad el contador quedó en % (se esperaba 1)', v_int;
  end if;

  -- Dentro de la ventana NO se olvida
  update admin_intentos_login
     set intentos = 4, ultimo_intento = now() - interval '23 hours', bloqueado_hasta = null
   where email = 'reinicio@test.local';
  perform admin_login_registrar('reinicio@test.local', false);
  select intentos into v_int from admin_intentos_login where email = 'reinicio@test.local';
  if v_int <> 5 then
    raise exception 'PASO 8 FALLÓ: dentro de la ventana de olvido el contador quedó en % (se esperaba 5)', v_int;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 9: email nulo o vacío no crea fila (robustez)
-- ---------------------------------------------------------------------------
do $$
declare n bigint;
begin
  perform admin_login_registrar(null, false);
  perform admin_login_registrar('', false);
  perform admin_login_registrar('    ', false);
  select count(*) into n from admin_intentos_login where btrim(coalesce(email,'')) = '';
  if n <> 0 then
    raise exception 'PASO 9 FALLÓ: se crearon % fila(s) con email vacío (sería un DoS: todos los intentos sin email compartirían contador)', n;
  end if;
  if (admin_login_estado(null)->>'estado') <> 'ok'
     or (admin_login_estado('')->>'estado') <> 'ok' then
    raise exception 'PASO 9 FALLÓ: admin_login_estado no tolera email nulo/vacío';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 10 (CA-4, INNEGOCIABLE): no se pueden enumerar cuentas.
--   Un email REGISTRADO (existe en `perfiles`) y uno INEXISTENTE tienen que
--   producir exactamente la misma secuencia. Si el bloqueo solo aplicara a
--   emails reales, el propio 429 sería un oráculo para descubrir qué cuentas
--   existen en el sistema.
-- ---------------------------------------------------------------------------
do $$
declare
  v_real  constant text := 'ca4-registrado@test.local';
  v_falso constant text := 'ca4-inexistente@test.local';
  i integer;
  int_r integer; int_f integer;
  min_r integer; min_f integer;
  est_r text;   est_f text;
begin
  -- v_real existe de verdad en perfiles; v_falso no existe en ninguna parte
  insert into perfiles (id, nombre, email)
  values ('ca400000-0000-0000-0000-0000000000c4', 'CA4', v_real)
  on conflict (id) do nothing;

  if not exists (select 1 from perfiles where email = v_real) then
    raise exception 'PASO 10 FALLÓ: el email de control no quedó registrado en perfiles';
  end if;
  if exists (select 1 from perfiles where email = v_falso) then
    raise exception 'PASO 10 FALLÓ: el email inexistente sí existe en perfiles';
  end if;

  for i in 1..7 loop
    perform admin_login_registrar(v_real,  false);
    perform admin_login_registrar(v_falso, false);

    select intentos,
           case when bloqueado_hasta is null then -1
                else round(extract(epoch from (bloqueado_hasta - now()))/60)::integer end
      into int_r, min_r from admin_intentos_login where email = v_real;
    select intentos,
           case when bloqueado_hasta is null then -1
                else round(extract(epoch from (bloqueado_hasta - now()))/60)::integer end
      into int_f, min_f from admin_intentos_login where email = v_falso;

    est_r := admin_login_estado(v_real)->>'estado';
    est_f := admin_login_estado(v_falso)->>'estado';

    if int_r is distinct from int_f or min_r is distinct from min_f or est_r is distinct from est_f then
      raise exception 'PASO 10 FALLÓ (CA-4) en el intento %: registrado(intentos=%, espera=%, estado=%) vs inexistente(intentos=%, espera=%, estado=%) — el 429 sería un oráculo de enumeración de cuentas',
        i, int_r, min_r, est_r, int_f, min_f, est_f;
    end if;
  end loop;
end $$;

rollback;

\echo 'ADMIN-INTENTOS-LOGIN-AISLAMIENTO OK'
