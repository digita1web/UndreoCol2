-- =============================================================================
-- UndreoCol — Fixtures multi-tenant para tests de aislamiento (plan §6.1)
-- Referencia: specs/001-fundacion/plan.md §6.1
--
-- Idempotente (limpia al inicio). Se ejecuta como postgres / service_role SOLO
-- por ser fixture de test: el superusuario evade RLS y FORCE por diseño de
-- PostgreSQL (BYPASSRLS), lo que permite sembrar datos que luego los tests
-- consultan simulando roles reales (anon, authenticated).
--
-- Ejecutar con: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
-- Requiere la migración fundacional aplicada.
-- =============================================================================

begin;

-- Limpieza en orden de dependencias (seguridad ante idempotencia)
delete from usuarios_servicio;
delete from configuracion;
delete from membresias;
delete from perfiles;
delete from clientes;
delete from planes;

-- -----------------------------------------------------------------------------
-- Planes (nivel plataforma)
-- -----------------------------------------------------------------------------
insert into planes (id, nombre, limite_usuarios, valor_suscriptor, valor_minimo_mes) values
  ('10000000-0000-0000-0000-000000000001', 'Basico', 100, 700.00, 0),
  ('10000000-0000-0000-0000-000000000002', 'Pro', null, 600.00, 50000.00);

-- -----------------------------------------------------------------------------
-- Clientes A y B (tenants)
-- -----------------------------------------------------------------------------
insert into clientes (id, nombre, slug, nit, plan_id) values
  ('a0000000-0000-0000-0000-000000000001', 'Acueducto A', 'acueducto-a', '900000001-1',
   '10000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'Acueducto B', 'acueducto-b', '900000002-2',
   '10000000-0000-0000-0000-000000000001');

-- -----------------------------------------------------------------------------
-- Perfiles (id = auth.users.id en Supabase; aquí uuid fijos de prueba)
-- -----------------------------------------------------------------------------
insert into perfiles (id, nombre, email) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Admin A', 'admin-a@test.local'),
  ('a0000000-0000-0000-0000-0000000000a2', 'Lector A', 'lector-a@test.local'),
  ('b0000000-0000-0000-0000-0000000000b1', 'Admin B', 'admin-b@test.local'),
  ('b0000000-0000-0000-0000-0000000000b2', 'Lector B', 'lector-b@test.local'),
  ('c0000000-0000-0000-0000-000000000001', 'Plataforma', 'plataforma@test.local');

-- -----------------------------------------------------------------------------
-- Membresías (el rol administrador se registra con cliente_id NULL)
-- -----------------------------------------------------------------------------
insert into membresias (perfil_id, cliente_id, rol) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'admin_acueducto'),
  ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'lector'),
  ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'admin_acueducto'),
  ('b0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-000000000002', 'lector'),
  ('c0000000-0000-0000-0000-000000000001', null, 'administrador');

-- -----------------------------------------------------------------------------
-- Configuraciones (valores por defecto)
-- -----------------------------------------------------------------------------
insert into configuracion (cliente_id) values
  ('a0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000002');

-- -----------------------------------------------------------------------------
-- Usuarios de servicio (tabla mínima de la fundación, SIN perfil_id)
-- -----------------------------------------------------------------------------
insert into usuarios_servicio (id, cliente_id, codigo_suscriptor, nombre) values
  ('d0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'A-001', 'Suscriptor A1'),
  ('d0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'A-002', 'Suscriptor A2'),
  ('d0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'B-001', 'Suscriptor B1');

commit;
