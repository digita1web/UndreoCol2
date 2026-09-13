# PLAN — 035: panel-maestro-planes-salud

**Spec aprobado:** 2026-09-13

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260925090000_panel-maestro-planes-salud.sql` | Nuevo | Tabla `_salud_sistema` (singleton, mismo patrón que `_keepalive`) + política de `select` nueva sobre `_keepalive` para `es_admin_plataforma()` |
| `backend/src/cron/monitor-db.ts` | Modificado | Después de calcular el nivel (como ya hace hoy), lo guarda en `_salud_sistema` |
| `backend/src/lib/plataforma.ts` | Modificado | `actualizarPlanEstadoAcueducto()`, `obtenerSaludSistema()`, `obtenerEstadoBackup()` |
| `backend/src/index.ts` | Modificado | `GET /plataforma` gana `planId`/`planNombre`/`estadoCuenta`; rutas nuevas `PATCH /plataforma/acueductos/:id` y `GET /plataforma/salud` |
| `backend/wrangler.toml` | Modificado | Binding R2 nuevo `BACKUPS_R2` → `undreocol-backups`, en el bloque raíz **y** en `[env.production]` (trampa M-3 ya documentada en el propio archivo) |
| `frontend/lib/api.ts` | Modificado | `Acueducto` gana `planId`/`planNombre`/`estadoCuenta`; tipos y funciones nuevas: `listarPlanes()`, `cambiarPlanEstadoAcueducto()`, `obtenerSaludSistema()` |
| `frontend/components/plan-estado-acueducto.tsx` | Nuevo | Dos `<select>` (plan, estado de cuenta) + botón "Guardar", por acueducto |
| `frontend/components/salud-sistema.tsx` | Nuevo | Presentación de los tres indicadores (sin interactividad — solo lectura) |
| `frontend/app/plataforma/page.tsx` | Modificado | Cada fila de acueducto gana `PlanEstadoAcueducto`; sección nueva "Salud del sistema" con `SaludSistema` |
| `backend/tests/unit/plataforma-rutas.test.ts` | Modificado | Casos nuevos para `PATCH /plataforma/acueductos/:id` y `GET /plataforma/salud` |
| `tests/aislamiento/904_salud_sistema_aislamiento.sql` | Nuevo | Mismo patrón que `903_panel_plataforma_aislamiento.sql` — confirma que solo `es_admin_plataforma()` lee `_salud_sistema`/`_keepalive`, y que solo esa membresía puede `UPDATE` `clientes.plan_id`/`estado_cuenta` |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

## 2. Esquema de base de datos

```sql
-- supabase/migrations/20260925090000_panel-maestro-planes-salud.sql

-- Tabla técnica de plataforma, mismo patrón que _keepalive (001-fundación):
-- sin cliente_id, sin RLS de negocio multi-tenant. El cron monitor-db.ts ya
-- corre con service_role y ya calcula tamaño/nivel — esto solo persiste ese
-- resultado para que una ruta de usuario lo lea sin tocar service_role_key
-- (CLAUDE.md §12, motivo central del spec §2).
create table if not exists _salud_sistema (
  id              smallint primary key default 1,
  tamano_base_mb  numeric not null,
  nivel           text not null,
  medido_en       timestamptz not null default now(),
  constraint chk_singleton check (id = 1)
);

insert into _salud_sistema (id, tamano_base_mb, nivel, medido_en) values (1, 0, 'ok', now())
  on conflict (id) do nothing;

alter table _salud_sistema enable row level security;
alter table _salud_sistema force row level security;

comment on table _salud_sistema is
  'Última medición del cron monitor-db.ts (D-7). Sin cliente_id: técnica de '
  'plataforma, igual que _keepalive. Escrita por service_role (el cron), '
  'leída por el superadmin vía la política de abajo.';

create policy salud_sistema_lectura on _salud_sistema for select
  using (es_admin_plataforma());

-- _keepalive (001-fundación) hoy no tiene ninguna política: ni el superadmin
-- puede leerla. Se agrega SOLO lectura, acotada igual que la de arriba —
-- nunca escritura (sigue siendo exclusiva de service_role, el cron de
-- keepalive.ts).
create policy keepalive_lectura_plataforma on _keepalive for select
  using (es_admin_plataforma());
```

No se toca `clientes.plan_id`/`clientes.estado_cuenta` (ya existen desde 001) ni la política
`clientes_plataforma` (ya autoriza el `UPDATE` del superadmin, confirmado en `/specify` — cero
cambio de RLS para el permiso de cambiar plan/estado).

## 3. Rutas de la API (Hono)

- **`GET /plataforma`** — mismo guard (`requerirAdminPlataforma`), amplía el `.select()` de
  `clientes` a `id, nombre, slug, fecha_alta, plan_id, estado_cuenta, planes(nombre)` y la respuesta
  a `{ ...acueducto, adminEmail, planId, planNombre, estadoCuenta }`.
- **`PATCH /plataforma/acueductos/:id`** — **nueva**. Body `{ planId?: string, estadoCuenta?:
  'activa'|'vencida'|'suspendida'|'cancelada' }` (al menos uno de los dos). Usa `ctx.supabase` (el
  cliente del superadmin, JWT propio — RLS autoriza vía `clientes_plataforma`, ya existente).
  `UPDATE clientes set ... where id = :id`. `404` si el `id` no existe (RLS + `.select()` vacío tras
  el update); `400` si `estadoCuenta` no es uno de los 4 valores del enum.
- **`GET /plataforma/salud`** — **nueva**. Mismo guard. Tres lecturas independientes, cada una con
  el cliente del superadmin (nunca `service_role`):
  1. `select tamano_base_mb, nivel, medido_en from _salud_sistema where id = 1` (RLS ya autoriza).
  2. `select ultimo_ping from _keepalive where id = 1` (RLS ya autoriza, política nueva de arriba).
  3. `env.BACKUPS_R2.list()` → ordenar por `uploaded` descendente, tomar el primero. Sin objetos →
     `ultimoBackup: null` (bucket recién creado o error transitorio, no se trata como fallo).

## 4. Contratos de `core/`

Ninguno — no hay cálculo de dinero ni lógica de negocio pura (calcular el nivel de monitoreo ya
vive en `cron/nivel-monitoreo.ts`, fuera de `core/` desde su feature original — se reutiliza tal
cual, sin moverlo).

### `backend/src/lib/plataforma.ts` — funciones nuevas

```ts
// UPDATE con el cliente del superadmin — RLS (clientes_plataforma) autoriza,
// sin permiso nuevo. Devuelve la fila actualizada o null si el id no existe
// (para que el caller responda 404, no un 200 vacío).
export async function actualizarPlanEstadoAcueducto(
  supabase: SupabaseClient,
  clienteId: string,
  cambios: { planId?: string; estadoCuenta?: string },
): Promise<{ id: string; planId: string | null; estadoCuenta: string } | null>

// Lee _salud_sistema y _keepalive con el JWT del superadmin — nunca
// service_role (motivo central del spec). Ambas tablas son singleton (id=1).
export async function obtenerSaludSistema(
  supabase: SupabaseClient,
): Promise<{ tamanoBaseMb: number; nivel: string; medidoEn: string; ultimoKeepalive: string | null }>

// R2Bucket.list() no pasa por RLS/Postgres — permiso de binding del propio
// Worker, no de service_role_key. Sin objetos → null, no lanza.
export async function obtenerEstadoBackup(
  bucket: R2Bucket,
): Promise<{ archivo: string; subidoEn: string } | null>
```

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `_salud_sistema` nueva, escrita por el cron, leída por RLS | Otorgar `execute` de `tamano_base_mb()` a `authenticated` con una guarda `es_admin_plataforma()` interna | El comentario de la función es explícito: pensada para llamarse solo con `service_role` (INFRAESTRUCTURA.md §8); reutilizar el patrón `_keepalive` que el propio proyecto ya usa para este mismo problema es la opción investigada primero, no una nueva (CLAUDE.md §3) |
| Estado del backup vía un binding R2 nuevo (`BACKUPS_R2`) | Llamar a la API de GitHub Actions (necesita `GITHUB_TOKEN` nuevo) | Decisión de Mateo en `/specify` — reutiliza el mecanismo de binding que el proyecto ya usa (`FACTURAS_R2`), sin agregar un secreto nuevo al Worker |
| `PATCH /plataforma/acueductos/:id` acepta los dos campos en un solo body opcional-cada-uno | Dos rutas separadas (`/plan`, `/estado-cuenta`) | Un solo formulario en la UI cambia ambos a la vez con frecuencia (dar de alta el cobro real de un acueducto implica fijar plan y activarlo); una sola ruta evita dos round-trips |
| `_keepalive` gana una política de `select`, nunca de `insert`/`update` | Ampliar también escritura | Ninguna necesidad de que el superadmin escriba esa tabla — sigue siendo exclusiva del cron, mínimo privilegio |
| `R2Bucket.list()` sin objetos devuelve `null`, no lanza | Tratarlo como error 500 | Un bucket vacío (recién creado, o el primer día antes del primer backup) no es una falla del sistema — es un estado legítimo que la UI puede mostrar como "sin backups todavía" |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

`R2Bucket.list()` sin paginar: con la retención de 30 días (D-7, lifecycle del bucket) el bucket
nunca acumula más que ~30 objetos — muy por debajo de cualquier límite de una sola invocación
`fetch` normal (CLAUDE.md §5.5). Si la retención cambiara en el futuro, revisar este supuesto.

## 8. Estrategia de pruebas

- **Unitarias (`backend/tests/unit/plataforma-rutas.test.ts`, mismo patrón `app.fetch` real):**
  - `PATCH /plataforma/acueductos/:id` sin sesión de plataforma → `403`.
  - Con sesión de plataforma, `estadoCuenta` inválido (no uno de los 4 valores) → `400`, sin llamar
    a `actualizarPlanEstadoAcueducto`.
  - Con sesión de plataforma, cambio válido → `200` con la fila actualizada.
  - `id` inexistente → `404`.
  - `GET /plataforma/salud` sin sesión de plataforma → `403`.
  - `GET /plataforma/salud` con sesión de plataforma, mock de `BACKUPS_R2.list()` devolviendo `[]`
    → `ultimoBackup: null`, sin lanzar.
- **Aislamiento (`tests/aislamiento/904_salud_sistema_aislamiento.sql`, manual vía `psql`):**
  - `admin_acueducto`/`anon` no pueden `select` de `_salud_sistema` ni de `_keepalive`.
  - `admin_acueducto` no puede `update` `clientes.plan_id`/`estado_cuenta` de **ningún** acueducto,
    ni siquiera el propio (regla ya vigente de `clientes_plataforma`, se reverifica que sigue
    sosteniéndose después de esta migración).
  - `es_admin_plataforma()` sí puede `select` ambas tablas y `update` `clientes`.
- **Manual (`wrangler dev --test-scheduled` para correr `monitor-db.ts` una vez, + `wrangler dev`
  normal para las rutas):**
  - Correr el cron una vez, confirmar `_salud_sistema` actualizada (consulta SQL directa).
  - `GET /plataforma/salud` con sesión real de superadmin devuelve esa misma medición.
  - `PATCH /plataforma/acueductos/:id` real sobre un acueducto de prueba, confirmado con una
    consulta SQL directa después.
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (sigue sin
  Chromium/Playwright en este entorno).
