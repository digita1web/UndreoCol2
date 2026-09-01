// Lógica pura del monitoreo (umbrales de D-7 / INFRAESTRUCTURA.md §8):
// 300 atencion, 400 alerta, 480 critico; límite del plan Free: 500 MB.
// Separada del Worker (monitor-db.ts) para poder testearla con vitest y para
// que el módulo de entrada del Worker solo tenga el export default.

export const LIMITE_BASE_MB = 500;

export type NivelMonitoreo = 'ok' | 'atencion' | 'alerta' | 'critico';

export interface ResultadoMonitoreo {
  porcentaje: number; // % respecto a 500 MB (2 decimales)
  nivel: NivelMonitoreo;
}

export function calcularNivel(tamanoMb: number): ResultadoMonitoreo {
  const porcentaje = Math.round((tamanoMb / LIMITE_BASE_MB) * 100 * 100) / 100;
  let nivel: NivelMonitoreo = 'ok';
  if (tamanoMb >= 480) nivel = 'critico';
  else if (tamanoMb >= 400) nivel = 'alerta';
  else if (tamanoMb >= 300) nivel = 'atencion';
  return { porcentaje, nivel };
}
