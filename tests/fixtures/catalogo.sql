-- =============================================================================
-- UndreoCol — Fixtures de catálogo y tarifas para tests de aislamiento
-- Referencia: specs/002-catalogo-y-tarifas/plan.md, tasks.md T-002
--
-- ⚠️ Los valores de cargo_fijo/precio_*_m3 de este archivo son de EJEMPLO,
-- elegidos solo para que los tests de aislamiento y concurrencia tengan algo
-- que comparar. NO son tarifas reales de ningún acueducto (D-5 sigue
-- pendiente: Mateo debe entregar las tarifas reales verificadas antes de
-- construir docs/CASOS-DORADOS.md). Nunca se copian estos valores allí.
--
-- Requiere tests/fixtures/fundacion.sql aplicado antes (reutiliza los
-- clientes A/B y las membresías admin_acueducto/lector de ese fixture).
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/catalogo.sql
-- =============================================================================

begin;

delete from tarifas;
delete from servicios;

-- -----------------------------------------------------------------------------
-- Servicios: Acueducto A tiene acueducto+alcantarillado, Acueducto B solo agua
-- -----------------------------------------------------------------------------
insert into servicios (id, cliente_id, codigo, nombre, tipo_calculo, orden) values
  ('f0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
   'acueducto', 'Acueducto', 'por_consumo', 1),
  ('f0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001',
   'alcantarillado', 'Alcantarillado', 'por_consumo', 2),
  ('f0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002',
   'acueducto', 'Acueducto', 'por_consumo', 1);

-- -----------------------------------------------------------------------------
-- Tarifas de ejemplo (⚠️ provisionales, D-5) — estrato 3, vigentes desde hace
-- 60 días, para que el test de concurrencia (PASO 5) tenga una tarifa previa
-- que cerrar.
-- -----------------------------------------------------------------------------
insert into tarifas (id, cliente_id, servicio_id, categoria, vigencia_desde,
                      cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3) values
  ('90000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-0000000000a1', 'estrato_3', current_date - 60,
   5000, 22, 1200, 2400),
  ('90000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-0000000000b1', 'estrato_3', current_date - 60,
   4500, 20, 1100, 2200);

commit;
