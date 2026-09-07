-- =============================================================================
-- UndreoCol — Test de aislamiento del fix C-1 de la auditoría de seguridad
-- pre-producción (docs/PLAN-PRODUCCION.md)
--
-- NUMERACIÓN: la serie 900+ queda reservada para las suites que NO pertenecen a
-- una feature del roadmap sino a una corrección de seguridad transversal. Las
-- suites 001-0NN siguen mapeando 1:1 con las features de `.specify/config.md`
-- (013 es exportes-contables, 014 rrhh-incapacidades), así que este test no
-- puede llevar un número de esa serie.
--
-- Cubre el hallazgo CRÍTICO: siguiente_numero_factura() es SECURITY DEFINER
-- (no pasa por RLS) y recibía un cliente_id DESNUDO, permitiendo a cualquier
-- sesión `authenticated` mutar el consecutivo de facturas de otro acueducto.
--
-- Requiere tests/fixtures/fundacion.sql (clientes A y B, perfiles a1/a2/b1/c1).
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/900_auditoria_consecutivo_factura_aislamiento.sql
--
-- Mecánica idéntica a las suites 001-012: `set local role` + el GUC que lee
-- auth.uid(), todo dentro de una transacción con rollback.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- PASO 1: un usuario authenticated SIN NINGUNA membresía (el caso del registro
--         público POST /auth/registro) NO puede tocar el consecutivo de A.
-- ---------------------------------------------------------------------------
do $$
declare
  v_antes  integer;
  v_despues integer;
  v_paso   boolean := false;
begin
  select consecutivo_factura into v_antes from configuracion
   where cliente_id = 'a0000000-0000-0000-0000-000000000001';

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
    perform siguiente_numero_factura('a0000000-0000-0000-0000-000000000001', 'FAC');
    reset role;
  exception when insufficient_privilege then
    reset role;
    v_paso := true;
  end;

  select consecutivo_factura into v_despues from configuracion
   where cliente_id = 'a0000000-0000-0000-0000-000000000001';

  if not v_paso then
    raise exception 'PASO 1 FALLÓ: un usuario sin membresía ejecutó siguiente_numero_factura sobre A';
  end if;
  if v_despues is distinct from v_antes then
    raise exception 'PASO 1 FALLÓ: el consecutivo de A cambió de % a %', v_antes, v_despues;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: el admin del acueducto A NO puede tocar el consecutivo del B
--         (cruce entre dos clientes reales de UndreoCol).
-- ---------------------------------------------------------------------------
do $$
declare
  v_antes   integer;
  v_despues integer;
  v_paso    boolean := false;
begin
  select consecutivo_factura into v_antes from configuracion
   where cliente_id = 'b0000000-0000-0000-0000-000000000002';

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true);
    perform siguiente_numero_factura('b0000000-0000-0000-0000-000000000002', 'FAC');
    reset role;
  exception when insufficient_privilege then
    reset role;
    v_paso := true;
  end;

  select consecutivo_factura into v_despues from configuracion
   where cliente_id = 'b0000000-0000-0000-0000-000000000002';

  if not v_paso then
    raise exception 'PASO 2 FALLÓ: el admin de A ejecutó siguiente_numero_factura sobre B';
  end if;
  if v_despues is distinct from v_antes then
    raise exception 'PASO 2 FALLÓ: el consecutivo de B cambió de % a %', v_antes, v_despues;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3: el LECTOR del acueducto A tampoco puede (no es admin de A).
-- ---------------------------------------------------------------------------
do $$
declare v_paso boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a2', true);
    perform siguiente_numero_factura('a0000000-0000-0000-0000-000000000001', 'FAC');
    reset role;
  exception when insufficient_privilege then
    reset role;
    v_paso := true;
  end;
  if not v_paso then
    raise exception 'PASO 3 FALLÓ: el lector de A generó un consecutivo de factura';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 4: NO se rompe el camino legítimo 1 — el admin del acueducto A SÍ puede
--         sobre SU PROPIO cliente (es el camino de reconectar(), 009).
-- ---------------------------------------------------------------------------
do $$
declare
  v_antes  integer;
  v_numero text;
begin
  select consecutivo_factura into v_antes from configuracion
   where cliente_id = 'a0000000-0000-0000-0000-000000000001';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true);
  v_numero := siguiente_numero_factura('a0000000-0000-0000-0000-000000000001', 'REC');
  reset role;

  if v_numero is null then
    raise exception 'PASO 4 FALLÓ: el admin de A no pudo generar el consecutivo de su propio acueducto';
  end if;
  if v_numero <> format('REC-%s-%s', extract(year from current_date)::integer,
                        lpad((v_antes + 1)::text, 5, '0')) then
    raise exception 'PASO 4 FALLÓ: formato/valor inesperado del número: %', v_numero;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 5: NO se rompe el camino legítimo 2 — service_role (la cola del cierre
--         de facturación) sigue generando el consecutivo. Sin JWT de usuario,
--         auth.uid() es NULL.
-- ---------------------------------------------------------------------------
do $$
declare v_numero text;
begin
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
  v_numero := siguiente_numero_factura('b0000000-0000-0000-0000-000000000002', 'FAC');
  reset role;
  if v_numero is null then
    raise exception 'PASO 5 FALLÓ: service_role no pudo generar el consecutivo (rompe el cierre de facturación)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 6: `anon` sigue sin EXECUTE (la clave anon es pública, D-10).
-- ---------------------------------------------------------------------------
do $$
declare v_paso boolean := false;
begin
  begin
    set local role anon;
    perform set_config('request.jwt.claim.sub', '', true);
    perform siguiente_numero_factura('a0000000-0000-0000-0000-000000000001', 'FAC');
    reset role;
  exception when insufficient_privilege then
    reset role;
    v_paso := true;
  end;
  if not v_paso then
    raise exception 'PASO 6 FALLÓ: anon puede ejecutar siguiente_numero_factura';
  end if;
end $$;

rollback;

\echo 'CONSECUTIVO-FACTURA-AISLAMIENTO OK'
