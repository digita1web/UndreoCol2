import { describe, expect, it } from 'vitest';
import { enviarFacturaPorCorreo } from '../../src/lib/email';

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
