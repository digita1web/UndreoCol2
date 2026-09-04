-- =============================================================================
-- UndreoCol — Test de aislamiento RLS de cortes y reconexiones (plan.md §8)
-- Referencia: specs/009-cortes-y-reconexiones/plan.md y tasks.md T-002
-- Cubre CA-2 (aislamiento multi-tenant, incluyendo registrar_corte()/reconectar()
-- como funciones SECURITY INVOKER) y los rechazos explícitos de la spec (§3.1/§3.2).
--
-- Requiere tests/fixtures/fundacion.sql .. tests/fixtures/portal.sql y
-- tests/fixtures/cortes.sql (no-op, ver ese archivo) aplicados antes. Mismo
-- mecanismo que 001-008: cada escenario abre una transacción, simula el rol y
-- la sesión con
--   set local role <anon|authenticated>
--   set local request.jwt.claim.sub = '<uuid del perfil>'
-- ejecuta sus aserciones y hace ROLLBACK — incluidos los escenarios que
-- necesitan una factura vencida o un suscriptor cortado: esos datos se crean
-- DENTRO de la transacción del escenario (regla aprendida en 007/008: un
-- fixture compartido no debe mutar el estado que otros aislamientos asumen).
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/009_cortes_aislamiento.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- PASO 1: existe cortes_reconexiones, con RLS FORCE
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from information_schema.tables
    where table_schema = 'public' and table_name = 'cortes_reconexiones';
  if n <> 1 then
    raise exception 'PASO 1 FALLÓ: no se encontró la tabla cortes_reconexiones';
  end if;
  select count(*) into n from pg_class
    where relname = 'cortes_reconexiones' and relforcerowsecurity;
  if n <> 1 then
    raise exception 'PASO 1 FALLÓ: cortes_reconexiones no tiene FORCE ROW LEVEL SECURITY';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2: admin A no puede cortar/reconectar un suscriptor de B — RLS hace la
-- fila invisible antes del chequeo es_admin_de() (mismo comportamiento
-- verificado en 002/003: SELECT ... FOR UPDATE aplica la política de escritura).
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    perform registrar_corte('d0000000-0000-0000-0000-0000000000b1', 'mora', 'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 2 FALLÓ: admin A pudo cortar un suscriptor del cliente B';
  exception when others then
    if sqlerrm not like '%no existe%' then raise; end if;
  end;

  begin
    perform reconectar('d0000000-0000-0000-0000-0000000000b1', 0, null, 'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 2 FALLÓ: admin A pudo reconectar un suscriptor del cliente B';
  exception when others then
    if sqlerrm not like '%no existe%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 3: lector A no puede cortar ni reconectar un suscriptor del MISMO
-- cliente (RLS de escritura, no solo lectura, bloquea el FOR UPDATE).
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a2'; -- Lector A
do $$
begin
  begin
    perform registrar_corte('d0000000-0000-0000-0000-0000000000a1', 'mora', 'a0000000-0000-0000-0000-0000000000a2');
    raise exception 'PASO 3 FALLÓ: lector A pudo cortar un suscriptor';
  exception when others then
    if sqlerrm not like '%no existe%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 4: corte exitoso + rechazo de un segundo corte sobre el mismo
-- suscriptor ya cortado.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  v_id_evento uuid;
  v_estado    estado_suscriptor;
begin
  select registrar_corte('d0000000-0000-0000-0000-0000000000a2', 'Mora de 90 días',
                          'a0000000-0000-0000-0000-0000000000a1') into v_id_evento;

  select estado into v_estado from usuarios_servicio where id = 'd0000000-0000-0000-0000-0000000000a2';
  if v_estado <> 'cortado' then
    raise exception 'PASO 4 FALLÓ: el suscriptor no quedó cortado (estado = %)', v_estado;
  end if;

  if not exists (select 1 from cortes_reconexiones where id = v_id_evento and tipo = 'corte'
                   and motivo = 'Mora de 90 días' and responsable = 'a0000000-0000-0000-0000-0000000000a1') then
    raise exception 'PASO 4 FALLÓ: no quedó el registro de corte esperado en el historial';
  end if;

  begin
    perform registrar_corte('d0000000-0000-0000-0000-0000000000a2', 'otro motivo',
                             'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 4 FALLÓ: se pudo cortar dos veces al mismo suscriptor';
  exception when others then
    if sqlerrm not like '%ya está cortado%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 5: reconectar() sobre un suscriptor que NO está cortado falla explícito.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
begin
  begin
    perform reconectar('d0000000-0000-0000-0000-0000000000a1', 0, null, 'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 5 FALLÓ: se pudo "reconectar" un suscriptor activo';
  exception when others then
    if sqlerrm not like '%no está cortado%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 6: reconexión SIN deuda vencida — no exige motivo, genera la factura
-- de reconexión con el monto de configuracion.valor_reconexion, numero con
-- prefijo_reconexion, periodo_id NULL.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  v_id_evento  uuid;
  v_factura_id uuid;
  v_total      numeric(12,2);
  v_tipo       tipo_factura;
  v_numero     text;
  v_periodo    uuid;
begin
  -- valor_reconexion real y distinto de cero, para que el test de "monto
  -- correcto" sea significativo (el default de configuracion es 0).
  update configuracion set valor_reconexion = 45000 where cliente_id = 'a0000000-0000-0000-0000-000000000001';

  perform registrar_corte('d0000000-0000-0000-0000-0000000000a2', 'Mora de 90 días',
                           'a0000000-0000-0000-0000-0000000000a1');

  select reconectar('d0000000-0000-0000-0000-0000000000a2', 0, null,
                     'a0000000-0000-0000-0000-0000000000a1') into v_id_evento;

  select factura_reconexion_id into v_factura_id from cortes_reconexiones where id = v_id_evento;
  if v_factura_id is null then
    raise exception 'PASO 6 FALLÓ: el evento de reconexión no quedó vinculado a ninguna factura';
  end if;

  select total, tipo, numero, periodo_id into v_total, v_tipo, v_numero, v_periodo
    from facturas where id = v_factura_id;
  if v_total <> 45000 then raise exception 'PASO 6 FALLÓ: total de la factura = % (esperaba 45000)', v_total; end if;
  if v_tipo <> 'reconexion' then raise exception 'PASO 6 FALLÓ: tipo de factura = %', v_tipo; end if;
  if v_numero not like 'REC-%' then raise exception 'PASO 6 FALLÓ: numero = % (esperaba prefijo REC-)', v_numero; end if;
  if v_periodo is not null then raise exception 'PASO 6 FALLÓ: periodo_id no es NULL'; end if;

  if (select estado from usuarios_servicio where id = 'd0000000-0000-0000-0000-0000000000a2') <> 'activo' then
    raise exception 'PASO 6 FALLÓ: el suscriptor no volvió a activo';
  end if;

  -- ya activo: un segundo intento de reconexión se rechaza
  begin
    perform reconectar('d0000000-0000-0000-0000-0000000000a2', 0, null, 'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 6 FALLÓ: se pudo reconectar dos veces';
  exception when others then
    if sqlerrm not like '%no está cortado%' then raise; end if;
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- PASO 7: reconexión CON deuda vencida — sin motivo de excepción se rechaza;
-- con motivo, se acepta y queda registrada la deuda_vencida_al_reconectar.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-0000000000a1';
do $$
declare
  v_id_evento uuid;
begin
  perform registrar_corte('d0000000-0000-0000-0000-0000000000a1', 'Mora de 120 días',
                           'a0000000-0000-0000-0000-0000000000a1');

  -- deuda vencida simulada (100000): en producción la calcula lib/cortes.ts
  -- vía obtenerCartera() antes de llamar esta función (plan.md §5) — aquí se
  -- pasa directamente el valor para testear el comportamiento de la función.
  begin
    perform reconectar('d0000000-0000-0000-0000-0000000000a1', 100000, null,
                        'a0000000-0000-0000-0000-0000000000a1');
    raise exception 'PASO 7 FALLÓ: se reconectó con deuda vencida sin motivo de excepción';
  exception when others then
    if sqlerrm not like '%motivo de excepción es obligatorio%' then raise; end if;
  end;

  select reconectar('d0000000-0000-0000-0000-0000000000a1', 100000, 'Excepción autorizada por Mateo',
                     'a0000000-0000-0000-0000-0000000000a1') into v_id_evento;

  if not exists (
    select 1 from cortes_reconexiones
     where id = v_id_evento and deuda_vencida_al_reconectar = 100000
       and motivo = 'Excepción autorizada por Mateo'
  ) then
    raise exception 'PASO 7 FALLÓ: no quedó registrada la excepción con su deuda vencida';
  end if;
end $$;
rollback;

\echo 'CORTES-AISLAMIENTO OK'
