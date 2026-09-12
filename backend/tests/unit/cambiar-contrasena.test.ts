import { beforeEach, describe, expect, it, vi } from 'vitest';

let sesionActiva: { tipo: 'administrativa'; perfilId: string; email: string } | null = {
  tipo: 'administrativa',
  perfilId: 'perfil-1',
  email: 'admin@test.local',
};
let tokensSesion: { at: string; rt: string } | null = { at: 'token-de-prueba', rt: 'refresh-de-prueba' };
let passwordNueva = 'NuevaClaveSegura1';
let setSessionLlamadas: { access_token: string; refresh_token: string }[] = [];
let actualizarUsuarioLlamadas = 0;
let resultadoSetSession: { error: { message: string } | null } = { error: null };
let resultadoActualizacion: { error: { message: string } | null } = { error: null };
let resultadoCorreo: { ok: boolean; error?: string } = { ok: true };

vi.mock('../../src/lib/auth', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  verificarSesionAdministrativa: vi.fn(async () => sesionActiva),
  obtenerTokensSesion: vi.fn(() => tokensSesion),
}));

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // crearClienteAnon (no crearClienteSuscriptor): auth.updateUser() necesita
  // setSession() con ambos tokens, no solo el access_token como header — ver
  // el comentario real en backend/src/index.ts, POST /auth/cambiar-contrasena.
  crearClienteAnon: vi.fn(() => ({
    auth: {
      setSession: vi.fn(async (tokens: { access_token: string; refresh_token: string }) => {
        setSessionLlamadas.push(tokens);
        return resultadoSetSession;
      }),
      updateUser: vi.fn(async () => {
        actualizarUsuarioLlamadas += 1;
        return resultadoActualizacion;
      }),
    },
  })),
}));

vi.mock('../../src/lib/email', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  enviarCorreo: vi.fn(async () => resultadoCorreo),
}));

const app = (await import('../../src/index')).default;

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-no-usado',
  ALLOWED_ORIGIN: 'https://panel.undreocol.test',
  SESSION_SECRET: 'secreto',
};

async function cambiar(password: string): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/auth/cambiar-contrasena', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://panel.undreocol.test',
      },
      body: JSON.stringify({ passwordNueva: password }),
    }),
    env,
  );
}

beforeEach(() => {
  sesionActiva = {
    tipo: 'administrativa',
    perfilId: 'perfil-1',
    email: 'admin@test.local',
  };
  tokensSesion = { at: 'token-de-prueba', rt: 'refresh-de-prueba' };
  passwordNueva = 'NuevaClaveSegura1';
  setSessionLlamadas = [];
  actualizarUsuarioLlamadas = 0;
  resultadoSetSession = { error: null };
  resultadoActualizacion = { error: null };
  resultadoCorreo = { ok: true };
});

describe('POST /auth/cambiar-contrasena', () => {
  it('sin cookie de sesión -> 401', async () => {
    sesionActiva = null;

    const respuesta = await cambiar(passwordNueva);

    expect(respuesta.status).toBe(401);
    expect(actualizarUsuarioLlamadas).toBe(0);
  });

  it('contraseña corta -> 400 y no llama a setSession ni a updateUser', async () => {
    const respuesta = await cambiar('123456');

    expect(respuesta.status).toBe(400);
    expect(setSessionLlamadas).toHaveLength(0);
    expect(actualizarUsuarioLlamadas).toBe(0);
  });

  it('contraseña válida -> 200, valida la sesión con ambos tokens y llama a updateUser', async () => {
    const respuesta = await cambiar(passwordNueva);

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true });
    expect(setSessionLlamadas).toEqual([
      { access_token: 'token-de-prueba', refresh_token: 'refresh-de-prueba' },
    ]);
    expect(actualizarUsuarioLlamadas).toBe(1);
  });

  it('si setSession falla -> 401 y no llega a llamar a updateUser', async () => {
    resultadoSetSession = { error: { message: 'sesión inválida' } };

    const respuesta = await cambiar(passwordNueva);

    expect(respuesta.status).toBe(401);
    expect(actualizarUsuarioLlamadas).toBe(0);
  });

  it('si falla el correo, conserva la respuesta 200 después del cambio', async () => {
    resultadoCorreo = { ok: false, error: 'correo no configurado' };

    const respuesta = await cambiar(passwordNueva);

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true });
    expect(actualizarUsuarioLlamadas).toBe(1);
  });
});
