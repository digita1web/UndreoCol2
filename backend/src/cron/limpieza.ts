// Worker `undreocol-limpieza` — cron semanal "0 6 * * 0" (D-7,
// INFRAESTRUCTURA.md §9). BASE en esta feature: verifica la conexión y registra
// que no hay tablas que purgar todavía. La lógica de purga (sesiones,
// auditoría, trabajos, notificaciones) se implementa en la feature 015.

import { crearClienteServicio } from '../lib/db';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

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
    // Objetivos de purga documentados (ESTRATEGIA-CALIDAD.md §6, feature 015):
    // sesiones, auditoría, trabajos, notificaciones. Ninguna existe en esta
    // feature, así que el Worker solo deja constancia operativa.
    console.info('limpieza: sin tablas que purgar (la purga llega con la feature 015)');
  },
};
