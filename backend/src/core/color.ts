// Validación y conversión del color de acento por acueducto (023). Puro, sin
// dependencias externas — el mismo criterio de core/ que el resto del
// proyecto (CLAUDE.md §5.3).

const PATRON_HEX = /^#[0-9a-fA-F]{6}$/;

export function esColorHexValido(valor: string): boolean {
  return PATRON_HEX.test(valor);
}

/**
 * Convierte "#RRGGBB" a los floats 0–1 que espera `rgb()` de pdf-lib.
 * El llamante SIEMPRE valida con esColorHexValido antes — nunca se le pasa
 * un valor sin validar, ni desde la ruta ni desde la base (CHECK constraint
 * de la migración 023).
 */
export function hexARgb01(hex: string): { r: number; g: number; b: number } {
  if (!esColorHexValido(hex)) {
    throw new Error(`Color hexadecimal inválido: ${hex}`);
  }
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return { r, g, b };
}
