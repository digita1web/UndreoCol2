-- =============================================================================
-- UndreoCol — Fixtures de importación de suscriptores (012)
-- Referencia: specs/012-importacion-suscriptores-excel/plan.md §8 y tasks.md T-003
--
-- No-op intencional, mismo criterio que 009/tests/fixtures/cortes.sql: 001-009
-- ya dejan clientes/suscriptores/membresías suficientes. Los lotes de prueba
-- que 012 necesita se arman inline dentro de cada transacción del test de
-- aislamiento (jsonb literal, no requieren filas previas), con ROLLBACK.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/importacion.sql
-- =============================================================================

select 1; -- no-op intencional, ver nota arriba
