-- =============================================================================
-- UndreoCol — Test de aislamiento de 024-permisos-lector (plan.md §8)
-- Referencia: specs/024-permisos-lector/plan.md y tasks.md T-004
--
-- Cierra M-2 y M-2b (docs/PLAN-PRODUCCION.md): el lector deja de leer 10
-- tablas de negocio (antes visibles vía una política _lectura sin filtrar
-- por rol) y conserva solo una vista mínima de usuarios_servicio (5
-- columnas sin PII, vía usuarios_servicio_lector()).
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql,
-- lecturas.sql, facturacion.sql y pagos.sql aplicados (cliente A/admin A/
-- lector A, mismos IDs que el resto de la suite).
-- Debe terminar con 'PERMISOS-LECTOR-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/014_permisos_lector_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: lector de A queda en 0 en las 10 tablas del hallazgo (+ usuarios_servicio)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
declare
  n integer;
begin
  select count(*) into n from facturas;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % facturas (esperaba 0)', n; end if;
  select count(*) into n from factura_detalles;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % factura_detalles (esperaba 0)', n; end if;
  select count(*) into n from pagos;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % pagos (esperaba 0)', n; end if;
  select count(*) into n from pago_aplicaciones;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % pago_aplicaciones (esperaba 0)', n; end if;
  select count(*) into n from tarifas;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % tarifas (esperaba 0)', n; end if;
  select count(*) into n from configuracion;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % configuraciones (esperaba 0)', n; end if;
  select count(*) into n from cortes_reconexiones;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % cortes_reconexiones (esperaba 0)', n; end if;
  select count(*) into n from notificaciones;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % notificaciones (esperaba 0)', n; end if;
  select count(*) into n from importaciones_suscriptores;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % importaciones_suscriptores (esperaba 0)', n; end if;
  select count(*) into n from reemplazos_contador;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % reemplazos_contador (esperaba 0)', n; end if;
  select count(*) into n from usuarios_servicio;
  if n <> 0 then raise exception 'PASO 1 FALLÓ: lector ve % usuarios_servicio directo (esperaba 0)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 2: admin_acueducto de A no pierde nada — por existencia de IDs
-- originales conocidos (no por conteo total: 011-dashboard agrega más filas
-- a propósito, y un conteo fijo se vuelve frágil sin que la RLS esté rota —
-- misma lección aplicada al corregir 001/003/004/005/007 en esta sesión).
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  select count(*) into n from facturas where id = 'ff000000-0000-0000-0000-0000000000a1';
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin no ve su factura original'; end if;
  select count(*) into n from pagos
    where id in ('d1000000-0000-0000-0000-0000000000a1', 'd1000000-0000-0000-0000-0000000000a2');
  if n <> 2 then raise exception 'PASO 2 FALLÓ: admin no ve sus 2 pagos originales (ve %)', n; end if;
  select count(*) into n from usuarios_servicio
    where id in ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2');
  if n <> 2 then raise exception 'PASO 2 FALLÓ: admin no ve sus 2 usuarios_servicio originales (ve %)', n; end if;
  select count(*) into n from tarifas;
  if n < 1 then raise exception 'PASO 2 FALLÓ: admin no ve ninguna tarifa'; end if;
  select count(*) into n from configuracion where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin no ve su configuracion'; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: usuarios_servicio_lector() desde el lector de A — sus filas, 5
-- columnas, y 0 filas del cliente B
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
declare
  n integer;
begin
  select count(*) into n from usuarios_servicio_lector('a0000000-0000-0000-0000-000000000001')
    where id in ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a2');
  if n <> 2 then raise exception 'PASO 3 FALLÓ: lector no ve sus 2 suscriptores originales vía la función (ve %)', n; end if;
  select count(*) into n from usuarios_servicio_lector('b0000000-0000-0000-0000-000000000002');
  if n <> 0 then raise exception 'PASO 3 FALLÓ: lector ve % suscriptores de B vía la función', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: la función NO tiene columnas sensibles en su tipo de retorno — se
-- prueba pidiéndolas: si existieran, esto compilaría; al no existir, Postgres
-- rechaza la consulta en el planificador (column does not exist).
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform numero_documento from usuarios_servicio_lector('a0000000-0000-0000-0000-000000000001');
    raise exception 'PASO 4 FALLÓ: usuarios_servicio_lector expone numero_documento';
  exception when undefined_column then
    null; -- esperado: la columna no existe en el tipo de retorno
  end;
end $$;

\echo 'PERMISOS-LECTOR-AISLAMIENTO OK'
