# TASKS — 037: rutas-zonas-lector

**Plan aprobado:** 2026-09-14

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-001 y T-002 son para Luna. T-002 depende de T-001 ya
aplicado (necesita las rutas nuevas y `GET /dashboard` ampliado). T-003 es cierre, no es para
Luna — el test de aislamiento (seguridad de RLS) lo escribe y corre Claude/Mateo directamente,
mismo criterio que toda la superficie de seguridad de este proyecto.

---

## T-001 — Backend: tabla de asignación, rutas de sectores/lectores (PARA LUNA)

### Objetivo

Migración nueva (`lector_sectores` + función `mis_sectores_asignados()` + filtro de sector en
`usuarios_servicio_lector()` y en la política `lecturas_lectura`), cuatro rutas nuevas (`GET
/sectores`, `GET /lectores`, `POST /lectores/:perfilId/sectores`, `DELETE
/lectores/:perfilId/sectores/:sector`), y `GET /dashboard` amplía su respuesta con
`cliente.sectoresAsignados`.

### Reglas no negociables de este proyecto (léelas antes de escribir una línea)

- **Nunca `service_role_key`** en ninguna ruta nueva — usan `ctx.supabase` (JWT del usuario), RLS
  autoriza.
- **Retrocompatibilidad estricta (spec CA-3):** un lector sin ninguna fila en `lector_sectores`
  tiene que seguir viendo exactamente todo lo que ve hoy — no rompas esto.
- Nada de `console.log`. TypeScript estricto, nada de `any`.
- No toques `crearAcueductoBase`, `signUpAdminAcueducto`, ni ninguna otra función de
  `lib/plataforma.ts` — sin relación con esta feature.
- No escribas el test de aislamiento SQL — es de Claude/Mateo, T-003.

### Migración nueva: `supabase/migrations/20260927090000_rutas-zonas-lector.sql`

```sql
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

`estado_suscriptor`, `es_admin_plataforma()`, `es_admin_de()`, `mis_clientes()` ya existen — no los
vuelvas a crear. **No toques ninguna otra política ni función que no esté en este bloque.**

### Archivo nuevo: `backend/src/lib/lectores-sectores.ts`

```ts
// Asignación de sectores a lectores (037). Sin lógica de negocio (dinero,
// tarifas): no va a `core/`, igual que lib/tenant.ts.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LectorConSectores {
  perfilId: string;
  nombre: string;
  email: string;
  sectores: string[];
}

// Sectores ya en uso por los suscriptores del acueducto — el picker de
// asignación solo ofrece estos, nunca texto libre nuevo (spec §4).
export async function listarSectoresDisponibles(
  supabase: SupabaseClient,
  clienteId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('usuarios_servicio')
    .select('sector')
    .eq('cliente_id', clienteId)
    .not('sector', 'is', null);
  if (error) throw new Error(error.message);
  const sectores = new Set((data ?? []).map((f) => f.sector as string));
  return Array.from(sectores).sort();
}

export async function listarLectoresConSectores(
  supabase: SupabaseClient,
  clienteId: string,
): Promise<LectorConSectores[]> {
  const { data: membresias, error: errMembresias } = await supabase
    .from('membresias')
    .select('perfil_id, perfiles(nombre, email)')
    .eq('cliente_id', clienteId)
    .eq('rol', 'lector')
    .eq('activo', true);
  if (errMembresias) throw new Error(errMembresias.message);

  const { data: asignaciones, error: errAsignaciones } = await supabase
    .from('lector_sectores')
    .select('perfil_id, sector')
    .eq('cliente_id', clienteId);
  if (errAsignaciones) throw new Error(errAsignaciones.message);

  const sectoresPorPerfil = new Map<string, string[]>();
  for (const a of (asignaciones ?? []) as Array<{ perfil_id: string; sector: string }>) {
    const lista = sectoresPorPerfil.get(a.perfil_id) ?? [];
    lista.push(a.sector);
    sectoresPorPerfil.set(a.perfil_id, lista);
  }

  return ((membresias ?? []) as Array<{
    perfil_id: string;
    perfiles: { nombre?: string; email?: string } | null;
  }>).map((m) => ({
    perfilId: m.perfil_id,
    nombre: m.perfiles?.nombre ?? '',
    email: m.perfiles?.email ?? '',
    sectores: sectoresPorPerfil.get(m.perfil_id) ?? [],
  }));
}

export async function asignarSector(
  supabase: SupabaseClient,
  clienteId: string,
  perfilId: string,
  sector: string,
): Promise<void> {
  const { error } = await supabase
    .from('lector_sectores')
    .insert({ cliente_id: clienteId, perfil_id: perfilId, sector });
  if (error) {
    if (error.code === '23505') throw new Error('Ese sector ya está asignado a este lector');
    throw new Error(error.message);
  }
}

export async function quitarSector(
  supabase: SupabaseClient,
  clienteId: string,
  perfilId: string,
  sector: string,
): Promise<void> {
  const { error } = await supabase
    .from('lector_sectores')
    .delete()
    .eq('cliente_id', clienteId)
    .eq('perfil_id', perfilId)
    .eq('sector', sector);
  if (error) throw new Error(error.message);
}
```

### `backend/src/index.ts` — referencia real de `requerirClienteActivo` y el patrón de guard de rol
(ya existen, no los toques, solo son referencia de estilo)

```ts
type ResultadoClienteActivo =
  | { ctx: { supabase: ReturnType<typeof crearClienteSuscriptor>; clienteId: string; perfilId: string; rol: string }; respuesta?: undefined }
  | { ctx: null; respuesta: Response };

async function requerirClienteActivo(c: Context<{ Bindings: Env }>): Promise<ResultadoClienteActivo> { /* ya existe */ }
```

```ts
// Patrón real ya usado en GET /dashboard/indicadores — mismo criterio acá.
app.get('/dashboard/indicadores', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede ver los indicadores' }, 403);
  }
  /* ... */
});
```

### Rutas nuevas — agregá después de `GET /dashboard` (o donde tenga sentido cerca de las rutas de
`/suscriptores`)

```ts
app.get('/sectores', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const sectores = await listarSectoresDisponibles(ctx.supabase, ctx.clienteId);
    return c.json({ sectores });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudieron listar los sectores' }, 500);
  }
});

app.get('/lectores', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede gestionar lectores' }, 403);
  }
  try {
    const lectores = await listarLectoresConSectores(ctx.supabase, ctx.clienteId);
    return c.json({ lectores });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudieron listar los lectores' }, 500);
  }
});

app.post('/lectores/:perfilId/sectores', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede asignar sectores' }, 403);
  }
  const body = await c.req.json<{ sector?: string }>().catch(() => ({ sector: undefined }));
  const sector = body.sector?.trim();
  if (!sector) return c.json({ error: 'sector es requerido' }, 400);
  try {
    await asignarSector(ctx.supabase, ctx.clienteId, c.req.param('perfilId'), sector);
    return c.json({ ok: true }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'No se pudo asignar el sector';
    return c.json({ error: msg }, msg.includes('ya está asignado') ? 409 : 400);
  }
});

app.delete('/lectores/:perfilId/sectores/:sector', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede quitar sectores' }, 403);
  }
  try {
    await quitarSector(ctx.supabase, ctx.clienteId, c.req.param('perfilId'), decodeURIComponent(c.req.param('sector')));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo quitar el sector' }, 400);
  }
});
```

Agregá `listarSectoresDisponibles, listarLectoresConSectores, asignarSector, quitarSector` a un
import nuevo de `./lib/lectores-sectores` en la cabecera del archivo.

### `GET /dashboard` — cambio puntual (buscá la ruta real, no la reescribas completa)

Hoy termina así (el bloque real, tal cual está):

```ts
  const { data: usuariosServicio, error } = await supabase.rpc('usuarios_servicio_lector', {
    p_cliente_id: activo.clienteId,
  });
  if (error) return c.json({ error: 'No se pudo consultar usuarios_servicio' }, 500);
  return c.json({
    cliente: activo,
    perfil: { id: sesion.perfilId, email: sesion.email, nombre: (perfil as { nombre?: string } | null)?.nombre ?? sesion.email },
    conteoUsuariosServicio: usuariosServicio?.length ?? 0,
  });
});
```

Reemplazar por (agrega la consulta de `mis_sectores_asignados` y el campo nuevo en `cliente`, sin
tocar nada más de la ruta):

```ts
  const { data: usuariosServicio, error } = await supabase.rpc('usuarios_servicio_lector', {
    p_cliente_id: activo.clienteId,
  });
  if (error) return c.json({ error: 'No se pudo consultar usuarios_servicio' }, 500);

  // 037: sectores asignados al usuario actual en este acueducto — vacío si no
  // es lector o si no tiene ninguno asignado (sigue viendo todo, spec CA-3).
  const { data: misSectores } = await supabase.rpc('mis_sectores_asignados', {
    p_cliente_id: activo.clienteId,
  });

  return c.json({
    cliente: {
      ...activo,
      sectoresAsignados: ((misSectores ?? []) as Array<{ sector: string }>).map((f) => f.sector),
    },
    perfil: { id: sesion.perfilId, email: sesion.email, nombre: (perfil as { nombre?: string } | null)?.nombre ?? sesion.email },
    conteoUsuariosServicio: usuariosServicio?.length ?? 0,
  });
});
```

### Test nuevo: `backend/tests/unit/lectores-sectores.test.ts`

Mismo patrón que `backend/tests/unit/plataforma-rutas.test.ts` (mockear `lib/auth` y `lib/db`,
ejercitar `app.fetch` real). Casos mínimos:
1. `GET /lectores` sin sesión de `admin_acueducto` (rol `lector`/`secretaria`) → `403`.
2. `POST /lectores/:perfilId/sectores` sin sesión de `admin_acueducto` → `403`.
3. `POST /lectores/:perfilId/sectores` sin `sector` en el body → `400`.
4. `POST` de un sector ya asignado (mock de `asignarSector` lanzando "Ese sector ya está asignado a
   este lector") → `409`.
5. `DELETE /lectores/:perfilId/sectores/:sector` sin sesión de `admin_acueducto` → `403`.
6. `GET /sectores` con sesión de cualquier rol del acueducto → `200` con la lista (mock de
   `listarSectoresDisponibles`).

### Qué NO hacer

- No agregues `service_role_key` a ninguna ruta.
- No toques `usuarios_servicio_lector()` para nada que no sea el filtro de sector — su forma de
  retorno (`table`) y sus columnas quedan exactamente igual.
- No escribas el test de aislamiento SQL (`tests/aislamiento/905_...`) — es de Claude/Mateo, T-003.
- No toques `GET /suscriptores`, `listarSuscriptores()` en `lib/suscriptores.ts`, ni la política
  `usuarios_servicio_lectura` — el filtrado del lector ya pasa por `usuarios_servicio_lector()`
  (RPC), que es lo único que se modifica.

### Formato de entrega esperado de Luna

`supabase/migrations/20260927090000_rutas-zonas-lector.sql` completo (nuevo),
`backend/src/lib/lectores-sectores.ts` completo (nuevo), los bloques exactos de
`backend/src/index.ts` que cambiaron (import + las cuatro rutas + el cambio de `GET /dashboard`),
`backend/tests/unit/lectores-sectores.test.ts` completo (nuevo). Al final, la sección "Asunciones
sin verificar" de tu prompt base.

---

## T-002 — Frontend: pantalla de asignación y "Zona actual" en AquaLectura (PARA LUNA)

### Objetivo

Pantalla nueva `/app/lectores` (solo `admin_acueducto`) para asignar/quitar sectores a cada lector;
"Inicio" de AquaLectura (025) muestra el sector real asignado, en vez de quedar fuera de alcance
como hasta ahora.

**Esta tarea depende de T-001 ya aplicado** — necesita `GET /sectores`, `GET /lectores`, `POST`/
`DELETE .../sectores` y `GET /dashboard` con `cliente.sectoresAsignados`. Si no se aplicó todavía,
avisá antes de escribir código que asuma una respuesta que el backend no da todavía.

### `frontend/lib/api.ts` — agregar (buscá `ContextoUsuario`, no necesitás ver el archivo entero)

`ContextoUsuario` hoy es:
```ts
export interface ContextoUsuario {
  cliente: { clienteId: string; rol: string; nombre: string };
  perfil: { id: string; email: string; nombre: string };
  conteoUsuariosServicio: number;
}
```
Reemplazar por (agrega `sectoresAsignados` a `cliente`):
```ts
export interface ContextoUsuario {
  cliente: { clienteId: string; rol: string; nombre: string; sectoresAsignados: string[] };
  perfil: { id: string; email: string; nombre: string };
  conteoUsuariosServicio: number;
}
```

Agregar cerca de las funciones de suscriptores (mismo estilo, todas usan `peticion<T>()`):
```ts
export interface LectorConSectores {
  perfilId: string;
  nombre: string;
  email: string;
  sectores: string[];
}

export function listarSectoresDisponibles(): Promise<{ sectores: string[] }> {
  return peticion('/sectores');
}

export function listarLectoresConSectores(): Promise<{ lectores: LectorConSectores[] }> {
  return peticion('/lectores');
}

export function asignarSectorLector(perfilId: string, sector: string): Promise<{ ok: true }> {
  return peticion(`/lectores/${perfilId}/sectores`, {
    method: 'POST',
    body: JSON.stringify({ sector }),
  });
}

export function quitarSectorLector(perfilId: string, sector: string): Promise<{ ok: true }> {
  return peticion(`/lectores/${perfilId}/sectores/${encodeURIComponent(sector)}`, {
    method: 'DELETE',
  });
}
```

### Ícono nuevo: `frontend/components/panel/iconos.tsx` — agregar (no reescribas el archivo
completo, agregá esta función junto a las demás, mismo estilo — un pin de ubicación simple)

```tsx
export function IconoLectores(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 21s7-6.5 7-11.5a7 7 0 0 0-14 0C5 14.5 12 21 12 21z" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
```

`BASE` y `PropsIcono` ya existen en ese archivo (usados por `IconoSuscriptores`,
`IconoNotificaciones`, etc.) — no los redefinas.

### Pantalla nueva: `frontend/app/app/lectores/page.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  asignarSectorLector,
  listarLectoresConSectores,
  listarSectoresDisponibles,
  quitarSectorLector,
  type LectorConSectores,
} from '@/lib/api';

export default function LectoresPage() {
  const [lectores, setLectores] = useState<LectorConSectores[] | null>(null);
  const [sectoresDisponibles, setSectoresDisponibles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function recargar() {
    setError(null);
    listarLectoresConSectores()
      .then((r) => setLectores(r.lectores))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los lectores'));
    listarSectoresDisponibles()
      .then((r) => setSectoresDisponibles(r.sectores))
      .catch(() => setSectoresDisponibles([]));
  }

  useEffect(recargar, []);

  async function alCambiar(perfilId: string, sector: string, asignado: boolean) {
    setError(null);
    try {
      if (asignado) {
        await quitarSectorLector(perfilId, sector);
      } else {
        await asignarSectorLector(perfilId, sector);
      }
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar la asignación');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Lectores</h1>
      <p className="text-sm text-muted-foreground">
        Asigná uno o más sectores a cada lector. Sin ningún sector asignado, el lector sigue viendo
        todo el acueducto.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {sectoresDisponibles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay ningún suscriptor con sector cargado — no hay nada que asignar por ahora.
        </p>
      )}
      {(lectores ?? []).map((l) => (
        <Card key={l.perfilId}>
          <CardHeader>
            <CardTitle className="text-base">{l.nombre || l.email}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {sectoresDisponibles.map((sector) => {
              const asignado = l.sectores.includes(sector);
              return (
                <label key={sector} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={asignado}
                    onChange={() => alCambiar(l.perfilId, sector, asignado)}
                  />
                  {sector}
                </label>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </main>
  );
}
```

### `frontend/components/panel/sidebar-panel.tsx` — cambios puntuales

1. Import nuevo: agregá `IconoLectores` al import ya existente de `@/components/panel/iconos`.
2. En `SECCIONES`, agregá una entrada nueva (el orden dentro del array es el orden visual — ponela
   después de `'/app/lecturas'`):
   ```ts
   { href: '/app/lectores', etiqueta: 'Lectores', Icono: IconoLectores },
   ```
3. La línea del `.filter(...)` hoy es:
   ```ts
   {SECCIONES.filter(({ href }) => href !== '/app/configuracion' || operador?.rol !== 'secretaria').map(...)}
   ```
   Reemplazar por (agrega la condición de `/app/lectores`, sin tocar la de `/app/configuracion`):
   ```ts
   {SECCIONES.filter(
     ({ href }) =>
       (href !== '/app/configuracion' || operador?.rol !== 'secretaria') &&
       (href !== '/app/lectores' || operador?.rol === 'admin_acueducto'),
   ).map(...)}
   ```

### `frontend/components/lector/inicio-lector.tsx` — archivo completo tal cual está hoy

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Lectura } from '@/lib/api';

interface InicioLectorProps {
  nombreAcueducto: string | null;
  lecturasAbiertas: Lectura[] | null;
}

export function InicioLector({ nombreAcueducto, lecturasAbiertas }: InicioLectorProps) {
  const hoy = new Date().toISOString().slice(0, 10);
  const lecturasHoy = (lecturasAbiertas ?? []).filter((l) => l.fecha_lectura === hoy).length;
  const pendientes = (lecturasAbiertas ?? []).filter((l) => l.revision !== 'normal' && !l.revisada).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">¡Hola!</h1>
        <p className="text-sm text-muted-foreground">
          {nombreAcueducto ? `Lecturas de ${nombreAcueducto}.` : 'Cargando tu acueducto…'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Lecturas hoy</p>
            <p className="text-2xl font-bold">{lecturasHoy}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pendientes</p>
            <p className="text-2xl font-bold text-red-600">{pendientes}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrar una lectura</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Andá a la pestaña <strong>Nueva</strong> para elegir un suscriptor y cargar la lectura de su contador.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Cambios a hacer:** agregá un prop `sectoresAsignados: string[]` y una tarjeta nueva "Zona actual"
(antes de "Registrar una lectura", después del `<div>` de arriba) — si `sectoresAsignados` está
vacío, mostrá "Todos los sectores"; si tiene valores, mostralos separados por coma:

```tsx
interface InicioLectorProps {
  nombreAcueducto: string | null;
  lecturasAbiertas: Lectura[] | null;
  sectoresAsignados: string[];
}
```

```tsx
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Zona actual</p>
          <p className="text-sm font-medium">
            {sectoresAsignados.length > 0 ? sectoresAsignados.join(', ') : 'Todos los sectores'}
          </p>
        </CardContent>
      </Card>
```

### `frontend/app/app/lecturas/page.tsx` — cambio puntual en `VistaLector` (no reescribas el
archivo completo, buscá la función `VistaLector`)

`VistaLector` hoy no tiene ningún estado de sectores. Agregá:
1. `const [sectoresAsignados, setSectoresAsignados] = useState<string[]>([]);`
2. Un `useEffect` nuevo (junto al que ya carga períodos/suscriptores/acueducto) que llame
   `obtenerContextoUsuario()` (ya existe en `lib/api.ts`, usalo tal cual) y guarde
   `r.cliente.sectoresAsignados` en ese estado.
3. Pasale `sectoresAsignados={sectoresAsignados}` a `<InicioLector .../>`.

### Qué NO hacer

- No importes `@supabase/*` en ningún archivo de `frontend/` (CLAUDE.md §5.2, absoluto).
- No agregues un catálogo de sectores editable (crear/renombrar) — `sectoresDisponibles` viene tal
  cual de `GET /sectores`, sin ningún input de texto libre para escribir un sector nuevo (spec §4).
- No toques `VistaAdmin` en `lecturas/page.tsx`, ni `PendientesLector`/`HistorialLector` — el
  filtrado de esos ya lo resuelve el backend (T-001), no hace falta tocar el frontend de esas dos
  pestañas.
- No conviertas `LectoresPage` en un componente que reciba props de un server component — es una
  pantalla nueva, standalone, cliente de punta a punta (mismo criterio que otras pantallas de
  gestión ya existentes).

### Criterios de aceptación (spec.md §6, verificación real pendiente de Claude/Mateo — no tuya)

- CA-1 a CA-7 de `specs/037-rutas-zonas-lector/spec.md` §6.

### Formato de entrega esperado de Luna

`frontend/lib/api.ts` (los bloques que cambiaron), `frontend/components/panel/iconos.tsx` (el
bloque agregado), `frontend/app/app/lectores/page.tsx` completo (nuevo),
`frontend/components/panel/sidebar-panel.tsx` completo, `frontend/components/lector/inicio-lector.tsx`
completo, `frontend/app/app/lecturas/page.tsx` (el bloque de `VistaLector` que cambió). Al final, la
sección "Asunciones sin verificar" de tu prompt base.

---

## T-003 — Cierre: test de aislamiento, verificación de punta a punta, CHANGELOG (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `tests/aislamiento/905_rutas_zonas_lector_aislamiento.sql` (nuevo, escrito por Claude
— seguridad de RLS, no delegado), `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (roadmap: "asignación de
rutas/zonas al lector" pasa de "sin empezar" a implementado).

**Verificación real:**
```
cd backend && npm test && npm run build && npm run lint && npm run knip && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint && npm run knip
```

Más, contra Postgres local real y `wrangler dev` real (RLS real, no alcanza con build/lint):
1. Aplicar la migración contra el stack local.
2. Correr `tests/aislamiento/905_rutas_zonas_lector_aislamiento.sql` con `psql` real — dos
   suscriptores de prueba en sectores distintos, un lector asignado a uno solo: confirma CA-2, CA-4,
   CA-5; un segundo lector sin ninguna asignación confirma CA-3 (regresión); `admin_acueducto`/
   `secretaria` confirman CA-6; un `lector` no puede escribir en `lector_sectores` directo.
3. `curl` real con sesión de `admin_acueducto`: `GET /sectores`, `GET /lectores`, asignar y quitar
   un sector real, confirmando con una consulta SQL directa después de cada cambio.
4. `curl` real con sesión de un lector con sector asignado: `GET /dashboard` devuelve
   `sectoresAsignados` correcto; una petición a lecturas/suscriptores de otro sector no devuelve
   nada de más (CA-4).
5. `grep` confirmando que ninguna de las rutas/funciones nuevas usa `service_role`/`SERVICE_ROLE_KEY`.

**Estado:** PENDIENTE — sin empezar todavía.
