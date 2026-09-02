-- =============================================================================
-- UndreoCol — Migración 005: Facturación
-- Referencia: specs/005-facturacion/plan.md (aprobado 2026-09-05) y spec.md
--
-- Depende de 001 (clientes, perfiles, RLS, set_updated_at(), es_admin_de(),
-- mis_clientes(), es_admin_plataforma(), tienen_rol()/tiene_rol()), 002
-- (servicios/tarifas/tarifa_vigente(), enums categoria_tarifaria/tipo_calculo),
-- 003 (usuarios_servicio, contadores) y 004 (periodos, lecturas).
--
-- Alcance: enums tipo_factura/estado_factura y tablas facturas/
-- factura_detalles/factura_lecturas (docs/esquema-propuesto.sql §9); único
-- parcial uq_factura_ciclo (una factura ciclo por suscriptor+periodo); unique
-- (cliente_id, numero); check total_pagado <= total; triggers de integridad
-- (ESTRATEGIA-CALIDAD §2):
--   - trg_factura_periodo_cerrado: no emitir/modificar una factura de un
--     periodo cerrado (salvo anulacion) — misma idea que el trigger de 004 sobre
--     lecturas.
--   - trg_factura_subtotal_total: recalcula subtotal_servicios y total a partir
--     de factura_detalles tras insert/update/delete de renglones (nunca se
--     confia el dinero a la API/consulta ad-hoc; el cálculo primario de los
--     renglones vive en core/facturacion.ts, este trigger es la invariante).
-- RLS FORCE + politicas (lectura para miembros del cliente, escritura solo
-- admin_acueducto). pdf_url lo puebla la feature 006 (no aqui).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

create type tipo_factura as enum ('ciclo','reconexion','ajuste');
create type estado_factura as enum ('pendiente','pagada','vencida','anulada');

-- -----------------------------------------------------------------------------
-- 2. Facturas
-- -----------------------------------------------------------------------------

create table facturas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  periodo_id          uuid references periodos(id) on delete restrict, -- null en reconexion/ajuste fuera de ciclo
  tipo                tipo_factura not null default 'ciclo',
  numero              text not null,                -- {prefijo}-{YYYY}-{NNNNN} (D-3)
  snapshot_suscriptor jsonb not null,               -- nombre, dirección, categoría, código, estado (punto 13)
  consumo_m3          numeric(12,2) not null default 0,
  subtotal_servicios  numeric(12,2) not null default 0,
  recargo_mora        numeric(12,2) not null default 0,
  saldo_anterior      numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0,
  total_pagado        numeric(12,2) not null default 0,   -- lo maneja la feature 007
  fecha_emision       date not null default current_date,
  fecha_vencimiento   date not null,
  estado              estado_factura not null default 'pendiente',
  motivo_anulacion    text,
  anulada_por         uuid references perfiles(id),
  pdf_url             text,                          -- lo puebla la feature 006
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (cliente_id, numero),
  constraint chk_total_pagado check (total_pagado <= total)
);

create unique index uq_factura_ciclo
  on facturas (usuario_servicio_id, periodo_id) where tipo = 'ciclo';

create index on facturas (cliente_id, estado);
create index on facturas (usuario_servicio_id, fecha_emision desc);

create trigger trg_facturas_updated before update on facturas
  for each row execute function set_updated_at();

comment on table facturas is
  'Una sola factura ciclo por suscriptor+periodo (uq_factura_ciclo). Emitida es '
  'inmutable: la API no edita valores; la anulacion pone estado=anulada con motivo/'
  'responsable. recargo_mora = porcentaje_mora% sobre el saldo vencido del MISMO '
  'suscriptor EXCLUYENDO esta factura (CLAUDE.md §10 punto 11). total = '
  'subtotal_servicios + recargo_mora + saldo_anterior (ESPECIFICACION §2.9). '
  'snapshot_suscriptor es inmutable al emitir (punto 13).';

comment on column facturas.numero is
  'Formato D-3: {prefijo}-{YYYY}-{NNNNN}, consecutivo de 5 digitos que reinicia '
  'el 1 de enero (punto 9c). Ciclo y reconexion comparten el consecutivo anual '
  'con prefijos distintos (configuracion.prefijo_factura / prefijo_reconexion).';

-- -----------------------------------------------------------------------------
-- 3. Detalles y lecturas de la factura
-- -----------------------------------------------------------------------------

create table factura_detalles (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references clientes(id) on delete cascade,
  factura_id           uuid not null references facturas(id) on delete cascade,
  servicio_id          uuid references servicios(id) on delete set null, -- referencia permanente
  tarifa_id            uuid references tarifas(id) on delete set null,   -- referencia permanente
  orden                smallint not null default 0,
  descripcion          text not null,
  tipo_calculo         tipo_calculo not null,
  consumo_m3           numeric(12,2) not null default 0,
  cargo_fijo           numeric(12,2) not null default 0,
  consumo_basico_m3    numeric(12,2) not null default 0,
  valor_basico         numeric(12,2) not null default 0,
  consumo_no_basico_m3 numeric(12,2) not null default 0,
  valor_no_basico      numeric(12,2) not null default 0,
  subtotal             numeric(12,2) not null default 0
);

create index on factura_detalles (factura_id, orden);

comment on table factura_detalles is
  'Desglose auditable por servicio (cada servicio activo genera su renglon sobre '
  'el MISMO consumo_m3; CLAUDE.md §10 punto 10). Guarda cantidades y valores por '
  'bloque basico/no-basico para reproducir el calculo anios despues. servicio_id/'
  'tarifa_id son referencias permanentes (ON DELETE SET NULL nunca se borran sus '
  'datos historicos).';

create table factura_lecturas (
  factura_id uuid not null references facturas(id) on delete cascade,
  lectura_id uuid not null references lecturas(id) on delete restrict,
  cliente_id uuid not null references clientes(id) on delete cascade,
  primary key (factura_id, lectura_id)
);

comment on table factura_lecturas is
  'Cuales lecturas consumió esta factura. Una factura ciclo puede consumir UNA o '
  'DOS lecturas (contador reemplazado a mitad de periodo, feature 004).';

-- -----------------------------------------------------------------------------
-- 4. Triggers de integridad (ESTRATEGIA-CALIDAD §2)
-- -----------------------------------------------------------------------------

-- 4.1 No emitir ni modificar facturas de un periodo cerrado, salvo la anulacion.
-- 4.1 Inmutabilidad de la factura emitida (ESTRATEGIA-CALIDAD §2).
--     El cierre de facturación (005) emite facturas de un periodo que 004 YA cerró
--     (spec 004 §3.1: "005 usa el estado cerrado para disparar el cálculo"). Por
--     eso el INSERT (emisión) SIEMPRE se permite; la doble emisión la previene
--     uq_factura_ciclo. La invariante real es: una factura emitida es INMUTABLE.
--     - UPDATE: solo se permite anular (estado -> 'anulada' con motivo/responsable)
--       o el avance de total_pagado/estado que hará la feature 007 (pagos). Cualquier
--       cambio de valores (subtotal/total/consumo/numero/snapshot/fechas) se rechaza.
--     - DELETE: siempre bloqueado (el dinero no se borra, se anula).
--     SECURITY DEFINER acotado: solo lee el estado del periodo si hace falta.
create function bloquear_factura_inmutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Recálculo interno (total = suma de detalles) disparado por el trigger AFTER
  -- sobre factura_detalles: se permite (no es una edición ad-hoc de la API).
  if current_setting('app.recalculo_interno', true) = 'on' then
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Una factura no se borra: se anula (estado = anulada) con motivo y responsable';
  end if;

  if tg_op = 'UPDATE' then
    -- anulación (corregir una factura mal emitida)
    if new.estado = 'anulada' and old.estado <> 'anulada' then
      if new.motivo_anulacion is null or new.motivo_anulacion = '' then
        raise exception 'Para anular una factura el motivo es obligatorio';
      end if;
      return new;
    end if;

    -- feature 007 (pagos): avanzar total_pagado y el estado derivado pagada/vencida
    if (new.total_pagado is distinct from old.total_pagado) then
      if (new.subtotal_servicios is distinct from old.subtotal_servicios)
         or (new.total is distinct from old.total)
         or (new.consumo_m3 is distinct from old.consumo_m3)
         or (new.recargo_mora is distinct from old.recargo_mora)
         or (new.saldo_anterior is distinct from old.saldo_anterior)
         or (new.numero is distinct from old.numero)
         or (new.snapshot_suscriptor is distinct from old.snapshot_suscriptor)
         or (new.fecha_emision is distinct from old.fecha_emision)
      then
        raise exception 'Una factura emitida es inmutable: no se cambian sus valores; si está mal, se anula';
      end if;
      return new;
    end if;

    -- cualquier otro UPDATE de una factura emitida
    raise exception 'Una factura emitida es inmutable: no se edita; si está mal, se anula (solo se permite avanzar total_pagado por pagos)';
  end if;

  -- INSERT (emisión del cierre de facturación): permitido. La doble emisión del
  -- mismo (suscriptor, periodo, tipo ciclo) la rechaza uq_factura_ciclo.
  return new;
end $$;

create trigger trg_factura_inmutable
  before insert or update or delete on facturas
  for each row execute function bloquear_factura_inmutable();

-- 4.2 Recalcula subtotal_servicios y total a partir de factura_detalles.
--     Se dispara tras insert/update/delete de renglones de la factura (o de un
--     cambio directo sobre facturas que modifica recargo_mora/saldo_anterior).
--     total = subtotal_servicios + recargo_mora + saldo_anterior (§2.9).
--     La API no confia "el total"; el trigger es la invariante de la base.
create function recalcular_total_factura(p_factura_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_subtotal numeric(12,2);
begin
  select coalesce(sum(d.subtotal), 0)
    into v_subtotal
    from factura_detalles d
    where d.factura_id = p_factura_id;

  -- Marca local a la transacción para que trg_factura_inmutable reconozca este
  -- UPDATE como el recálculo interno (la invariante "total = suma de detalles")
  -- y no como una edición ad-hoc de la API.
  perform set_config('app.recalculo_interno', 'on', true);
  update facturas
     set subtotal_servicios = v_subtotal,
         total              = v_subtotal + recargo_mora + saldo_anterior
   where id = p_factura_id;
  perform set_config('app.recalculo_interno', 'off', true);
end $$;

create function trg_factura_detalles_recalcula() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    perform recalcular_total_factura(new.factura_id);
  elsif tg_op = 'DELETE' then
    perform recalcular_total_factura(old.factura_id);
  end if;
  return null;  -- trigger AFTER: el retorno se ignora
end $$;

create trigger trg_factura_detalles_recalcula
  after insert or update or delete on factura_detalles
  for each row execute function trg_factura_detalles_recalcula();


-- -----------------------------------------------------------------------------
-- 5. RLS FORCE + políticas (plan.md §2)
--    facturas/detalles/lecturas de la factura: lectura para miembros del cliente
--    o plataforma; escritura (insert/update/delete) solo admin_acueducto. El rol
--    lector NO escribe facturación (solo lee) — CLAUDE.md §10 punto 24.
-- -----------------------------------------------------------------------------

alter table facturas enable row level security;
alter table facturas force row level security;
alter table factura_detalles enable row level security;
alter table factura_detalles force row level security;
alter table factura_lecturas enable row level security;
alter table factura_lecturas force row level security;

-- Lectura
create policy facturas_lectura on facturas for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy factura_detalles_lectura on factura_detalles for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy factura_lecturas_lectura on factura_lecturas for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));

-- Escritura (solo admin_acueducto del cliente)
create policy facturas_admin on facturas for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
create policy factura_detalles_admin on factura_detalles for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
create policy factura_lecturas_admin on factura_lecturas for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

