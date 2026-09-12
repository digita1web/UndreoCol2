# TASKS — 033: credenciales-plataforma

**Plan aprobado:** 2026-09-12

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-001 y T-002 son para Luna — pegalas en conversaciones
nuevas (pueden ser la misma conversación, una después de la otra), siempre después del prompt base
de reglas de UndreoCol. T-003 es cierre, no es para Luna. Esta feature toca autenticación —
después de aplicar el código de Luna, la verificación real (T-003) es más estricta que en 030/031/032:
no alcanza con `build`/`lint`, hay que probar la ruta nueva contra `wrangler dev` real.

---

## T-001 — Backend: ruta de cambiar contraseña + email de admin por acueducto (PARA LUNA)

### Objetivo

En `backend/src/index.ts`: ampliar `GET /plataforma` para que cada acueducto incluya el email de
su `admin_acueducto`, y agregar `POST /auth/cambiar-contrasena` (cambia la contraseña de la sesión
activa, cualquier rol, nunca `service_role_key`, con aviso por correo cuyo fallo nunca bloquea el
cambio). En `backend/src/lib/plataforma.ts`: agregar `obtenerAdminsDeAcueductos()`. Nuevo archivo
de test.

### Reglas no negociables de este proyecto (léelas antes de escribir una línea)

- **Nunca usar `c.env.SUPABASE_SERVICE_ROLE_KEY` en estas rutas.** Ambas atienden peticiones de
  usuario — está absolutamente prohibido (CLAUDE.md §12). El cliente de Supabase se crea con
  `crearClienteSuscriptor(c.env, accessToken)`, con el JWT de la sesión — exactamente como ya hacen
  todas las rutas de abajo.
- Nada de `console.log`. `console.error` sí, para errores reales que no deben tumbar la respuesta
  (ver el envío de correo).
- Nada de `catch {}` vacío.
- TypeScript estricto, nada de `any`.

### Archivo a modificar — imports de `backend/src/index.ts` (líneas reales, no inventar otros)

```ts
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearClienteAnon, crearClienteSuscriptor, type Env } from './lib/db';
import {
  cerrarSesion,
  iniciarSesion,
  obtenerAccessToken,
  verificarSesionAdministrativa,
} from './lib/auth';
import { resolverClienteActivo } from './lib/tenant';
import { estadoLoginAdmin, registrarIntentoLoginAdmin } from './lib/auth-intentos';
import {
  asignarAdminAcueducto,
  crearAcueductoBase,
  generarContrasenaTemporal,
  signUpAdminAcueducto,
} from './lib/plataforma';
```

Vas a agregar `obtenerAdminsDeAcueductos` a este último `import { ... } from './lib/plataforma'`, y
`enviarCorreo` desde `./lib/email` (archivo ya existente, no lo toques, solo importalo):

```ts
export interface EnviarCorreoInput {
  destinatario: string;
  remitente: string;
  asunto: string;
  cuerpoHtml: string;
  adjunto?: Attachment; // no aplica acá, se omite
}
export async function enviarCorreo(env: Pick<Env, 'EMAIL'>, input: EnviarCorreoInput): Promise<{ ok: boolean; error?: string; messageId?: string }>;
```

`enviarCorreo` **nunca lanza** — devuelve `{ ok: false, error }` si falla (incluido en desarrollo
local, donde `env.EMAIL` no existe). Por eso no hace falta ni un `try/catch` alrededor: solo
revisar `resultado.ok` y, si es `false`, `console.error` sin devolver error al usuario.

### Rutas reales de referencia — `POST /auth/recuperar` y `requerirAdminPlataforma`/`GET /plataforma` (ya existen, tal cual están hoy)

```ts
// POST /auth/recuperar — resetPasswordForEmail.
app.post('/auth/recuperar', async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({ email: undefined }));
  const email = body.email?.trim().toLowerCase();
  if (!email) return c.json({ error: 'Email requerido' }, 400);
  const supabase = crearClienteAnon(c.env);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: c.env.ALLOWED_ORIGIN,
  });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});
```

```ts
// --- Panel de plataforma (018): alta de acueductos por el superadmin -------

type ResultadoAdminPlataforma =
  | { ctx: { supabase: ReturnType<typeof crearClienteSuscriptor>; perfilId: string }; respuesta?: undefined }
  | { ctx: null; respuesta: Response };

async function requerirAdminPlataforma(c: Context<{ Bindings: Env }>): Promise<ResultadoAdminPlataforma> {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) {
    return { ctx: null, respuesta: c.json({ error: 'No autenticado' }, 401) };
  }
  const accessToken = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, accessToken ?? '');
  const { data: membresia } = await supabase
    .from('membresias')
    .select('rol')
    .eq('perfil_id', sesion.perfilId)
    .is('cliente_id', null)
    .eq('rol', 'administrador')
    .eq('activo', true)
    .maybeSingle();
  if (!membresia) {
    return { ctx: null, respuesta: c.json({ error: 'No autorizado' }, 403) };
  }
  return { ctx: { supabase, perfilId: sesion.perfilId } };
}

// GET /plataforma — lista de acueductos, solo para el superadmin.
app.get('/plataforma', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;
  const { data, error } = await ctx.supabase
    .from('clientes')
    .select('id, nombre, slug, fecha_alta')
    .order('fecha_alta', { ascending: false });
  if (error) return c.json({ error: 'No se pudo listar los acueductos' }, 500);
  return c.json({ acueductos: data ?? [] });
});
```

**Modificá `GET /plataforma` así** (mismo guard, mismo orden, agregando el email de cada admin):

```ts
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

(Este bloque de arriba reemplaza el `GET /plataforma` actual completo — no dejes los dos.)

### Función nueva en `backend/src/lib/plataforma.ts` (agregar al final del archivo)

El archivo ya existe con `generarContrasenaTemporal`, `crearAcueductoBase`, `signUpAdminAcueducto`,
`asignarAdminAcueducto` — no toques ninguna de esas, solo agregá esta:

```ts
// Email del admin_acueducto activo de cada cliente_id, para GET /plataforma (033).
// SECURITY INVOKER: `supabase` es el cliente del superadmin, RLS decide qué
// puede leer — mismo criterio que crearAcueductoBase/asignarAdminAcueducto.
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
  for (const m of membresias) {
    resultado[m.cliente_id] = emailPorPerfil.get(m.perfil_id) ?? null;
  }
  return resultado;
}
```

Necesita `import type { SupabaseClient } from '@supabase/supabase-js';` arriba del archivo si no
está ya.

### Ruta nueva: `POST /auth/cambiar-contrasena`

Agregala cerca de `POST /auth/recuperar` (mismo bloque de rutas de `/auth/*`):

```ts
// POST /auth/cambiar-contrasena — el usuario de la sesión activa cambia su
// propia contraseña (033). No distingue rol: cambiar la propia contraseña no
// es una acción sobre otro usuario. Nunca service_role_key (CLAUDE.md §12).
app.post('/auth/cambiar-contrasena', async (c) => {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) return c.json({ error: 'No autenticado' }, 401);

  const body = await c.req.json<{ passwordNueva?: string }>().catch(() => ({ passwordNueva: undefined }));
  const passwordNueva = body.passwordNueva ?? '';
  if (passwordNueva.length < 8) {
    return c.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
  }

  const accessToken = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, accessToken ?? '');
  const { error } = await supabase.auth.updateUser({ password: passwordNueva });
  if (error) return c.json({ error: error.message }, 400);

  // Aviso de seguridad (033, robustez): si esto falla, la contraseña ya
  // cambió igual — un fallo de correo nunca bloquea el flujo principal
  // (CLAUDE.md §10 punto 20). Sin tabla de reintento: es un aviso de sesión
  // propia, no una notificación al suscriptor (010).
  const resultadoCorreo = await enviarCorreo(c.env, {
    destinatario: sesion.email,
    remitente: 'no-responder@undreocol.app',
    asunto: 'Tu contraseña de UndreoCol cambió',
    cuerpoHtml: `<p>La contraseña de tu cuenta (${sesion.email}) se cambió el ${new Date().toISOString()}.</p><p>Si no fuiste vos, contactá al soporte de inmediato.</p>`,
  });
  if (!resultadoCorreo.ok) {
    console.error('cambiar-contrasena: no se pudo enviar el aviso de correo', resultadoCorreo.error);
  }

  return c.json({ ok: true });
});
```

### Archivo de test nuevo

`backend/tests/unit/cambiar-contrasena.test.ts` — mismo patrón que
`backend/tests/unit/auth-login-limite.test.ts` (mockear `lib/auth` y `lib/db`, ejercitar
`app.fetch` real). Casos mínimos:
1. Sin cookie de sesión → `401`.
2. `passwordNueva` de 6 caracteres → `400`, y el mock de `supabase.auth.updateUser` **no** se
   llama (assert de que no se invocó).
3. `passwordNueva` válida → `200`, `{ ok: true }`, y el mock de `crearClienteSuscriptor` se llamó
   con el `accessToken` de la sesión (no con ninguna referencia a `service_role`).
4. Con el mock de `enviarCorreo` devolviendo `{ ok: false, error: '...' }` → la respuesta sigue
   siendo `200` (verifica CLAUDE.md §10 punto 20 para este endpoint nuevo).

### Qué NO hacer

- No toques `crearAcueductoBase`, `signUpAdminAcueducto`, `asignarAdminAcueducto`,
  `generarContrasenaTemporal` en `lib/plataforma.ts`.
- No agregues `service_role_key` a ninguna de las dos rutas.
- No cambies `/auth/recuperar` — se reutiliza tal cual desde el frontend en T-002, sin tocar el
  backend.
- No inventes una tabla de reintento para el correo de aviso — spec §3.5 y plan.md §5 ya decidieron
  que no hace falta.

### Formato de entrega esperado de Luna

Los 3 archivos (`backend/src/index.ts` completo si es más simple pegarlo entero, o el diff preciso
de las secciones tocadas; `backend/src/lib/plataforma.ts` completo; el test nuevo completo). Al
final, la sección "Asunciones sin verificar" de tu prompt base.

---

## T-002 — Frontend: panel de plataforma con credenciales (PARA LUNA)

### Objetivo

En `frontend/lib/api.ts`: el tipo de acueducto de plataforma gana `adminEmail`, y dos funciones
nuevas: `restablecerContrasenaAcueducto(email)` (llama a `/auth/recuperar`) y
`cambiarContrasena(passwordNueva)` (llama a `/auth/cambiar-contrasena`). Un componente nuevo
`CambiarContrasenaForm`. Y `frontend/app/plataforma/page.tsx` muestra el email de cada admin, un
botón "Restablecer contraseña" por fila, y la sección de cambiar la contraseña propia.

**Esta tarea depende de T-001 ya aplicado** (necesita que `GET /plataforma` devuelva `adminEmail`
y que `/auth/cambiar-contrasena` exista) — si todavía no se aplicó, avisá antes de escribir código
que asuma una respuesta que el backend no da todavía.

### Archivo a modificar: `frontend/app/plataforma/page.tsx` (completo, tal cual está hoy)

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlataformaForm } from '@/components/plataforma-form';
import { urlBaseApiServidor } from '@/lib/url-base-api-servidor';
import { BotonSalir } from '@/components/boton-salir';

const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';

interface Acueducto {
  id: string;
  nombre: string;
  slug: string;
  fecha_alta: string;
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

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Acueductos ({acueductos.length})</h2>
        {acueductos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay ningún acueducto dado de alta.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {acueductos.map((a) => (
              <li key={a.id} className="flex items-center justify-between p-4 text-sm">
                <span className="font-medium">{a.nombre}</span>
                <span className="text-muted-foreground">{a.slug}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

### Cambios necesarios en `frontend/lib/api.ts` (agregar, no tienes que ver el archivo entero —
buscá donde está `crearAcueductoPlataforma`/`RespuestaAltaAcueducto` y agregá cerca)

```ts
export interface RespuestaAltaAcueducto {
  clienteId: string;
  slug: string;
  correoAdmin: string;
  contrasenaTemporal: string;
}
// crearAcueductoPlataforma ya existe con esta forma, no la toques.

// --- 033: credenciales del panel de plataforma ------------------------------

export function restablecerContrasenaAcueducto(email: string): Promise<{ ok: true }> {
  return peticion<{ ok: true }>('/auth/recuperar', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function cambiarContrasena(passwordNueva: string): Promise<{ ok: true }> {
  return peticion<{ ok: true }>('/auth/cambiar-contrasena', {
    method: 'POST',
    body: JSON.stringify({ passwordNueva }),
  });
}
```

`peticion<T>()` ya existe en este archivo (es el `fetch` envuelto que usan todas las demás
funciones) — reutilizalo, no inventes otro mecanismo.

### Componente nuevo: `frontend/components/cambiar-contrasena-form.tsx`

Mismo patrón que `frontend/components/pago-form.tsx` (`useHidratado()`,
`disabled={!hidratado || cargando}`, CLAUDE.md §7 — es un `<form onSubmit>` real):

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cambiarContrasena } from '@/lib/api';

export function CambiarContrasenaForm() {
  const [passwordNueva, setPasswordNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    if (passwordNueva !== confirmacion) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setCargando(true);
    try {
      await cambiarContrasena(passwordNueva);
      setAviso('Contraseña actualizada.');
      setPasswordNueva('');
      setConfirmacion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar la contraseña');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="passwordNueva">Contraseña nueva</Label>
        <Input
          id="passwordNueva"
          type="password"
          minLength={8}
          required
          value={passwordNueva}
          onChange={(e) => setPasswordNueva(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmacion">Confirmar contraseña nueva</Label>
        <Input
          id="confirmacion"
          type="password"
          minLength={8}
          required
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-green-700">{aviso}</p>}
      <Button type="submit" disabled={!hidratado || cargando}>
        {cargando ? 'Guardando…' : 'Cambiar contraseña'}
      </Button>
    </form>
  );
}
```

### Qué construir en `plataforma/page.tsx`

1. `interface Acueducto` gana `adminEmail: string | null`.
2. Cada `<li>` de la lista de acueductos muestra `a.adminEmail ?? 'sin admin asignado'` y un botón
   "Restablecer contraseña" (deshabilitado si `adminEmail` es `null` — no hay a quién enviarle el
   correo) que llama a `restablecerContrasenaAcueducto(a.adminEmail)` y muestra una confirmación
   simple (`window.alert` o un estado de aviso en un componente cliente aparte — tu criterio, mientras
   sea claro que se envió).
3. Nueva sección "Cambiar mi contraseña" con `<CambiarContrasenaForm />`, en la misma página, con
   su propio `<h2>`.
4. El botón de restablecer necesita ser un componente cliente (tiene `onClick`/estado) — la página
   en sí es un server component, así que armalo como un componente chico aparte
   (`frontend/components/restablecer-contrasena-acueducto.tsx`) que reciba `email` como prop, igual
   de chico que `CambiarContrasenaForm`.

### Qué NO hacer

- No toques `PlataformaForm` ni el flujo de alta de acueducto — sin cambios.
- No importes `@supabase/*` en ningún archivo de `frontend/` (CLAUDE.md §5.2, absoluto) — todo pasa
  por `lib/api.ts` y el backend.
- No agregues confirmación de "contraseña actual" al formulario propio — el spec (§7) decidió no
  pedirla, es el comportamiento estándar de Supabase Auth.

### Criterios de aceptación (spec.md §6, verificación real pendiente de Claude/Mateo — no tuya)

- CA-1 a CA-6 de `specs/033-credenciales-plataforma/spec.md` §6.

### Formato de entrega esperado de Luna

Los archivos completos y nuevos, cada uno con su ruta exacta. Al final, la sección "Asunciones sin
verificar" de tu prompt base.

---

## T-003 — Cierre: verificación real contra auth, CHANGELOG y PLAN-PRODUCCION.md (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (módulo "Acueductos" y "Mi cuenta /
Seguridad" del panel maestro pasan de "sin credenciales" a implementados).

**Verificación real, más estricta que en 030/031/032 — esto toca autenticación:**
```
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
```
Más, contra `wrangler dev` real (no alcanza con build/lint para una ruta de auth):
1. Confirmar con `grep` que ninguna de las dos rutas nuevas usa `service_role`/`SERVICE_ROLE_KEY`.
2. `curl` real a `POST /auth/cambiar-contrasena` sin cookie → `401`.
3. Con una sesión real de prueba: cambiar la contraseña, cerrar sesión, volver a iniciar sesión con
   la contraseña nueva — de punta a punta, no solo el `200` de la respuesta.
4. `curl` real a `GET /plataforma` con sesión de superadmin real → confirmar que `adminEmail`
   aparece y es el correcto para cada acueducto de prueba.
5. Confirmar en los logs de `wrangler dev` (o Mailpit si corre local) que el aviso de cambio de
   contraseña se intentó enviar.

**Estado:** COMPLETADO — auditoría real encontró un bug que build/lint/tests con mocks no
detectaban: `auth.updateUser()` fallaba con "Auth session missing!" porque `crearClienteSuscriptor`
solo pasa el JWT como header PostgREST, no como sesión activa del módulo `auth.*`. Corregido
(`obtenerTokensSesion()` nueva en `lib/auth.ts` + `setSession()` con ambos tokens antes de
`updateUser()`), test unitario reescrito para el cliente/método correctos. Verificado de punta a
punta contra `wrangler dev` real: login → cambiar contraseña → logout → vieja falla, nueva
funciona; `GET /plataforma` con `adminEmail` real; "Restablecer contraseña" con correo real
confirmado en Mailpit; aviso de cambio de contraseña con contenido real verificado. 222/222 tests,
`build`/`lint`/`wrangler deploy --dry-run` limpios. `grep` confirma cero uso de `service_role` en
las rutas nuevas. Verificación visual en navegador real queda pendiente de Mateo.
