import { describe, expect, it } from 'vitest';
import { validarCamposEditables } from '../../src/lib/suscriptores';

// Hallazgo de security-review (Sesión 057): PATCH /suscriptores/:id no
// bloqueaba `estado`, permitiendo saltarse corte/reconexión (motivo
// obligatorio, solo admin_acueducto — CLAUDE.md §10 puntos 16-19). Mismo
// criterio ya usado acá para `codigo_suscriptor`.
describe('validarCamposEditables', () => {
  it('rechaza codigo_suscriptor', () => {
    expect(validarCamposEditables({ codigo_suscriptor: 'A-001' })).toMatch(/codigo_suscriptor/);
  });

  it('rechaza estado', () => {
    expect(validarCamposEditables({ estado: 'cortado' })).toMatch(/estado/);
  });

  it('acepta campos editables normales', () => {
    expect(validarCamposEditables({ nombre: 'Nuevo nombre', telefono: '3000000000' })).toBeNull();
  });

  it('acepta un body vacío', () => {
    expect(validarCamposEditables({})).toBeNull();
  });
});
