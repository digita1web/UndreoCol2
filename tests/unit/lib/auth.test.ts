import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServerClient } from '@supabase/ssr';
import {
  obtenerSesionActiva,
  iniciarSesion,
  cerrarSesion,
  iniciarSesionSuscriptor,
  renovarSesionSuscriptor,
  verificarSesionSuscriptor,
  ErrorSesionSuscriptorPendiente,
  DURACION_SESION_SUSCRIPTOR_SEG,
  UMBRAL_RENOVACION_SUSCRIPTOR_SEG,
  type SesionAdministrativa,
} from '@/lib/auth';

// next/headers: en entorno de test no existe RequestAsyncStorage; se mockea.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
    set: vi.fn(),
  })),
}));

// @supabase/ssr: el cliente real no se crea en tests unitarios.
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}));

const mockGetUser = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();

const mockCliente = {
  auth: {
    getUser: mockGetUser,
    signInWithPassword: mockSignInWithPassword,
    signOut: mockSignOut,
  },
};

function clienteSimulado(): unknown {
  return mockCliente;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Entorno simulado: db.ts valida las variables antes de crear el cliente.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-de-prueba';
  vi.mocked(createServerClient).mockReturnValue(
    clienteSimulado() as ReturnType<typeof createServerClient>
  );
});

describe('lib/auth.ts — constantes de la sesión del portal (D-4)', () => {
  it('duración de 30 días en segundos', () => {
    expect(DURACION_SESION_SUSCRIPTOR_SEG).toBe(30 * 24 * 60 * 60);
  });

  it('umbral de renovación de 7 días en segundos', () => {
    expect(UMBRAL_RENOVACION_SUSCRIPTOR_SEG).toBe(7 * 24 * 60 * 60);
  });
});

describe('obtenerSesionActiva()', () => {
  it('devuelve null sin cookie de sesión', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(obtenerSesionActiva()).resolves.toBeNull();
  });

  it('devuelve null cuando la sesión es inválida (nunca lanza)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'JWT expired' } });
    await expect(obtenerSesionActiva()).resolves.toBeNull();
  });

  it('devuelve una SesionAdministrativa con tipo "administrativa"', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'perfil-123', email: 'admin@test.local' } },
      error: null,
    });
    const sesion = (await obtenerSesionActiva()) as SesionAdministrativa;
    expect(sesion).not.toBeNull();
    expect(sesion.tipo).toBe('administrativa');
    expect(sesion.perfilId).toBe('perfil-123');
    expect(sesion.email).toBe('admin@test.local');
  });
});

describe('iniciarSesion()', () => {
  it('inicia sesión y devuelve la sesión administrativa', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: 'perfil-456', email: 'admin@test.local' } },
      error: null,
    });
    const sesion = await iniciarSesion('admin@test.local', 'clave-secreta');
    expect(sesion.tipo).toBe('administrativa');
    expect(sesion.perfilId).toBe('perfil-456');
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'admin@test.local',
      password: 'clave-secreta',
    });
  });

  it('lanza un error explícito con credenciales inválidas', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });
    await expect(iniciarSesion('admin@test.local', 'clave-mal')).rejects.toThrow(
      /No se pudo iniciar sesión/
    );
  });
});

describe('cerrarSesion()', () => {
  it('es idempotente: cerrar sin sesión no lanza', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await expect(cerrarSesion()).resolves.toBeUndefined();
  });

  it('lanza un error explícito si signOut falla', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'network error' } });
    await expect(cerrarSesion()).rejects.toThrow(/No se pudo cerrar la sesión/);
  });
});

describe('Sesión de suscriptor — contrato reservado (feature 008, D-4)', () => {
  it('iniciarSesionSuscriptor lanza ErrorSesionSuscriptorPendiente', async () => {
    await expect(
      iniciarSesionSuscriptor('123456789', 'ABC-123')
    ).rejects.toBeInstanceOf(ErrorSesionSuscriptorPendiente);
  });

  it('renovarSesionSuscriptor lanza ErrorSesionSuscriptorPendiente', async () => {
    await expect(renovarSesionSuscriptor('token')).rejects.toBeInstanceOf(
      ErrorSesionSuscriptorPendiente
    );
  });

  it('verificarSesionSuscriptor lanza ErrorSesionSuscriptorPendiente', () => {
    expect(() => verificarSesionSuscriptor('token')).toThrow(
      ErrorSesionSuscriptorPendiente
    );
  });
});
