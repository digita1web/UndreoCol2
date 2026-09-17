-- =============================================================================
-- UndreoCol — Migración: crear-lector-acueducto
-- Referencia: hallazgo real de producción (Sesión 057, Mateo onboardeando el
-- primer acueducto piloto) — ESPECIFICACION-FUNCIONAL.md dice "el
-- admin_acueducto puede crear usuarios con rol lector dentro de su
-- acueducto", y membresias_gestion_acueducto (RLS) ya lo autoriza, pero
-- nunca se construyó la ruta ni la pantalla: /app/lectores solo asignaba
-- sectores a lectores YA existentes.
--
-- asignar_lector_acueducto(): mismo patrón que asignar_admin_acueducto()
-- (018/panel-plataforma), pero SECURITY DEFINER con guarda explícita
-- adentro — no SECURITY INVOKER como aquella, porque la única política de
-- INSERT sobre `perfiles` (perfiles_alta_plataforma) exige
-- es_admin_plataforma(); un admin_acueducto normal nunca la cumple, así que
-- SECURITY INVOKER lo bloquearía en la propia tabla `perfiles` antes de
-- llegar a `membresias`. Mismo criterio que bloquear_cambio_plan_estado()
-- (035): SECURITY DEFINER + chequeo de rol explícito adentro de la función,
-- en vez de depender de RLS para una operación que cruza el límite de lo
-- que RLS puede expresar por sí sola.
-- =============================================================================

create or replace function asignar_lector_acueducto(
  p_cliente_id uuid, p_usuario_id uuid, p_nombre text, p_email text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not es_admin_de(p_cliente_id) then
    raise exception 'Solo el administrador del acueducto puede crear lectores';
  end if;
  insert into perfiles (id, nombre, email) values (p_usuario_id, p_nombre, p_email);
  insert into membresias (perfil_id, cliente_id, rol) values (p_usuario_id, p_cliente_id, 'lector');
end $$;

comment on function asignar_lector_acueducto is
  'Vincula un auth.users ya existente (creado por signUp() desde el Worker, '
  'con la clave anon — nunca aquí, CLAUDE.md §12) como lector de un cliente. '
  'SECURITY DEFINER con es_admin_de(p_cliente_id) explícito adentro: la '
  'única política de INSERT de perfiles exige es_admin_plataforma(), así '
  'que SECURITY INVOKER (como asignar_admin_acueducto) no le serviría a un '
  'admin_acueducto normal.';

revoke all on function asignar_lector_acueducto(uuid, uuid, text, text) from public, anon;
grant  execute on function asignar_lector_acueducto(uuid, uuid, text, text) to authenticated;
