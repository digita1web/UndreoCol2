# PLAN — 037: rutas-zonas-lector

**Spec aprobado:** 2026-09-14

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260927090000_rutas-zonas-lector.sql` | Nuevo | Tabla `lector_sectores`, función `mis_sectores_asignados()`, actualiza `usuarios_servicio_lector()` y la política `lecturas_lectura` para filtrar por sector cuando aplica |
| `backend/src/lib/lectores-sectores.ts` | Nuevo | `listarSectoresDisponibles`, `listarLectoresConSectores`, `asignarSector`, `quitarSector` |
| `backend/src/index.ts` | Modificado | Rutas nuevas `GET /sectores`, `GET /lectores`, `POST /lectores/:perfilId/sectores`, `DELETE /lectores/:perfilId/sectores/:sector`; `GET /dashboard` gana `cliente.sectoresAsignados` |
| `backend/tests/unit/lectores-sectores.test.ts` | Nuevo | Rutas nuevas: autorización, alta/baja, listado |
| `tests/aislamiento/905_rutas_zonas_lector_aislamiento.sql` | Nuevo | RLS de `lector_sectores`, filtrado real de `usuarios_servicio_lector()`/`lecturas`, regresión de "sin sectores ve todo" |
| `frontend/lib/api.ts` | Modificado | Tipos y funciones nuevas; `ContextoUsuario.cliente` gana `sectoresAsignados` |
| `frontend/app/app/lectores/page.tsx` | Nuevo | Pantalla del `admin_acueducto`: lista de lectores, sectores asignados, checkboxes de sectores disponibles |
| `frontend/components/lector/inicio-lector.tsx` | Modificado | Muestra "Zona actual" con los sectores reales asignados |
| `frontend/components/panel/sidebar-panel.tsx` | Modificado | Enlace nuevo a "Lectores", solo visible para `admin_acueducto` |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

## 2. Esquema de base de datos

```sql
-- supabase/migrations/20260927090000_rutas-zonas-lector.sql

-- Asignación lector<->sector (037). Tabla de negocio: lleva cliente_id y RLS
-- FORCE sin excepciones (CLAUDE.md §5.4), aunque sea chica.
create table lector_sectores (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  perfil_id  uuid not null references perfiles(id) on delete cascade,
  sector     text not null,
  created_at timestamptz not null default now(),
  unique (cliente_id, perfil_id, sector)
);

alter table lector_sectores enable row level security;
alter table lector_sectores force row level security;

-- Lectura amplia por pertenencia (igual que contadores_lectura, B-3): el
-- propio lector necesita leer sus asignaciones para "Zona actual" (Inicio,
-- AquaLectura); el nombre de un sector no es información sensible.
create policy lector_sectores_lectura on lector_sectores for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));

-- Solo admin_acueducto (o superadmin) asigna/quita sectores.
create policy lector_sectores_escritura on lector_sectores for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

-- Sectores asignados a auth.uid() para un cliente — vacío = sin restricción,
-- ve todo el acueducto (retrocompatibilidad, spec CA-3). SECURITY DEFINER
-- para poder llamarse desde políticas RLS de otras tablas sin recursión.
-- `returns table` (no `setof text`), mismo patrón que usuarios_servicio_lector()
-- ya usa — formato de fila sin ambigüedad al llamarla directo vía .rpc() desde
-- el backend (GET /dashboard, para "Zona actual"), no solo desde otro SQL.
create or replace function mis_sectores_asignados(p_cliente_id uuid)
returns table (sector text)
language sql stable security definer set search_path = public as $$
  select sector from lector_sectores
  where perfil_id = auth.uid() and cliente_id = p_cliente_id;
$$;

-- usuarios_servicio_lector() (024) gana el filtro de sector — mismo criterio
-- de "sin asignación, ve todo".
create or replace function usuarios_servicio_lector(p_cliente_id uuid, p_estado text default null)
returns table (id uuid, codigo_suscriptor text, nombre text, contador_actual_id uuid, estado estado_suscriptor)
language sql stable security definer set search_path = public as $$
  select u.id, u.codigo_suscriptor, u.nombre, u.contador_actual_id, u.estado
  from usuarios_servicio u
  where u.cliente_id = p_cliente_id
    and (es_admin_plataforma() or p_cliente_id in (select mis_clientes()))
    and (p_estado is null or u.estado::text = p_estado)
    and (
      not exists (select 1 from mis_sectores_asignados(p_cliente_id))
      or u.sector in (select sector from mis_sectores_asignados(p_cliente_id))
    )
  order by u.nombre;
$$;

-- lecturas_lectura (004) gana el mismo filtro, vía join a contadores/usuarios_servicio.
drop policy lecturas_lectura on lecturas;
create policy lecturas_lectura on lecturas for select
  using (
    es_admin_plataforma()
    or (
      cliente_id in (select mis_clientes())
      and (
        not exists (select 1 from mis_sectores_asignados(lecturas.cliente_id))
        or contador_id in (
          select c.id from contadores c
          join usuarios_servicio u on u.id = c.usuario_servicio_id
          where c.cliente_id = lecturas.cliente_id
            and u.sector in (select sector from mis_sectores_asignados(lecturas.cliente_id))
        )
      )
    )
  );
```

`estado_suscriptor` y las funciones `es_admin_plataforma()`/`es_admin_de()`/`mis_clientes()` ya
existen (001/024) — no se tocan.

## 3. Rutas de la API (Hono)

- **`GET /sectores`** — nueva. Cualquier miembro del cliente activo (RLS ya limita por pertenencia).
  `select distinct sector from usuarios_servicio where cliente_id = :clienteId and sector is not null
  order by sector`. Devuelve la lista de sectores **ya en uso** por los suscriptores del acueducto —
  el picker de asignación solo ofrece sectores reales, nunca texto libre nuevo (spec §4: no se
  gestiona un catálogo de sectores aparte).
- **`GET /lectores`** — nueva, exige `admin_acueducto`. Lista las membresías `rol = 'lector'` del
  cliente activo con sus sectores asignados (`lector_sectores`).
- **`POST /lectores/:perfilId/sectores`** — nueva, exige `admin_acueducto`. Body `{ sector: string
  }`. Inserta en `lector_sectores` (RLS ya autoriza vía `lector_sectores_escritura`); `409` si ya
  estaba asignado (viola el `unique`).
- **`DELETE /lectores/:perfilId/sectores/:sector`** — nueva, exige `admin_acueducto`. Borra la fila
  correspondiente.
- **`GET /dashboard`** — amplía la respuesta: cuando `activo.rol === 'lector'`, agrega
  `cliente.sectoresAsignados: string[]` (vacío = sin restricción). Para los demás roles, `[]`
  (visualmente no se usa, pero mantiene el tipo simple sin `| null`).

## 4. Contratos de `core/`

Ninguno — no hay cálculo de dinero ni lógica de negocio pura involucrada.

### `backend/src/lib/lectores-sectores.ts` — funciones nuevas

```ts
export interface LectorConSectores {
  perfilId: string;
  nombre: string;
  email: string;
  sectores: string[];
}

// SECURITY INVOKER: `supabase` es el cliente del admin_acueducto, RLS autoriza.
export async function listarSectoresDisponibles(supabase: SupabaseClient, clienteId: string): Promise<string[]>
export async function listarLectoresConSectores(supabase: SupabaseClient, clienteId: string): Promise<LectorConSectores[]>
export async function asignarSector(supabase: SupabaseClient, clienteId: string, perfilId: string, sector: string): Promise<void>
export async function quitarSector(supabase: SupabaseClient, clienteId: string, perfilId: string, sector: string): Promise<void>
```

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Filtrado de "sin sectores asignados = ve todo" implementado como `not exists (...)` dentro de la misma función/política | Una columna `restringido boolean` aparte en `membresias` | Menos estado que mantener sincronizado — "cero filas en `lector_sectores`" ya es la señal completa, no hace falta duplicarla |
| `GET /sectores` devuelve solo valores ya en uso (`distinct` sobre `usuarios_servicio.sector`) | Dejar que el admin escriba cualquier texto al asignar | Evita el problema de inconsistencia de mayúsculas/espacios que el propio spec (§7) documentó como riesgo aceptado — no lo resuelve de raíz, pero al menos no permite asignar un sector que no coincide con ningún suscriptor real |
| `mis_sectores_asignados()` como función `security definer` reutilizable, en vez de repetir la subconsulta en cada política | Subconsulta inline en `usuarios_servicio_lector()` y en `lecturas_lectura` por separado | Mismo criterio ya establecido en el proyecto (`es_admin_de`, `tiene_rol`, `mis_clientes`) — una sola función, dos usos, más fácil de verificar y de mantener consistente |
| Nueva pantalla `/app/lectores` en vez de agregarlo a `/app/configuracion` (023) | Meterlo en la pantalla de configuración existente | `/app/configuracion` es branding del acueducto (color, logo); gestionar el equipo humano es un dominio distinto — mezclar los dos infla una pantalla que no tiene relación |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — todas las rutas nuevas son consultas simples, muy por debajo de cualquier límite de una
invocación `fetch` normal.

## 8. Estrategia de pruebas

- **Unitarias (`backend/tests/unit/lectores-sectores.test.ts`, mismo patrón `app.fetch` real):**
  - `GET /lectores`/`POST .../sectores`/`DELETE .../sectores/:sector` sin sesión de `admin_acueducto`
    → `403`.
  - `POST` de un sector ya asignado → `409`.
  - `GET /sectores` devuelve solo valores distintos y no nulos.
  - `GET /dashboard` con un lector de prueba sin sectores asignados → `sectoresAsignados: []`; con
    sectores asignados → la lista real.
- **Aislamiento (`tests/aislamiento/905_rutas_zonas_lector_aislamiento.sql`, manual vía `psql`):**
  - Dos suscriptores de prueba en sectores distintos (`Centro`, `Norte`); un lector de prueba
    asignado solo a `Centro`.
  - `usuarios_servicio_lector()` para ese lector devuelve solo el suscriptor de `Centro`.
  - Una lectura de prueba sobre el contador del suscriptor de `Norte` no aparece en `select * from
    lecturas` para ese lector (RLS).
  - Un segundo lector de prueba, sin ninguna fila en `lector_sectores`, sigue viendo ambos
    suscriptores y ambas lecturas — regresión explícita de CA-3.
  - `admin_acueducto`/`secretaria` siguen viendo todo, con o sin filas en `lector_sectores` para
    cualquier lector — CA-6.
  - Un `lector` no puede `insert`/`update`/`delete` en `lector_sectores` (`lector_sectores_escritura`
    exige `es_admin_de`).
- **Manual (`wrangler dev` + `next dev` reales):**
  - Asignar un sector real a un lector de prueba desde `/app/lectores`, confirmar que "Nueva lectura"
    y "Pendientes"/"Historial" de ese lector se acotan de verdad (CA-2), y que un `curl` directo con
    su sesión pidiendo lecturas de otro sector no las devuelve (CA-4).
  - "Inicio" de AquaLectura muestra el sector real asignado (CA-7).
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (sigue sin
  Chromium/Playwright en este entorno).
