-- =============================================================================
-- UndreoCol — Migración 037: rutas-zonas-lector
-- Referencia: specs/037-rutas-zonas-lector/plan.md §2
--
-- Cierra CLAUDE.md §10 punto 24 ("el lector solo crea/ve lecturas y ejecuta
-- órdenes asignadas a él") del lado de las FILAS — 024 ya acotó qué columnas
-- puede ver. Reutiliza la columna `sector` de usuarios_servicio (003), ya
-- cargable a mano o por importación de Excel (012), en vez de un concepto de
-- "ruta" nuevo — patrón de "Territory-based Permission" ya establecido en la
-- industria (Zoho FSM, Salesforce Field Service), no una simplificación
-- propia.
-- =============================================================================

-- Asignación lector<->sector (037). Tabla de negocio: lleva cliente_id y RLS
-- FORCE sin excepciones (CLAUDE.md §5.4), aunque sea chica.
create table lector_sectores (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  perfil_id  uuid not null references perfiles(id) on delete cascade,
  sector     text not null,
  created_at timestamptz not null default now(),
  unique (cliente_id, perfil_id, sector)
);

alter table lector_sectores enable row level security;
alter table lector_sectores force row level security;

-- Lectura amplia por pertenencia (igual que contadores_lectura, B-3): el
-- propio lector necesita leer sus asignaciones para "Zona actual" (Inicio,
-- AquaLectura); el nombre de un sector no es información sensible.
create policy lector_sectores_lectura on lector_sectores for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));

-- Solo admin_acueducto (o superadmin) asigna/quita sectores.
create policy lector_sectores_escritura on lector_sectores for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

-- Sectores asignados a auth.uid() para un cliente — vacío = sin restricción,
-- ve todo el acueducto (retrocompatibilidad, spec CA-3). SECURITY DEFINER
-- para poder llamarse desde políticas RLS de otras tablas sin recursión.
-- `returns table` (no `setof text`), mismo patrón que usuarios_servicio_lector()
-- ya usa — formato de fila sin ambigüedad al llamarla directo vía .rpc() desde
-- el backend (GET /dashboard, para "Zona actual"), no solo desde otro SQL.
create or replace function mis_sectores_asignados(p_cliente_id uuid)
returns table (sector text)
language sql stable security definer set search_path = public as $$
  select sector from lector_sectores
  where perfil_id = auth.uid() and cliente_id = p_cliente_id;
$$;

-- Sin revoke/grant explícito, a propósito: mismo criterio que mis_clientes()
-- y es_admin_plataforma() (fundacion-tenancy.sql) — llamada por `anon`
-- devuelve vacío igual (auth.uid() es null), no expone nada real; no hace
-- falta la tightening explícita que sí tiene usuarios_servicio_lector()
-- (esa expone datos de suscriptores, esta solo nombres de sector propios).

-- usuarios_servicio_lector() (024) gana el filtro de sector — mismo criterio
-- de "sin asignación, ve todo".
create or replace function usuarios_servicio_lector(p_cliente_id uuid, p_estado text default null)
returns table (id uuid, codigo_suscriptor text, nombre text, contador_actual_id uuid, estado estado_suscriptor)
language sql stable security definer set search_path = public as $$
  select u.id, u.codigo_suscriptor, u.nombre, u.contador_actual_id, u.estado
  from usuarios_servicio u
  where u.cliente_id = p_cliente_id
    and (es_admin_plataforma() or p_cliente_id in (select mis_clientes()))
    and (p_estado is null or u.estado::text = p_estado)
    and (
      not exists (select 1 from mis_sectores_asignados(p_cliente_id))
      or u.sector in (select sector from mis_sectores_asignados(p_cliente_id))
    )
  order by u.nombre;
$$;

comment on function usuarios_servicio_lector is
  'Vista mínima de usuarios_servicio para el rol lector (024): solo id, '
  'codigo_suscriptor, nombre, contador_actual_id y estado — sin cédula, '
  'teléfono, email, dirección ni notas. La guarda es de pertenencia al '
  'acueducto (mis_clientes()), no de rol, igual que tarifa_vigente() (B-3): '
  'cualquier miembro activo del cliente puede llamarla, pero solo expone '
  'columnas sin PII, así que no hace falta ser más estricto. Desde 037, '
  'además filtra por sector cuando quien llama tiene sectores asignados '
  '(mis_sectores_asignados) — sin ninguno, sigue viendo todo (CA-3).';

revoke execute on function usuarios_servicio_lector(uuid, text) from anon, public;
grant execute on function usuarios_servicio_lector(uuid, text) to authenticated;

-- lecturas_lectura (004) gana el mismo filtro, vía join a contadores/usuarios_servicio.
drop policy lecturas_lectura on lecturas;
create policy lecturas_lectura on lecturas for select
  using (
    es_admin_plataforma()
    or (
      cliente_id in (select mis_clientes())
      and (
        not exists (select 1 from mis_sectores_asignados(lecturas.cliente_id))
        or contador_id in (
          select c.id from contadores c
          join usuarios_servicio u on u.id = c.usuario_servicio_id
          where c.cliente_id = lecturas.cliente_id
            and u.sector in (select sector from mis_sectores_asignados(lecturas.cliente_id))
        )
      )
    )
  );
