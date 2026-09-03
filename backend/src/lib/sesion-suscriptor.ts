// Sesión del portal del suscriptor (D-2, D-4, D-10) — implementada en la
// feature 008. El suscriptor NO es un usuario de Supabase Auth: la sesión es un
// JWT propio firmado con SESSION_SECRET (hono/utils/jwt, HS256) en una cookie
// HttpOnly + Secure + SameSite=Lax. Nunca se usa SUPABASE_SERVICE_ROLE_KEY.
//
// Contrato fijado desde la fundación y ampliado en el plan 008 §4 (D-10): el
// JWT lleva numeroDocumento+codigoSuscriptor como claims firmados (doc/cod)
// porque CADA llamada a las funciones SECURITY DEFINER del portal debe
// reenviar esas credenciales reales, no solo el usuario_servicio_id.

import { sign, verify } from 'hono/jwt';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { Env } from './db';

export interface SesionSuscriptor {
  tipo: 'suscriptor';
  usuarioServicioId: string; // "sub" del JWT
  clienteId: string; // "cid" del JWT
  numeroDocumento: string; // "doc" del JWT (D-10)
  codigoSuscriptor: string; // "cod" del JWT (D-10)
  expiraEn: number; // "exp" del JWT (epoch s)
}

// Constantes de la sesión del portal (D-4): 30 días con renovación < 7 días.
export const DURACION_SESION_SUSCRIPTOR_SEG = 30 * 24 * 60 * 60;
export const UMBRAL_RENOVACION_SUSCRIPTOR_SEG = 7 * 24 * 60 * 60;

export const NOMBRE_COOKIE_SESION_SUSCRIPTOR = 'uc_sesion_suscriptor';
const TIPO_SESION_SUSCRIPTOR = 'suscriptor';
const ALGORITMO_JWT = 'HS256';

const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  path: '/',
  maxAge: DURACION_SESION_SUSCRIPTOR_SEG,
};

const AHORA_SEG = (): number => Math.floor(Date.now() / 1000);

interface ClaimsSesionSuscriptor {
  sub: string;
  cid: string;
  doc: string;
  cod: string;
  tipo: string;
  exp: number;
}

// Firma el JWT (HS256, SESSION_SECRET) y escribe la cookie uc_sesion_suscriptor.
// NO valida credenciales: eso ya lo hizo portal_validar_credenciales antes.
export async function iniciarSesionSuscriptor(
  c: Context<{ Bindings: Env }>,
  datos: { usuarioServicioId: string; clienteId: string; numeroDocumento: string; codigoSuscriptor: string },
): Promise<SesionSuscriptor> {
  const expiraEn = AHORA_SEG() + DURACION_SESION_SUSCRIPTOR_SEG;
  const token = await sign(
    {
      sub: datos.usuarioServicioId,
      cid: datos.clienteId,
      doc: datos.numeroDocumento,
      cod: datos.codigoSuscriptor,
      tipo: TIPO_SESION_SUSCRIPTOR,
      exp: expiraEn,
    } satisfies ClaimsSesionSuscriptor,
    c.env.SESSION_SECRET,
    ALGORITMO_JWT,
  );
  setCookie(c, NOMBRE_COOKIE_SESION_SUSCRIPTOR, token, OPCIONES_COOKIE);
  return { tipo: TIPO_SESION_SUSCRIPTOR, ...datos, expiraEn };
}

// Uso interno de verificarSesionSuscriptor (y disponible para tests): reescribe
// la cookie con un exp nuevo a partir de una sesión ya vigente.
export async function renovarSesionSuscriptor(
  c: Context<{ Bindings: Env }>,
  sesion: SesionSuscriptor,
): Promise<SesionSuscriptor> {
  const expiraEn = AHORA_SEG() + DURACION_SESION_SUSCRIPTOR_SEG;
  const token = await sign(
    {
      sub: sesion.usuarioServicioId,
      cid: sesion.clienteId,
      doc: sesion.numeroDocumento,
      cod: sesion.codigoSuscriptor,
      tipo: TIPO_SESION_SUSCRIPTOR,
      exp: expiraEn,
    } satisfies ClaimsSesionSuscriptor,
    c.env.SESSION_SECRET,
    ALGORITMO_JWT,
  );
  setCookie(c, NOMBRE_COOKIE_SESION_SUSCRIPTOR, token, OPCIONES_COOKIE);
  return { ...sesion, expiraEn };
}

// Lee la cookie, verifica firma + exp + tipo: 'suscriptor' (CLAUDE.md §10-22c).
// NUNCA lanza: inválida/vencida/ausente/tipo incorrecto → null. Si quedan menos
// de UMBRAL_RENOVACION_SUSCRIPTOR_SEG segundos, renueva automáticamente
// (reescribe la cookie) antes de devolver.
export async function verificarSesionSuscriptor(
  c: Context<{ Bindings: Env }>,
): Promise<SesionSuscriptor | null> {
  const token = getCookie(c, NOMBRE_COOKIE_SESION_SUSCRIPTOR);
  if (!token) return null;

  let payload: ClaimsSesionSuscriptor;
  try {
    payload = (await verify(token, c.env.SESSION_SECRET, ALGORITMO_JWT)) as unknown as ClaimsSesionSuscriptor;
  } catch (e) {
    // Firma inválida o exp vencido: sin sesión (la verificación nunca lanza).
    console.error('sesion-suscriptor: JWT inválido', e instanceof Error ? e.message : e);
    return null;
  }
  if (!payload || payload.tipo !== TIPO_SESION_SUSCRIPTOR) return null;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || !payload.sub || !payload.cid || !payload.doc || !payload.cod) {
    return null;
  }

  const sesion: SesionSuscriptor = {
    tipo: 'suscriptor',
    usuarioServicioId: payload.sub,
    clienteId: payload.cid,
    numeroDocumento: payload.doc,
    codigoSuscriptor: payload.cod,
    expiraEn: exp,
  };

  // D-4: renovación automática si quedan menos de 7 días.
  if (exp - AHORA_SEG() < UMBRAL_RENOVACION_SUSCRIPTOR_SEG) {
    return renovarSesionSuscriptor(c, sesion);
  }
  return sesion;
}

// Borra la cookie de la sesión del portal (logout). Idempotente.
export function cerrarSesionSuscriptor(c: Context<{ Bindings: Env }>): void {
  deleteCookie(c, NOMBRE_COOKIE_SESION_SUSCRIPTOR);
}
