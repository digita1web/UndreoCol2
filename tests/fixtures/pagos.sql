-- =============================================================================
-- UndreoCol — Fixtures de pagos (007)
-- Referencia: specs/007-pagos-y-cartera/plan.md §8 y tasks.md T-002
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql,
-- lecturas.sql, facturacion.sql y correo-factura.sql aplicados antes.
--
-- REGLA (aprendida en la sesión de 005): el fixture de una feature NO muta el
-- estado que los tests de aislamiento previos asumen (el aislamiento 005
-- espera UNA factura del cliente A). Por eso este fixture NO crea facturas
-- nuevas: solo registra pagos sobre la factura de ciclo FAC-2026-00001
-- (ff000000-...0a1, total 38.600) que dejó el fixture de 005.
--
-- Estado que deja (cliente A, suscriptor A1 d0000000-...0a1):
--   1) ABONO PARCIAL de 10.000 (pago d1000000-...0a1) sobre FAC-2026-00001 →
--      factura pendiente con saldo 28.600 (para probar completar el pago).
--   2) Pago a favor de 2.000 sin aplicar (d1000000-...0a2) → saldo a favor de
--      A1 (regla 14: el sobrante no se pierde; visible en la cartera).
--
-- La factura VENCIDA (para la cartera de CA-6) NO va aquí: la crea la
-- verificación de integración (T-004) para no ensuciar el estado de 001-006.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/pagos.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Abono parcial de 10.000 sobre la factura de ciclo (queda pendiente)
-- -----------------------------------------------------------------------------
insert into pagos (id, cliente_id, usuario_servicio_id, valor, fecha_pago, metodo,
                   referencia, recibido_por, observaciones)
values ('d1000000-0000-0000-0000-0000000000a1',
        'a0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-0000000000a1',
        10000, current_date - 5, 'efectivo', null,
        'a0000000-0000-0000-0000-0000000000a1', 'Abono parcial del fixture 007');

insert into pago_aplicaciones (cliente_id, pago_id, factura_id, valor)
values ('a0000000-0000-0000-0000-000000000001',
        'd1000000-0000-0000-0000-0000000000a1',
        'ff000000-0000-0000-0000-0000000000a1', 10000);

update facturas set total_pagado = 10000
 where id = 'ff000000-0000-0000-0000-0000000000a1';

-- -----------------------------------------------------------------------------
-- 2. Pago a favor (sin aplicar, 100% remanente): saldo a favor de A1
-- -----------------------------------------------------------------------------
insert into pagos (id, cliente_id, usuario_servicio_id, valor, fecha_pago, metodo,
                   referencia, recibido_por, observaciones)
values ('d1000000-0000-0000-0000-0000000000a2',
        'a0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-0000000000a1',
        2000, current_date, 'efectivo', null,
        'a0000000-0000-0000-0000-0000000000a1', 'Pago a favor (anticipo) del fixture 007');

commit;
