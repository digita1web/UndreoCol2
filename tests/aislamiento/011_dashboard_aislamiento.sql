-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de 011-dashboard (specs/011-dashboard/)
-- Referencia: spec CA-6 y plan.md §8; patrón de las suites 001-010.
--
-- Cubre CA-6: las consultas de indicadores (pagos, cartera/facturas, periodo
-- cerrado + consumo, conteos por estado) corren bajo RLS y solo ven el acueducto
-- de la sesión; las filas del cliente B no alteran ningún agregado de A. Incluye
-- permiso por rol (el lector de A lee pero no inserta pagos).
--
-- Requiere aplicados los fixtures de las features previas (001-010) y el de esta
-- feature (tests/fixtures/dashboard.sql) — sus filas "DASH-*" (referencias de
-- pagos, números de factura, periodo 2099) se usan como marcadores de visibilidad
-- y no dependen de cuántos datos de prueba previos tenga la base.
--
-- Mecanismo (mismo que 001-010): cada escenario abre una transacción, simula la
-- sesión con `set local role authenticated` + `request.jwt.claim.sub` y hace
-- rollback. Contra Supabase local real.
--
-- Debe terminar con 'DASHBOARD-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/011_dashboard_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: el admin de A ve los marcadores de A y NINGUNA fila del cliente B
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
  s numeric;
begin
  -- Marcadores propios de A visibles
  select count(*) into n from pagos where referencia = 'DASH-CA1-MES-1';
  if n <> 1 then raise exception 'PASO 1 FALLÓ: admin A no ve su pago DASH-CA1-MES-1 (%)', n; end if;

  select count(*) into n from facturas where numero = 'DASH-2026-VENC';
  if n <> 1 then raise exception 'PASO 1 FALLÓ: admin A no ve su factura DASH-2026-VENC (%)', n; end if;

  select count(*) into n from periodos where anio = 2099 and cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'PASO 1 FALLÓ: admin A no ve sus 2 periodos 2099 (%)', n; end if;

  select count(*) into n from usuarios_servicio where codigo_suscriptor like 'DASH-A-%';
  if n <> 4 then raise exception 'PASO 1 FALLÓ: admin A no ve sus 4 suscriptores DASH (%)', n; end if;

  -- Nada del cliente B puede verse desde A
  select count(*) into n from pagos where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 1 FALLÓ: admin A ve % pagos del cliente B', n; end if;
  select count(*) into n from pagos where referencia = 'DASH-B-MES';
  if n <> 0 then raise exception 'PASO 1 FALLÓ: admin A ve el pago de B DASH-B-MES'; end if;
  select count(*) into n from facturas where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 1 FALLÓ: admin A ve % facturas del cliente B', n; end if;
  select count(*) into n from periodos where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 1 FALLÓ: admin A ve % periodos del cliente B', n; end if;
  select count(*) into n from usuarios_servicio where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 1 FALLÓ: admin A ve % suscriptores del cliente B', n; end if;

  -- El agregado de recaudo de A (mismo filtro que lib/dashboard.ts) incluye sus
  -- marcadores del mes (300000 + 50000 = 350000) y el pago de B (700000, mismo
  -- mes) es INVISIBLE para A: si se filtrara mal, la suma visible de DASH-B-MES
  -- no sería 0.
  select coalesce(sum(valor), 0) into s from pagos
    where anulado = false and referencia in ('DASH-CA1-MES-1', 'DASH-CA1-MES-2');
  if s <> 350000 then raise exception 'PASO 1 FALLÓ: suma visible de marcadores de A = % (esperaba 350000)', s; end if;

  select coalesce(sum(valor), 0) into s from pagos where referencia = 'DASH-B-MES';
  if s <> 0 then raise exception 'PASO 1 FALLÓ: el pago de B es visible para A (%)', s; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 2: el admin de B ve los marcadores de B y ninguno de A (relación inversa)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
do $$
declare
  n integer;
begin
  select count(*) into n from pagos where referencia = 'DASH-B-MES';
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin B no ve su pago DASH-B-MES (%)', n; end if;
  select count(*) into n from usuarios_servicio where codigo_suscriptor = 'DASH-B-ACT';
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin B no ve su suscriptor DASH-B-ACT (%)', n; end if;

  select count(*) into n from pagos where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin B ve % pagos del cliente A', n; end if;
  select count(*) into n from facturas where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin B ve % facturas del cliente A', n; end if;
  select count(*) into n from periodos where anio = 2099;
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin B ve periodos 2099 de A'; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: un agregado de A no cambia cuando existen filas de B (CA-6): con la
-- sesión de A, el promedio de consumo del último periodo cerrado (2099-02) es
-- exactamente 30, calculado SOLO con facturas de A (20 y 40; la anulada no
-- cuenta) — si una factura de B (o de otro cliente) entrara, el número cambiaría.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  p uuid;
  s numeric;
  n integer;
begin
  select id into p from periodos
    where cliente_id = 'a0000000-0000-0000-0000-000000000001'
      and estado = 'cerrado'
    order by anio desc, mes desc
    limit 1;
  if p is null then raise exception 'PASO 3 FALLÓ: admin A no resuelve su último periodo cerrado'; end if;

  select round(avg(consumo_m3), 1) into s from facturas
    where cliente_id = 'a0000000-0000-0000-0000-000000000001'
      and periodo_id = p and tipo = 'ciclo' and estado <> 'anulada';
  if s <> 30.0 then raise exception 'PASO 3 FALLÓ: promedio de consumo A = % (esperaba 30)', s; end if;

  -- Suscriptores en mora (deuda vencida) de A: sus 2 marcadores DASH
  select count(*) into n from facturas
    where cliente_id = 'a0000000-0000-0000-0000-000000000001'
      and estado <> 'anulada' and total - total_pagado > 0
      and fecha_vencimiento < current_date
      and numero like 'DASH-%';
  if n <> 2 then raise exception 'PASO 3 FALLÓ: morosos DASH visibles por A = % (esperaba 2)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: el lector de A LEE (pagos/cartera de su cliente) pero NO inserta
-- (regresión de permisos de rol; spec §0.4: el control admin-only del endpoint
-- es de aplicación, la RLS sigue siendo la red de seguridad de fondo)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
declare
  n integer;
begin
  select count(*) into n from pagos where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n < 1 then raise exception 'PASO 4 FALLÓ: lector de A no lee los pagos de su cliente'; end if;

  begin
    insert into pagos (cliente_id, usuario_servicio_id, valor)
    values ('a0000000-0000-0000-0000-000000000001',
            (select id from usuarios_servicio where cliente_id = 'a0000000-0000-0000-0000-000000000001' and codigo_suscriptor = 'DASH-A-ACT'),
            1000);
    raise exception 'PASO 4 FALLÓ: el lector de A insertó un pago';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: cierre con mensaje de éxito
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'DASHBOARD-AISLAMIENTO OK';
end $$;

