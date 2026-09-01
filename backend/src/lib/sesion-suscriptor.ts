// Contrato RESERVADO de la sesión del portal del suscriptor (D-2, D-4).
// Se implementa en la feature 008. Las firmas quedan fijas desde la fundación
// y todas lanzan ErrorSesionSuscriptorPendiente: la interfaz queda abierta a la
// segunda sesión sin código muerto ni datos fabricados.

export interface SesionSuscriptor {
  tipo: 'suscriptor';
  usuarioServicioId: string; // "sub" del JWT
  clienteId: string; // "cid" del JWT
  expiraEn: number; // "exp" del JWT (epoch s)
}

// Constantes de la sesión del portal (D-4): 30 días con renovación < 7 días.
export const DURACION_SESION_SUSCRIPTOR_SEG = 30 * 24 * 60 * 60;
export const UMBRAL_RENOVACION_SUSCRIPTOR_SEG = 7 * 24 * 60 * 60;

export class ErrorSesionSuscriptorPendiente extends Error {
  constructor() {
    super('La sesión del suscriptor se implementa en la feature 008 (D-2/D-4).');
    this.name = 'ErrorSesionSuscriptorPendiente';
  }
}

// Valida numero_documento + codigo_suscriptor y emite el JWT con SESSION_SECRET.
export async function iniciarSesionSuscriptor(): Promise<SesionSuscriptor> {
  throw new ErrorSesionSuscriptorPendiente();
}

// Renovación automática (D-4): si quedan < 7 días, emite un JWT nuevo.
export async function renovarSesionSuscriptor(): Promise<SesionSuscriptor> {
  throw new ErrorSesionSuscriptorPendiente();
}

// Verifica firma, expiración y el campo tipo: 'suscriptor' (CLAUDE.md §10-22c).
export async function verificarSesionSuscriptor(): Promise<SesionSuscriptor> {
  throw new ErrorSesionSuscriptorPendiente();
}
