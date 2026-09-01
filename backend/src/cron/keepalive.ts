// Worker `undreocol-keepalive` — cron diario "0 5 * * *" (D-7,
// INFRAESTRUCTURA.md §5). Evita la pausa del plan Free de Supabase tras 7 días
// de inactividad: hace un UPDATE real sobre _keepalive.ultimo_ping.
// Si el update falla o afecta 0 filas, LANZA excepción para que la falla sea
// visible en los logs de Cloudflare (riesgo del spec §8).

import { crearClienteServicio } from '../lib/db';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const supabase = crearClienteServicio(env);
    const { data, error } = await supabase
      .from('_keepalive')
      .update({ ultimo_ping: new Date().toISOString() })
      .eq('id', 1)
      .select('ultimo_ping');
    if (error) {
      throw new Error(`keepalive: falló el ping a Supabase — ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new Error('keepalive: el update afectó 0 filas (¿existe la fila singleton?)');
    }
    // Log operacional de la feature (CA-8): el timestamp del ping queda como
    // evidencia. console.info = logging de Workers (no es depuración).
    console.info(`keepalive: ping registrado a las ${data[0]?.ultimo_ping}`);
  },
};
