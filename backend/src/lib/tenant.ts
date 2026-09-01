// Resolución del acueducto activo del usuario (spec §4.6).
// 1 cliente → activo; 0 → null (el frontend redirige a /onboarding);
// varios → null con la lista completa (caso previsto: soporte de UndreoCol).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClienteActivo {
  clienteId: string;
  rol: string;
  nombre: string;
}

export async function resolverClienteActivo(
  supabase: SupabaseClient,
  perfilId: string,
): Promise<{ activo: ClienteActivo | null; lista: ClienteActivo[] }> {
  const { data, error } = await supabase
    .from('membresias')
    .select('cliente_id, rol, clientes(nombre)')
    .eq('perfil_id', perfilId)
    .eq('activo', true);
  if (error) {
    throw new Error(`No se pudo resolver el acueducto activo: ${error.message}`);
  }
  const filas = (data ?? []) as Array<{
    cliente_id: string;
    rol: string;
    clientes: unknown;
  }>;
  const lista = filas.map((f) => {
    // PostgREST devuelve el embebido como objeto (to-one); se normaliza con
    // defensa ante array por si cambia la forma del select.
    const clienteEmbebido = f.clientes as { nombre?: string } | null;
    return {
      clienteId: f.cliente_id,
      rol: f.rol,
      nombre: clienteEmbebido?.nombre ?? '',
    };
  });
  const activo = lista.length === 1 ? (lista[0] ?? null) : null;
  return { activo, lista };
}
