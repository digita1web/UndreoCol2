// Resolución del acueducto activo del usuario (spec §4.6).
// 1 cliente → activo; 0 → null (el frontend redirige a /onboarding); varios →
// null con la lista completa (caso previsto: soporte de UndreoCol).
//
// FIX (018, T-004): la membresía 'administrador' (rol de plataforma) se
// registra con cliente_id NULL (fundacion-tenancy.sql:83). Antes de este fix,
// esa fila se contaba igual que un acueducto — un superadmin con SOLO esa
// membresía obtenía `lista.length === 1` y `activo = { clienteId: null, ... }`
// en vez de la redirección a /plataforma que corresponde. Bug real, encontrado
// en producción en sesión (018 spec, origen). Se excluyen las membresías con
// cliente_id NULL de `lista`/`activo`, y se expone `esAdminPlataforma` para
// que el caller (GET /dashboard) sepa a dónde redirigir.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClienteActivo {
  clienteId: string;
  rol: string;
  nombre: string;
}

export async function resolverClienteActivo(
  supabase: SupabaseClient,
  perfilId: string,
): Promise<{ activo: ClienteActivo | null; lista: ClienteActivo[]; esAdminPlataforma: boolean }> {
  const { data, error } = await supabase
    .from('membresias')
    .select('cliente_id, rol, clientes(nombre)')
    .eq('perfil_id', perfilId)
    .eq('activo', true);
  if (error) {
    throw new Error(`No se pudo resolver el acueducto activo: ${error.message}`);
  }
  const filas = (data ?? []) as Array<{
    cliente_id: string | null;
    rol: string;
    clientes: unknown;
  }>;
  const esAdminPlataforma = filas.some((f) => f.cliente_id === null && f.rol === 'administrador');
  const lista = filas
    .filter((f) => f.cliente_id !== null)
    .map((f) => {
      // PostgREST devuelve el embebido como objeto (to-one); se normaliza con
      // defensa ante array por si cambia la forma del select.
      const clienteEmbebido = f.clientes as { nombre?: string } | null;
      return {
        clienteId: f.cliente_id as string,
        rol: f.rol,
        nombre: clienteEmbebido?.nombre ?? '',
      };
    });
  const activo = lista.length === 1 ? (lista[0] ?? null) : null;
  return { activo, lista, esAdminPlataforma };
}
