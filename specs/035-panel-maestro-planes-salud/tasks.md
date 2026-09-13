# TASKS — 035: panel-maestro-planes-salud

**Plan aprobado:** 2026-09-13

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-001 y T-002 son para Luna. T-002 depende de T-001 ya
aplicado (necesita la forma nueva de `GET /plataforma` y la ruta `GET /plataforma/salud`). T-003 es
cierre, no es para Luna — el test de aislamiento (seguridad de RLS) lo escribe y corre Claude/Mateo
directamente, no Luna, mismo criterio que toda la superficie de seguridad de este proyecto.

---

## T-001 — Backend: migración + rutas de planes/estado de cuenta y salud del sistema (PARA LUNA)

### Objetivo

Migración SQL nueva (`_salud_sistema` + política de lectura sobre `_keepalive`), el cron
`monitor-db.ts` gana un paso que escribe su resultado, y tres cambios en la API: `GET /plataforma`
amplía su respuesta, `PATCH /plataforma/acueductos/:id` (nueva) cambia plan/estado de cuenta, `GET
/plataforma/salud` (nueva) devuelve los tres indicadores.

### Reglas no negociables de este proyecto (léelas antes de escribir una línea)

- **Nunca `service_role_key` en las rutas nuevas.** Ambas atienden al superadmin — usan
  `ctx.supabase` (el cliente ya autenticado con su JWT), igual que el resto de `/plataforma`.
- `R2Bucket.list()` no es un permiso de `service_role` — es el binding propio del Worker, se usa
  directo con `c.env.BACKUPS_R2`.
- Nada de `console.log`. TypeScript estricto, nada de `any`.
- No toques `crearAcueductoBase`, `signUpAdminAcueducto`, `asignarAdminAcueducto`,
  `generarContrasenaInterna`, `obtenerAdminsDeAcueductos` en `lib/plataforma.ts` — se agregan
  funciones nuevas al final, no se tocan las existentes.

### Migración nueva: `supabase/migrations/20260925090000_panel-maestro-planes-salud.sql`

```sql
-- Tabla técnica de plataforma, mismo patrón que _keepalive (001-fundación):
-- sin cliente_id, sin RLS de negocio multi-tenant. El cron monitor-db.ts ya
-- corre con service_role y ya calcula tamaño/nivel — esto solo persiste ese
-- resultado para que una ruta de usuario lo lea sin tocar service_role_key.
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

-- _keepalive (001-fundación) hoy no tiene ninguna política. Se agrega SOLO
-- lectura, acotada igual que la de arriba — nunca escritura (sigue siendo
-- exclusiva de service_role, el cron de keepalive.ts).
create policy keepalive_lectura_plataforma on _keepalive for select
  using (es_admin_plataforma());
```

`es_admin_plataforma()` ya existe (001-fundación) — no la vuelvas a crear.

### `backend/src/cron/monitor-db.ts` — archivo completo tal cual está hoy

```ts
// Worker `undreocol-monitor-db` — cron diario "30 5 * * *" (D-7,
// INFRAESTRUCTURA.md §8). Consulta tamano_base_mb() (límite del plan Free:
// 500 MB) y calcula el nivel. En nivel >= alerta envía un correo real al
// equipo de UndreoCol (010, spec §3.8) y lo deja en el log (CA-9).
//
// La alerta NO pasa por la tabla `notificaciones` (010, spec §3.8, decisión
// de diseño aprobada): esa tabla es multi-tenant con `cliente_id` obligatorio
// sin excepciones (CLAUDE.md §5.4), y esta alerta es operativa de la
// plataforma, no de ningún acueducto cliente. Sin reintento con límite tipo
// `computarActualizacionNotificacion`: el cron corre a diario, así que un
// fallo de envío de hoy se reintenta naturalmente mañana si la condición
// persiste (spec §3.8).
//
// NOTA: este módulo SOLO exporta el default (handler). La lógica pura
// (incluido el contenido de la alerta) vive en ./nivel-monitoreo.ts para
// poder testearla con vitest sin mockear el envío de correo.

import { crearClienteServicio } from '../lib/db';
import { calcularNivel, construirAlertaMonitoreo, LIMITE_BASE_MB } from './nivel-monitoreo';
import { enviarCorreo } from '../lib/email';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  EMAIL?: { send: (m: unknown) => Promise<{ messageId?: string }> };
  ALERTA_EMAIL_DESTINO: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const supabase = crearClienteServicio(env);
    const { data, error } = await supabase.rpc('tamano_base_mb');
    if (error) {
      throw new Error(`monitor-db: no se pudo consultar tamano_base_mb() — ${error.message}`);
    }
    const mb = Number(data);
    if (!Number.isFinite(mb) || mb <= 0) {
      throw new Error(`monitor-db: tamano_base_mb() devolvió un valor inválido: ${data}`);
    }
    const resultado = calcularNivel(mb);
    console.info(
      `monitor-db: base de ${mb} MB (${resultado.porcentaje}% del límite de ${LIMITE_BASE_MB} MB) — nivel ${resultado.nivel}`,
    );
    if (resultado.nivel === 'alerta' || resultado.nivel === 'critico') {
      console.error(`monitor-db: ALERTA ${resultado.nivel} — ${resultado.porcentaje}% del límite de 500 MB`);
      const contenido = construirAlertaMonitoreo(resultado);
      const envio = await enviarCorreo(env, {
        destinatario: env.ALERTA_EMAIL_DESTINO,
        remitente: 'no-responder@undreocol.app',
        asunto: contenido.asunto,
        cuerpoHtml: contenido.cuerpoHtml,
      });
      if (!envio.ok) {
        console.error(`monitor-db: no se pudo enviar el correo de alerta — ${envio.error}`);
      }
    }
  },
};
```

**Agregá un paso, después de calcular `resultado` y antes del `if` de alerta** (el `if` de alerta
queda igual, no lo toques):

```ts
    // 035: persiste la medición para que el panel de plataforma la lea sin
    // service_role_key — nunca falla el cron entero por esto (el monitoreo ya
    // corrió, no tiene sentido perder la ejecución por un problema al guardar
    // el histórico de una sola fila).
    const { error: errSalud } = await supabase
      .from('_salud_sistema')
      .update({ tamano_base_mb: mb, nivel: resultado.nivel, medido_en: new Date().toISOString() })
      .eq('id', 1);
    if (errSalud) {
      console.error('monitor-db: no se pudo actualizar _salud_sistema', errSalud.message);
    }
```

### `backend/src/lib/db.ts` — agregar el tipo del binding nuevo al `Env` (buscá la interfaz `Env`,
agregá esta línea junto a `FACTURAS_R2`)

```ts
  // R2: histórico de backups diarios (035). En dev local wrangler lo simula.
  BACKUPS_R2?: R2Bucket;
```

### `backend/src/lib/plataforma.ts` — funciones nuevas (agregar al final del archivo, no toques
nada de lo que ya existe)

```ts
// UPDATE con el cliente del superadmin (035) — RLS (clientes_plataforma,
// 001-fundación) ya autoriza, sin permiso nuevo. null si el id no existe
// (para que el caller responda 404, no un 200 vacío).
export async function actualizarPlanEstadoAcueducto(
  supabase: SupabaseClient,
  clienteId: string,
  cambios: { planId?: string; estadoCuenta?: string },
): Promise<{ id: string; planId: string | null; estadoCuenta: string } | null> {
  const patch: Record<string, string> = {};
  if (cambios.planId !== undefined) patch.plan_id = cambios.planId;
  if (cambios.estadoCuenta !== undefined) patch.estado_cuenta = cambios.estadoCuenta;

  const { data, error } = await supabase
    .from('clientes')
    .update(patch)
    .eq('id', clienteId)
    .select('id, plan_id, estado_cuenta')
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;
  return { id: data.id as string, planId: data.plan_id as string | null, estadoCuenta: data.estado_cuenta as string };
}

// Lee _salud_sistema y _keepalive con el JWT del superadmin (035) — nunca
// service_role. Ambas tablas son singleton (id = 1).
export async function obtenerSaludSistema(
  supabase: SupabaseClient,
): Promise<{ tamanoBaseMb: number; nivel: string; medidoEn: string; ultimoKeepalive: string | null }> {
  const { data: salud, error: errSalud } = await supabase
    .from('_salud_sistema')
    .select('tamano_base_mb, nivel, medido_en')
    .eq('id', 1)
    .maybeSingle();
  if (errSalud) {
    throw new Error(errSalud.message);
  }
  const { data: keepalive } = await supabase
    .from('_keepalive')
    .select('ultimo_ping')
    .eq('id', 1)
    .maybeSingle();

  return {
    tamanoBaseMb: Number(salud?.tamano_base_mb ?? 0),
    nivel: (salud?.nivel as string) ?? 'ok',
    medidoEn: (salud?.medido_en as string) ?? new Date(0).toISOString(),
    ultimoKeepalive: (keepalive?.ultimo_ping as string) ?? null,
  };
}

// R2Bucket.list() (035) — permiso de binding del Worker, no de
// service_role_key ni de RLS. Bucket vacío -> null, nunca lanza (no es un
// error del sistema, puede ser el primer día antes del primer backup).
export async function obtenerEstadoBackup(
  bucket: R2Bucket,
): Promise<{ archivo: string; subidoEn: string } | null> {
  const listado = await bucket.list();
  if (listado.objects.length === 0) return null;
  const masReciente = listado.objects.reduce((a, b) => (a.uploaded > b.uploaded ? a : b));
  return { archivo: masReciente.key, subidoEn: masReciente.uploaded.toISOString() };
}
```

### `backend/src/index.ts` — `GET /plataforma` hoy (reemplazar completo)

```ts
// GET /plataforma — lista de acueductos, solo para el superadmin.
app.get('/plataforma', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;
  const { data, error } = await ctx.supabase
    .from('clientes')
    .select('id, nombre, slug, fecha_alta')
    .order('fecha_alta', { ascending: false });
  if (error) return c.json({ error: 'No se pudo listar los acueductos' }, 500);
  const acueductos = data ?? [];
  const adminsPorCliente = await obtenerAdminsDeAcueductos(ctx.supabase, acueductos.map((a) => a.id));
  return c.json({
    acueductos: acueductos.map((a) => ({ ...a, adminEmail: adminsPorCliente[a.id] ?? null })),
  });
});
```

Reemplazar por (amplía el `.select()` con el plan embebido y agrega los 3 campos a la respuesta):

```ts
// GET /plataforma — lista de acueductos, solo para el superadmin.
app.get('/plataforma', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;
  const { data, error } = await ctx.supabase
    .from('clientes')
    .select('id, nombre, slug, fecha_alta, plan_id, estado_cuenta, planes(nombre)')
    .order('fecha_alta', { ascending: false });
  if (error) return c.json({ error: 'No se pudo listar los acueductos' }, 500);
  const acueductos = data ?? [];
  const adminsPorCliente = await obtenerAdminsDeAcueductos(ctx.supabase, acueductos.map((a) => a.id));
  return c.json({
    acueductos: acueductos.map((a) => {
      const planEmbebido = a.planes as { nombre?: string } | null;
      return {
        id: a.id,
        nombre: a.nombre,
        slug: a.slug,
        fecha_alta: a.fecha_alta,
        adminEmail: adminsPorCliente[a.id] ?? null,
        planId: a.plan_id,
        planNombre: planEmbebido?.nombre ?? null,
        estadoCuenta: a.estado_cuenta,
      };
    }),
  });
});
```

### Rutas nuevas — agregar después de `GET /plataforma` (mismo bloque de `/plataforma`)

```ts
const ESTADOS_CUENTA_VALIDOS = ['activa', 'vencida', 'suspendida', 'cancelada'];

// PATCH /plataforma/acueductos/:id — cambia plan y/o estado de cuenta (035).
app.patch('/plataforma/acueductos/:id', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;

  const body = await c.req
    .json<{ planId?: string; estadoCuenta?: string }>()
    .catch(() => ({ planId: undefined, estadoCuenta: undefined }));
  if (body.planId === undefined && body.estadoCuenta === undefined) {
    return c.json({ error: 'planId o estadoCuenta son requeridos' }, 400);
  }
  if (body.estadoCuenta !== undefined && !ESTADOS_CUENTA_VALIDOS.includes(body.estadoCuenta)) {
    return c.json({ error: `estadoCuenta debe ser uno de: ${ESTADOS_CUENTA_VALIDOS.join(', ')}` }, 400);
  }

  const actualizado = await actualizarPlanEstadoAcueducto(ctx.supabase, c.req.param('id'), body);
  if (!actualizado) return c.json({ error: 'Acueducto no encontrado' }, 404);
  return c.json(actualizado);
});

// GET /plataforma/salud — los tres indicadores de salud del sistema (035).
app.get('/plataforma/salud', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;

  const salud = await obtenerSaludSistema(ctx.supabase);
  const backup = c.env.BACKUPS_R2 ? await obtenerEstadoBackup(c.env.BACKUPS_R2) : null;
  return c.json({ ...salud, ultimoBackup: backup });
});
```

Necesitás agregar `actualizarPlanEstadoAcueducto`, `obtenerSaludSistema`, `obtenerEstadoBackup` al
import existente de `./lib/plataforma` en la cabecera del archivo (junto a `asignarAdminAcueducto`,
`crearAcueductoBase`, etc. — no dupliques el bloque de import, agregalas ahí).

### `backend/wrangler.toml` — agregar el binding nuevo en LOS DOS bloques (raíz y
`[env.production]`, el archivo ya tiene un comentario explícito: "Al añadir un binding nuevo arriba
hay que añadirlo TAMBIÉN aquí")

En el bloque raíz, junto al `[[r2_buckets]]` de `FACTURAS_R2`:
```toml
[[r2_buckets]]
binding = "BACKUPS_R2"
bucket_name = "undreocol-backups"
```

En `[env.production]`, junto a `[[env.production.r2_buckets]]` de `FACTURAS_R2`:
```toml
[[env.production.r2_buckets]]
binding = "BACKUPS_R2"
bucket_name = "undreocol-backups"
```

### Test nuevo/modificado: `backend/tests/unit/plataforma-rutas.test.ts`

Agregá al mock existente de `../../src/lib/plataforma` (no reescribas todo el mock, solo agregá
estas tres funciones junto a las que ya están):

```ts
  actualizarPlanEstadoAcueducto: vi.fn(async (_s: unknown, id: string, cambios: Record<string, unknown>) => {
    if (id === 'inexistente') return null;
    return { id, planId: (cambios.planId as string) ?? null, estadoCuenta: (cambios.estadoCuenta as string) ?? 'activa' };
  }),
  obtenerSaludSistema: vi.fn(async () => ({
    tamanoBaseMb: 42, nivel: 'ok', medidoEn: '2026-09-25T05:30:00Z', ultimoKeepalive: '2026-09-25T05:00:00Z',
  })),
  obtenerEstadoBackup: vi.fn(async () => ({ archivo: 'undreocol-backup-20260925.sql.gz', subidoEn: '2026-09-25T06:00:00Z' })),
```

Casos nuevos (agregalos como `describe` nuevos, no toques los que ya existen):

```ts
describe('PATCH /plataforma/acueductos/:id', () => {
  it('sin sesión de plataforma -> 403', async () => {
    respuestaMembresias = { data: null, error: null };
    const r = await app.fetch(
      new Request('https://api.undreocol.test/plataforma/acueductos/cliente-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test' },
        body: JSON.stringify({ estadoCuenta: 'suspendida' }),
      }),
      env,
    );
    expect(r.status).toBe(403);
  });

  it('estadoCuenta inválido -> 400', async () => {
    const r = await app.fetch(
      new Request('https://api.undreocol.test/plataforma/acueductos/cliente-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test' },
        body: JSON.stringify({ estadoCuenta: 'no-existe' }),
      }),
      env,
    );
    expect(r.status).toBe(400);
  });

  it('cambio válido -> 200 con la fila actualizada', async () => {
    const r = await app.fetch(
      new Request('https://api.undreocol.test/plataforma/acueductos/cliente-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test' },
        body: JSON.stringify({ estadoCuenta: 'suspendida' }),
      }),
      env,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: 'cliente-1', planId: null, estadoCuenta: 'suspendida' });
  });

  it('id inexistente -> 404', async () => {
    const r = await app.fetch(
      new Request('https://api.undreocol.test/plataforma/acueductos/inexistente', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test' },
        body: JSON.stringify({ estadoCuenta: 'activa' }),
      }),
      env,
    );
    expect(r.status).toBe(404);
  });
});

describe('GET /plataforma/salud', () => {
  it('sin sesión de plataforma -> 403', async () => {
    respuestaMembresias = { data: null, error: null };
    const r = await app.fetch(
      new Request('https://api.undreocol.test/plataforma/salud', {
        headers: { Origin: 'https://panel.undreocol.test' },
      }),
      env,
    );
    expect(r.status).toBe(403);
  });

  it('con sesión de plataforma -> 200 con los tres indicadores', async () => {
    const r = await app.fetch(
      new Request('https://api.undreocol.test/plataforma/salud', {
        headers: { Origin: 'https://panel.undreocol.test' },
      }),
      env,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      tamanoBaseMb: 42,
      nivel: 'ok',
      medidoEn: '2026-09-25T05:30:00Z',
      ultimoKeepalive: '2026-09-25T05:00:00Z',
      ultimoBackup: { archivo: 'undreocol-backup-20260925.sql.gz', subidoEn: '2026-09-25T06:00:00Z' },
    });
  });
});
```

`respuestaMembresias` vuelve a `{ data: { rol: 'administrador' }, error: null }` en el `beforeEach`
ya existente — no necesitás tocar eso, ya sirve para estos tests también.

### Qué NO hacer

- No agregues `service_role_key` a ninguna ruta ni función nueva.
- No toques `crearAcueductoBase`, `signUpAdminAcueducto`, `asignarAdminAcueducto`,
  `generarContrasenaInterna`, `obtenerAdminsDeAcueductos`, ni la ruta `POST
  /plataforma/acueductos` — sin cambios.
- No escribas el test de aislamiento SQL (`tests/aislamiento/904_...`) — es de Claude/Mateo, T-003.
- No inventes ningún endpoint para crear/editar el catálogo de `planes` — fuera de alcance (spec §4).

### Formato de entrega esperado de Luna

`supabase/migrations/20260925090000_panel-maestro-planes-salud.sql` completo (nuevo),
`backend/src/cron/monitor-db.ts` completo, `backend/src/lib/db.ts` (solo el bloque de `Env` con la
línea agregada, con contexto suficiente para ubicarlo), `backend/src/lib/plataforma.ts` completo,
los bloques exactos de `backend/src/index.ts` que cambiaron (import + las tres rutas),
`backend/wrangler.toml` completo, `backend/tests/unit/plataforma-rutas.test.ts` completo. Al final,
la sección "Asunciones sin verificar" de tu prompt base.

---

## T-002 — Frontend: plan/estado de cuenta por acueducto + sección Salud del sistema (PARA LUNA)

### Objetivo

En `/plataforma`: cada fila de acueducto gana controles para cambiar su plan y su estado de
cuenta; una sección nueva "Salud del sistema" muestra los tres indicadores.

**Esta tarea depende de T-001 ya aplicado** — necesita la forma nueva de `GET /plataforma` y la
ruta `GET /plataforma/salud`. Si no se aplicó todavía, avisá antes de escribir código que asuma una
respuesta que el backend no da todavía.

### `frontend/lib/api.ts` — bloques a modificar (ubicalos buscando `interface Acueducto` y
`listarAcueductos`, no necesitás ver el archivo entero)

El tipo `Acueducto` de plataforma hoy es (aproximado, buscá el que tiene `adminEmail`):
```ts
export interface Acueducto {
  id: string;
  nombre: string;
  slug: string;
  fecha_alta: string;
  adminEmail: string | null;
}
```
Reemplazar por:
```ts
export interface Acueducto {
  id: string;
  nombre: string;
  slug: string;
  fecha_alta: string;
  adminEmail: string | null;
  planId: string | null;
  planNombre: string | null;
  estadoCuenta: 'activa' | 'vencida' | 'suspendida' | 'cancelada';
}
```

Agregar cerca (mismo estilo que el resto de funciones del archivo, que ya usan `peticion<T>()`).
**No agregues ninguna función para listar planes ni ninguna ruta `/catalogo/planes`** — `planes` es
de nivel plataforma, no del catálogo de servicios de un acueducto, y no existe esa ruta; el
componente de abajo (`PlanEstadoAcueducto`) usa una lista fija con los dos planes reales de la base
(`Basico`, `Pro`), sin ninguna llamada nueva a la API para listarlos:
```ts
export interface CambioPlanEstado {
  planId?: string;
  estadoCuenta?: 'activa' | 'vencida' | 'suspendida' | 'cancelada';
}

export function cambiarPlanEstadoAcueducto(
  clienteId: string,
  cambios: CambioPlanEstado,
): Promise<{ id: string; planId: string | null; estadoCuenta: string }> {
  return peticion(`/plataforma/acueductos/${clienteId}`, {
    method: 'PATCH',
    body: JSON.stringify(cambios),
  });
}

export interface SaludSistema {
  tamanoBaseMb: number;
  nivel: 'ok' | 'atencion' | 'alerta' | 'critico';
  medidoEn: string;
  ultimoKeepalive: string | null;
  ultimoBackup: { archivo: string; subidoEn: string } | null;
}

export function obtenerSaludSistema(): Promise<SaludSistema> {
  return peticion('/plataforma/salud');
}
```

### Componente nuevo: `frontend/components/plan-estado-acueducto.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { cambiarPlanEstadoAcueducto, type Acueducto } from '@/lib/api';

// 035: lista fija de planes reales (Basico/Pro, sembrados por fixture) — el
// catálogo de planes en sí no se gestiona desde acá (spec §4, fuera de
// alcance). Si Mateo agrega un plan nuevo alguna vez, esta lista se actualiza
// a mano hasta que exista una ruta de catálogo de planes.
const PLANES_CONOCIDOS = [
  { id: '10000000-0000-0000-0000-000000000001', nombre: 'Basico' },
  { id: '10000000-0000-0000-0000-000000000002', nombre: 'Pro' },
];

const ESTADOS_CUENTA = ['activa', 'vencida', 'suspendida', 'cancelada'] as const;

interface PlanEstadoAcueductoProps {
  acueducto: Acueducto;
  onCambiado: () => void;
}

export function PlanEstadoAcueducto({ acueducto, onCambiado }: PlanEstadoAcueductoProps) {
  const [planId, setPlanId] = useState(acueducto.planId ?? '');
  const [estadoCuenta, setEstadoCuenta] = useState(acueducto.estadoCuenta);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hidratado = useHidratado();

  async function alGuardar() {
    setError(null);
    setGuardando(true);
    try {
      await cambiarPlanEstadoAcueducto(acueducto.id, { planId: planId || undefined, estadoCuenta });
      onCambiado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        className="h-9 rounded-md border border-border bg-background px-2"
        value={planId}
        onChange={(e) => setPlanId(e.target.value)}
      >
        <option value="">Sin plan</option>
        {PLANES_CONOCIDOS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      <select
        className="h-9 rounded-md border border-border bg-background px-2"
        value={estadoCuenta}
        onChange={(e) => setEstadoCuenta(e.target.value as typeof estadoCuenta)}
      >
        {ESTADOS_CUENTA.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={!hidratado || guardando} onClick={alGuardar}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

### Componente nuevo: `frontend/components/salud-sistema.tsx`

```tsx
import type { SaludSistema } from '@/lib/api';

interface SaludSistemaProps {
  salud: SaludSistema;
}

const ETIQUETA_NIVEL: Record<SaludSistema['nivel'], string> = {
  ok: 'Normal',
  atencion: 'Atención',
  alerta: 'Alerta',
  critico: 'Crítico',
};

// 035: los tres indicadores muestran la fecha de la última medición del cron
// correspondiente — nunca se miden en vivo dentro de esta petición (spec §4).
export function SaludSistema({ salud }: SaludSistemaProps) {
  return (
    <dl className="grid grid-cols-2 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Tamaño de la base</dt>
      <dd>
        {salud.tamanoBaseMb} MB · {ETIQUETA_NIVEL[salud.nivel]} (medido {new Date(salud.medidoEn).toLocaleString('es-CO')})
      </dd>
      <dt className="text-muted-foreground">Keepalive</dt>
      <dd>
        {salud.ultimoKeepalive ? new Date(salud.ultimoKeepalive).toLocaleString('es-CO') : 'sin registro'}
      </dd>
      <dt className="text-muted-foreground">Último backup</dt>
      <dd>
        {salud.ultimoBackup
          ? `${salud.ultimoBackup.archivo} (${new Date(salud.ultimoBackup.subidoEn).toLocaleString('es-CO')})`
          : 'sin backups todavía'}
      </dd>
    </dl>
  );
}
```

### `frontend/app/plataforma/page.tsx` — archivo completo tal cual está hoy

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlataformaForm } from '@/components/plataforma-form';
import { urlBaseApiServidor } from '@/lib/url-base-api-servidor';
import { BotonSalir } from '@/components/boton-salir';
import { CambiarContrasenaForm } from '@/components/cambiar-contrasena-form';
import { RestablecerContrasenaAcueducto } from '@/components/restablecer-contrasena-acueducto';

const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';

interface Acueducto {
  id: string;
  nombre: string;
  slug: string;
  fecha_alta: string;
  adminEmail: string | null;
}

interface RespuestaPlataforma {
  autorizado: boolean;
  acueductos: Acueducto[];
}

async function obtenerAcueductos(): Promise<RespuestaPlataforma> {
  const almacenCookies = await cookies();
  const cookieSesion = almacenCookies.get(NOMBRE_COOKIE_SESION);
  if (!cookieSesion) redirect('/login');

  const respuesta = await fetch(`${await urlBaseApiServidor()}/plataforma`, {
    headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${encodeURIComponent(cookieSesion.value)}` },
    cache: 'no-store',
  });

  if (respuesta.status === 401) redirect('/login');
  if (respuesta.status === 403) {
    return { autorizado: false, acueductos: [] };
  }

  const cuerpo: { error?: string; acueductos?: Acueducto[] } = await respuesta
    .json()
    .catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(cuerpo.error ?? 'No se pudo cargar el panel de plataforma');
  }
  return { autorizado: true, acueductos: cuerpo.acueductos ?? [] };
}

export default async function PlataformaPage() {
  const { autorizado, acueductos } = await obtenerAcueductos();

  if (!autorizado) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-lg font-semibold">No autorizado</p>
        <p className="text-sm text-muted-foreground">
          El panel de plataforma es solo para el superadministrador de UndreoCol.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Panel de plataforma</h1>
        <BotonSalir />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Dar de alta un acueducto</h2>
        <PlataformaForm />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h2 className="text-lg font-medium">Cambiar mi contraseña</h2>
        <CambiarContrasenaForm />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Acueductos ({acueductos.length})</h2>
        {acueductos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay ningún acueducto dado de alta.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {acueductos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-4 p-4 text-sm">
                <div>
                  <p className="font-medium">{a.nombre}</p>
                  <p className="text-muted-foreground">{a.slug}</p>
                  <p className="text-muted-foreground">
                    {a.adminEmail ?? 'sin admin asignado'}
                  </p>
                </div>
                <RestablecerContrasenaAcueducto email={a.adminEmail} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

**Cambios a hacer:**
1. `interface Acueducto` gana `planId: string | null`, `planNombre: string | null`,
   `estadoCuenta: 'activa' | 'vencida' | 'suspendida' | 'cancelada'` — mismos campos que ya agregó
   T-001 a la respuesta real.
2. Import nuevo: `import { PlanEstadoAcueducto } from '@/components/plan-estado-acueducto';` y
   `import { SaludSistema as SaludSistemaCard } from '@/components/salud-sistema';` (con alias para
   no chocar con el tipo `SaludSistema` de `lib/api.ts` si lo importás también).
3. `PlataformaPage` pasa de `async function` que solo llama `obtenerAcueductos()` a llamar TAMBIÉN
   una función nueva `obtenerSalud()` (mismo patrón que `obtenerAcueductos`, pero contra
   `${await urlBaseApiServidor()}/plataforma/salud`) — en paralelo con `Promise.all`, no
   secuencial. Si `obtenerSalud()` falla (403 de un rol que no debería llegar aquí, por ejemplo),
   no rompas toda la página: capturá el error y mostrá la sección de salud con un aviso, el resto
   de la página sigue funcionando.
4. Cada `<li>` de acueducto gana `<PlanEstadoAcueducto acueducto={a} onCambiado={...} />` — el
   `onCambiado` puede ser tan simple como `() => window.location.reload()` (server component, no
   hay una forma de "recargar solo esta parte" sin convertir la página en client component — no lo
   hagas, mantenelo simple).
5. Sección nueva `<h2>Salud del sistema</h2>` con `<SaludSistemaCard salud={salud} />` (o el nombre
   de import que hayas elegido), después de la sección "Acueductos".

### Qué NO hacer

- No toques `PlataformaForm`, `CambiarContrasenaForm`, `RestablecerContrasenaAcueducto` — sin
  cambios.
- No importes `@supabase/*` en ningún archivo de `frontend/` (CLAUDE.md §5.2, absoluto).
- No agregues `listarPlanes()` ni ninguna llamada a `/catalogo/planes` — no existe, se descartó
  (ver arriba).
- No conviertas `PlataformaPage` en un componente cliente completo solo para poder recargar sin
  `window.location.reload()` — no está pedido, es sobre-ingeniería para esta tarea.

### Criterios de aceptación (spec.md §6, verificación real pendiente de Claude/Mateo — no tuya)

- CA-1 a CA-8 de `specs/035-panel-maestro-planes-salud/spec.md` §6.

### Formato de entrega esperado de Luna

`frontend/lib/api.ts` (los bloques que cambiaron, con contexto suficiente para ubicarlos),
`frontend/components/plan-estado-acueducto.tsx` completo (nuevo),
`frontend/components/salud-sistema.tsx` completo (nuevo), `frontend/app/plataforma/page.tsx`
completo. Al final, la sección "Asunciones sin verificar" de tu prompt base.

---

## T-003 — Cierre: test de aislamiento, correr el cron real, verificación de punta a punta, CHANGELOG (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `tests/aislamiento/904_salud_sistema_aislamiento.sql` (nuevo, escrito por Claude —
seguridad de RLS, no delegado), `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (el módulo "Planes y
estado de cuenta"/"Salud del sistema" del panel maestro pasa de "sin empezar" a implementado).

**Verificación real:**
```
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
```
Más, contra Postgres local real y `wrangler dev` real (RLS y un cron real, no alcanza con
build/lint):
1. Aplicar la migración contra el stack local (`apply_migration` o el SQL Editor, según lo que
   funcione esa sesión — ver "Mejora propia, Sesión 046" en `docs/PLAN-PRODUCCION.md` para las
   trampas conocidas).
2. Correr `tests/aislamiento/904_salud_sistema_aislamiento.sql` con `psql` real: confirmar que
   `admin_acueducto`/`anon` no pueden `select` de `_salud_sistema` ni `_keepalive`, que no pueden
   `update` `clientes.plan_id`/`estado_cuenta` de ningún acueducto (ni el propio), y que
   `es_admin_plataforma()` sí puede las tres cosas.
3. Correr el cron una vez (`wrangler dev --test-scheduled -c wrangler.monitor-db.toml`, mismo
   patrón que usa `keepalive.ts` según `INFRAESTRUCTURA.md §5`) y confirmar con una consulta SQL
   directa que `_salud_sistema` se actualizó.
4. `curl` real con una sesión de superadmin real contra `GET /plataforma/salud`: confirma la misma
   medición que la consulta SQL directa del paso 3.
5. `curl` real (o desde la UI) contra `PATCH /plataforma/acueductos/:id` sobre un acueducto de
   prueba: confirmar con una consulta SQL directa que `plan_id`/`estado_cuenta` cambiaron.
6. `grep` confirmando que ninguna de las rutas/funciones nuevas usa `service_role`/`SERVICE_ROLE_KEY`.

**Estado:** COMPLETADO. `tests/aislamiento/904_salud_sistema_aislamiento.sql` escrito por Claude
(seguridad de RLS, no delegado) y corrido en verde contra Postgres local — confirma que solo
`es_admin_plataforma()` lee `_salud_sistema`/`_keepalive` y puede cambiar `plan_id`/`estado_cuenta`
de `clientes`, que `admin_acueducto` queda bloqueado por el trigger nuevo incluso sobre su propio
acueducto, y que `color_acento` (023) sigue funcionando sin regresión. Verificado de punta a punta
contra `wrangler dev` real (backend + frontend con su service binding conectado, build real de
OpenNext): login de superadmin real → `GET /plataforma`/`PATCH .../:id`/`GET /plataforma/salud`
con datos reales; `/plataforma` renderiza los `<select>` y "Salud del sistema" con las mediciones
reales; login de `admin_acueducto` real → "No autorizado", sección de salud nunca se renderiza.
235/235 tests backend, `build`/`lint`/`wrangler deploy --dry-run` limpios en ambos proyectos.
`CHANGELOG.md` y `docs/PLAN-PRODUCCION.md` actualizados (Sesión 055). Clic real de "Guardar" en un
navegador y aspecto visual final: NO VERIFICADO, requiere Mateo (sin Chromium/Playwright acá).
