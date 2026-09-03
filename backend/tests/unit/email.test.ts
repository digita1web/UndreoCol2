import { describe, expect, it } from 'vitest';
import { computarActualizacionNotificacion, enviarFacturaPorCorreo } from '../../src/lib/email';

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

describe('computarActualizacionNotificacion (trazabilidad del fallo, spec §3.4)', () => {
  it('envío fallido: incrementa intentos y deja ultimo_error poblado (sigue pendiente para reintento)', () => {
    const r = computarActualizacionNotificacion({ ok: false, error: 'EMAIL no está configurado (dev)' }, 0);
    expect(r.intentos).toBe(1);
    expect(r.estado).toBe('pendiente');
    expect(r.ultimo_error).toContain('EMAIL no está configurado');
  });

  it('envío exitoso: estado enviada con intentos incrementado y enviada_en', () => {
    const r = computarActualizacionNotificacion({ ok: true }, 0);
    expect(r.intentos).toBe(1);
    expect(r.estado).toBe('enviada');
    expect(r.enviada_en).toBeTruthy();
    expect(r.ultimo_error).toBeUndefined();
  });

  it('tras agotar los reintentos (3) el estado pasa a fallida (el admin lo gestiona)', () => {
    const r = computarActualizacionNotificacion({ ok: false, error: 'E_RATE_LIMIT_EXCEEDED' }, 2);
    expect(r.intentos).toBe(3);
    expect(r.estado).toBe('fallida');
    expect(r.ultimo_error).toContain('E_RATE_LIMIT_EXCEEDED');
  });
});
