-- =============================================================================
-- UndreoCol — Migración 017 (T-005): purga de los contadores de intentos
-- Referencia: specs/017-rate-limit-login-admin/plan.md §5.5
-- Cierra además el hallazgo M-6 de la auditoría (docs/PLAN-PRODUCCION.md).
--
-- POR QUÉ HACE FALTA: por CA-4, admin_intentos_login cuenta los intentos contra
-- emails que NO existen igual que contra los registrados — es lo que impide que
-- el 429 sirva para enumerar cuentas. El precio es que cada email distinto que
-- alguien pruebe deja una fila permanente. Con la base de 500 MB de Supabase
-- Free (ARQUITECTURA.md §6), un atacante que itere emails hace crecer la tabla
-- sin techo. portal_intentos_login (008) tiene el mismo problema desde entonces
-- y nunca se purgó: es exactamente el hallazgo M-6.
--
-- DESVIACIÓN DEL PLAN, se señala (CLAUDE.md §3): el plan §1 solo listaba
-- `cron/limpieza.ts` para esta tarea, sin migración. Se añade esta función
-- porque el predicado de borrado en SQL es VERIFICABLE contra PostgreSQL real
-- con filas de verdad (la suite 901 lo prueba), mientras que el mismo predicado
-- escrito como cadena de PostgREST en TypeScript solo se podría comprobar
-- contra un cliente falso — es decir, comprobando una copia del predicado en
-- vez del que se ejecuta. CLAUDE.md §4 pesa más que la lista de archivos.
--
-- REGLA DE SEGURIDAD (la más importante de esta migración): NUNCA se borra una
-- fila con bloqueo vigente. Si la purga se llevara los bloqueos activos, un
-- atacante tendría una forma gratuita de limpiar el suyo: esperar al cron.
-- =============================================================================

create or replace function purgar_intentos_login(p_dias integer default 30)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_corte timestamptz;
  v_admin integer;
  v_portal integer;
begin
  -- Guarda defensiva: un p_dias absurdo (0, negativo o nulo) borraría bloqueos
  -- recientes. Se fuerza un mínimo de 1 día.
  v_corte := now() - (greatest(coalesce(p_dias, 30), 1) * interval '1 day');

  delete from admin_intentos_login
   where ultimo_intento < v_corte
     and (bloqueado_hasta is null or bloqueado_hasta <= now());   -- nunca un bloqueo vigente
  get diagnostics v_admin = row_count;

  delete from portal_intentos_login
   where ultimo_intento < v_corte
     and (bloqueado_hasta is null or bloqueado_hasta <= now());   -- nunca un bloqueo vigente
  get diagnostics v_portal = row_count;

  return jsonb_build_object(
    'admin_intentos_login', v_admin,
    'portal_intentos_login', v_portal,
    'corte', v_corte
  );
end $$;

comment on function purgar_intentos_login is
  'Purga los contadores de intentos de login caducados: filas sin actividad en '
  'p_dias días (30 por defecto) y SIN bloqueo vigente. Nunca borra un bloqueo '
  'activo — hacerlo le daría al atacante una forma gratuita de limpiar el suyo '
  'esperando al cron. La llama el Worker de limpieza con service_role. '
  'Devuelve cuántas filas borró de cada tabla (017 T-005, cierra el hallazgo '
  'M-6 de la auditoría pre-producción).';

-- Solo el Worker de cron (service_role). Ni anon ni authenticated tienen por
-- qué borrar contadores de intentos: sería una forma de limpiar su propio
-- bloqueo. Hay que revocar también de `authenticated`, porque los default
-- privileges de Supabase otorgan toda función nueva a ese rol y revocar de
-- `public` NO lo quita (lección de T-001).
revoke all on function purgar_intentos_login(integer) from public, anon, authenticated;
grant  execute on function purgar_intentos_login(integer) to service_role;
