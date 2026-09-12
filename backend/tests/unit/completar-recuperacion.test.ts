import { beforeEach, describe, expect, it, vi } from 'vitest';

let resultadoSetSession: { error: { message: string } | null } = { error: null };
let resultadoActualizacion: { error: { message: string } | null } = { error: null };
let resultadoSesion = {
  data: {
    session: {
      access_token: 'access-token-nuevo',
      refresh_token: 'refresh-token-nuevo',
      expires_at: 1893456000,
      user: { id: 'perfil-1', email: 'admin@test.local' },
    },
  },
  error: null,
};
let setSessionLlamadas: Array<{ access_token: string; refresh_token: string }> = [];
let actualizarUsuarioLlamadas = 0;
let consultasPerfil = false;
let consultasMembresias = false;

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
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
      getSession: vi.fn(async () => resultadoSesion),
    },
  })),
  crearClienteSuscriptor: vi.fn(() => {
    const construirConsulta = (tipo: 'perfil' | 'membresias') => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        maybeSingle: async () => {
          if (tipo === 'perfil') consultasPerfil = true;
          return { data: tipo === 'perfil' ? { id: 'perfil-1', nombre: 'Admin', email: 'admin@test.local' } : null, error: null };
        },
        then: (resolver: (valor: { data: unknown[]; error: null }) => unknown) => {
          if (tipo === 'membresias') consultasMembresias = true;
          return resolver({ data: [{ id: 'm1', cliente_id: 'c1', rol: 'admin_acueducto' }], error: null });
        },
      };
      return consulta;
    };
    return {
      from: (tabla: string) => construirConsulta(tabla === 'perfiles' ? 'perfil' : 'membresias'),
    };
  }),
}));

const app = (await import('../../src/index')).default;

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-no-usado',
  ALLOWED_ORIGIN: 'https://panel.undreocol.test',
  SESSION_SECRET: 'secreto',
};

async function completar(passwordNueva: string): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/auth/completar-recuperacion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://panel.undreocol.test',
      },
      body: JSON.stringify({
        accessToken: 'access-token-recuperacion',
        refreshToken: 'refresh-token-recuperacion',
        passwordNueva,
      }),
    }),
    env,
  );
}

beforeEach(() => {
  resultadoSetSession = { error: null };
  resultadoActualizacion = { error: null };
  resultadoSesion = {
    data: {
      session: {
        access_token: 'access-token-nuevo',
        refresh_token: 'refresh-token-nuevo',
        expires_at: 1893456000,
        user: { id: 'perfil-1', email: 'admin@test.local' },
      },
    },
    error: null,
  };
  setSessionLlamadas = [];
  actualizarUsuarioLlamadas = 0;
  consultasPerfil = false;
  consultasMembresias = false;
});

describe('POST /auth/completar-recuperacion', () => {
  it('setSession devuelve error -> 401 y no llama a updateUser', async () => {
    resultadoSetSession = { error: { message: 'token inválido' } };

    const respuesta = await completar('NuevaClaveSegura1');

    expect(respuesta.status).toBe(401);
    expect(actualizarUsuarioLlamadas).toBe(0);
  });

  it('contraseña corta -> 400 sin llamar a Supabase Auth', async () => {
    const respuesta = await completar('123456');

    expect(respuesta.status).toBe(400);
    expect(setSessionLlamadas).toHaveLength(0);
    expect(actualizarUsuarioLlamadas).toBe(0);
  });

  it('flujo válido -> 200, sesión completa y cookie administrativa', async () => {
    const respuesta = await completar('NuevaClaveSegura1');
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(cuerpo).toEqual({
      sesion: {
        tipo: 'administrativa',
        perfilId: 'perfil-1',
        email: 'admin@test.local',
      },
      perfil: { id: 'perfil-1', nombre: 'Admin', email: 'admin@test.local' },
      membresias: [{ id: 'm1', cliente_id: 'c1', rol: 'admin_acueducto' }],
    });
    expect(setSessionLlamadas).toEqual([
      { access_token: 'access-token-recuperacion', refresh_token: 'refresh-token-recuperacion' },
    ]);
    expect(actualizarUsuarioLlamadas).toBe(1);
    expect(consultasPerfil).toBe(true);
    expect(consultasMembresias).toBe(true);
    expect(respuesta.headers.get('set-cookie')).toContain('uc_sesion_admin=');
  });
});