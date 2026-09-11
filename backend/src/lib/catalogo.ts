// Capa fina de acceso a datos para el catálogo de servicios y tarifas
// (specs/002-catalogo-y-tarifas/plan.md §1). Sin lógica de negocio — eso
// vive en core/tarifas.ts. Cada función recibe un SupabaseClient ya
// instanciado con el JWT del usuario (RLS resuelve la autorización).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface Servicio {
  id: string;
  cliente_id: string;
  codigo: string;
  nombre: string;
  tipo_calculo: 'por_consumo' | 'fijo';
  facturable_en_ciclo: boolean;
  orden: number;
  activo: boolean;
}

export async function listarServicios(supabase: SupabaseClient, clienteId: string): Promise<Servicio[]> {
  const { data, error } = await supabase
    .from('servicios')
    .select('id, cliente_id, codigo, nombre, tipo_calculo, facturable_en_ciclo, orden, activo')
    .eq('cliente_id', clienteId)
    .order('orden', { ascending: true });
  if (error) throw new Error(`No se pudieron listar los servicios: ${error.message}`);
  return (data ?? []) as Servicio[];
}

export interface DatosCrearServicio {
  codigo: string;
  nombre: string;
  tipo_calculo: 'por_consumo' | 'fijo';
  facturable_en_ciclo?: boolean;
  orden?: number;
}

export async function crearServicio(
  supabase: SupabaseClient,
  clienteId: string,
  datos: DatosCrearServicio,
): Promise<Servicio> {
  const { data, error } = await supabase
    .from('servicios')
    .insert({ cliente_id: clienteId, ...datos })
    .select('id, cliente_id, codigo, nombre, tipo_calculo, facturable_en_ciclo, orden, activo')
    .single();
  if (error) throw new Error(`No se pudo crear el servicio: ${error.message}`);
  return data as Servicio;
}

// Campos editables tras la creación. codigo y tipo_calculo NUNCA se aceptan
// aquí (plan.md §5): cambiar el tipo de cálculo de un servicio con tarifas
// históricas dejaría columnas de esas tarifas sin sentido retroactivo.
export interface DatosActualizarServicio {
  nombre?: string;
  facturable_en_ciclo?: boolean;
  orden?: number;
  activo?: boolean;
}

const CAMPOS_NO_EDITABLES = ['codigo', 'tipo_calculo'] as const;

export function validarCamposEditables(body: Record<string, unknown>): string | null {
  for (const campo of CAMPOS_NO_EDITABLES) {
    if (campo in body) {
      return `El campo '${campo}' no se puede editar tras crear el servicio`;
    }
  }
  return null;
}

export async function actualizarServicio(
  supabase: SupabaseClient,
  servicioId: string,
  datos: DatosActualizarServicio,
): Promise<Servicio> {
  const { data, error } = await supabase
    .from('servicios')
    .update(datos)
    .eq('id', servicioId)
    .select('id, cliente_id, codigo, nombre, tipo_calculo, facturable_en_ciclo, orden, activo')
    .single();
  if (error) throw new Error(`No se pudo actualizar el servicio: ${error.message}`);
  return data as Servicio;
}

export interface Tarifa {
  id: string;
  cliente_id: string;
  servicio_id: string;
  categoria: string;
  vigencia_desde: string;
  vigencia_hasta: string | null;
  cargo_fijo: number;
  limite_basico_m3: number;
  precio_basico_m3: number;
  precio_no_basico_m3: number;
}

export async function listarTarifas(
  supabase: SupabaseClient,
  servicioId: string,
  categoria: string,
): Promise<Tarifa[]> {
  const { data, error } = await supabase
    .from('tarifas')
    .select('id, cliente_id, servicio_id, categoria, vigencia_desde, vigencia_hasta, cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3')
    .eq('servicio_id', servicioId)
    .eq('categoria', categoria)
    .order('vigencia_desde', { ascending: false });
  if (error) throw new Error(`No se pudo listar el historial de tarifas: ${error.message}`);
  return (data ?? []) as Tarifa[];
}

export interface DatosCrearTarifa {
  servicio_id: string;
  categoria: string;
  cargo_fijo: number;
  limite_basico_m3: number;
  precio_basico_m3: number;
  precio_no_basico_m3: number;
}

// Única forma soportada de crear/cambiar una tarifa: RPC a
// crear_tarifa_version() (SELECT FOR UPDATE + cierre/eliminación de la
// vigente en la misma transacción, CLAUDE.md §10 punto 0). Nunca un
// UPDATE/INSERT directo desde aquí.
export async function crearTarifa(supabase: SupabaseClient, datos: DatosCrearTarifa): Promise<string> {
  const { data, error } = await supabase.rpc('crear_tarifa_version', {
    p_servicio_id: datos.servicio_id,
    p_categoria: datos.categoria,
    p_cargo_fijo: datos.cargo_fijo,
    p_limite_basico_m3: datos.limite_basico_m3,
    p_precio_basico_m3: datos.precio_basico_m3,
    p_precio_no_basico_m3: datos.precio_no_basico_m3,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface AutorizacionTarifa {
  id: string;
  cliente_id: string;
  servicio_id: string;
  categoria: string;
  autorizado_por: string;
  motivo: string;
  expira_en: string;
  usada_en: string | null;
  usada_por: string | null;
  revocada_en: string | null;
  revocada_por: string | null;
  created_at: string;
}

const COLUMNAS_AUTORIZACION =
  'id, cliente_id, servicio_id, categoria, autorizado_por, motivo, expira_en, usada_en, usada_por, revocada_en, revocada_por, created_at';

export async function listarAutorizacionesTarifa(
  supabase: SupabaseClient,
  clienteId: string,
): Promise<AutorizacionTarifa[]> {
  const { data, error } = await supabase
    .from('autorizaciones_tarifa')
    .select(COLUMNAS_AUTORIZACION)
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`No se pudieron listar las autorizaciones: ${error.message}`);
  return (data ?? []) as AutorizacionTarifa[];
}

export async function crearAutorizacionTarifa(
  supabase: SupabaseClient,
  datos: { servicio_id: string; categoria: string; motivo: string; expira_en: string },
): Promise<string> {
  const { data, error } = await supabase.rpc('crear_autorizacion_tarifa', {
    p_servicio_id: datos.servicio_id,
    p_categoria: datos.categoria,
    p_motivo: datos.motivo,
    p_expira_en: datos.expira_en,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function revocarAutorizacionTarifa(
  supabase: SupabaseClient,
  autorizacionId: string,
): Promise<void> {
  const { error } = await supabase.rpc('revocar_autorizacion_tarifa', {
    p_autorizacion_id: autorizacionId,
  });
  if (error) throw new Error(error.message);
}

export async function usarAutorizacionTarifa(
  supabase: SupabaseClient,
  datos: {
    autorizacion_id: string;
    cargo_fijo: number;
    limite_basico_m3: number;
    precio_basico_m3: number;
    precio_no_basico_m3: number;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc('usar_autorizacion_tarifa', {
    p_autorizacion_id: datos.autorizacion_id,
    p_cargo_fijo: datos.cargo_fijo,
    p_limite_basico_m3: datos.limite_basico_m3,
    p_precio_basico_m3: datos.precio_basico_m3,
    p_precio_no_basico_m3: datos.precio_no_basico_m3,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface FilaMatrizTarifas {
  servicio_id: string;
  servicio_codigo: string;
  servicio_nombre: string;
  categoria: string;
  tarifa_id: string | null;
  cargo_fijo: number | null;
  limite_basico_m3: number | null;
  precio_basico_m3: number | null;
  precio_no_basico_m3: number | null;
}

const CATEGORIAS_TARIFARIAS = [
  'estrato_1', 'estrato_2', 'estrato_3', 'estrato_4', 'estrato_5', 'estrato_6',
  'comercial', 'industrial', 'oficial',
] as const;

// Matriz servicio × categoría con la tarifa vigente de cada combinación (o
// null si no hay ninguna configurada). Usada por 003 para validar que un
// suscriptor nuevo tiene categoría facturable.
export async function matrizTarifas(supabase: SupabaseClient, clienteId: string): Promise<FilaMatrizTarifas[]> {
  const servicios = await listarServicios(supabase, clienteId);
  const { data: vigentes, error } = await supabase
    .from('tarifas')
    .select('id, servicio_id, categoria, cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3')
    .eq('cliente_id', clienteId)
    .is('vigencia_hasta', null);
  if (error) throw new Error(`No se pudo consultar la matriz de tarifas: ${error.message}`);

  const filas: FilaMatrizTarifas[] = [];
  for (const servicio of servicios) {
    for (const categoria of CATEGORIAS_TARIFARIAS) {
      const vigente = (vigentes ?? []).find(
        (t) => t.servicio_id === servicio.id && t.categoria === categoria,
      ) as Tarifa | undefined;
      filas.push({
        servicio_id: servicio.id,
        servicio_codigo: servicio.codigo,
        servicio_nombre: servicio.nombre,
        categoria,
        tarifa_id: vigente?.id ?? null,
        cargo_fijo: vigente?.cargo_fijo ?? null,
        limite_basico_m3: vigente?.limite_basico_m3 ?? null,
        precio_basico_m3: vigente?.precio_basico_m3 ?? null,
        precio_no_basico_m3: vigente?.precio_no_basico_m3 ?? null,
      });
    }
  }
  return filas;
}
