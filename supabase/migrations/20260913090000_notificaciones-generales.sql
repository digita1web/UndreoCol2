-- =============================================================================
-- UndreoCol — Migración 010: Notificaciones generales (catálogo cerrado + aviso
-- de vencimiento)
-- Referencia: specs/010-notificaciones/plan.md (aprobado 2026-09-05) y spec.md.
--
-- Depende de 006 (tabla notificaciones + estado_notificacion, ya creadas —
-- diseñadas anticipando esta feature: "recordatorio/mora/pago = 010") y 001
-- (tabla configuracion, mismo patrón que dias_umbral_corte/porcentaje_mora).
--
-- Alcance: (1) cierra el catálogo de `notificaciones.tipo` con un CHECK — hoy
-- es texto libre sin restricción, solo se usa 'factura_generada' (006); (2)
-- agrega `configuracion.dias_aviso_vencimiento` para el recordatorio de
-- vencimiento (spec §3.5). Sin tabla nueva, sin cola nueva (plan.md §5).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo cerrado de tipos de notificación (spec §3.1)
-- -----------------------------------------------------------------------------
-- CHECK sobre el `text` existente, no un enum (plan.md §5, decisión técnica):
-- agregar un valor a un enum vía ALTER TYPE ... ADD VALUE no siempre puede
-- ejecutarse dentro de la misma transacción que lo usa; un CHECK se reemplaza
-- con DROP/ADD CONSTRAINT en una migración normal el día que aparezca un
-- séptimo tipo.

alter table notificaciones
  add constraint notificaciones_tipo_valido check (
    tipo in (
      'factura_generada',        -- 006, sin cambios
      'recordatorio_vencimiento',
      'aviso_mora',
      'confirmacion_pago',
      'corte_ejecutado',
      'reconexion_completada'
    )
  );

comment on constraint notificaciones_tipo_valido on notificaciones is
  'Catálogo cerrado (010): factura_generada (006) + los 5 tipos de 010. '
  'Agregar un tipo nuevo el día de mañana es un DROP/ADD CONSTRAINT, no una '
  'migración de datos.';

-- -----------------------------------------------------------------------------
-- 2. Umbral configurable del recordatorio de vencimiento (spec §3.5)
-- -----------------------------------------------------------------------------
-- Mismo patrón que dias_umbral_corte (009) / porcentaje_mora (001): ajustable
-- por acueducto, no un valor global fijo. Default aprobado por Mateo: 3 días.

alter table configuracion
  add column dias_aviso_vencimiento integer not null default 3;

comment on column configuracion.dias_aviso_vencimiento is
  'Días antes de fecha_vencimiento en que se genera el recordatorio (010). '
  'El aviso de mora no usa este campo: se dispara el primer día que la '
  'factura queda vencida, sin configuración adicional.';
