-- =============================================================================
-- UndreoCol — Migración 017 (T-001): límite de intentos del login administrativo
-- Referencia: specs/017-rate-limit-login-admin/spec.md y plan.md §2 (aprobados
-- 2026-09-07). Origen: hallazgo A-2 (ALTO) de la auditoría de seguridad
-- pre-producción, docs/PLAN-PRODUCCION.md.
--
-- QUÉ RESUELVE: `POST /auth/login` no tenía ninguna protección de fuerza bruta.
-- La única del sistema (portal_intentos_login, 008) cubre el portal del
-- suscriptor — la cuenta de MENOS valor. La cuenta `admin_acueducto` es el
-- control total del acueducto (tarifas, anulación de facturas, registro de
-- suscriptores con cédula y dirección, recaudo) y adivinar su contraseña no
-- tenía ningún costo. Agravante: el Worker intermedia ante GoTrue, así que
-- todas las peticiones salen de IPs de Cloudflare y ningún límite por IP del
-- lado de Supabase puede distinguir al atacante (spec §0.5).
--
-- DECISIONES APROBADAS POR MATEO (spec §0.3 y §0.4):
--   - Mecanismo: tabla en PostgreSQL, calcando portal_intentos_login (008).
--     Se descartó el binding de Rate Limiting de Cloudflare: efímero, por
--     centro de datos y no verificable en local (choca con CLAUDE.md §4).
--   - Bloqueo: RETARDO PROGRESIVO, no puerta fija. Con un techo constante,
--     quien conozca el correo del administrador lo mantiene fuera del panel
--     indefinidamente fallando adrede cada X minutos, a coste cero — y con un
--     solo admin eso es bloquearle la facturación del mes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Contador de intentos fallidos del login administrativo
-- -----------------------------------------------------------------------------

create table admin_intentos_login (
  email            text        primary key,   -- YA normalizado: lower(btrim(email))
  intentos         smallint    not null default 0,
  bloqueado_hasta  timestamptz,
  ultimo_intento   timestamptz not null default now()
);

comment on table admin_intentos_login is
  'Intentos fallidos consecutivos del login administrativo por email, con '
  'retardo progresivo (017, hallazgo A-2). Solo la escriben '
  'admin_login_estado()/admin_login_registrar(). Equivalente de '
  'portal_intentos_login (008) para la cuenta de administrador.';

-- Por qué NO lleva cliente_id (excepción a CLAUDE.md §5.4, aprobada en spec
-- §3.1): el login ocurre ANTES de resolver la membresía, así que no hay tenant
-- que registrar. Mismo criterio que _keepalive: es infraestructura de
-- autenticación, no una tabla de negocio.
comment on column admin_intentos_login.email is
  'Email normalizado a lower(btrim()). Clave natural: el login administrativo '
  'no conoce el cliente_id todavía (excepción a §5.4 aprobada en spec §3.1). '
  'SIN clave foránea a perfiles a propósito — ver el comentario de la tabla.';

-- REQUISITO DE CA-4, no un descuido: la tabla no tiene clave foránea a
-- `perfiles` ni a `auth.users`. Se cuentan los intentos contra emails que NO
-- existen exactamente igual que contra los que sí. Una FK haría imposible
-- registrar los primeros y convertiría el 429 en un oráculo para enumerar qué
-- cuentas existen en el sistema.

comment on column admin_intentos_login.intentos is
  'Fallos consecutivos. Se reinicia con un acierto o tras 24 h sin actividad. '
  'Tope de 999 para que no desborde el smallint con un ataque sostenido.';
comment on column admin_intentos_login.bloqueado_hasta is
  'Momento hasta el que se rechaza el login de este email. Durante la espera '
  'NI SIQUIERA la contraseña correcta entra: si un acierto pudiera saltarse el '
  'bloqueo, el bloqueo no protegería de nada — la fuerza bruta consiste '
  'precisamente en acertar (spec §0.4).';

alter table admin_intentos_login enable row level security;
alter table admin_intentos_login force row level security;

-- Única política, y solo de lectura para la plataforma (soporte). Sin políticas
-- de insert/update/delete para NINGÚN rol: la tabla la escriben exclusivamente
-- las funciones security definer de abajo. Mismo mecanismo que
-- portal_intentos_login. Un admin_acueducto no tiene por qué ver los intentos
-- fallidos de nadie.
create policy admin_intentos_login_plataforma on admin_intentos_login for select
  using (es_admin_plataforma());

-- -----------------------------------------------------------------------------
-- 2. admin_login_estado() — se llama ANTES de signInWithPassword. Solo lee.
-- -----------------------------------------------------------------------------

create or replace function admin_login_estado(p_email text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_hasta timestamptz;
begin
  -- Normalización defensiva: el Worker ya hace trim+lowercase, pero una función
  -- SECURITY DEFINER no se fía de lo que le llega (lección del hallazgo C-1).
  v_email := lower(btrim(coalesce(p_email, '')));

  -- Email vacío o nulo: no se bloquea nada. Un login sin email falla igual por
  -- credenciales, y crear una fila con clave vacía sería un DoS trivial: todos
  -- los intentos sin email compartirían el mismo contador.
  if v_email = '' then
    return jsonb_build_object('estado', 'ok');
  end if;

  select bloqueado_hasta into v_hasta
    from admin_intentos_login where email = v_email;

  if v_hasta is not null and v_hasta > now() then
    return jsonb_build_object('estado', 'bloqueado', 'reintentar_en', v_hasta);
  end if;

  return jsonb_build_object('estado', 'ok');
end $$;

comment on function admin_login_estado is
  '¿Está bloqueado el login de este email? Se llama ANTES de golpear GoTrue: si '
  'devuelve bloqueado, la ruta responde 429 y no gasta el intento. Devuelve '
  '{estado: ok} o {estado: bloqueado, reintentar_en}. No revela si el email '
  'existe (CA-4): un email no registrado se cuenta igual que uno registrado.';

-- -----------------------------------------------------------------------------
-- 3. admin_login_registrar() — se llama DESPUÉS, con el resultado real
-- -----------------------------------------------------------------------------
--
-- RETARDO PROGRESIVO (spec §0.4, plan §2):
--   umbral 5 · base 1 min · techo 60 min · olvido 24 h
--   espera = min(base * 2^(intentos − umbral), techo)
--
--   fallos    1-4    5     6     7     8      9      10     11+
--   espera     —   1 min  2 min 4 min 8 min 16 min 32 min  60 min (techo)
--
-- El atacante paga un costo que crece exponencialmente; el administrador
-- legítimo, que sabe su contraseña, entra al primer intento tras esperar.

create or replace function admin_login_registrar(p_email text, p_exito boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  -- Constantes globales, no por acueducto: el tenant es desconocido aquí
  -- (spec §3.6). Van en la migración y no en una tabla de configuración
  -- (plan §5.3): quedan versionadas y auditables en el diff, y ajustarlas es
  -- raro. Coste asumido: cambiarlas exige migración y despliegue.
  c_umbral   constant integer := 5;
  c_base_min constant integer := 1;
  c_techo_min constant integer := 60;
  c_olvido_horas constant integer := 24;
  -- Tope del exponente: evita el desbordamiento de power() en un ataque
  -- sostenido. 2^16 = 65536 minutos, muy por encima del techo, así que no
  -- cambia ningún valor observable.
  c_exp_max  constant integer := 16;

  v_email    text;
  v_fila     admin_intentos_login%rowtype;
  v_intentos integer;
  v_espera   integer;
begin
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' then
    return;   -- mismo criterio que admin_login_estado
  end if;

  -- Acierto: reinicia el contador. Si no había fila, no hay nada que reiniciar
  -- (no se crea una fila por un login correcto).
  if p_exito then
    update admin_intentos_login
       set intentos = 0, bloqueado_hasta = null, ultimo_intento = now()
     where email = v_email;
    return;
  end if;

  -- Fallo. Se asegura la fila primero para que el FOR UPDATE de abajo siempre
  -- encuentre algo; `on conflict do nothing` hace que dos intentos simultáneos
  -- no se pisen.
  insert into admin_intentos_login (email, intentos, ultimo_intento)
  values (v_email, 0, now())
  on conflict (email) do nothing;

  select * into v_fila from admin_intentos_login
   where email = v_email
   for update;

  -- Olvido: sin actividad reciente, el contador arranca de cero. Evita que un
  -- administrador acumule fallos sueltos a lo largo de meses y acabe bloqueado
  -- sin que haya ningún ataque.
  v_intentos := case
    when v_fila.ultimo_intento < now() - (c_olvido_horas * interval '1 hour') then 0
    else v_fila.intentos
  end;
  v_intentos := least(v_intentos + 1, 999);

  if v_intentos >= c_umbral then
    v_espera := least(
      c_base_min * (2 ^ least(v_intentos - c_umbral, c_exp_max))::integer,
      c_techo_min
    );
    update admin_intentos_login
       set intentos = v_intentos,
           ultimo_intento = now(),
           bloqueado_hasta = now() + (v_espera * interval '1 minute')
     where email = v_email;
  else
    update admin_intentos_login
       set intentos = v_intentos,
           ultimo_intento = now(),
           bloqueado_hasta = null
     where email = v_email;
  end if;
end $$;

comment on function admin_login_registrar is
  'Registra el resultado de un intento de login administrativo. Acierto: '
  'reinicia el contador. Fallo: lo incrementa y, a partir del umbral (5), fija '
  'un bloqueo con retardo progresivo (1,2,4,8,16,32,60 min, techo 60). El '
  'contador se olvida tras 24 h sin actividad. Cuenta los emails inexistentes '
  'igual que los registrados (CA-4). El cálculo vive aquí y no en core/ porque '
  'debe ser atómico con el incremento del contador (plan §5.1).';

-- -----------------------------------------------------------------------------
-- 4. Privilegios
-- -----------------------------------------------------------------------------
-- El Worker llama estas funciones SIN sesión (el login precede a la sesión),
-- con la clave anon, igual que las del portal (D-10).
--
-- Hay que revocar de DOS sitios, no de uno:
--   1. `public` — PostgreSQL da EXECUTE a PUBLIC por defecto en toda función
--      nueva. Es el revoke que ya hacían 008 y 008b.
--   2. `authenticated` — Supabase tiene configurado
--      `alter default privileges in schema public grant all on functions to
--      postgres, anon, authenticated, service_role`, así que una función nueva
--      nace otorgada a `authenticated` aunque nadie la otorgue explícitamente.
--      Revocar de `public` NO la quita. Verificado sobre la base real: sin este
--      segundo revoke, `has_function_privilege('authenticated', …)` devuelve
--      `true`.
--
-- No hay ningún caso de uso desde una sesión ya iniciada: quien llama estas
-- funciones es el Worker antes de que exista la sesión. `service_role` conserva
-- el EXECUTE por convención de Supabase (bypasea RLS de todos modos y solo lo
-- usan los Workers de cron); no se le quita para no romper un script de soporte
-- futuro.
--
-- NOTA para una tarea posterior de endurecimiento (fuera del alcance de 017):
-- las 6 funciones del portal (008/008b) tienen exactamente el mismo EXECUTE
-- heredado por `authenticated`, porque en su día solo se revocó de `public`.
-- No es explotable —revalidan credenciales completas y no aceptan un id
-- desnudo— pero conviene alinearlas.

revoke all on function admin_login_estado(text) from public, authenticated;
grant  execute on function admin_login_estado(text) to anon;

revoke all on function admin_login_registrar(text, boolean) from public, authenticated;
grant  execute on function admin_login_registrar(text, boolean) to anon;
