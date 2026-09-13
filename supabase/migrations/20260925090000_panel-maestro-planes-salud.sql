-- Salud técnica de plataforma: escrita por los cron con service_role y leída
-- por el superadmin mediante la política explícita.
create table if not exists _salud_sistema (
  id              smallint primary key default 1,
  tamano_base_mb  numeric not null,
  nivel           text not null,
  medido_en       timestamptz not null default now(),
  constraint chk_singleton check (id = 1)
);

insert into _salud_sistema (id, tamano_base_mb, nivel, medido_en)
values (1, 0, 'ok', now())
on conflict (id) do nothing;

alter table _salud_sistema enable row level security;
alter table _salud_sistema force row level security;

comment on table _salud_sistema is
  'Última medición del cron monitor-db.ts. Tabla técnica de plataforma, sin cliente_id.';

create policy salud_sistema_lectura on _salud_sistema for select
  using (es_admin_plataforma());

create policy keepalive_lectura_plataforma on _keepalive for select
  using (es_admin_plataforma());

-- GRANT de columna que falta para poder cambiar plan/estado de cuenta desde
-- /plataforma. `20260920090000_personalizacion-factura.sql` ya revocó el
-- UPDATE de TABLA COMPLETA sobre `clientes` para `authenticated` y solo dejó
-- `color_acento` — sin esto, `PATCH /plataforma/acueductos/:id` falla con
-- "permission denied for table clientes" aunque `clientes_plataforma` (RLS)
-- ya autorice la fila: el GRANT de columna es una capa previa y separada de
-- RLS, Postgres la evalúa antes. Confirmado reproduciendo el error real
-- contra Postgres local antes de este fix (Sesión 055).
grant update (plan_id, estado_cuenta) on clientes to authenticated;

-- HALLAZGO DE SEGURIDAD (Sesión 055, verificado contra Postgres real antes de
-- corregirlo): el GRANT de arriba por sí solo NO alcanza. Las políticas RLS de
-- `for update` se combinan con OR — `clientes_color_acento` (023) ya autoriza
-- a `admin_acueducto` a hacer UPDATE sobre SU PROPIA fila (`es_admin_de(id)`),
-- y RLS no distingue por columna dentro de una misma fila ya autorizada. Con
-- el GRANT de columna nuevo, un admin_acueducto podía cambiar el
-- plan/estado_cuenta de su propio acueducto — spec §5/CA-4 lo prohíbe
-- explícitamente. Mismo patrón que ya usa `bloquear_factura_inmutable()`
-- (005/006): un trigger, porque ni RLS ni GRANT solos pueden acotar "esta
-- columna, solo para este rol, dentro de una fila que otra política ya
-- autorizó para otras columnas".
create or replace function bloquear_cambio_plan_estado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.plan_id is distinct from old.plan_id or new.estado_cuenta is distinct from old.estado_cuenta)
       and not es_admin_plataforma() then
      raise exception 'Solo el superadmin de la plataforma puede cambiar el plan o el estado de cuenta de un acueducto';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_clientes_plan_estado
  before update on clientes
  for each row execute function bloquear_cambio_plan_estado();