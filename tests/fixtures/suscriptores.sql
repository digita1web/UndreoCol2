-- =============================================================================
-- UndreoCol — Fixtures de suscriptores y contadores para tests de aislamiento
-- Referencia: specs/003-suscriptores-contadores/plan.md, tasks.md T-002
--
-- Requiere tests/fixtures/fundacion.sql aplicado antes (reutiliza y completa
-- los usuarios_servicio A1/A2/B1 ya creados ahí — no los recrea, los
-- actualiza con las columnas nuevas de 003).
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/suscriptores.sql
-- =============================================================================

begin;

delete from reemplazos_contador;
delete from contadores;

-- -----------------------------------------------------------------------------
-- Completa los datos de los usuarios_servicio del fixture de la fundación
-- -----------------------------------------------------------------------------
update usuarios_servicio set
  tipo_documento = 'CC', numero_documento = '1000000001', telefono = '3000000001',
  direccion = 'Calle 1 # 1-01', sector = 'Centro', categoria = 'estrato_3'
where id = 'd0000000-0000-0000-0000-0000000000a1';

update usuarios_servicio set
  tipo_documento = 'CC', numero_documento = '1000000002', telefono = '3000000002',
  direccion = 'Calle 2 # 2-02', sector = 'Centro', categoria = 'estrato_2'
where id = 'd0000000-0000-0000-0000-0000000000a2';

update usuarios_servicio set
  tipo_documento = 'CC', numero_documento = '2000000001', telefono = '3100000001',
  direccion = 'Carrera 1 # 1-01', sector = 'Centro', categoria = 'estrato_3'
where id = 'd0000000-0000-0000-0000-0000000000b1';

-- -----------------------------------------------------------------------------
-- Contador activo para A1 y B1. A2 se deja SIN contador a propósito (cubre el
-- caso de alta de suscriptor sin contador instalado todavía, spec.md §5).
-- -----------------------------------------------------------------------------
insert into contadores (id, cliente_id, usuario_servicio_id, serial, capacidad_maxima,
                         lectura_inicial, fecha_instalacion, estado) values
  ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-0000000000a1', 'SERIAL-A1', 99999, 0, current_date - 365, 'activo'),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-0000000000b1', 'SERIAL-B1', 99999, 0, current_date - 365, 'activo');

update usuarios_servicio set contador_actual_id = 'c0000000-0000-0000-0000-0000000000a1'
  where id = 'd0000000-0000-0000-0000-0000000000a1';
update usuarios_servicio set contador_actual_id = 'c0000000-0000-0000-0000-0000000000b1'
  where id = 'd0000000-0000-0000-0000-0000000000b1';

commit;
