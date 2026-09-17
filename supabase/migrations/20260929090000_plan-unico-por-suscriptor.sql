-- =============================================================================
-- UndreoCol — Migración: plan-unico-por-suscriptor
-- Referencia: decisión directa de Mateo en conversación (Sesión 057) — sin
-- niveles Básico/Pro, un único modelo: se cobra por cada suscriptor del
-- acueducto, $2.000 COP/suscriptor/mes hoy, valor modificable (inflación).
--
-- Corrige un hallazgo real de producción: PATCH /plataforma/acueductos/:id
-- fallaba con 400 al asignarle un plan a un acueducto nuevo — la tabla
-- `planes` (creada por 20260831150000_fundacion-tenancy.sql) nunca tuvo
-- filas reales en producción; "Básico"/"Pro" solo existían en
-- tests/fixtures/fundacion.sql, un fixture de datos de prueba local, jamás
-- migrado a producción.
--
-- limite_usuarios = null ("ilimitado", según el propio comentario de la
-- columna) porque este modelo no tiene techo de suscriptores por nivel — el
-- cobro ya escala solo con la cantidad real. valor_minimo_mes = 0: no se
-- pidió un mínimo, y el propio Mateo lo describe como "modificable ya que
-- todo sube" — se deja en el valor más simple, sin inventar un piso que
-- nadie pidió.
-- =============================================================================

insert into planes (id, nombre, limite_usuarios, valor_suscriptor, valor_minimo_mes) values
  ('20000000-0000-0000-0000-000000000001', 'Estándar', null, 2000.00, 0);
