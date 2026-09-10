-- =============================================================================
-- UndreoCol — Migración 028: rol secretaria
-- Referencia: specs/028-rol-secretaria/{spec,plan,tasks}.md
--
-- La migración se divide conceptualmente en T-001/T-002/T-003 dentro de este
-- archivo para conservar una única migración versionada. Todas las funciones
-- SECURITY INVOKER que se redefinen aquí mantienen RLS como primera barrera y
-- sus guardas internas como defensa adicional.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- T-001: rol nuevo, helper de staff y lecturas ampliadas
-- -----------------------------------------------------------------------------

alter type rol_usuario add value 'secretaria';

-- PostgreSQL no permite usar el nuevo valor de un enum dentro de una función
-- creada en la misma transacción que ejecuta ALTER TYPE ... ADD VALUE. La
-- comparación textual conserva la semántica y permite que Supabase aplique la
-- migración transaccionalmente desde cero.
create or replace function es_staff_de(p_cliente_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin_plataforma()
      or tiene_rol(p_cliente_id, array['admin_acueducto']::rol_usuario[])
      or exists (
        select 1
        from membresias
        where perfil_id = auth.uid()
          and cliente_id = p_cliente_id
          and activo
          and rol::text = 'secretaria'
      );
$$;

comment on function es_staff_de(uuid) is
  'True para admin_acueducto o secretaria del cliente, y para el administrador '
  'de plataforma. No reemplaza es_admin_de(): secretaria no obtiene permisos '
  'financieros o destructivos.';

create policy facturas_staff_lectura on facturas for select
  using (es_staff_de(cliente_id));
create policy factura_detalles_staff_lectura on factura_detalles for select
  using (es_staff_de(cliente_id));
create policy tarifas_staff_lectura on tarifas for select
  using (es_staff_de(cliente_id));
create policy cortes_reconexiones_staff_lectura on cortes_reconexiones for select
  using (es_staff_de(cliente_id));
create policy notificaciones_staff_lectura on notificaciones for select
  using (es_staff_de(cliente_id));

-- -----------------------------------------------------------------------------
-- T-002: escritura administrativa ampliada
-- -----------------------------------------------------------------------------

alter policy usuarios_servicio_escritura on usuarios_servicio
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));

alter policy importaciones_suscriptores_escritura on importaciones_suscriptores
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));

alter policy reemplazos_contador_escritura on reemplazos_contador
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));

alter policy contadores_escritura on contadores
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));

create or replace function importar_suscriptores(
  p_cliente_id      uuid,
  p_filas_validas   jsonb,
  p_filas_con_error jsonb,
  p_nombre_archivo  text,
  p_perfil          uuid
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_importados integer;
  v_id         uuid;
begin
  if not es_staff_de(p_cliente_id) then
    raise exception 'No autorizado';
  end if;
  if p_perfil is null then
    raise exception 'Falta el perfil responsable de la importación';
  end if;
  if p_nombre_archivo is null or btrim(p_nombre_archivo) = '' then
    raise exception 'Falta el nombre del archivo importado';
  end if;

  insert into usuarios_servicio (cliente_id, codigo_suscriptor, nombre, numero_documento,
                                  direccion, categoria, tipo_documento, telefono, email, sector, notas)
  select p_cliente_id, f.codigo_suscriptor, f.nombre, f.numero_documento, f.direccion,
         f.categoria::categoria_tarifaria, f.tipo_documento, f.telefono, f.email, f.sector, f.notas
    from jsonb_to_recordset(coalesce(p_filas_validas, '[]'::jsonb)) as f(
      codigo_suscriptor text, nombre text, numero_documento text, direccion text, categoria text,
      tipo_documento text, telefono text, email text, sector text, notas text
    );
  get diagnostics v_importados = row_count;

  insert into importaciones_suscriptores (cliente_id, nombre_archivo, filas_intentadas,
                                           filas_importadas, filas_con_error, errores, realizado_por)
  values (
    p_cliente_id, btrim(p_nombre_archivo),
    v_importados + jsonb_array_length(coalesce(p_filas_con_error, '[]'::jsonb)),
    v_importados,
    jsonb_array_length(coalesce(p_filas_con_error, '[]'::jsonb)),
    coalesce(p_filas_con_error, '[]'::jsonb),
    p_perfil
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function reemplazar_contador(
  p_usuario_servicio_id    uuid,
  p_serial_nuevo           text,
  p_marca_nuevo            text,
  p_capacidad_maxima_nuevo numeric,
  p_lectura_final_anterior numeric,
  p_lectura_inicial_nuevo  numeric,
  p_motivo                 text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_id uuid;
  v_contador_anterior_id uuid;
  v_contador_nuevo_id uuid;
  v_reemplazo_id uuid;
begin
  select cliente_id, contador_actual_id into v_cliente_id, v_contador_anterior_id
    from usuarios_servicio where id = p_usuario_servicio_id
    for update;

  if v_cliente_id is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if not es_staff_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;
  if v_contador_anterior_id is null then
    raise exception 'El suscriptor no tiene contador activo para reemplazar';
  end if;

  update contadores set estado = 'reemplazado' where id = v_contador_anterior_id;

  insert into contadores (cliente_id, usuario_servicio_id, serial, marca,
                           capacidad_maxima, lectura_inicial, fecha_instalacion, estado)
  values (v_cliente_id, p_usuario_servicio_id, p_serial_nuevo, p_marca_nuevo,
          p_capacidad_maxima_nuevo, p_lectura_inicial_nuevo, current_date, 'activo')
  returning id into v_contador_nuevo_id;

  update usuarios_servicio set contador_actual_id = v_contador_nuevo_id
    where id = p_usuario_servicio_id;

  insert into reemplazos_contador (cliente_id, usuario_servicio_id, contador_anterior_id,
                                    contador_nuevo_id, lectura_final_anterior,
                                    lectura_inicial_nuevo, motivo)
  values (v_cliente_id, p_usuario_servicio_id, v_contador_anterior_id, v_contador_nuevo_id,
          p_lectura_final_anterior, p_lectura_inicial_nuevo, p_motivo)
  returning id into v_reemplazo_id;

  return v_reemplazo_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- T-003: pagos separados por comando y anulación exclusiva del admin
-- -----------------------------------------------------------------------------

drop policy pagos_admin on pagos;
create policy pagos_admin on pagos for update
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
create policy pagos_admin_delete on pagos for delete
  using (es_admin_de(cliente_id));

drop policy pago_aplicaciones_admin on pago_aplicaciones;
create policy pago_aplicaciones_admin on pago_aplicaciones for update
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
create policy pago_aplicaciones_admin_delete on pago_aplicaciones for delete
  using (es_admin_de(cliente_id));

create policy pagos_staff_lectura on pagos for select
  using (es_staff_de(cliente_id));
create policy pagos_staff_insert on pagos for insert
  with check (es_staff_de(cliente_id));
create policy pago_aplicaciones_staff_lectura on pago_aplicaciones for select
  using (es_staff_de(cliente_id));
create policy pago_aplicaciones_staff_insert on pago_aplicaciones for insert
  with check (es_staff_de(cliente_id));

create policy facturas_staff_actualiza on facturas for update
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));

create or replace function registrar_pago(
  p_cliente_id          uuid,
  p_usuario_servicio_id uuid,
  p_valor               numeric,
  p_aplicaciones        jsonb,
  p_recibido_por        uuid,
  p_fecha_pago          date default current_date,
  p_metodo              metodo_pago default 'efectivo',
  p_referencia          text default null,
  p_observaciones       text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_suscriptor uuid;
  v_pago_id            uuid;
  v_suma_aplicada      numeric(12,2);
  v_remanente          numeric(12,2);
  v_aplicaciones       jsonb := '[]'::jsonb;
  v_facturas           jsonb := '[]'::jsonb;
  r                    record;
  v_f_cliente          uuid;
  v_f_usuario          uuid;
  v_f_estado           text;
  v_f_total            numeric(12,2);
  v_f_pagado           numeric(12,2);
  v_f_saldo            numeric(12,2);
begin
  if p_valor is null or p_valor <= 0 then
    raise exception 'El valor del pago debe ser mayor que cero';
  end if;
  if p_recibido_por is null then
    raise exception 'Falta el perfil que registra el pago';
  end if;

  select cliente_id into v_cliente_suscriptor
    from usuarios_servicio where id = p_usuario_servicio_id for update;
  if v_cliente_suscriptor is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if v_cliente_suscriptor is distinct from p_cliente_id then
    raise exception 'El suscriptor no pertenece al cliente';
  end if;
  if not es_staff_de(p_cliente_id) then
    raise exception 'No autorizado';
  end if;

  select coalesce(sum((e->>'valor')::numeric), 0)
    into v_suma_aplicada
    from jsonb_array_elements(coalesce(p_aplicaciones, '[]'::jsonb)) e
   where (e->>'valor')::numeric > 0;
  if v_suma_aplicada > p_valor then
    raise exception 'La suma de los abonos (%) supera el valor del pago (%)',
                    v_suma_aplicada, p_valor;
  end if;

  insert into pagos (cliente_id, usuario_servicio_id, valor, fecha_pago, metodo,
                     referencia, recibido_por, observaciones)
  values (p_cliente_id, p_usuario_servicio_id, p_valor, p_fecha_pago, p_metodo,
          p_referencia, p_recibido_por, p_observaciones)
  returning id into v_pago_id;

  for r in
    select (e->>'factura_id')::uuid as factura_id, (e->>'valor')::numeric as valor
      from jsonb_array_elements(coalesce(p_aplicaciones, '[]'::jsonb)) e
     where (e->>'valor')::numeric > 0
  loop
    select cliente_id, usuario_servicio_id, estado, total, total_pagado
      into v_f_cliente, v_f_usuario, v_f_estado, v_f_total, v_f_pagado
      from facturas where id = r.factura_id for update;
    if v_f_cliente is null then
      raise exception 'La factura % no existe', r.factura_id;
    end if;
    if v_f_cliente is distinct from p_cliente_id
       or v_f_usuario is distinct from p_usuario_servicio_id then
      raise exception 'La factura % no pertenece al suscriptor de este pago', r.factura_id;
    end if;
    if v_f_estado = 'anulada' then
      raise exception 'No se puede abonar a la factura anulada %', r.factura_id;
    end if;
    v_f_saldo := v_f_total - v_f_pagado;
    if r.valor > v_f_saldo then
      raise exception 'El saldo vivo de la factura % cambió (%): reintente',
                      r.factura_id, v_f_saldo;
    end if;

    insert into pago_aplicaciones (cliente_id, pago_id, factura_id, valor)
    values (p_cliente_id, v_pago_id, r.factura_id, r.valor);

    update facturas
       set total_pagado = total_pagado + r.valor,
           estado       = case when total_pagado + r.valor >= total
                               then 'pagada'::estado_factura
                               else estado end
     where id = r.factura_id;

    v_aplicaciones := v_aplicaciones || jsonb_build_object('factura_id', r.factura_id, 'valor', r.valor);
    v_facturas := v_facturas || jsonb_build_object(
      'factura_id', r.factura_id,
      'total', v_f_total,
      'total_pagado', v_f_pagado + r.valor,
      'estado', case when v_f_pagado + r.valor >= v_f_total then 'pagada' else 'pendiente' end
    );
  end loop;

  v_remanente := p_valor - v_suma_aplicada;
  return jsonb_build_object(
    'pago', jsonb_build_object(
      'id', v_pago_id, 'cliente_id', p_cliente_id,
      'usuario_servicio_id', p_usuario_servicio_id, 'valor', p_valor,
      'fecha_pago', p_fecha_pago, 'metodo', p_metodo,
      'referencia', p_referencia, 'recibido_por', p_recibido_por,
      'observaciones', p_observaciones
    ),
    'aplicaciones', v_aplicaciones, 'remanente', v_remanente, 'facturas', v_facturas
  );
end;
$$;

create or replace function bloquear_factura_inmutable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.recalculo_interno', true) = 'on' then
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Una factura no se borra: se anula (estado = anulada) con motivo y responsable';
  end if;
  if tg_op = 'UPDATE' then
    if new.estado = 'anulada' and old.estado <> 'anulada' then
      if not es_admin_de(new.cliente_id) then
        raise exception 'Solo el administrador del acueducto puede anular una factura';
      end if;
      if new.motivo_anulacion is null or new.motivo_anulacion = '' then
        raise exception 'Para anular una factura el motivo es obligatorio';
      end if;
      return new;
    end if;
    if (
      new.subtotal_servicios is distinct from old.subtotal_servicios
      or new.total is distinct from old.total
      or new.consumo_m3 is distinct from old.consumo_m3
      or new.recargo_mora is distinct from old.recargo_mora
      or new.saldo_anterior is distinct from old.saldo_anterior
      or new.numero is distinct from old.numero
      or new.snapshot_suscriptor is distinct from old.snapshot_suscriptor
      or new.fecha_emision is distinct from old.fecha_emision
    ) then
      raise exception 'Una factura emitida es inmutable: no se cambian sus valores; si está mal, se anula (solo pdf_url por 006 y total_pagado/estado por 007)';
    end if;
    return new;
  end if;
  return new;
end;
$$;
