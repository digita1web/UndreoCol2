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

// Contraseña interna para satisfacer signUp() al crear el admin nuevo (019).
// Nunca se devuelve ni se loguea: el admin la reemplaza mediante invitación.
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
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    planId: data.plan_id as string | null,
    estadoCuenta: data.estado_cuenta as string,
  };
}

export async function obtenerSaludSistema(
  supabase: SupabaseClient,
): Promise<{ tamanoBaseMb: number; nivel: string; medidoEn: string; ultimoKeepalive: string | null }> {
  const { data: salud, error: errSalud } = await supabase
    .from('_salud_sistema')
    .select('tamano_base_mb, nivel, medido_en')
    .eq('id', 1)
    .maybeSingle();
  if (errSalud) throw new Error(errSalud.message);

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

export async function obtenerEstadoBackup(
  bucket: R2Bucket,
): Promise<{ archivo: string; subidoEn: string } | null> {
  const listado = await bucket.list();
  if (listado.objects.length === 0) return null;
  const masReciente = listado.objects.reduce((a, b) => (a.uploaded > b.uploaded ? a : b));
  return { archivo: masReciente.key, subidoEn: masReciente.uploaded.toISOString() };
}
