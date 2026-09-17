-- =============================================================================
-- UndreoCol — Migración: endurecer-lecturas-inserta-sector
-- Referencia: hallazgo de security-review (Sesión 057, CHANGELOG.md)
--
-- 037 (20260927090000_rutas-zonas-lector.sql) le agregó el filtro de sector a
-- lecturas_lectura (SELECT) pero nunca tocó lecturas_inserta (INSERT,
-- 20260904090000_lecturas-consumo.sql) — un lector restringido a un sector
-- podía insertar una lectura para un contador de OTRO sector llamando
-- POST /lecturas directo (contadores_lectura tampoco filtra por sector, así
-- que el lookup previo en crearLectura() no lo bloqueaba). CLAUDE.md §10
-- punto 24 exige "el lector solo crea/ve lecturas... asignadas a él" — la
-- mitad de "ve" ya estaba cerrada, esta migración cierra la mitad de "crea",
-- con el mismo patrón (mis_contadores_por_sector(), ya definida en 037) que
-- ya usa lecturas_lectura. No hace falta investigación externa: es el mismo
-- guard ya establecido en el propio archivo de 037, aplicado a la política
-- que quedó afuera (excepción de proporcionalidad, CLAUDE.md §3).
-- =============================================================================

drop policy lecturas_inserta on lecturas;
create policy lecturas_inserta on lecturas for insert
  with check (
    es_admin_de(cliente_id)
    or (
      tiene_rol(cliente_id, array['lector']::rol_usuario[])
      and (
        not exists (select 1 from mis_sectores_asignados(cliente_id))
        or contador_id in (select contador_id from mis_contadores_por_sector(cliente_id))
      )
    )
  );
