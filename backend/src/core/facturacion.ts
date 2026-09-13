// Lógica de negocio pura de facturación (armado de renglones, mora, total,
// número de factura, anomalías de simulación). Sin dependencias de Hono,
// Cloudflare ni Supabase (CLAUDE.md §5.3).
// Referencia: specs/005-facturacion/plan.md §4 y spec.md §3.2/§5.
//
// Reutiliza `calcularSubtotalServicio` de core/tarifas.ts (fórmula D-1, límite
// básico INCLUSIVO). El dinero se expresa en pesos sin centavos: el redondeo a
// la unidad se aplica UNA sola vez, en el subtotal de cada renglón
// (CLAUDE.md §5.6). Los valores por bloque (valor_basico/valor_no_basico/
// cargo_fijo) se guardan en bruto (2 decimales) para auditoría; el `subtotal`
// del renglón es el peso ya redondeado que se suma en la factura.

import { calcularSubtotalServicio, type Tarifa, type TipoCalculo } from './tarifas';

export interface RenglonFactura {
  servicioId: string;
  descripcion: string;
  tipoCalculo: TipoCalculo;
  tarifaId: string;
  consumoM3: number;
  cargoFijo: number;
  consumoBasicoM3: number;
  valorBasico: number;
  consumoNoBasicoM3: number;
  valorNoBasico: number;
  subtotal: number; // peso redondeado a la unidad (CLAUDE.md §5.6)
  orden: number;
}

export interface ServicioParaRenglon {
  id: string;
  nombre: string;
  tipoCalculo: TipoCalculo;
}

function redondear2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// punto 10: un renglón por servicio activo, todos sobre el MISMO consumo_m3
// ---------------------------------------------------------------------------
export function armarRenglones(input: {
  servicios: ServicioParaRenglon[];
  /** tarifa vigente por servicio.id (solo los que SÍ tienen tarifa). */
  tarifasVigentes: Map<string, Tarifa>;
  /** id de la tarifa vigente por servicio.id (para tarifa_id). */
  tarifasIds: Map<string, string>;
  consumoM3: number;
}): RenglonFactura[] {
  const { servicios, tarifasVigentes, tarifasIds, consumoM3 } = input;

  return servicios
    .filter((s) => tarifasVigentes.has(s.id))
    .map((s, i) => {
      const tarifa = tarifasVigentes.get(s.id)!;
      const tarifaId = tarifasIds.get(s.id) ?? '';

      if (s.tipoCalculo === 'fijo') {
        return {
          servicioId: s.id,
          descripcion: s.nombre,
          tipoCalculo: 'fijo',
          tarifaId,
          consumoM3: 0,
          cargoFijo: redondear2(tarifa.cargoFijo),
          consumoBasicoM3: 0,
          valorBasico: 0,
          consumoNoBasicoM3: 0,
          valorNoBasico: 0,
          subtotal: calcularSubtotalServicio('fijo', tarifa, consumoM3),
          orden: i + 1,
        };
      }

      // por_consumo (D-1): límite INCLUSIVO
      const consumoBasicoM3 = Math.min(consumoM3, tarifa.limiteBasicoM3);
      const consumoNoBasicoM3 = Math.max(0, consumoM3 - tarifa.limiteBasicoM3);
      return {
        servicioId: s.id,
        descripcion: s.nombre,
        tipoCalculo: 'por_consumo',
        tarifaId,
        consumoM3,
        cargoFijo: redondear2(tarifa.cargoFijo),
        consumoBasicoM3,
        valorBasico: redondear2(consumoBasicoM3 * tarifa.precioBasicoM3),
        consumoNoBasicoM3,
        valorNoBasico: redondear2(consumoNoBasicoM3 * tarifa.precioNoBasicoM3),
        subtotal: calcularSubtotalServicio('por_consumo', tarifa, consumoM3),
        orden: i + 1,
      };
    });
}

// ---------------------------------------------------------------------------
// punto 11: mora sobre el saldo vencido EXCLUYENDO la factura actual
// ---------------------------------------------------------------------------
export function calcularRecargoMora(porcentajeMoraPct: number, saldoVencido: number): number {
  if (saldoVencido <= 0 || porcentajeMoraPct <= 0) return 0;
  // recargo = % sobre el saldo vencido del MISMO suscriptor (excluye la factura
  // actual porque el saldo se calcula sin contarla). Peso redondeado a la unidad.
  return Math.round((saldoVencido * porcentajeMoraPct) / 100);
}

// ---------------------------------------------------------------------------
// §2.9: total = subtotal_servicios + recargo_mora + saldo_anterior
// ---------------------------------------------------------------------------
export function componerTotal(input: {
  subtotalServicios: number;
  recargoMora: number;
  saldoAnterior: number;
}): number {
  return Math.round(input.subtotalServicios + input.recargoMora + input.saldoAnterior);
}

// ---------------------------------------------------------------------------
// D-3: número {prefijo}-{YYYY}-{NNNNN}, consecutivo de 5 dígitos
// ---------------------------------------------------------------------------
export function componerNumeroFactura(prefijo: string, anio: number, consecutivo: number): string {
  const num = Math.max(0, Math.floor(consecutivo));
  const n5 = String(num).padStart(5, '0');
  return `${prefijo}-${anio}-${n5}`;
}

// ---------------------------------------------------------------------------
// Anomalías de la simulación (spec §3.3)
// ---------------------------------------------------------------------------
type TipoAnomaliaFacturacion =
  | 'consumo_atipico'       // la lectura del suscriptor quedó en revisión (alto/bajo/cero)
  | 'usuario_sin_lectura'   // no tiene lectura en el periodo
  | 'sin_tarifa'            // tarifa_vigente() devuelve NULL → NO se emite (punto 9d)
  | 'total_cero_o_negativo'
  | 'variacion_superior_20'; // vs el total del periodo anterior

export interface AnomaliaFacturacion {
  tipo: TipoAnomaliaFacturacion;
  usuarioServicioId: string;
  detalle: string;
}

// Datos mínimos que la capa de simulación ya resolvió (lib/facturacion.ts); el
// core solo clasifica de forma pura.
export function clasificarAnomaliasFacturacion(input: {
  usuarioServicioId: string;
  tieneLectura: boolean;
  revisionLectura: 'normal' | 'consumo_alto' | 'consumo_bajo' | 'consumo_cero';
  tieneTarifa: boolean;
  total: number;
  totalPeriodoAnterior: number | null;
}): AnomaliaFacturacion[] {
  const anomalias: AnomaliaFacturacion[] = [];
  const base = input.usuarioServicioId;

  if (!input.tieneLectura) {
    anomalias.push({ tipo: 'usuario_sin_lectura', usuarioServicioId: base, detalle: 'Sin lectura en el periodo' });
  } else if (input.revisionLectura !== 'normal') {
    anomalias.push({ tipo: 'consumo_atipico', usuarioServicioId: base, detalle: `Lectura en revisión: ${input.revisionLectura}` });
  }

  if (!input.tieneTarifa) {
    anomalias.push({ tipo: 'sin_tarifa', usuarioServicioId: base, detalle: 'Sin tarifa vigente: no se emite (9d)' });
  }

  if (input.total <= 0) {
    anomalias.push({ tipo: 'total_cero_o_negativo', usuarioServicioId: base, detalle: `Total ${input.total}` });
  }

  if (
    input.totalPeriodoAnterior !== null &&
    input.totalPeriodoAnterior > 0 &&
    input.total > 0
  ) {
    const variacion = Math.abs(input.total - input.totalPeriodoAnterior) / input.totalPeriodoAnterior;
    if (variacion > 0.2) {
      anomalias.push({
        tipo: 'variacion_superior_20',
        usuarioServicioId: base,
        detalle: `Variación ${Math.round(variacion * 100)}% vs periodo anterior (${input.totalPeriodoAnterior})`,
      });
    }
  }

  return anomalias;
}

