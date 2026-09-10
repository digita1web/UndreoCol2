-- =============================================================================
-- UndreoCol — Migración 023: personalizacion-factura
-- Referencia: specs/023-personalizacion-factura/plan.md §2
--
-- Columna nueva `clientes.color_acento`: color de acento (hex #RRGGBB) que usa
-- la factura (PDF e impresión en pantalla) en el nombre del acueducto y el
-- TOTAL, en vez del azul fijo que usaba `factura-pdf.ts` para todos.
--
-- Default '#14408C' = conversión exacta de rgb(0.08, 0.25, 0.55), el color
-- fijo anterior (0.08×255≈20=0x14, 0.25×255≈64=0x40, 0.55×255≈140=0x8C):
-- ningún acueducto existente cambia de apariencia con esta migración (CA-1).
--
-- CHECK de formato en la base (defensa en profundidad, no solo la validación
-- de la ruta en backend/src/index.ts): un valor que no sea hex de 6 dígitos
-- nunca llega a `factura-pdf.ts`, sin importar por dónde se haya escrito.
-- =============================================================================

alter table clientes
  add column color_acento text not null default '#14408C'
  check (color_acento ~* '^#[0-9a-f]{6}$');

comment on column clientes.color_acento is
  'Color de acento (hex #RRGGBB) usado en el encabezado y el TOTAL de la '
  'factura (PDF e impresión, 023). Default = azul que ya se usaba antes de '
  'esta feature, para que ningún acueducto existente cambie de apariencia.';

-- ---- RLS: quién puede cambiar el color -------------------------------------
-- `clientes_lectura` (SELECT) y `clientes_plataforma` (ALL, solo superadmin)
-- ya existen (001) y no se tocan. Política de UPDATE nueva, acotada por fila:
-- es_admin_de(id) cubre admin_acueducto de ESE cliente y al superadmin (001).
-- El `lector` nunca entra aquí, ni por RLS ni por el GRANT de columna de abajo.
create policy clientes_color_acento on clientes
  for update
  using (es_admin_de(id))
  with check (es_admin_de(id));

-- ---- RLS: acotar por columna, no solo por fila -----------------------------
-- HALLAZGO (fase /plan de 023): 20260914090001_grants-tablas-faltantes.sql ya
-- le dio a `authenticated` GRANT UPDATE de TABLA COMPLETA sobre `clientes`.
-- Sin esto, la política de arriba por sí sola dejaría a un admin_acueducto
-- cambiar plan_id/estado_cuenta/slug de su propia fila con la misma vía usada
-- para el color — verificado que ningún código actual depende del UPDATE
-- amplio anterior (grep de `.from('clientes')` en backend/src/: todos son
-- `.select()`; el alta de acueductos usa funciones SECURITY DEFINER, que no
-- necesitan el GRANT de `authenticated` para escribir). `service_role` no se
-- toca: conserva el UPDATE completo de grants-tablas-faltantes.
revoke update on clientes from authenticated;
grant update (color_acento) on clientes to authenticated;

-- ---- portal_factura_completa (008/008b): agrega color_acento al PDF del portal
-- CREATE OR REPLACE conserva los GRANT existentes de la función (anon sí,
-- authenticated no — B-3), no hace falta reafirmarlos.
create or replace function portal_factura_completa(
  p_cliente_id uuid,
  p_numero_documento text,
  p_codigo_suscriptor text,
  p_factura_id uuid
) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'factura', jsonb_build_object(
      'id', f.id, 'cliente_id', f.cliente_id, 'usuario_servicio_id', f.usuario_servicio_id,
      'periodo_id', f.periodo_id, 'tipo', f.tipo, 'numero', f.numero,
      'snapshot_suscriptor', f.snapshot_suscriptor, 'consumo_m3', f.consumo_m3,
      'subtotal_servicios', f.subtotal_servicios, 'recargo_mora', f.recargo_mora,
      'saldo_anterior', f.saldo_anterior, 'total', f.total, 'total_pagado', f.total_pagado,
      'fecha_emision', f.fecha_emision, 'fecha_vencimiento', f.fecha_vencimiento,
      'estado', f.estado, 'motivo_anulacion', f.motivo_anulacion, 'anulada_por', f.anulada_por
    ),
    'detalles', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', d.id, 'factura_id', d.factura_id, 'servicio_id', d.servicio_id,
            'tarifa_id', d.tarifa_id, 'orden', d.orden, 'descripcion', d.descripcion,
            'tipo_calculo', d.tipo_calculo, 'consumo_m3', d.consumo_m3, 'cargo_fijo', d.cargo_fijo,
            'consumo_basico_m3', d.consumo_basico_m3, 'valor_basico', d.valor_basico,
            'consumo_no_basico_m3', d.consumo_no_basico_m3, 'valor_no_basico', d.valor_no_basico,
            'subtotal', d.subtotal
          ) order by d.orden
        ),
        '[]'::jsonb
      )
      from factura_detalles d where d.factura_id = f.id
    ),
    'acueducto', (
      select jsonb_build_object(
        'nombre', c.nombre, 'nit', c.nit, 'direccion', c.direccion,
        'telefono', c.telefono, 'municipio', c.municipio, 'logo_url', c.logo_url,
        'color_acento', c.color_acento
      )
      from clientes c where c.id = f.cliente_id
    )
  )
  from facturas f
  where f.id = p_factura_id
    and f.cliente_id = p_cliente_id
    and f.usuario_servicio_id = (
      select u.id from usuarios_servicio u
       where u.cliente_id = p_cliente_id
         and u.numero_documento = p_numero_documento
         and u.codigo_suscriptor = p_codigo_suscriptor
         and u.estado <> 'inactivo'
    );
$$;
