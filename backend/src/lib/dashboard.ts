// Capa de solo lectura de indicadores del dashboard (specs/011-dashboard/).
//
// Regla del spec §5 / CLAUDE.md §5.3: esta feature NO calcula dinero. Agrega y
// presenta valores ya persistidos por 005 (facturas) y 007 (pagos/cartera).
// - La cartera se reutiliza tal cual de lib/pagos.ts `obtenerCartera()` (spec
//   §3.2/§3.3): nunca se recalcula un saldo por su cuenta.
// - El reloj de "hoy" es UTC (decisión D-1 del plan), el mismo que usan el
//   formulario de pago (`new Date().toISOString().slice(0,10)`) y
//   `obtenerCartera()` de 007 — así el "mes en curso" del dashboard nunca
//   diverge del mes en que 007 registra los pagos.
// - Consultas read-model por `cliente_id` con el JWT del usuario (RLS FORCE);
//   nunca service_role.

import type { SupabaseClient } from '@supabase/supabase-js';
import { obtenerCartera, type FilaCartera } from './pagos';

export interface PagoPlano {
  fechaPago: string; // 'YYYY-MM-DD'
  valor: number;
}

export interface TendenciaMes {
  anio: number;
  mes: number; // 1..12
  total: number; // pesos enteros
}

export type EstadoSuscriptorKey = 'activo' | 'suspendido' | 'cortado' | 'inactivo';

export interface IndicadoresDashboard {
  /** "hoy" UTC del Worker (mismo reloj de 007). */
  fecha: string;
  /** Suma de pagos vigentes (`anulado = false`) con `fecha_pago` en el mes en curso (spec §3.1). */
  recaudoMes: number;
  /** Σ `porVencer` de obtenerCartera() (spec §3.2). */
  carteraPendiente: number;
  /** Σ `vencida` de obtenerCartera() (spec §3.2). */
  carteraVencida: number;
  /** Conteo de suscriptores con deuda vencida (`vencida > 0` en su fila de cartera) (spec §3.3). */
  usuariosEnMora: number;
  /** Promedio de `consumo_m3` de facturas ciclo no anuladas del último periodo cerrado; null sin periodo (spec §3.7). */
  consumoPromedioUltimoPeriodo: number | null;
  /** 12 buckets cronológicos terminando en el mes de `fecha`; meses sin pagos en 0 (spec §3.4). */
  tendencia: TendenciaMes[];
  /** Los 4 estados del enum, incluidos los que estén en 0 (spec §3.5). */
  suscriptoresPorEstado: Record<EstadoSuscriptorKey, number>;
}

const LIMITE_PAGINACION = 1000;

// ---------------------------------------------------------------------------
// Helpers puros (exportados y unit-testeados; sin dependencias de I/O)
// ---------------------------------------------------------------------------

/** Fecha de hoy en el reloj UTC del módulo de pagos (decisión D-1 del plan). */
export function hoyUtc(ahora: Date = new Date()): string {
  return ahora.toISOString().slice(0, 10);
}

/** Límites de la consulta de pagos: primer día del mes que abre el eje de 12
 *  meses y último día del mes en curso (spec §3.1/§3.4). */
export function limitesConsultaTendencia(hoyIso: string): { desde: string; hasta: string } {
  const [y, m] = hoyIso.split('-').map(Number) as [number, number];
  // Date.UTC usa mes 0-based: `m - 1` es el mes en curso y `m` el siguiente.
  const desde = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);
  const hasta = new Date(Date.UTC(y, m, 1) - 86_400_000).toISOString().slice(0, 10);
  return { desde, hasta };
}

/** Eje de 12 meses (mes-año) terminando en el mes de `hoyIso`, todos con total 0. */
export function armarEjeTendencia(hoyIso: string): TendenciaMes[] {
  const [y, m] = hoyIso.split('-').map(Number) as [number, number];
  const eje: TendenciaMes[] = [];
  for (let i = 11; i >= 0; i--) {
    const fecha = new Date(Date.UTC(y, m - 1 - i, 1));
    eje.push({ anio: fecha.getUTCFullYear(), mes: fecha.getUTCMonth() + 1, total: 0 });
  }
  return eje;
}

/** Asigna cada pago a su bucket por mes de `fechaPago`, suma y redondea a pesos
 *  enteros. Devuelve el eje completo (12 meses, con cero-fill) y el recaudo del
 *  mes en curso (bucket del mes de `hoyIso`). Un pago fuera del eje se ignora
 *  (la consulta ya lo acota, pero el helper es defensivo por contrato). */
export function armarTendencia(
  hoyIso: string,
  filas: PagoPlano[],
): { tendencia: TendenciaMes[]; recaudoMes: number } {
  const tendencia = armarEjeTendencia(hoyIso);
  const indice = new Map<string, number>();
  tendencia.forEach((bucket, i) => {
    indice.set(`${bucket.anio}-${String(bucket.mes).padStart(2, '0')}`, i);
  });

  for (const fila of filas) {
    const mesPago = fila.fechaPago.slice(0, 7); // 'YYYY-MM'
    const pos = indice.get(mesPago);
    if (pos === undefined) continue; // fuera del eje (defensivo)
    const bucket = tendencia[pos];
    if (bucket) bucket.total += fila.valor;
  }

  tendencia.forEach((bucket) => {
    bucket.total = Math.round(bucket.total);
  });

  const mesActual = hoyIso.slice(0, 7);
  const posActual = indice.get(mesActual) ?? tendencia.length - 1;
  const bucketActual = tendencia[posActual];
  return { tendencia, recaudoMes: bucketActual?.total ?? 0 };
}

/** Totales de cartera a partir de las filas de `obtenerCartera()` (007) — la
 *  fuente única de cartera/mora (spec §3.2/§3.3). No recalcula saldos. */
export function resumirCartera(
  filas: FilaCartera[],
): { carteraPendiente: number; carteraVencida: number; usuariosEnMora: number } {
  let carteraPendiente = 0;
  let carteraVencida = 0;
  let usuariosEnMora = 0;
  for (const fila of filas) {
    carteraPendiente += fila.porVencer;
    carteraVencida += fila.vencida;
    if (fila.vencida > 0) usuariosEnMora++;
  }
  return {
    carteraPendiente: Math.round(carteraPendiente),
    carteraVencida: Math.round(carteraVencida),
    usuariosEnMora,
  };
}


// ---------------------------------------------------------------------------
// Acceso a datos (solo lectura; todas las consultas con cliente_id + RLS)
// ---------------------------------------------------------------------------

/** Payload completo de indicadores del acueducto (spec §3.1-§3.5/§3.7). */
export async function obtenerIndicadores(
  supabase: SupabaseClient,
  clienteId: string,
): Promise<IndicadoresDashboard> {
  const fecha = hoyUtc();
  const rango = limitesConsultaTendencia(fecha);

  // 1. Recaudo del mes y tendencia: pagos vigentes dentro del rango del eje.
  const { data: pagos, error: errPagos } = await supabase
    .from('pagos')
    .select('fecha_pago, valor')
    .eq('cliente_id', clienteId)
    .eq('anulado', false)
    .gte('fecha_pago', rango.desde)
    .lte('fecha_pago', rango.hasta)
    .order('fecha_pago', { ascending: true })
    .range(0, LIMITE_PAGINACION - 1);
  if (errPagos) throw new Error(`No se pudieron leer los pagos del dashboard: ${errPagos.message}`);

  const filasPagos: PagoPlano[] = ((pagos ?? []) as Array<{ fecha_pago: string; valor: number }>).map(
    (p) => ({ fechaPago: p.fecha_pago, valor: Number(p.valor) }),
  );
  const { tendencia, recaudoMes } = armarTendencia(fecha, filasPagos);

  // 2. Cartera pendiente/vencida y usuarios en mora: se reutiliza obtenerCartera()
  //    de 007 (spec §3.2/§3.3) — nunca se duplica ni se recalcula la lógica.
  const cartera = await obtenerCartera(supabase, clienteId);
  const resumenCartera = resumirCartera(cartera);

  // 3. Consumo promedio del último periodo cerrado (spec §3.7): periodo cerrado
  //    de mayor (anio, mes) y promedio de consumo_m3 de sus facturas de ciclo.
  const { data: ultimoPeriodo, error: errPeriodo } = await supabase
    .from('periodos')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('estado', 'cerrado')
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errPeriodo) {
    throw new Error(`No se pudo leer el último periodo cerrado: ${errPeriodo.message}`);
  }

  let consumoPromedioUltimoPeriodo: number | null = null;
  const ultimoPeriodoId = (ultimoPeriodo as { id: string } | null)?.id;
  if (ultimoPeriodoId) {
    const { data: consumos, error: errConsumos } = await supabase
      .from('facturas')
      .select('consumo_m3')
      .eq('cliente_id', clienteId)
      .eq('periodo_id', ultimoPeriodoId)
      .eq('tipo', 'ciclo')
      .neq('estado', 'anulada')
      .range(0, LIMITE_PAGINACION - 1);
    if (errConsumos) {
      throw new Error(`No se pudo leer el consumo del último periodo: ${errConsumos.message}`);
    }
    const filasConsumo = (consumos ?? []) as Array<{ consumo_m3: number }>;
    if (filasConsumo.length > 0) {
      const suma = filasConsumo.reduce((acc, f) => acc + Number(f.consumo_m3), 0);
      consumoPromedioUltimoPeriodo = Math.round((suma / filasConsumo.length) * 10) / 10;
    }
  }

  // 4. Conteo por estado: los 4 valores del enum, incluidos los que den 0.
  const estados: EstadoSuscriptorKey[] = ['activo', 'suspendido', 'cortado', 'inactivo'];
  const conteos = await Promise.all(
    estados.map(async (estado) => {
      const { count, error } = await supabase
        .from('usuarios_servicio')
        .select('id', { count: 'exact', head: true })
        .eq('cliente_id', clienteId)
        .eq('estado', estado);
      if (error) {
        throw new Error(`No se pudo contar suscriptores ${estado}: ${error.message}`);
      }
      return count ?? 0;
    }),
  );
  const suscriptoresPorEstado = {} as Record<EstadoSuscriptorKey, number>;
  estados.forEach((estado, i) => {
    suscriptoresPorEstado[estado] = conteos[i] ?? 0;
  });

  return {
    fecha,
    recaudoMes,
    carteraPendiente: resumenCartera.carteraPendiente,
    carteraVencida: resumenCartera.carteraVencida,
    usuariosEnMora: resumenCartera.usuariosEnMora,
    consumoPromedioUltimoPeriodo,
    tendencia,
    suscriptoresPorEstado,
  };
}

