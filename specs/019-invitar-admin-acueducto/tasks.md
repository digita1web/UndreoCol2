# TASKS — 019: invitar-admin-acueducto

**Plan aprobado:** 2026-09-13

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-001 y T-002 son para Luna — pegalas en conversaciones
nuevas, siempre después del prompt base de reglas de UndreoCol. T-002 depende de que T-001 ya esté
aplicado (necesita la respuesta nueva de `POST /plataforma/acueductos`). T-003 es cierre, no es
para Luna — esta feature toca autenticación (crea la cuenta del admin nuevo), así que la
verificación real de T-003 es tan estricta como la de 033: no alcanza con `build`/`lint`.

---

## T-001 — Backend: invitación por correo en el alta + plantilla neutra (PARA LUNA)

### Objetivo

Reemplazar la contraseña temporal de `POST /plataforma/acueductos` por un correo de invitación real,
reutilizando el mismo mecanismo que ya usa `POST /auth/recuperar`. Concretamente:
1. Nueva función `enviarEnlaceDefinirContrasena()` en `backend/src/lib/auth.ts`.
2. Renombrar `generarContrasenaTemporal()` → `generarContrasenaInterna()` en
   `backend/src/lib/plataforma.ts` (mismo cuerpo, cambia el nombre y el comentario).
3. `backend/src/index.ts`: `POST /auth/recuperar` pasa a llamar la función nueva; `POST
   /plataforma/acueductos` gana un paso 4 y cambia la forma de su respuesta `201`.
4. Reescribir `supabase/templates/recovery.html` con texto neutro (sirve para invitación nueva y
   para recuperación real).
5. Actualizar `backend/tests/unit/plataforma-rutas.test.ts` y crear
   `backend/tests/unit/auth-recuperar.test.ts`.

### Reglas no negociables de este proyecto (léelas antes de escribir una línea)

- **Nunca usar `service_role_key`** en ninguna de estas rutas — ambas atienden peticiones de usuario
  (CLAUDE.md §12, absoluto). `enviarEnlaceDefinirContrasena` usa `crearClienteAnon`, igual que hoy.
- Nada de `console.log`. `console.error` sí, para errores reales que no deben tumbar la respuesta.
- Nada de `catch {}` vacío.
- TypeScript estricto, nada de `any`.
- **No inventes `auth.admin.inviteUserByEmail`** ni ningún otro método de Supabase que no esté ya en
  este documento — ya se descartó (spec §7): exige `service_role_key`.

### `backend/src/lib/auth.ts` — agregar al final del archivo (tal cual está hoy, no lo reescribas
completo, solo agregá esta función después de `completarRecuperacion`)

```ts
// Dispara el correo con el enlace para definir contraseña — mismo mecanismo
// para "recuperar" (POST /auth/recuperar, cuenta existente) y para "invitar"
// (POST /plataforma/acueductos, cuenta recién creada, 019 §3.2): la diferencia
// entre los dos casos es solo si había una contraseña usable antes, no el
// mecanismo. Clave `anon`, NUNCA service_role (CLAUDE.md §12) —
// resetPasswordForEmail no la necesita.
export async function enviarEnlaceDefinirContrasena(env: Env, email: string): Promise<void> {
  const supabase = crearClienteAnon(env);
  // Mismo criterio que ya usaba /auth/recuperar (B-4): ALLOWED_ORIGIN puede
  // traer varios orígenes separados por coma; se usa el primero.
  const primerOrigen = env.ALLOWED_ORIGIN.split(',')[0]?.trim() ?? '';
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${primerOrigen}/restablecer-contrasena`,
  });
  if (error) {
    throw new Error(error.message);
  }
}
```

`Env` y `crearClienteAnon` ya están importados arriba del archivo (`import { crearClienteAnon, type
Env } from './db';`) — no agregues otro import.

### `backend/src/lib/plataforma.ts` — el archivo completo tal cual está hoy (renombrá SOLO la
primera función; las otras tres quedan idénticas)

```ts
// Panel de plataforma: alta de acueductos por el superadmin (018, T-003).
// Referencia: specs/018-panel-plataforma/plan.md §4 y §5.1.
//
// Orquesta dos sistemas que no comparten transacción (Postgres y GoTrue): no
// hay atomicidad real de punta a punta (plan §5.1, decisión aprobada por
// Mateo). El orden — clientes+configuracion, luego signUp, luego
// perfiles+membresias — minimiza el daño de un fallo a mitad de camino en vez
// de eliminarlo: ver el helper de la ruta en index.ts para el manejo de cada
// paso.
//
// Sin lógica de negocio (dinero, tarifas): no va a `core/`, igual que
// lib/tenant.ts y lib/auth-intentos.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { crearClienteAnon, type Env } from './db';

// Alfabeto sin caracteres visualmente ambiguos (sin 0/O, 1/l/I).
const ALFABETO_CONTRASENA = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const LONGITUD_CONTRASENA = 20;

// Contraseña interna para satisfacer signUp() al crear el admin nuevo (019
// §3.1). NUNCA se devuelve en la respuesta HTTP ni se loguea: el admin la va a
// reemplazar por el enlace de invitación antes de poder usarla — a diferencia
// de la versión anterior de esta función (generarContrasenaTemporal), que SÍ
// se mostraba una vez al superadmin para que la entregara a mano. Mismo
// generador criptográfico, cambia el nombre y el propósito.
export function generarContrasenaInterna(): string {
  const bytes = new Uint8Array(LONGITUD_CONTRASENA);
  crypto.getRandomValues(bytes);
  let contrasena = '';
  for (const b of bytes) {
    contrasena += ALFABETO_CONTRASENA[b % ALFABETO_CONTRASENA.length];
  }
  return contrasena;
}

// RPC crear_acueducto_base (plan §2). SECURITY INVOKER: `supabase` debe ser
// el cliente del superadmin (crearClienteSuscriptor), nunca anon ni
// service_role — RLS es quien autoriza, no el llamante de esta función.
// Lanza tal cual el mensaje de la función SQL (incluye "El slug ya está en
// uso" ante un slug duplicado).
export async function crearAcueductoBase(
  supabase: SupabaseClient,
  nombre: string,
  slug: string,
): Promise<{ clienteId: string }> {
  const { data, error } = await supabase.rpc('crear_acueducto_base', {
    p_nombre_cliente: nombre,
    p_slug: slug,
  });
  if (error) {
    throw new Error(error.message);
  }
  return { clienteId: data as string };
}

// signUp con la clave `anon` — igual que POST /auth/registro. NUNCA
// service_role en esta ruta (CLAUDE.md §12): crear un usuario de Auth no lo
// requiere, `signUp` alcanza aunque quien lo dispare sea el superadmin y no
// el propio usuario nuevo.
export async function signUpAdminAcueducto(
  env: Env,
  email: string,
  password: string,
): Promise<{ usuarioId: string }> {
  const supabase = crearClienteAnon(env);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    throw new Error(error?.message ?? 'signUp no devolvió un usuario');
  }
  return { usuarioId: data.user.id };
}

// RPC asignar_admin_acueducto (plan §2). Mismo criterio que
// crearAcueductoBase: `supabase` es el cliente del superadmin, SECURITY
// INVOKER, RLS autoriza. `usuarioId` debe existir ya en auth.users (creado
// por signUpAdminAcueducto antes de llamar esta función).
export async function asignarAdminAcueducto(
  supabase: SupabaseClient,
  clienteId: string,
  usuarioId: string,
  nombre: string,
  email: string,
): Promise<void> {
  const { error } = await supabase.rpc('asignar_admin_acueducto', {
    p_cliente_id: clienteId,
    p_usuario_id: usuarioId,
    p_nombre: nombre,
    p_email: email,
  });
  if (error) {
    throw new Error(error.message);
  }
}

// Email del admin_acueducto activo de cada cliente_id, para GET /plataforma (033).
// SECURITY INVOKER: RLS del cliente del superadmin decide qué puede leer.
export async function obtenerAdminsDeAcueductos(
  supabase: SupabaseClient,
  clienteIds: string[],
): Promise<Record<string, string | null>> {
  if (clienteIds.length === 0) return {};

  const { data: membresias, error: errMembresias } = await supabase
    .from('membresias')
    .select('cliente_id, perfil_id')
    .in('cliente_id', clienteIds)
    .eq('rol', 'admin_acueducto')
    .eq('activo', true);
  if (errMembresias || !membresias || membresias.length === 0) return {};

  const perfilIds = membresias.map((m) => m.perfil_id);
  const { data: perfiles, error: errPerfiles } = await supabase
    .from('perfiles')
    .select('id, email')
    .in('id', perfilIds);
  if (errPerfiles || !perfiles) return {};

  const emailPorPerfil = new Map(perfiles.map((p) => [p.id, p.email as string]));
  const resultado: Record<string, string | null> = {};
  for (const membresia of membresias) {
    resultado[membresia.cliente_id] = emailPorPerfil.get(membresia.perfil_id) ?? null;
  }
  return resultado;
}
```

(Este bloque reemplaza el archivo completo — solo cambió la función `generarContrasenaTemporal` →
`generarContrasenaInterna`, con nombre y comentario nuevos; las demás quedan carácter por carácter
iguales.)

### `backend/src/index.ts` — imports (líneas reales de hoy, reemplazá estos dos bloques)

Bloque 1, hoy:
```ts
import {
  cerrarSesion,
  completarRecuperacion,
  iniciarSesion,
  obtenerAccessToken,
  obtenerTokensSesion,
  verificarSesionAdministrativa,
} from './lib/auth';
```
Reemplazar por:
```ts
import {
  cerrarSesion,
  completarRecuperacion,
  enviarEnlaceDefinirContrasena,
  iniciarSesion,
  obtenerAccessToken,
  obtenerTokensSesion,
  verificarSesionAdministrativa,
} from './lib/auth';
```

Bloque 2, hoy:
```ts
import {
  asignarAdminAcueducto,
  crearAcueductoBase,
  generarContrasenaTemporal,
  obtenerAdminsDeAcueductos,
  signUpAdminAcueducto,
} from './lib/plataforma';
```
Reemplazar por:
```ts
import {
  asignarAdminAcueducto,
  crearAcueductoBase,
  generarContrasenaInterna,
  obtenerAdminsDeAcueductos,
  signUpAdminAcueducto,
} from './lib/plataforma';
```

### `POST /auth/recuperar` — hoy (reemplazar completo)

```ts
// POST /auth/recuperar — resetPasswordForEmail.
app.post('/auth/recuperar', async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({ email: undefined }));
  const email = body.email?.trim().toLowerCase();
  if (!email) return c.json({ error: 'Email requerido' }, 400);
  const supabase = crearClienteAnon(c.env);
  // El enlace debe caer en /restablecer-contrasena (034), no en la raíz — ahí
  // es donde se lee el fragmento #access_token=...&type=recovery. Mismo
  // criterio de "primer origen de la lista" que ya usa CORS (B-4): ALLOWED_ORIGIN
  // puede traer varios separados por coma, concatenar la cadena entera
  // produciría una URL inválida.
  const primerOrigen = c.env.ALLOWED_ORIGIN.split(',')[0]?.trim() ?? '';
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${primerOrigen}/restablecer-contrasena`,
  });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});
```

Reemplazar por (misma firma HTTP, misma respuesta — solo delega en la función compartida):

```ts
// POST /auth/recuperar — delega en enviarEnlaceDefinirContrasena (019), la
// misma función que usa el paso 4 del alta de acueducto.
app.post('/auth/recuperar', async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({ email: undefined }));
  const email = body.email?.trim().toLowerCase();
  if (!email) return c.json({ error: 'Email requerido' }, 400);
  try {
    await enviarEnlaceDefinirContrasena(c.env, email);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo enviar el correo' }, 400);
  }
  return c.json({ ok: true });
});
```

### `POST /plataforma/acueductos` — hoy (reemplazar completo)

```ts
// POST /plataforma/acueductos — alta de un acueducto + su primer admin.
// Orden de 3 pasos (plan §3, §5.1): sin transacción atómica única entre
// Postgres y GoTrue — ver los comentarios de cada paso para el porqué y el
// modo de falla de cada uno.
app.post('/plataforma/acueductos', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;

  const body = await c.req
    .json<{ nombre?: string; slug?: string; nombreAdmin?: string; correoAdmin?: string }>()
    .catch(() => ({ nombre: undefined, slug: undefined, nombreAdmin: undefined, correoAdmin: undefined }));
  const nombre = body.nombre?.trim() ?? '';
  const slug = body.slug?.trim().toLowerCase() ?? '';
  const nombreAdmin = body.nombreAdmin?.trim() ?? '';
  const correoAdmin = body.correoAdmin?.trim().toLowerCase() ?? '';
  if (!nombre || !slug || !nombreAdmin || !correoAdmin) {
    return c.json({ error: 'nombre, slug, nombreAdmin y correoAdmin son requeridos' }, 400);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return c.json({ error: 'El slug solo admite minúsculas, números y guiones' }, 400);
  }

  // Paso 1: clientes + configuracion. Si falla (slug duplicado), no se ha
  // tocado Auth todavía — error limpio, nada que limpiar.
  let clienteId: string;
  try {
    ({ clienteId } = await crearAcueductoBase(ctx.supabase, nombre, slug));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo crear el acueducto' }, 400);
  }

  // Paso 2: signUp con la clave anon (nunca service_role, CLAUDE.md §12). Si
  // falla, queda un `clientes` sin admin — visible en GET /plataforma, no un
  // usuario huérfano invisible. No hay reintento automático en v1 (plan §5.1).
  const contrasenaTemporal = generarContrasenaTemporal();
  let usuarioId: string;
  try {
    ({ usuarioId } = await signUpAdminAcueducto(c.env, correoAdmin, contrasenaTemporal));
  } catch (e) {
    return c.json(
      {
        error: `El acueducto '${slug}' se creó pero no se pudo dar de alta el correo del admin: ${
          e instanceof Error ? e.message : 'error desconocido'
        }. El acueducto queda sin administrador; reintente el alta del admin para este acueducto.`,
        clienteId,
      },
      500,
    );
  }

  // Paso 3: perfiles + membresias. A esta altura clientes y auth.users ya
  // existen y son válidos; si esto falla, el auth.users queda con la
  // contraseña ya entregada — recuperable a mano (plan §5.1).
  try {
    await asignarAdminAcueducto(ctx.supabase, clienteId, usuarioId, nombreAdmin, correoAdmin);
  } catch (e) {
    return c.json(
      {
        error: `El acueducto '${slug}' y el usuario de ${correoAdmin} se crearon, pero no se pudo vincularlos: ${
          e instanceof Error ? e.message : 'error desconocido'
        }. Requiere corrección manual.`,
        clienteId,
        usuarioId,
      },
      500,
    );
  }

  return c.json({ clienteId, slug, correoAdmin, contrasenaTemporal }, 201);
});
```

Reemplazar por (pasos 1-3 idénticos salvo el nombre de la función del paso 2; paso 4 nuevo al
final, spec §3.2/§3.5, plan §3):

```ts
// POST /plataforma/acueductos — alta de un acueducto + su primer admin.
// Orden de 4 pasos (plan §3, §5.1): sin transacción atómica única entre
// Postgres y GoTrue — ver los comentarios de cada paso para el porqué y el
// modo de falla de cada uno. El paso 4 (019) reemplaza la contraseña temporal
// que se mostraba antes por una invitación real por correo.
app.post('/plataforma/acueductos', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;

  const body = await c.req
    .json<{ nombre?: string; slug?: string; nombreAdmin?: string; correoAdmin?: string }>()
    .catch(() => ({ nombre: undefined, slug: undefined, nombreAdmin: undefined, correoAdmin: undefined }));
  const nombre = body.nombre?.trim() ?? '';
  const slug = body.slug?.trim().toLowerCase() ?? '';
  const nombreAdmin = body.nombreAdmin?.trim() ?? '';
  const correoAdmin = body.correoAdmin?.trim().toLowerCase() ?? '';
  if (!nombre || !slug || !nombreAdmin || !correoAdmin) {
    return c.json({ error: 'nombre, slug, nombreAdmin y correoAdmin son requeridos' }, 400);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return c.json({ error: 'El slug solo admite minúsculas, números y guiones' }, 400);
  }

  // Paso 1: clientes + configuracion. Si falla (slug duplicado), no se ha
  // tocado Auth todavía — error limpio, nada que limpiar.
  let clienteId: string;
  try {
    ({ clienteId } = await crearAcueductoBase(ctx.supabase, nombre, slug));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo crear el acueducto' }, 400);
  }

  // Paso 2: signUp con la clave anon (nunca service_role, CLAUDE.md §12). La
  // contraseña generada acá es interna (019 §3.1): nunca se devuelve ni se
  // loguea, el admin la va a reemplazar por el enlace del paso 4. Si signUp
  // falla, queda un `clientes` sin admin — visible en GET /plataforma, no un
  // usuario huérfano invisible. No hay reintento automático en v1 (plan §5.1).
  const contrasenaInterna = generarContrasenaInterna();
  let usuarioId: string;
  try {
    ({ usuarioId } = await signUpAdminAcueducto(c.env, correoAdmin, contrasenaInterna));
  } catch (e) {
    return c.json(
      {
        error: `El acueducto '${slug}' se creó pero no se pudo dar de alta el correo del admin: ${
          e instanceof Error ? e.message : 'error desconocido'
        }. El acueducto queda sin administrador; reintente el alta del admin para este acueducto.`,
        clienteId,
      },
      500,
    );
  }

  // Paso 3: perfiles + membresias. A esta altura clientes y auth.users ya
  // existen y son válidos; si esto falla, el auth.users queda con la
  // contraseña interna ya asignada — recuperable a mano (plan §5.1).
  try {
    await asignarAdminAcueducto(ctx.supabase, clienteId, usuarioId, nombreAdmin, correoAdmin);
  } catch (e) {
    return c.json(
      {
        error: `El acueducto '${slug}' y el usuario de ${correoAdmin} se crearon, pero no se pudo vincularlos: ${
          e instanceof Error ? e.message : 'error desconocido'
        }. Requiere corrección manual.`,
        clienteId,
        usuarioId,
      },
      500,
    );
  }

  // Paso 4 (019): invitación por correo, en vez de entregar la contraseña
  // interna. Un fallo acá NUNCA revierte los pasos 1-3 (regla 20, CLAUDE.md
  // §10) — el acueducto y el admin ya existen; el superadmin puede reintentar
  // con "Restablecer contraseña" desde la lista (033 §3.2, misma llamada
  // exacta).
  try {
    await enviarEnlaceDefinirContrasena(c.env, correoAdmin);
  } catch (e) {
    return c.json(
      {
        clienteId,
        slug,
        correoAdmin,
        invitacionEnviada: false,
        avisoCorreo: `El acueducto y el administrador se crearon, pero no se pudo enviar el correo de invitación: ${
          e instanceof Error ? e.message : 'error desconocido'
        }. Podés reintentar con "Restablecer contraseña" en la lista de acueductos.`,
      },
      201,
    );
  }

  return c.json({ clienteId, slug, correoAdmin, invitacionEnviada: true }, 201);
});
```

### `supabase/templates/recovery.html` — hoy (reemplazar completo)

```html
<h2>Restablecer tu contraseña</h2>

<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de UndreoCol.</p>
<p><a href="{{ .ConfirmationURL }}">Restablecer contraseña</a></p>
<p>Si no la pediste vos, podés ignorar este correo con tranquilidad — tu contraseña no cambia hasta que sigas el enlace y definas una nueva.</p>
```

Reemplazar por un texto que tenga sentido tanto si es la primera contraseña de una cuenta recién
creada (alta de acueducto) como si es una recuperación real — proponé un texto siguiendo esta idea
(ajustá el español, mantené `{{ .ConfirmationURL }}` intacto, es la variable de Supabase):

```html
<h2>Definí tu contraseña de UndreoCol</h2>

<p>Usá este enlace para definir la contraseña de tu cuenta de UndreoCol.</p>
<p><a href="{{ .ConfirmationURL }}">Definir contraseña</a></p>
<p>Si no esperabas este correo, podés ignorarlo con tranquilidad — tu contraseña no cambia hasta que sigas el enlace y definas una nueva.</p>
```

**Este texto es un borrador — la versión final la aprueba Mateo (spec CA-5)**, no lo tomes como
definitivo, pero entregá algo coherente con la idea de arriba.

### `backend/tests/unit/plataforma-rutas.test.ts` — qué cambiar (archivo completo ya lo tenés en el
repo si te lo pasan; estos son los puntos exactos a tocar, no reescribas lo que no está en esta
lista)

1. En el `vi.mock('../../src/lib/plataforma', ...)`, el mock hoy es:
   ```ts
   vi.mock('../../src/lib/plataforma', () => ({
     generarContrasenaTemporal: vi.fn(() => 'Clave-Temporal-Fija1'),
     obtenerAdminsDeAcueductos: vi.fn(async () => ({})),
     crearAcueductoBase: vi.fn(async (_s: unknown, nombre: string, slug: string) => {
       ordenLlamadas.push('crearAcueductoBase');
       if (crearAcueductoBaseLanza) throw new Error(crearAcueductoBaseLanza);
       return { clienteId: `cliente-de-${slug}` };
     }),
     signUpAdminAcueducto: vi.fn(async (_env: unknown, correo: string) => {
       ordenLlamadas.push('signUp');
       if (signUpLanza) throw new Error(signUpLanza);
       return { usuarioId: `usuario-de-${correo}` };
     }),
     asignarAdminAcueducto: vi.fn(async () => {
       ordenLlamadas.push('asignar');
       if (asignarLanza) throw new Error(asignarLanza);
     }),
   }));
   ```
   Cambiar `generarContrasenaTemporal` por `generarContrasenaInterna: vi.fn(() =>
   'Clave-Interna-Fija1')` (mismo patrón, nombre nuevo).

2. Agregar un mock nuevo para `lib/auth` que registre el paso 4 y pueda fallar a demanda — hoy el
   archivo ya mockea `lib/auth` así (bloque completo, tal cual):
   ```ts
   vi.mock('../../src/lib/auth', async (original) => ({
     ...(await original<Record<string, unknown>>()),
     verificarSesionAdministrativa: vi.fn(async () => sesionActiva),
     obtenerAccessToken: vi.fn(() => 'token-de-prueba'),
   }));
   ```
   Agregale `enviarEnlaceDefinirContrasena` a ese mismo objeto:
   ```ts
   vi.mock('../../src/lib/auth', async (original) => ({
     ...(await original<Record<string, unknown>>()),
     verificarSesionAdministrativa: vi.fn(async () => sesionActiva),
     obtenerAccessToken: vi.fn(() => 'token-de-prueba'),
     enviarEnlaceDefinirContrasena: vi.fn(async (_env: unknown, correo: string) => {
       ordenLlamadas.push('enviarInvitacion');
       if (enviarInvitacionLanza) throw new Error(enviarInvitacionLanza);
     }),
   }));
   ```
   Con una variable nueva junto a las demás (`crearAcueductoBaseLanza`, `signUpLanza`,
   `asignarLanza`):
   ```ts
   let enviarInvitacionLanza: string | null = null;
   ```
   Y agregarla al `beforeEach` junto a las otras tres (`enviarInvitacionLanza = null;`).

3. El test `'alta completa -> 201 con clienteId/slug/correoAdmin/contrasenaTemporal'` cambia de
   nombre y de aserción:
   ```ts
   it('alta completa -> 201 con invitacionEnviada true, sin contraseña en la respuesta', async () => {
     const r = await alta(cuerpoValido);
     expect(r.status).toBe(201);
     expect(await r.json()).toEqual({
       clienteId: 'cliente-de-acueducto-nuevo',
       slug: 'acueducto-nuevo',
       correoAdmin: 'admin-nuevo@test.local',
       invitacionEnviada: true,
     });
     expect(ordenLlamadas).toEqual(['crearAcueductoBase', 'signUp', 'asignar', 'enviarInvitacion']);
   });
   ```

4. Test nuevo, agregar junto a los otros de "orden de los pasos" (CA-4 del spec):
   ```ts
   it('falla el envío de la invitación (paso 4) -> sigue 201, invitacionEnviada false con aviso', async () => {
     enviarInvitacionLanza = 'límite de envíos alcanzado';
     const r = await alta(cuerpoValido);
     expect(r.status).toBe(201);
     const cuerpo = (await r.json()) as {
       clienteId: string; slug: string; correoAdmin: string;
       invitacionEnviada: boolean; avisoCorreo: string;
     };
     expect(cuerpo.invitacionEnviada).toBe(false);
     expect(cuerpo.avisoCorreo).toMatch(/límite de envíos alcanzado/);
     expect(cuerpo.avisoCorreo).toMatch(/Restablecer contraseña/);
     // Los 3 pasos anteriores SÍ se ejecutaron — el fallo del correo no los revierte.
     expect(ordenLlamadas).toEqual(['crearAcueductoBase', 'signUp', 'asignar', 'enviarInvitacion']);
   });
   ```

No toques ningún otro `describe`/`it` de este archivo (los de `requerirAdminPlataforma`, `GET
/plataforma`, validación de body, fallos de los pasos 1/2/3, y `GET /dashboard`) — quedan
idénticos.

### `backend/tests/unit/auth-recuperar.test.ts` — archivo nuevo completo

Mismo patrón que el resto de tests de rutas (`app.fetch` real, mockear solo lo necesario):

```ts
// Cobertura de POST /auth/recuperar tras extraer su lógica a
// enviarEnlaceDefinirContrasena (019) — no existía test propio de esta ruta
// antes de este spec; esto es regresión de que el contrato HTTP no cambió.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let enviarLanza: string | null = null;
let correoRecibido: string | null = null;

vi.mock('../../src/lib/auth', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enviarEnlaceDefinirContrasena: vi.fn(async (_env: unknown, email: string) => {
    correoRecibido = email;
    if (enviarLanza) throw new Error(enviarLanza);
  }),
}));

const app = (await import('../../src/index')).default;

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGIN: 'https://panel.undreocol.test',
  SESSION_SECRET: 'secreto',
} as never;

async function recuperar(body: Record<string, unknown>): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/auth/recuperar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

beforeEach(() => {
  enviarLanza = null;
  correoRecibido = null;
});

describe('POST /auth/recuperar', () => {
  it('sin email -> 400, no llama a enviarEnlaceDefinirContrasena', async () => {
    const r = await recuperar({});
    expect(r.status).toBe(400);
    expect(correoRecibido).toBeNull();
  });

  it('email válido -> 200 { ok: true }, se llama con ese email', async () => {
    const r = await recuperar({ email: 'Admin@Test.Local' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(correoRecibido).toBe('admin@test.local'); // normalizado a minúsculas, igual que antes
  });

  it('enviarEnlaceDefinirContrasena falla -> 400 con el mensaje real', async () => {
    enviarLanza = 'Email rate limit exceeded';
    const r = await recuperar({ email: 'admin@test.local' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Email rate limit exceeded' });
  });
});
```

### Qué NO hacer

- No toques `crearAcueductoBase`, `signUpAdminAcueducto`, `asignarAdminAcueducto`,
  `obtenerAdminsDeAcueductos` en `lib/plataforma.ts` — solo la función renombrada.
- No toques `POST /auth/completar-recuperacion` ni `completarRecuperacion` en `lib/auth.ts` — sin
  cambios, es la ruta que ya usa el admin nuevo para definir su contraseña (034).
- No agregues `service_role_key` a ninguna ruta.
- No inventes una tabla de invitaciones pendientes, expiración propia, ni reenvío automático — spec
  §4 ya los descartó.

### Comando de verificación (para vos, Luna, antes de entregar — y de nuevo para Claude en T-003)

```
cd backend && npm test
```

### Formato de entrega esperado de Luna

`backend/src/lib/auth.ts` completo, `backend/src/lib/plataforma.ts` completo, los bloques exactos
de `backend/src/index.ts` que cambiaron (imports + las dos rutas), `supabase/templates/recovery.html`
completo, `backend/tests/unit/plataforma-rutas.test.ts` completo, y
`backend/tests/unit/auth-recuperar.test.ts` completo. Al final, la sección "Asunciones sin
verificar" de tu prompt base.

---

## T-002 — Frontend: el alta de acueducto confirma el envío, no muestra una contraseña (PARA LUNA)

### Objetivo

`frontend/lib/api.ts`: `RespuestaAltaAcueducto` pierde `contrasenaTemporal`, gana
`invitacionEnviada: boolean` y `avisoCorreo?: string`. `frontend/components/plataforma-form.tsx`:
el bloque de éxito confirma el envío del correo (o muestra el aviso de reintento si falló), en vez
de mostrar la contraseña.

**Esta tarea depende de T-001 ya aplicado** — necesita que `POST /plataforma/acueductos` devuelva la
forma nueva. Si todavía no se aplicó, avisá antes de escribir código que asuma una respuesta que el
backend no da todavía.

### `frontend/lib/api.ts` — bloque a reemplazar (ubicalo buscando `RespuestaAltaAcueducto`, tal cual
está hoy)

```ts
export interface RespuestaAltaAcueducto {
  clienteId: string;
  slug: string;
  correoAdmin: string;
  /** Se muestra UNA sola vez: el backend no la guarda en ningún lado. */
  contrasenaTemporal: string;
}

export function crearAcueductoPlataforma(datos: DatosAltaAcueducto): Promise<RespuestaAltaAcueducto> {
  return peticion('/plataforma/acueductos', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}
```

Reemplazar por:

```ts
export interface RespuestaAltaAcueducto {
  clienteId: string;
  slug: string;
  correoAdmin: string;
  /** false si el correo de invitación falló al enviarse (019) — el acueducto y el admin ya existen igual. */
  invitacionEnviada: boolean;
  /** Presente solo cuando invitacionEnviada es false: explica el fallo y cómo reintentar. */
  avisoCorreo?: string;
}

export function crearAcueductoPlataforma(datos: DatosAltaAcueducto): Promise<RespuestaAltaAcueducto> {
  return peticion('/plataforma/acueductos', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}
```

No toques `DatosAltaAcueducto`, `restablecerContrasenaAcueducto`, `cambiarContrasena` ni ninguna otra
función de este archivo — sin cambios.

### `frontend/components/plataforma-form.tsx` — archivo completo tal cual está hoy

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearAcueductoPlataforma, type RespuestaAltaAcueducto } from '@/lib/api';

// Misma normalización de slug que onboarding-form.tsx (regla compartida con
// backend/src/index.ts y clientes.chk_slug).
function normalizarSlug(valor: string): string {
  return valor
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function PlataformaForm() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [correoAdmin, setCorreoAdmin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // Resultado del último alta exitosa: la contraseña se muestra UNA sola vez,
  // el backend no la guarda en ningún lado (plan §5.4). Se pierde al recargar
  // o al dar de alta otro acueducto — es a propósito.
  const [resultado, setResultado] = useState<RespuestaAltaAcueducto | null>(null);
  const hidratado = useHidratado();

  function alCambiarNombre(valor: string) {
    setNombre(valor);
    if (!slugTocado) {
      setSlug(normalizarSlug(valor));
    }
  }

  function alCambiarSlug(valor: string) {
    setSlugTocado(true);
    setSlug(normalizarSlug(valor));
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setResultado(null);
    setCargando(true);
    try {
      const r = await crearAcueductoPlataforma({
        nombre: nombre.trim(),
        slug,
        nombreAdmin: nombreAdmin.trim(),
        correoAdmin: correoAdmin.trim(),
      });
      setResultado(r);
      setNombre('');
      setSlug('');
      setSlugTocado(false);
      setNombreAdmin('');
      setCorreoAdmin('');
      router.refresh(); // refresca la lista de acueductos del server component
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el acueducto');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {resultado && (
        <div className="flex flex-col gap-2 rounded-lg border border-green-600 bg-green-50 p-4 text-sm">
          <p className="font-semibold">
            Acueducto &quot;{resultado.slug}&quot; creado. Contraseña temporal de {resultado.correoAdmin}
            :
          </p>
          <code className="rounded bg-white px-2 py-1 font-mono text-base">
            {resultado.contrasenaTemporal}
          </code>
          <p className="text-muted-foreground">
            Se muestra una sola vez — no queda guardada en ningún lado. Entréguesela al admin del
            acueducto por un canal seguro.
          </p>
        </div>
      )}

      <form onSubmit={alEnviar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="nombre">Nombre del acueducto</Label>
          <Input
            id="nombre"
            name="nombre"
            type="text"
            required
            value={nombre}
            onChange={(e) => alCambiarNombre(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="slug">Identificador (slug)</Label>
          <Input
            id="slug"
            name="slug"
            type="text"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={slug}
            onChange={(e) => alCambiarSlug(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="nombreAdmin">Nombre del administrador</Label>
          <Input
            id="nombreAdmin"
            name="nombreAdmin"
            type="text"
            required
            value={nombreAdmin}
            onChange={(e) => setNombreAdmin(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="correoAdmin">Correo del administrador</Label>
          <Input
            id="correoAdmin"
            name="correoAdmin"
            type="email"
            required
            value={correoAdmin}
            onChange={(e) => setCorreoAdmin(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={!hidratado || cargando}>
          {cargando ? 'Creando…' : 'Crear acueducto'}
        </Button>
      </form>
    </div>
  );
}
```

Reemplazar solo el bloque `{resultado && (...)}` (todo lo demás del archivo queda idéntico,
incluido el comentario de arriba de `resultado` — actualizalo también, ver abajo):

```tsx
  // Resultado del último alta exitosa: confirma si la invitación por correo
  // se envió o no (019) — ya no hay ninguna contraseña que mostrar. Se pierde
  // al recargar o al dar de alta otro acueducto, igual que antes.
  const [resultado, setResultado] = useState<RespuestaAltaAcueducto | null>(null);
```

```tsx
      {resultado && (
        <div
          className={`flex flex-col gap-2 rounded-lg border p-4 text-sm ${
            resultado.invitacionEnviada
              ? 'border-green-600 bg-green-50'
              : 'border-amber-600 bg-amber-50'
          }`}
        >
          {resultado.invitacionEnviada ? (
            <p className="font-semibold">
              Acueducto &quot;{resultado.slug}&quot; creado. Se envió una invitación a{' '}
              {resultado.correoAdmin} para que defina su contraseña.
            </p>
          ) : (
            <>
              <p className="font-semibold">
                Acueducto &quot;{resultado.slug}&quot; creado, pero no se pudo enviar la invitación a{' '}
                {resultado.correoAdmin}.
              </p>
              <p className="text-muted-foreground">{resultado.avisoCorreo}</p>
            </>
          )}
        </div>
      )}
```

### Qué NO hacer

- No toques la lógica del formulario (`alEnviar`, `normalizarSlug`, los `useState` de los campos) —
  sin cambios, solo el bloque de resultado y su comentario.
- No importes `@supabase/*` en ningún archivo de `frontend/` (CLAUDE.md §5.2, absoluto).
- No agregues un botón de "reintentar invitación" nuevo en este bloque — el reintento ya existe como
  el botón "Restablecer contraseña" de la lista de acueductos (033), no se duplica aquí (spec §3.5).

### Criterios de aceptación (spec.md §6, verificación real pendiente de Claude/Mateo — no tuya)

- CA-1 a CA-5 de `specs/019-invitar-admin-acueducto/spec.md` §6.

### Formato de entrega esperado de Luna

`frontend/lib/api.ts` (el bloque que cambió, con suficiente contexto para ubicarlo) y
`frontend/components/plataforma-form.tsx` completo. Al final, la sección "Asunciones sin verificar"
de tu prompt base.

---

## T-003 — Cierre: verificación real de punta a punta, CHANGELOG y PLAN-PRODUCCION.md (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (feature 019 pasa de "sin empezar" a
implementada; módulo "Acueductos" del panel maestro se actualiza: el alta ya no entrega contraseña).

**Verificación real — esta feature crea la cuenta del admin nuevo, mismo nivel de exigencia que 033:**
```
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
```
Más, contra `wrangler dev` real + Inbucket/Mailpit local (no alcanza con build/lint para un flujo que
crea credenciales):
1. `grep` real confirmando que ni `enviarEnlaceDefinirContrasena` ni el paso 4 nuevo usan
   `service_role`/`SERVICE_ROLE_KEY`.
2. Dar de alta un acueducto de prueba real contra `wrangler dev` → confirmar en Inbucket/Mailpit que
   llegó el correo, con el `ConfirmationURL` apuntando a `/restablecer-contrasena` (CA-2).
3. Seguir el enlace real del correo hasta `/restablecer-contrasena`, definir la contraseña, y
   confirmar el login con ella (CA-2, de punta a punta).
4. Antes de seguir el enlace: confirmar que NO existe ninguna contraseña utilizable para esa cuenta
   (CA-3) — intentar login con cualquier valor debe fallar.
5. Forzar el fallo del paso 4 (ej. mockeando `enviarEnlaceDefinirContrasena` para que lance, o con
   `env.SUPABASE_URL` apuntando a un endpoint que rechace la llamada) y confirmar que el acueducto y
   el admin quedan creados igual, con `invitacionEnviada: false` (CA-4) — y que "Restablecer
   contraseña" desde la lista reintenta con éxito.
6. Leer el texto real del correo en los dos casos — invitación nueva y `/auth/recuperar` sobre una
   cuenta existente — y confirmar con Mateo que tiene sentido en ambos (CA-5).
7. Confirmar que la respuesta de `POST /plataforma/acueductos` y la UI de `/plataforma` no muestran
   ninguna contraseña en ningún caso (CA-1).

**Pendiente fuera de esta tarea, mismo criterio que 034:** replicar el texto nuevo de
`recovery.html` en la plantilla del dashboard de Supabase de **producción** — `config.toml` solo
gobierna el entorno local. Un clic de Mateo, no código.

**Estado:** COMPLETADO — auditoría real encontró un bug que build/lint/tests con mocks no
detectaban: Luna reescribió el cuerpo de `recovery.html` pero no el asunto del correo, que vive
aparte en `supabase/config.toml` (`[auth.email.template.recovery] subject`) — el correo real
llegaba con el cuerpo nuevo y el asunto viejo ("Restablecer tu contraseña..."), sin sentido para un
admin recién creado. Corregido (`subject = "Definí tu contraseña de UndreoCol"`); requirió
`supabase stop`+`start` para que GoTrue recargara la plantilla — datos locales confirmados intactos
antes y después (mismo conteo de `auth.users`/`clientes`). Verificado de punta a punta contra
`wrangler dev` + Mailpit reales: login como superadmin de prueba → alta de un acueducto y admin de
prueba → `201` sin ninguna contraseña en la respuesta (CA-1) → correo real con asunto y cuerpo ya
corregidos (CA-5) → enlace real seguido con `curl` contra `verify` de GoTrue → tokens reales →
`POST /auth/completar-recuperacion` → `200` → login con la contraseña recién definida → `200`
(CA-2). Datos de prueba borrados al cerrar. 229/229 tests, `build`/`lint`/`wrangler deploy
--dry-run` limpios en ambos proyectos, `grep` confirma cero uso de `service_role` en las rutas
nuevas. Verificación visual en navegador real y réplica de la plantilla en el dashboard de
producción quedan pendientes de Mateo.
