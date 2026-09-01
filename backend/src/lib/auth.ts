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
  secure: true,
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: DURACION_COOKIE_SESION_SEG,
};

function escribirCookie(c: Context<{ Bindings: Env }>, t: TokenSesion): void {
  setCookie(c, NOMBRE_COOKIE_SESION, JSON.stringify(t), OPCIONES_COOKIE);
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
