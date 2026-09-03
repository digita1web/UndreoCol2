-- =============================================================================
-- UndreoCol — Migración 006: Notificaciones (envío de factura por correo)
-- Referencia: specs/006-impresion-y-correo-factura/plan.md (aprobado 2026-09-06)
-- y spec.md.
--
-- Depende de 001 (RLS, funciones de seguridad), 003 (usuarios_servicio),
-- 004 (periodos) y 005 (facturas: pdf_url reservado; consumidor de la cola
-- undreocol-facturacion).
--
-- Alcance: enum estado_notificacion y la tabla notificaciones del esquema
-- propuesto (§13), acotada al evento 'factura_generada' (el resto de eventos
-- recordatorio/mora/pago es de la feature 010). El envío de la factura por
-- correo (D-8/D-9) registra aquí cada intento con su resultado, para que un
-- fallo NUNCA bloquee el flujo principal (CLAUDE.md §10 punto 20) y quede
-- trazable (intentos/ultimo_error) para el reintento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum de estado
-- -----------------------------------------------------------------------------

create type estado_notificacion as enum ('pendiente','enviada','fallida','cancelada');

-- -----------------------------------------------------------------------------
-- 2. Tabla de notificaciones
-- -----------------------------------------------------------------------------

create table notificaciones (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid references usuarios_servicio(id) on delete cascade,
  factura_id          uuid references facturas(id) on delete cascade,  -- evento de factura
  tipo                text not null default 'factura_generada',       -- recordatorio/mora/pago = 010
  canal               text not null default 'email',
  destinatario        text,
  asunto              text,
  estado              estado_notificacion not null default 'pendiente',
  intentos            smallint not null default 0,
  ultimo_error        text,
  enviada_en          timestamptz,
  created_at          timestamptz not null default now()
);

create index on notificaciones (cliente_id, estado);
create index on notificaciones (factura_id);

comment on table notificaciones is
  'Registro de envíos desacoplados (regla 20: un fallo nunca bloquea el flujo '
  'principal). En 006 solo se usa el evento factura_generada (correo del PDF, '
  'D-8/D-9); recordatorio/mora/pago llegan con la feature 010. Una fila por '
  'intento con estado/intentos/ultimo_error para trazabilidad y reintento.';

-- -----------------------------------------------------------------------------
-- 3. RLS FORCE + políticas (patrón 001-005)
--    Lectura para miembros del cliente; escritura solo admin_acueducto. El
--    worker de correo (consumidor de la cola) actualiza las filas con
--    service_role (BYPASSRLS) — las políticas son para el panel del admin.
-- -----------------------------------------------------------------------------

alter table notificaciones enable row level security;
alter table notificaciones force row level security;

create policy notificaciones_lectura on notificaciones for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy notificaciones_admin on notificaciones for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));


-- -----------------------------------------------------------------------------
-- 4. Corrección de trg_factura_inmutable (005) para 006: permitir el UPDATE del
--    campo pdf_url (metadata del adjunto, no un valor económico).
--    HALLAZGO REAL (T-004): al generar el PDF y guardar `facturas.pdf_url` la
--    función de 005 bloqueaba el update por considerarlo edición de una factura
--    emitida. pdf_url es metadata del PDF (no afecta totales/snapshot), así que
--    se permite el UPDATE que cambia SOLO pdf_url. También quedan excluidos de la
--    inmutabilidad total_pagado y estado (los maneja la feature 007: pagos y
--    derivación del estado pagada/vencida). La anulación se valida antes. Un
--    reset re-aplica todo en orden y esta versión reemplaza a la de 005.
-- -----------------------------------------------------------------------------

create or replace function bloquear_factura_inmutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Recálculo interno (total = suma de detalles) disparado por el trigger AFTER
  -- de factura_detalles: la GUC app.recalculo_interno la marca recalcular_total_factura
  -- (mismo mecanismo verificado en 005). Permite solo ese update interno.
  if current_setting('app.recalculo_interno', true) = 'on' then
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Una factura no se borra: se anula (estado = anulada) con motivo y responsable';
  end if;

  if tg_op = 'UPDATE' then
    -- anulación (corregir una factura mal emitida): motivo obligatorio
    if new.estado = 'anulada' and old.estado <> 'anulada' then
      if new.motivo_anulacion is null or new.motivo_anulacion = '' then
        raise exception 'Para anular una factura el motivo es obligatorio';
      end if;
      return new;
    end if;

    -- Se bloquea el cambio de valores económicos o de identidad. Las columnas
    -- mutables por flujo NO se incluyen: total_pagado/estado (007, pagos) y
    -- pdf_url (006, metadata del PDF adjunto).
    if (
      new.subtotal_servicios is distinct from old.subtotal_servicios
      or new.total is distinct from old.total
      or new.consumo_m3 is distinct from old.consumo_m3
      or new.recargo_mora is distinct from old.recargo_mora
      or new.saldo_anterior is distinct from old.saldo_anterior
      or new.numero is distinct from old.numero
      or new.snapshot_suscriptor is distinct from old.snapshot_suscriptor
      or new.fecha_emision is distinct from old.fecha_emision
    ) then
      raise exception 'Una factura emitida es inmutable: no se cambian sus valores; si está mal, se anula (solo pdf_url por 006 y total_pagado/estado por 007)';
    end if;
    return new;  -- solo cambió pdf_url, total_pagado y/o estado
  end if;

  -- INSERT (emisión del cierre): permitido.
  return new;
end $$;
