-- =============================================================================
-- UndreoCol — Migración 008b (008): resolución del slug del acueducto para el
-- portal del suscriptor (D-10)
-- Referencia: specs/008-portal-suscriptor/plan.md §3 y tasks.md T-004
--
-- DESVIACIÓN DE IMPLEMENTACIÓN del plan documentada: el plan §3 dice que el
-- login `POST /portal/:slug/login` "resuelve cliente_id por clientes.slug",
-- pero anon (la clave pública con la que el portal llama a sus funciones, D-10)
-- NO puede leer `clientes` (RLS: clientes_lectura solo para miembros del
-- cliente o plataforma — verificado contra la base local). Resolver el slug
-- con service_role está prohibido sin excepción (CLAUDE.md §12). Se agrega una
-- función SECURITY DEFINER acotada (mismo mecanismo que las 5 del T-001) que
-- solo devuelve el uuid del cliente cuyo slug coincide: el slug es público (está
-- en la URL que el acueducto comparte a sus suscriptores) y la función no
-- expone ningún otro dato. Grant de ejecución solo a anon.
--
-- Se crea como migración NUEVA (no se reescribe la 008 ya publicada en el
-- T-001): el reset local reconstruye 001→009 en orden y la función queda
-- disponible para el login.
-- =============================================================================

create or replace function portal_cliente_por_slug(p_slug text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from clientes where slug = p_slug
$$;

comment on function portal_cliente_por_slug is
  'Resuelve el clientes.id a partir de clientes.slug para el login del portal. '
  'El slug está en la URL pública (spec §3.1); la función devuelve SOLO el uuid, '
  'nunca datos del cliente. Invocada por el Worker con la clave anon (D-10).';

revoke all on function portal_cliente_por_slug(text) from public;
grant  execute on function portal_cliente_por_slug(text) to anon;
