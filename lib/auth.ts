import type { User } from '@supabase/supabase-js';
import { crearClienteServidor } from '@/lib/db';

// =============================================================================
// lib/auth.ts — contratos de sesión (decisión D-4, CLAUDE.md §9-25)
//
// DOS tipos de sesión desde el diseño:
//   - administrativa: Supabase Auth. IMPLEMENTADA en esta feature.
//   - suscriptor: JWT propio firmado con SESSION_SECRET (feature 008).
//     Contrato reservado: las funciones existen y lanzan
//     ErrorSesionSuscriptorPendiente. La interfaz no se cierra a esta sesión.
// =============================================================================

// ---------------------------- Tipos de sesión --------------------------------

export type TipoSesion = 'administrativa' | 'suscriptor';

// Sesión administrativa — Supabase Auth (implementada en esta feature).
// El cliente activo NO se incluye a propósito: la membresía activa se resuelve
// por petición vía lib/tenant.ts (feature posterior), porque puede cambiar sin
// que la sesión expire.
export interface SesionAdministrativa {
  tipo: 'administrativa';
  perfilId: string; // auth.users.id / perfiles.id
  email: string;
}

// Sesión de suscriptor — JWT propio (decisión D-4). Contrato reservado.
// "sub" = usuario_servicio_id, "cid" = cliente_id, "exp" = expiración (epoch s).
export interface SesionSuscriptor {
  tipo: 'suscriptor';
  usuarioServicioId: string; // "sub" del JWT
  clienteId: string; // "cid" del JWT
  expiraEn: number; // "exp" del JWT
}

export type Sesion = SesionAdministrativa | SesionSuscriptor;

// Constantes de la sesión del portal (D-4). Se definen aquí para que el
// contrato no cierre la segunda sesión; la feature 008 las usará.
export const DURACION_SESION_SUSCRIPTOR_SEG = 30 * 24 * 60 * 60; // 30 días
export const UMBRAL_RENOVACION_SUSCRIPTOR_SEG = 7 * 24 * 60 * 60; // < 7 días restantes

export class ErrorSesionSuscriptorPendiente extends Error {
  constructor() {
    super('Sesión de suscriptor pendiente de implementar (feature 008, decisión D-4).');
    this.name = 'ErrorSesionSuscriptorPendiente';
  }
}

// ------------------- Sesión administrativa (implementada) ---------------------

function aSesionAdministrativa(usuario: User): SesionAdministrativa {
  return {
    tipo: 'administrativa',
    perfilId: usuario.id,
    email: usuario.email ?? '',
  };
}

// Devuelve la sesión administrativa activa, o null si no hay cookie válida.
// No lanza: la ausencia de sesión es un caso normal (página pública).
export async function obtenerSesionActiva(): Promise<SesionAdministrativa | null> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return aSesionAdministrativa(data.user);
}

// Inicia sesión con email/contraseña contra Supabase Auth. La cookie de sesión
// se escribe vía @supabase/ssr. Lanza si las credenciales son inválidas.
export async function iniciarSesion(
  email: string,
  contrasena: string
): Promise<SesionAdministrativa> {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: contrasena,
  });
  if (error || !data.user) {
    throw new Error(
      `No se pudo iniciar sesión: ${error?.message ?? 'credenciales inválidas'}`
    );
  }
  return aSesionAdministrativa(data.user);
}

// Cierra la sesión administrativa (signOut de Supabase y cookie limpia).
// Idempotente: cerrar sin sesión no lanza.
export async function cerrarSesion(): Promise<void> {
  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(`No se pudo cerrar la sesión: ${error.message}`);
  }
}

// -------------------- Sesión de suscriptor (contrato reservado) ---------------

// Todas lanzan ErrorSesionSuscriptorPendiente. Firmas fijadas para que la
// feature 008 las implemente sin cambiar la interfaz pública.

export async function iniciarSesionSuscriptor(
  numeroDocumento: string,
  codigoSuscriptor: string
): Promise<SesionSuscriptor> {
  // Contrato reservado (D-4): la validación de cédula + codigo_suscriptor se
  // implementa en la feature 008 (portal de autoservicio).
  void numeroDocumento;
  void codigoSuscriptor;
  throw new ErrorSesionSuscriptorPendiente();
}

export async function renovarSesionSuscriptor(token: string): Promise<SesionSuscriptor> {
  void token;
  throw new ErrorSesionSuscriptorPendiente();
}

export function verificarSesionSuscriptor(token: string): SesionSuscriptor {
  void token;
  throw new ErrorSesionSuscriptorPendiente();
}
