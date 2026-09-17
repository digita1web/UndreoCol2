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

// RPC asignar_lector_acueducto (migración crear-lector-acueducto). Mismo
// criterio que asignarAdminAcueducto (lib/plataforma.ts): `supabase` es el
// cliente del admin_acueducto que llama, SECURITY DEFINER con guarda
// explícita adentro de la función SQL — RLS de `perfiles` no lo autorizaría
// solo (perfiles_alta_plataforma exige es_admin_plataforma()).
export async function asignarLectorAcueducto(
  supabase: SupabaseClient,
  clienteId: string,
  usuarioId: string,
  nombre: string,
  email: string,
): Promise<void> {
  const { error } = await supabase.rpc('asignar_lector_acueducto', {
    p_cliente_id: clienteId,
    p_usuario_id: usuarioId,
    p_nombre: nombre,
    p_email: email,
  });
  if (error) {
    throw new Error(error.message);
  }
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
