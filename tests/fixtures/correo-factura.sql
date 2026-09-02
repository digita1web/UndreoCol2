-- =============================================================================
-- UndreoCol — Fixtures de notificaciones / correo de factura (006)
-- Referencia: specs/006-impresion-y-correo-factura/plan.md, tasks.md T-001
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql,
-- lecturas.sql y facturacion.sql aplicados antes. Reutiliza:
--   factura de A1  ff000000-...0a1 (cliente A, periodo A)
--   suscriptor A1  d0000000-...0a1
--   suscriptor B1  d0000000-...0b1 (facturado/sin factura según el fixture 005)
--
-- Da email a A1 (el fixture 003 lo dejó NULL a propósito) para que el envío del
-- correo (T-003) tenga destinatario, y deja una notificación de ejemplo de la
-- factura FAC-2026-00001 en estado enviada (rastro histórico para el test).
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/correo-factura.sql
-- =============================================================================

begin;

-- Email del suscriptor A1 (necesario para el envío por correo; el fixture 003
-- no lo definió).
update usuarios_servicio
   set email = 'suscriptor-a1@test.local'
 where id = 'd0000000-0000-0000-0000-0000000000a1';

-- Notificación de ejemplo: la factura FAC-2026-00001 ya fue enviada por correo
-- (estado enviada) — rastro histórico que el test usa para verificar lecturas.
insert into notificaciones (id, cliente_id, usuario_servicio_id, factura_id, tipo,
                            canal, destinatario, asunto, estado, intentos, enviada_en)
values ('99900000-0000-0000-0000-0000000000a1',
        'a0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-0000000000a1',
        'ff000000-0000-0000-0000-0000000000a1',
        'factura_generada', 'email', 'suscriptor-a1@test.local',
        'Factura FAC-2026-00001', 'enviada', 1, now());

commit;
