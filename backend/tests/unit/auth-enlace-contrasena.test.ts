// enviarEnlaceDefinirContrasena — hallazgo real de producción (Sesión 057):
// el enlace del correo llevaba a localhost porque CI despliega sin
// `--env production` (usa el bloque [vars] de desarrollo de wrangler.toml,
// que trae localhost primero en ALLOWED_ORIGIN). Corregido para preferir el
// primer origen que no sea localhost.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let redirectToRecibido: string | undefined;

const clienteAnonFalso = {
  auth: {
    resetPasswordForEmail: (_email: string, opciones: { redirectTo: string }) => {
      redirectToRecibido = opciones.redirectTo;
      return Promise.resolve({ error: null });
    },
  },
};

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  crearClienteAnon: () => clienteAnonFalso,
}));

const { enviarEnlaceDefinirContrasena } = await import('../../src/lib/auth');

function env(allowedOrigin: string) {
  return {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    ALLOWED_ORIGIN: allowedOrigin,
    SESSION_SECRET: 'secreto',
  } as never;
}

beforeEach(() => {
  redirectToRecibido = undefined;
});

describe('enviarEnlaceDefinirContrasena', () => {
  it('ALLOWED_ORIGIN con localhost primero y el real después -> usa el real (bug de Sesión 057)', async () => {
    await enviarEnlaceDefinirContrasena(
      env('http://localhost:3000,https://undreocol-frontend.undreocol.workers.dev'),
      'admin@test.local',
    );
    expect(redirectToRecibido).toBe('https://undreocol-frontend.undreocol.workers.dev/restablecer-contrasena');
  });

  it('ALLOWED_ORIGIN solo con localhost (desarrollo local) -> lo usa igual, no hay otro', async () => {
    await enviarEnlaceDefinirContrasena(env('http://localhost:3000'), 'admin@test.local');
    expect(redirectToRecibido).toBe('http://localhost:3000/restablecer-contrasena');
  });

  it('ALLOWED_ORIGIN solo con el origen real -> lo usa', async () => {
    await enviarEnlaceDefinirContrasena(env('https://undreocol-frontend.undreocol.workers.dev'), 'admin@test.local');
    expect(redirectToRecibido).toBe('https://undreocol-frontend.undreocol.workers.dev/restablecer-contrasena');
  });
});
