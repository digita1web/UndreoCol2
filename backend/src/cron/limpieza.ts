// Worker `undreocol-limpieza` — cron semanal "0 6 * * 0" (D-7,
// INFRAESTRUCTURA.md §9).
//
// Purga los contadores de intentos de login caducados (017 T-005), lo que cierra
// el hallazgo M-6 de la auditoría pre-producción: por CA-4,
// `admin_intentos_login` cuenta también los emails que NO existen —es lo que
// impide que el 429 sirva para enumerar cuentas— así que cada email distinto que
// alguien pruebe deja una fila permanente. `portal_intentos_login` (008) tenía el
// mismo crecimiento sin techo desde entonces y nunca se purgó. Con la base de
// 500 MB de Supabase Free (ARQUITECTURA.md §6) eso importa.
//
// El predicado de borrado vive en la función SQL purgar_intentos_login()
// (migración 20260917090000), no aquí: así se puede probar contra PostgreSQL
// real con filas de verdad (tests/aislamiento/901, paso 11). NUNCA borra un
// bloqueo vigente — hacerlo le daría al atacante una forma gratuita de limpiar
// el suyo esperando al cron.
//
// El resto de objetivos de purga documentados en ESTRATEGIA-CALIDAD.md §6
// (sesiones, auditoría, trabajos, notificaciones) siguen pendientes de la
// feature de limpieza automática — que el roadmap de `.specify/config.md` numera
// 016, no 015 como decía el comentario anterior de este archivo.

import { crearClienteServicio } from '../lib/db';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// Días sin actividad tras los que una fila caducada se borra (plan §5.5).
export const DIAS_RETENCION_INTENTOS_LOGIN = 30;

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const supabase = crearClienteServicio(env);
    // Verificación de conexión real: leer el timestamp de _keepalive (técnica).
    const { data, error } = await supabase
      .from('_keepalive')
      .select('ultimo_ping')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      throw new Error(`limpieza: falló la verificación de conexión — ${error.message}`);
    }
    if (!data) {
      throw new Error('limpieza: no se encontró la fila singleton de _keepalive');
    }

    const { data: purgado, error: errPurga } = await supabase.rpc('purgar_intentos_login', {
      p_dias: DIAS_RETENCION_INTENTOS_LOGIN,
    });
    if (errPurga) {
      // Se lanza a propósito: un cron que falla en silencio es un cron que nadie
      // arregla (CLAUDE.md §7). El fallo queda en el log del Worker.
      throw new Error(`limpieza: falló la purga de intentos de login — ${errPurga.message}`);
    }

    const r = (purgado ?? {}) as { admin_intentos_login?: number; portal_intentos_login?: number };
    console.info(
      `limpieza: purga de intentos de login — admin_intentos_login: ${r.admin_intentos_login ?? 0}, ` +
        `portal_intentos_login: ${r.portal_intentos_login ?? 0} (retención ${DIAS_RETENCION_INTENTOS_LOGIN} días)`,
    );
  },
};
