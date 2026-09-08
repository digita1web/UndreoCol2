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

// Contraseña temporal para el admin nuevo (plan §5.4). Se muestra una sola
// vez en la respuesta del alta; no se guarda en ninguna tabla ni se loguea.
export function generarContrasenaTemporal(): string {
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
