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
  // access_token vigente: la cookie se acaba de escribir en la respuesta y no
  // está en el request; se devuelve para las consultas del mismo handler.
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

// El atributo Secure SOLO se envía sobre HTTPS real. El edge de Cloudflare
// (producción y previews) atiende todo por HTTPS, así que c.req.url es https.
// En dev local (wrangler dev, http://localhost:8787) un navegador descarta una
// cookie Secure recibida por HTTP: el login respondía 200 pero la sesión no se
// guardaba y la siguiente petición daba 401 (bug real confirmado con DevTools
// por Mateo — CHANGELOG Sesión 021).
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

// Access_token vigente de la cookie (después de parsear el JSON). Para las
// consultas a Supabase con RLS: auth.uid() resuelve contra este token.
export function obtenerAccessToken(c: Context<{ Bindings: Env }>): string | null {
  return leerCookie(c)?.at ?? null;
}

// Ambos tokens de la cookie — a diferencia de obtenerAccessToken() (alcanza
// para las consultas PostgREST vía crearClienteSuscriptor), las operaciones
// de auth.* que requieren sesión activa en el cliente (ej. auth.updateUser())
// necesitan auth.setSession({ access_token, refresh_token }) primero — mismo
// patrón que ya usan internamente verificarSesionAdministrativa()/cerrarSesion().
export function obtenerTokensSesion(c: Context<{ Bindings: Env }>): { at: string; rt: string } | null {
  return leerCookie(c);
}

// Middleware/helper: valida la cookie vía Supabase y refresca si expiró.
// Sin sesión → null (nunca lanza); cookie inválida/vencida → null.
export async function verificarSesionAdministrativa(
  c: Context<{ Bindings: Env }>,
): Promise<SesionAdministrativa | null> {
  const token = leerCookie(c);
  if (!token) return null;
  const supabase = crearClienteAnon(c.env);
  // setSession valida el access_token y, si expiró, refresca con el refresh_token.
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
  // Reescribir la cookie con los tokens vigentes (por si setSession refrescó).
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

// Inicia sesión con email/contraseña y escribe la cookie HttpOnly.
// Credenciales inválidas → lanza Error explícito.
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

// Cierra la sesión (revoca el refresh token si es posible) y borra la cookie.
// Idempotente: sin sesión no lanza.
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

// Completa la recuperación de contraseña usando los tokens entregados por
// Supabase Auth en el fragmento del enlace de recuperación.
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

// Dispara el correo con el enlace para definir contraseña, tanto para una
// cuenta existente como para el admin recién creado de un acueducto.
export async function enviarEnlaceDefinirContrasena(env: Env, email: string): Promise<void> {
  const supabase = crearClienteAnon(env);
  const primerOrigen = env.ALLOWED_ORIGIN.split(',')[0]?.trim() ?? '';
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${primerOrigen}/restablecer-contrasena`,
  });
  if (error) {
    throw new Error(error.message);
  }
}
