-- =============================================================================
-- UndreoCol — Migración 024: permisos-lector
-- Referencia: specs/024-permisos-lector/plan.md §2
--
-- Cierra M-2 (docs/PLAN-PRODUCCION.md): el rol `lector` leía exactamente lo
-- mismo que `admin_acueducto` en 10 tablas, porque cada una tenía DOS
-- políticas de lectura solapadas: la `_admin`/`_escritura` (ALL,
-- es_admin_de) que ya excluye correctamente al lector, y una `_lectura`
-- (SELECT) aparte, más amplia (cliente_id IN mis_clientes(), sin filtrar
-- por rol) que era el único camino que lo dejaba pasar. Se elimina esa
-- segunda política en las 10 — admin_acueducto/administrador no pierden
-- nada (la ALL los sigue cubriendo íntegro).
--
-- usuarios_servicio es la excepción: /app/lecturas (el trabajo real del
-- lector) sí necesita elegir un suscriptor de una lista, así que además de
-- quitarle la política amplia se le da una función SECURITY DEFINER que
-- solo expone 5 columnas sin PII (mismo patrón que 008/010: revalida
-- pertenencia al acueducto, nunca confía en un parámetro desnudo).
-- =============================================================================

drop policy facturas_lectura on facturas;
drop policy factura_detalles_lectura on factura_detalles;
drop policy pagos_lectura on pagos;
drop policy pago_aplicaciones_lectura on pago_aplicaciones;
drop policy tarifas_lectura on tarifas;
drop policy configuracion_lectura on configuracion;
drop policy cortes_reconexiones_lectura on cortes_reconexiones;
drop policy notificaciones_lectura on notificaciones;
drop policy importaciones_suscriptores_lectura on importaciones_suscriptores;
drop policy reemplazos_contador_lectura on reemplazos_contador;

drop policy usuarios_servicio_lectura on usuarios_servicio;

create or replace function usuarios_servicio_lector(p_cliente_id uuid, p_estado text default null)
returns table (id uuid, codigo_suscriptor text, nombre text, contador_actual_id uuid, estado estado_suscriptor)
language sql stable security definer set search_path = public as $$
  select u.id, u.codigo_suscriptor, u.nombre, u.contador_actual_id, u.estado
  from usuarios_servicio u
  where u.cliente_id = p_cliente_id
    and (es_admin_plataforma() or p_cliente_id in (select mis_clientes()))
    and (p_estado is null or u.estado::text = p_estado)
  order by u.nombre;
$$;

comment on function usuarios_servicio_lector is
  'Vista mínima de usuarios_servicio para el rol lector (024): solo id, '
  'codigo_suscriptor, nombre, contador_actual_id y estado — sin cédula, '
  'teléfono, email, dirección ni notas. La guarda es de pertenencia al '
  'acueducto (mis_clientes()), no de rol, igual que tarifa_vigente() (B-3): '
  'cualquier miembro activo del cliente puede llamarla, pero solo expone '
  'columnas sin PII, así que no hace falta ser más estricto.';

revoke execute on function usuarios_servicio_lector(uuid, text) from anon, public;
grant execute on function usuarios_servicio_lector(uuid, text) to authenticated;
