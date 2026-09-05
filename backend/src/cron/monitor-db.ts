// Worker `undreocol-monitor-db` — cron diario "30 5 * * *" (D-7,
// INFRAESTRUCTURA.md §8). Consulta tamano_base_mb() (límite del plan Free:
// 500 MB) y calcula el nivel. En nivel >= alerta envía un correo real al
// equipo de UndreoCol (010, spec §3.8) y lo deja en el log (CA-9).
//
// La alerta NO pasa por la tabla `notificaciones` (010, spec §3.8, decisión
// de diseño aprobada): esa tabla es multi-tenant con `cliente_id` obligatorio
// sin excepciones (CLAUDE.md §5.4), y esta alerta es operativa de la
// plataforma, no de ningún acueducto cliente. Sin reintento con límite tipo
// `computarActualizacionNotificacion`: el cron corre a diario, así que un
// fallo de envío de hoy se reintenta naturalmente mañana si la condición
// persiste (spec §3.8).
//
// NOTA: este módulo SOLO exporta el default (handler). La lógica pura
// (incluido el contenido de la alerta) vive en ./nivel-monitoreo.ts para
// poder testearla con vitest sin mockear el envío de correo.

import { crearClienteServicio } from '../lib/db';
import { calcularNivel, construirAlertaMonitoreo, LIMITE_BASE_MB } from './nivel-monitoreo';
import { enviarCorreo } from '../lib/email';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  EMAIL?: { send: (m: unknown) => Promise<{ messageId?: string }> };
  ALERTA_EMAIL_DESTINO: string;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const supabase = crearClienteServicio(env);
    const { data, error } = await supabase.rpc('tamano_base_mb');
    if (error) {
      throw new Error(`monitor-db: no se pudo consultar tamano_base_mb() — ${error.message}`);
    }
    const mb = Number(data);
    if (!Number.isFinite(mb) || mb <= 0) {
      throw new Error(`monitor-db: tamano_base_mb() devolvió un valor inválido: ${data}`);
    }
    const resultado = calcularNivel(mb);
    console.info(
      `monitor-db: base de ${mb} MB (${resultado.porcentaje}% del límite de ${LIMITE_BASE_MB} MB) — nivel ${resultado.nivel}`,
    );
    if (resultado.nivel === 'alerta' || resultado.nivel === 'critico') {
      console.error(`monitor-db: ALERTA ${resultado.nivel} — ${resultado.porcentaje}% del límite de 500 MB`);
      const contenido = construirAlertaMonitoreo(resultado);
      const envio = await enviarCorreo(env, {
        destinatario: env.ALERTA_EMAIL_DESTINO,
        remitente: 'no-responder@undreocol.app',
        asunto: contenido.asunto,
        cuerpoHtml: contenido.cuerpoHtml,
      });
      if (!envio.ok) {
        console.error(`monitor-db: no se pudo enviar el correo de alerta — ${envio.error}`);
      }
    }
  },
};
