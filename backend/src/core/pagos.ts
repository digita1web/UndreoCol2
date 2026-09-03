// Lógica de negocio pura de pagos: redondeo del valor, distribución de un pago
// entre las facturas pendientes del suscriptor (más antigua primero) y estado
// derivado de la factura tras abonar. Sin dependencias de Hono, Cloudflare ni
// Supabase (CLAUDE.md §5.3).
// Referencia: specs/007-pagos-y-cartera/plan.md §4 y spec.md §3.2/§3.3.
//
// La RPC de la base (registrar_pago) es la que VALIDA y APLICA con bloqueo
// atómico; esta capa es la que CALCULA cuánto va a cada factura y el remanente
// (el dinero se calcula aquí, nunca en la ruta ni en SQL ad-hoc — §5.3).
// Regla 14: el sobrante de un pago no se pierde (queda a favor del suscriptor).

export type MetodoPago = 'efectivo' | 'transferencia' | 'consignacion' | 'pse' | 'otro';

// Factura pendiente candidata a recibir un abono (ya filtrada por cliente/
// suscriptor, no anulada y con saldo > 0; se ordena por fecha de vencimiento).
export interface FacturaPendienteParaPago {
  facturaId: string;
  /** total - total_pagado */
  saldo: number;
  /** fecha de vencimiento (AAAA-MM-DD): la más antigua recibe el abono primero. */
  fechaVencimiento: string;
}

export interface AplicacionCalculada {
  facturaId: string;
  valor: number;
}

export interface ResultadoDistribucion {
  aplicaciones: AplicacionCalculada[];
  /** valor del pago sin aplicar → a favor del suscriptor (regla 14). */
  remanente: number;
}

// Regla única de redondeo del peso colombiano (CLAUDE.md §5.6): el valor del
// pago se redondea a la unidad UNA vez, aquí (mismo Math.round que usa
// core/facturacion.ts para los totales).
export function redondearPeso(x: number): number {
  return Math.round(x + Number.EPSILON);
}

// Distribuye el valor del pago entre las facturas candidatas (más antigua
// primero por fecha_vencimiento). Si facturasSeleccionadas es null se aplica a
// todas las candidatas; si viene, primero a las indicadas (las que existan entre
// las candidatas) y el sobrante sigue a las demás candidatas. Nunca abona más
// del saldo de una factura. Devuelve las aplicaciones y el remanente.
export function distribuirPago(input: {
  candidatas: FacturaPendienteParaPago[];
  facturasSeleccionadas: string[] | null;
  valor: number;
}): ResultadoDistribucion {
  const { facturasSeleccionadas } = input;
  const valor = redondearPeso(input.valor);
  if (valor <= 0) {
    return { aplicaciones: [], remanente: 0 };
  }

  const ordenadas = [...input.candidatas].sort((a, b) =>
    a.fechaVencimiento.localeCompare(b.fechaVencimiento),
  );
  const seleccion = facturasSeleccionadas ? new Set(facturasSeleccionadas) : null;

  const enOrden: FacturaPendienteParaPago[] = [];
  if (seleccion) {
    enOrden.push(...ordenadas.filter((f) => seleccion.has(f.facturaId)));
    enOrden.push(...ordenadas.filter((f) => !seleccion.has(f.facturaId)));
  } else {
    enOrden.push(...ordenadas);
  }

  const aplicaciones: AplicacionCalculada[] = [];
  let restante = valor;

  for (const factura of enOrden) {
    if (restante <= 0) break;
    const abono = Math.min(redondearPeso(factura.saldo), restante);
    if (abono > 0) {
      aplicaciones.push({ facturaId: factura.facturaId, valor: abono });
      restante -= abono;
    }
  }

  return { aplicaciones, remanente: restante };
}

// Estado derivado de la factura tras abonar: pagada solo cuando el total quedó
// cubierto; con saldo restante sigue sin pagar (el vencida se deriva por fecha
// en las consultas, spec §3.5).
export function calcularEstadoTrasPago(total: number, totalPagado: number): 'pagada' | 'pendiente' {
  return totalPagado >= total ? 'pagada' : 'pendiente';
}
