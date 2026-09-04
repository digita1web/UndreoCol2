-- =============================================================================
-- UndreoCol — Fixtures del portal del suscriptor (008)
-- Referencia: specs/008-portal-suscriptor/plan.md §8 y tasks.md T-002
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql,
-- lecturas.sql, facturacion.sql, correo-factura.sql y pagos.sql aplicados.
--
-- REGLA (aprendida en las sesiones de 005/007): el fixture de una feature NO
-- muta el estado que los tests de aislamiento previos asumen (el aislamiento
-- 003 espera 1 contador del cliente A y el 004 espera 1 periodo y 1 lectura;
-- el 005 espera 1 factura y el 007 espera 2 pagos). Por eso este fixture NO
-- agrega contadores/periodos/lecturas/facturas/pagos: el historial de DOS
-- contadores que usa CA-7 (portal_consumo_suscriptor) lo crea el aislamiento
-- 008 dentro de una transacción con ROLLBACK (y la verificación de T-004 antes
-- del curl), sin ensuciar el estado que heredan los aislamientos 001-007.
--
-- Este fixture SOLO deja las filas de portal_intentos_login (tabla nueva de
-- 008, sin política de lectura para anon) que el aislamiento 008 y la
-- verificación de T-004 necesitan para probar los bordes del bloqueo por
-- fuerza bruta (CA-9) sin repetir 8 intentos fallidos en cada corrida:
--   1) '1000000001' (A1) con bloqueo VIGENTE  → login rechazado aunque la
--      credencial sea correcta.
--   2) '1000000002' (A2) con bloqueo VENCIDO  → se permite reintentar (y un
--      acierto resetea el contador).
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/portal.sql
-- =============================================================================

begin;

insert into portal_intentos_login (cliente_id, numero_documento, intentos, bloqueado_hasta, ultimo_intento)
values ('a0000000-0000-0000-0000-000000000001', '1000000001', 8, now() + interval '5 minutes', now());

insert into portal_intentos_login (cliente_id, numero_documento, intentos, bloqueado_hasta, ultimo_intento)
values ('a0000000-0000-0000-0000-000000000001', '1000000002', 8, now() - interval '5 minutes', now());

commit;
