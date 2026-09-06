import { describe, expect, it } from 'vitest';
import {
  armarEjeTendencia,
  armarTendencia,
  hoyUtc,
  limitesConsultaTendencia,
  resumirCartera,
} from '../../src/lib/dashboard';
import type { FilaCartera } from '../../src/lib/pagos';

describe('hoyUtc (decisión D-1: reloj UTC del módulo de pagos)', () => {
  it('devuelve la fecha UTC de una fecha/hora dada', () => {
    expect(hoyUtc(new Date('2026-09-05T03:00:00Z'))).toBe('2026-09-05');
  });
  it('sigue el reloj UTC, no la hora local: 23:30 -05:00 ya es el día siguiente en UTC', () => {
    expect(hoyUtc(new Date('2026-09-05T23:30:00-05:00'))).toBe('2026-09-06');
  });
});

describe('limitesConsultaTendencia', () => {
  it('eje estándar: desde el mes que abre los 12 meses hasta el fin del mes actual', () => {
    expect(limitesConsultaTendencia('2026-09-05')).toEqual({
      desde: '2025-10-01',
      hasta: '2026-09-30',
    });
  });
  it('cruce de año: hoy en enero abre en febrero del año anterior', () => {
    expect(limitesConsultaTendencia('2026-01-15')).toEqual({
      desde: '2025-02-01',
      hasta: '2026-01-31',
    });
  });
  it('año bisiesto: febrero 2024 cierra el 29', () => {
    expect(limitesConsultaTendencia('2024-02-15')).toEqual({
      desde: '2023-03-01',
      hasta: '2024-02-29',
    });
  });
});

describe('armarEjeTendencia', () => {
  it('12 buckets cronológicos terminando en el mes de hoy', () => {
    const eje = armarEjeTendencia('2026-09-05');
    expect(eje).toHaveLength(12);
    expect(eje[0]).toEqual({ anio: 2025, mes: 10, total: 0 });
    expect(eje[eje.length - 1]).toEqual({ anio: 2026, mes: 9, total: 0 });
  });
  it('cruce de año: hoy en enero abre en febrero del año anterior', () => {
    const eje = armarEjeTendencia('2026-01-15');
    expect(eje[0]).toEqual({ anio: 2025, mes: 2, total: 0 });
    expect(eje[eje.length - 1]).toEqual({ anio: 2026, mes: 1, total: 0 });
  });
});

describe('armarTendencia (spec §3.1/§3.4 y CA-1/CA-4)', () => {
  it('suma cada pago en su bucket, cero-fill y recaudo del mes actual', () => {
    const { tendencia, recaudoMes } = armarTendencia('2026-09-05', [
      { fechaPago: '2025-10-01', valor: 123456 }, // bucket más antiguo del eje
      { fechaPago: '2026-08-10', valor: 100000 }, // mes anterior: tendencia, NO recaudoMes
      { fechaPago: '2026-09-03', valor: 50000 }, // mes en curso
      { fechaPago: '2026-09-30', valor: 20000 }, // mes en curso con fecha posterior a hoy: cuenta igual
    ]);
    expect(tendencia).toHaveLength(12);
    expect(tendencia[0]).toEqual({ anio: 2025, mes: 10, total: 123456 });
    const agosto = tendencia.find((b) => b.anio === 2026 && b.mes === 8);
    expect(agosto?.total).toBe(100000);
    const septiembre = tendencia.find((b) => b.anio === 2026 && b.mes === 9);
    expect(septiembre?.total).toBe(70000);
    expect(recaudoMes).toBe(70000);
    // un mes sin pagos dentro del eje queda en 0 (no se omite)
    expect(tendencia.some((b) => b.total === 0)).toBe(true);
  });

  it('un pago fuera del eje se ignora (defensivo; la consulta ya lo acota)', () => {
    const { tendencia } = armarTendencia('2026-09-05', [
      { fechaPago: '2026-10-01', valor: 999999 }, // mes siguiente al eje
    ]);
    expect(tendencia.reduce((acc, b) => acc + b.total, 0)).toBe(0);
  });

  it('redondea cada bucket a pesos enteros (0.4 abajo, 0.5 arriba)', () => {
    const { tendencia, recaudoMes } = armarTendencia('2026-09-05', [
      { fechaPago: '2026-09-01', valor: 100.4 }, // mes actual → 100
      { fechaPago: '2026-08-10', valor: 100.5 }, // mes anterior → 101
    ]);
    const septiembre = tendencia.find((b) => b.anio === 2026 && b.mes === 9);
    expect(septiembre?.total).toBe(100);
    expect(recaudoMes).toBe(100);
    const agosto = tendencia.find((b) => b.anio === 2026 && b.mes === 8);
    expect(agosto?.total).toBe(101);
  });
});

describe('resumirCartera (spec §3.2/§3.3 y CA-2)', () => {
  const fila = (parcial: Partial<FilaCartera>): FilaCartera => ({
    usuarioServicioId: 'u1',
    nombre: 'Prueba',
    codigoSuscriptor: 'COD-1',
    estado: 'activo',
    porVencer: 0,
    vencida: 0,
    diasMoraMax: null,
    facturaVencidaMasAntigua: null,
    totalAdeudado: 0,
    saldoFavor: 0,
    ...parcial,
  });

  it('suma porVencer/vencida y cuenta morosos (vencida > 0)', () => {
    const r = resumirCartera([
      fila({ porVencer: 100000 }), // pendiente, sin mora
      fila({ vencida: 50000 }), // moroso
      fila({ vencida: 25000 }), // moroso
    ]);
    expect(r.carteraPendiente).toBe(100000);
    expect(r.carteraVencida).toBe(75000);
    expect(r.usuariosEnMora).toBe(2);
  });

  it('un suscriptor `cortado` con deuda vencida cuenta como moroso; uno con solo saldo a favor no', () => {
    const r = resumirCartera([
      fila({ estado: 'cortado', vencida: 80000 }), // la mora la define la deuda, no el estado
      fila({ estado: 'activo', saldoFavor: 30000 }), // sin deuda viva: no es moroso
    ]);
    expect(r.usuariosEnMora).toBe(1);
    expect(r.carteraVencida).toBe(80000);
  });

  it('sin filas → ceros', () => {
    expect(resumirCartera([])).toEqual({ carteraPendiente: 0, carteraVencida: 0, usuariosEnMora: 0 });
  });
});
