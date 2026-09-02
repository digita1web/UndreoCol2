import { describe, expect, it } from 'vitest';
import { calcularSubtotalServicio, type Tarifa } from '../../src/core/tarifas';

const tarifaEstrato3: Tarifa = {
  cargoFijo: 5000,
  limiteBasicoM3: 22,
  precioBasicoM3: 1200,
  precioNoBasicoM3: 2400,
};

describe('calcularSubtotalServicio — por_consumo', () => {
  it('consumo == límite básico: todo a precio básico (D-1, límite INCLUSIVO)', () => {
    // 5000 + 22*1200 = 31400
    expect(calcularSubtotalServicio('por_consumo', tarifaEstrato3, 22)).toBe(31400);
  });

  it('consumo == límite - 1: todo a precio básico', () => {
    // 5000 + 21*1200 = 30200
    expect(calcularSubtotalServicio('por_consumo', tarifaEstrato3, 21)).toBe(30200);
  });

  it('consumo == límite + 1: 1 m³ pasa a precio no básico', () => {
    // 5000 + 22*1200 + 1*2400 = 33800
    expect(calcularSubtotalServicio('por_consumo', tarifaEstrato3, 23)).toBe(33800);
  });

  it('consumo excede el límite (ejemplo de la especificación: 25 m³, límite 22)', () => {
    // 5000 + 22*1200 + 3*2400 = 38600
    expect(calcularSubtotalServicio('por_consumo', tarifaEstrato3, 25)).toBe(38600);
  });

  it('consumo 0: solo el cargo fijo', () => {
    expect(calcularSubtotalServicio('por_consumo', tarifaEstrato3, 0)).toBe(5000);
  });

  it('redondea a la unidad (peso colombiano, sin centavos)', () => {
    const tarifaConDecimales: Tarifa = {
      cargoFijo: 5000.4,
      limiteBasicoM3: 10,
      precioBasicoM3: 1000.33,
      precioNoBasicoM3: 2000,
    };
    // 5000.4 + 10*1000.33 = 15003.7 → redondea a 15004
    expect(calcularSubtotalServicio('por_consumo', tarifaConDecimales, 10)).toBe(15004);
  });
});

describe('calcularSubtotalServicio — fijo', () => {
  it('ignora consumoM3 y devuelve solo el cargo fijo', () => {
    const tarifaReconexion: Tarifa = {
      cargoFijo: 45000,
      limiteBasicoM3: 0,
      precioBasicoM3: 0,
      precioNoBasicoM3: 0,
    };
    expect(calcularSubtotalServicio('fijo', tarifaReconexion, 0)).toBe(45000);
    expect(calcularSubtotalServicio('fijo', tarifaReconexion, 999)).toBe(45000);
  });

  it('redondea el cargo fijo a la unidad', () => {
    const tarifa: Tarifa = { cargoFijo: 45000.6, limiteBasicoM3: 0, precioBasicoM3: 0, precioNoBasicoM3: 0 };
    expect(calcularSubtotalServicio('fijo', tarifa, 0)).toBe(45001);
  });
});
