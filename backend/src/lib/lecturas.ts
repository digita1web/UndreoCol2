// Capa fina de acceso a datos para periodos y lecturas
// (specs/004-lecturas-y-consumo/plan.md §3/§4). Sin lógica de negocio: el
// consumo se calcula SIEMPRE en core/consumo.ts; esta capa solo resuelve el
// contador/periodo de contexto, persiste y devuelve.
//
// Regla clave (plan.md §3): la `lectura_anterior` NO llega del cliente como
// dato libre. Se resuelve aquí con la última lectura del contador (o
// contadores.lectura_inicial, o los datos del reemplazo si el contador entró
// por reemplazo). Así el lector no "inventa" la base del consumo.

import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularConsumoConReemplazo, calcularConsumoPeriodo } from '../core/consumo';

export interface Periodo {
  id: string;
  cliente_id: string;
  nombre: string;
  anio: number;
  mes: number;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_vencimiento: string;
  estado: 'abierto' | 'cerrado';
  fecha_cierre: string | null;
  cerrado_por: string | null;
}

export interface Lectura {
  id: string;
  cliente_id: string;
  contador_id: string;
  periodo_id: string;
  fecha_lectura: string;
  lectura_anterior: number;
  lectura_actual: number;
  consumo_m3: number;
  hubo_rollover: boolean;
  revision: 'normal' | 'consumo_alto' | 'consumo_bajo' | 'consumo_cero';
  promedio_historico: number | null;
  revisada: boolean;
  revisada_por: string | null;
  id_cliente_offline: string | null;
}

const COLUMNAS_PERIODO =
  'id, cliente_id, nombre, anio, mes, fecha_inicio, fecha_fin, fecha_vencimiento, estado, fecha_cierre, cerrado_por';

const COLUMNAS_LECTURA =
  'id, cliente_id, contador_id, periodo_id, fecha_lectura, lectura_anterior, lectura_actual, consumo_m3, hubo_rollover, revision, promedio_historico, revisada, revisada_por, id_cliente_offline';

// ---------------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------------

export async function listarPeriodos(supabase: SupabaseClient, clienteId: string): Promise<Periodo[]> {
  const { data, error } = await supabase
    .from('periodos')
    .select(COLUMNAS_PERIODO)
    .eq('cliente_id', clienteId)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false });
  if (error) throw new Error(`No se pudieron listar los periodos: ${error.message}`);
  return (data ?? []) as Periodo[];
}

export interface DatosCrearPeriodo {
  nombre: string;
  anio: number;
  mes: number;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_vencimiento: string;
}

export async function crearPeriodo(
  supabase: SupabaseClient,
  clienteId: string,
  datos: DatosCrearPeriodo,
): Promise<Periodo> {
  const { data, error } = await supabase
    .from('periodos')
    .insert({ cliente_id: clienteId, estado: 'abierto', ...datos })
    .select(COLUMNAS_PERIODO)
    .single();
  if (error) throw new Error(`No se pudo crear el periodo: ${error.message}`);
  return data as Periodo;
}

// Cerrar el periodo: solo voltea estado/fecha_cierre/cerrado_por. Un periodo
// cerrado NO se reabre (no hay acción de reapertura en el esquema).
export async function cerrarPeriodo(
  supabase: SupabaseClient,
  clienteId: string,
  periodoId: string,
  cerradoPor: string,
): Promise<Periodo> {
  const { data, error } = await supabase
    .from('periodos')
    .update({ estado: 'cerrado', fecha_cierre: new Date().toISOString(), cerrado_por: cerradoPor })
    .eq('id', periodoId)
    .eq('cliente_id', clienteId)
    .select(COLUMNAS_PERIODO)
    .single();
  if (error) throw new Error(`No se pudo cerrar el periodo: ${error.message}`);
  return data as Periodo;
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export interface DatosCrearLectura {
  contador_id: string;
  periodo_id: string;
  fecha_lectura: string;
  lectura_actual: number;
  id_cliente_offline?: string;
  tomada_por: string;
}

export async function listarLecturas(
  supabase: SupabaseClient,
  clienteId: string,
  opts: { periodoId?: string; soloAnomalias?: boolean } = {},
): Promise<Lectura[]> {
  let query = supabase
    .from('lecturas')
    .select(COLUMNAS_LECTURA)
    .eq('cliente_id', clienteId)
    .order('fecha_lectura', { ascending: false });
  if (opts.periodoId) query = query.eq('periodo_id', opts.periodoId);
  if (opts.soloAnomalias) query = query.not('revision', 'eq', 'normal').eq('revisada', false);
  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron listar las lecturas: ${error.message}`);
  return (data ?? []) as Lectura[];
}

// Idempotencia por id_cliente_offline: si la misma lectura ya fue guardada
// (reenvío offline), devuelve la existente sin duplicar.
async function buscarPorIdOffline(
  supabase: SupabaseClient,
  clienteId: string,
  idClienteOffline: string,
): Promise<Lectura | null> {
  const { data, error } = await supabase
    .from('lecturas')
    .select(COLUMNAS_LECTURA)
    .eq('cliente_id', clienteId)
    .eq('id_cliente_offline', idClienteOffline)
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar la lectura offline: ${error.message}`);
  return data as Lectura | null;
}

export async function crearLectura(
  supabase: SupabaseClient,
  clienteId: string,
  datos: DatosCrearLectura,
): Promise<{ lectura: Lectura; nuevo: boolean }> {
  // ---- idempotencia offline (CLAUDE.md §10 punto 8) -----------------------
  if (datos.id_cliente_offline) {
    const existente = await buscarPorIdOffline(supabase, clienteId, datos.id_cliente_offline);
    if (existente) return { lectura: existente, nuevo: false };
  }

  // ---- resolver la base del consumo (plan.md §3: nunca del cliente) --------
  const { data: config } = await supabase
    .from('configuracion')
    .select('factor_consumo_alto, piso_consumo_alto_m3, factor_consumo_bajo, umbral_rollover_pct')
    .eq('cliente_id', clienteId)
    .single();
  if (!config) throw new Error('No hay configuración de anomalías/rollover para el cliente');
  const umbralRolloverPct = Number(config.umbral_rollover_pct);

  const { data: contador } = await supabase
    .from('contadores')
    .select('id, capacidad_maxima, lectura_inicial, estado')
    .eq('id', datos.contador_id)
    .single();
  if (!contador) throw new Error('El contador no existe');
  const capacidadMaxima = Number(contador.capacidad_maxima);
  const lecturaInicial = Number(contador.lectura_inicial);

  // ¿Este contador entró por un reemplazo? (contador nuevo con lectura inicial)
  const { data: reemplazo } = await supabase
    .from('reemplazos_contador')
    .select('contador_anterior_id, lectura_final_anterior, lectura_inicial_nuevo')
    .eq('contador_nuevo_id', datos.contador_id)
    .maybeSingle();

  // Última lectura previa del mismo contador (para el caso normal).
  const { data: ultima } = await supabase
    .from('lecturas')
    .select('lectura_actual')
    .eq('contador_id', datos.contador_id)
    .order('fecha_lectura', { ascending: false })
    .limit(1)
    .maybeSingle();

  const hayReemplazo = reemplazo !== null && Number(reemplazo.lectura_inicial_nuevo) > 0;
  const lecturaAnterior = hayReemplazo
    ? Number(reemplazo.lectura_inicial_nuevo)
    : ultima
      ? Number(ultima.lectura_actual)
      : lecturaInicial;


  // ---- calcular el consumo SIEMPRE en core/consumo.ts ---------------------
  let resultado;
  if (hayReemplazo) {
    const { data: lecturaSaliente } = await supabase
      .from('lecturas')
      .select('lectura_actual')
      .eq('contador_id', reemplazo.contador_anterior_id)
      .order('fecha_lectura', { ascending: false })
      .limit(1)
      .maybeSingle();
    resultado = calcularConsumoConReemplazo({
      lecturaFinalAnterior: Number(reemplazo.lectura_final_anterior),
      ultimaLecturaSaliente: lecturaSaliente ? Number(lecturaSaliente.lectura_actual) : 0,
      lecturaInicialNuevo: Number(reemplazo.lectura_inicial_nuevo),
      lecturaActualEntrante: datos.lectura_actual,
    });
  } else {
    resultado = calcularConsumoPeriodo({
      lecturaAnterior,
      lecturaActual: datos.lectura_actual,
      capacidadMaxima,
      umbralRolloverPct,
    });
  }

  if (!resultado.ok) {
    throw new Error(`Lectura rechazada: ${resultado.error}`);
  }

  // ---- persistir ----------------------------------------------------------
  const { data: lectura, error } = await supabase
    .from('lecturas')
    .insert({
      cliente_id: clienteId,
      contador_id: datos.contador_id,
      periodo_id: datos.periodo_id,
      fecha_lectura: datos.fecha_lectura,
      lectura_anterior: lecturaAnterior,
      lectura_actual: datos.lectura_actual,
      consumo_m3: resultado.consumoM3,
      hubo_rollover: resultado.huboRollover,
      // Anomalías: marcan para revisión; por defecto normal (la clasificación
      // fina con el promedio histórico se afina en la capa de frontend/colas).
      revision: 'normal',
      promedio_historico: null,
      tomada_por: datos.tomada_por,
      id_cliente_offline: datos.id_cliente_offline ?? null,
    })
    .select(COLUMNAS_LECTURA)
    .single();
  if (error) throw new Error(`No se pudo crear la lectura: ${error.message}`);
  return { lectura: lectura as Lectura, nuevo: true };
}

export async function revisarLectura(
  supabase: SupabaseClient,
  clienteId: string,
  lecturaId: string,
  revisadaPor: string,
): Promise<Lectura> {
  const { data, error } = await supabase
    .from('lecturas')
    .update({ revisada: true, revisada_por: revisadaPor })
    .eq('id', lecturaId)
    .eq('cliente_id', clienteId)
    .select(COLUMNAS_LECTURA)
    .single();
  if (error) throw new Error(`No se pudo marcar la lectura como revisada: ${error.message}`);
  return data as Lectura;
}

