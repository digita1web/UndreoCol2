// Capa fina del panel de plataforma (018, T-003).
// Se sustituyen el cliente de Supabase (para las 2 RPC) y `crearClienteAnon`
// (para signUp) por dobles falsos, para comprobar el CONTRATO que la ruta
// necesita: las 3 funciones de RPC/Auth PROPAGAN el error tal cual — a
// diferencia de lib/auth-intentos.ts, aquí no hay política de "falla
// abierto": cada paso del alta (plan §3) necesita saber si falló para decidir
// el siguiente, así que nada se traga en silencio.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let respuestaRpc: { data: unknown; error: { message: string } | null } = { data: null, error: null };
let llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
let rpcLanza = false;

let respuestaUpdate: { error: { message: string } | null } = { error: null };
let llamadasUpdate: Array<{ tabla: string; patch: Record<string, unknown>; filtros: Array<[string, string, unknown]> }> = [];

const supabaseFalso = {
  rpc: (fn: string, args: Record<string, unknown>) => {
    llamadasRpc.push({ fn, args });
    if (rpcLanza) throw new Error('la red se cayó');
    return Promise.resolve(respuestaRpc);
  },
  from: (tabla: string) => ({
    update: (patch: Record<string, unknown>) => {
      const filtros: Array<[string, string, unknown]> = [];
      const encadenable = {
        eq: (col: string, val: unknown) => {
          filtros.push(['eq', col, val]);
          return encadenable;
        },
        neq: (col: string, val: unknown) => {
          filtros.push(['neq', col, val]);
          llamadasUpdate.push({ tabla, patch, filtros: [...filtros] });
          return Promise.resolve(respuestaUpdate);
        },
      };
      return encadenable;
    },
  }),
} as never;

let respuestaSignUp: { data: { user: { id: string } | null }; error: { message: string } | null } = {
  data: { user: null },
  error: null,
};
let llamadasSignUp: Array<{ email: string; password: string }> = [];

const clienteAnonFalso = {
  auth: {
    signUp: (args: { email: string; password: string }) => {
      llamadasSignUp.push(args);
      return Promise.resolve(respuestaSignUp);
    },
  },
};

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  crearClienteAnon: () => clienteAnonFalso,
}));

const {
  generarContrasenaInterna,
  crearAcueductoBase,
  signUpAdminAcueducto,
  asignarAdminAcueducto,
  desactivarAdminAnterior,
} = await import('../../src/lib/plataforma');

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'secreto',
} as never;

beforeEach(() => {
  respuestaRpc = { data: null, error: null };
  llamadasRpc = [];
  rpcLanza = false;
  respuestaSignUp = { data: { user: null }, error: null };
  llamadasSignUp = [];
  respuestaUpdate = { error: null };
  llamadasUpdate = [];
  vi.restoreAllMocks();
});

describe('generarContrasenaInterna', () => {
  it('genera 20 caracteres sin 0/O/1/l/I', () => {
    for (let i = 0; i < 200; i++) {
      const c = generarContrasenaInterna();
      expect(c).toHaveLength(20);
      expect(c).not.toMatch(/[0O1lI]/);
    }
  });

  it('no se repite en 1000 llamadas (colisión estadísticamente imposible)', () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 1000; i++) vistas.add(generarContrasenaInterna());
    expect(vistas.size).toBe(1000);
  });
});

describe('crearAcueductoBase', () => {
  it('envía nombre y slug con los nombres de parámetro correctos', async () => {
    respuestaRpc = { data: 'cliente-1', error: null };
    await crearAcueductoBase(supabaseFalso, 'Acueducto X', 'acueducto-x');
    expect(llamadasRpc).toEqual([
      { fn: 'crear_acueducto_base', args: { p_nombre_cliente: 'Acueducto X', p_slug: 'acueducto-x' } },
    ]);
  });

  it('devuelve el clienteId de la RPC', async () => {
    respuestaRpc = { data: 'cliente-1', error: null };
    await expect(crearAcueductoBase(supabaseFalso, 'Acueducto X', 'acueducto-x')).resolves.toEqual({
      clienteId: 'cliente-1',
    });
  });

  it('slug duplicado -> LANZA con el mensaje tal cual de la función SQL', async () => {
    respuestaRpc = { data: null, error: { message: 'El slug ya está en uso' } };
    await expect(crearAcueductoBase(supabaseFalso, 'Acueducto X', 'acueducto-a')).rejects.toThrow(
      'El slug ya está en uso',
    );
  });

  it('error genérico de la RPC -> LANZA', async () => {
    respuestaRpc = { data: null, error: { message: 'connection refused' } };
    await expect(crearAcueductoBase(supabaseFalso, 'Acueducto X', 'acueducto-x')).rejects.toThrow(
      /connection refused/,
    );
  });
});

describe('signUpAdminAcueducto', () => {
  it('usa crearClienteAnon — nunca service_role (CLAUDE.md §12)', async () => {
    respuestaSignUp = { data: { user: { id: 'usuario-1' } }, error: null };
    await signUpAdminAcueducto(env, 'admin@nuevo.local', 'clave-temporal');
    expect(llamadasSignUp).toEqual([{ email: 'admin@nuevo.local', password: 'clave-temporal' }]);
  });

  it('devuelve el usuarioId de GoTrue', async () => {
    respuestaSignUp = { data: { user: { id: 'usuario-1' } }, error: null };
    await expect(signUpAdminAcueducto(env, 'admin@nuevo.local', 'clave-temporal')).resolves.toEqual({
      usuarioId: 'usuario-1',
    });
  });

  it('error de GoTrue (p. ej. correo ya registrado) -> LANZA', async () => {
    respuestaSignUp = { data: { user: null }, error: { message: 'User already registered' } };
    await expect(
      signUpAdminAcueducto(env, 'admin@nuevo.local', 'clave-temporal'),
    ).rejects.toThrow(/already registered/);
  });

  it('sin error pero sin usuario tampoco -> LANZA (no se asume éxito)', async () => {
    respuestaSignUp = { data: { user: null }, error: null };
    await expect(signUpAdminAcueducto(env, 'admin@nuevo.local', 'clave-temporal')).rejects.toThrow();
  });
});

describe('asignarAdminAcueducto', () => {
  it('envía los 4 parámetros con los nombres correctos', async () => {
    respuestaRpc = { data: null, error: null };
    await asignarAdminAcueducto(supabaseFalso, 'cliente-1', 'usuario-1', 'Admin Nuevo', 'admin@nuevo.local');
    expect(llamadasRpc).toEqual([
      {
        fn: 'asignar_admin_acueducto',
        args: {
          p_cliente_id: 'cliente-1',
          p_usuario_id: 'usuario-1',
          p_nombre: 'Admin Nuevo',
          p_email: 'admin@nuevo.local',
        },
      },
    ]);
  });

  it('error de la RPC -> LANZA (la ruta debe saber que este paso falló)', async () => {
    respuestaRpc = { data: null, error: { message: 'foreign key violation' } };
    await expect(
      asignarAdminAcueducto(supabaseFalso, 'cliente-1', 'usuario-1', 'Admin Nuevo', 'admin@nuevo.local'),
    ).rejects.toThrow(/foreign key violation/);
  });
});

describe('desactivarAdminAnterior', () => {
  it('filtra por cliente, rol admin_acueducto, activo=true, y EXCLUYE al admin nuevo', async () => {
    respuestaUpdate = { error: null };
    await desactivarAdminAnterior(supabaseFalso, 'cliente-1', 'usuario-nuevo');
    expect(llamadasUpdate).toEqual([
      {
        tabla: 'membresias',
        patch: { activo: false },
        filtros: [
          ['eq', 'cliente_id', 'cliente-1'],
          ['eq', 'rol', 'admin_acueducto'],
          ['eq', 'activo', true],
          ['neq', 'perfil_id', 'usuario-nuevo'],
        ],
      },
    ]);
  });

  it('error del UPDATE -> LANZA (la ruta debe reportar corrección manual, no tragárselo)', async () => {
    respuestaUpdate = { error: { message: 'permission denied' } };
    await expect(
      desactivarAdminAnterior(supabaseFalso, 'cliente-1', 'usuario-nuevo'),
    ).rejects.toThrow(/permission denied/);
  });
});
