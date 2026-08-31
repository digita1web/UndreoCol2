# PLAN — 001 Fundación

**Feature:** 001-fundacion
**Fecha:** 2026-08-31
**Estado:** PROPUESTO — pendiente de aprobación por Mateo. No se escribe código
ni `tasks.md` hasta aprobación explícita.

---

## 0. Estado del documento y supuestos de partida

Este plan se redactó con los documentos disponibles en la raíz del proyecto
(`CLAUDE.md`, `ESPECIFICACION-FUNCIONAL.md`, `esquema-propuesto.sql`,
`DECISIONES.md`, `INFRAESTRUCTURA.md`, `CHANGELOG.md`).

**Discrepancias señaladas al momento de redactar (regla CLAUDE.md §7):**

1. `docs/ESPECIFICACION-FUNCIONAL.md` y `docs/esquema-propuesto.sql` están en la
   raíz del proyecto, no en `docs/`.
2. `.specify/config.md`, `specs/001-fundacion/spec.md` y
   `specs/plantillas/plan.md` **no existen** en esta carpeta, aunque el
   `CHANGELOG.md` registra que fueron creados. No se pudo seguir la plantilla de
   plan ni leer los criterios de aceptación reales (CA-1 y CA-2).

**Consecuencia (NO VERIFICADO):** las definiciones de CA-1 y CA-2 en la sección
6 de este plan son una **interpretación de trabajo** construida a partir de la
especificación funcional y el esquema propuesto. Cuando el `spec.md` real de la
feature 001 esté disponible, los pasos de CA-1/CA-2 deben contrastarse y
ajustarse. Nada de la sección 6 se marca como aprobado.

**Acción de estructura pendiente (no bloqueante):** mover
`ESPECIFICACION-FUNCIONAL.md`, `esquema-propuesto.sql`, `DECISIONES.md`,
`INFRAESTRUCTURA.md` y `CHANGELOG.md` a `docs/` para alinearse con `CLAUDE.md` §1
y las rutas que el resto de documentos referencian.

---

## 1. Objetivo y alcance

Sentar la fundación de UndreoCol sobre la que se construirán las features
restantes:

1. Esquema PostgreSQL multi-tenant **mínimo** y versionado en
   `supabase/migrations/`: solo `planes`, `clientes`, `perfiles`, `membresias`,
   `configuracion` y una `usuarios_servicio` mínima (exclusivamente para
   verificar el aislamiento RLS).
2. RLS con `FORCE` habilitado **desde la primera migración** en todas las
   tablas, con las políticas de roles y multi-tenant de la fundación.
3. Contratos de `lib/auth.ts` que contemplan **desde el diseño** los dos tipos
   de sesión (administrativa con Supabase Auth y de suscriptor con JWT propio,
   decisión D-4). Esta feature implementa **solo** la primera; la segunda queda
   declarada en la interfaz y se implementa en la feature 008.
4. Fundación del proyecto Next.js 15 (App Router, TypeScript estricto, Tailwind)
   con `output: 'standalone'` en `next.config.js`.

**Reglas obligatorias que el plan respeta (instrucción de Mateo):**

- Ningún archivo en `app/` ni `components/` importa `@supabase/*`.
- El enum `rol_usuario` tiene **exactamente 3 valores**: `administrador`,
  `admin_acueducto`, `lector`.
- `usuarios_servicio` **no** tiene columna `perfil_id` (decisión D-2).
- RLS con `FORCE` en todas las tablas desde la primera migración.
- `output: 'standalone'` en `next.config.js`.
- Sin Edge Functions de Supabase y sin APIs propietarias de Vercel.

---

## 2. Archivos a crear — lista exacta

Solo estos archivos. Si algo no está aquí, no se crea (CLAUDE.md §6).

### 2.1 Configuración del proyecto

| # | Archivo | Propósito |
|---|---|---|
| 1 | `package.json` | Manifiesto npm: dependencias de la fundación y scripts (`dev`, `build`, `start`, `lint`, `test`, `test:aislamiento`, `db:reset`, `db:push`). |
| 2 | `tsconfig.json` | TypeScript estricto (`strict: true`), `paths` `@/*` → `./*`, target acorde a Next 15. |
| 3 | `next.config.js` | Único ajuste: `output: 'standalone'`. Sin plugins ni APIs propietarias. |
| 4 | `next-env.d.ts` | Tipos de Next.js. Generado por `next dev`/`next build`; se commitea. |
| 5 | `.gitignore` | Excluye `node_modules/`, `.next/`, `.env*`, `coverage/`, `.supabase/`, dumps. |
| 6 | `.env.example` | Variables documentadas en `INFRAESTRUCTURA.md` §5: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`. Nunca valores reales. |
| 7 | `eslint.config.mjs` | ESLint flat config basado en `eslint-config-next`. |
| 8 | `postcss.config.mjs` | Config de PostCSS para Tailwind CSS. |
| 9 | `tailwind.config.ts` | Tailwind: `content` de `app/`, `components/`, `lib/`. |
| 10 | `vitest.config.ts` | Config de Vitest (unit tests de `lib/`). |

### 2.2 Aplicación (`app/` — sin `@supabase/*`)

| # | Archivo | Propósito |
|---|---|---|
| 11 | `app/globals.css` | Directivas `@tailwind base/components/utilities`. |
| 12 | `app/layout.tsx` | Layout raíz (`<html lang="es">`, metadata mínima). No importa `@supabase/*`. |
| 13 | `app/page.tsx` | Página raíz placeholder estático (título y estado del proyecto). No importa `@supabase/*`. Es lo mínimo que exige el build. |

### 2.3 Capa de servicios (`lib/` — única que toca servicios externos)

| # | Archivo | Propósito |
|---|---|---|
| 14 | `lib/db.ts` | Único punto de acceso a Supabase. Expone `crearClienteServidor()` (cliente SSR con cookies de Next vía `@supabase/ssr`). `app/` y `components/` nunca importan `@supabase/*`; si necesitan datos, pasan por `lib/`. |
| 15 | `lib/auth.ts` | Contratos de sesión (dos tipos, ver sección 4) + implementación de la sesión administrativa. |

### 2.4 Base de datos

| # | Archivo | Propósito |
|---|---|---|
| 16 | `supabase/migrations/20260831150000_fundacion-tenancy.sql` | Migración única de la fundación (ver sección 3). El timestamp exacto se fija al ejecutar `supabase migration new`. |
| 17 | `supabase/config.toml` | Configuración del entorno local. **Generado por `supabase init`** (entorno de desarrollo), no redactado a mano. |

### 2.5 Tests

| # | Archivo | Propósito |
|---|---|---|
| 18 | `tests/fixtures/fundacion.sql` | Datos multi-tenant de prueba idempotentes: 2 clientes (A y B), perfiles, membresías, configuraciones y usuarios_servicio para ambos clientes. |
| 19 | `tests/aislamiento/001_fundacion_aislamiento.sql` | Verificación RLS `FORCE` caso por caso (positivos y negativos). Cada fallo lanza `raise exception` con mensaje descriptivo; el script falla si algo se filtra. |
| 20 | `tests/unit/lib/auth.test.ts` | Unit de `lib/auth.ts`: contratos, `obtenerSesionActiva()` sin cookie, inicio/cierre de sesión con mock de Supabase, y funciones de suscriptor que lanzan `ErrorSesionSuscriptorPendiente`. |
| 21 | `tests/integracion/001_fundacion_auth.test.ts` | Integración de `iniciarSesion()` contra Supabase local (requiere `supabase start`). Verifica el flujo real email/contraseña → sesión administrativa. |

**Generados por herramientas (no se redactan):** `package-lock.json` (`npm ci`),
`.next/standalone/` (`next build`), `supabase/config.toml` (`supabase init`).

**Fuera de la lista (no se crean):** `components/` (aún no hay UI), `core/`,
`worker/`, `lib/storage.ts`, `lib/tenant.ts` (feature posterior a la fundación).

---

## 3. Esquema SQL — migración `supabase/migrations/20260831150000_fundacion-tenancy.sql`

Una sola migración atómica (decisión D-6, ver sección 5). Es una **reducción
deliberada** de `esquema-propuesto.sql` v2.0: solo las 6 tablas de la fundación.
Nada de servicios, tarifas, contadores, periodos, lecturas, facturas, pagos,
órdenes, notificaciones, trabajos, empleados, incapacidades ni auditoría en esta
migración (se crean en sus features, cada una con su test de aislamiento).

### 3.1 Extensiones y enums

```sql
create extension if not exists "pgcrypto";

create type rol_usuario as enum (
  'administrador',      -- Dueño del software. Acceso total, todos los clientes
  'admin_acueducto',    -- El cliente. Gestiona SU acueducto, nunca otros
  'lector'              -- Fontanero. Lecturas y órdenes asignadas, desde celular
);
-- NOTA (D-2): NO existe 'suscriptor'. El portal usa sesión propia (feature 008).

create type estado_cuenta as enum ('activa','vencida','suspendida','cancelada');

create type estado_suscriptor as enum ('activo','suspendido','cortado','inactivo');
```

Solo estos tres enums. `categoria_tarifaria`, `tipo_calculo`, `estado_periodo`,
etc. se crean en sus features.

### 3.2 Tablas del panel maestro (nivel plataforma, sin `cliente_id`)

```sql
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
  slug              text not null unique,
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
```

### 3.3 Identidad y roles

```sql
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
```

Notas sobre `membresias`:

- `chk_ambito_rol` garantiza que el rol `administrador` solo existe a nivel de
  plataforma (sin `cliente_id`) y que los demás roles siempre pertenecen a un
  cliente. La prohibición de que un `admin_acueducto` otorgue `administrador`
  (regla 23 de CLAUDE.md) se refuerza además en la política RLS (§3.6).
- No hay FK de `perfiles.id` hacia `auth.users`: es deliberado para portabilidad
  self-hosted (CLAUDE.md §5.2 e INFRAESTRUCTURA.md §6). El vínculo es lógico.

### 3.4 Configuración por cliente

```sql
create table configuracion (
  cliente_id           uuid primary key references clientes(id) on delete cascade,
  porcentaje_mora      numeric(6,3) not null default 2.0,   -- % sobre saldo vencido
  dias_vencimiento     integer not null default 30,
  dias_umbral_corte    integer not null default 60,
  valor_reconexion     numeric(12,2) not null default 0,
  factor_consumo_alto  numeric(6,2) not null default 150.0,
  piso_consumo_alto_m3 numeric(10,2) not null default 100.0,
  factor_consumo_bajo  numeric(6,2) not null default 20.0,
  umbral_rollover_pct  numeric(6,2) not null default 90.0,
  prefijo_factura      text not null default 'FAC',
  prefijo_reconexion   text not null default 'REC',
  consecutivo_factura  integer not null default 0,
  anio_consecutivo     smallint not null
    default extract(year from current_date)::smallint,
  updated_at           timestamptz not null default now()
);
```

Los valores por defecto salen de `ESPECIFICACION-FUNCIONAL.md` §2.2. Los
definitivos reales del negocio quedan pendientes de Mateo (INFRAESTRUCTURA.md
§12) y se ajustarán en la feature de configuración.

### 3.5 `usuarios_servicio` — versión MÍNIMA (solo para verificar aislamiento RLS)

```sql
create table usuarios_servicio (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  codigo_suscriptor text not null,
  nombre            text not null,
  estado            estado_suscriptor not null default 'activo',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cliente_id, codigo_suscriptor)
);

create index on usuarios_servicio (cliente_id, estado);
```

**Restricciones de la instrucción de Mateo aplicadas aquí:**

- **NO tiene columna `perfil_id`** (decisión D-2: el suscriptor no es un usuario
  del sistema de identidad).
- Es **mínima**: las columnas `tipo_documento`, `numero_documento`, `telefono`,
  `email`, `direccion`, `sector`, `categoria`, `contador_actual_id`, `notas` y
  `fecha_vinculacion` se añaden en la feature de suscriptores mediante una
  migración `ALTER TABLE` (con su test de aislamiento, como toda tabla nueva).
- Existe aquí únicamente para poder verificar que RLS aísla una tabla tenantizada
  de negocio antes de construir el resto del esquema.

### 3.6 Funciones de seguridad (SECURITY DEFINER)

Iguales a `esquema-propuesto.sql` §4. Evitan recursión infinita en las políticas
RLS:

```sql
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
```

La única dependencia de Supabase es `auth.uid()`. El bloque de compatibilidad
self-hosted (función `auth.uid()` en un esquema `auth` propio leyendo
`current_setting('app.perfil_id')`) se documenta **como comentario** al final de
la migración, tal como indica `esquema-propuesto.sql` §16 final. No se crea
ningún esquema `auth` en la migración porque en Supabase ya existe.

### 3.7 Trigger `updated_at`

```sql
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_clientes_updated before update on clientes
  for each row execute function set_updated_at();
create trigger trg_perfiles_updated before update on perfiles
  for each row execute function set_updated_at();
create trigger trg_usuarios_servicio_updated before update on usuarios_servicio
  for each row execute function set_updated_at();
```

Solo en las tablas que tienen `updated_at` y lo necesitan (`planes` no tiene
`updated_at`; `membresias` no lo tiene; `configuracion` lo tiene pero no se
automatiza, igual que en `esquema-propuesto.sql` §15).

### 3.8 RLS con FORCE — desde la primera migración

Se habilita y fuerza en las 6 tablas:

```sql
do $$
declare t text;
begin
  foreach t in array array[
    'planes','clientes','perfiles','membresias','configuracion','usuarios_servicio'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
```

`FORCE` aplica las políticas incluso al dueño de la tabla: nada se salta el
filtro (CLAUDE.md §5.4). El propio dueño debe insertar a través de una sesión con
`request.jwt.claim.sub` válido o con la `service_role_key` (solo migraciones y
worker, con justificación escrita).

### 3.9 Políticas RLS

```sql
-- --- Panel maestro -----------------------------------------------------------

-- planes: lectura pública (cualquier sesión autenticada); escritura solo plataforma.
create policy planes_lectura on planes for select using (true);
create policy planes_escritura on planes for all
  using (es_admin_plataforma()) with check (es_admin_plataforma());

-- clientes: lectura para miembros del propio cliente o plataforma;
--           escritura SOLO plataforma en la fundación (ver decisión D-8).
create policy clientes_lectura on clientes for select
  using (es_admin_plataforma() or id in (select mis_clientes()));
create policy clientes_plataforma on clientes for all
  using (es_admin_plataforma()) with check (es_admin_plataforma());

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

-- REGLA CRÍTICA (CLAUDE.md §9-23): el admin del acueducto crea usuarios de SU
-- acueducto, pero NUNCA puede otorgar el rol 'administrador', ni a otros ni a sí
-- mismo. Se bloquea en RLS, no solo en la interfaz.
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

-- --- Tablas tenantizadas estándar --------------------------------------------
-- configuracion y usuarios_servicio: lectura para miembros del cliente o
-- plataforma; escritura para admin del acueducto o plataforma. En la fundación
-- no existe aún el rol 'lector' para estas tablas (ver feature de lecturas).

create policy configuracion_lectura on configuracion for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy configuracion_escritura on configuracion for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy usuarios_servicio_lectura on usuarios_servicio for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy usuarios_servicio_escritura on usuarios_servicio for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
```

**Notas de comportamiento esperado para los tests de aislamiento:**

- Rol `anon` (sin `auth.uid()`): puede leer `planes`; `clientes`, `perfiles`,
  `membresias`, `configuracion` y `usuarios_servicio` devuelven 0 filas y
  rechazan toda escritura.
- Rol `admin_acueducto` del cliente A: lee su cliente, su perfil, sus
  membresías, su configuración y sus usuarios de servicio; nada del cliente B;
  no puede crear membresías con rol `administrador` ni para el cliente B.
- Rol `administrador` (plataforma): acceso total a las 6 tablas.
- El portal del suscriptor (D-2/D-4) **no usa RLS ni `auth.uid()`**: se implementa
  en la feature 008 con `service_role_key` en servidor y filtrado por
  `usuario_servicio_id`, tal como documenta `INFRAESTRUCTURA.md` §4.

---

## 4. Contratos de `lib/auth.ts` y `lib/db.ts`

### 4.1 Principio de diseño

`lib/auth.ts` es el **único** lugar donde la aplicación habla de sesión.
Externamente solo se usan sus tipos y funciones. `app/` y `components/` importan
desde aquí (y desde `lib/db.ts`) si necesitan la sesión; nunca importan
`@supabase/*` directamente (CLAUDE.md §5.2).

La interfaz contempla **desde el diseño** los dos tipos de sesión de la decisión
D-4 (ver DECISIONES.md y CLAUDE.md §9-25):

- **Administrativa** — Supabase Auth. Implementada en esta feature.
- **De suscriptor** — JWT propio firmado con `SESSION_SECRET`, cookie HttpOnly +
  Secure + SameSite=Lax, duración 30 días con renovación < 7 días. **Contrato
  declarado, implementación en la feature 008.** Las funciones declaradas lanzan
  `ErrorSesionSuscriptorPendiente` con mensaje explícito; nunca devuelven datos
  falsos ni sesiones fabricadas.

### 4.2 Tipos y constantes (contrato compartido)

```typescript
// lib/auth.ts

export type TipoSesion = 'administrativa' | 'suscriptor';

// Sesión administrativa — Supabase Auth (implementada en esta feature).
// El cliente activo NO se incluye aquí a propósito: la membresía activa se
// resuelve por petición vía lib/tenant.ts (feature posterior), porque puede
// cambiar sin que la sesión expire.
export interface SesionAdministrativa {
  tipo: 'administrativa';
  perfilId: string;     // auth.users.id / perfiles.id
  email: string;
}

// Sesión de suscriptor — JWT propio (decisión D-4). Contrato reservado.
// "sub" = usuario_servicio_id, "cid" = cliente_id, "exp" = expiración (epoch s).
export interface SesionSuscriptor {
  tipo: 'suscriptor';
  usuarioServicioId: string;  // "sub" del JWT
  clienteId: string;          // "cid" del JWT
  expiraEn: number;           // "exp" del JWT
}

export type Sesion = SesionAdministrativa | SesionSuscriptor;

// Constantes de la sesión del portal (D-4). Se definen aquí para que el contrato
// no cierre la segunda sesión; la feature 008 las usará.
export const DURACION_SESION_SUSCRIPTOR_SEG = 30 * 24 * 60 * 60;  // 30 días
export const UMBRAL_RENOVACION_SUSCRIPTOR_SEG = 7 * 24 * 60 * 60; // < 7 días restantes

export class ErrorSesionSuscriptorPendiente extends Error {
  constructor() {
    super('Sesión de suscriptor pendiente de implementar (feature 008, decisión D-4).');
    this.name = 'ErrorSesionSuscriptorPendiente';
  }
}
```

### 4.3 Funciones de sesión administrativa (implementadas)

```typescript
// Devuelve la sesión administrativa activa, o null si no hay cookie válida.
// No lanza: ausencia de sesión es un caso normal (página pública).
export async function obtenerSesionActiva(): Promise<SesionAdministrativa | null>;

// Inicia sesión con email/contraseña contra Supabase Auth. La cookie de sesión
// se escribe vía @supabase/ssr. Lanza si las credenciales son inválidas.
export async function iniciarSesion(email: string, contrasena: string): Promise<SesionAdministrativa>;

// Cierra la sesión administrativa (signOut de Supabase y cookie limpia).
export async function cerrarSesion(): Promise<void>;
```

**Comportamiento requerido (para los tests):**

- `obtenerSesionActiva()` sin cookie → `null`. Con cookie válida → sesión con
  `perfilId` y `email`. Con cookie inválida/vencida → `null` (nunca lanza).
- `iniciarSesion(email, contrasena)` delega en `crearClienteServidor()` de
  `lib/db.ts` → `auth.signInWithPassword`. Error de autenticación → lanza error
  explícito con mensaje en español.
- `cerrarSesion()` delega en `auth.signOut()`; es idempotente (cerrar sin sesión
  no lanza).
- La distinción `tipo: 'administrativa'` queda explícita en el tipo devuelto: un
  futuro middleware podrá distinguirla de la `suscriptor` (CLAUDE.md §9-22c).

### 4.4 Funciones de sesión de suscriptor (contrato reservado, feature 008)

```typescript
// Todas lanzan ErrorSesionSuscriptorPendiente. Firmas fijadas para que la
// feature 008 las implemente sin cambiar la interfaz pública.

// Valida numero_documento + codigo_suscriptor contra usuarios_servicio,
// emite el JWT con SESSION_SECRET y lo guarda en la cookie del portal.
export async function iniciarSesionSuscriptor(
  numeroDocumento: string,
  codigoSuscriptor: string
): Promise<SesionSuscriptor>;

// Renovación automática de la sesión del portal (D-4): si quedan < 7 días,
// emite un JWT nuevo. Si el estado del suscriptor cambió, rechaza.
export async function renovarSesionSuscriptor(token: string): Promise<SesionSuscriptor>;

// Verifica firma, expiración y campo tipo: 'suscriptor' (CLAUDE.md §9-22c).
export function verificarSesionSuscriptor(token: string): SesionSuscriptor;
```

Estas firmas **no** se implementan en esta feature; su cuerpo lanza
`ErrorSesionSuscriptorPendiente`. Así la interfaz queda abierta a la segunda
sesión sin código muerto.

### 4.5 `lib/db.ts`

```typescript
// Único punto de acceso a Supabase desde el servidor Next.js.
// Crea un cliente de servidor con manejo de cookies vía @supabase/ssr.
export function crearClienteServidor(): SupabaseClient;
```

- Usa `@supabase/ssr` (`createServerClient`) con `next/headers` (cookies). Es la
  capa que `lib/auth.ts` usa internamente.
- No expone claves: las variables se leen del entorno. `SUPABASE_SERVICE_ROLE_KEY`
  se usa solo en migraciones y worker (CLAUDE.md §5.4); la función
  `crearClienteServicio()` que la usaría **no se crea en esta feature**.
- No se crea cliente "anon" de navegador: esta feature no tiene UI que toque la
  base directamente.

### 4.6 Cómo se garantiza la restricción "app/ y components/ no importan @supabase/*"

- La verificación es estática y entra en CA-2: un `grep -rn "@supabase/" app/ components/`
  debe devolver vacío (o el comando de verificación falla).
- Es una regla de código revisable en cada PR; no hay nada en la feature que la
  viole porque `app/` solo contiene el placeholder estático.

---

## 5. Decisiones técnicas y alternativas descartadas

Cada decisión con contexto, alternativas y razón. Estilo del registro
`DECISIONES.md`; las que se confirman aquí quedan numeradas para referencia.

### D-6 — Una sola migración fundacional atómica

- **Decisión:** todo el esquema de la fundación vive en una única migración
  `20260831150000_fundacion-tenancy.sql`. `supabase db reset` la aplica de cero y
  el resultado es reproducible.
- **Alternativa descartada A:** dividir en tres migraciones (enums, tablas,
  RLS). Más difícil de auditar y de razonar como unidad atómica; `db reset` las
  aplica en orden de todas formas.
- **Alternativa descartada B:** migraciones por tabla. Fuerza dependencias
  frágiles de FK/RLS entre archivos y no aporta nada a esta escala.

### D-7 — Vitest como runner de tests unitarios

- **Decisión:** Vitest (MIT) para `tests/unit` e `tests/integracion`.
- **Alternativa descartada A:** `node:test` nativo. Cero dependencias, pero sin
  mocks de módulos cómodos (necesitamos `vi.mock('next/headers')`) ni cobertura
  integrada.
- **Alternativa descartada B:** Jest. Más pesado y con configuración adicional
  para ESM/Next.
- Los tests de aislamiento RLS **no** son de Vitest: son scripts SQL ejecutados
  con `psql` (evidencia más directa sobre la base real).

### D-8 — `clientes`: escritura SOLO plataforma en la fundación

- **Decisión:** en la migración fundacional, `clientes` solo tiene política de
  escritura para `es_admin_plataforma()`. El `admin_acueducto` puede **leer** su
  cliente, no editarlo todavía.
- **Contexto:** `esquema-propuesto.sql` §16 crea `clientes_update_propio`
  (admin_acueducto edita su fila) y dice textualmente "pero NO su plan ni su
  estado de cuenta: eso se protege con un trigger de columnas". Ese trigger **no
  existe** en el esquema propuesto.
- **Razón:** crear `clientes_update_propio` sin el trigger dejaría al
  `admin_acueducto` con capacidad de cambiar su propio `plan_id` y
  `estado_cuenta` — un agujero de seguridad en la capa más sensible (el cobro de
  UndreoCol). La política y el trigger de protección de columnas se crean juntos
  en la feature de gestión de clientes/planes.
- **Alternativa descartada:** copiar la política tal cual del esquema propuesto
  (riesgo aceptado: no). Ampliar la fundación para incluir el trigger (sale del
  alcance mínimo pedido).

### D-9 — `usuarios_servicio` mínima

- **Decisión:** solo `id`, `cliente_id`, `codigo_suscriptor`, `nombre`, `estado`
  y timestamps, con `unique (cliente_id, codigo_suscriptor)`. Sin `perfil_id`
  (obligatorio por D-2) y sin las columnas del suscriptor completo.
- **Razón:** su único propósito en esta feature es verificar el aislamiento RLS
  de una tabla tenantizada de negocio. Añadir `categoria` arrastraría el enum
  `categoria_tarifaria`, que pertenece a la feature de tarifas.
- **Alternativa descartada:** crear la tabla completa desde el inicio (contradice
  la instrucción de "mínima" y adelanta tipos/dependencias de features futuras).

### D-10 — `@supabase/ssr` para el cliente de servidor

- **Decisión:** `lib/db.ts` usa `@supabase/ssr` (`createServerClient`) con las
  cookies de `next/headers`.
- **Alternativa descartada A:** `@supabase/supabase-js` con `createClient` y
  gestión manual de cookies. Reimplementa lo que `@supabase/ssr` ya resuelve
  (refresco de tokens y escritura de cookies).
- **Alternativa descartada B:** middleware para refrescar sesión. No es necesario
  en la fundación; se evaluará cuando existan rutas protegidas.

### D-11 — Enums mínimos (solo 3)

- **Decisión:** solo `rol_usuario`, `estado_cuenta` y `estado_suscriptor`.
- **Alternativa descartada:** importar todos los enums del esquema propuesto
  (11 en total). Contradice la fundación mínima: `categoria_tarifaria`,
  `tipo_calculo`, `estado_periodo`, etc. se crean con sus features.
- `rol_usuario` cumple la restricción de exactamente 3 valores (sin `suscriptor`,
  D-2).

### D-12 — Sesión de suscriptor declarada como contrato que lanza

- **Decisión:** las firmas de sesión de suscriptor existen en `lib/auth.ts`
  desde la fundación y lanzan `ErrorSesionSuscriptorPendiente`.
- **Razón:** la decisión D-4 exige que la interfaz de `lib/auth.ts` contemple los
  dos tipos desde el diseño; declarar las firmas evita que la feature 008 cambie
  la API pública. Lanzar con un error tipado evita "código muerto silencioso" y
  cumple la regla de errores explícitos (CLAUDE.md §6).
- **Alternativa descartada A:** no declarar nada de suscriptor hasta la 008
  (cierra la interfaz, contradice D-4 y la instrucción de Mateo).
- **Alternativa descartada B:** implementar ya la sesión de suscriptor (fuera del
  alcance: la feature 001 implementa solo la administrativa).

### D-13 — RLS `FORCE` desde la primera migración (restricción obligatoria)

- **Decisión:** `enable row level security` + `force row level security` en las 6
  tablas dentro de la migración fundacional.
- **Alternativa descartada:** activar FORCE al final de la fundación o "cuando
  haya datos". Sería inconsistente con CLAUDE.md §5.4 y permitiría que código o
  pruebas en desarrollo se salten el aislamiento.

### D-14 — Nada de `components/`, `core/`, `worker/` en esta feature

- **Razón:** no hay UI, ni cálculo de dinero, ni procesos pesados en la
  fundación. CLAUDE.md §6: no se crean archivos que no estén en `plan.md`.
- **Alternativa descartada:** crear la estructura de carpetas vacía "para dejarla
  lista" (carpetas vacías no aportan nada y no son verificables).

---

## 6. Estrategia de pruebas — CA-1 (11 pasos) y CA-2 (5 pasos)

> ⚠️ **SUPUESTO NO VERIFICADO:** el `spec.md` real de la feature 001 no está
> disponible en esta carpeta (ver sección 0). Los criterios de aceptación CA-1 y
> CA-2 que se detallan abajo son una **interpretación de trabajo** alineada con
> `ESPECIFICACION-FUNCIONAL.md`, `CLAUDE.md` (regla de verificación, §10) y la
> instrucción de Mateo. Cuando el spec real esté disponible, hay que contrastar
> cada paso y ajustar este plan antes de aprobarlo.

**Convención de evidencia (CLAUDE.md §4):** cada paso termina con un comando
ejecutado y su salida real pegada en la conversación. Nada de "debería
funcionar".

### 6.1 Supuestos sobre CA-1 — fundación de la base de datos (11 pasos)

Se asume que CA-1 verifica el esquema y el aislamiento multi-tenant. Los pasos
1–5 son estructurales (information_schema/catálogo); los pasos 6–11 son de
comportamiento RLS.

| Paso | Qué se verifica | Comando de verificación | Evidencia esperada |
|---|---|---|---|
| 1 | `supabase db reset` aplica la migración sin errores | `supabase db reset` | Salida sin errores, migración listada en `supabase migration list` |
| 2 | Existen las 6 tablas con sus columnas | `psql "$DATABASE_URL" -f tests/aislamiento/...` (consulta a `information_schema.tables/columns`) | 6 tablas y las columnas esperadas por tabla |
| 3 | `rol_usuario` tiene exactamente 3 valores | consulta `enum_range(NULL::rol_usuario)` | `{administrador,admin_acueducto,lector}` |
| 4 | `usuarios_servicio` NO tiene `perfil_id` | consulta `information_schema.columns` filtrando tabla y columna | 0 filas |
| 5 | RLS habilitado + `FORCE` en las 6 tablas | consulta `pg_class` (`relrowsecurity`, `relforcerowsecurity`) | 6 tablas con ambos flags = true |
| 6 | Rol anon no lee datos de negocio | `set local role anon; select count(*) from clientes;` (y configuracion, usuarios_servicio, membresias, perfiles) | 0 filas |
| 7 | `admin_acueducto` A ve solo datos de A | `set local request.jwt.claim.sub = '<perfil A>'; set local role authenticated;` + selects | Ve A; no ve B en `clientes`, `membresias`, `configuracion`, `usuarios_servicio` |
| 8 | `admin_acueducto` A no puede insertar/editar datos de B | insert/update sobre filas de B | Error de política (`new row violates row-level security policy`) |
| 9 | `admin_acueducto` A no puede otorgar rol `administrador` | insert membresia rol='administrador' | Error de política |
| 10 | `administrador` de plataforma ve y gestiona todo | claim del perfil plataforma + insert/update/delete en las 6 tablas | Operaciones exitosas |
| 11 | `planes` es lectura pública, escritura solo plataforma | rol anon lee planes; rol admin_acueducto intenta escribir en planes | Lectura OK; escritura rechazada |

**Implementación:** los pasos 2–11 se automatizan en un único script
`tests/aislamiento/001_fundacion_aislamiento.sql` ejecutado con:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/001_fundacion_aislamiento.sql
```

- El fixture inserta 2 clientes (A y B), 4 perfiles (plataforma, admin A, lector
  A, admin B), sus membresías y configuraciones, y usuarios_servicio para A y B.
  Es idempotente (limpia al inicio). Se ejecuta con `service_role_key` (o como
  `postgres`) porque es un test, con justificación escrita en el propio script.
- El script de aislamiento usa `set local role` + `set local request.jwt.claim.sub`
  (mecanismo nativo de Supabase para simular la sesión del JWT) y `assert`
  dentro de bloques `do $$`. Cualquier verificación que falle **lanza excepción y
  corta el script con `ON_ERROR_STOP=1`**; la salida se pega como evidencia.
- **NO VERIFICADO:** ejecutar estos comandos requiere Docker + Supabase CLI +
  psql instalados. La verificación se hace en `/implement`, no en este plan.

### 6.2 Supuestos sobre CA-2 — fundación de la aplicación (5 pasos)

Se asume que CA-2 verifica que el proyecto Next.js compila, es ejecutable de
forma standalone y respeta las restricciones de arquitectura.

| Paso | Qué se verifica | Comando de verificación | Evidencia esperada |
|---|---|---|---|
| 1 | Dependencias instaladas | `npm ci` | Exit 0, `package-lock.json` generado |
| 2 | Compilación sin errores ni warnings TS | `npm run build` | Exit 0; sin errores ni warnings de TypeScript |
| 3 | Lint limpio | `npm run lint` | Exit 0 |
| 4 | La app responde en desarrollo y en producción | `npm run dev` + `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` y luego `npm run start` (servidor standalone) + curl | `200` en ambos |
| 5 | Restricciones de arquitectura | `grep -rn "@supabase/" app/ components/ || echo OK` y verificar existencia de `.next/standalone/` | Grep vacío (o "OK"); `.next/standalone/server.js` presente |

**Detalles del paso 4 (standalone):** con `output: 'standalone'`, `next build`
genera `.next/standalone/` con `server.js` ejecutable sin `node_modules` completo.
Se verifica con:

```bash
next build
node .next/standalone/server.js &   # sirve en el puerto configurado
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

### 6.3 Tests unitarios e integración de `lib/`

- `tests/unit/lib/auth.test.ts` (Vitest): mocks de `next/headers` y de
  `@supabase/ssr` (`vi.mock`).
  - `obtenerSesionActiva()` sin cookie → `null`.
  - `obtenerSesionActiva()` con sesión válida → `SesionAdministrativa` con
    `tipo: 'administrativa'`.
  - `iniciarSesion()` con credenciales inválidas → error explícito.
  - `cerrarSesion()` sin sesión → no lanza.
  - `iniciarSesionSuscriptor` / `renovarSesionSuscriptor` /
    `verificarSesionSuscriptor` → lanzan `ErrorSesionSuscriptorPendiente`.
  - Verificación: `npx vitest run` → todos verdes, salida pegada.
- `tests/integracion/001_fundacion_auth.test.ts` (Vitest, requiere Supabase
  local): `supabase start` + fixture + `iniciarSesion('admin-a@test.local', ...)`
  → sesión real. Si `supabase` no está arriba, el test se reporta como
  **NO VERIFICADO — requiere validación manual**, nunca como aprobado.

### 6.4 Orden de ejecución y definición de terminado

1. `supabase start` + `supabase db reset` → CA-1 pasos 1–5.
2. `tests/fixtures/fundacion.sql` + `tests/aislamiento/001_fundacion_aislamiento.sql`
   → CA-1 pasos 6–11.
3. `npm ci` → CA-2 paso 1.
4. `npm run lint` + `npm run build` → CA-2 pasos 2–3.
5. `npm run dev`/standalone + curl + grep de `@supabase/` → CA-2 pasos 4–5.
6. `npx vitest run` → tests unitarios e integración de `lib/`.

Cumple la definición de "terminado" de CLAUDE.md §10: build sin warnings, lint
limpio, tests verdes con salida pegada, migración versionada con test de
aislamiento en verde, y actualización de `CHANGELOG.md` al final.

---

## 7. Fuera de alcance

- Las demás tablas del esquema propuesto (servicios, tarifas, contadores,
  periodos, lecturas, facturas, pagos, órdenes, notificaciones, trabajos,
  empleados, incapacidades, auditoría) y sus features.
- Sesión de suscriptor del portal (feature 008) y su middleware.
- UI de login, páginas del panel y rutas protegidas.
- `lib/tenant.ts` (resolución del cliente activo) y `lib/storage.ts`.
- `core/` (lógica de negocio) y `worker/`.
- Trigger de protección de columnas de `clientes` (se crea en la feature de
  gestión de clientes, junto con la política de edición — ver D-8).
- Configuración de despliegue a Vercel/Supabase Cloud (solo entorno local).

---

## 8. Riesgos y pendientes de Mateo

| Riesgo / pendiente | Impacto | Mitigación |
|---|---|---|
| `spec.md` de la feature 001 no está disponible; CA-1/CA-2 son interpretación | El plan puede no coincidir con los criterios reales | Sección 0 y 6: todo marcado como supuesto; se revisa al llegar el spec |
| No existe `specs/plantillas/plan.md` | Estructura de este plan definida por mí | Se migra a la plantilla oficial cuando exista |
| Los docs están en la raíz, no en `docs/` | Inconsistencia con rutas referenciadas en CLAUDE.md | Mover a `docs/` (acción no bloqueante, al aprobar el plan) |
| Docker, Supabase CLI, Node 20+ y psql no verificados en este equipo | CA-1/CA-2 no se pueden ejecutar aquí hoy | Verificación en `/implement`; si falta el entorno, se reporta NO VERIFICADO |
| Umbrales por defecto del negocio y tarifas reales pendientes de Mateo | Valores por defecto de `configuracion` | No bloquean la fundación; se ajustan en la feature de configuración |

