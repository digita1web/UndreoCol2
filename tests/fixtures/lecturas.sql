-- =============================================================================
-- UndreoCol — Fixtures de periodos y lecturas para tests de aislamiento
-- Referencia: specs/004-lecturas-y-consumo/plan.md, tasks.md T-002
--
-- Requiere tests/fixtures/fundacion.sql, tests/fixtures/catalogo.sql y
-- tests/fixtures/suscriptores.sql aplicados antes (reutiliza los contadores
-- activos de A1/B1 ya creados allí).
--
-- Genera un periodo ABIERTO por acueducto (A y B). Acueducto A deja una lectura
-- de ejemplo en su periodo (para verificar aislamiento/visibilidad). Acueducto
-- B deja su periodo SIN lecturas: así el test de aislamiento puede probar que
-- un lector inserta la primera lectura de su cliente sin chocar con el unique
-- (contador_id, periodo_id).
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/lecturas.sql
-- =============================================================================

begin;

delete from lecturas;
delete from periodos;

-- -----------------------------------------------------------------------------
-- Periodos abiertos del mes actual para A y B (unique (cliente_id, anio, mes)).
-- -----------------------------------------------------------------------------
insert into periodos (id, cliente_id, nombre, anio, mes, fecha_inicio, fecha_fin,
                      fecha_vencimiento, estado)
values
  ('e0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
   to_char(current_date, 'TMMonth YYYY'), extract(year from current_date)::smallint,
   extract(month from current_date)::smallint, date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
   (date_trunc('month', current_date) + interval '1 month' + interval '1 month - 1 day')::date,
   'abierto'),
  ('e0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002',
   to_char(current_date, 'TMMonth YYYY'), extract(year from current_date)::smallint,
   extract(month from current_date)::smallint, date_trunc('month', current_date)::date,
   (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
   (date_trunc('month', current_date) + interval '1 month' + interval '1 month - 1 day')::date,
   'abierto');

-- -----------------------------------------------------------------------------
-- Lectura de ejemplo SOLO para A (primera lectura del contador A1:
-- lectura_anterior = lectura_inicial = 0; consumo 25 m³ sin rollover;
-- promedio_historico null → sin anomalía relativa; revision normal).
-- B queda sin lecturas (periodo abierto listo para que el lector B registre).
-- -----------------------------------------------------------------------------
insert into lecturas (id, cliente_id, contador_id, periodo_id, fecha_lectura,
                      lectura_anterior, lectura_actual, consumo_m3, hubo_rollover,
                      revision, promedio_historico, revisada, tomada_por)
values
  ('e1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000a1',
   current_date, 0, 25, 25, false, 'normal', null, false, 'a0000000-0000-0000-0000-0000000000a2');

commit;
