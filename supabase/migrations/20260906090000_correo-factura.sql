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
