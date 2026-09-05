import { describe, expect, it } from 'vitest';
import { enviarCorreo, enviarFacturaPorCorreo } from '../../src/lib/email';

const inputBase = {
  destinatario: 'suscriptor-a1@test.local',
  remitente: 'no-responder@undreocol.app',
  asunto: 'Factura FAC-2026-00001',
  cuerpoHtml: '<p>Hola</p>',
  pdfBytes: new Uint8Array([37, 80, 68, 70, 45]), // %PDF-
  pdfNombre: 'FAC-2026-00001.pdf',
};

describe('enviarFacturaPorCorreo (D-9, regla 20)', () => {
  it('sin env.EMAIL (dev local) NO lanza: devuelve ok:false con el error', async () => {
    const env = {} as Pick<import('../../src/lib/db').Env, 'EMAIL'>;
    const r = await enviarFacturaPorCorreo(env, inputBase);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('EMAIL no está configurado');
  });

  it('si el binding lanza (p.ej. E_SENDER_NOT_VERIFIED) devuelve ok:false con el error, sin propagar', async () => {
    const errorConCodigo = Object.assign(new Error('Sender domain not verified'), { code: 'E_SENDER_NOT_VERIFIED' });
    const env = {
      EMAIL: {
        send: async () => {
          throw errorConCodigo;
        },
      },
    };
    const r = await enviarFacturaPorCorreo(env, inputBase);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Sender domain not verified');
  });

  it('con un binding que responde, devuelve ok:true con messageId', async () => {
    const env = {
      EMAIL: {
        send: async () => ({ messageId: 'abc-123' }),
      },
    };
    const r = await enviarFacturaPorCorreo(env, inputBase);
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('abc-123');
  });
});

// computarActualizacionNotificacion se movió a core/notificaciones.ts (010) —
// sus tests viven ahora en tests/unit/notificaciones.test.ts, sin modificarse.

interface MensajeEnviadoCapturado {
  attachments?: Array<{ filename: string; type: string }>;
}

describe('enviarCorreo (010, generalización sin adjunto obligatorio)', () => {
  it('sin adjunto (notificación sin PDF) envía igual y no incluye attachments', async () => {
    let mensajeEnviado: MensajeEnviadoCapturado | undefined;
    const env = {
      EMAIL: {
        send: async (m: unknown) => {
          mensajeEnviado = m as MensajeEnviadoCapturado;
          return { messageId: 'sin-adjunto-1' };
        },
      },
    };
    const r = await enviarCorreo(env, {
      destinatario: 'suscriptor-a1@test.local',
      remitente: 'no-responder@undreocol.app',
      asunto: 'Confirmación de pago',
      cuerpoHtml: '<p>Recibimos tu pago</p>',
    });
    expect(r.ok).toBe(true);
    expect(mensajeEnviado?.attachments).toBeUndefined();
  });

  it('enviarFacturaPorCorreo (006) sigue armando el adjunto vía enviarCorreo, sin cambiar su contrato', async () => {
    let mensajeEnviado: MensajeEnviadoCapturado | undefined;
    const env = {
      EMAIL: {
        send: async (m: unknown) => {
          mensajeEnviado = m as MensajeEnviadoCapturado;
          return { messageId: 'con-adjunto-1' };
        },
      },
    };
    await enviarFacturaPorCorreo(env, inputBase);
    const adjunto = mensajeEnviado?.attachments?.[0];
    expect(mensajeEnviado?.attachments).toHaveLength(1);
    expect(adjunto?.filename).toBe('FAC-2026-00001.pdf');
    expect(adjunto?.type).toBe('application/pdf');
  });
});
