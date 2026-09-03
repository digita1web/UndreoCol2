import { describe, expect, it } from 'vitest';
import {
  calcularEstadoTrasPago,
  distribuirPago,
  redondearPeso,
  type FacturaPendienteParaPago,
} from '../../src/core/pagos';

const candidatas = (): FacturaPendienteParaPago[] => [
  { facturaId: 'f1', saldo: 5000, fechaVencimiento: '2026-01-10' }, // la más antigua
  { facturaId: 'f2', saldo: 10000, fechaVencimiento: '2026-02-10' },
  { facturaId: 'f3', saldo: 15000, fechaVencimiento: '2026-03-10' },
];

describe('redondearPeso (regla única, CLAUDE.md §5.6)', () => {
  it('entero se conserva', () => expect(redondearPeso(10000)).toBe(10000));
  it('redondea a la unidad (0.4 abajo)', () => expect(redondearPeso(100.4)).toBe(100));
  it('redondea a la unidad (0.5 arriba)', () => expect(redondearPeso(100.5)).toBe(101));
});

describe('distribuirPago — regla 14 y más antigua primero', () => {
  it('sin candidatas: el pago queda 100% como remanente a favor (regla 14)', () => {
    const r = distribuirPago({ candidatas: [], facturasSeleccionadas: null, valor: 5000 });
    expect(r.aplicaciones).toEqual([]);
    expect(r.remanente).toBe(5000);
  });

  it('pago exacto a la factura más antigua', () => {
    const r = distribuirPago({ candidatas: candidatas(), facturasSeleccionadas: null, valor: 5000 });
    expect(r.aplicaciones).toEqual([{ facturaId: 'f1', valor: 5000 }]);
    expect(r.remanente).toBe(0);
  });

  it('pago parcial deja la más antigua a medias', () => {
    const r = distribuirPago({ candidatas: candidatas(), facturasSeleccionadas: null, valor: 3000 });
    expect(r.aplicaciones).toEqual([{ facturaId: 'f1', valor: 3000 }]);
    expect(r.remanente).toBe(0);
  });

  it('pago que abarca varias facturas en orden de vencimiento', () => {
    const r = distribuirPago({ candidatas: candidatas(), facturasSeleccionadas: null, valor: 12000 });
    expect(r.aplicaciones).toEqual([
      { facturaId: 'f1', valor: 5000 },
      { facturaId: 'f2', valor: 7000 },
    ]);
    expect(r.remanente).toBe(0);
  });

  it('pago mayor que la deuda total: remanente a favor, sin abonar de más', () => {
    const r = distribuirPago({ candidatas: candidatas(), facturasSeleccionadas: null, valor: 35000 });
    expect(r.aplicaciones).toEqual([
      { facturaId: 'f1', valor: 5000 },
      { facturaId: 'f2', valor: 10000 },
      { facturaId: 'f3', valor: 15000 },
    ]);
    expect(r.remanente).toBe(5000); // deuda total 30000, pagó 35000
  });

  it('facturasSeleccionadas primero y el sobrante sigue a las demás (más antiguas)', () => {
    // selecciona f2 (vence 2026-02); con valor 9000 cubre f2 (10000 → solo 9000) y remanente 0
    const r = distribuirPago({
      candidatas: candidatas(),
      facturasSeleccionadas: ['f2'],
      valor: 9000,
    });
    expect(r.aplicaciones).toEqual([{ facturaId: 'f2', valor: 9000 }]);
    expect(r.remanente).toBe(0);
  });

  it('facturasSeleccionadas con sobrante que sigue a las demás', () => {
    const r = distribuirPago({
      candidatas: candidatas(),
      facturasSeleccionadas: ['f3'],
      valor: 16000, // f3 (15000) + sobrante 1000 → f1 (la más antigua de las restantes)
    });
    expect(r.aplicaciones).toEqual([
      { facturaId: 'f3', valor: 15000 },
      { facturaId: 'f1', valor: 1000 },
    ]);
    expect(r.remanente).toBe(0);
  });

  it('una factura seleccionada sin saldo no recibe abono y se sigue a las demás', () => {
    const r = distribuirPago({
      candidatas: [
        { facturaId: 'f0', saldo: 0, fechaVencimiento: '2026-01-01' },
        { facturaId: 'f1', saldo: 5000, fechaVencimiento: '2026-01-10' },
      ],
      facturasSeleccionadas: ['f0'],
      valor: 5000,
    });
    expect(r.aplicaciones).toEqual([{ facturaId: 'f1', valor: 5000 }]);
  });

  it('valor no positivo no genera aplicaciones', () => {
    const r = distribuirPago({ candidatas: candidatas(), facturasSeleccionadas: null, valor: 0 });
    expect(r.aplicaciones).toEqual([]);
    expect(r.remanente).toBe(0);
  });

  it('el valor del pago se redondea una sola vez (regla única)', () => {
    const r = distribuirPago({ candidatas: candidatas(), facturasSeleccionadas: null, valor: 100.5 });
    expect(r.aplicaciones).toEqual([{ facturaId: 'f1', valor: 101 }]);
  });
});

describe('calcularEstadoTrasPago', () => {
  it('total cubierto → pagada', () => {
    expect(calcularEstadoTrasPago(38600, 38600)).toBe('pagada');
    expect(calcularEstadoTrasPago(38600, 40000)).toBe('pagada');
  });
  it('saldo restante → pendiente (el vencida se deriva por fecha)', () => {
    expect(calcularEstadoTrasPago(38600, 10000)).toBe('pendiente');
    expect(calcularEstadoTrasPago(38600, 0)).toBe('pendiente');
  });
});
