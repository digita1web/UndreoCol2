// Worker de limpieza (017, T-005). Comprueba el CABLEADO: que llama a la RPC de
// purga con la retención correcta y que un fallo NO pasa desapercibido.
//
// El predicado de borrado no se prueba aquí —vive en la función SQL
// purgar_intentos_login() y lo cubre tests/aislamiento/901 paso 11 contra
// PostgreSQL real con filas de verdad—, precisamente para no acabar probando una
// copia del predicado en vez del que se ejecuta.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let keepalive: { data: unknown; error: { message: string } | null } = {
  data: { ultimo_ping: '2026-09-07T00:00:00Z' },
  error: null,
};
let purga: { data: unknown; error: { message: string } | null } = {
  data: { admin_intentos_login: 3, portal_intentos_login: 1 },
  error: null,
};
let rpcLlamadas: Array<{ fn: string; args: Record<string, unknown> }> = [];

const supabaseFalso = {
  from: () => {
    const api = {
      select: () => api,
      eq: () => api,
      maybeSingle: () => Promise.resolve(keepalive),
    };
    return api;
  },
  rpc: (fn: string, args: Record<string, unknown>) => {
    rpcLlamadas.push({ fn, args });
    return Promise.resolve(purga);
  },
};

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  crearClienteServicio: () => supabaseFalso,
}));

const limpieza = (await import('../../src/cron/limpieza')).default;
const { DIAS_RETENCION_INTENTOS_LOGIN } = await import('../../src/cron/limpieza');

const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'service' };
const controller = {} as ScheduledController;

beforeEach(() => {
  keepalive = { data: { ultimo_ping: '2026-09-07T00:00:00Z' }, error: null };
  purga = { data: { admin_intentos_login: 3, portal_intentos_login: 1 }, error: null };
  rpcLlamadas = [];
  vi.restoreAllMocks();
});

describe('cron/limpieza — purga de intentos de login (T-005, cierra M-6)', () => {
  it('llama a purgar_intentos_login con la retención de 30 días', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await limpieza.scheduled(controller, env);
    expect(rpcLlamadas).toEqual([
      { fn: 'purgar_intentos_login', args: { p_dias: DIAS_RETENCION_INTENTOS_LOGIN } },
    ]);
    expect(DIAS_RETENCION_INTENTOS_LOGIN).toBe(30);
    expect(spy).toHaveBeenCalled();
  });

  it('deja constancia de cuántas filas purgó cada tabla', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await limpieza.scheduled(controller, env);
    const mensaje = String(spy.mock.calls[0]?.[0] ?? '');
    expect(mensaje).toContain('admin_intentos_login: 3');
    expect(mensaje).toContain('portal_intentos_login: 1');
  });

  it('si la purga falla, LANZA: un cron que falla en silencio es un cron que nadie arregla', async () => {
    purga = { data: null, error: { message: 'permission denied' } };
    await expect(limpieza.scheduled(controller, env)).rejects.toThrow(/falló la purga.*permission denied/);
  });

  it('si la conexión falla, no se intenta la purga', async () => {
    keepalive = { data: null, error: { message: 'connection refused' } };
    await expect(limpieza.scheduled(controller, env)).rejects.toThrow(/verificación de conexión/);
    expect(rpcLlamadas).toEqual([]);
  });

  it('sin fila de _keepalive, tampoco se purga', async () => {
    keepalive = { data: null, error: null };
    await expect(limpieza.scheduled(controller, env)).rejects.toThrow(/_keepalive/);
    expect(rpcLlamadas).toEqual([]);
  });
});
