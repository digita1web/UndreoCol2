// Capa fina de notificaciones generales (010): inserta la fila en
// `notificaciones` y encola el envío. Sin lógica de negocio propia — el
// contenido (asunto/cuerpoHtml) ya viene armado por quien llama
// (core/notificaciones.ts), y el destinatario ya viene resuelto.
// Referencia: specs/010-notificaciones/plan.md §4.
//
// "Sin email no rompe nada" (spec §3.4/§3.5, mismo criterio que 006): si el
// suscriptor no tiene email, no se crea ninguna fila ni se encola nada — la
// acción de negocio que disparó la notificación (pago/corte/reconexión/cron)
// queda confirmada igual.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MensajeFacturaCierre } from './db';
import type { ContenidoNotificacion, TipoNotificacionNueva } from '../core/notificaciones';

export interface EncolarNotificacionInput {
  clienteId: string;
  usuarioServicioId: string;
  tipo: TipoNotificacionNueva;
  destinatarioEmail: string | null;
  contenido: ContenidoNotificacion;
  // Solo para 'recordatorio_vencimiento'/'aviso_mora' (010): el cron la usa
  // para la idempotencia por (factura_id, tipo) — spec §3.5. Sin esto, dos
  // corridas del cron no podrían distinguir una notificación ya enviada.
  facturaId?: string;
}

export interface ResultadoEncolarNotificacion {
  encolado: boolean;
  notificacionId?: string;
}

export async function encolarNotificacion(
  supabase: SupabaseClient,
  cola: Queue<MensajeFacturaCierre> | undefined,
  input: EncolarNotificacionInput,
): Promise<ResultadoEncolarNotificacion> {
  if (!input.destinatarioEmail) {
    return { encolado: false };
  }

  const { data, error } = await supabase
    .from('notificaciones')
    .insert({
      cliente_id: input.clienteId,
      usuario_servicio_id: input.usuarioServicioId,
      factura_id: input.facturaId ?? null,
      tipo: input.tipo,
      canal: 'email',
      destinatario: input.destinatarioEmail,
      asunto: input.contenido.asunto,
      estado: 'pendiente',
      intentos: 0,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('encolarNotificacion: no se pudo registrar la notificación', error?.message);
    return { encolado: false };
  }

  if (!cola) {
    console.error('encolarNotificacion: la cola de facturación no está configurada');
    return { encolado: false, notificacionId: data.id };
  }

  await cola.send({
    tipo: 'enviar_notificacion',
    clienteId: input.clienteId,
    notificacionId: data.id,
    destinatario: input.destinatarioEmail,
    asunto: input.contenido.asunto,
    cuerpoHtml: input.contenido.cuerpoHtml,
  });

  return { encolado: true, notificacionId: data.id };
}
