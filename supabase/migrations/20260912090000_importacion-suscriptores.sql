-- =============================================================================
-- UndreoCol — Migración 012: Importación masiva de suscriptores desde Excel/CSV
-- Referencia: specs/012-importacion-suscriptores-excel/plan.md (aprobado 2026-09-04) y spec.md
--
-- Depende de 001 (clientes, perfiles, es_admin_de()/mis_clientes()/
-- es_admin_plataforma()) y 003 (usuarios_servicio completa, con las columnas
-- que esta migración inserta).
--
-- Alcance: tabla importaciones_suscriptores (historial — errores guarda solo
-- {fila, motivo}, nunca el contenido de la fila, spec §3.6); función
-- importar_suscriptores() (SECURITY INVOKER, sin SELECT FOR UPDATE — cada
-- suscriptor nuevo es una fila independiente sin contención, plan.md §5 —
-- INSERT en lote vía jsonb_to_recordset, atómico por ser una sola función:
-- cualquier fallo revierte todo el INSERT y el registro de historial); RLS
-- FORCE + políticas estándar.
--
-- La validación de campos requeridos, traducción de categoría y duplicados
-- DENTRO del archivo ya se hizo en core/importacion-suscriptores.ts (puro,
-- sin base de datos) antes de llegar aquí. Los duplicados CONTRA la base
-- existente se detectan en lib/importacion-suscriptores.ts (backend/src/lib)
-- antes de llamar esta función — esta función confía en que p_filas_validas
-- ya pasó ambas validaciones; el constraint único real de usuarios_servicio
-- (cliente_id, codigo_suscriptor) es la última barrera si algo se coló.
-- =============================================================================

create table importaciones_suscriptores (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  nombre_archivo    text not null,
  filas_intentadas  integer not null,
  filas_importadas  integer not null,
  filas_con_error   integer not null,
  errores           jsonb not null default '[]'::jsonb,
  realizado_por     uuid references perfiles(id),
  created_at        timestamptz not null default now()
);

create index on importaciones_suscriptores (cliente_id, created_at desc);

comment on table importaciones_suscriptores is
  'Historial de intentos de importación masiva de suscriptores. errores es '
  '[{"fila": n, "motivo": "..."}] — solo el número de fila y por qué falló, '
  'NUNCA el contenido de la fila (spec.md §3.6: evita acumular datos '
  'personales de filas que ni siquiera se importaron).';

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
  if not es_admin_de(p_cliente_id) then
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

comment on function importar_suscriptores is
  'Única forma soportada de confirmar una importación masiva: inserta el '
  'lote completo de filas ya validadas (core/ + duplicados contra la base, '
  'ambos verificados antes de llamar esta función) y registra el historial '
  'en la misma transacción — cualquier fallo (ej. un duplicado que se coló) '
  'revierte TODO el lote, nunca deja suscriptores a medias (CA-6).';

revoke execute on function importar_suscriptores(uuid, jsonb, jsonb, text, uuid) from anon, public;
grant  execute on function importar_suscriptores(uuid, jsonb, jsonb, text, uuid) to authenticated;

alter table importaciones_suscriptores enable row level security;
alter table importaciones_suscriptores force row level security;

create policy importaciones_suscriptores_lectura on importaciones_suscriptores for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy importaciones_suscriptores_escritura on importaciones_suscriptores for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

-- Ninguna ruta expone DELETE de importaciones_suscriptores: el historial es
-- permanente, igual criterio que cortes_reconexiones (009) y reemplazos_contador (003).
