-- =============================================================================
-- UndreoCol — Migración 013: fix de seguridad CRÍTICO
-- Autorización dentro de siguiente_numero_factura() (auditoría pre-producción,
-- docs/PLAN-PRODUCCION.md)
--
-- HALLAZGO (verificado con explotación real contra el esquema completo):
--   siguiente_numero_factura(p_cliente_id, p_prefijo) es SECURITY DEFINER y
--   tiene `grant execute ... to authenticated` (005, línea 316), pero NO
--   comprueba ninguna autorización sobre p_cliente_id. Al ser SECURITY DEFINER
--   corre como su dueño y NO pasa por RLS, así que el parámetro es un
--   `cliente_id` DESNUDO: cualquier sesión `authenticated` — incluida una sin
--   ninguna membresía, creada por el registro público POST /auth/registro —
--   puede invocarla vía PostgREST contra el cliente_id de OTRO acueducto y
--   mutarle `configuracion.consecutivo_factura`.
--
--   El cliente_id de la víctima no es un secreto: portal_cliente_por_slug()
--   está otorgada a `anon` (008b) y lo devuelve a partir del slug público del
--   portal. Cadena completa reproducida: anon → cliente_id por slug →
--   usuario registrado sin membresía → consecutivo del acueducto B 1 → 4.
--
--   Impacto: saltos arbitrarios en la numeración de facturas de otro acueducto
--   (numeración consecutiva exigida por la contabilidad colombiana), agotamiento
--   del consecutivo de 5 dígitos, y bloqueo del cierre de facturación por el
--   `SELECT ... FOR UPDATE` sobre la fila de `configuracion` de la víctima.
--
-- POR QUÉ NO SE REVOCA A `authenticated`:
--   reconectar() (009, línea 165) es SECURITY INVOKER y llama a esta función;
--   el admin del acueducto necesita el EXECUTE para generar la factura de
--   reconexión. Revocar rompería la reconexión. La autorización va DENTRO.
--
-- REGLA APLICADA (la misma de 008/D-10): una función SECURITY DEFINER nunca
--   confía en un identificador desnudo; revalida quién llama contra ese
--   identificador.
--
-- CAMINOS LEGÍTIMOS QUE SIGUEN FUNCIONANDO:
--   1. service_role — el consumidor de la cola del cierre de facturación
--      (backend/src/queues/cierre-facturacion.ts:154, crearClienteServicio).
--      No lleva JWT de usuario: auth.uid() es NULL.
--   2. admin_acueducto / administrador de ESE cliente — vía reconectar().
--      es_admin_de() (001) cubre ambos roles.
--   `anon` y `public` siguen sin EXECUTE (revoke de 005, se re-afirma abajo).
--   Como authenticated exige un JWT con `sub`, auth.uid() IS NULL implica
--   service_role: no hay tercer camino de entrada.
--
-- El cuerpo del cálculo (puntos 9b/9c: SELECT FOR UPDATE, reinicio anual,
-- formato D-3) se conserva palabra por palabra. Lo único que cambia es la
-- guarda de autorización al principio.
-- =============================================================================

create or replace function siguiente_numero_factura(
  p_cliente_id uuid,
  p_prefijo text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_consecutivo integer;
  v_anio        integer;
  v_anio_actual integer := extract(year from current_date)::integer;
begin
  -- GUARDA DE AUTORIZACIÓN (fix de seguridad 013): p_cliente_id es un
  -- identificador que viene del llamante y esta función no pasa por RLS.
  -- auth.uid() IS NULL  → service_role (cron/cola), único camino sin JWT.
  -- auth.uid() NOT NULL → tiene que ser admin de ESE cliente.
  if auth.uid() is not null and not es_admin_de(p_cliente_id) then
    raise exception 'No autorizado: el consecutivo de facturas del cliente % no es suyo', p_cliente_id
      using errcode = '42501';
  end if;

  select consecutivo_factura, anio_consecutivo
    into v_consecutivo, v_anio
    from configuracion
   where cliente_id = p_cliente_id
   for update;
  if v_consecutivo is null then
    raise exception 'No existe configuración para el cliente %', p_cliente_id;
  end if;

  -- punto 9c: el consecutivo reinicia el 1 de enero
  if v_anio is distinct from v_anio_actual then
    v_consecutivo := 0;
    v_anio := v_anio_actual;
  end if;

  v_consecutivo := v_consecutivo + 1;
  update configuracion
     set consecutivo_factura = v_consecutivo,
         anio_consecutivo    = v_anio
   where cliente_id = p_cliente_id;

  return format('%s-%s-%s', p_prefijo, v_anio, lpad(v_consecutivo::text, 5, '0'));
end $$;

comment on function siguiente_numero_factura is
  'Genera el número de factura en transacción atómica (SELECT FOR UPDATE sobre '
  'configuracion, punto 9b). Formato D-3 {prefijo}-{YYYY}-{NNNNN}; consecutivo de '
  '5 dígitos que reinicia el 1 de enero (punto 9c). AUTORIZACIÓN (fix 013): al ser '
  'SECURITY DEFINER no pasa por RLS, así que valida p_cliente_id contra el llamante — '
  'service_role (cola del cierre, sin auth.uid()) o admin de ESE cliente vía '
  'reconectar(). Un authenticated ajeno recibe 42501.';

-- Se re-afirma el estado de privilegios esperado (idempotente; 005 ya lo dejó
-- así, esta migración lo vuelve explícito para que quede versionado junto al fix).
revoke execute on function siguiente_numero_factura(uuid, text) from anon, public;
grant  execute on function siguiente_numero_factura(uuid, text) to service_role;
grant  execute on function siguiente_numero_factura(uuid, text) to authenticated;
