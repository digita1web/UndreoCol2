import { describe, expect, it } from 'vitest';
import { esColorHexValido, hexARgb01 } from './color';

describe('esColorHexValido', () => {
  it('acepta hex válido en mayúsculas y minúsculas', () => {
    expect(esColorHexValido('#14408c')).toBe(true);
    expect(esColorHexValido('#14408C')).toBe(true);
    expect(esColorHexValido('#FFFFFF')).toBe(true);
    expect(esColorHexValido('#000000')).toBe(true);
  });

  it('rechaza sin "#"', () => {
    expect(esColorHexValido('14408C')).toBe(false);
  });

  it('rechaza longitud corta o larga', () => {
    expect(esColorHexValido('#14408')).toBe(false);
    expect(esColorHexValido('#14408CC')).toBe(false);
    expect(esColorHexValido('#fff')).toBe(false);
  });

  it('rechaza caracteres fuera de rango hexadecimal', () => {
    expect(esColorHexValido('#GGGGGG')).toBe(false);
    expect(esColorHexValido('rojo')).toBe(false);
    expect(esColorHexValido('')).toBe(false);
  });
});

describe('hexARgb01', () => {
  it('convierte el color por defecto (#14408C) cerca del rgb(0.08, 0.25, 0.55) anterior', () => {
    // Redondeo de 8 bits por canal: 0.08×255≈20(0x14), 0.25×255≈64(0x40),
    // 0.55×255≈140(0x8C) — la vuelta no da el float exacto, pero queda a
    // menos de 1/255 de distancia (tolerancia de 2 decimales). CA-1.
    const { r, g, b } = hexARgb01('#14408C');
    expect(r).toBeCloseTo(0.08, 2);
    expect(g).toBeCloseTo(0.25, 2);
    expect(b).toBeCloseTo(0.55, 2);
  });

  it('convierte blanco y negro exactos', () => {
    expect(hexARgb01('#FFFFFF')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexARgb01('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('lanza con un color inválido en vez de devolver algo silencioso', () => {
    expect(() => hexARgb01('rojo')).toThrow(/inválido/);
  });
});
