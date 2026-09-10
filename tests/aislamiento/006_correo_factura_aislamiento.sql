-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de notificaciones (plan.md §8)
-- Referencia: specs/006-impresion-y-correo-factura/plan.md y tasks.md T-001
-- Cubre CA-1: aislamiento multi-tenant de notificaciones y permisos por rol
-- (admin lee/escribe; lector solo lee).
--
-- Requiere tests/fixtures/fundacion.sql, catalogo.sql, suscriptores.sql,
-- lecturas.sql, facturacion.sql y correo-factura.sql aplicados. Mismo mecanismo
-- que 001-005. Debe terminar con 'CORREO-FACTURA-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/006_correo_factura_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existe notificaciones con RLS FORCE
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from pg_class
    where relname = 'notificaciones' and relforcerowsecurity;
  if n <> 1 then raise exception 'PASO 1 FALLÓ: notificaciones no tiene RLS FORCE'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: admin de A ve SOLO sus notificaciones (no las de B)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  select count(*) into n from notificaciones;
  if n <> 1 then raise exception 'PASO 2 FALLÓ: admin A ve % notificaciones (esperaba 1)', n; end if;
  select count(*) into n from notificaciones
    where cliente_id = 'b0000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin A ve notificaciones del cliente B'; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: admin de A NO puede insertar una notificación del cliente B
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    insert into notificaciones (cliente_id, tipo, canal, destinatario, asunto)
    values ('b0000000-0000-0000-0000-000000000002', 'factura_generada', 'email',
            'b@test.local', 'Intrusión');
    raise exception 'PASO 3 FALLÓ: admin A insertó una notificación del cliente B';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: el lector de A YA NO lee notificaciones (024/M-2) y sigue sin
-- poder insertar ni cambiar estado
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
declare
  n integer;
begin
  -- 024 (M-2): se eliminó notificaciones_lectura (antes de 024 esto
  -- esperaba 1 — revela actividad de cobranza, el lector no la necesita).
  select count(*) into n from notificaciones;
  if n <> 0 then raise exception 'PASO 4 FALLÓ: lector A ve % notificaciones (024 debería dejarlo en 0)', n; end if;

  begin
    insert into notificaciones (cliente_id, tipo, canal, destinatario, asunto)
    values ('a0000000-0000-0000-0000-000000000001', 'factura_generada', 'email',
            'a@test.local', 'Intento lector');
    raise exception 'PASO 4 FALLÓ: lector A insertó una notificación';
  exception when others then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;

  -- UPDATE (marcar enviada) es silencioso para el lector: 0 filas afectadas.
  update notificaciones set estado = 'enviada'
    where id = '99900000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PASO 4 FALLÓ: lector A cambió % notificación', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: admin de A SÍ puede insertar una notificación de su cliente
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  insert into notificaciones (cliente_id, usuario_servicio_id, factura_id, tipo,
                              canal, destinatario, asunto, estado)
  values ('a0000000-0000-0000-0000-000000000001',
          'd0000000-0000-0000-0000-0000000000a1',
          'ff000000-0000-0000-0000-0000000000a1',
          'factura_generada', 'email', 'suscriptor-a1@test.local',
          'Reintento FAC-2026-00001', 'pendiente');
  select count(*) into n from notificaciones
    where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'PASO 5 FALLÓ: admin A no pudo insertar (esperaba 2, hay %)', n; end if;
end $$;
rollback;

\echo 'CORREO-FACTURA-AISLAMIENTO OK'
