// Límite de intentos del login administrativo (017, T-003).
// Referencia: specs/017-rate-limit-login-admin/plan.md §4. Origen: hallazgo A-2
// (ALTO) de la auditoría pre-producción, docs/PLAN-PRODUCCION.md.
//
// Capa fina sobre las 2 RPC de la migración 20260916090000: traduce RPC ↔ tipos
// y nada más. Toda la lógica del retardo progresivo vive en SQL, porque debe ser
// atómica con el incremento del contador (plan §5.1); duplicarla aquí sería
// tener la misma fórmula en dos sitios.
//
// SIEMPRE con crearClienteAnon: el login ocurre ANTES de que exista sesión, y
// las funciones están otorgadas solo a `anon`. NUNCA service_role
// (CLAUDE.md §5.4/§12), igual que lib/portal.ts.

import { crearClienteAnon, type Env } from './db';

export interface EstadoLoginAdmin {
  bloqueado: boolean;
  /** ISO 8601. Presente solo cuando `bloqueado` es true. */
  reintentarEn?: string;
}

// Política de fallo (plan §5.4): FALLA CERRADO.
// Si la RPC devuelve error, o una respuesta que no se puede interpretar, esta
// función LANZA y la ruta responde 503 sin intentar el login. GoTrue y esta
// tabla son el mismo PostgreSQL: si la tabla no responde, el login iba a fallar
// igual. Fallar abierto haría que la protección de fuerza bruta desapareciera
// justo cuando un atacante puede provocarlo.
export async function estadoLoginAdmin(env: Env, email: string): Promise<EstadoLoginAdmin> {
  const supabase = crearClienteAnon(env);
  const { data, error } = await supabase.rpc('admin_login_estado', { p_email: email });
  if (error) {
    throw new Error(`No se pudo consultar el límite de intentos: ${error.message}`);
  }

  const r = (data ?? {}) as { estado?: string; reintentar_en?: string };
  if (r.estado === 'bloqueado') {
    return { bloqueado: true, reintentarEn: r.reintentar_en };
  }
  if (r.estado === 'ok') {
    return { bloqueado: false };
  }
  // Respuesta inesperada: no se pudo determinar el estado. Mismo criterio que
  // un error de la RPC — no se deja pasar el login a ciegas.
  throw new Error(`Respuesta inesperada del límite de intentos: ${JSON.stringify(data)}`);
}

// Política de fallo (plan §5.4): FALLA ABIERTO, y por eso NUNCA lanza.
// Un fallo al anotar el intento no puede convertir un login correcto en un error
// para el usuario (mismo criterio que la regla 20 con el correo). No abre un
// hueco real: si registrar falla de forma sostenida, `estadoLoginAdmin` también
// fallará y la ruta ya devuelve 503.
export async function registrarIntentoLoginAdmin(
  env: Env,
  email: string,
  exito: boolean,
): Promise<void> {
  try {
    const supabase = crearClienteAnon(env);
    const { error } = await supabase.rpc('admin_login_registrar', {
      p_email: email,
      p_exito: exito,
    });
    if (error) {
      console.error('auth-intentos: no se pudo registrar el intento de login', error.message);
    }
  } catch (e) {
    // No se relanza a propósito: ver la política de fallo de arriba.
    console.error(
      'auth-intentos: error registrando el intento de login',
      e instanceof Error ? e.message : e,
    );
  }
}
