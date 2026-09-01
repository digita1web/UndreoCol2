import { describe, expect, it } from 'vitest';
import { calcularNivel } from '../../src/cron/nivel-monitoreo';

describe('calcularNivel', () => {
  it('100 MB → ok y 20% del límite', () => {
    const r = calcularNivel(100);
    expect(r.nivel).toBe('ok');
    expect(r.porcentaje).toBe(20);
  });

  it('300 MB → atencion', () => {
    expect(calcularNivel(300).nivel).toBe('atencion');
  });

  it('400 MB → alerta', () => {
    expect(calcularNivel(400).nivel).toBe('alerta');
  });

  it('480 MB → critico', () => {
    expect(calcularNivel(480).nivel).toBe('critico');
  });

  it('500 MB (límite) → critico y 100%', () => {
    const r = calcularNivel(500);
    expect(r.nivel).toBe('critico');
    expect(r.porcentaje).toBe(100);
  });

  it('decimal: 10.91 MB → 2.18% (2 decimales)', () => {
    const r = calcularNivel(10.91);
    expect(r.porcentaje).toBe(2.18);
    expect(r.nivel).toBe('ok');
  });
});
