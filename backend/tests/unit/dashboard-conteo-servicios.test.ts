// GET /dashboard — cobertura del campo conteoServicios (046, checklist de
// onboarding). La ruta no tenía ningún test dedicado todavía (hallazgo
// aparte, no se backfillea acá completo — solo lo que toca este cambio):
// se cubre el contrato real vía app.fetch, con Supabase sustituido.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let sesionActiva: { tipo: 'administrativa'; perfilId: string; email: string } | null = {
  tipo: 'administrativa',
  perfilId: 'admin-1',
  email: 'admin@test.local',
};

let filasMembresias: unknown[] = [
  { cliente_id: 'cliente-1', rol: 'admin_acueducto', clientes: { nombre: 'Acueducto de prueba' } },
];
let conteoServiciosMock = 0;

vi.mock('../../src/lib/auth', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  verificarSesionAdministrativa: vi.fn(async () => sesionActiva),
  obtenerAccessToken: vi.fn(() => 'token-de-prueba'),
}));

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  crearClienteSuscriptor: () => ({
    from: (tabla: string) => {
      if (tabla === 'membresias') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: filasMembresias, error: null }) }) }) };
      }
      if (tabla === 'perfiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { nombre: 'Admin de Prueba' }, error: null }) }) }) };
      }
      if (tabla === 'servicios') {
        return { select: () => ({ eq: () => Promise.resolve({ count: conteoServiciosMock, error: null }) }) };
      }
      throw new Error(`tabla no mockeada en este test: ${tabla}`);
    },
    rpc: (fn: string) => {
      if (fn === 'usuarios_servicio_lector') return Promise.resolve({ data: [{ id: 'u1' }, { id: 'u2' }], error: null });
      if (fn === 'mis_sectores_asignados') return Promise.resolve({ data: [], error: null });
      throw new Error(`rpc no mockeada en este test: ${fn}`);
    },
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

async function pedirDashboard(): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/dashboard', {
      headers: { Origin: 'https://panel.undreocol.test' },
    }),
    env,
  );
}

beforeEach(() => {
  sesionActiva = { tipo: 'administrativa', perfilId: 'admin-1', email: 'admin@test.local' };
  filasMembresias = [{ cliente_id: 'cliente-1', rol: 'admin_acueducto', clientes: { nombre: 'Acueducto de prueba' } }];
  conteoServiciosMock = 0;
});

describe('GET /dashboard — conteoServicios', () => {
  it('acueducto sin servicios -> conteoServicios: 0', async () => {
    conteoServiciosMock = 0;
    const r = await pedirDashboard();
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as { conteoServicios: number };
    expect(cuerpo.conteoServicios).toBe(0);
  });

  it('acueducto con servicios cargados -> conteoServicios refleja el conteo real', async () => {
    conteoServiciosMock = 3;
    const r = await pedirDashboard();
    const cuerpo = (await r.json()) as { conteoServicios: number };
    expect(cuerpo.conteoServicios).toBe(3);
  });

  it('conteoUsuariosServicio sigue funcionando igual (regresión)', async () => {
    const r = await pedirDashboard();
    const cuerpo = (await r.json()) as { conteoUsuariosServicio: number };
    expect(cuerpo.conteoUsuariosServicio).toBe(2);
  });
});
