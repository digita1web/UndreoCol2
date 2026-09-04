-- =============================================================================
-- UndreoCol — Migración 009: Cortes y reconexiones
-- Referencia: specs/009-cortes-y-reconexiones/plan.md (aprobado 2026-09-04) y spec.md
--
-- Alcance reducido (opción a, aprobado explícitamente por Mateo): corte y
-- reconexión son acciones de admin_acueducto desde el panel — el sistema
-- sugiere candidatos por umbral, el admin decide y ejecuta. No hay "orden"
-- como entidad separada ni ejecución desde el celular del lector
-- (docs/ESPECIFICACION-FUNCIONAL.md §2.11, opción b) — queda como feature
-- futura, el volumen actual del acueducto piloto no la justifica todavía.
--
-- Depende de 001 (usuarios_servicio, configuracion.dias_umbral_corte/
-- valor_reconexion/prefijo_reconexion/dias_vencimiento, estado_suscriptor.
-- cortado, es_admin_de()/mis_clientes()/es_admin_plataforma()), 005
-- (facturas/factura_detalles, tipo_factura.reconexion, siguiente_numero_factura(),
-- trg_factura_detalles_recalcula()) y 007 (patrón de RPC SECURITY INVOKER +
-- SELECT FOR UPDATE + motivo obligatorio de anular_pago()).
--
-- Sin core/ nuevo: el monto de reconexión es un valor de configuración
-- directo; la deuda vencida la calcula lib/pagos.ts (obtenerCartera(), 007) y
-- se pasa a reconectar() ya calculada — no se reimplementa el cálculo en SQL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Historial de cortes y reconexiones
-- -----------------------------------------------------------------------------

create type tipo_evento_corte as enum ('corte', 'reconexion');

create table cortes_reconexiones (
  id                          uuid primary key default gen_random_uuid(),
  cliente_id                  uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id         uuid not null references usuarios_servicio(id) on delete restrict,
  tipo                        tipo_evento_corte not null,
  fecha                       date not null default current_date,
  motivo                      text not null,
  responsable                 uuid not null references perfiles(id),
  deuda_vencida_al_reconectar numeric(12,2),
  factura_reconexion_id       uuid references facturas(id),
  created_at                  timestamptz not null default now()
);

create index on cortes_reconexiones (cliente_id, usuario_servicio_id, fecha desc);

comment on table cortes_reconexiones is
  'Historial permanente de cortes y reconexiones. motivo/responsable NOT NULL a '
  'nivel de esquema: cada fila de esta tabla ES un evento de corte o reconexión, '
  'nunca existe uno sin motivo ni responsable (a diferencia de facturas.motivo_anulacion, '
  'nullable porque no toda factura se anula). Sin DELETE expuesto por ninguna ruta.';
comment on column cortes_reconexiones.deuda_vencida_al_reconectar is
  'NULL si la reconexión no tuvo deuda vencida (no fue una excepción real). '
  '> 0 si se forzó con excepción — distingue el motivo informativo del motivo '
  'de una excepción real, ambos guardados en la columna motivo.';
comment on column cortes_reconexiones.factura_reconexion_id is
  'Solo para tipo=reconexion: la factura de cargo de reconexión generada automáticamente.';

-- -----------------------------------------------------------------------------
-- 2. registrar_corte() — SECURITY INVOKER (plan.md §2, mismo patrón que
--    anular_pago()/reemplazar_contador(): SELECT FOR UPDATE + motivo obligatorio)
-- -----------------------------------------------------------------------------

create or replace function registrar_corte(
  p_usuario_servicio_id uuid,
  p_motivo              text,
  p_perfil              uuid
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_id uuid;
  v_estado     estado_suscriptor;
  v_id         uuid;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo del corte es obligatorio';
  end if;
  if p_perfil is null then
    raise exception 'Falta el perfil responsable del corte';
  end if;

  -- FOR UPDATE aplica la política de UPDATE de usuarios_servicio: un suscriptor
  -- de otro cliente, o visto por un rol sin permiso de escritura (lector),
  -- queda invisible aquí antes de llegar al chequeo es_admin_de() de abajo
  -- (mismo comportamiento verificado en 002 T-002 PASO 4 y 003 T-002 PASO 5).
  select cliente_id, estado into v_cliente_id, v_estado
    from usuarios_servicio where id = p_usuario_servicio_id
    for update;
  if v_cliente_id is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if not es_admin_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;
  if v_estado = 'cortado' then
    raise exception 'El suscriptor ya está cortado';
  end if;

  update usuarios_servicio set estado = 'cortado' where id = p_usuario_servicio_id;

  insert into cortes_reconexiones (cliente_id, usuario_servicio_id, tipo, motivo, responsable)
  values (v_cliente_id, p_usuario_servicio_id, 'corte', btrim(p_motivo), p_perfil)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function registrar_corte is
  'Única forma soportada de cortar un suscriptor: exige motivo, rechaza si ya '
  'está cortado, deja el rastro en cortes_reconexiones. Corte SIEMPRE con '
  'confirmación humana explícita del admin_acueducto — nunca desatendido '
  '(decisión 1 de spec.md §5, aprobada).';

revoke execute on function registrar_corte(uuid, text, uuid) from anon, public;
grant  execute on function registrar_corte(uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. reconectar() — SECURITY INVOKER (plan.md §2)
--    p_deuda_vencida la calcula el llamador (lib/cortes.ts, vía obtenerCartera()
--    de 007) — esta función NO recalcula la cartera, para no desincronizarse
--    de la única fuente de verdad de "deuda vencida" del proyecto.
-- -----------------------------------------------------------------------------

create or replace function reconectar(
  p_usuario_servicio_id uuid,
  p_deuda_vencida       numeric,
  p_motivo_excepcion    text,
  p_perfil              uuid
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_id  uuid;
  v_estado      estado_suscriptor;
  v_numero      text;
  v_prefijo     text;
  v_dias_venc   integer;
  v_valor       numeric(12,2);
  v_factura_id  uuid;
  v_evento_id   uuid;
begin
  if p_perfil is null then
    raise exception 'Falta el perfil responsable de la reconexión';
  end if;
  if coalesce(p_deuda_vencida, 0) > 0
     and (p_motivo_excepcion is null or btrim(p_motivo_excepcion) = '') then
    raise exception 'Hay deuda vencida: el motivo de excepción es obligatorio para reconectar';
  end if;

  select cliente_id, estado into v_cliente_id, v_estado
    from usuarios_servicio where id = p_usuario_servicio_id
    for update;
  if v_cliente_id is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if not es_admin_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;
  if v_estado <> 'cortado' then
    raise exception 'El suscriptor no está cortado';
  end if;

  select prefijo_reconexion, dias_vencimiento, valor_reconexion
    into v_prefijo, v_dias_venc, v_valor
    from configuracion where cliente_id = v_cliente_id;

  v_numero := siguiente_numero_factura(v_cliente_id, v_prefijo);

  insert into facturas (cliente_id, usuario_servicio_id, periodo_id, tipo, numero,
                         snapshot_suscriptor, fecha_vencimiento)
  select v_cliente_id, p_usuario_servicio_id, null, 'reconexion', v_numero,
         jsonb_build_object('nombre', u.nombre, 'codigo_suscriptor', u.codigo_suscriptor,
                             'direccion', u.direccion, 'categoria', u.categoria),
         current_date + v_dias_venc
    from usuarios_servicio u where u.id = p_usuario_servicio_id
  returning id into v_factura_id;

  -- servicio_id/tarifa_id NULL a propósito (plan.md §5): la reconexión es un
  -- cargo independiente, no un servicio del catálogo de 002 — inventar un
  -- servicio sintético solo para tener una FK no nula forzaría un concepto
  -- que no aplica. trg_factura_detalles_recalcula() (005) calcula
  -- subtotal_servicios/total de la factura a partir de este renglón.
  insert into factura_detalles (cliente_id, factura_id, servicio_id, tarifa_id, orden,
                                 descripcion, tipo_calculo, cargo_fijo, subtotal)
  values (v_cliente_id, v_factura_id, null, null, 1,
          'Cargo de reconexión', 'fijo', v_valor, v_valor);

  update usuarios_servicio set estado = 'activo' where id = p_usuario_servicio_id;

  insert into cortes_reconexiones (cliente_id, usuario_servicio_id, tipo, motivo, responsable,
                                    deuda_vencida_al_reconectar, factura_reconexion_id)
  values (v_cliente_id, p_usuario_servicio_id, 'reconexion',
          coalesce(nullif(btrim(coalesce(p_motivo_excepcion, '')), ''), 'Sin deuda vencida'),
          p_perfil, nullif(coalesce(p_deuda_vencida, 0), 0), v_factura_id)
  returning id into v_evento_id;

  return v_evento_id;
end;
$$;

comment on function reconectar is
  'Única forma soportada de reconectar un suscriptor: bloqueada con deuda '
  'vencida salvo excepción explícita (motivo + responsable, CLAUDE.md §10 '
  'punto 18); genera automáticamente la factura de reconexión (punto 19) '
  'reutilizando siguiente_numero_factura() sin modificarla.';

revoke execute on function reconectar(uuid, numeric, text, uuid) from anon, public;
grant  execute on function reconectar(uuid, numeric, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. RLS FORCE + políticas (mismo patrón que el resto del proyecto)
-- -----------------------------------------------------------------------------

alter table cortes_reconexiones enable row level security;
alter table cortes_reconexiones force row level security;

create policy cortes_reconexiones_lectura on cortes_reconexiones for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy cortes_reconexiones_escritura on cortes_reconexiones for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

-- Ninguna ruta expone DELETE de cortes_reconexiones: el historial es
-- permanente, igual criterio que reemplazos_contador (003) y pago_aplicaciones (007).
