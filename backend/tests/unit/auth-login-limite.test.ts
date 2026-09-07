// Cableado de POST /auth/login con el límite de intentos (017, T-004).
//
// El plan §8 daba esta comprobación por "no verificable aquí" porque no hay
// credenciales de Supabase para `wrangler dev`. Pero sí se puede ejercitar el
// `app.fetch` REAL con las dos dependencias sustituidas (el límite y GoTrue), y
// eso cubre justo lo que T-004 añade: el orden de las llamadas y los códigos
// 429 / 503 / 401 / 200.
//
// Lo que SIGUE sin verificarse aquí, y queda para Mateo: la secuencia real
// 401x5 + 429 contra GoTrue y PostgreSQL de verdad (tasks.md T-004).

import { beforeEach, describe, expect, it, vi } from 'vitest';

let estadoRespuesta: { bloqueado: boolean; reintentarEn?: string } = { bloqueado: false };
let estadoLanza: string | null = null;
let loginFalla = false;
let registrados: Array<{ email: string; exito: boolean }> = [];
let ordenLlamadas: string[] = [];

vi.mock('../../src/lib/auth-intentos', () => ({
  estadoLoginAdmin: vi.fn(async () => {
    ordenLlamadas.push('estado');
    if (estadoLanza) throw new Error(estadoLanza);
    return estadoRespuesta;
  }),
  registrarIntentoLoginAdmin: vi.fn(async (_env: unknown, email: string, exito: boolean) => {
    ordenLlamadas.push('registrar');
    registrados.push({ email, exito });
  }),
}));

vi.mock('../../src/lib/auth', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  iniciarSesion: vi.fn(async () => {
    ordenLlamadas.push('gotrue');
    if (loginFalla) throw new Error('Credenciales inválidas');
    return {
      sesion: { tipo: 'administrativa', perfilId: 'p1', email: 'admin@test.local' },
      accessToken: 'token-de-prueba',
    };
  }),
}));

// El cliente con JWT solo se usa tras un login correcto; devuelve perfil vacío.
vi.mock('../../src/lib/db', async (original) => {
  const constructor = () => {
    const api = {
      select: () => api,
      eq: () => api,
      maybeSingle: () => Promise.resolve({ data: { id: 'p1', nombre: 'Admin', email: 'admin@test.local' }, error: null }),
      then: (r: (v: { data: unknown; error: null }) => unknown) => r({ data: [], error: null }),
    };
    return api;
  };
  return {
    ...(await original<Record<string, unknown>>()),
    crearClienteAnon: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
    crearClienteSuscriptor: () => ({ from: () => constructor() }),
  };
});

const app = (await import('../../src/index')).default;

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGIN: 'https://panel.undreocol.test',
  SESSION_SECRET: 'secreto',
} as never;

async function login(email = 'admin@test.local', password = 'clave'): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test' },
      body: JSON.stringify({ email, password }),
    }),
    env,
  );
}

beforeEach(() => {
  estadoRespuesta = { bloqueado: false };
  estadoLanza = null;
  loginFalla = false;
  registrados = [];
  ordenLlamadas = [];
});

describe('POST /auth/login — límite de intentos (T-004)', () => {
  it('email bloqueado -> 429 con reintentar_en, y NO se llama a GoTrue', async () => {
    estadoRespuesta = { bloqueado: true, reintentarEn: '2026-09-07T11:00:00+00:00' };
    const r = await login();
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({
      error: 'Demasiados intentos. Intente más tarde.',
      reintentar_en: '2026-09-07T11:00:00+00:00',
    });
    // El caso caro es el más barato: corta antes de gastar la llamada a GoTrue
    expect(ordenLlamadas).toEqual(['estado']);
    expect(registrados).toEqual([]);
  });

  it('no se puede consultar el límite -> 503, y NO se intenta el login (falla cerrado)', async () => {
    estadoLanza = 'connection refused';
    const r = await login();
    expect(r.status).toBe(503);
    expect(ordenLlamadas).toEqual(['estado']);
  });

  it('credenciales malas -> 401 y se registra el intento como fallido', async () => {
    loginFalla = true;
    const r = await login();
    expect(r.status).toBe(401);
    expect(registrados).toEqual([{ email: 'admin@test.local', exito: false }]);
    expect(ordenLlamadas).toEqual(['estado', 'gotrue', 'registrar']);
  });

  it('credenciales buenas -> 200 y se registra el intento como acierto', async () => {
    const r = await login();
    expect(r.status).toBe(200);
    expect(registrados).toEqual([{ email: 'admin@test.local', exito: true }]);
    expect(ordenLlamadas).toEqual(['estado', 'gotrue', 'registrar']);
  });

  it('el email se normaliza antes de contarlo (mayúsculas y espacios)', async () => {
    loginFalla = true;
    await login('  ADMIN@Test.Local  ');
    expect(registrados).toEqual([{ email: 'admin@test.local', exito: false }]);
  });

  it('el 401 no revela si el email existe: mismo cuerpo para cualquier email (CA-4)', async () => {
    loginFalla = true;
    const r1 = await login('admin@test.local');
    const c1 = await r1.json();
    const r2 = await login('no-existe-jamas@test.local');
    const c2 = await r2.json();
    expect(r1.status).toBe(r2.status);
    expect(c1).toEqual(c2);
  });
});
