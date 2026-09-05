-- =============================================================================
-- UndreoCol — Test de aislamiento de 010-notificaciones (plan.md §8)
-- Referencia: specs/010-notificaciones/plan.md y tasks.md T-002
--
-- Alcance deliberadamente acotado a lo que la migración 010 agrega de verdad:
-- el CHECK del catálogo cerrado de tipos y la columna configuracion.dias_aviso_vencimiento.
-- El aislamiento multi-tenant general de `notificaciones` (admin A no ve/inserta en B,
-- lector A solo lee) YA está cubierto por tests/aislamiento/006_correo_factura_aislamiento.sql
-- — no se duplica aquí (tasks.md T-002, alcance corregido durante /implement).
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql, lecturas.sql,
-- facturacion.sql y correo-factura.sql aplicados (mismos IDs de cliente A/B y admin A
-- reutilizados de 001/006, sin fixture nuevo). Debe terminar con
-- 'NOTIFICACIONES-GENERALES-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/010_notificaciones_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: el CHECK del catálogo existe
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from pg_constraint
    where conname = 'notificaciones_tipo_valido' and conrelid = 'notificaciones'::regclass;
  if n <> 1 then raise exception 'PASO 1 FALLÓ: falta el CHECK notificaciones_tipo_valido'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: los 6 tipos del catálogo son insertables (admin de A, su propio cliente)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  insert into notificaciones (cliente_id, tipo) values
    ('a0000000-0000-0000-0000-000000000001', 'factura_generada'),
    ('a0000000-0000-0000-0000-000000000001', 'recordatorio_vencimiento'),
    ('a0000000-0000-0000-0000-000000000001', 'aviso_mora'),
    ('a0000000-0000-0000-0000-000000000001', 'confirmacion_pago'),
    ('a0000000-0000-0000-0000-000000000001', 'corte_ejecutado'),
    ('a0000000-0000-0000-0000-000000000001', 'reconexion_completada');
  select count(*) into n from notificaciones
    where cliente_id = 'a0000000-0000-0000-0000-000000000001'
      and tipo in ('factura_generada','recordatorio_vencimiento','aviso_mora',
                   'confirmacion_pago','corte_ejecutado','reconexion_completada');
  -- +1 porque correo-factura.sql (006) ya dejó una fila factura_generada de A1.
  if n <> 7 then raise exception 'PASO 2 FALLÓ: se insertaron/encontraron % filas (esperaba 7)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: un tipo fuera del catálogo sigue siendo rechazado (regresión de T-001)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into notificaciones (cliente_id, tipo)
    values ('a0000000-0000-0000-0000-000000000001', 'tipo_invalido');
    raise exception 'PASO 3 FALLÓ: se insertó un tipo fuera del catálogo';
  exception when others then
    if sqlerrm not like '%notificaciones_tipo_valido%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: configuracion.dias_aviso_vencimiento = 3 para AMBOS clientes existentes
-- (confirma que el ALTER TABLE ... ADD COLUMN aplicó a las filas ya existentes)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  v integer;
begin
  select dias_aviso_vencimiento into v from configuracion
    where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if v <> 3 then raise exception 'PASO 4 FALLÓ: dias_aviso_vencimiento de A es % (esperaba 3)', v; end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000b1';
do $$
declare
  v integer;
begin
  select dias_aviso_vencimiento into v from configuracion
    where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if v <> 3 then raise exception 'PASO 4 FALLÓ: dias_aviso_vencimiento de B es % (esperaba 3)', v; end if;
end $$;
rollback;

\echo 'NOTIFICACIONES-GENERALES-AISLAMIENTO OK'
