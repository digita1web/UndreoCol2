// Capa fina del límite de intentos del login administrativo (017, T-003).
// Se sustituye el cliente de Supabase por uno falso para comprobar el CONTRATO
// que la ruta necesita, sobre todo la política de fallo del plan §5.4:
//   estadoLoginAdmin        -> LANZA si algo va mal   (la ruta responde 503)
//   registrarIntentoLoginAdmin -> NUNCA lanza          (el login no cambia)
//
// La lógica del retardo progresivo no se prueba aquí: vive en SQL y la cubre
// tests/aislamiento/901 contra PostgreSQL real (plan §5.1).

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Respuesta que devolverá la RPC falsa en la siguiente llamada.
let respuestaRpc: { data: unknown; error: { message: string } | null } = { data: null, error: null };
// Registro de las llamadas, para comprobar los argumentos que se envían.
let llamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];
// Si es true, la RPC falsa lanza en vez de devolver `{ error }`.
let rpcLanza = false;

const supabaseFalso = {
  rpc: (fn: string, args: Record<string, unknown>) => {
    llamadas.push({ fn, args });
    if (rpcLanza) throw new Error('la red se cayó');
    return Promise.resolve(respuestaRpc);
  },
};

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  crearClienteAnon: () => supabaseFalso,
}));

const { estadoLoginAdmin, registrarIntentoLoginAdmin } = await import('../../src/lib/auth-intentos');

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'secreto',
} as never;

beforeEach(() => {
  respuestaRpc = { data: null, error: null };
  llamadas = [];
  rpcLanza = false;
  vi.restoreAllMocks();
});

describe('estadoLoginAdmin — traducción de la respuesta', () => {
  it('estado ok -> no bloqueado', async () => {
    respuestaRpc = { data: { estado: 'ok' }, error: null };
    await expect(estadoLoginAdmin(env, 'admin@test.local')).resolves.toEqual({ bloqueado: false });
  });

  it('estado bloqueado -> bloqueado con reintentarEn', async () => {
    respuestaRpc = {
      data: { estado: 'bloqueado', reintentar_en: '2026-09-07T11:00:00+00:00' },
      error: null,
    };
    await expect(estadoLoginAdmin(env, 'admin@test.local')).resolves.toEqual({
      bloqueado: true,
      reintentarEn: '2026-09-07T11:00:00+00:00',
    });
  });

  it('envía el email tal cual a la RPC, con el nombre de parámetro correcto', async () => {
    respuestaRpc = { data: { estado: 'ok' }, error: null };
    await estadoLoginAdmin(env, 'admin@test.local');
    expect(llamadas).toEqual([{ fn: 'admin_login_estado', args: { p_email: 'admin@test.local' } }]);
  });
});

describe('estadoLoginAdmin — FALLA CERRADO (plan §5.4)', () => {
  it('error de la RPC -> LANZA (la ruta responde 503, no intenta el login)', async () => {
    respuestaRpc = { data: null, error: { message: 'connection refused' } };
    await expect(estadoLoginAdmin(env, 'admin@test.local')).rejects.toThrow(/connection refused/);
  });

  it('la RPC lanza -> el error se propaga, no se traga', async () => {
    rpcLanza = true;
    await expect(estadoLoginAdmin(env, 'admin@test.local')).rejects.toThrow(/la red se cayó/);
  });

  it('respuesta con estado desconocido -> LANZA, no se asume "no bloqueado"', async () => {
    respuestaRpc = { data: { estado: 'vete-a-saber' }, error: null };
    await expect(estadoLoginAdmin(env, 'admin@test.local')).rejects.toThrow(/Respuesta inesperada/);
  });

  it('respuesta vacía -> LANZA', async () => {
    respuestaRpc = { data: null, error: null };
    await expect(estadoLoginAdmin(env, 'admin@test.local')).rejects.toThrow(/Respuesta inesperada/);
  });
});

describe('registrarIntentoLoginAdmin — FALLA ABIERTO (plan §5.4)', () => {
  it('envía email y resultado con los nombres de parámetro correctos', async () => {
    respuestaRpc = { data: null, error: null };
    await registrarIntentoLoginAdmin(env, 'admin@test.local', false);
    expect(llamadas).toEqual([
      { fn: 'admin_login_registrar', args: { p_email: 'admin@test.local', p_exito: false } },
    ]);
  });

  it('un acierto se registra como p_exito true', async () => {
    await registrarIntentoLoginAdmin(env, 'admin@test.local', true);
    expect(llamadas[0]?.args.p_exito).toBe(true);
  });

  it('error de la RPC -> NO lanza (un login correcto no puede fallar por esto)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respuestaRpc = { data: null, error: { message: 'connection refused' } };
    await expect(registrarIntentoLoginAdmin(env, 'admin@test.local', true)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled(); // el fallo queda trazado, no silenciado
  });

  it('la RPC lanza -> NO lanza hacia fuera, pero lo registra', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rpcLanza = true;
    await expect(registrarIntentoLoginAdmin(env, 'admin@test.local', false)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });
});
