// Lógica de negocio pura del cálculo de tarifas (D-1). Sin dependencias de
// Hono, Cloudflare ni Supabase (CLAUDE.md §5.3).

export type TipoCalculo = 'por_consumo' | 'fijo';

export interface Tarifa {
  cargoFijo: number;
  limiteBasicoM3: number;
  precioBasicoM3: number;
  precioNoBasicoM3: number;
}

// Fórmula D-1. limiteBasicoM3 es INCLUSIVO: con límite 22 y consumo 25, los
// m³ 1-22 van a precio básico y los m³ 23-25 a precio no básico.
// 'fijo' ignora consumoM3 y devuelve solo cargoFijo.
// El peso colombiano no usa centavos en facturación de servicios: se
// redondea a la unidad una sola vez, al final (CLAUDE.md §5.6).
export function calcularSubtotalServicio(
  tipoCalculo: TipoCalculo,
  tarifa: Tarifa,
  consumoM3: number,
): number {
  if (tipoCalculo === 'fijo') {
    return Math.round(tarifa.cargoFijo);
  }

  const consumoBasicoM3 = Math.min(consumoM3, tarifa.limiteBasicoM3);
  const consumoNoBasicoM3 = Math.max(0, consumoM3 - tarifa.limiteBasicoM3);

  const subtotal =
    tarifa.cargoFijo +
    consumoBasicoM3 * tarifa.precioBasicoM3 +
    consumoNoBasicoM3 * tarifa.precioNoBasicoM3;

  return Math.round(subtotal);
}
