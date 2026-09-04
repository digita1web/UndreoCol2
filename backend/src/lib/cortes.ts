// Capa fina de acceso a datos para cortes y reconexiones
// (specs/009-cortes-y-reconexiones/plan.md §1). Sin lógica de negocio propia
// — 009 no calcula dinero; la deuda vencida ya la calcula obtenerCartera()
// (007) y se pasa tal cual a la RPC reconectar().

import type { SupabaseClient } from '@supabase/supabase-js';
import { obtenerCartera } from './pagos';

export interface CandidatoCorte {
  usuarioServicioId: string;
  nombre: string;
  codigoSuscriptor: string;
  vencida: number;
  diasMoraMax: number;
}

// Suscriptores activos cuya deuda vencida supera configuracion.dias_umbral_corte
// (spec §3.1). Reutiliza obtenerCartera({ soloMorosos: true }) tal cual — no
// reimplementa el cálculo de deuda vencida.
export async function listarCandidatosCorte(
  supabase: SupabaseClient,
  clienteId: string,
): Promise<CandidatoCorte[]> {
  const { data: config, error: errConfig } = await supabase
    .from('configuracion')
    .select('dias_umbral_corte')
    .eq('cliente_id', clienteId)
    .single();
  if (errConfig) throw new Error(`No se pudo leer la configuración: ${errConfig.message}`);
  const umbral = Number(config?.dias_umbral_corte ?? 60);

  const cartera = await obtenerCartera(supabase, clienteId, { soloMorosos: true });
  return cartera
    .filter((f) => f.estado === 'activo' && (f.diasMoraMax ?? 0) >= umbral)
    .map((f) => ({
      usuarioServicioId: f.usuarioServicioId,
      nombre: f.nombre,
      codigoSuscriptor: f.codigoSuscriptor,
      vencida: f.vencida,
      diasMoraMax: f.diasMoraMax ?? 0,
    }));
}

// Única forma soportada de cortar un suscriptor: RPC a registrar_corte()
// (SELECT FOR UPDATE + motivo obligatorio, misma transacción).
export async function cortarSuscriptor(
  supabase: SupabaseClient,
  usuarioServicioId: string,
  motivo: string,
  perfilId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_corte', {
    p_usuario_servicio_id: usuarioServicioId,
    p_motivo: motivo,
    p_perfil: perfilId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

// Calcula la deuda vencida del suscriptor (vía obtenerCartera(), 007 — única
// fuente de verdad) y llama reconectar(). El motivo de excepción es
// obligatorio si hay deuda vencida; la RPC lo vuelve a exigir de todas
// formas (defensa en profundidad, mismo criterio que el resto del proyecto).
export async function reconectarSuscriptor(
  supabase: SupabaseClient,
  clienteId: string,
  usuarioServicioId: string,
  motivoExcepcion: string | null,
  perfilId: string,
): Promise<{ eventoId: string; deudaVencida: number }> {
  const cartera = await obtenerCartera(supabase, clienteId, { suscriptorId: usuarioServicioId });
  const deudaVencida = cartera[0]?.vencida ?? 0;

  const { data, error } = await supabase.rpc('reconectar', {
    p_usuario_servicio_id: usuarioServicioId,
    p_deuda_vencida: deudaVencida,
    p_motivo_excepcion: motivoExcepcion,
    p_perfil: perfilId,
  });
  if (error) throw new Error(error.message);
  return { eventoId: data as string, deudaVencida };
}

export interface EventoCorte {
  id: string;
  tipo: 'corte' | 'reconexion';
  fecha: string;
  motivo: string;
  responsable: string;
  deuda_vencida_al_reconectar: number | null;
  factura_reconexion_id: string | null;
}

export async function historialCortes(
  supabase: SupabaseClient,
  usuarioServicioId: string,
): Promise<EventoCorte[]> {
  const { data, error } = await supabase
    .from('cortes_reconexiones')
    .select('id, tipo, fecha, motivo, responsable, deuda_vencida_al_reconectar, factura_reconexion_id')
    .eq('usuario_servicio_id', usuarioServicioId)
    .order('fecha', { ascending: false });
  if (error) throw new Error(`No se pudo consultar el historial de cortes: ${error.message}`);
  return (data ?? []) as EventoCorte[];
}
