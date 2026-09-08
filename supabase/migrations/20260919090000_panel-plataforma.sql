-- =============================================================================
-- UndreoCol — Migración: panel de plataforma (018)
-- Referencia: specs/018-panel-plataforma/plan.md §2
--
-- El superadmin (rol 'administrador', cliente_id NULL) ya podía escribir en
-- clientes, membresias y configuracion directamente por RLS
-- (clientes_plataforma, membresias_plataforma, configuracion_escritura, las
-- tres con `es_admin_plataforma()`). La única tabla sin ninguna política de
-- INSERT es perfiles: crear_tenant_con_admin() (001) evita el problema siendo
-- SECURITY DEFINER, pero ese caso es distinto — ahí el usuario crea SU PROPIO
-- perfil (auth.uid()). Aquí el superadmin crea el perfil de OTRA persona.
--
-- Las dos funciones nuevas son SECURITY INVOKER, no DEFINER: con la política
-- nueva, RLS ya autoriza todo lo que tocan. Menos superficie de "identificador
-- desnudo" que auditar (lección de C-1) — no hay bypass que revisar porque no
-- hay bypass.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. perfiles: permite al superadmin crear el perfil de otra persona
-- -----------------------------------------------------------------------------

create policy perfiles_alta_plataforma on perfiles for insert
  with check (es_admin_plataforma());

-- -----------------------------------------------------------------------------
-- 2. crear_acueducto_base(): clientes + configuracion en una transacción
-- -----------------------------------------------------------------------------

create or replace function crear_acueducto_base(p_nombre_cliente text, p_slug text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  begin
    insert into clientes (nombre, slug) values (p_nombre_cliente, p_slug)
      returning id into v_cliente_id;
  exception when unique_violation then
    raise exception 'El slug ya está en uso';
  end;
  insert into configuracion (cliente_id) values (v_cliente_id);
  return v_cliente_id;
end $$;

comment on function crear_acueducto_base is
  'Crea clientes+configuracion en una transacción (018 T-001). SECURITY INVOKER: '
  'se apoya en las políticas clientes_plataforma y configuracion_escritura, que '
  'ya autorizan a es_admin_plataforma(). Si el llamante no lo es, ambos INSERT '
  'fallan por RLS y la función no hace nada útil — no necesita guarda propia.';

-- -----------------------------------------------------------------------------
-- 3. asignar_admin_acueducto(): perfiles + membresias, para un usuario que YA
--    existe en auth.users (creado por signUp() desde el Worker, nunca aquí)
-- -----------------------------------------------------------------------------

create or replace function asignar_admin_acueducto(
  p_cliente_id uuid, p_usuario_id uuid, p_nombre text, p_email text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into perfiles (id, nombre, email) values (p_usuario_id, p_nombre, p_email);
  insert into membresias (perfil_id, cliente_id, rol)
    values (p_usuario_id, p_cliente_id, 'admin_acueducto');
end $$;

comment on function asignar_admin_acueducto is
  'Vincula un auth.users ya existente como admin_acueducto de un cliente (018 '
  'T-001). SECURITY INVOKER: se apoya en perfiles_alta_plataforma y '
  'membresias_plataforma, ambas es_admin_plataforma(). No crea auth.users — '
  'eso lo hace signUp() desde el Worker con la clave anon (CLAUDE.md §12: '
  'nunca service_role en una ruta de usuario).';

-- -----------------------------------------------------------------------------
-- 4. Privilegios — higiene y consistencia con B-3, aunque la protección real
--    la da RLS (SECURITY INVOKER no bypasea nada que otorgar)
-- -----------------------------------------------------------------------------

revoke all on function crear_acueducto_base(text, text) from public, anon;
grant  execute on function crear_acueducto_base(text, text) to authenticated;

revoke all on function asignar_admin_acueducto(uuid, uuid, text, text) from public, anon;
grant  execute on function asignar_admin_acueducto(uuid, uuid, text, text) to authenticated;
