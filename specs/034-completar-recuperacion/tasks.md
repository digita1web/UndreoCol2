# TASKS — 034: completar-recuperacion

**Plan aprobado:** 2026-09-12

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-001 (backend) y T-002 (frontend) son para Luna. T-003
(cierre) es para Claude. Esta feature depende de entender bien `lib/auth.ts` — te lo doy completo
abajo, no inventes el patrón de cookies: la sesión 033 anterior tuvo un bug real (`"Auth session
missing!"`) por usar el cliente equivocado para una operación de `auth.*` — no lo repitas.

---

## T-001 — Backend: completar la recuperación de contraseña (PARA LUNA)

### Objetivo

`crearClienteAnon()` fija `flowType: 'implicit'`. Nueva función `completarRecuperacion()` en
`lib/auth.ts` (junto a `iniciarSesion`/`cerrarSesion`/`verificarSesionAdministrativa`, que ya
existen ahí). Nueva ruta `POST /auth/completar-recuperacion` en `index.ts`.

### Archivo completo de referencia — `backend/src/lib/auth.ts` (tal cual está hoy, no lo pises
entero: agregale la función nueva al final, sin tocar nada de lo que ya existe)

```ts
// Sesión administrativa — Supabase Auth (implementada en esta feature).
// La cookie uc_sesion_admin guarda { at, rt, exp } (access/refresh/expiración).
// Diseñada para convivir con la sesión del suscriptor (D-2/D-4, feature 008).

import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { crearClienteAnon, type Env } from './db';

export type TipoSesion = 'administrativa' | 'suscriptor';

export interface SesionAdministrativa {
  tipo: 'administrativa';
  perfilId: string; // auth.users.id / perfiles.id
  email: string;
}

export const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';
export const DURACION_COOKIE_SESION_SEG = 7 * 24 * 60 * 60; // 7 días

export interface ResultadoInicioSesion {
  sesion: SesionAdministrativa;
  accessToken: string;
}

interface TokenSesion {
  at: string; // access_token
  rt: string; // refresh_token
  exp: number; // expires_at (epoch s)
}

const OPCIONES_COOKIE = {
  httpOnly: true,
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: DURACION_COOKIE_SESION_SEG,
};

function secureSegunProtocolo(c: Context<{ Bindings: Env }>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function escribirCookie(c: Context<{ Bindings: Env }>, t: TokenSesion): void {
  setCookie(c, NOMBRE_COOKIE_SESION, JSON.stringify(t), {
    ...OPCIONES_COOKIE,
    secure: secureSegunProtocolo(c),
  });
}

function leerCookie(c: Context<{ Bindings: Env }>): TokenSesion | null {
  const raw = getCookie(c, NOMBRE_COOKIE_SESION);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as TokenSesion;
    return t.at && t.rt ? t : null;
  } catch (e) {
    console.error('auth: cookie de sesión inválida', e);
    return null;
  }
}

export function obtenerAccessToken(c: Context<{ Bindings: Env }>): string | null {
  return leerCookie(c)?.at ?? null;
}

export function obtenerTokensSesion(c: Context<{ Bindings: Env }>): { at: string; rt: string } | null {
  return leerCookie(c);
}

export async function verificarSesionAdministrativa(
  c: Context<{ Bindings: Env }>,
): Promise<SesionAdministrativa | null> {
  const token = leerCookie(c);
  if (!token) return null;
  const supabase = crearClienteAnon(c.env);
  const { error: eSet } = await supabase.auth.setSession({
    access_token: token.at,
    refresh_token: token.rt,
  });
  if (eSet) {
    console.error('auth: setSession falló', eSet.message);
    return null;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    console.error('auth: getUser falló', error?.message ?? 'sin usuario');
    return null;
  }
  const { data: s } = await supabase.auth.getSession();
  if (s.session) {
    escribirCookie(c, {
      at: s.session.access_token,
      rt: s.session.refresh_token,
      exp: s.session.expires_at ?? 0,
    });
  }
  return { tipo: 'administrativa', perfilId: data.user.id, email: data.user.email ?? '' };
}

export async function iniciarSesion(
  c: Context<{ Bindings: Env }>,
  email: string,
  contrasena: string,
): Promise<ResultadoInicioSesion> {
  const supabase = crearClienteAnon(c.env);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: contrasena });
  if (error || !data.session || !data.user) {
    throw new Error('Credenciales inválidas');
  }
  escribirCookie(c, {
    at: data.session.access_token,
    rt: data.session.refresh_token,
    exp: data.session.expires_at ?? 0,
  });
  return {
    sesion: { tipo: 'administrativa', perfilId: data.user.id, email: data.user.email ?? email },
    accessToken: data.session.access_token,
  };
}

export async function cerrarSesion(c: Context<{ Bindings: Env }>): Promise<void> {
  const token = leerCookie(c);
  if (token) {
    try {
      const supabase = crearClienteAnon(c.env);
      await supabase.auth.setSession({ access_token: token.at, refresh_token: token.rt });
      const { error } = await supabase.auth.signOut();
      if (error) console.error('logout: signOut falló', error.message);
    } catch (e) {
      console.error('logout: error revocando la sesión', e);
    }
  }
  deleteCookie(c, NOMBRE_COOKIE_SESION);
}
```

### Función nueva a agregar al final de `lib/auth.ts`

```ts
// Completa la recuperación de contraseña (034): el token de recuperación de
// la URL (access_token + refresh_token que Supabase Auth generó al hacer
// clic en el enlace del correo) es la prueba de identidad — no hace falta
// sesión administrativa previa. setSession() valida que el token sea real y
// no haya vencido; si es inválido, Supabase Auth devuelve error acá, no
// más adelante. Deja a la persona logueada, mismo mecanismo que
// iniciarSesion() (mismo tipo de retorno, misma cookie).
export async function completarRecuperacion(
  c: Context<{ Bindings: Env }>,
  accessToken: string,
  refreshToken: string,
  passwordNueva: string,
): Promise<ResultadoInicioSesion> {
  const supabase = crearClienteAnon(c.env);
  const { error: eSet } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (eSet) {
    throw new Error('Enlace de recuperación inválido o vencido');
  }
  const { error: eUpdate } = await supabase.auth.updateUser({ password: passwordNueva });
  if (eUpdate) {
    throw new Error(eUpdate.message);
  }
  const { data: s, error: eSesion } = await supabase.auth.getSession();
  if (eSesion || !s.session || !s.session.user) {
    throw new Error('No se pudo confirmar la sesión tras el cambio de contraseña');
  }
  escribirCookie(c, {
    at: s.session.access_token,
    rt: s.session.refresh_token,
    exp: s.session.expires_at ?? 0,
  });
  return {
    sesion: {
      tipo: 'administrativa',
      perfilId: s.session.user.id,
      email: s.session.user.email ?? '',
    },
    accessToken: s.session.access_token,
  };
}
```

`escribirCookie` ya es privada del archivo (no exportada) — la función nueva la usa directo, igual
que `iniciarSesion`. No la exportes ni la dupliques.

### Ruta real de referencia — `POST /auth/login` (`index.ts`, tal cual está hoy, para que la ruta
nueva devuelva exactamente el mismo formato)

```ts
app.post('/auth/login', async (c) => {
  // ... límite de intentos, no relevante acá ...
  let sesion: Awaited<ReturnType<typeof iniciarSesion>>['sesion'];
  let accessToken: string;
  try {
    ({ sesion, accessToken } = await iniciarSesion(c, email, password));
  } catch (e) {
    // ...
    return c.json({ error: e instanceof Error ? e.message : 'Error de autenticación' }, 401);
  }
  // ...
  {
    const supabase = crearClienteSuscriptor(c.env, accessToken);
    const { data: perfil } = await supabase.from('perfiles').select('id, nombre, email').eq('id', sesion.perfilId).maybeSingle();
    const { data: membresias } = await supabase.from('membresias').select('id, cliente_id, rol').eq('perfil_id', sesion.perfilId).eq('activo', true);
    return c.json({ sesion, perfil, membresias });
  }
});
```

### Ruta nueva: `POST /auth/completar-recuperacion`

Agregala cerca de `POST /auth/recuperar`. Body esperado: `{ accessToken, refreshToken,
passwordNueva }`. Validá `passwordNueva.length >= 8` **antes** de llamar a
`completarRecuperacion()` (mismo criterio que 033, error `400` temprano). Si
`completarRecuperacion()` lanza, devolvé `401` con el mensaje del error (es un problema de token/
identidad, no un `400` de validación). Si todo sale bien, respondé con el mismo formato que
`POST /auth/login` (`sesion`, `perfil`, `membresias`) — reutilizá el mismo patrón de consultar
`perfiles`/`membresias` con `crearClienteSuscriptor(c.env, accessToken)` que ya usa el login.

### Archivo de test nuevo

`backend/tests/unit/completar-recuperacion.test.ts` — mismo patrón que
`backend/tests/unit/cambiar-contrasena.test.ts` (mockear `crearClienteAnon` con
`setSession`/`updateUser`/`getSession`, y `crearClienteSuscriptor` para el perfil/membresías).
Casos mínimos:
1. `setSession` devuelve error → `401`, `updateUser` nunca se llama.
2. `passwordNueva` de 6 caracteres → `400`, sin llamar a Supabase Auth en absoluto.
3. Flujo completo válido → `200`, cuerpo con `sesion`/`perfil`/`membresias`, y la respuesta trae
   header `Set-Cookie` con `uc_sesion_admin` (verificable con `respuesta.headers.get('set-cookie')`
   en el test, igual que podrías inspeccionar cualquier respuesta de `app.fetch`).

### Qué NO hacer

- No uses `crearClienteSuscriptor` para `setSession`/`updateUser` — ese cliente solo sirve para
  consultas PostgREST con el JWT como header, no para el módulo `auth.*` (por eso 033 tuvo el bug
  real de "Auth session missing!" — no lo repitas).
- No agregues `service_role_key`.
- No toques `iniciarSesion`, `cerrarSesion`, `verificarSesionAdministrativa` — solo agregá la
  función nueva al final del archivo.

### Formato de entrega esperado de Luna

Los 3 archivos (el diff de `lib/db.ts`, la función nueva completa para `lib/auth.ts`, la ruta nueva
completa para `index.ts`, y el test nuevo completo). Al final, "Asunciones sin verificar".

---

## T-002 — Frontend: página de restablecimiento (PARA LUNA)

### Objetivo

`frontend/app/restablecer-contrasena/page.tsx` — componente cliente (usa `window.location.hash`,
no disponible en servidor). Lee `access_token`/`refresh_token`/`type` del fragmento de la URL que
deja Supabase Auth en modo implícito. Si faltan o `type` no es `recovery`: mensaje de error con
link a `/login`. Si están: formulario de contraseña nueva + confirmación, llama a la función nueva
de `lib/api.ts`, y si sale bien redirige a `/app/dashboard` (la persona ya queda logueada, mismo
criterio que tras un login).

### Función nueva en `frontend/lib/api.ts` (agregar cerca de `cambiarContrasena`)

```ts
export function completarRecuperacion(
  accessToken: string,
  refreshToken: string,
  passwordNueva: string,
): Promise<{ sesion: unknown; perfil: unknown; membresias: unknown[] }> {
  return peticion('/auth/completar-recuperacion', {
    method: 'POST',
    body: JSON.stringify({ accessToken, refreshToken, passwordNueva }),
  });
}
```

(El tipo de retorno exacto podés afinarlo si ya ves tipos `Sesion`/`Perfil`/`Membresia` definidos
en el archivo — reutilizalos, no inventes otros con la misma forma.)

### Cómo leer el fragmento de la URL (parseo manual, sin el SDK de Supabase — CLAUDE.md §5.2:
ningún archivo de `frontend/` importa `@supabase/*`)

```ts
function leerFragmento(): { accessToken: string; refreshToken: string } | null {
  if (typeof window === 'undefined') return null;
  const parametros = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = parametros.get('access_token');
  const refreshToken = parametros.get('refresh_token');
  const tipo = parametros.get('type');
  if (!accessToken || !refreshToken || tipo !== 'recovery') return null;
  return { accessToken, refreshToken };
}
```

Llamá a esto dentro de un `useEffect` (el hash no está disponible en el primer render del server
component/hidratación) y guardalo en estado.

### Qué construir

1. Página cliente (`'use client'`), con `useHidratado()` en el formulario (es un
   `<form onSubmit>` real, CLAUDE.md §7: `disabled={!hidratado || cargando}`).
2. Si `leerFragmento()` devuelve `null`: tarjeta con "Enlace inválido o vencido" + link a `/login`
   (mismo estilo que las pantallas de "No autorizado" ya existentes, ej.
   `frontend/app/app/dashboard/page.tsx`).
3. Si devuelve los tokens: formulario de "Contraseña nueva" + "Confirmar contraseña nueva" (mismo
   patrón que `CambiarContrasenaForm`, 033 — podés mirar
   `frontend/components/cambiar-contrasena-form.tsx` como referencia de estilo, aunque esta pantalla
   no reutiliza ese componente porque no hay sesión previa, los datos que necesita llamar son
   distintos).
4. Al enviar: `completarRecuperacion(accessToken, refreshToken, passwordNueva)`. Si sale bien,
   `router.push('/app/dashboard')` (mismo patrón que otros formularios de este proyecto tras una
   acción exitosa) — no hace falta decidir `/plataforma` vs `/app/dashboard` acá, el dashboard ya
   resuelve esa redirección solo si hace falta.

### Qué NO hacer

- No importes `@supabase/*` en ningún archivo de `frontend/`.
- No reutilices `CambiarContrasenaForm` tal cual (llama a una función distinta, con distintos
  parámetros) — escribí el formulario de esta página aparte, aunque se vea parecido.
- No hardcodees ninguna URL de Supabase — todo pasa por `/auth/completar-recuperacion` en nuestro
  propio backend.

### Criterios de aceptación (spec.md §6, verificación real pendiente de Claude/Mateo — no tuya)

- CA-1 a CA-4 de `specs/034-completar-recuperacion/spec.md` §6.

### Formato de entrega esperado de Luna

El archivo completo de la página nueva, el agregado a `lib/api.ts`. Al final, "Asunciones sin
verificar".

---

## T-003 — Cierre: plantilla de correo, verificación real, CHANGELOG (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `supabase/config.toml`, `supabase/templates/recovery.html` (plantilla en español, con
`{{ .ConfirmationURL }}`), `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md`.

**Verificación real, de punta a punta — esto es autenticación, no alcanza con build/lint:**
```
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
```
Más, contra `wrangler dev` + `next dev` + Mailpit reales:
1. `POST /auth/recuperar` con un email de prueba real → confirmar en Mailpit que el correo llega
   **en español** (CA-4).
2. Tomar el enlace real del correo (o el fragmento `#access_token=...`) y completar el
   restablecimiento en `/restablecer-contrasena` → confirmar que la cuenta queda con la contraseña
   nueva y la persona queda logueada sin volver a iniciar sesión (CA-1).
3. Visitar `/restablecer-contrasena` sin fragmento → confirmar el mensaje de error, no una pantalla
   en blanco ni un 500 (CA-2).
4. `grep` para confirmar que ninguna ruta nueva usa `service_role`.

**Estado:** COMPLETADO — auditoría real encontró 2 bugs invisibles en build/lint/tests con mocks,
solo detectables siguiendo el enlace real del correo: (1) `redirectTo` sin ruta en
`POST /auth/recuperar`, corregido con el primer origen de `ALLOWED_ORIGIN` + `/restablecer-
contrasena`; (2) `supabase/config.toml` sin esa URL en su lista blanca de redirects — Supabase Auth
la rechazaba en silencio, corregido junto con una inconsistencia previa (`site_url` en `127.0.0.1`
en vez de `localhost`). Plantilla de correo en español agregada. Verificado de punta a punta con el
enlace real (Mailpit → GoTrue verify → fragmento real → `POST /auth/completar-recuperacion` →
sesión real → login con la contraseña nueva). 225/225 tests, `build`/`lint`/`wrangler deploy
--dry-run` limpios. Verificación visual en navegador real queda pendiente de Mateo.
