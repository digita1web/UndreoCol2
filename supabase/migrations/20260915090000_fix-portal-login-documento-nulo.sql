-- =============================================================================
-- UndreoCol — Migración: fix del hallazgo B-2 de la auditoría pre-producción
-- (docs/PLAN-PRODUCCION.md)
--
-- HALLAZGO (verificado): portal_validar_credenciales() con p_numero_documento
-- NULL no devuelve {"estado":"invalido"}; revienta con una violación de NOT NULL
-- al intentar insertar la fila del contador en portal_intentos_login:
--
--   ERROR: null value in column "numero_documento" of relation
--          "portal_intentos_login" violates not-null constraint
--   DETAIL: Failing row contains (…, a0000000-…, null, 1, null, …)
--
-- El DETAIL filtra nombres de tabla y de columnas al que llame.
--
-- ALCANCE REAL DEL RIESGO: no es alcanzable a través del Worker —
-- POST /portal/:slug/login exige numero_documento y codigo_suscriptor no vacíos
-- antes de llamar (backend/src/index.ts). Pero la función está otorgada a `anon`
-- y la propia migración 008 documenta que "la clave anon es pública y cualquiera
-- podría invocarlas directamente" (D-10). Bajo ese modelo de amenaza —el que el
-- propio proyecto adoptó— la entrada NULL es alcanzable. De ahí el fix.
--
-- CRITERIO: una credencial ausente es una credencial inválida. Se trata igual
-- que cualquier otra credencial que no corresponde, y por la misma razón que
-- CA-1/CA-9 de 008: NUNCA se revela cuál campo falló.
--
-- NO se cuenta el intento contra portal_intentos_login cuando el documento es
-- NULL o vacío: la tabla lleva el contador POR documento, y sin documento no hay
-- nada contra lo que contar. Contarlo obligaría a inventar una clave sintética
-- y a crear filas basura que nadie purga todavía (hallazgo M-6). Esto no abre un
-- hueco de fuerza bruta: sin documento no se puede acertar ninguna credencial,
-- porque la comparación con usuarios_servicio.numero_documento nunca da cierto.
--
-- El resto del cuerpo se conserva palabra por palabra respecto de 008.
-- =============================================================================

create or replace function portal_validar_credenciales(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_umbral  smallint;
  v_minutos integer;
  v_intento portal_intentos_login%rowtype;
  v_usuario usuarios_servicio%rowtype;
begin
  -- FIX B-2: entrada ausente = credencial inválida, con el MISMO cuerpo de
  -- respuesta que cualquier otra credencial incorrecta (no revela qué faltó).
  -- Va antes de todo: sin cliente_id no hay a qué acueducto preguntarle, y sin
  -- documento no hay clave para el contador de intentos.
  if p_cliente_id is null
     or p_numero_documento is null or btrim(p_numero_documento) = ''
     or p_codigo_suscriptor is null or btrim(p_codigo_suscriptor) = '' then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select portal_umbral_intentos_login, portal_bloqueo_minutos
    into v_umbral, v_minutos
    from configuracion where cliente_id = p_cliente_id;
  if v_umbral is null then
    v_umbral := 8;
    v_minutos := 15;
  end if;

  select * into v_intento from portal_intentos_login
   where cliente_id = p_cliente_id and numero_documento = p_numero_documento
   for update;

  if v_intento.bloqueado_hasta is not null and v_intento.bloqueado_hasta > now() then
    return jsonb_build_object('estado', 'bloqueado', 'reintentar_en', v_intento.bloqueado_hasta);
  end if;

  select * into v_usuario from usuarios_servicio
   where cliente_id = p_cliente_id
     and numero_documento = p_numero_documento
     and codigo_suscriptor = p_codigo_suscriptor;

  if v_usuario.id is null then
    -- Credenciales incorrectas: sube el contador (nunca revela cuál campo falló).
    if v_intento.id is null then
      insert into portal_intentos_login (cliente_id, numero_documento, intentos, ultimo_intento)
      values (p_cliente_id, p_numero_documento, 1, now());
    else
      update portal_intentos_login
         set intentos = intentos + 1,
             ultimo_intento = now(),
             bloqueado_hasta = case when intentos + 1 >= v_umbral
                                     then now() + (v_minutos * interval '1 minute')
                                     else bloqueado_hasta end
       where id = v_intento.id;
    end if;
    return jsonb_build_object('estado', 'invalido');
  end if;

  -- Credenciales correctas: reinicia el contador (aunque el estado sea inactivo).
  if v_intento.id is not null then
    update portal_intentos_login
       set intentos = 0, bloqueado_hasta = null, ultimo_intento = now()
     where id = v_intento.id;
  end if;

  if v_usuario.estado = 'inactivo' then
    return jsonb_build_object('estado', 'inactivo');
  end if;

  return jsonb_build_object('estado', 'ok', 'usuario_servicio_id', v_usuario.id);
end $$;

comment on function portal_validar_credenciales is
  'Login del portal (D-2/D-10): valida numero_documento+codigo_suscriptor '
  'dentro del cliente_id ya resuelto por el slug. Nunca revela cuál campo '
  'falló. Aplica el umbral de fuerza bruta de configuracion (CA-9). Devuelve '
  '{estado: ok|invalido|inactivo|bloqueado, ...}. Fix B-2 (auditoría '
  'pre-producción): una entrada NULL o vacía devuelve "invalido" como cualquier '
  'otra credencial incorrecta, en vez de reventar con una violación de NOT NULL '
  'que filtraba nombres de tabla y columnas.';

-- Los privilegios de 008 no cambian; se re-afirman para que queden versionados
-- junto a esta redefinición (create or replace no los altera, pero dejarlo
-- explícito evita depender de ese detalle).
revoke all on function portal_validar_credenciales(uuid, text, text) from public;
grant  execute on function portal_validar_credenciales(uuid, text, text) to anon;
