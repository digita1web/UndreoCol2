-- =============================================================================
-- UndreoCol — Fixtures de facturación para tests de aislamiento
-- Referencia: specs/005-facturacion/plan.md, tasks.md T-002
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql y
-- lecturas.sql aplicados antes. Reutiliza:
--   cliente A a0000000-...0001 (admin a1, lector a2), B b0000000-...0002
--   A1 d0000000-...0a1 (categoria estrato_3, tarifa vigente en catalogo, con
--     lectura consumo 25 en el periodo), A2 d0000000-...0a2 (categoria
--     estrato_2 → SIN tarifa configurada: caso regla 9d), B1 d0000000-...0b1
--   periodo A e0000000-...0a1 (con la lectura de A1), periodo B e0000000-...0b1
--
-- IMPORTANTE: NO se cierra el periodo A aquí. El test de aislamiento 004 asume
-- el periodo A ABIERTO (PASO 4: un segundo periodo abierto debe violar
-- uq_periodo_abierto); cerrarlo en este fixture rompería la regresión de 004.
-- La factura de ejemplo se deja en el periodo A abierto (estado válido: se emite
-- y el cierre del periodo es la acción final del flujo de facturación).
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/facturacion.sql
-- =============================================================================

begin;

-- Factura de ciclo de A1 en el periodo A (ejemplo; D-5: tarifas
-- provisionales). Consumo de A1 en ese periodo = 25 m³ (lectura del fixture 004).
insert into facturas (id, cliente_id, usuario_servicio_id, periodo_id, tipo, numero,
                      snapshot_suscriptor, consumo_m3, subtotal_servicios, recargo_mora,
                      saldo_anterior, total, fecha_emision, fecha_vencimiento)
values ('ff000000-0000-0000-0000-0000000000a1',
        'a0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-0000000000a1',
        'e0000000-0000-0000-0000-0000000000a1',
        'ciclo', 'FAC-2026-00001',
        '{"nombre":"Suscriptor A1","direccion":"Calle 1 # 1-01","categoria":"estrato_3","codigo_suscriptor":"SUS-A1","estado":"activo"}',
        25, 10000, 0, 0, 10000, '2026-09-02', '2026-10-02');

-- Renglón de acueducto (el trigger recalcula subtotal/total desde los detalles).
insert into factura_detalles (cliente_id, factura_id, servicio_id, tarifa_id, orden,
                              descripcion, tipo_calculo, consumo_m3, cargo_fijo,
                              consumo_basico_m3, valor_basico, consumo_no_basico_m3,
                              valor_no_basico, subtotal)
values ('a0000000-0000-0000-0000-000000000001',
        'ff000000-0000-0000-0000-0000000000a1',
        'f0000000-0000-0000-0000-0000000000a1',
        '90000000-0000-0000-0000-0000000000a1',
        1, 'Acueducto', 'por_consumo', 25, 5000, 22, 26400, 3, 7200, 38600);

commit;

