// Capa fina de acceso a datos y orquestación de pagos/cartera
// (specs/007-pagos-y-cartera/plan.md §3/§4). Sin cálculo de dinero ad-hoc: la
// distribución de un pago SIEMPRE pasa por core/pagos.ts (CLAUDE.md §5.3); las
// RPC registrar_pago/anular_pago validan con FOR UPDATE y aplican. Esta capa
// solo lee (candidatas, cartera, historiales), arma las aplicaciones con core y
// devuelve lo que traen las RPC.
//
// Cartera/historiales son consultas de SOLO LECTURA por cliente_id (RLS FORCE):
// agregan saldos ya persistidos en la base y derivan 'vencida' por fecha
// (spec §3.5); no crean dinero.

import type { SupabaseClient } from '@supabase/supabase-js';
import { distribuirPago, redondearPeso, type MetodoPago } from '../core/pagos';

interface FacturaPendienteRow {
  id: string;
  usuario_servicio_id: string;
  numero: string;
  total: number;
  total_pagado: number;
  fecha_vencimiento: string;
  estado: 'pendiente' | 'pagada' | 'vencida' | 'anulada';
}

export interface RegistrarPagoInput {
  usuario_servicio_id: string;
  valor: number;
  metodo: MetodoPago;
  fecha_pago?: string;
  referencia?: string | null;
  observaciones?: string | null;
  /** Facturas a abonar elegidas por el admin; null = aplicar a las pendientes
   *  más antiguas primero. */
  factura_ids?: string[] | null;
}

export interface ResultadoRegistrarPago {
  pago: Record<string, unknown>;
  aplicaciones: Array<{ factura_id: string; valor: number }>;
  remanente: number;
  facturas: Array<Record<string, unknown>>;
}

const LIMITE_PAGINACION = 1000;

// ---------------------------------------------------------------------------
// Registro y anulación (RPCs atómicas; el cálculo de la distribución es de core)
// ---------------------------------------------------------------------------

export async function registrarPago(
  supabase: SupabaseClient,
  clienteId: string,
  perfilId: string,
  input: RegistrarPagoInput,
): Promise<ResultadoRegistrarPago> {
  const valor = redondearPeso(input.valor);
  if (valor <= 0) throw new Error('El valor del pago debe ser mayor que cero');

  // candidatas: facturas no anuladas con saldo vivo del suscriptor
  const { data: filas, error } = await supabase
    .from('facturas')
    .select('id, usuario_servicio_id, numero, total, total_pagado, fecha_vencimiento, estado')
    .eq('cliente_id', clienteId)
    .eq('usuario_servicio_id', input.usuario_servicio_id)
    .neq('estado', 'anulada')
    .range(0, LIMITE_PAGINACION - 1);
  if (error) throw new Error(`No se pudieron leer las facturas del suscriptor: ${error.message}`);

  const candidatas = ((filas ?? []) as FacturaPendienteRow[])
    .filter((f) => f.total > f.total_pagado)
    .map((f) => ({ facturaId: f.id, saldo: f.total - f.total_pagado, fechaVencimiento: f.fecha_vencimiento }));

  const distribucion = distribuirPago({
    candidatas,
    facturasSeleccionadas: input.factura_ids?.length ? input.factura_ids : null,
    valor,
  });
  const aplicacionesJson = distribucion.aplicaciones.map((a) => ({ factura_id: a.facturaId, valor: a.valor }));

  const { data, error: errRpc } = await supabase.rpc('registrar_pago', {
    p_cliente_id: clienteId,
    p_usuario_servicio_id: input.usuario_servicio_id,
    p_valor: valor,
    p_aplicaciones: aplicacionesJson,
    p_recibido_por: perfilId,
    p_fecha_pago: input.fecha_pago ?? undefined,
    p_metodo: input.metodo,
    p_referencia: input.referencia ?? null,
    p_observaciones: input.observaciones ?? null,
  });
  if (errRpc) throw new Error(errRpc.message);
  return data as unknown as ResultadoRegistrarPago;
}

export async function anularPago(
  supabase: SupabaseClient,
  clienteId: string,
  pagoId: string,
  motivo: string,
  perfilId: string,
): Promise<{ pago: Record<string, unknown>; facturas: Array<Record<string, unknown>> }> {
  if (!motivo || !motivo.trim()) throw new Error('El motivo de anulación es obligatorio');
  const { data, error } = await supabase.rpc('anular_pago', {
    p_cliente_id: clienteId,
    p_pago_id: pagoId,
    p_motivo: motivo.trim(),
    p_perfil: perfilId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as { pago: Record<string, unknown>; facturas: Array<Record<string, unknown>> };
}

// ---------------------------------------------------------------------------
// Reporte de cartera por suscriptor (solo lectura; agrega en TS como el patrón
// de simularPeriodo; para un acueducto de ~1000 suscriptores cabe en el fetch)
// ---------------------------------------------------------------------------

export interface FilaCartera {
  usuarioServicioId: string;
  nombre: string;
  codigoSuscriptor: string;
  estado: string;
  porVencer: number;
  vencida: number;
  diasMoraMax: number | null;
  facturaVencidaMasAntigua: { numero: string; diasMora: number } | null;
  totalAdeudado: number;
  saldoFavor: number;
}

export interface FiltrosCartera {
  suscriptorId?: string | null;
  soloMorosos?: boolean;
}

export async function obtenerCartera(
  supabase: SupabaseClient,
  clienteId: string,
  filtros: FiltrosCartera = {},
): Promise<FilaCartera[]> {
  const hoy = new Date();
  const hoyIso = hoy.toISOString().slice(0, 10);

  // facturas del cliente (no anuladas) con saldo vivo
  let query = supabase
    .from('facturas')
    .select('id, usuario_servicio_id, numero, total, total_pagado, fecha_vencimiento, estado')
    .eq('cliente_id', clienteId)
    .neq('estado', 'anulada')
    .range(0, LIMITE_PAGINACION - 1);
  if (filtros.suscriptorId) query = query.eq('usuario_servicio_id', filtros.suscriptorId);
  const { data: facturas, error: errFacturas } = await query;
  if (errFacturas) throw new Error(`No se pudo leer la cartera: ${errFacturas.message}`);

  // pagos vigentes y sus aplicaciones (para el saldo a favor: valor sin aplicar)
  const { data: pagosData, error: errPagos } = await supabase
    .from('pagos')
    .select('id, usuario_servicio_id, valor')
    .eq('cliente_id', clienteId)
    .eq('anulado', false)
    .range(0, LIMITE_PAGINACION - 1);
  if (errPagos) throw new Error(`No se pudo leer el saldo a favor: ${errPagos.message}`);

  const { data: aplicaciones, error: errAplic } = await supabase
    .from('pago_aplicaciones')
    .select('pago_id, valor')
    .eq('cliente_id', clienteId)
    .range(0, LIMITE_PAGINACION - 1);
  if (errAplic) throw new Error(`No se pudieron leer las aplicaciones: ${errAplic.message}`);

  const { data: suscriptores, error: errSusc } = await supabase
    .from('usuarios_servicio')
    .select('id, nombre, codigo_suscriptor, estado')
    .eq('cliente_id', clienteId)
    .range(0, LIMITE_PAGINACION - 1);
  if (errSusc) throw new Error(`No se pudieron leer los suscriptores: ${errSusc.message}`);

  const aplicadoPorPago = new Map<string, number>();
  for (const a of (aplicaciones ?? []) as Array<{ pago_id: string; valor: number }>) {
    aplicadoPorPago.set(a.pago_id, (aplicadoPorPago.get(a.pago_id) ?? 0) + a.valor);
  }

  const acum = new Map<
    string,
    { porVencer: number; vencida: number; diasMoraMax: number | null; vieja: { numero: string; diasMora: number } | null }
  >();
  for (const f of (facturas ?? []) as FacturaPendienteRow[]) {
    const saldo = f.total - f.total_pagado;
    if (saldo <= 0) continue;
    const vencidaPorFecha = f.fecha_vencimiento < hoyIso;
    const dias = Math.max(
      0,
      Math.floor((hoy.getTime() - new Date(f.fecha_vencimiento + 'T00:00:00').getTime()) / 86_400_000),
    );
    const previo = acum.get(f.usuario_servicio_id) ?? {
      porVencer: 0,
      vencida: 0,
      diasMoraMax: null,
      vieja: null,
    };
    if (vencidaPorFecha) {
      previo.vencida += saldo;
      if (previo.diasMoraMax === null || dias > previo.diasMoraMax) {
        previo.diasMoraMax = dias;
        previo.vieja = { numero: f.numero, diasMora: dias };
      }
    } else {
      previo.porVencer += saldo;
    }
    acum.set(f.usuario_servicio_id, previo);
  }

  const remanentePorSuscriptor = new Map<string, number>();
  for (const p of (pagosData ?? []) as Array<{ id: string; usuario_servicio_id: string; valor: number }>) {
    const remanente = p.valor - (aplicadoPorPago.get(p.id) ?? 0);
    if (remanente > 0) {
      remanentePorSuscriptor.set(
        p.usuario_servicio_id,
        (remanentePorSuscriptor.get(p.usuario_servicio_id) ?? 0) + remanente,
      );
    }
  }

  const filas: FilaCartera[] = [];
  for (const s of (suscriptores ?? []) as Array<{ id: string; nombre: string; codigo_suscriptor: string; estado: string }>) {
    const deuda = acum.get(s.id) ?? { porVencer: 0, vencida: 0, diasMoraMax: null, vieja: null };
    const total = deuda.porVencer + deuda.vencida;
    const saldoFavor = Math.round(remanentePorSuscriptor.get(s.id) ?? 0);
    // con deuda o con saldo a favor (spec §3.5/CA-4: el sobrante debe verse en la
    // cartera aunque el suscriptor ya haya quedado sin facturas pendientes)
    if (total <= 0 && saldoFavor <= 0) continue;
    if (filtros.soloMorosos && deuda.vencida <= 0) continue;
    filas.push({
      usuarioServicioId: s.id,
      nombre: s.nombre,
      codigoSuscriptor: s.codigo_suscriptor,
      estado: s.estado,
      porVencer: Math.round(deuda.porVencer),
      vencida: Math.round(deuda.vencida),
      diasMoraMax: deuda.diasMoraMax,
      facturaVencidaMasAntigua: deuda.vieja,
      totalAdeudado: Math.round(total),
      saldoFavor,
    });
  }

  filas.sort((a, b) => b.totalAdeudado - a.totalAdeudado);
  return filas;
}

// ---------------------------------------------------------------------------
// Historiales de pagos (solo lectura)
// ---------------------------------------------------------------------------

export interface AplicacionHistorial {
  id: string;
  valor: number;
  fecha_pago: string;
  metodo: string;
  referencia: string | null;
  recibido_por: string | null;
  anulado: boolean;
  motivo_anulacion: string | null;
}

export async function obtenerPagosDeFactura(
  supabase: SupabaseClient,
  clienteId: string,
  facturaId: string,
): Promise<AplicacionHistorial[]> {
  const { data, error } = await supabase
    .from('pago_aplicaciones')
    .select(
      'id, valor, pago:pagos(id, fecha_pago, metodo, referencia, recibido_por, anulado, motivo_anulacion)',
    )
    .eq('cliente_id', clienteId)
    .eq('factura_id', facturaId);
  if (error) throw new Error(`No se pudo leer el historial de la factura: ${error.message}`);
  const filas = (data ?? []) as unknown as Array<{
    id: string;
    valor: number;
    pago: {
      fecha_pago: string;
      metodo: string;
      referencia: string | null;
      recibido_por: string | null;
      anulado: boolean;
      motivo_anulacion: string | null;
    } | null;
  }>;
  return filas.map((f) => ({
    id: f.id,
    valor: f.valor,
    fecha_pago: f.pago?.fecha_pago ?? '',
    metodo: f.pago?.metodo ?? '',
    referencia: f.pago?.referencia ?? null,
    recibido_por: f.pago?.recibido_por ?? null,
    anulado: f.pago?.anulado ?? false,
    motivo_anulacion: f.pago?.motivo_anulacion ?? null,
  }));
}

export interface PagoHistorial {
  id: string;
  valor: number;
  fecha_pago: string;
  metodo: string;
  referencia: string | null;
  recibido_por: string | null;
  anulado: boolean;
  motivo_anulacion: string | null;
  aplicaciones: Array<{ factura_id: string; valor: number }>;
  sinAplicar: number; // valor del pago - suma de sus aplicaciones (saldo a favor)
}

export async function obtenerPagosDeSuscriptor(
  supabase: SupabaseClient,
  clienteId: string,
  usuarioServicioId: string,
): Promise<PagoHistorial[]> {
  const { data, error } = await supabase
    .from('pagos')
    .select(
      'id, valor, fecha_pago, metodo, referencia, recibido_por, anulado, motivo_anulacion, aplicaciones:pago_aplicaciones(factura_id, valor)',
    )
    .eq('cliente_id', clienteId)
    .eq('usuario_servicio_id', usuarioServicioId)
    .order('fecha_pago', { ascending: false });
  if (error) throw new Error(`No se pudo leer el historial del suscriptor: ${error.message}`);
  const filas = (data ?? []) as unknown as Array<{
    id: string;
    valor: number;
    fecha_pago: string;
    metodo: string;
    referencia: string | null;
    recibido_por: string | null;
    anulado: boolean;
    motivo_anulacion: string | null;
    aplicaciones: Array<{ factura_id: string; valor: number }> | null;
  }>;
  return filas.map((p) => {
    const aplicaciones = p.aplicaciones ?? [];
    const sinAplicar = p.valor - aplicaciones.reduce((acc, a) => acc + a.valor, 0);
    return {
      id: p.id,
      valor: p.valor,
      fecha_pago: p.fecha_pago,
      metodo: p.metodo,
      referencia: p.referencia,
      recibido_por: p.recibido_por,
      anulado: p.anulado,
      motivo_anulacion: p.motivo_anulacion,
      aplicaciones,
      sinAplicar: Math.round(sinAplicar),
    };
  });
}


