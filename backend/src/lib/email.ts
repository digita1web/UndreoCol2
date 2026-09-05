// Envío del correo de la factura con PDF adjunto (Cloudflare Email Workers,
// D-9). La API fue confirmada con la documentación oficial de Cloudflare:
// binding [[ send_email ]], método env.EMAIL.send(message) con el builder
// estructurado { to, from, subject, html?, text?, attachments: [{ content:
// ArrayBuffer, filename, type }] }; los errores se lanzan con `code`.
//
// Regla 20 (CLAUDE.md §10): un fallo de envío NUNCA bloquea el flujo principal.
// En desarrollo local `env.EMAIL` NO existe (los adjuntos binarios no se pueden
// simular en wrangler dev): esta capa devuelve { ok:false } sin lanzar, para que
// el flujo completo (cola → notificaciones → intentos/ultimo_error) se pruebe en
// local y el error quede trazable para el reintento (spec 006 §3.4, T-003).
// El envío real requiere la cuenta de Mateo (Workers Paid + dominio verificado).
//
// computarActualizacionNotificacion()/MAX_INTENTOS_ENVIO se mudaron a
// core/notificaciones.ts (010, plan.md §5): son lógica pura sin dependencias
// de Hono/Cloudflare/Supabase, y ahora las usan los 6 tipos de notificación,
// no solo el correo de factura.

import type { Env } from './db';

export interface ResultadoEnvio {
  ok: boolean;
  error?: string;
  messageId?: string;
}

interface Attachment {
  content: ArrayBuffer;
  filename: string;
  type: string;
}

// Tipos mínimos del binding send_email (la interfaz pública de workers-types no
// expone el nuevo builder en todas las versiones; la doc oficial sí).
interface MensajeEmail {
  to: string;
  from: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Attachment[];
}
type BindingEmail = { send: (m: MensajeEmail) => Promise<{ messageId: string }> };

// Envío genérico (010): adjunto opcional — antes solo existía para la factura
// con PDF obligatorio. Las 5 notificaciones nuevas de 010 no llevan adjunto.
export interface EnviarCorreoInput {
  destinatario: string;
  remitente: string;
  asunto: string;
  cuerpoHtml: string;
  adjunto?: Attachment;
}

export async function enviarCorreo(env: Pick<Env, 'EMAIL'>, input: EnviarCorreoInput): Promise<ResultadoEnvio> {
  const binding = env.EMAIL as unknown as BindingEmail | undefined;
  if (!binding || typeof binding.send !== 'function') {
    // Dev local (sin Workers Paid/dominio): NO se lanza (regla 20); el error
    // queda registrado en notificaciones para que el reintento lo intente.
    return { ok: false, error: 'env.EMAIL no está configurado (requiere Workers Paid + dominio verificado)' };
  }

  const mensaje: MensajeEmail = {
    to: input.destinatario,
    from: input.remitente,
    subject: input.asunto,
    html: input.cuerpoHtml,
    attachments: input.adjunto ? [input.adjunto] : undefined,
  };

  try {
    const resultado = await binding.send(mensaje);
    return { ok: true, messageId: resultado?.messageId };
  } catch (e) {
    // Los errores de Cloudflare llevan `code` (E_SENDER_NOT_VERIFIED, etc.).
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error };
  }
}

// Envoltorio delgado sobre enviarCorreo() — misma firma pública que 006 usa
// desde siempre (queues/cierre-facturacion.ts). Ningún llamador de 006 cambia
// una línea (plan.md §5, decisión técnica: menor riesgo de regresión).
export async function enviarFacturaPorCorreo(
  env: Pick<Env, 'EMAIL'>,
  input: {
    destinatario: string;
    remitente: string;
    asunto: string;
    cuerpoHtml: string;
    pdfBytes: Uint8Array;
    pdfNombre: string;
  },
): Promise<ResultadoEnvio> {
  const adjunto: Attachment = {
    content: input.pdfBytes.buffer.slice(
      input.pdfBytes.byteOffset,
      input.pdfBytes.byteOffset + input.pdfBytes.byteLength,
    ) as ArrayBuffer,
    filename: input.pdfNombre,
    type: 'application/pdf',
  };
  return enviarCorreo(env, {
    destinatario: input.destinatario,
    remitente: input.remitente,
    asunto: input.asunto,
    cuerpoHtml: input.cuerpoHtml,
    adjunto,
  });
}
