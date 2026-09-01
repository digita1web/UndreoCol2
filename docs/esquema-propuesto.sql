-- =============================================================================
-- UndreoCol — Esquema PostgreSQL
-- Versión: 2.0 (contra la especificación funcional definitiva)
-- PostgreSQL 15+ (Supabase o self-hosted)
--
-- La única dependencia de Supabase es auth.uid().
-- Ver bloque final "COMPATIBILIDAD SELF-HOSTED".
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. TIPOS ENUMERADOS
-- =============================================================================

create type rol_usuario as enum (
  'administrador',      -- Dueño del software. Acceso total, todos los clientes
  'admin_acueducto',    -- El cliente. Gestiona SU acueducto, nunca otros
  'lector'              -- Fontanero. Lecturas y órdenes asignadas, desde celular
);
-- NOTA (D-2): los suscriptores NO son usuarios del sistema de identidad.
-- El portal valida cédula + codigo_suscriptor en el servidor y emite su propia
-- sesión firmada. No existe rol 'suscriptor' ni cuenta en auth.users.

create type estado_cuenta       as enum ('activa','vencida','suspendida','cancelada');
create type estado_suscriptor   as enum ('activo','suspendido','cortado','inactivo');
create type estado_contador     as enum ('activo','danado','reemplazado');
create type categoria_tarifaria as enum (
  'estrato_1','estrato_2','estrato_3','estrato_4','estrato_5','estrato_6',
  'comercial','industrial','oficial'
);
create type tipo_calculo        as enum ('por_consumo','fijo');
create type estado_periodo      as enum ('abierto','cerrado');
create type estado_factura      as enum ('pendiente','pagada','vencida','anulada');
create type tipo_factura        as enum ('ciclo','reconexion','ajuste');
create type metodo_pago         as enum ('efectivo','transferencia','consignacion','pse','otro');
create type revision_lectura    as enum ('normal','consumo_alto','consumo_bajo','consumo_cero');
create type tipo_orden          as enum ('corte','reconexion');
create type estado_orden        as enum ('pendiente','asignada','ejecutada','cancelada','fallida');
create type origen_orden        as enum ('automatico','manual');
create type tipo_incapacidad    as enum ('enfermedad_general','accidente_trabajo','enfermedad_laboral');
create type estado_notificacion as enum ('pendiente','enviada','fallida');
create type estado_trabajo      as enum ('pendiente','procesando','completado','fallido');

-- =============================================================================
-- 2. PANEL MAESTRO — los clientes de UndreoCol
--    Sin cliente_id: es el nivel de la plataforma.
-- =============================================================================

create table planes (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null unique,
  limite_usuarios  integer,                      -- null = ilimitado
  valor_suscriptor numeric(12,2) not null,       -- COP por suscriptor/mes
  valor_minimo_mes numeric(12,2) not null default 0,
  activo           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table clientes (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  slug              text not null unique,        -- subdominio
  nit               text,
  direccion         text,
  municipio         text,
  departamento      text,
  telefono          text,
  email_contacto    text,
  logo_url          text,
  plan_id           uuid references planes(id),
  estado_cuenta     estado_cuenta not null default 'activa',
  fecha_alta        date not null default current_date,
  fecha_vencimiento date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_slug check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table clientes is
  'Cada acueducto cliente. clientes.id es el tenant_id que aísla todos los datos.';

-- =============================================================================
-- 3. IDENTIDAD Y ROLES
-- =============================================================================

create table perfiles (
  id         uuid primary key,                   -- = auth.users.id en Supabase
  nombre     text not null,
  email      text not null,
  telefono   text,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- El rol 'administrador' (dueño del software) se registra con cliente_id NULL.
create table membresias (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid not null references perfiles(id) on delete cascade,
  cliente_id uuid references clientes(id) on delete cascade,
  rol        rol_usuario not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_ambito_rol check (
    (rol = 'administrador' and cliente_id is null) or
    (rol <> 'administrador' and cliente_id is not null)
  )
);

create unique index uq_membresia on membresias
  (perfil_id, coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index on membresias (cliente_id, rol) where activo;
create index on membresias (perfil_id) where activo;

-- =============================================================================
-- 4. FUNCIONES DE SEGURIDAD
--    SECURITY DEFINER: evita recursión infinita en las políticas RLS.
-- =============================================================================

create or replace function es_admin_plataforma()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias
    where perfil_id = auth.uid() and rol = 'administrador' and activo);
$$;

create or replace function mis_clientes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select cliente_id from membresias
  where perfil_id = auth.uid() and activo and cliente_id is not null;
$$;

create or replace function tiene_rol(p_cliente_id uuid, p_roles rol_usuario[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias
    where perfil_id = auth.uid() and cliente_id = p_cliente_id
      and activo and rol = any(p_roles));
$$;

create or replace function es_admin_de(p_cliente_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select es_admin_plataforma()
      or tiene_rol(p_cliente_id, array['admin_acueducto']::rol_usuario[]);
$$;

-- =============================================================================
-- 5. CONFIGURACIÓN POR CLIENTE
--    Todo umbral que la especificación llama "configurable" vive aquí.
-- =============================================================================

create table configuracion (
  cliente_id           uuid primary key references clientes(id) on delete cascade,
  -- Mora y cartera
  porcentaje_mora      numeric(6,3) not null default 2.0,   -- % sobre saldo vencido
  dias_vencimiento     integer not null default 30,
  dias_umbral_corte    integer not null default 60,
  valor_reconexion     numeric(12,2) not null default 0,
  -- Detección de anomalías en lecturas
  factor_consumo_alto  numeric(6,2) not null default 150.0, -- % del promedio histórico
  piso_consumo_alto_m3 numeric(10,2) not null default 100.0,
  factor_consumo_bajo  numeric(6,2) not null default 20.0,
  -- Rollover
  umbral_rollover_pct  numeric(6,2) not null default 90.0,  -- % de capacidad máxima
  -- Facturación (D-3)
  prefijo_factura      text not null default 'FAC',   -- ciclo y ajuste
  prefijo_reconexion   text not null default 'REC',   -- reconexiones
  consecutivo_factura  integer not null default 0,    -- reinicia cada año
  anio_consecutivo     smallint not null default extract(year from current_date)::smallint,
  updated_at           timestamptz not null default now()
);

comment on column configuracion.piso_consumo_alto_m3 is
  'Pasar de 2 a 4 m³ triplica el promedio pero no es anomalía. Este piso evita el ruido.';

-- =============================================================================
-- 6. CATÁLOGO DE SERVICIOS Y TARIFAS
-- =============================================================================

create table servicios (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references clientes(id) on delete cascade,
  codigo       text not null,                    -- acueducto, alcantarillado, aseo
  nombre       text not null,
  tipo_calculo tipo_calculo not null,
  facturable_en_ciclo boolean not null default true,  -- false para reconexión
  orden        smallint not null default 0,
  activo       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (cliente_id, codigo)
);

comment on table servicios is
  'Catálogo configurable. Un acueducto factura solo agua; otro agua + alcantarillado + aseo.';

-- Estructura básico / no básico, conforme a la regulación colombiana (CRA).
create table tarifas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  servicio_id         uuid not null references servicios(id) on delete cascade,
  categoria           categoria_tarifaria not null,
  vigencia_desde      date not null,
  vigencia_hasta      date,                       -- null = vigente
  cargo_fijo          numeric(12,2) not null default 0,
  limite_basico_m3    numeric(10,2) not null default 0,   -- INCLUSIVO (D-1)
  precio_basico_m3    numeric(12,4) not null default 0,
  precio_no_basico_m3 numeric(12,4) not null default 0,
  created_at          timestamptz not null default now(),
  constraint chk_vigencia check (vigencia_hasta is null or vigencia_hasta > vigencia_desde),
  unique (servicio_id, categoria, vigencia_desde)
);

create index on tarifas (cliente_id, servicio_id, categoria, vigencia_desde desc);

comment on table tarifas is
  'Versionada por vigencia: una tarifa nunca se edita, se cierra y se crea una nueva. '
  'Al cambiar un precio: vigencia_hasta de la anterior = hoy-1, vigencia_desde de la nueva = hoy. '
  'Una factura histórica siempre se recalcula con su tarifa original via factura_detalles.tarifa_id.';
comment on column tarifas.vigencia_desde is
  'Primer día en que esta tarifa aplica. Gestionado automáticamente por la capa de aplicación, nunca por el usuario directamente.';
comment on column tarifas.vigencia_hasta is
  'Último día de vigencia. null = tarifa activa hoy. Se cierra automáticamente al crear una nueva versión. Nunca se puede eliminar si tiene facturas emitidas.';
comment on column tarifas.limite_basico_m3 is
  'INCLUSIVO (D-1). consumo_basico = min(consumo, limite). consumo_no_basico = max(0, consumo - limite). Con límite 22 y consumo 25: 22 básicos + 3 no básicos.';

-- Función helper: tarifa vigente para un servicio + categoría en una fecha dada.
-- Usada por core/tarifas.ts a través de la capa de servidor.
-- Devuelve NULL si no hay tarifa configurada (el cierre debe reportar el error).
create or replace function tarifa_vigente(
  p_servicio_id uuid,
  p_categoria   categoria_tarifaria,
  p_fecha       date default current_date
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from tarifas
  where servicio_id    = p_servicio_id
    and categoria      = p_categoria
    and vigencia_desde <= p_fecha
    and (vigencia_hasta is null or vigencia_hasta >= p_fecha)
  order by vigencia_desde desc
  limit 1;
$$;

comment on function tarifa_vigente is
  'Devuelve el id de la tarifa vigente para un servicio+categoría en una fecha. '
  'El cierre de facturación la llama con la fecha de ejecución del cierre. '
  'Si devuelve NULL, el cierre debe marcar al suscriptor como sin tarifa configurada, '
  'registrar la anomalía y no emitir la factura.';

-- =============================================================================
-- 7. SUSCRIPTORES Y CONTADORES
-- =============================================================================

create table usuarios_servicio (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references clientes(id) on delete cascade,
  codigo_suscriptor  text not null,               -- credencial del portal
  nombre             text not null,
  tipo_documento     text,
  numero_documento   text not null,               -- credencial del portal
  telefono           text,
  email              text,
  direccion          text not null,
  sector             text,
  categoria          categoria_tarifaria not null,
  contador_actual_id uuid,                        -- FK añadida tras crear contadores
  estado             estado_suscriptor not null default 'activo',
  fecha_vinculacion  date not null default current_date,
  notas              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (cliente_id, codigo_suscriptor)
);

create index on usuarios_servicio (cliente_id, estado);
create index on usuarios_servicio (cliente_id, numero_documento);

comment on column usuarios_servicio.codigo_suscriptor is
  'Con numero_documento forma la credencial del portal de autoservicio (sin contraseña).';

create table contadores (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  serial              text not null,
  marca               text,
  capacidad_maxima    numeric(12,2) not null,     -- ej. 99999. Define el rollover
  lectura_inicial     numeric(12,2) not null default 0,
  fecha_instalacion   date not null,
  estado              estado_contador not null default 'activo',
  observaciones       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (cliente_id, serial),
  constraint chk_capacidad check (capacidad_maxima > 0)
);

create unique index uq_contador_activo
  on contadores (usuario_servicio_id) where estado = 'activo';
create index on contadores (cliente_id, usuario_servicio_id);

comment on column contadores.capacidad_maxima is
  'Rollover: si lectura_actual < lectura_anterior Y lectura_anterior > capacidad_maxima * umbral_rollover_pct/100, hubo vuelta. Consumo = (capacidad_maxima - anterior) + actual.';

alter table usuarios_servicio
  add constraint fk_contador_actual
  foreign key (contador_actual_id) references contadores(id) on delete set null;

-- Cambio físico de contador a mitad de periodo
create table reemplazos_contador (
  id                     uuid primary key default gen_random_uuid(),
  cliente_id             uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id    uuid not null references usuarios_servicio(id) on delete restrict,
  contador_anterior_id   uuid not null references contadores(id) on delete restrict,
  contador_nuevo_id      uuid not null references contadores(id) on delete restrict,
  fecha_reemplazo        date not null,
  lectura_final_anterior numeric(12,2) not null,
  lectura_inicial_nuevo  numeric(12,2) not null default 0,
  motivo                 text,
  registrado_por         uuid references perfiles(id),
  created_at             timestamptz not null default now(),
  constraint chk_distintos check (contador_anterior_id <> contador_nuevo_id)
);

create index on reemplazos_contador (cliente_id, usuario_servicio_id, fecha_reemplazo);

comment on table reemplazos_contador is
  'Consumo del periodo = (lectura_final_anterior − última lectura del saliente) + (lectura del nuevo − lectura_inicial_nuevo). Una sola factura, sin duplicar ni perder consumo.';

-- =============================================================================
-- 8. PERIODOS Y LECTURAS
-- =============================================================================

create table periodos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  nombre            text not null,                -- 'Enero 2026'
  anio              smallint not null,
  mes               smallint not null check (mes between 1 and 12),
  fecha_inicio      date not null,
  fecha_fin         date not null,
  fecha_vencimiento date not null,
  estado            estado_periodo not null default 'abierto',
  fecha_cierre      timestamptz,
  cerrado_por       uuid references perfiles(id),
  created_at        timestamptz not null default now(),
  unique (cliente_id, anio, mes),
  constraint chk_rango check (fecha_fin >= fecha_inicio)
);

-- REGLA: un solo periodo abierto por cliente
create unique index uq_periodo_abierto
  on periodos (cliente_id) where estado = 'abierto';

create table lecturas (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references clientes(id) on delete cascade,
  contador_id        uuid not null references contadores(id) on delete restrict,
  periodo_id         uuid not null references periodos(id) on delete restrict,
  fecha_lectura      date not null,
  lectura_anterior   numeric(12,2) not null,
  lectura_actual     numeric(12,2) not null,
  consumo_m3         numeric(12,2) not null,
  hubo_rollover      boolean not null default false,
  -- Anomalías: marcan para revisión, NUNCA bloquean el guardado
  revision           revision_lectura not null default 'normal',
  promedio_historico numeric(12,2),
  revisada           boolean not null default false,
  revisada_por       uuid references perfiles(id),
  tomada_por         uuid references perfiles(id),
  foto_url           text,
  latitud            numeric(10,7),
  longitud           numeric(10,7),
  observaciones      text,
  id_cliente_offline text unique,                 -- idempotencia app móvil
  created_at         timestamptz not null default now(),
  constraint chk_consumo check (consumo_m3 >= 0),
  -- Bloquea lecturas duplicadas del mismo contador en el mismo periodo
  unique (contador_id, periodo_id)
);

create index on lecturas (cliente_id, periodo_id);
create index on lecturas (contador_id, fecha_lectura desc);
create index on lecturas (cliente_id, revision) where revision <> 'normal' and not revisada;

comment on column lecturas.revision is
  'consumo_alto: > factor_consumo_alto% del promedio Y > piso_consumo_alto_m3. consumo_bajo: < factor_consumo_bajo% del promedio. consumo_cero: consumo = 0.';
comment on column lecturas.id_cliente_offline is
  'UUID generado en el celular. Si la app reenvía por falla de red, no se duplica.';

-- =============================================================================
-- 9. FACTURACIÓN
-- =============================================================================

create table facturas (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  periodo_id          uuid references periodos(id) on delete restrict,  -- null en reconexión
  tipo                tipo_factura not null default 'ciclo',
  numero              text not null,
  snapshot_suscriptor jsonb not null,             -- datos del suscriptor al emitir
  consumo_m3          numeric(12,2) not null default 0,
  subtotal_servicios  numeric(12,2) not null default 0,
  recargo_mora        numeric(12,2) not null default 0,
  saldo_anterior      numeric(12,2) not null default 0,
  total               numeric(12,2) not null default 0,
  total_pagado        numeric(12,2) not null default 0,
  fecha_emision       date not null default current_date,
  fecha_vencimiento   date not null,
  estado              estado_factura not null default 'pendiente',
  motivo_anulacion    text,
  anulada_por         uuid references perfiles(id),
  pdf_url             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (cliente_id, numero)
);

create unique index uq_factura_ciclo
  on facturas (usuario_servicio_id, periodo_id) where tipo = 'ciclo';
create index on facturas (cliente_id, estado);
create index on facturas (usuario_servicio_id, fecha_emision desc);
create index on facturas (cliente_id, fecha_vencimiento)
  where estado in ('pendiente','vencida');

comment on column facturas.recargo_mora is
  'porcentaje_mora % sobre el saldo vencido del MISMO suscriptor, excluyendo esta factura.';

-- Un renglón por cada servicio activo, sobre el mismo consumo_m3
create table factura_detalles (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references clientes(id) on delete cascade,
  factura_id           uuid not null references facturas(id) on delete cascade,
  servicio_id          uuid references servicios(id) on delete set null,
  tarifa_id            uuid references tarifas(id) on delete set null,
  orden                smallint not null default 0,
  descripcion          text not null,
  tipo_calculo         tipo_calculo not null,
  consumo_m3           numeric(12,2) not null default 0,
  cargo_fijo           numeric(12,2) not null default 0,
  consumo_basico_m3    numeric(12,2) not null default 0,
  valor_basico         numeric(12,2) not null default 0,
  consumo_no_basico_m3 numeric(12,2) not null default 0,
  valor_no_basico      numeric(12,2) not null default 0,
  subtotal             numeric(12,2) not null default 0
);

create index on factura_detalles (factura_id, orden);

comment on table factura_detalles is
  'Desglose auditable: guarda cantidades y valores por bloque para reproducir el cálculo años después.';

-- Una factura puede consumir DOS lecturas (caso reemplazo de contador)
create table factura_lecturas (
  factura_id uuid not null references facturas(id) on delete cascade,
  lectura_id uuid not null references lecturas(id) on delete restrict,
  cliente_id uuid not null references clientes(id) on delete cascade,
  primary key (factura_id, lectura_id)
);

-- =============================================================================
-- 10. PAGOS
-- =============================================================================

create table pagos (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  valor               numeric(12,2) not null check (valor > 0),
  fecha_pago          date not null default current_date,
  metodo              metodo_pago not null default 'efectivo',
  referencia          text,
  recibido_por        uuid references perfiles(id),
  anulado             boolean not null default false,
  motivo_anulacion    text,
  observaciones       text,
  created_at          timestamptz not null default now()
);

create index on pagos (cliente_id, fecha_pago desc);
create index on pagos (usuario_servicio_id) where not anulado;

create table pago_aplicaciones (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  pago_id    uuid not null references pagos(id) on delete cascade,
  factura_id uuid not null references facturas(id) on delete restrict,
  valor      numeric(12,2) not null check (valor > 0)
);

create index on pago_aplicaciones (factura_id);
create index on pago_aplicaciones (pago_id);

-- =============================================================================
-- 11. CORTES Y RECONEXIONES
-- =============================================================================

create table ordenes (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id   uuid not null references usuarios_servicio(id) on delete restrict,
  tipo                  tipo_orden not null,
  origen                origen_orden not null default 'manual',
  motivo                text,
  deuda_vencida         numeric(12,2),
  dias_mora             integer,
  -- Reconexión con deuda pendiente: exige rastro
  forzada               boolean not null default false,
  motivo_excepcion      text,
  autorizada_por        uuid references perfiles(id),
  asignada_a            uuid references perfiles(id),
  fecha_programada      date,
  fecha_ejecucion       timestamptz,
  ejecutada_por         uuid references perfiles(id),
  estado                estado_orden not null default 'pendiente',
  factura_reconexion_id uuid references facturas(id) on delete set null,
  foto_url              text,
  observaciones         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_forzada check (
    not forzada or (motivo_excepcion is not null and autorizada_por is not null)
  )
);

create index on ordenes (cliente_id, estado, tipo);
create index on ordenes (asignada_a, estado) where estado in ('pendiente','asignada');
create index on ordenes (usuario_servicio_id, created_at desc);

comment on column ordenes.forzada is
  'Reconexión autorizada pese a deuda vencida. Exige motivo y autorizador: queda el rastro.';

-- =============================================================================
-- 12. NOTIFICACIONES Y TRABAJOS
--     Cola desacoplada: un fallo de envío NUNCA bloquea la facturación.
-- =============================================================================

create table notificaciones (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid references usuarios_servicio(id) on delete cascade,
  factura_id          uuid references facturas(id) on delete cascade,
  tipo                text not null,             -- factura_generada, recordatorio, mora, pago
  canal               text not null default 'email',
  destinatario        text,
  asunto              text,
  estado              estado_notificacion not null default 'pendiente',
  intentos            smallint not null default 0,
  ultimo_error        text,
  enviada_en          timestamptz,
  created_at          timestamptz not null default now()
);

create index on notificaciones (estado, created_at) where estado = 'pendiente';
create index on notificaciones (cliente_id, created_at desc);

create table trabajos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid references clientes(id) on delete cascade,
  tipo         text not null,
  payload      jsonb not null default '{}',
  estado       estado_trabajo not null default 'pendiente',
  total_items  integer not null default 0,
  items_ok     integer not null default 0,
  items_error  integer not null default 0,
  error        text,
  creado_por   uuid references perfiles(id),
  iniciado_en  timestamptz,
  terminado_en timestamptz,
  created_at   timestamptz not null default now()
);

create index on trabajos (estado, created_at) where estado in ('pendiente','procesando');

-- =============================================================================
-- 13. RRHH / INCAPACIDADES (módulo independiente)
-- =============================================================================

create table empleados (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references clientes(id) on delete cascade,
  nombre           text not null,
  tipo_documento   text,
  numero_documento text not null,
  cargo            text,
  salario_base     numeric(12,2) not null check (salario_base > 0),
  eps              text,
  arl              text,
  fondo_pension    text,
  fecha_ingreso    date not null,
  fecha_retiro     date,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (cliente_id, numero_documento)
);

create index on empleados (cliente_id, activo);

create table incapacidades (
  id                    uuid primary key default gen_random_uuid(),
  cliente_id            uuid not null references clientes(id) on delete cascade,
  empleado_id           uuid not null references empleados(id) on delete cascade,
  tipo                  tipo_incapacidad not null,
  fecha_inicio          date not null,
  fecha_fin             date not null,
  dias                  integer generated always as (fecha_fin - fecha_inicio + 1) stored,
  -- Prórroga: continúa el conteo acumulado del certificado original
  incapacidad_origen_id uuid references incapacidades(id) on delete set null,
  dia_acumulado_inicio  integer not null default 1,
  diagnostico_cie10     text,
  salario_base          numeric(12,2) not null,   -- snapshot al calcular
  valor_empleador       numeric(12,2) not null default 0,
  valor_eps             numeric(12,2) not null default 0,
  valor_arl             numeric(12,2) not null default 0,
  valor_total           numeric(12,2) not null default 0,
  requiere_gestion_manual boolean not null default false,   -- día 181+
  detalle_calculo       jsonb,
  soporte_url           text,
  observaciones         text,
  created_at            timestamptz not null default now(),
  constraint chk_rango check (fecha_fin >= fecha_inicio)
);

create index on incapacidades (cliente_id, empleado_id, fecha_inicio desc);

comment on column incapacidades.dia_acumulado_inicio is
  'Una prórroga que arranca en el día 91 del conteo acumulado se liquida al 50%, no al 66.67%.';
comment on column incapacidades.detalle_calculo is
  'Tramos aplicados: [{desde_dia, hasta_dia, dias, porcentaje, responsable, valor}].';

-- =============================================================================
-- 14. AUDITORÍA
-- =============================================================================

create table auditoria (
  id          bigserial primary key,
  cliente_id  uuid references clientes(id) on delete cascade,
  perfil_id   uuid references perfiles(id),
  tabla       text not null,
  registro_id uuid,
  accion      text not null,
  antes       jsonb,
  despues     jsonb,
  created_at  timestamptz not null default now()
);

create index on auditoria (cliente_id, created_at desc);
create index on auditoria (tabla, registro_id);

-- =============================================================================
-- 15. TRIGGER updated_at
-- =============================================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'clientes','perfiles','usuarios_servicio','contadores','facturas',
    'ordenes','empleados'
  ] loop
    execute format(
      'create trigger trg_%s_updated before update on %I
       for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- =============================================================================
-- 16. ROW LEVEL SECURITY
--     FORCE: aplica incluso al dueño de la tabla. Nada se salta el filtro.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'planes','clientes','perfiles','membresias','configuracion','servicios',
    'tarifas','usuarios_servicio','contadores','reemplazos_contador','periodos',
    'lecturas','facturas','factura_detalles','factura_lecturas','pagos',
    'pago_aplicaciones','ordenes','notificaciones','trabajos','empleados',
    'incapacidades','auditoria'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- --- Política estándar para tablas con cliente_id ----------------------------
-- Lectura: cualquier miembro activo del cliente, o el dueño de la plataforma.
-- Escritura: solo admin del acueducto o dueño de la plataforma.
-- Las excepciones por rol (lector) se añaden después.

do $$
declare t text;
begin
  foreach t in array array[
    'configuracion','servicios','tarifas','usuarios_servicio','contadores',
    'reemplazos_contador','periodos','facturas','factura_detalles',
    'factura_lecturas','pagos','pago_aplicaciones','ordenes','notificaciones',
    'trabajos','empleados','incapacidades'
  ] loop
    execute format($p$
      create policy %1$s_lectura on %1$I for select
        using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
      create policy %1$s_escritura on %1$I for all
        using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
    $p$, t);
  end loop;
end $$;

-- --- Panel maestro -----------------------------------------------------------

create policy planes_lectura on planes for select using (true);
create policy planes_escritura on planes for all
  using (es_admin_plataforma()) with check (es_admin_plataforma());

create policy clientes_lectura on clientes for select
  using (es_admin_plataforma() or id in (select mis_clientes()));
create policy clientes_plataforma on clientes for all
  using (es_admin_plataforma()) with check (es_admin_plataforma());
-- El admin del acueducto edita los datos de su acueducto, pero NO su plan
-- ni su estado de cuenta: eso se protege con un trigger de columnas.
create policy clientes_update_propio on clientes for update
  using (tiene_rol(id, array['admin_acueducto']::rol_usuario[]))
  with check (tiene_rol(id, array['admin_acueducto']::rol_usuario[]));

-- --- Identidad ---------------------------------------------------------------

create policy perfiles_lectura on perfiles for select
  using (
    id = auth.uid()
    or es_admin_plataforma()
    or exists (select 1 from membresias m
         where m.perfil_id = perfiles.id and m.cliente_id in (select mis_clientes()))
  );
create policy perfiles_update_propio on perfiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy membresias_lectura on membresias for select
  using (perfil_id = auth.uid() or es_admin_plataforma()
         or cliente_id in (select mis_clientes()));

-- REGLA CRÍTICA: el admin del acueducto crea usuarios de SU acueducto,
-- pero NUNCA puede otorgar el rol 'administrador', ni a otros ni a sí mismo.
create policy membresias_gestion_acueducto on membresias for all
  using (
    cliente_id is not null
    and tiene_rol(cliente_id, array['admin_acueducto']::rol_usuario[])
    and rol in ('admin_acueducto','lector')
  )
  with check (
    cliente_id is not null
    and tiene_rol(cliente_id, array['admin_acueducto']::rol_usuario[])
    and rol in ('admin_acueducto','lector')
  );

create policy membresias_plataforma on membresias for all
  using (es_admin_plataforma()) with check (es_admin_plataforma());

-- --- Lecturas: el lector crea y consulta -------------------------------------

create policy lecturas_lectura on lecturas for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy lecturas_admin on lecturas for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
create policy lecturas_lector_inserta on lecturas for insert
  with check (tiene_rol(cliente_id, array['lector']::rol_usuario[]));

-- --- Órdenes: el lector ejecuta las que tiene asignadas ----------------------

create policy ordenes_lector on ordenes for update
  using (asignada_a = auth.uid()
         and tiene_rol(cliente_id, array['lector']::rol_usuario[]))
  with check (asignada_a = auth.uid());

-- --- Portal del suscriptor (D-2) ---------------------------------------------
-- El portal NO usa auth.uid(). Valida cédula + codigo_suscriptor en el servidor
-- y consulta con una conexión de servicio, filtrando por usuario_servicio_id.
-- El aislamiento del portal es responsabilidad de la capa de servidor, no de RLS.
-- Se define en la feature 008.

-- --- Auditoría ---------------------------------------------------------------

create policy auditoria_lectura on auditoria for select
  using (es_admin_de(cliente_id));

-- =============================================================================
-- COMPATIBILIDAD SELF-HOSTED (sin Supabase)
--
-- Crear ANTES de este esquema; no se cambia nada más:
--
--   create schema if not exists auth;
--   create or replace function auth.uid() returns uuid language sql stable as $$
--     select nullif(current_setting('app.perfil_id', true), '')::uuid;
--   $$;
--
-- La aplicación ejecuta al inicio de cada transacción:
--   set local app.perfil_id = '<uuid del usuario autenticado>';
-- =============================================================================


-- =============================================================================
-- 18. SOPORTE PARA D-7 — Supabase Free explotado al máximo
--     Ver docs/DECISIONES.md D-7 e INFRAESTRUCTURA.md §5 y §8.
-- =============================================================================

-- --- Worker de keepalive (INFRAESTRUCTURA.md §5) -----------------------------
-- Evita que el proyecto se pause tras 7 días de inactividad en el plan Free.

create table if not exists _keepalive (
  id           smallint primary key default 1,
  ultimo_ping  timestamptz not null default now(),
  constraint chk_singleton check (id = 1)
);

insert into _keepalive (id, ultimo_ping) values (1, now())
  on conflict (id) do nothing;

comment on table _keepalive is
  'Tabla técnica de soporte para el Worker de keepalive (D-7). '
  'Sin cliente_id ni RLS de negocio: solo accesible con service_role_key '
  'desde el Worker de cron, nunca desde una ruta de la API pública.';

alter table _keepalive enable row level security;
alter table _keepalive force row level security;
-- Sin políticas: por defecto nadie (anon/authenticated) puede tocarla.
-- service_role bypasea RLS por diseño de Supabase.

-- --- Worker de monitoreo de tamaño de base (INFRAESTRUCTURA.md §8) ----------
-- Alerta antes de llegar al límite de 500 MB del plan Free.

create or replace function tamano_base_mb()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2);
$$;

comment on function tamano_base_mb is
  'Tamaño actual de la base de datos en MB. Usada por el Worker de '
  'monitoreo (INFRAESTRUCTURA.md §8) para alertar en 300/400/480 MB, '
  'antes del límite de 500 MB del plan Free de Supabase (D-7).';

revoke execute on function tamano_base_mb from anon, authenticated;
grant execute on function tamano_base_mb to service_role;