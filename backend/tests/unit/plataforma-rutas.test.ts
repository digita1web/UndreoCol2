// Cableado de GET /plataforma, POST /plataforma/acueductos y el campo
// esAdminPlataforma de GET /dashboard (018, T-005).
//
// Mismo método que auth-login-limite.test.ts (017 T-004): se ejercita el
// `app.fetch` REAL con las dependencias sustituidas (sesión, Supabase y
// lib/plataforma), para cubrir el orden de los 3 pasos del alta y los
// códigos 401/403/201/400/500 sin necesitar Supabase real.
//
// Lo que SIGUE sin verificarse aquí, y queda para Mateo: la secuencia HTTP
// real contra un Worker desplegado + Supabase real (tasks.md T-005).

import { beforeEach, describe, expect, it, vi } from 'vitest';

let sesionActiva: { tipo: 'administrativa'; perfilId: string; email: string } | null = {
  tipo: 'administrativa',
  perfilId: 'superadmin-1',
  email: 'superadmin@test.local',
};
// Respuesta cruda que devuelve cualquier `.from('membresias')...`: cada test
// pone la forma que necesita (objeto único para requerirAdminPlataforma,
// arreglo para resolverClienteActivo de GET /dashboard).
let respuestaMembresias: { data: unknown; error: unknown } = {
  data: { rol: 'administrador' },
  error: null,
};
let respuestaClientes: { data: unknown; error: unknown } = { data: [], error: null };

vi.mock('../../src/lib/auth', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  verificarSesionAdministrativa: vi.fn(async () => sesionActiva),
  obtenerAccessToken: vi.fn(() => 'token-de-prueba'),
}));

vi.mock('../../src/lib/db', async (original) => {
  const construirApi = (respuesta: { data: unknown; error: unknown }) => {
    const api = {
      select: () => api,
      eq: () => api,
      is: () => api,
      order: () => api,
      maybeSingle: () => Promise.resolve(respuesta),
      then: (r: (v: unknown) => unknown) => r(respuesta),
    };
    return api;
  };
  return {
    ...(await original<Record<string, unknown>>()),
    crearClienteSuscriptor: () => ({
      from: (tabla: string) =>
        construirApi(tabla === 'clientes' ? respuestaClientes : respuestaMembresias),
    }),
  };
});

let ordenLlamadas: string[] = [];
let crearAcueductoBaseLanza: string | null = null;
let signUpLanza: string | null = null;
let asignarLanza: string | null = null;

vi.mock('../../src/lib/plataforma', () => ({
  generarContrasenaTemporal: vi.fn(() => 'Clave-Temporal-Fija1'),
  crearAcueductoBase: vi.fn(async (_s: unknown, nombre: string, slug: string) => {
    ordenLlamadas.push('crearAcueductoBase');
    if (crearAcueductoBaseLanza) throw new Error(crearAcueductoBaseLanza);
    return { clienteId: `cliente-de-${slug}` };
  }),
  signUpAdminAcueducto: vi.fn(async (_env: unknown, correo: string) => {
    ordenLlamadas.push('signUp');
    if (signUpLanza) throw new Error(signUpLanza);
    return { usuarioId: `usuario-de-${correo}` };
  }),
  asignarAdminAcueducto: vi.fn(async () => {
    ordenLlamadas.push('asignar');
    if (asignarLanza) throw new Error(asignarLanza);
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

async function alta(body: Record<string, unknown>): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/plataforma/acueductos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test' },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function listar(): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/plataforma', {
      headers: { Origin: 'https://panel.undreocol.test' },
    }),
    env,
  );
}

async function dashboard(): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/dashboard', {
      headers: { Origin: 'https://panel.undreocol.test' },
    }),
    env,
  );
}

const cuerpoValido = {
  nombre: 'Acueducto Nuevo',
  slug: 'acueducto-nuevo',
  nombreAdmin: 'Admin Nuevo',
  correoAdmin: 'admin-nuevo@test.local',
};

beforeEach(() => {
  sesionActiva = { tipo: 'administrativa', perfilId: 'superadmin-1', email: 'superadmin@test.local' };
  respuestaMembresias = { data: { rol: 'administrador' }, error: null };
  respuestaClientes = { data: [], error: null };
  ordenLlamadas = [];
  crearAcueductoBaseLanza = null;
  signUpLanza = null;
  asignarLanza = null;
});

describe('requerirAdminPlataforma — autorización', () => {
  it('sin sesión -> 401', async () => {
    sesionActiva = null;
    const r = await listar();
    expect(r.status).toBe(401);
  });

  it('sesión sin membresía de plataforma -> 403', async () => {
    respuestaMembresias = { data: null, error: null };
    const r = await listar();
    expect(r.status).toBe(403);
  });

  it('POST /plataforma/acueductos también exige la membresía de plataforma -> 403', async () => {
    respuestaMembresias = { data: null, error: null };
    const r = await alta(cuerpoValido);
    expect(r.status).toBe(403);
    expect(ordenLlamadas).toEqual([]); // no llegó a tocar nada
  });
});

describe('GET /plataforma', () => {
  it('con sesión de plataforma -> 200 con la lista', async () => {
    respuestaClientes = {
      data: [{ id: 'c1', nombre: 'Acueducto A', slug: 'acueducto-a', fecha_alta: '2026-09-01' }],
      error: null,
    };
    const r = await listar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      acueductos: [{ id: 'c1', nombre: 'Acueducto A', slug: 'acueducto-a', fecha_alta: '2026-09-01' }],
    });
  });
});

describe('POST /plataforma/acueductos — validación de body', () => {
  it('campos faltantes -> 400, no llama a nada', async () => {
    const r = await alta({ nombre: 'X' });
    expect(r.status).toBe(400);
    expect(ordenLlamadas).toEqual([]);
  });

  it('slug con mayúsculas o espacios -> 400', async () => {
    const r = await alta({ ...cuerpoValido, slug: 'Acueducto Nuevo' });
    expect(r.status).toBe(400);
    expect(ordenLlamadas).toEqual([]);
  });
});

describe('POST /plataforma/acueductos — orden de los 3 pasos (plan §3, §5.1)', () => {
  it('alta completa -> 201 con clienteId/slug/correoAdmin/contrasenaTemporal', async () => {
    const r = await alta(cuerpoValido);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      clienteId: 'cliente-de-acueducto-nuevo',
      slug: 'acueducto-nuevo',
      correoAdmin: 'admin-nuevo@test.local',
      contrasenaTemporal: 'Clave-Temporal-Fija1',
    });
    expect(ordenLlamadas).toEqual(['crearAcueductoBase', 'signUp', 'asignar']);
  });

  it('slug duplicado (paso 1 falla) -> 400, NO se llega a signUp ni a asignar', async () => {
    crearAcueductoBaseLanza = 'El slug ya está en uso';
    const r = await alta(cuerpoValido);
    expect(r.status).toBe(400);
    expect((await r.json()) as { error: string }).toEqual({ error: 'El slug ya está en uso' });
    expect(ordenLlamadas).toEqual(['crearAcueductoBase']);
  });

  it('signUp falla (paso 2) -> 500 con el aviso de "sin administrador" y el clienteId', async () => {
    signUpLanza = 'User already registered';
    const r = await alta(cuerpoValido);
    expect(r.status).toBe(500);
    const cuerpo = (await r.json()) as { error: string; clienteId: string };
    expect(cuerpo.clienteId).toBe('cliente-de-acueducto-nuevo');
    expect(cuerpo.error).toMatch(/sin administrador/);
    expect(cuerpo.error).toMatch(/User already registered/);
    expect(ordenLlamadas).toEqual(['crearAcueductoBase', 'signUp']); // no llega a "asignar"
  });

  it('asignar falla (paso 3) -> 500 con "corrección manual", clienteId y usuarioId', async () => {
    asignarLanza = 'foreign key violation';
    const r = await alta(cuerpoValido);
    expect(r.status).toBe(500);
    const cuerpo = (await r.json()) as { error: string; clienteId: string; usuarioId: string };
    expect(cuerpo.clienteId).toBe('cliente-de-acueducto-nuevo');
    expect(cuerpo.usuarioId).toBe('usuario-de-admin-nuevo@test.local');
    expect(cuerpo.error).toMatch(/corrección manual/);
    expect(ordenLlamadas).toEqual(['crearAcueductoBase', 'signUp', 'asignar']);
  });
});

describe('GET /dashboard — esAdminPlataforma (018 T-004/T-005)', () => {
  it('con solo la membresía administrador -> 400 con esAdminPlataforma true', async () => {
    respuestaMembresias = {
      data: [{ cliente_id: null, rol: 'administrador', clientes: null }],
      error: null,
    };
    const r = await dashboard();
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Sin acueducto', clientes: [], esAdminPlataforma: true });
  });

  it('sin ninguna membresía -> 400 con esAdminPlataforma false (sigue yendo a /onboarding)', async () => {
    respuestaMembresias = { data: [], error: null };
    const r = await dashboard();
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Sin acueducto', clientes: [], esAdminPlataforma: false });
  });
});
