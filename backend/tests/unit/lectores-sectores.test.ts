// Cableado de GET /sectores, GET /lectores, POST/DELETE
// /lectores/:perfilId/sectores (037, T-001).
//
// Mismo método que plataforma-rutas.test.ts: se ejercita el `app.fetch` REAL
// con las dependencias sustituidas (sesión, lib/db para resolverClienteActivo
// y lib/lectores-sectores para la lógica), para cubrir 401/403/400/409/201
// sin necesitar Supabase real.
//
// Lo que SIGUE sin verificarse aquí, y queda para el test de aislamiento SQL
// (tests/aislamiento/905_...): el filtrado real por RLS/sector de
// usuarios_servicio_lector() y lecturas_lectura.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let sesionActiva: { tipo: 'administrativa'; perfilId: string; email: string } | null = {
  tipo: 'administrativa',
  perfilId: 'admin-1',
  email: 'admin@test.local',
};

// Fila que resolverClienteActivo() recibe de `.from('membresias').select(...)`
// — un array con la membresía activa del usuario en su único acueducto.
let filasMembresias: unknown[] = [
  { cliente_id: 'cliente-1', rol: 'admin_acueducto', clientes: { nombre: 'Acueducto de prueba' } },
];

let enviarInvitacionLanza: string | null = null;
let ultimoCorreoInvitado: string | null = null;

vi.mock('../../src/lib/auth', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  verificarSesionAdministrativa: vi.fn(async () => sesionActiva),
  obtenerAccessToken: vi.fn(() => 'token-de-prueba'),
  enviarEnlaceDefinirContrasena: vi.fn(async (_env: unknown, correo: string) => {
    ultimoCorreoInvitado = correo;
    if (enviarInvitacionLanza) throw new Error(enviarInvitacionLanza);
  }),
}));

let signUpLanza: string | null = null;
let ultimoSignUp: { email: string } | null = null;

vi.mock('../../src/lib/plataforma', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  signUpAdminAcueducto: vi.fn(async (_env: unknown, email: string) => {
    ultimoSignUp = { email };
    if (signUpLanza) throw new Error(signUpLanza);
    return { usuarioId: 'usuario-lector-nuevo' };
  }),
}));

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  crearClienteSuscriptor: () => ({
    from: (_tabla: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: filasMembresias, error: null }),
        }),
      }),
    }),
  }),
}));

let sectoresDisponiblesMock: string[] = ['Centro', 'Norte'];
let lectoresMock: Array<{ perfilId: string; nombre: string; email: string; sectores: string[] }> = [];
let asignarLanza: string | null = null;
let quitarLanza: string | null = null;
let ultimaAsignacion: { clienteId: string; perfilId: string; sector: string } | null = null;
let asignarLectorLanza: string | null = null;
let ultimoAsignarLector: { clienteId: string; usuarioId: string; nombre: string; email: string } | null = null;

vi.mock('../../src/lib/lectores-sectores', () => ({
  listarSectoresDisponibles: vi.fn(async () => sectoresDisponiblesMock),
  listarLectoresConSectores: vi.fn(async () => lectoresMock),
  asignarSector: vi.fn(async (_s: unknown, clienteId: string, perfilId: string, sector: string) => {
    ultimaAsignacion = { clienteId, perfilId, sector };
    if (asignarLanza) throw new Error(asignarLanza);
  }),
  quitarSector: vi.fn(async () => {
    if (quitarLanza) throw new Error(quitarLanza);
  }),
  asignarLectorAcueducto: vi.fn(
    async (_s: unknown, clienteId: string, usuarioId: string, nombre: string, email: string) => {
      ultimoAsignarLector = { clienteId, usuarioId, nombre, email };
      if (asignarLectorLanza) throw new Error(asignarLectorLanza);
    },
  ),
}));

const app = (await import('../../src/index')).default;

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGIN: 'https://panel.undreocol.test',
  SESSION_SECRET: 'secreto',
} as never;

async function peticion(ruta: string, opciones: RequestInit = {}): Promise<Response> {
  return await app.fetch(
    new Request(`https://api.undreocol.test${ruta}`, {
      ...opciones,
      headers: { 'Content-Type': 'application/json', Origin: 'https://panel.undreocol.test', ...opciones.headers },
    }),
    env,
  );
}

beforeEach(() => {
  sesionActiva = { tipo: 'administrativa', perfilId: 'admin-1', email: 'admin@test.local' };
  filasMembresias = [
    { cliente_id: 'cliente-1', rol: 'admin_acueducto', clientes: { nombre: 'Acueducto de prueba' } },
  ];
  sectoresDisponiblesMock = ['Centro', 'Norte'];
  lectoresMock = [];
  asignarLanza = null;
  quitarLanza = null;
  ultimaAsignacion = null;
  asignarLectorLanza = null;
  ultimoAsignarLector = null;
  signUpLanza = null;
  ultimoSignUp = null;
  enviarInvitacionLanza = null;
  ultimoCorreoInvitado = null;
});

describe('GET /sectores', () => {
  it('sin sesión -> 401', async () => {
    sesionActiva = null;
    const r = await peticion('/sectores');
    expect(r.status).toBe(401);
  });

  it('con sesión de cualquier rol del acueducto -> 200 con la lista', async () => {
    const r = await peticion('/sectores');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sectores: ['Centro', 'Norte'] });
  });

  it('rol lector también puede listar sectores (no exige admin_acueducto)', async () => {
    filasMembresias = [{ cliente_id: 'cliente-1', rol: 'lector', clientes: { nombre: 'Acueducto de prueba' } }];
    const r = await peticion('/sectores');
    expect(r.status).toBe(200);
  });
});

describe('GET /lectores', () => {
  it('sin sesión -> 401', async () => {
    sesionActiva = null;
    const r = await peticion('/lectores');
    expect(r.status).toBe(401);
  });

  it('rol lector -> 403', async () => {
    filasMembresias = [{ cliente_id: 'cliente-1', rol: 'lector', clientes: { nombre: 'Acueducto de prueba' } }];
    const r = await peticion('/lectores');
    expect(r.status).toBe(403);
  });

  it('rol secretaria -> 403', async () => {
    filasMembresias = [{ cliente_id: 'cliente-1', rol: 'secretaria', clientes: { nombre: 'Acueducto de prueba' } }];
    const r = await peticion('/lectores');
    expect(r.status).toBe(403);
  });

  it('admin_acueducto -> 200 con la lista de lectores y sus sectores', async () => {
    lectoresMock = [{ perfilId: 'lector-1', nombre: 'Juan Lector', email: 'juan@test.local', sectores: ['Centro'] }];
    const r = await peticion('/lectores');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ lectores: lectoresMock });
  });
});

describe('POST /lectores', () => {
  function crear(body: Record<string, unknown>) {
    return peticion('/lectores', { method: 'POST', body: JSON.stringify(body) });
  }

  it('sin sesión -> 401', async () => {
    sesionActiva = null;
    const r = await crear({ nombre: 'Juan', correo: 'juan@test.local' });
    expect(r.status).toBe(401);
  });

  it('rol lector -> 403, no llega a crear nada', async () => {
    filasMembresias = [{ cliente_id: 'cliente-1', rol: 'lector', clientes: { nombre: 'Acueducto de prueba' } }];
    const r = await crear({ nombre: 'Juan', correo: 'juan@test.local' });
    expect(r.status).toBe(403);
    expect(ultimoSignUp).toBeNull();
  });

  it('sin nombre o sin correo -> 400', async () => {
    expect((await crear({ correo: 'juan@test.local' })).status).toBe(400);
    expect((await crear({ nombre: 'Juan' })).status).toBe(400);
  });

  it('falla el signUp -> 400, no llega a vincular', async () => {
    signUpLanza = 'User already registered';
    const r = await crear({ nombre: 'Juan', correo: 'juan@test.local' });
    expect(r.status).toBe(400);
    expect(ultimoAsignarLector).toBeNull();
  });

  it('falla asignarLectorAcueducto -> 400', async () => {
    asignarLectorLanza = 'permission denied';
    const r = await crear({ nombre: 'Juan', correo: 'juan@test.local' });
    expect(r.status).toBe(400);
  });

  it('falla la asignación de un sector -> 207, pero el lector ya quedó creado', async () => {
    asignarLanza = 'algo salió mal';
    const r = await crear({ nombre: 'Juan', correo: 'juan@test.local', sectores: ['Centro'] });
    expect(r.status).toBe(207);
    expect(ultimoAsignarLector).toEqual({
      clienteId: 'cliente-1',
      usuarioId: 'usuario-lector-nuevo',
      nombre: 'Juan',
      email: 'juan@test.local',
    });
  });

  it('éxito completo, con sectores -> 201, invita por correo, asigna cada sector', async () => {
    const r = await crear({ nombre: 'Juan', correo: 'Juan@Test.Local', sectores: ['Centro', 'Norte'] });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ correo: 'juan@test.local', invitacionEnviada: true });
    expect(ultimoAsignarLector?.email).toBe('juan@test.local');
    expect(ultimaAsignacion).toEqual({ clienteId: 'cliente-1', perfilId: 'usuario-lector-nuevo', sector: 'Norte' });
    expect(ultimoCorreoInvitado).toBe('juan@test.local');
  });

  it('éxito sin sectores -> 201, no llama a asignarSector', async () => {
    const r = await crear({ nombre: 'Juan', correo: 'juan@test.local' });
    expect(r.status).toBe(201);
    expect(ultimaAsignacion).toBeNull();
  });

  it('falla el envío de la invitación -> 201 igual, invitacionEnviada: false', async () => {
    enviarInvitacionLanza = 'Email rate limit exceeded';
    const r = await crear({ nombre: 'Juan', correo: 'juan@test.local' });
    expect(r.status).toBe(201);
    const cuerpo = await r.json();
    expect(cuerpo.invitacionEnviada).toBe(false);
    expect(cuerpo.avisoCorreo).toMatch(/rate limit/);
  });
});

describe('POST /lectores/:perfilId/sectores', () => {
  it('sin sesión -> 401', async () => {
    sesionActiva = null;
    const r = await peticion('/lectores/lector-1/sectores', { method: 'POST', body: JSON.stringify({ sector: 'Centro' }) });
    expect(r.status).toBe(401);
  });

  it('rol lector -> 403, no llega a asignar', async () => {
    filasMembresias = [{ cliente_id: 'cliente-1', rol: 'lector', clientes: { nombre: 'Acueducto de prueba' } }];
    const r = await peticion('/lectores/lector-1/sectores', { method: 'POST', body: JSON.stringify({ sector: 'Centro' }) });
    expect(r.status).toBe(403);
    expect(ultimaAsignacion).toBeNull();
  });

  it('sin sector en el body -> 400', async () => {
    const r = await peticion('/lectores/lector-1/sectores', { method: 'POST', body: JSON.stringify({}) });
    expect(r.status).toBe(400);
  });

  it('sector ya asignado (violación de unique) -> 409', async () => {
    asignarLanza = 'Ese sector ya está asignado a este lector';
    const r = await peticion('/lectores/lector-1/sectores', { method: 'POST', body: JSON.stringify({ sector: 'Centro' }) });
    expect(r.status).toBe(409);
  });

  it('admin_acueducto, sector válido -> 201, llama a asignarSector con los datos correctos', async () => {
    const r = await peticion('/lectores/lector-1/sectores', { method: 'POST', body: JSON.stringify({ sector: 'Centro' }) });
    expect(r.status).toBe(201);
    expect(ultimaAsignacion).toEqual({ clienteId: 'cliente-1', perfilId: 'lector-1', sector: 'Centro' });
  });
});

describe('DELETE /lectores/:perfilId/sectores/:sector', () => {
  it('sin sesión -> 401', async () => {
    sesionActiva = null;
    const r = await peticion('/lectores/lector-1/sectores/Centro', { method: 'DELETE' });
    expect(r.status).toBe(401);
  });

  it('rol lector -> 403', async () => {
    filasMembresias = [{ cliente_id: 'cliente-1', rol: 'lector', clientes: { nombre: 'Acueducto de prueba' } }];
    const r = await peticion('/lectores/lector-1/sectores/Centro', { method: 'DELETE' });
    expect(r.status).toBe(403);
  });

  it('admin_acueducto -> 200', async () => {
    const r = await peticion('/lectores/lector-1/sectores/Centro', { method: 'DELETE' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('quitarSector lanza -> 400', async () => {
    quitarLanza = 'algo salió mal';
    const r = await peticion('/lectores/lector-1/sectores/Centro', { method: 'DELETE' });
    expect(r.status).toBe(400);
  });
});
