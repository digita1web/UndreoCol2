// Lógica de negocio pura del consumo de agua (rollover, reemplazo, anomalías).
// Sin dependencias de Hono, Cloudflare ni Supabase (CLAUDE.md §5.3).
// Referencia: specs/004-lecturas-y-consumo/plan.md §4 y spec.md §3.3/§5.
//
// Reglas (CLAUDE.md §10, sección Lecturas y consumo):
//   1. Rollover: solo si lecturaActual < lecturaAnterior Y
//      lecturaAnterior > capacidadMaxima * umbralRolloverPct/100.
//      Consumo = (capacidadMaxima - anterior) + actual.
//   2. Lectura menor sin cumplir la condición de rollover: rechazo (nunca se
//      factura en negativo ni en cero en silencio).
//   5. Consumo alto: > factor_consumo_alto% del promedio Y > piso_consumo_alto_m3.
//   6. Consumo bajo o cero: < factor_consumo_bajo% del promedio, o cero.
//      Marcan para revisión, NUNCA bloquean el guardado.
//   7. Reemplazo de contador a mitad de periodo: consumo =
//      (lecturaFinalAnterior - ultimaLecturaSaliente) + (lecturaActualEntrante
//      - lecturaInicialNuevo).
//
// El consumo se maneja en m³ con 2 decimales (`numeric(12,2)` en Postgres).
// El redondeo monetario final a la unidad de pesos es de la feature 005, no de
// aquí (CLAUDE.md §5.6): esta función NO redondea pesos, solo normaliza el
// consumo a 2 decimales.

/** Motivos por los que una lectura se rechaza al calcular su consumo. */
type ErrorLectura =
  | 'lectura_menor_sin_rollover' // cláusula punto 2
  | 'lectura_mayor_capacidad'    // lectura_actual > capacidad_maxima (no puede pasar en un display real)
  | 'datos_invalidos';           // capacidad o umbral no positivos, o datos incoherentes

/** Resultado de calcular el consumo de una lectura SIN reemplazo de contador. */
export type ResultadoConsumo =
  | { ok: true; consumoM3: number; huboRollover: boolean }
  | { ok: false; error: ErrorLectura };

/** Estado de revisión de una lectura (anomalías: marcan, nunca bloquean). */
export type VerificacionAnomalia =
  | 'normal'
  | 'consumo_alto'
  | 'consumo_bajo'
  | 'consumo_cero';

/** Redondea a 2 decimales (m³), compensando imprecisiones de coma flotante. */
function redondear2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// punto 1 y 2: consumo del periodo (rollover o rechazo)
// ---------------------------------------------------------------------------
export interface ConsumoPeriodoInput {
  lecturaAnterior: number;
  lecturaActual: number;
  capacidadMaxima: number;
  /** % de la capacidad sobre el que se considera rollover (de configuracion, ej. 90). */
  umbralRolloverPct: number;
}

export function calcularConsumoPeriodo(input: ConsumoPeriodoInput): ResultadoConsumo {
  const { lecturaAnterior, lecturaActual, capacidadMaxima, umbralRolloverPct } = input;

  if (
    !Number.isFinite(capacidadMaxima) ||
    !Number.isFinite(umbralRolloverPct) ||
    capacidadMaxima <= 0 ||
    umbralRolloverPct <= 0
  ) {
    return { ok: false, error: 'datos_invalidos' };
  }

  if (lecturaActual > capacidadMaxima) {
    return { ok: false, error: 'lectura_mayor_capacidad' };
  }

  // Sin rollover visible: la lectura sube.
  if (lecturaActual >= lecturaAnterior) {
    return { ok: true, consumoM3: redondear2(lecturaActual - lecturaAnterior), huboRollover: false };
  }

  // lecturaActual < lecturaAnterior: solo es legítimo como rollover si el
  // contador estaba por encima del umbral de capacidad (punto 1).
  const umbral = (capacidadMaxima * umbralRolloverPct) / 100;
  if (lecturaAnterior > umbral) {
    return {
      ok: true,
      consumoM3: redondear2(capacidadMaxima - lecturaAnterior + lecturaActual),
      huboRollover: true,
    };
  }

  // Llegó abajo sin cumplir la condición de rollover: error de digitación o
  // contador dañado (punto 2).
  return { ok: false, error: 'lectura_menor_sin_rollover' };
}

// ---------------------------------------------------------------------------
// punto 7: reemplazo de contador a mitad de periodo
// ---------------------------------------------------------------------------
export interface ConsumoReemplazoInput {
  /** de reemplazos_contador: lo que marcó el contador saliente al retirarlo. */
  lecturaFinalAnterior: number;
  /** última lectura real del contador saliente en el periodo. */
  ultimaLecturaSaliente: number;
  /** de reemplazos_contador: lo que marcó el contador nuevo al instalarse. */
  lecturaInicialNuevo: number;
  /** lectura que se está registrando en el contador nuevo. */
  lecturaActualEntrante: number;
}

export function calcularConsumoConReemplazo(
  input: ConsumoReemplazoInput,
): ResultadoConsumo {
  const {
    lecturaFinalAnterior,
    ultimaLecturaSaliente,
    lecturaInicialNuevo,
    lecturaActualEntrante,
  } = input;

  const tramoSaliente = lecturaFinalAnterior - ultimaLecturaSaliente;
  const tramoEntrante = lecturaActualEntrante - lecturaInicialNuevo;

  if (tramoSaliente < 0 || tramoEntrante < 0) {
    // Un tramo de consumo negativo no tiene sentido: datos incoherentes.
    return { ok: false, error: 'datos_invalidos' };
  }

  return { ok: true, consumoM3: redondear2(tramoSaliente + tramoEntrante), huboRollover: false };
}

// ---------------------------------------------------------------------------
// puntos 5 y 6: clasificación de anomalías (NUNCA bloquea el guardado)
// ---------------------------------------------------------------------------
export interface AnomaliaInput {
  consumoM3: number;
  /** % del promedio histórico para marcar consumo alto (de configuracion, ej. 150). */
  factorConsumoAltoPct: number;
  /** mínimo en m³ para marcar consumo alto (de configuracion, ej. 100). */
  pisoConsumoAltoM3: number;
  /** % del promedio histórico para marcar consumo bajo (de configuracion, ej. 20). */
  factorConsumoBajoPct: number;
  /** promedio histórico (media de lecturas previas del contador); null si no hay. */
  promedioHistoricoM3: number | null;
}

export function clasificarAnomalia(input: AnomaliaInput): VerificacionAnomalia {
  const {
    consumoM3,
    factorConsumoAltoPct,
    pisoConsumoAltoM3,
    factorConsumoBajoPct,
    promedioHistoricoM3,
  } = input;

  // consumo cero: anomalía sin depender del histórico.
  if (consumoM3 === 0) {
    return 'consumo_cero';
  }

  // Para alto/bajo se necesita una base histórica; sin ella no se marca
  // anomalía relativa (primera lectura).
  if (promedioHistoricoM3 === null || promedioHistoricoM3 <= 0) {
    return 'normal';
  }

  const umbralAlto = (promedioHistoricoM3 * factorConsumoAltoPct) / 100;
  const umbralBajo = (promedioHistoricoM3 * factorConsumoBajoPct) / 100;

  // consumo alto: > factor% del promedio Y > piso (punto 5).
  if (consumoM3 > umbralAlto && consumoM3 > pisoConsumoAltoM3) {
    return 'consumo_alto';
  }

  // consumo bajo: < factor% del promedio (el cero ya fue atrapado arriba) (punto 6).
  if (consumoM3 < umbralBajo) {
    return 'consumo_bajo';
  }

  return 'normal';
}

