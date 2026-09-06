-- =============================================================================
-- UndreoCol — Fixture 011-dashboard (specs/011-dashboard/, plan §8, D-6)
--
-- Datos deterministas para CA-1…CA-6 del dashboard. Reglas de diseño:
--  * Fechas de PAGOS relativas a current_date (D-6): el eje de 12 meses depende
--    de "hoy"; fechas fijas envejecerían fuera del eje. Los periodos cerrados
--    del consumo promedio usan anio fijo 2099 (máximo posible) para no
--    colisionar con datos reales ni depender de la fecha de corrida.
--  * Insertado como owner (postgres, BYPASSRLS) — patrón de los fixtures 001-010.
--  * NO es idempotente: aplicar una vez sobre una base recién reseteada
--    (o sobre la base local persistente que no tenga aún estos códigos DASH-*).
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Suscriptores de prueba (A: los 4 estados; B: uno activo)
-- ---------------------------------------------------------------------------

insert into usuarios_servicio (id, cliente_id, codigo_suscriptor, nombre, estado) values
  ('a0000000-0000-0000-0000-00000000d001', 'a0000000-0000-0000-0000-000000000001', 'DASH-A-ACT',  'Suscriptor DASH A activo',    'activo'),
  ('a0000000-0000-0000-0000-00000000d002', 'a0000000-0000-0000-0000-000000000001', 'DASH-A-SUS',  'Suscriptor DASH A suspendido', 'suspendido'),
  ('a0000000-0000-0000-0000-00000000d003', 'a0000000-0000-0000-0000-000000000001', 'DASH-A-CORT', 'Suscriptor DASH A cortado',    'cortado'),
  ('a0000000-0000-0000-0000-00000000d004', 'a0000000-0000-0000-0000-000000000001', 'DASH-A-INA',  'Suscriptor DASH A inactivo',   'inactivo'),
  ('b0000000-0000-0000-0000-00000000d001', 'b0000000-0000-0000-0000-000000000002', 'DASH-B-ACT',  'Suscriptor DASH B activo',     'activo');

-- ---------------------------------------------------------------------------
-- 2. Pagos de A y B con fechas relativas (CA-1/CA-4/CA-6)
--    Las aplicaciones quedan vacías a propósito: el recaudo KPI suma pagos
--    vigentes por fecha_pago (no depende de pago_aplicaciones); el remanente
--    queda como saldo a favor del suscriptor (regla 14), que no afecta la
--    cartera pendiente/vencida (solo se deriva de facturas con saldo).
-- ---------------------------------------------------------------------------

insert into pagos (cliente_id, usuario_servicio_id, valor, fecha_pago, metodo, referencia, anulado) values
  -- mes en curso: 2 vigentes (CA-1)…
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 300000,
   current_date, 'efectivo', 'DASH-CA1-MES-1', false),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 50000,
   date_trunc('month', current_date)::date, 'efectivo', 'DASH-CA1-MES-2', false),
  -- …1 anulado en el mes (excluido)…
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 9999999,
   current_date, 'transferencia', 'DASH-CA1-ANULADO', true),
  -- mes anterior: tendencia, NO recaudo del mes (CA-1/CA-4)…
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 120000,
   (date_trunc('month', current_date) - interval '1 day')::date, 'efectivo', 'DASH-CA4-MES-ANTERIOR', false),
  -- bucket más antiguo del eje (CA-4)…
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 80000,
   (date_trunc('month', current_date) - interval '11 months')::date, 'consignacion', 'DASH-CA4-EJE-INICIO', false),
  -- fuera del eje (no debe aparecer en la tendencia; la consulta lo acota)…
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 999999,
   (date_trunc('month', current_date) + interval '1 month')::date, 'consignacion', 'DASH-CA4-FUERA-EJE', false),
  -- B: no debe contaminar ningún indicador de A (CA-6)…
  ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000d001', 700000,
   current_date, 'efectivo', 'DASH-B-MES', false);

-- ---------------------------------------------------------------------------
-- 3. Facturas con saldo de A para cartera (CA-2): una vencida, una por vencer,
--    y una vencida de un suscriptor `cortado` (cuenta como moroso: la mora la
--    define la deuda, no el estado del servicio — spec §3.3).
-- ---------------------------------------------------------------------------

insert into facturas
  (cliente_id, usuario_servicio_id, tipo, numero, snapshot_suscriptor, consumo_m3,
   subtotal_servicios, total, fecha_emision, fecha_vencimiento, estado)
values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'ciclo',
   'DASH-2026-VENC', '{"nombre":"Suscriptor DASH A activo","categoria":"1","codigo":"DASH-A-ACT","estado":"activo"}'::jsonb,
   0, 200000, 200000, current_date - 40, current_date - 10, 'pendiente'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001', 'ciclo',
   'DASH-2026-PEND', '{"nombre":"Suscriptor DASH A activo","categoria":"1","codigo":"DASH-A-ACT","estado":"activo"}'::jsonb,
   0, 150000, 150000, current_date - 5, current_date + 10, 'pendiente'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d003', 'ciclo',
   'DASH-2026-VENC2', '{"nombre":"Suscriptor DASH A cortado","categoria":"1","codigo":"DASH-A-CORT","estado":"cortado"}'::jsonb,
   0, 90000, 90000, current_date - 60, current_date - 30, 'pendiente');


-- ---------------------------------------------------------------------------
-- 4. Periodos cerrados (anio fijo 2099) y facturas de consumo para CA-3.
--    El "último periodo cerrado" es el de mayor (anio, mes): 2099-02.
--    Consumos planos: 2099-01 → 10 y 30; 2099-02 → 20 y 40, más una anulada de
--    100 que debe quedar EXCLUIDA del promedio → promedio esperado (20+40)/2 = 30.
-- ---------------------------------------------------------------------------

insert into periodos
  (id, cliente_id, nombre, anio, mes, fecha_inicio, fecha_fin, fecha_vencimiento,
   estado, fecha_cierre, cerrado_por)
values
  ('a0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-000000000001', 'DASH 2099-01',
   2099, 1, '2099-01-01', '2099-01-31', '2099-02-15', 'cerrado',
   now(), 'a0000000-0000-0000-0000-0000000000a1'),
  ('a0000000-0000-0000-0000-00000000e002', 'a0000000-0000-0000-0000-000000000001', 'DASH 2099-02',
   2099, 2, '2099-02-01', '2099-02-28', '2099-03-15', 'cerrado',
   now(), 'a0000000-0000-0000-0000-0000000000a1');

insert into facturas
  (cliente_id, usuario_servicio_id, periodo_id, tipo, numero, snapshot_suscriptor, consumo_m3,
   subtotal_servicios, total, fecha_emision, fecha_vencimiento, estado)
values
  -- 2099-01 (no es el último cerrado; garantiza que el código elige 2099-02)
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001',
   'a0000000-0000-0000-0000-00000000e001', 'ciclo', 'DASH-2099-01-A',
   '{"nombre":"Suscriptor DASH A activo","categoria":"1","codigo":"DASH-A-ACT","estado":"activo"}'::jsonb,
   10, 0, 0, '2099-01-31', '2099-02-15', 'pendiente'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d002',
   'a0000000-0000-0000-0000-00000000e001', 'ciclo', 'DASH-2099-01-B',
   '{"nombre":"Suscriptor DASH A suspendido","categoria":"1","codigo":"DASH-A-SUS","estado":"suspendido"}'::jsonb,
   30, 0, 0, '2099-01-31', '2099-02-15', 'pendiente'),
  -- 2099-02: último cerrado → promedio esperado 30
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d001',
   'a0000000-0000-0000-0000-00000000e002', 'ciclo', 'DASH-2099-02-A',
   '{"nombre":"Suscriptor DASH A activo","categoria":"1","codigo":"DASH-A-ACT","estado":"activo"}'::jsonb,
   20, 0, 0, '2099-02-28', '2099-03-15', 'pendiente'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d002',
   'a0000000-0000-0000-0000-00000000e002', 'ciclo', 'DASH-2099-02-B',
   '{"nombre":"Suscriptor DASH A suspendido","categoria":"1","codigo":"DASH-A-SUS","estado":"suspendido"}'::jsonb,
   40, 0, 0, '2099-02-28', '2099-03-15', 'pendiente'),
  -- anulada (consumo 100) → no entra al promedio; se inserta normal y se anula
  -- por la vía del trigger (motivo + responsable).
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000d004',
   'a0000000-0000-0000-0000-00000000e002', 'ciclo', 'DASH-2099-02-ANUL',
   '{"nombre":"Suscriptor DASH A inactivo","categoria":"1","codigo":"DASH-A-INA","estado":"inactivo"}'::jsonb,
   100, 0, 0, '2099-02-28', '2099-03-15', 'pendiente');

update facturas
   set estado = 'anulada', motivo_anulacion = 'fixture dashboard: debe quedar excluida del promedio',
       anulada_por = 'a0000000-0000-0000-0000-0000000000a1'
 where numero = 'DASH-2099-02-ANUL' and cliente_id = 'a0000000-0000-0000-0000-000000000001';

