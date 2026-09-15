-- =============================================================================
-- UndreoCol — Rutas/zonas del lector (037)
-- Migración: 20260927090000_rutas-zonas-lector.sql
-- Serie 900+: 037 no está en el roadmap original, igual que 017/018/035.
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/905_rutas_zonas_lector_aislamiento.sql
-- Requiere tests/fixtures/fundacion.sql aplicado (clientes A/B, Admin A
-- a0000000-0000-0000-0000-0000000000a1, Lector A a0000000-0000-0000-0000-0000000000a2,
-- suscriptores A-001/A-002 en Acueducto A).
--
-- Extiende la fundación DENTRO de esta transacción (rollback al final, sin
-- residuo — mismo patrón que 903): un segundo lector de A sin asignación
-- (CA-3), una secretaria de A (CA-6), un tercer suscriptor sin sector (CA-5),
-- contadores/periodo/lecturas reales para poder probar el filtro de
-- lecturas_lectura, no solo el de usuarios_servicio_lector().
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- SETUP: sectores en A-001/A-002, tercer suscriptor sin sector, segundo
-- lector y una secretaria de Acueducto A, contadores + periodo + lecturas,
-- Lector A2 asignado solo a 'Centro'.
-- ---------------------------------------------------------------------------
update usuarios_servicio set sector = 'Centro' where id = 'd0000000-0000-0000-0000-0000000000a1'; -- A-001
update usuarios_servicio set sector = 'Norte'  where id = 'd0000000-0000-0000-0000-0000000000a2'; -- A-002

insert into usuarios_servicio (id, cliente_id, codigo_suscriptor, nombre, sector) values
  ('d0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'A-003', 'Suscriptor A3', null);

insert into perfiles (id, nombre, email) values
  ('a0000000-0000-0000-0000-0000000000a4', 'Lector A2 (sin sector)', 'lector-a2-sinsector@test.local'),
  ('a0000000-0000-0000-0000-0000000000a5', 'Secretaria A', 'secretaria-a@test.local');
insert into membresias (perfil_id, cliente_id, rol) values
  ('a0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'lector'),
  ('a0000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'secretaria');

insert into contadores (id, cliente_id, usuario_servicio_id, serial, capacidad_maxima, fecha_instalacion) values
  ('e0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1', 'SERIAL-A1', 9999, '2026-01-01'),
  ('e0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a2', 'SERIAL-A2', 9999, '2026-01-01');

insert into periodos (id, cliente_id, nombre, anio, mes, fecha_inicio, fecha_fin, fecha_vencimiento) values
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Periodo de prueba 905', 2026, 9, '2026-09-01', '2026-09-30', '2026-10-10');

insert into lecturas (id, cliente_id, contador_id, periodo_id, fecha_lectura, lectura_anterior, lectura_actual, consumo_m3) values
  ('11110000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000001', '2026-09-05', 0, 10, 10), -- Centro (A-001)
  ('11110000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-000000000001', '2026-09-05', 0, 20, 20); -- Norte (A-002)

insert into lector_sectores (cliente_id, perfil_id, sector) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2', 'Centro');

-- ---------------------------------------------------------------------------
-- PASO 1 (CA-2): Lector A2 (asignado solo a Centro) via
--   usuarios_servicio_lector() ve SOLO A-001, no A-002 ni A-003 (sin sector)
-- ---------------------------------------------------------------------------
do $$
declare codigos text[];
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a2',true);
  select array_agg(codigo_suscriptor order by codigo_suscriptor) into codigos
    from usuarios_servicio_lector('a0000000-0000-0000-0000-000000000001');
  reset role;
  if codigos <> array['A-001'] then
    raise exception 'PASO 1 FALLÓ: Lector A2 (Centro) vio %, esperaba solo {A-001}', codigos;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 2 (CA-2/CA-4): Lector A2 en `select * from lecturas` ve SOLO la
--   lectura del contador de Centro (A-001), no la de Norte (A-002)
-- ---------------------------------------------------------------------------
do $$
declare n_centro int; declare n_norte int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a2',true);
  select count(*) into n_centro from lecturas where id = '11110000-0000-0000-0000-000000000001';
  select count(*) into n_norte from lecturas where id = '11110000-0000-0000-0000-000000000002';
  reset role;
  if n_centro <> 1 then
    raise exception 'PASO 2 FALLÓ: Lector A2 no vio la lectura de su propio sector (Centro)';
  end if;
  if n_norte <> 0 then
    raise exception 'PASO 2 FALLÓ: Lector A2 vio una lectura de Norte, fuera de su sector asignado';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 3 (CA-3, regresión): Lector A4 (sin ninguna fila en lector_sectores)
--   sigue viendo TODO — usuarios_servicio_lector() y lecturas
-- ---------------------------------------------------------------------------
do $$
declare codigos text[];
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a4',true);
  select array_agg(codigo_suscriptor order by codigo_suscriptor) into codigos
    from usuarios_servicio_lector('a0000000-0000-0000-0000-000000000001');
  reset role;
  if codigos <> array['A-001','A-002','A-003'] then
    raise exception 'PASO 3 FALLÓ: Lector A4 (sin asignación) vio %, esperaba los 3 suscriptores', codigos;
  end if;
end $$;

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a4',true);
  select count(*) into n from lecturas where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  reset role;
  if n <> 2 then
    raise exception 'PASO 3 FALLÓ: Lector A4 (sin asignación) vio % lecturas, esperaba 2 (ambos sectores)', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 4 (CA-6): admin_acueducto A1 y secretaria A5 no pierden visibilidad —
--   ven los 3 suscriptores (incluido A-003 sin sector) pese al filtro nuevo
-- ---------------------------------------------------------------------------
do $$
declare codigos text[];
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a1',true);
  select array_agg(codigo_suscriptor order by codigo_suscriptor) into codigos
    from usuarios_servicio_lector('a0000000-0000-0000-0000-000000000001');
  reset role;
  if codigos <> array['A-001','A-002','A-003'] then
    raise exception 'PASO 4 FALLÓ: admin_acueducto vio %, esperaba los 3 suscriptores', codigos;
  end if;
end $$;

do $$
declare codigos text[];
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a5',true);
  select array_agg(codigo_suscriptor order by codigo_suscriptor) into codigos
    from usuarios_servicio_lector('a0000000-0000-0000-0000-000000000001');
  reset role;
  if codigos <> array['A-001','A-002','A-003'] then
    raise exception 'PASO 4 FALLÓ: secretaria vio %, esperaba los 3 suscriptores', codigos;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 5 (CA-5): A-003 (sin sector) nunca aparece para un lector CON
--   sectores asignados, aunque ese lector tenga varios sectores — ya
--   probado indirectamente en PASO 1 (Lector A2 no lo vio), acá se confirma
--   explícitamente incluso agregándole un segundo sector a Lector A2
-- ---------------------------------------------------------------------------
do $$
declare codigos text[];
begin
  insert into lector_sectores (cliente_id, perfil_id, sector) values
    ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2', 'Norte');
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a2',true);
  select array_agg(codigo_suscriptor order by codigo_suscriptor) into codigos
    from usuarios_servicio_lector('a0000000-0000-0000-0000-000000000001');
  reset role;
  if codigos <> array['A-001','A-002'] then
    raise exception 'PASO 5 FALLÓ: Lector A2 con Centro+Norte vio %, A-003 (sin sector) no debería aparecer nunca', codigos;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 6: un `lector` no puede escribir en lector_sectores directo —
--   lector_sectores_escritura exige es_admin_de()
-- ---------------------------------------------------------------------------
do $$
declare bloqueado boolean := false;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-0000000000a2',true);
    insert into lector_sectores (cliente_id, perfil_id, sector)
      values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2', 'Sur');
    reset role;
  exception when insufficient_privilege or others then
    reset role;
    bloqueado := true;
  end;
  if not bloqueado then
    raise exception 'PASO 6 FALLÓ: un lector pudo insertar su propia asignación en lector_sectores';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- PASO 7 (regresión de aislamiento multi-tenant): Lector B, aunque tuviera
--   sectores asignados en su propio acueducto, nunca ve nada de Acueducto A
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-0000000000b2',true);
  select count(*) into n from lecturas where cliente_id = 'a0000000-0000-0000-0000-000000000001';
  reset role;
  if n <> 0 then
    raise exception 'PASO 7 FALLÓ (regresión multi-tenant): Lector B vio % lectura(s) de Acueducto A', n;
  end if;
end $$;

rollback;

\echo '905: RUTAS-ZONAS-LECTOR-AISLAMIENTO OK — filtro de sector en usuarios_servicio_lector() y lecturas_lectura, regresión CA-3/CA-6, protección de escritura de lector_sectores y aislamiento multi-tenant verificados'
