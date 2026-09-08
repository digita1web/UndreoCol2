-- =============================================================================
-- UndreoCol — Migración: GRANTs de tabla faltantes para authenticated/service_role
--
-- HALLAZGO EN PRODUCCIÓN (2026-09-06): `authenticated` no tenía SELECT en
-- `perfiles`/`membresias` — confirmado por Mateo contra la base real de
-- producción (information_schema.role_table_grants): solo tenía TRIGGER,
-- REFERENCES, TRUNCATE. Causa raíz confirmada revisando las 12 migraciones
-- anteriores (grep de "^grant" en supabase/migrations/*.sql): TODAS otorgan
-- GRANT EXECUTE sobre funciones/RPCs, pero NINGUNA de las 21 tablas de
-- negocio (más `_keepalive`) tiene un GRANT propio sobre sí misma. Es un
-- patrón sistemático, no un caso aislado de `perfiles`/`membresias`.
--
-- El proyecto asumió (comentario explícito en 20260907090000_pagos.sql:
-- "grant usage on schema public no hace falta: ya existe para authenticated")
-- que Supabase otorga privilegios de TABLA por defecto — esa suposición es
-- falsa para este proyecto de producción. Funcionó siempre en local porque el
-- bootstrap de `supabase start` sí trae esos defaults; nunca se verificó
-- contra un proyecto de producción real hasta ahora.
--
-- RLS (ya existente, FORCE en todas las tablas desde 001) filtra FILAS; el
-- GRANT de tabla es una capa SEPARADA y obligatoria para poder tocar la tabla
-- en absoluto — Postgres deniega el acceso ANTES de evaluar RLS si falta el
-- GRANT base. Ninguna de las dos capas sustituye a la otra.
--
-- Alcance de esta migración:
-- - `authenticated`: SELECT/INSERT/UPDATE/DELETE en las 21 tablas de negocio
--   (RLS ya restringe qué filas ve/toca cada quien; las reglas de
--   inmutabilidad de facturas/pagos las siguen aplicando sus propios
--   triggers, no el GRANT).
-- - `service_role`: mismo alcance + `_keepalive` (usado por los Workers de
--   cron/cola — keepalive, monitor-db, limpieza, cierre-facturacion — que
--   además tienen BYPASSRLS, pero BYPASSRLS no sustituye al GRANT de tabla).
-- - `anon`: SOLO `SELECT` en `planes` — es la única tabla que un cliente
--   `crearClienteAnon` consulta con `.from()` directo (`GET /salud`,
--   backend/src/index.ts). Todo lo demás que usa `anon` (login del portal,
--   registro, recuperación de contraseña) pasa por funciones SECURITY
--   DEFINER (`lib/portal.ts`, `lib/auth.ts` — verificado con grep, cero
--   `.from()` directos en esos archivos), que corren con los privilegios de
--   su dueño y no necesitan GRANT de tabla para el llamador.
-- - `_keepalive` queda deliberadamente FUERA de `authenticated`/`anon` — su
--   propio comentario en 20260831150000_fundacion-tenancy.sql ya decía
--   "sin políticas: por defecto nadie (anon/authenticated) puede tocarla".
--
-- Para que esto no se repita con una tabla nueva de una feature futura:
-- ALTER DEFAULT PRIVILEGES cubre las tablas que el mismo rol que ejecuta
-- esta migración cree de ahora en adelante.
-- =============================================================================

grant select, insert, update, delete on
  planes, clientes, perfiles, membresias, configuracion, usuarios_servicio,
  servicios, tarifas,
  contadores, reemplazos_contador,
  periodos, lecturas,
  facturas, factura_detalles, factura_lecturas,
  notificaciones,
  pagos, pago_aplicaciones,
  portal_intentos_login,
  cortes_reconexiones,
  importaciones_suscriptores
to authenticated;

grant select, insert, update, delete on
  planes, clientes, perfiles, membresias, configuracion, usuarios_servicio,
  servicios, tarifas,
  contadores, reemplazos_contador,
  periodos, lecturas,
  facturas, factura_detalles, factura_lecturas,
  notificaciones,
  pagos, pago_aplicaciones,
  portal_intentos_login,
  cortes_reconexiones,
  importaciones_suscriptores,
  _keepalive
to service_role;

grant select on planes to anon;

-- Futuras tablas creadas por el rol que corre las migraciones (normalmente
-- `postgres`) heredan estos mismos privilegios automáticamente.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
