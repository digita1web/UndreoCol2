# PLAN — 001: Fundación

**Spec aprobado:** 2026-08-31 (spec.md reescrito para la arquitectura Cloudflare + Hono, 11 criterios de aceptación)
**Fecha del plan:** 2026-09-01
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe código ni `tasks.md` hasta esa aprobación.

---

## 0. Estado del documento y discrepancias detectadas

### 0.1 De dónde parte este plan

- `specs/001-fundacion/spec.md` está aprobado para la arquitectura definitiva (D-6):
  Next.js 15 en Cloudflare Pages + Hono.js en Cloudflare Workers + Supabase PostgreSQL con RLS `FORCE`.
- El primer intento (commit `f2f912f`, código monolítico en `app/` + `lib/`) fue descartado en
  `55f9df4`: no corresponde a la arquitectura vigente.
- **Lo que se conserva y es válido:**
  - `supabase/migrations/20260831150000_fundacion-tenancy.sql` (secciones 1–9): enums, las 6 tablas de la
    fundación, funciones de seguridad `SECURITY DEFINER`, triggers `updated_at`, RLS `FORCE` y políticas RLS.
    Cumple D-1 y D-2.
  - `tests/aislamiento/001_fundacion_aislamiento.sql` (pasos 2–11) y `tests/fixtures/fundacion.sql`.
- El resto (frontend, backend, tests unitarios, workflow de backup) se construye desde cero con la estructura
  nueva de `frontend/` y `backend/` (CLAUDE.md §5.1).

### 0.2 Discrepancias detectadas (señaladas antes de actuar, CLAUDE.md §8)

1. **`docs/INFRAESTRUCTURA.md` está corrupto en su estado vigente.** Su contenido es una copia de
   `ARQUITECTURA.md` (difieren solo en el salto de línea final). Las secciones que referencian
   CLAUDE.md §5.1, `docs/DECISIONES.md` (D-2, D-7) y el propio spec — §5 keepalive, §6 backup a R2 con
   Session Pooler, §8 monitoreo 300/400/480 MB, §9 limpieza, §10 sesión del portal, §12 portabilidad —
   **no existen en el archivo actual**. El `INFRAESTRUCTURA.md` original (commit `f2f912f`, 307 líneas)
   tampoco coincidía con esa numeración. La intención operativa se reconstruyó en este plan desde
   `docs/DECISIONES.md` D-7, `docs/ESTRATEGIA-CALIDAD.md` §6/§9 y `docs/esquema-propuesto.sql` §18.
   **Acción propuesta (parte de este plan):** restaurar `docs/INFRAESTRUCTURA.md` con las secciones
   operativas referenciadas, como commit `docs:` de esta feature (ver §1.6 y decisión D-10).
2. **La migración existente no tiene `crear_tenant_con_admin()`**, que el spec §4.5 (onboarding
   transaccional) y CA-7 exigen. El encargo mencionaba solo la sección 18; esta es una segunda adición
   necesaria (§2.2).
3. **Adaptador de Next.js para Cloudflare (2026):** la guía oficial de Cloudflare Pages para Next.js ahora
   recomienda "Vite on Workers" para aplicaciones full-stack; el adaptador OpenNext sigue listado en los
   framework guides de Workers. Se elige **`@opennextjs/cloudflare`** (decisión D-1) y el cambio de guía
   queda registrado como riesgo de vigencia (§10).
4. **CA-8, CA-9 y CA-10 no están cubiertos** por `tests/aislamiento/001_fundacion_aislamiento.sql`
   actual. La adaptación del test se detalla en §8.2.

### 0.3 Entorno verificado (2026-09-01)

- node v20.20.2, npm 10.8.2, psql 16.15 y Supabase CLI 2.116.0 disponibles en el equipo.
- `wrangler` NO está instalado globalmente: se instala como devDependency en `backend/`.
- `supabase/` solo contiene `migrations/`: falta `supabase init` (genera `supabase/config.toml`).
- No existe `.github/` todavía.
- El plan antiguo pre-D-6 queda preservado en el historial git (commit `f2f912f`); copia local de
  referencia en `/tmp/plan-001-antiguo-pred6.md`.

---

## 1. Archivos

Solo estos archivos (CLAUDE.md §7: si no está en el plan, no se crea).

### 1.1 Backend — Hono.js + Cloudflare Workers

| Archivo | Acción | Propósito |
|---|---|---|
| `backend/package.json` | Crear | Manifiesto: `hono`, `@supabase/supabase-js`. Dev: `wrangler`, `@cloudflare/workers-types`, `typescript`, `vitest`, `eslint` + `typescript-eslint`. Scripts: `dev`, `build`, `deploy`, `lint`, `test`, `test:aislamiento`. |
| `backend/tsconfig.json` | Crear | TypeScript estricto (`strict: true`), módulos ES. |
| `backend/wrangler.toml` | Crear | Worker API `undreocol-api`: `main=src/index.ts`, `compatibility_date`, vars `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ALLOWED_ORIGIN`, observabilidad. **Sin cron triggers.** |
| `backend/wrangler.keepalive.toml` | Crear | Worker `undreocol-keepalive`: `main=src/cron/keepalive.ts`, `[triggers] crons=["0 5 * * *"]`, var `SUPABASE_URL`; secreto `SUPABASE_SERVICE_ROLE_KEY`. |
| `backend/wrangler.monitor-db.toml` | Crear | Worker `undreocol-monitor-db`: `main=src/cron/monitor-db.ts`, `[triggers] crons=["30 5 * * *"]`, var `SUPABASE_URL`; secreto `SUPABASE_SERVICE_ROLE_KEY`. |
| `backend/wrangler.limpieza.toml` | Crear | Worker `undreocol-limpieza`: `main=src/cron/limpieza.ts`, `[triggers] crons=["0 6 * * 0"]`, var `SUPABASE_URL`; secreto `SUPABASE_SERVICE_ROLE_KEY`. |
| `backend/.env.example` | Crear | Documenta `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ALLOWED_ORIGIN`, `SESSION_SECRET` (reservado, feature 008). Nunca valores reales. |
| `backend/.gitignore` | Crear | `node_modules/`, `.wrangler/`, `.env*`, `!.env.example`, `.dev.vars`. |
| `backend/src/index.ts` | Crear | App Hono: middleware CORS (solo `ALLOWED_ORIGIN`, credentials), rutas de §3, errores explícitos. |
| `backend/src/lib/db.ts` | Crear | `crearClienteSuscriptor(jwt)` y `crearClienteServicio()` (contratos §4.1). |
| `backend/src/lib/auth.ts` | Crear | Sesión administrativa (Supabase Auth) con cookie HttpOnly (contratos §4.2). |
| `backend/src/lib/sesion-suscriptor.ts` | Crear | Contrato reservado de la sesión del portal (D-2/D-4): tipos, constantes y funciones que lanzan `ErrorSesionSuscriptorPendiente` (se implementa en la feature 008). |
| `backend/src/lib/tenant.ts` | Crear | `resolverClienteActivo(perfilId)` (contrato §4.3). |
| `backend/src/cron/keepalive.ts` | Crear | Worker de keepalive (D-7; contrato §4.4). |
| `backend/src/cron/monitor-db.ts` | Crear | Worker de monitoreo (D-7; contrato §4.5); exporta `calcularNivel()` puro. |
| `backend/src/cron/limpieza.ts` | Crear | Base del Worker de limpieza (D-7; contrato §4.6). Lógica de purga completa en la feature 015. |
| `backend/tests/unit/monitor-db.test.ts` | Crear | Unit de `calcularNivel()` (umbrales 300/400/480 MB). |

**No se crean en esta feature:** `backend/src/core/` (no hay lógica de negocio pura todavía; llega con las
features de negocio) ni `backend/src/queues/` (Cloudflare Queues fuera de alcance, spec §5).

### 1.2 Frontend — Next.js 15 + Cloudflare Pages

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/package.json` | Crear | Next 15, React 19, TS estricto, Tailwind; dev: `@opennextjs/cloudflare`, `eslint` + `eslint-config-next`, `@types/*`. Scripts: `dev`, `build`, `lint`. |
| `frontend/tsconfig.json` | Crear | TS estricto, `paths` `@/*`. |
| `frontend/next.config.ts` | Crear | Config del adaptador OpenNext para Cloudflare. |
| `frontend/open-next.config.ts` | Crear | Config requerida por `@opennextjs/cloudflare` (build falla sin ella — descubierto en `/implement` de T-010). `defineCloudflareConfig({})` **sin `incrementalCache`**: UndreoCol es un panel administrativo con datos siempre dinámicos (facturas, pagos, lecturas), sin contenido estático que se beneficie de ISR/SSG por ahora. Se descarta explícitamente `r2IncrementalCache` (la plantilla por defecto del paquete) porque exigiría un binding R2 en el frontend fuera del alcance aprobado — el R2 de `backend/` (fotos/PDFs) no se toca. Decisión de Mateo (2026-09-01). |
| `frontend/postcss.config.mjs` + `frontend/tailwind.config.ts` | Crear | PostCSS + Tailwind (`content`: `app/`, `components/`, `lib/`). |
| `frontend/eslint.config.mjs` | Crear | ESLint flat config (`eslint-config-next`). |
| `frontend/.env.example` | Crear | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`. Nunca valores reales. |
| `frontend/.gitignore` | Crear | `node_modules/`, `.next/`, `.env*`, `!.env.example`, `.wrangler/`. |
| `frontend/app/globals.css` | Crear | Directivas Tailwind + variables de tema de shadcn/ui. |
| `frontend/app/layout.tsx` | Crear | Layout raíz `<html lang="es">`. Sin `@supabase/*`. |
| `frontend/app/page.tsx` | Crear | Redirige a `/login`. |
| `frontend/app/login/page.tsx` | Crear | Página de login (renderiza el formulario cliente). |
| `frontend/components/login-form.tsx` | Crear | Formulario cliente → `POST /auth/login` (fetch con credentials). |
| `frontend/app/onboarding/page.tsx` | Crear | Creación del acueducto (nombre + slug) → `POST /onboarding`. |
| `frontend/components/onboarding-form.tsx` | Crear | Formulario cliente → `POST /onboarding`. |
| `frontend/app/app/layout.tsx` | Crear | Layout del área protegida `/app/*`. |
| `frontend/app/app/dashboard/page.tsx` | Crear | Server component: `GET /dashboard` → nombre del acueducto, nombre y rol del usuario, conteo de `usuarios_servicio` (spec §4.7). |
| `frontend/middleware.ts` | Crear | Protege `/app/*`: sin cookie `uc_sesion_admin` → `/login` (decisión D-2 del plan, §5). |
| `frontend/lib/api.ts` | Crear | Wrapper `fetch` hacia la API de Hono (base URL, credentials). **Nunca importa `@supabase/*`.** |
| `frontend/components/ui/button.tsx`, `input.tsx`, `card.tsx`, `label.tsx` | Crear | Componentes shadcn/ui, **solo los que se usan** (spec §4.2). |
| `frontend/components.json` | Crear | Config de shadcn CLI. |
| `frontend/next-env.d.ts` | Generado | Por `next dev`/`next build`; se commitea. |

### 1.3 Base de datos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260831150000_fundacion-tenancy.sql` | Modificar | Añadir §10 `crear_tenant_con_admin()` y §11 soporte D-7 (`_keepalive`, `tamano_base_mb()`). Las secciones 1–9 **no se tocan** (§2). Actualizar el comentario de cabecera que referencia el plan. |
| `supabase/config.toml` | Generado | Por `supabase init` (entorno local). No se redacta a mano. |

### 1.4 Tests

| Archivo | Acción | Propósito |
|---|---|---|
| `tests/aislamiento/001_fundacion_aislamiento.sql` | Modificar | Añadir pasos 12–14 (keepalive, monitoreo, onboarding) y cerrar brechas de CA-2 (§8.2). |
| `tests/fixtures/fundacion.sql` | Sin cambios | Se valida que siga idéntico (los datos de A/B/plataforma no cambian). |

### 1.5 Operaciones (D-7)

| Archivo | Acción | Propósito |
|---|---|---|
| `.github/workflows/backup-diario.yml` | Crear | Backup diario `pg_dump` → R2 (spec §4.9, CA-10). Detalle en §2.4. |

### 1.6 Documentación

| Archivo | Acción | Propósito |
|---|---|---|
| `docs/INFRAESTRUCTURA.md` | Restaurar | Reemplazar la copia de `ARQUITECTURA.md` por el documento operativo con §5 keepalive, §6 backup a R2 (Session Pooler, retención 30 días), §7 ritual mensual de restauración, §8 monitoreo 300/400/480 MB, §9 limpieza semanal, §10 sesión del portal, §12 portabilidad (ver §0.2-1 y decisión D-10). Commit `docs:`. |

## 2. Esquema de base de datos

### 2.1 Qué ya está completo (no se toca)

Las secciones 1–9 de `supabase/migrations/20260831150000_fundacion-tenancy.sql` ya implementan y están
verificadas por `tests/aislamiento/001_fundacion_aislamiento.sql`:

- §1 Enums: `rol_usuario` (exactamente 3 valores, sin `suscriptor` — D-2), `estado_cuenta`, `estado_suscriptor`.
- §2 Tablas `planes` y `clientes` (nivel plataforma, `clientes.id` es el tenant_id; `chk_slug`).
- §3 Tablas `perfiles` y `membresias` con `chk_ambito_rol` (el rol `administrador` solo con `cliente_id`
  NULL) e índices únicos/parciales.
- §4 Tabla `configuracion` con los umbrales por defecto de `ESPECIFICACION-FUNCIONAL.md` §2.2.
- §5 Tabla mínima `usuarios_servicio` (sin `perfil_id` — D-2), solo para verificar aislamiento.
- §6 Funciones de seguridad `SECURITY DEFINER`: `es_admin_plataforma()`, `mis_clientes()`, `tiene_rol()`,
  `es_admin_de()`.
- §7 Trigger `set_updated_at()` y sus tres triggers.
- §8 RLS `FORCE` en las 6 tablas (bloque `do $$`).
- §9 Políticas RLS del panel maestro, identidad y tablas tenantizadas (incluida la regla crítica 23 de
  CLAUDE.md: el `admin_acueducto` nunca otorga `administrador`).

**No se reescribe nada de esto.**

### 2.2 Adiciones a la migración existente

Se **edita el mismo archivo** (decisión D-8: una migración atómica de la fundación; no hay base de
producción, solo `supabase db reset` en local). Se actualiza también el comentario de cabecera que
referencia al plan.

**§10 — Onboarding transaccional (spec §4.5, CA-7).**

```sql
-- Crea cliente + perfil + membresia(admin_acueducto) + configuracion en UNA transacción.
-- SECURITY DEFINER: RLS de clientes solo permite escritura a la plataforma (política
-- clientes_plataforma), por lo que el insert de onboarding pasa por esta función.
-- Revoca a anon; otorga a authenticated.
create or replace function crear_tenant_con_admin(
  p_nombre_cliente text,
  p_slug          text,
  p_email         text
) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_cliente_id uuid;
begin
  -- Solo el propio usuario autenticado (auth.uid()) puede crear SU tenant.
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  -- Un usuario con membresía activa no crea otro acueducto (el multi-tenant por
  -- usuario lo gestiona el panel maestro de la plataforma, feature posterior).
  if exists (select 1 from membresias where perfil_id = auth.uid() and activo) then
    raise exception 'El usuario ya tiene un acueducto';
  end if;
  insert into clientes (nombre, slug) values (p_nombre_cliente, p_slug)
    returning id into v_cliente_id;
  -- (el duplicado de slug viola el unique y revierte TODO por atomicidad)
  insert into perfiles (id, nombre, email) values (auth.uid(), p_nombre_cliente, p_email);
  insert into membresias (perfil_id, cliente_id, rol)
    values (auth.uid(), v_cliente_id, 'admin_acueducto');
  insert into configuracion (cliente_id) values (v_cliente_id);
  return v_cliente_id;
end $$;

revoke execute on function crear_tenant_con_admin(text, text, text) from anon, public;
grant  execute on function crear_tenant_con_admin(text, text, text) to authenticated;
```

**§11 — Soporte D-7 (sección 18 de `docs/esquema-propuesto.sql`, literal): `_keepalive` y
`tamano_base_mb()`.**

```sql
create table if not exists _keepalive (
  id           smallint primary key default 1,
  ultimo_ping  timestamptz not null default now(),
  constraint chk_singleton check (id = 1)
);

insert into _keepalive (id, ultimo_ping) values (1, now())
  on conflict (id) do nothing;

alter table _keepalive enable row level security;
alter table _keepalive force row level security;
-- Sin políticas: nadie (anon/authenticated) la toca; service_role bypasea RLS por diseño.

create or replace function tamano_base_mb()
returns numeric
language sql stable security definer set search_path = public as $$
  select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2);
$$;

revoke execute on function tamano_base_mb from anon, authenticated;
grant  execute on function tamano_base_mb to service_role;
```

### 2.3 Tablas nuevas y políticas RLS

| Elemento | RLS / permisos |
|---|---|
| `_keepalive` | `enable` + `force`. **Cero políticas**: anon/authenticated no pueden leer ni escribir. Solo `service_role` (bypasa RLS). Tabla técnica sin `cliente_id`, fuera del aislamiento multi-tenant. |
| `crear_tenant_con_admin(text,text,text)` | Ejecutable solo por `authenticated`. Valida `auth.uid()` y la unicidad del slug dentro de la transacción. |
| `tamano_base_mb()` | Ejecutable solo por `service_role` (los Workers cron y GitHub Actions). |

### 2.4 Workflow de backup — `.github/workflows/backup-diario.yml` (spec §4.9, CA-10)

Según la intención de `INFRAESTRUCTURA.md` §6 (reconstruida en §0.2-1), `D-7` y
`ESTRATEGIA-CALIDAD.md` §6/§9:

- **Programación:** `schedule` diario (p. ej. `06:00 UTC`) + `workflow_dispatch` (para CA-10).
- **Conexión a Supabase:** variable secreta `SUPABASE_DB_URL` con la cadena del **Session Pooler**
  (puerto `6543`, modo transaction) — nunca el puerto directo `5432` (riesgo mitigado, spec §8).
- **Dump:** en un contenedor `postgres:16-alpine`, `pg_dump --format=custom --no-owner` sobre la base,
  comprimido con `gzip`. Nombre: `undreocol-backup-<fecha-UTC>-<sha>.sql.gz`.
- **Subida a R2:** con `wrangler r2 object put undreocol-backups/<archivo> --file=<archivo>` usando los
  secretos `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`.
- **Retención 30 días:** regla *lifecycle* de R2 (expiración a 30 días) configurada en el bucket
  `undreocol-backups` (gestión por el proveedor, sin paso frágil de borrado en CI).
- **Restauración:** documentada como ritual mensual en `docs/INFRAESTRUCTURA.md` §7
  (backup → staging de Supabase → verificación de conteos y políticas RLS).

Secretos de GitHub necesarios (nunca en el repo): `SUPABASE_DB_URL`, `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`. La evidencia de CA-10 es `wrangler r2 object list undreocol-backups` mostrando el
archivo y su tamaño.

---

## 3. Rutas de la API (Hono)

Todas pasan por el middleware CORS (origen = `ALLOWED_ORIGIN`, `credentials: true`). La sesión
administrativa viaja en la cookie HttpOnly `uc_sesion_admin` (decisión D-3).

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| GET | `/salud` | Pública | Verifica conectividad con Supabase usando el cliente **anon** (`select` sobre `planes`, que es lectura pública): `200 {estado:"ok"}` o `503`. Nunca `service_role` (prohibición CLAUDE.md §12). |
| POST | `/auth/registro` | Pública | `supabase.auth.signUp({email, password})`. No crea tenant (eso es onboarding). |
| POST | `/auth/login` | Pública | `signInWithPassword` → escribe cookie `uc_sesion_admin` → devuelve perfil y membresías. |
| POST | `/auth/logout` | Cookie | `signOut` + borra la cookie. Idempotente. |
| POST | `/auth/recuperar` | Pública | `resetPasswordForEmail(email)`. |
| GET | `/auth/sesion` | Cookie | Valida (y refresca si expira) la sesión; devuelve `{perfil, cliente, rol}` o `401`. |
| POST | `/onboarding` | Cookie (admin) | `rpc('crear_tenant_con_admin', {p_nombre_cliente, p_slug, p_email})` → `201 {clienteId}`. Errores: slug duplicado / ya tiene acueducto / slug inválido (400–409). |
| GET | `/dashboard` | Cookie (admin + tenant) | Payload de `/app/dashboard` (spec §4.7): nombre del acueducto, nombre y rol del usuario, `count(*)` de `usuarios_servicio` del cliente. |

Regla de oro del RLS (CLAUDE.md §5.4): el cliente de Supabase de **cada request se instancia con el JWT
del usuario** (no con `service_role`), para que `auth.uid()` resuelva en las políticas.

## 4. Contratos

No hay `core/` en esta feature (no se calcula dinero). Los contratos que sí se fijan son los de `lib/` y
`cron/`. Los del suscriptor quedan **declarados pero sin implementar** (feature 008), como exige D-2/D-4.

### 4.1 `backend/src/lib/db.ts`

```ts
// Único punto de acceso a Supabase desde el backend.
// El cliente de cada request se crea con el JWT del usuario para que auth.uid()
// resuelva en RLS (CLAUDE.md §5.4).
export function crearClienteSuscriptor(accessToken: string): SupabaseClient;
// Solo para cron/ y GitHub Actions. NUNCA en una ruta que atiende peticiones de usuario.
export function crearClienteServicio(): SupabaseClient;
```

### 4.2 `backend/src/lib/auth.ts` — sesión administrativa (implementada)

```ts
export type TipoSesion = 'administrativa' | 'suscriptor';

export interface SesionAdministrativa {
  tipo: 'administrativa';
  perfilId: string;   // auth.users.id / perfiles.id
  email: string;
}

export const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';

// Middleware de Hono: lee la cookie, valida vía supabase.auth.getUser() (con
// refresco si el access_token expiró) y deja la sesión en c.get('sesion').
// Sin sesión → 401 (o next() con null para rutas públicas).
export async function verificarSesionAdministrativa(c: Context): Promise<SesionAdministrativa | null>;

// iniciarSesion: signInWithPassword + escritura de la cookie HttpOnly.
export async function iniciarSesion(email: string, contrasena: string, c: Context): Promise<SesionAdministrativa>;

// cerrarSesion: signOut + borrado de la cookie; idempotente (sin sesión no lanza).
export async function cerrarSesion(c: Context): Promise<void>;
```

**Comportamiento requerido (para tests):** sin cookie → `null` (nunca lanza); cookie inválida/vencida →
`null`; credenciales inválidas en login → error explícito en español. Cookie: `HttpOnly; Secure;
SameSite=Lax; Path=/`. Funciona en dev porque frontend (`localhost:3000`) y API (`localhost:8787`) son
mismo *site*; en producción ambos deben estar bajo el mismo dominio registrable (p. ej. `undreocol.com` y
`api.undreocol.com`).

### 4.3 `backend/src/lib/sesion-suscriptor.ts` — contrato reservado (feature 008)

```ts
// Todas lanzan ErrorSesionSuscriptorPendiente. Firmas fijas para que la feature 008
// las implemente sin cambiar la interfaz pública (D-2, D-4).
export interface SesionSuscriptor { tipo: 'suscriptor'; usuarioServicioId: string; clienteId: string; expiraEn: number; }
export const DURACION_SESION_SUSCRIPTOR_SEG = 30 * 24 * 60 * 60;  // 30 días (D-4)
export const UMBRAL_RENOVACION_SUSCRIPTOR_SEG = 7 * 24 * 60 * 60; // renovar si quedan < 7 días (D-4)
export class ErrorSesionSuscriptorPendiente extends Error { ... }
export async function iniciarSesionSuscriptor(...): Promise<SesionSuscriptor>;   // lanza
export async function renovarSesionSuscriptor(...): Promise<SesionSuscriptor>;   // lanza
export async function verificarSesionSuscriptor(...): Promise<SesionSuscriptor>; // lanza
```

### 4.4 `backend/src/lib/tenant.ts`

```ts
// Resuelve el acueducto activo del usuario (spec §4.6).
// 1 cliente → {clienteId, rol}; 0 → null (el frontend redirige a /onboarding);
// varios → null con la lista en el payload (caso previsto: soporte de UndreoCol).
export async function resolverClienteActivo(perfilId: string): Promise<
  { clienteId: string; rol: RolUsuario } | null
>;
```

### 4.5 `backend/src/cron/keepalive.ts`

```ts
// Worker `undreocol-keepalive`. Cron diario "0 5 * * *".
// Actualiza _keepalive.ultimo_ping = now() con cliente de servicio.
// Si el update afecta 0 filas o falla: LANZA excepción (falla visible en los logs
// de Cloudflare — mitigación del riesgo de pausa del plan Free, spec §8).
export default { async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> };
```

### 4.6 `backend/src/cron/monitor-db.ts`

```ts
// Función PURA, testeable con vitest (sin Hono ni Supabase).
// Umbrales de D-7/INFRAESTRUCTURA.md §8: 300 atencion, 400 alerta, 480 critico.
export function calcularNivel(tamanoMb: number): {
  porcentaje: number;            // % respecto a 500 MB
  nivel: 'ok' | 'atencion' | 'alerta' | 'critico';
};

// Worker `undreocol-monitor-db`. Cron diario "30 5 * * *".
// rpc('tamano_base_mb') → calcularNivel() → log del resultado.
// nivel >= 'alerta' → alertaStub() (console.error + TODO: Email Service, feature 010).
// El cálculo y el log deben funcionar y estar verificados (CA-9); el envío es stub
// (spec §4.8).
export default { async scheduled(...): Promise<void> };
```

### 4.7 `backend/src/cron/limpieza.ts`

```ts
// Worker `undreocol-limpieza`. Cron semanal "0 6 * * 0".
// BASE en esta feature: log de "sin tablas que purgar" + verificación de conexión.
// Objetivos de purga documentados (ESTRATEGIA-CALIDAD.md §6, feature 015):
// sesiones, auditoría, trabajos, notificaciones. Lógica completa NO se implementa
// aquí (spec §5: fuera de alcance).
export default { async scheduled(...): Promise<void> };
```

## 5. Decisiones técnicas

Cada decisión con su alternativa descartada y la razón. Se numeran D-1…D-10 para referencia en `tasks.md`.

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| **D-1 (plan) — Adaptador `@opennextjs/cloudflare`** para Next.js en Cloudflare. | `@cloudflare/vite-plugin` (recomendación oficial de la guía de Pages en 2026); `output: 'export'` estático. | OpenNext conserva Next.js 15 estándar (`next build`, App Router, `middleware.ts`, SSR) y es la ruta documentada "Next.js on Cloudflare" en los framework guides de Workers. El plugin de Vite es un cambio de toolchain completo (decisión de Mateo, no de la fundación). El estático no soporta el middleware que exige el spec §4.7. Riesgo de vigencia en §10. |
| **D-2 (plan) — `middleware.ts` verifica solo presencia de cookie**; la validación real ocurre en el server component de `/app/dashboard` vía `GET /auth/sesion`. | Validar el JWT dentro del middleware con una llamada de red por request. | Evita una llamada externa en cada navegación (latencia y acoplamiento); el middleware sigue protegiendo `/app/*` como pide el spec, y la autenticación real se hace donde hay contexto de servidor. |
| **D-3 (plan) — Sesión administrativa en cookie HttpOnly puesta por la API de Hono** (`uc_sesion_admin`). | `Authorization: Bearer` con el token en memoria del frontend; cookie puesta por el frontend. | Coherente con D-4 (la sesión del portal también será cookie HttpOnly desde el Worker); el token nunca vive en JS; same-site funciona en dev (`localhost`) y en producción con dominio + subdominio. |
| **D-4 (plan) — Onboarding transaccional en SQL** (`crear_tenant_con_admin`, SECURITY DEFINER). | Varios inserts/secuenciales desde la ruta de Hono. | CA-7 exige atomicidad real (sin huérfanos); las políticas de la fundación bloquean por diseño el `insert` de `clientes` por parte de `admin_acueducto` (decisión heredada del plan anterior), así que la creación debe pasar por una función con privilegios del definidor. |
| **D-5 (plan) — Tres Workers de mantenimiento separados, uno por tarea.** | Un solo Worker con 3 crons; crons dentro del Worker de la API. | El límite del plan Free es **5 Cron Triggers por cuenta** (no por Worker); 1 Worker = 1 cron consume 3 y deja 2 libres. Aislamiento de fallos (un bug de monitor no tumba la API). La feature 015 (limpieza completa) evoluciona su Worker sin tocar la API. |
| **D-6 (plan) — `/salud` con clave `anon`, nunca `service_role`.** | `service_role` en `/salud`. | Prohibición absoluta de CLAUDE.md §12: `service_role` nunca en una ruta que atiende peticiones de usuario. `planes` es lectura pública, suficiente como prueba de conectividad. |
| **D-7 (plan) — Backup: `pg_dump` (custom) + `wrangler r2 object put`; retención 30 días con lifecycle de R2.** | `aws cli` con credenciales R2; `supabase db dump`; borrado manual en CI. | `wrangler` es la herramienta del proyecto (sin dependencia AWS). `supabase db dump` requiere entorno local. La retención la gestiona R2 (sin paso frágil en CI). Conexión por **Session Pooler** (spec §8). |
| **D-8 (plan) — Editar la migración existente** añadiendo §10 y §11. | Nueva migración aparte. | Sin base de producción (solo `supabase db reset` en local); el plan anterior fijó "una migración atómica de la fundación". Editar el archivo commiteado es seguro pre-producción. |
| **D-9 (plan) — Confirmación de email de Supabase DESACTIVADA en el proyecto para el flujo de onboarding de desarrollo.** | Confirmación requerida (flujo por defecto). | Sin confirmación, `signUp` devuelve sesión y el onboarding fluye de corrido en dev/demo. Es configuración del proyecto (no código), documentada en `INFRAESTRUCTURA.md`; **se reactiva antes de producción** (pendiente de Mateo, §10). |
| **D-10 (plan) — Restaurar `docs/INFRAESTRUCTURA.md` dentro de esta feature.** | Dejarlo como pendiente externo. | CLAUDE.md, DECISIONES.md y el spec referencian sus §5/§6/§8/§9/§10/§12; la documentación operativa es parte de la fundación y hoy el archivo es una copia corrupta de `ARQUITECTURA.md`. Commit `docs:` independiente. |

## 6. Dependencias nuevas

Solo licencias MIT, Apache-2.0, BSD o ISC (CLAUDE.md §2). Versiones exactas se fijan con `npm` en
`/implement` (se registra la elegida en `tasks.md`).

### Backend (`backend/package.json`)

| Paquete | Tipo | Licencia | Por qué | Alternativa descartada |
|---|---|---|---|---|
| `hono` (^4) | runtime | MIT | Framework HTTP mínimo para Workers (D-6). | Express/Fastify (no corren en Workers). |
| `@supabase/supabase-js` (^2) | runtime | MIT | Cliente Supabase con el JWT del usuario y con `service_role` en cron/. | Postgres directo en Workers (imposible sin Hyperdrive; no hay). |
| `wrangler` (^4) | dev | Apache-2.0 | CLI de Workers: `dev`, `deploy --dry-run`, `r2 object`. | — |
| `@cloudflare/workers-types` (^4) | dev | Apache-2.0 | Tipos de `ScheduledController`, `ExecutionContext`, `Env`. | — |
| `typescript` (^5) | dev | Apache-2.0 | TS estricto. | — |
| `vitest` | dev | MIT | Unit de `calcularNivel()` (pura, sin Workers ni red). | Jest (más pesado en ESM). |
| `eslint` + `typescript-eslint` | dev | MIT | Lint. | — |

### Frontend (`frontend/package.json`)

| Paquete | Tipo | Licencia | Por qué | Alternativa descartada |
|---|---|---|---|---|
| `next` (^15) + `react`/`react-dom` (^19) | runtime | MIT | Stack decidido (D-6, CLAUDE.md §2). | — |
| `@opennextjs/cloudflare` | dev | MIT (verificar) | Adaptador Next.js → Cloudflare (decisión D-1). | `@cloudflare/vite-plugin` (cambio de toolchain); estático. |
| `tailwindcss` (^3) + `postcss` + `autoprefixer` | dev | MIT | Estilos (CLAUDE.md §2). | — |
| `eslint` + `eslint-config-next` + `@types/*` | dev | MIT | Lint y tipos. | — |
| shadcn/ui (componentes copiados: `button`, `input`, `card`, `label`) | — | MIT | UI base, solo los usados (spec §4.2). | ui completa (deuda de mantenimiento). |

### CI (`.github/workflows/backup-diario.yml`)

| Paquete | Tipo | Licencia | Por qué |
|---|---|---|---|
| `postgres:16-alpine` (imagen contenedor) | CI | PostgreSQL License | Proporciona `pg_dump`/`pg_restore` sin instalar nada en el runner. |
| `wrangler` (vía `npx`) | CI | Apache-2.0 | Subida a R2 y listado del bucket. |

---

## 7. Límites de Cloudflare Workers a considerar

Verificados contra la documentación vigente de Cloudflare (límites de plataforma, jul-2026). Nuestros
tres Workers cron caben en el plan Free con holgura.

| Límite (plan Free) | Valor | Implicación para esta feature |
|---|---|---|
| Cron Triggers **por cuenta** | **5** | Se usan 3 (keepalive, monitor-db, limpieza). Quedan 2 libres para features futuras. Por eso 1 Worker = 1 cron (D-5). |
| Requests | 100.000/día | El ping diario + monitoreo + API: despreciable. |
| CPU time por invocación | 10 ms | El ping (1 UPDATE) y el monitoreo (1 SELECT) son triviales; el tiempo de red no cuenta como CPU. |
| Wall time (Cron Triggers) | 15 min | Sobra de sobra para 1 consulta. |
| Memoria por isolate | 128 MB | Hono + supabase-js: decenas de MB. |
| Bundle tras compresión | 3 MB (Free) | Cada Worker cron solo importa `@supabase/supabase-js` + su lógica; el Worker de la API agrega Hono. Vigilar el bundle en `wrangler deploy --dry-run` (CA-6). |
| Subrequests | 50/request | 1 llamada a Supabase por invocación. |
| Número de Workers | 100 | 4 Workers (API + 3 cron). |

**Regla de cierre masivo (CLAUDE.md §5.5):** no aplica en esta feature (Queues fuera de alcance), pero el
diseño de `backend/` ya reserva la carpeta `queues/` para cuando llegue.

## 8. Estrategia de pruebas

### 8.1 Mapa de los 11 criterios de aceptación → evidencia

Cada CA se cierra con evidencia ejecutada y pegada (CLAUDE.md §4). Cómo se cubre cada uno:

| CA | Qué verifica | Dónde se evidencia | Estado de cobertura actual |
|---|---|---|---|
| **CA-1** Aislamiento entre acueductos (bloqueante) | SQL directo: A ve solo sus datos; no lee/inserta/actualiza/borra de B | `tests/aislamiento/001_fundacion_aislamiento.sql` pasos 6–8 y 10–11 (SQL directo, nunca vía Hono) | ✅ Cubierto |
| **CA-2** Imposibilidad de escalar privilegios (bloqueante) | `admin_acueducto` no otorga `administrador` ni toca `clientes.plan_id/estado_cuenta` | Paso 9 (a sí mismo y en cliente B) + **2 brechas nuevas** (§8.2): (a) `administrador` para OTRO perfil de A; (b) `update` de `clientes` de A sin efecto | ⚠️ Parcial |
| **CA-3** Migraciones reproducibles | `supabase db reset` desde vacío | Comando de tarea (salida pegada) | ✅ Comando |
| **CA-4** Sin `@supabase` en frontend | `grep -rn "@supabase" frontend/app/ frontend/components/` → 0 | Comando de tarea | ✅ Comando |
| **CA-5** Sin `service_role_key` en frontend | `grep -rn "SERVICE_ROLE" frontend/` → 0 | Comando de tarea | ✅ Comando |
| **CA-6** Build y despliegue en seco | `npm run build` (frontend) + `npx wrangler deploy --dry-run` (backend) | Comando de tarea | ✅ Comando |
| **CA-7** Onboarding transaccional | Slug duplicado → falla y NO quedan huérfanos | **PASO 14 nuevo** en el test de aislamiento (§8.2) | ❌ No cubierto |
| **CA-8** Keepalive funcional | `wrangler dev --test-scheduled` actualiza `_keepalive.ultimo_ping` | PASO 12 nuevo (soporte de esquema + RLS + singleton) + ejecución manual del Worker + `psql select ultimo_ping` | ❌ No cubierto |
| **CA-9** Monitoreo funcional | `tamano_base_mb()` + porcentaje vs 500 MB | PASO 13 nuevo (función + permisos + % calculado) + ejecución manual del Worker + unit de `calcularNivel()` | ❌ No cubierto |
| **CA-10** Backup ejecutado una vez | `workflow_dispatch` sube el dump a R2 | NO es cubrible por SQL: evidencia = listado `wrangler r2 object list undreocol-backups` con archivo y tamaño | ❌ Manual (workflow) |
| **CA-11** Flujo manual completo | Registro → onboarding → dashboard → logout → login → dashboard | Documentado paso a paso para Mateo, verificado por él en navegador | ❌ Manual (Mateo) |

**Respuesta a la pregunta de la tarea:** CA-1 ✅, CA-2 ⚠️ (faltan 2 verificaciones), CA-8/CA-9 ❌
(añadir pasos 12 y 13), CA-10 ❌ (no es SQL; se evidencia con el workflow + R2), CA-7 ❌ (PASO 14). El
detalle de la adaptación del test de aislamiento está en §8.2.

### 8.2 Adaptación de `tests/aislamiento/001_fundacion_aislamiento.sql`

El script actual conserva sus pasos 2–11 tal cual (mecánica: transacción + `set local role` +
`set local request.jwt.claim.sub` + aserciones que lanzan `raise exception`, `ON_ERROR_STOP=1`). Se
**añaden** los siguientes pasos y se actualiza la cabecera del script (referencia al plan/tasks nuevos):

**PASO 12 — Soporte del keepalive (CA-8, parte de esquema):**
1. `_keepalive` existe con RLS `enable` + `force` y con **cero políticas** (`pg_policies` → 0 filas).
2. `anon` y `authenticated` no pueden leerla (`set local role` + `select` → error de RLS o 0 filas).
3. Singleton: `insert into _keepalive (id) values (2)` → falla (`chk_singleton`).
4. Simulación del Worker: `set local role service_role; update _keepalive set ultimo_ping = now()
   returning ultimo_ping;` → 1 fila con timestamp reciente (el mecanismo exacto que usa
   `cron/keepalive.ts`).

**PASO 13 — Soporte del monitoreo (CA-9, parte de esquema):**
1. `tamano_base_mb()` existe y devuelve `numeric > 0` (ejecutada como `service_role`).
2. Permisos: ejecutarla como `anon` y como `authenticated` → error (`permission denied for function`);
   como `service_role` → OK.
3. Cálculo: `pct = tamano_base_mb() / 500.0 * 100` y `assert pct < 80` (muy por debajo del umbral de
   alerta en esta etapa; responde a CA-9 "debe estar muy por debajo del umbral").

**PASO 14 — Onboarding transaccional (CA-7):**
1. Como un usuario nuevo `z1` (`set local role authenticated` + claim `z...`): `select
   crear_tenant_con_admin('Acueducto Z', 'acueducto-z', 'z@test.local')` → devuelve `uuid` no nulo.
2. Verificar que quedaron exactamente: 1 fila en `clientes`, 1 en `membresias` (rol `admin_acueducto`,
   `activo`), 1 en `configuracion` para ese `cliente_id`.
3. **Atomicidad:** repetir la llamada con el mismo slug → falla (unique violation convertida en
   `raise 'El slug ya está en uso'` o error de constraint); contar filas de `clientes` antes y después →
   **idénticas** (sin huérfanos). Igual comprobación con el usuario `admin_a` que ya tiene acueducto →
   `raise 'El usuario ya tiene un acueducto'` y conteo estable.
4. `anon` no puede ejecutar la función (`permission denied`).

**Ampliación del PASO 9 — brechas de CA-2:**
- (a) `admin_acueducto` de A inserta membresía con `rol = 'administrador'` para **otro perfil** de A
  (el lector A): debe fallar.
- (b) `admin_acueducto` de A hace `update clientes set plan_id = ... / estado_cuenta = ...` sobre SU
  cliente: **0 filas afectadas** (o error de política) — la escritura de `clientes` es solo plataforma
  (decisión heredada del plan anterior, reflejada en la política `clientes_plataforma`).

### 8.3 Pruebas unitarias, de integración y orden de ejecución

- **Unit (`backend/tests/unit/monitor-db.test.ts`, vitest):** `calcularNivel()` — casos: 100 MB → `ok`;
  300 MB → `atencion`; 400 MB → `alerta`; 480 MB → `critico`; y el porcentaje exacto frente a 500 MB.
- **Aislamiento:** `supabase db reset` (aplica la migración con §10-§11) → fixture → script de
  aislamiento. Comando: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/001_fundacion_aislamiento.sql`.
- **Manual con evidencia (CA-8/CA-9):** `wrangler dev --test-scheduled -c wrangler.keepalive.toml`
  (y `monitor-db`) → salida pegada + consulta a `_keepalive`/`tamano_base_mb()`.
- **CA-10:** `workflow_dispatch` del backup → listado del bucket.
- **CA-11:** pasos manuales documentados para Mateo (registro → onboarding → dashboard → logout →
  login → dashboard).

**Orden propuesto de verificación por tarea (se detalla en `tasks.md` tras la aprobación):** migración y
test de aislamiento primero (CA-1/2/7/8/9 de esquema), luego backend (rutas + crons + unit), luego
frontend (build + greps CA-4/5/6), luego workflow (CA-10), y por último el flujo manual (CA-11).

## 9. Fuera de alcance

Explícitamente **no** se construye aquí (spec §5, sin cambios de alcance):

- Servicios, tarifas, contadores, lecturas, periodos, facturas, pagos (features 002–007).
- Órdenes de corte y reconexión (009), notificaciones (010), dashboard de indicadores (011), RRHH (012).
- Portal del suscriptor y su sesión propia (008) — solo se declaran los contratos de `sesion-suscriptor.ts`.
- PWA del lector (014) y Cloudflare Queues / cierre de facturación.
- Invitación de lectores y admins adicionales (003) y panel maestro de clientes de la plataforma.
- **Worker de limpieza completo** (feature 015): aquí solo la base (`cron/limpieza.ts`).
- Envío real de alertas del monitoreo (Email Service; se integra en una feature posterior).
- `backend/src/core/` (lógica de negocio pura), `backend/src/queues/`.
- Diseño visual elaborado — limpio y funcional es suficiente.

## 10. Riesgos y pendientes de Mateo

| Riesgo / pendiente | Impacto | Mitigación |
|---|---|---|
| `docs/INFRAESTRUCTURA.md` corrupto (copia de ARQUITECTURA.md) | La documentación operativa referenciada no existe | Se restaura dentro de esta feature (D-10). Se marca como **pendiente de aprobación de Mateo** porque toca un documento de referencia. |
| La guía oficial de Cloudflare en 2026 recomienda Vite para Next.js full-stack; OpenNext podría descontinuarse | El adaptador elegido (D-1) quedaría obsoleto | En `/implement`, verificar estado vigente de `@opennextjs/cloudflare` al instalar; si no es viable, **se detiene y se reporta** (cambio de stack = decisión de Mateo, fuera del alcance aprobado). |
| Despliegue real a Cloudflare requiere cuenta y credenciales de Mateo | `wrangler deploy` y Cron Triggers no se pueden probar de verdad | CA-6 usa `--dry-run`; CA-8/CA-9 se verifican con `wrangler dev --test-scheduled` (local). El despliegue real y los secretos (`CLOUDFLARE_API_TOKEN`, etc.) quedan como paso final que requiere a Mateo. |
| Backup real a R2 requiere bucket + credenciales de R2/Cloudflare | CA-10 no puede ejecutarse hasta tenerlas | El workflow se escribe y se valida la sintaxis; la ejecución (`workflow_dispatch`) requiere los secretos de GitHub, que pone Mateo. |
| Confirmación de email de Supabase desactivada (D-9) | Riesgo de seguridad en producción | Es solo para dev/demo; **se reactiva antes de producción** (pendiente de Mateo, queda registrado en `INFRAESTRUCTURA.md`). |
| Limpieza sin tablas que purgar (015) | El Worker de limpieza no hace nada real todavía | Base intencional: la estructura se crea (D-7); el alcance de purga llega con 015. |
| `@opennextjs/cloudflare` exige una versión concreta de Next.js | Conflicto de versiones al instalar | Fijar la versión de Next 15 compatible según la doc del adaptador al momento de `npm install`. |
| CPU de 10 ms (Free) en invocaciones cron | Un query lento podría agotar el CPU | El ping y el monitoreo son 1 consulta trivial; si en la práctica excede, se evalúa Workers Paid (disparador de `ARQUITECTURA.md` §6). |

---

**Definición de terminado del plan:** con este documento aprobado por Mateo, el siguiente paso es
producir `specs/001-fundacion/tasks.md` (tareas atómicas con su verificación). No se escribe código antes.

