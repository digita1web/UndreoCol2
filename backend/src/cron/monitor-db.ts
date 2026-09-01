// Worker `undreocol-monitor-db` — cron diario "30 5 * * *" (D-7,
// INFRAESTRUCTURA.md §8). Consulta tamano_base_mb() (límite del plan Free:
// 500 MB) y calcula el nivel. En nivel >= alerta dispara la alertaStub: el
// envío por Cloudflare Email Service se integra en una feature posterior
// (spec §4.8), pero el cálculo y el log deben funcionar (CA-9).
//
// NOTA: este módulo SOLO exporta el default (handler). La lógica pura vive en
// ./nivel-monitoreo.ts para poder testearla con vitest (la entrada de un
// Worker no puede tener exports nombrados).

import { crearClienteServicio } from '../lib/db';
import { calcularNivel, LIMITE_BASE_MB, type ResultadoMonitoreo } from './nivel-monitoreo';

function alertaStub(resultado: ResultadoMonitoreo): void {
  // TODO(feature 010): enviar el correo de alerta vía Cloudflare Email Service.
  console.error(`monitor-db: ALERTA ${resultado.nivel} — ${resultado.porcentaje}% del límite de 500 MB`);
}

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
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
      alertaStub(resultado);
    }
  },
};
