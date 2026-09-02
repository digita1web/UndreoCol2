import { describe, expect, it } from 'vitest';
import {
  calcularConsumoPeriodo,
  calcularConsumoConReemplazo,
  clasificarAnomalia,
} from '../../src/core/consumo';

// Capacidad de 5 dígitos (99999) y de 6 dígitos (999999), umbral rollover 90%
// por defecto (configuracion).
const CAP5 = 99999;
const CAP6 = 999999;
const UMBRAL = 90;

describe('calcularConsumoPeriodo — consumo simple (sin rollover)', () => {
  it('primera lectura: lecturaAnterior = lectura_inicial (0)', () => {
    const r = calcularConsumoPeriodo({ lecturaAnterior: 0, lecturaActual: 25, capacidadMaxima: CAP5, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: true, consumoM3: 25, huboRollover: false });
  });

  it('consumo normal entre periodos', () => {
    const r = calcularConsumoPeriodo({ lecturaAnterior: 100, lecturaActual: 145, capacidadMaxima: CAP5, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: true, consumoM3: 45, huboRollover: false });
  });

  it('lectura sin cambio: consumo 0', () => {
    const r = calcularConsumoPeriodo({ lecturaAnterior: 100, lecturaActual: 100, capacidadMaxima: CAP5, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: true, consumoM3: 0, huboRollover: false });
  });
});

describe('calcularConsumoPeriodo — rollover (punto 1)', () => {
  // umbral = 99999 * 90/100 = 89999.1 → rollover si lecturaAnterior > 89999.1
  it('por DEBAJO del umbral: lectura menor NO es rollover → rechazo', () => {
    const r = calcularConsumoPeriodo({ lecturaAnterior: 80000, lecturaActual: 10, capacidadMaxima: CAP5, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: false, error: 'lectura_menor_sin_rollover' });
  });

  it('JUSTO en el umbral no dispara rollover (la regla es >): lectura menor → rechazo', () => {
    // 89999.1 no es > 89999.1
    const r = calcularConsumoPeriodo({ lecturaAnterior: 89999.1, lecturaActual: 10, capacidadMaxima: CAP5, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: false, error: 'lectura_menor_sin_rollover' });
  });

  it('POR ENCIMA del umbral: lectura menor es rollover', () => {
    // anterior 90000 (> 89999.1), actual 5 → consumo = (99999 - 90000) + 5 = 10004
    const r = calcularConsumoPeriodo({ lecturaAnterior: 90000, lecturaActual: 5, capacidadMaxima: CAP5, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: true, consumoM3: 10004, huboRollover: true });
  });

  it('rollover con capacidad de 6 dígitos (999999)', () => {
    // umbral = 999999*0.9 = 899999.1; anterior 900000 > umbral
    const r = calcularConsumoPeriodo({ lecturaAnterior: 900000, lecturaActual: 25, capacidadMaxima: CAP6, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: true, consumoM3: 100024, huboRollover: true });
  });

  it('rollover cerrando exactamente en un dígito bajo (ej. llega a 0)', () => {
    const r = calcularConsumoPeriodo({ lecturaAnterior: 99990, lecturaActual: 0, capacidadMaxima: CAP5, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: true, consumoM3: 9, huboRollover: true });
  });
});

describe('calcularConsumoPeriodo — datos inválidos y lectura mayor a capacidad', () => {
  it('lectura_actual > capacidad_maxima es rechazado', () => {
    const r = calcularConsumoPeriodo({ lecturaAnterior: 0, lecturaActual: 100000, capacidadMaxima: CAP5, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: false, error: 'lectura_mayor_capacidad' });
  });

  it('capacidad no positiva → datos_invalidos', () => {
    const r = calcularConsumoPeriodo({ lecturaAnterior: 0, lecturaActual: 5, capacidadMaxima: 0, umbralRolloverPct: UMBRAL });
    expect(r).toEqual({ ok: false, error: 'datos_invalidos' });
  });

  it('umbral no positivo → datos_invalidos', () => {
    const r = calcularConsumoPeriodo({ lecturaAnterior: 0, lecturaActual: 5, capacidadMaxima: CAP5, umbralRolloverPct: 0 });
    expect(r).toEqual({ ok: false, error: 'datos_invalidos' });
  });
});

describe('calcularConsumoConReemplazo (punto 7)', () => {
  it('tramo saliente + tramo entrante (caso plano)', () => {
    // saliente dejó de marcar en 90, última lectura saliente fue 70 → 20 m³
    // entrante marcaba 0 al instalar, ahora 30 → 30 m³; total 50
    const r = calcularConsumoConReemplazo({
      lecturaFinalAnterior: 90,
      ultimaLecturaSaliente: 70,
      lecturaInicialNuevo: 0,
      lecturaActualEntrante: 30,
    });
    expect(r).toEqual({ ok: true, consumoM3: 50, huboRollover: false });
  });

  it('entrante con lectura inicial no nula', () => {
    const r = calcularConsumoConReemplazo({
      lecturaFinalAnterior: 100,
      ultimaLecturaSaliente: 70,
      lecturaInicialNuevo: 5,
      lecturaActualEntrante: 25,
    });
    // (100-70) + (25-5) = 30 + 20 = 50
    expect(r).toEqual({ ok: true, consumoM3: 50, huboRollover: false });
  });

  it('tramo saliente negativo → rechazo (datos incoherentes)', () => {
    const r = calcularConsumoConReemplazo({
      lecturaFinalAnterior: 70,
      ultimaLecturaSaliente: 90, // no tiene sentido: el saliente bajó
      lecturaInicialNuevo: 0,
      lecturaActualEntrante: 30,
    });
    expect(r).toEqual({ ok: false, error: 'datos_invalidos' });
  });

  it('tramo entrante negativo → rechazo (datos incoherentes)', () => {
    const r = calcularConsumoConReemplazo({
      lecturaFinalAnterior: 90,
      ultimaLecturaSaliente: 70,
      lecturaInicialNuevo: 40,
      lecturaActualEntrante: 30, // menor que lo inicial
    });
    expect(r).toEqual({ ok: false, error: 'datos_invalidos' });
  });
});

describe('clasificarAnomalia (puntos 5 y 6)', () => {
  // configuracion por defecto: alto 150%, piso 100 m³, bajo 20%.
  const base = { factorConsumoAltoPct: 150, pisoConsumoAltoM3: 100, factorConsumoBajoPct: 20 };

  it('consumo cero → consumo_cero (sin depender del histórico)', () => {
    expect(clasificarAnomalia({ ...base, consumoM3: 0, promedioHistoricoM3: 50 })).toBe('consumo_cero');
    expect(clasificarAnomalia({ ...base, consumoM3: 0, promedioHistoricoM3: null })).toBe('consumo_cero');
  });

  it('sin histórico (primera lectura): no marca anomalía relativa', () => {
    expect(clasificarAnomalia({ ...base, consumoM3: 25, promedioHistoricoM3: null })).toBe('normal');
  });

  it('consumo alto: supera el % del promedio Y supera el piso', () => {
    // promedio 100 → umbral alto 150; consumo 160 (>150) Y >100 piso
    expect(clasificarAnomalia({ ...base, consumoM3: 160, promedioHistoricoM3: 100 })).toBe('consumo_alto');
  });

  it('consumo alto SIN superar el piso: NO es anomalía (punto 5 exige ambos)', () => {
    // promedio 10 → umbral alto 15; consumo 16 (>15) pero el piso es 100 → no alto
    expect(clasificarAnomalia({ ...base, consumoM3: 16, promedioHistoricoM3: 10 })).toBe('normal');
  });

  it('consumo bajo: inferior al % del promedio', () => {
    // promedio 100 → umbral bajo 20; consumo 15 (<20)
    expect(clasificarAnomalia({ ...base, consumoM3: 15, promedioHistoricoM3: 100 })).toBe('consumo_bajo');
  });

  it('consumo dentro del rango normal', () => {
    // promedio 100 → umbrales 20 y 150; consumo 80 normal
    expect(clasificarAnomalia({ ...base, consumoM3: 80, promedioHistoricoM3: 100 })).toBe('normal');
  });
});

describe('propiedades de consumo (ESTRATEGIA-CALIDAD §5.4)', () => {
  it('el consumo nunca es negativo ni mayor que la capacidad' +
     ', y el resultado es determinista (mismo insumo → mismo resultado)', () => {
    const casos: Array<{ lecturaAnterior: number; lecturaActual: number; capacidadMaxima: number }> = [
      { lecturaAnterior: 0, lecturaActual: 25, capacidadMaxima: CAP5 },
      { lecturaAnterior: 90000, lecturaActual: 5, capacidadMaxima: CAP5 },
      { lecturaAnterior: 80000, lecturaActual: 10, capacidadMaxima: CAP5 }, // rechazo
      { lecturaAnterior: 99990, lecturaActual: 0, capacidadMaxima: CAP5 },
      { lecturaAnterior: 100, lecturaActual: 950, capacidadMaxima: CAP6 },
    ];
    for (const c of casos) {
      const a = calcularConsumoPeriodo({ ...c, umbralRolloverPct: UMBRAL });
      const b = calcularConsumoPeriodo({ ...c, umbralRolloverPct: UMBRAL });
      expect(a).toEqual(b); // determinismo
      if (a.ok) {
        expect(a.consumoM3).toBeGreaterThanOrEqual(0);
        expect(a.consumoM3).toBeLessThanOrEqual(c.capacidadMaxima);
      }
    }
  });
});

