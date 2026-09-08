-- =============================================================================
-- UndreoCol — Endurecimiento de privilegios de funciones SECURITY DEFINER
-- Origen: auditoría de seguridad pre-producción (docs/PLAN-PRODUCCION.md).
-- Cierra el hallazgo B-3 y la observación abierta en 017 T-001.
--
-- Son dos correcciones distintas del MISMO patrón: una función SECURITY DEFINER
-- no pasa por RLS, así que quién puede ejecutarla y qué comprueba sobre sus
-- parámetros es toda la protección que hay.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Las 6 funciones del portal: quitar el EXECUTE heredado por `authenticated`
-- -----------------------------------------------------------------------------
-- HALLAZGO (observado durante 017 T-001 y verificado sobre la base real): las
-- migraciones 008 y 008b hacen `revoke all ... from public` antes de otorgar a
-- `anon`, pero eso NO quita el EXECUTE que `authenticated` recibe solo: Supabase
-- tiene configurado
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
-- así que toda función nueva nace otorgada a `authenticated` aunque nadie la
-- otorgue. Comprobado: has_function_privilege('authenticated', …) devolvía
-- `true` en las seis.
--
-- NO ES EXPLOTABLE hoy —cada una revalida numero_documento + codigo_suscriptor
-- reales y ninguna acepta un usuario_servicio_id desnudo; los 12 ataques
-- cruzados de la auditoría fallaron todos—, pero es superficie que nadie usa:
-- quien llama estas funciones es el Worker con la clave anon, ANTES de que
-- exista una sesión de Supabase Auth. Un usuario `authenticated` no tiene
-- ningún motivo para invocarlas.
--
-- Se corrige por el mismo criterio que se aplicó en 017 T-001 al crear
-- admin_login_estado/admin_login_registrar: revocar de `public` Y de
-- `authenticated`, y otorgar solo a `anon`.

revoke all on function portal_validar_credenciales(uuid, text, text)   from public, authenticated;
revoke all on function portal_facturas_suscriptor(uuid, text, text)    from public, authenticated;
revoke all on function portal_factura_completa(uuid, text, text, uuid) from public, authenticated;
revoke all on function portal_saldo_favor_suscriptor(uuid, text, text) from public, authenticated;
revoke all on function portal_consumo_suscriptor(uuid, text, text)     from public, authenticated;
revoke all on function portal_cliente_por_slug(text)                   from public, authenticated;

grant execute on function portal_validar_credenciales(uuid, text, text)   to anon;
grant execute on function portal_facturas_suscriptor(uuid, text, text)    to anon;
grant execute on function portal_factura_completa(uuid, text, text, uuid) to anon;
grant execute on function portal_saldo_favor_suscriptor(uuid, text, text) to anon;
grant execute on function portal_consumo_suscriptor(uuid, text, text)     to anon;
grant execute on function portal_cliente_por_slug(text)                   to anon;

-- -----------------------------------------------------------------------------
-- 2. tarifa_vigente(): acotar al acueducto del llamante (hallazgo B-3)
-- -----------------------------------------------------------------------------
-- HALLAZGO (verificado): tarifa_vigente() es SECURITY DEFINER, está otorgada a
-- `authenticated` y su propio comentario dice que "no filtra por cliente_id del
-- llamante a propósito ... la protección multi-tenant es responsabilidad del
-- llamante". Resultado medido en la auditoría: un usuario autenticado SIN
-- ninguna membresía obtiene el `tarifa_id` vigente de otro acueducto pasando un
-- servicio_id ajeno, aunque RLS le impida leer la fila (0 filas legibles).
--
-- Severidad real BAJA —solo se filtra un UUID, la tarifa sigue protegida por
-- RLS, y hace falta adivinar un servicio_id de 128 bits—, pero el patrón "la
-- protección es responsabilidad del llamante" es exactamente el que causó el
-- hallazgo CRÍTICO C-1. Se cierra por consistencia: ninguna función SECURITY
-- DEFINER de este esquema vuelve a confiar en un identificador desnudo.
--
-- QUIÉNES LA LLAMAN (verificado en el código, para no romper nada):
--   queues/cierre-facturacion.ts   -> service_role (sin JWT, auth.uid() NULL)
--   lib/facturacion.ts             -> JWT del usuario (simulación de periodo)
--   lib/importacion-suscriptores.ts-> JWT del usuario (importación masiva)
-- La comprobación es de PERTENENCIA AL ACUEDUCTO, no de rol: un `lector` puede
-- llegar aquí por la simulación de periodo, y bloquearlo por rol rompería esa
-- ruta sin ganar nada — el límite que importa es el del acueducto.

create or replace function tarifa_vigente(
  p_servicio_id uuid,
  p_categoria   categoria_tarifaria,
  p_fecha       date default current_date
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_tarifa_id  uuid;
begin
  -- GUARDA DE AUTORIZACIÓN (fix B-3). auth.uid() IS NULL => service_role, el
  -- único camino sin JWT (anon no tiene EXECUTE). Con JWT, el servicio tiene
  -- que pertenecer a un acueducto del que el usuario sea miembro.
  if auth.uid() is not null then
    select cliente_id into v_cliente_id from servicios where id = p_servicio_id;
    -- Servicio inexistente: se devuelve NULL como siempre, sin revelar nada.
    if v_cliente_id is null then
      return null;
    end if;
    if not (es_admin_plataforma() or v_cliente_id in (select mis_clientes())) then
      raise exception 'No autorizado: el servicio % no pertenece a su acueducto', p_servicio_id
        using errcode = '42501';
    end if;
  end if;

  select id into v_tarifa_id
    from tarifas
   where servicio_id    = p_servicio_id
     and categoria      = p_categoria
     and vigencia_desde <= p_fecha
     and (vigencia_hasta is null or vigencia_hasta >= p_fecha)
   order by vigencia_desde desc
   limit 1;

  return v_tarifa_id;
end $$;

comment on function tarifa_vigente is
  'Devuelve el id de la tarifa vigente para un servicio+categoría en una fecha. '
  'El cierre de facturación la llama con la fecha de ejecución del cierre. '
  'Si devuelve NULL, el cierre marca al suscriptor como sin tarifa configurada, '
  'registra la anomalía y no emite la factura. AUTORIZACIÓN (fix B-3): al ser '
  'SECURITY DEFINER no pasa por RLS, así que comprueba que el servicio pertenece '
  'a un acueducto del llamante — service_role (sin auth.uid()) pasa siempre. La '
  'comprobación es de pertenencia al acueducto, no de rol: el lector llega aquí '
  'por la simulación de periodo.';

-- Se re-afirma el estado de privilegios y se quita también el heredado por
-- `authenticated`… salvo que aquí `authenticated` SÍ lo necesita (la simulación
-- de periodo y la importación la llaman con el JWT del usuario). Lo que se
-- quita es `public`, y la protección real es la guarda de arriba.
revoke all on function tarifa_vigente(uuid, categoria_tarifaria, date) from public, anon;
grant  execute on function tarifa_vigente(uuid, categoria_tarifaria, date) to authenticated, service_role;
