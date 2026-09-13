// Capa fina de acceso a datos y orquestación de facturación
// (specs/005-facturacion/plan.md §3/§4). Sin lógica económica: el cálculo de
// renglones/total/mora/anomalías SIEMPRE pasa por core/facturacion.ts (y este a
// core/tarifas.ts, D-1). Esta capa solo lee (suscriptores, servicios, tarifas,
// lecturas), arma los datos de entrada y persiste.
//
// Regla del spec §3.3: la SIMULACIÓN no persiste nada (dry-run). El "gate" de la
// emisión es de UI (el botón de confirmar solo aparece tras simular en la misma
// sesión) y el backend lo protege rechazando emitir si el periodo ya tiene
// facturas (no duplicar) — ver corrección documentada en tasks.md T-004.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  armarRenglones,
  calcularRecargoMora,
  clasificarAnomaliasFacturacion,
  componerTotal,
  type AnomaliaFacturacion,
  type RenglonFactura,
} from '../core/facturacion';
import type { Tarifa } from '../core/tarifas';

export interface FacturaRow {
  id: string;
  cliente_id: string;
  usuario_servicio_id: string;
  periodo_id: string | null;
  tipo: 'ciclo' | 'reconexion' | 'ajuste';
  numero: string;
  snapshot_suscriptor: Record<string, unknown>;
  consumo_m3: number;
  subtotal_servicios: number;
  recargo_mora: number;
  saldo_anterior: number;
  total: number;
  total_pagado: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: 'pendiente' | 'pagada' | 'vencida' | 'anulada';
  motivo_anulacion: string | null;
  anulada_por: string | null;
}

export interface DetalleFacturaRow {
  id: string;
  factura_id: string;
  servicio_id: string | null;
  tarifa_id: string | null;
  orden: number;
  descripcion: string;
  tipo_calculo: 'por_consumo' | 'fijo';
  consumo_m3: number;
  cargo_fijo: number;
  consumo_basico_m3: number;
  valor_basico: number;
  consumo_no_basico_m3: number;
  valor_no_basico: number;
  subtotal: number;
}

interface SuscriptorSimulado {
  usuarioServicioId: string;
  codigoSuscriptor: string;
  nombre: string;
  categoria: string | null;
  consumoM3: number | null;
  tieneTarifa: boolean;
  renglones: RenglonFactura[];
  subtotalServicios: number;
  recargoMora: number;
  saldoAnterior: number;
  total: number;
  anomalias: AnomaliaFacturacion[];
}

export interface ResumenSimulacion {
  periodoId: string;
  totalSuscriptores: number;
  suscriptoresConFactura: number;
  consumoTotalM3: number;
  facturacionTotal: number;
  anomalias: AnomaliaFacturacion[];
  detalle: SuscriptorSimulado[];
}

const COLUMNAS_FACTURA =
  'id, cliente_id, usuario_servicio_id, periodo_id, tipo, numero, snapshot_suscriptor, consumo_m3, subtotal_servicios, recargo_mora, saldo_anterior, total, total_pagado, fecha_emision, fecha_vencimiento, estado, motivo_anulacion, anulada_por';

const COLUMNAS_DETALLE =
  'id, factura_id, servicio_id, tarifa_id, orden, descripcion, tipo_calculo, consumo_m3, cargo_fijo, consumo_basico_m3, valor_basico, consumo_no_basico_m3, valor_no_basico, subtotal';

// ---------------------------------------------------------------------------
// Simulación (dry-run): NO inserta nada (spec §3.3)
// ---------------------------------------------------------------------------
export async function simularPeriodo(
  supabase: SupabaseClient,
  clienteId: string,
  periodoId: string,
): Promise<ResumenSimulacion> {
  // contexto del periodo (su fecha define la vigencia de la tarifa: punto 12)
  const { data: periodo } = await supabase
    .from('periodos')
    .select('id, nombre, fecha_fin')
    .eq('id', periodoId)
    .single();
  if (!periodo) throw new Error('El periodo no existe');
  const fechaPeriodo = String(periodo.fecha_fin).slice(0, 10);

  // servicios activos facturables en el ciclo (punto 10)
  const { data: serviciosData } = await supabase
    .from('servicios')
    .select('id, nombre, tipo_calculo, orden')
    .eq('cliente_id', clienteId)
    .eq('activo', true)
    .eq('facturable_en_ciclo', true)
    .order('orden', { ascending: true });
  const servicios = (serviciosData ?? []).map((s) => ({
    id: s.id,
    nombre: s.nombre,
    tipoCalculo: s.tipo_calculo as 'por_consumo' | 'fijo',
  }));

  // configuración (mora; saldo en 005 = 0; lo administra 007)
  const { data: configData } = await supabase
    .from('configuracion')
    .select('porcentaje_mora, prefijo_factura')
    .eq('cliente_id', clienteId)
    .single();
  const porcentajeMora = Number(configData?.porcentaje_mora ?? 0);

  // suscriptores activos del ciclo (el cortado NO se factura; 009)
  const { data: suscriptoresData } = await supabase
    .from('usuarios_servicio')
    .select('id, codigo_suscriptor, nombre, categoria, estado, direccion')
    .eq('cliente_id', clienteId)
    .eq('estado', 'activo')
    .order('nombre', { ascending: true });
  const suscriptores = suscriptoresData ?? [];

  // lecturas del periodo (consumo por contador) y contador activo por suscriptor
  const { data: lecturasData } = await supabase
    .from('lecturas')
    .select('contador_id, lectura_actual, consumo_m3, revision')
    .eq('periodo_id', periodoId);
  const lecturasPorContador = new Map(
    (lecturasData ?? []).map((l) => [l.contador_id, l]),
  );
  const { data: contadoresData } = await supabase
    .from('contadores')
    .select('usuario_servicio_id, id')
    .eq('cliente_id', clienteId)
    .eq('estado', 'activo');
  const contadorPorSuscriptor = new Map(
    (contadoresData ?? []).map((c) => [c.usuario_servicio_id, c.id]),
  );


  const detalle: SuscriptorSimulado[] = [];
  const anomaliasGlobales: AnomaliaFacturacion[] = [];
  let consumoTotalM3 = 0;
  let facturacionTotal = 0;
  let suscriptoresConFactura = 0;

  for (const s of suscriptores) {
    const contadorId = contadorPorSuscriptor.get(s.id);
    const lectura = contadorId ? lecturasPorContador.get(contadorId) : undefined;
    const consumoM3 = lectura ? Number(lectura.consumo_m3) : null;
    const tieneLectura = lectura !== undefined;
    const revisionLectura = (lectura?.revision ?? 'normal') as
      | 'normal' | 'consumo_alto' | 'consumo_bajo' | 'consumo_cero';

    // tarifa vigente de cada servicio para la categoría del suscriptor
    const tarifasVigentes = new Map<string, Tarifa>();
    const tarifasIds = new Map<string, string>();
    for (const svc of servicios) {
      const { data: tarifaId, error } = await supabase.rpc('tarifa_vigente', {
        p_servicio_id: svc.id,
        p_categoria: s.categoria,
        p_fecha: fechaPeriodo,
      });
      if (error || !tarifaId) continue; // sin tarifa → servicio no genera renglón
      const { data: filaTarifa } = await supabase
        .from('tarifas')
        .select('cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3')
        .eq('id', tarifaId)
        .single();
      if (!filaTarifa) continue;
      tarifasVigentes.set(svc.id, {
        cargoFijo: Number(filaTarifa.cargo_fijo),
        limiteBasicoM3: Number(filaTarifa.limite_basico_m3),
        precioBasicoM3: Number(filaTarifa.precio_basico_m3),
        precioNoBasicoM3: Number(filaTarifa.precio_no_basico_m3),
      });
      tarifasIds.set(svc.id, String(tarifaId));
    }
    const tieneTarifa = tarifasVigentes.size > 0;

    // renglones sobre el mismo consumo (core); saldo anterior = 0 (005/007)
    const renglones = consumoM3 !== null
      ? armarRenglones({ servicios, tarifasVigentes, tarifasIds, consumoM3 })
      : [];
    const subtotalServicios = renglones.reduce((acc, r) => acc + r.subtotal, 0);
    const recargoMora = calcularRecargoMora(porcentajeMora, 0); // saldo vencido 0 en 005
    const saldoAnterior = 0;
    const total = componerTotal({ subtotalServicios, recargoMora, saldoAnterior });

    const anomalias = clasificarAnomaliasFacturacion({
      usuarioServicioId: s.id,
      tieneLectura,
      revisionLectura,
      tieneTarifa,
      total,
      totalPeriodoAnterior: null,
    });
    anomaliasGlobales.push(...anomalias);

    detalle.push({
      usuarioServicioId: s.id,
      codigoSuscriptor: s.codigo_suscriptor,
      nombre: s.nombre,
      categoria: s.categoria,
      consumoM3,
      tieneTarifa,
      renglones,
      subtotalServicios,
      recargoMora,
      saldoAnterior,
      total,
      anomalias,
    });

    if (consumoM3 !== null) consumoTotalM3 += consumoM3;
    if (total > 0) {
      facturacionTotal += total;
      suscriptoresConFactura += 1;
    }
  }

  return {
    periodoId,
    totalSuscriptores: suscriptores.length,
    suscriptoresConFactura,
    consumoTotalM3: Math.round(consumoTotalM3 * 100) / 100,
    facturacionTotal,
    anomalias: anomaliasGlobales,
    detalle,
  };
}

// ---------------------------------------------------------------------------
// Listado / detalle / anulación (rutas del panel)
// ---------------------------------------------------------------------------
export async function listarFacturasDePeriodo(
  supabase: SupabaseClient,
  clienteId: string,
  periodoId: string,
): Promise<FacturaRow[]> {
  const { data, error } = await supabase
    .from('facturas')
    .select(COLUMNAS_FACTURA)
    .eq('cliente_id', clienteId)
    .eq('periodo_id', periodoId)
    .order('numero', { ascending: true });
  if (error) throw new Error(`No se pudieron listar las facturas: ${error.message}`);
  return (data ?? []) as FacturaRow[];
}

export async function obtenerFactura(
  supabase: SupabaseClient,
  clienteId: string,
  facturaId: string,
): Promise<{ factura: FacturaRow; detalles: DetalleFacturaRow[] }> {
  const { data: factura, error } = await supabase
    .from('facturas')
    .select(COLUMNAS_FACTURA)
    .eq('id', facturaId)
    .eq('cliente_id', clienteId)
    .single();
  if (error || !factura) throw new Error('La factura no existe');
  const { data: detalles } = await supabase
    .from('factura_detalles')
    .select(COLUMNAS_DETALLE)
    .eq('factura_id', facturaId)
    .order('orden', { ascending: true });
  return { factura: factura as FacturaRow, detalles: (detalles ?? []) as DetalleFacturaRow[] };
}

// Anula una factura emitida (inmutabilidad: solo estado→anulada + motivo +
// responsable; el trigger trg_factura_inmutable exige el motivo).
export async function anularFactura(
  supabase: SupabaseClient,
  clienteId: string,
  facturaId: string,
  motivo: string,
  anuladaPor: string,
): Promise<FacturaRow> {
  if (!motivo || !motivo.trim()) throw new Error('El motivo de anulación es obligatorio');
  const { data, error } = await supabase
    .from('facturas')
    .update({ estado: 'anulada', motivo_anulacion: motivo.trim(), anulada_por: anuladaPor })
    .eq('id', facturaId)
    .eq('cliente_id', clienteId)
    .select(COLUMNAS_FACTURA)
    .single();
  if (error) throw new Error(`No se pudo anular la factura: ${error.message}`);
  return data as FacturaRow;
}

