// Regresión de POST /auth/recuperar tras extraer el envío compartido (019).

import { beforeEach, describe, expect, it, vi } from 'vitest';

let enviarLanza: string | null = null;
let correoRecibido: string | null = null;

vi.mock('../../src/lib/auth', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enviarEnlaceDefinirContrasena: vi.fn(async (_env: unknown, email: string) => {
    correoRecibido = email;
    if (enviarLanza) throw new Error(enviarLanza);
  }),
}));

const app = (await import('../../src/index')).default;

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGIN: 'https://panel.undreocol.test',
  SESSION_SECRET: 'secreto',
} as never;

async function recuperar(body: Record<string, unknown>): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/auth/recuperar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

beforeEach(() => {
  enviarLanza = null;
  correoRecibido = null;
});

describe('POST /auth/recuperar', () => {
  it('sin email -> 400, no llama a enviarEnlaceDefinirContrasena', async () => {
    const respuesta = await recuperar({});

    expect(respuesta.status).toBe(400);
    expect(correoRecibido).toBeNull();
  });

  it('email válido -> 200 { ok: true }, con email normalizado', async () => {
    const respuesta = await recuperar({ email: 'Admin@Test.Local' });

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true });
    expect(correoRecibido).toBe('admin@test.local');
  });

  it('si falla el envío -> 400 con el mensaje real', async () => {
    enviarLanza = 'Email rate limit exceeded';

    const respuesta = await recuperar({ email: 'admin@test.local' });

    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ error: 'Email rate limit exceeded' });
  });
});