-- =============================================================================
-- UndreoCol — Test de aislamiento de 023-personalizacion-factura (plan.md §8)
-- Referencia: specs/023-personalizacion-factura/plan.md y tasks.md T-006
--
-- Cubre el hallazgo de seguridad de la fase /plan: la política RLS
-- `clientes_color_acento` (UPDATE, es_admin_de) por sí sola no bastaba,
-- porque 20260914090001_grants-tablas-faltantes.sql ya le había dado a
-- `authenticated` UPDATE de TABLA COMPLETA sobre `clientes` — sin el GRANT
-- de columna de 023, un admin_acueducto podría tocar plan_id/estado_cuenta/
-- slug de su propia fila por la misma vía usada para el color.
--
-- Requiere tests/fixtures/fundacion.sql aplicado (cliente A/admin A/lector A,
-- cliente B/admin B — mismos IDs que el resto de la suite de aislamiento).
-- Debe terminar con 'PERSONALIZACION-FACTURA-AISLAMIENTO OK'.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/013_personalizacion_factura_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: admin de A cambia el color de A → OK, y persiste
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  update clientes set color_acento = '#ABCDEF' where id = 'a0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'PASO 1 FALLÓ: admin de A no pudo cambiar su propio color (% filas)', n; end if;
end $$;
commit;

do $$
declare
  v text;
begin
  select color_acento into v from clientes where id = 'a0000000-0000-0000-0000-000000000001';
  if v <> '#ABCDEF' then raise exception 'PASO 1 FALLÓ: el color no quedó persistido (valor: %)', v; end if;
end $$;

-- restaura el color por defecto para no dejar el fixture compartido alterado
update clientes set color_acento = '#14408C' where id = 'a0000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- PASO 2: admin de A intenta cambiar el color de B → 0 filas (RLS por fila)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  n integer;
begin
  update clientes set color_acento = '#111111' where id = 'b0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PASO 2 FALLÓ: admin de A pudo cambiar el color de B (% filas)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: admin de A intenta, en la MISMA actualización, tocar plan_id de su
-- propia fila → falla por el GRANT de columna (no solo por RLS de fila)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    update clientes set color_acento = '#333333', plan_id = null
      where id = 'a0000000-0000-0000-0000-000000000001';
    raise exception 'PASO 3 FALLÓ: se pudo tocar plan_id junto con color_acento';
  exception when insufficient_privilege then
    if sqlerrm not like '%permission denied for table clientes%' then raise; end if;
  end;
end $$;
rollback;

-- confirma que plan_id de A sigue igual (nada se coló pese al error)
do $$
declare
  n integer;
begin
  select count(*) into n from clientes
    where id = 'a0000000-0000-0000-0000-000000000001' and plan_id is null;
  if n <> 0 then raise exception 'PASO 3 FALLÓ: plan_id de A quedó en null tras el intento bloqueado'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 4: lector de A intenta cambiar el color de A → 0 filas (RLS: es_admin_de
-- exige admin_acueducto, el lector no cumple)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2';
do $$
declare
  n integer;
begin
  update clientes set color_acento = '#222222' where id = 'a0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PASO 4 FALLÓ: el lector de A pudo cambiar el color (% filas)', n; end if;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5 (control negativo — el test SIRVE): sin la política clientes_color_acento
-- ningún authenticated podría tocar color_acento; con ella, el admin de su propio
-- cliente sí puede. Ya demostrado en el PASO 1 — aquí se confirma que la política
-- exacta existe (no una más laxa por accidente).
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from pg_policies
    where tablename = 'clientes' and policyname = 'clientes_color_acento' and cmd = 'UPDATE';
  if n <> 1 then raise exception 'PASO 5 FALLÓ: falta (o sobra) la política clientes_color_acento'; end if;
end $$;

\echo 'PERSONALIZACION-FACTURA-AISLAMIENTO OK'
