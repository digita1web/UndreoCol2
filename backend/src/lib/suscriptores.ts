// Capa fina de acceso a datos para suscriptores y contadores
// (specs/003-suscriptores-contadores/plan.md §1). Sin lógica de negocio — 003
// no calcula nada (rollover/consumo es de core/consumo.ts en 004).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface Suscriptor {
  id: string;
  cliente_id: string;
  codigo_suscriptor: string;
  nombre: string;
  estado: 'activo' | 'suspendido' | 'cortado' | 'inactivo';
  tipo_documento: string | null;
  numero_documento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  sector: string | null;
  categoria: string | null;
  contador_actual_id: string | null;
  fecha_vinculacion: string;
  notas: string | null;
}

const COLUMNAS_SUSCRIPTOR =
  'id, cliente_id, codigo_suscriptor, nombre, estado, tipo_documento, numero_documento, telefono, email, direccion, sector, categoria, contador_actual_id, fecha_vinculacion, notas';

export async function listarSuscriptores(
  supabase: SupabaseClient,
  clienteId: string,
  estado?: string,
): Promise<Suscriptor[]> {
  let query = supabase.from('usuarios_servicio').select(COLUMNAS_SUSCRIPTOR).eq('cliente_id', clienteId);
  if (estado) query = query.eq('estado', estado);
  const { data, error } = await query.order('nombre', { ascending: true });
  if (error) throw new Error(`No se pudieron listar los suscriptores: ${error.message}`);
  return (data ?? []) as Suscriptor[];
}

export async function obtenerSuscriptor(supabase: SupabaseClient, id: string): Promise<Suscriptor | null> {
  const { data, error } = await supabase
    .from('usuarios_servicio')
    .select(COLUMNAS_SUSCRIPTOR)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo obtener el suscriptor: ${error.message}`);
  return data as Suscriptor | null;
}

export interface DatosCrearSuscriptor {
  codigo_suscriptor: string;
  nombre: string;
  tipo_documento?: string;
  numero_documento: string;
  telefono?: string;
  email?: string;
  direccion: string;
  sector?: string;
  categoria: string;
  notas?: string;
}

// numero_documento, direccion y categoria son NULLABLE a nivel de esquema
// (la tabla ya tenía filas al agregar las columnas, plan.md §5) pero
// requeridos aquí para cualquier suscriptor nuevo — validado antes de llamar
// esta función (backend/src/index.ts).
export async function crearSuscriptor(
  supabase: SupabaseClient,
  clienteId: string,
  datos: DatosCrearSuscriptor,
): Promise<Suscriptor> {
  const { data, error } = await supabase
    .from('usuarios_servicio')
    .insert({ cliente_id: clienteId, ...datos })
    .select(COLUMNAS_SUSCRIPTOR)
    .single();
  if (error) throw new Error(`No se pudo crear el suscriptor: ${error.message}`);
  return data as Suscriptor;
}

// codigo_suscriptor NUNCA se acepta aquí (plan.md §5): es la futura
// credencial del portal (D-2); regenerarla es una acción explícita de la
// feature 008, fuera de 003.
export interface DatosActualizarSuscriptor {
  nombre?: string;
  estado?: string;
  tipo_documento?: string;
  numero_documento?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  sector?: string;
  categoria?: string;
  notas?: string;
}

export function validarCamposEditables(body: Record<string, unknown>): string | null {
  if ('codigo_suscriptor' in body) {
    return "El campo 'codigo_suscriptor' no se puede editar (es la credencial del portal)";
  }
  return null;
}

export async function actualizarSuscriptor(
  supabase: SupabaseClient,
  id: string,
  datos: DatosActualizarSuscriptor,
): Promise<Suscriptor> {
  const { data, error } = await supabase
    .from('usuarios_servicio')
    .update(datos)
    .eq('id', id)
    .select(COLUMNAS_SUSCRIPTOR)
    .single();
  if (error) throw new Error(`No se pudo actualizar el suscriptor: ${error.message}`);
  return data as Suscriptor;
}

// Regenera el código del portal (008, CA-8): UPDATE directo sobre
// usuarios_servicio con el cliente ya autenticado del admin — la política RLS
// usuarios_servicio_escritura (es_admin_de) cubre exactamente este cambio
// (plan 008 §5: una RPC nueva sería redundante). El 23505 (unique
// (cliente_id, codigo_suscriptor)) se traduce en un mensaje claro de 409.
export async function regenerarCodigoSuscriptor(
  supabase: SupabaseClient,
  clienteId: string,
  usuarioServicioId: string,
  codigoNuevo: string,
): Promise<Suscriptor> {
  const { data, error } = await supabase
    .from('usuarios_servicio')
    .update({ codigo_suscriptor: codigoNuevo })
    .eq('id', usuarioServicioId)
    .eq('cliente_id', clienteId)
    .select(COLUMNAS_SUSCRIPTOR)
    .maybeSingle();
  if (error) {
    if (error.code === '23505') {
      throw new Error('Ese código ya existe en este acueducto');
    }
    throw new Error(`No se pudo regenerar el código: ${error.message}`);
  }
  if (!data) throw new Error('Suscriptor no encontrado');
  return data as Suscriptor;
}

export interface Contador {
  id: string;
  cliente_id: string;
  usuario_servicio_id: string;
  serial: string;
  marca: string | null;
  capacidad_maxima: number;
  lectura_inicial: number;
  fecha_instalacion: string;
  estado: 'activo' | 'danado' | 'reemplazado';
  observaciones: string | null;
}

const COLUMNAS_CONTADOR =
  'id, cliente_id, usuario_servicio_id, serial, marca, capacidad_maxima, lectura_inicial, fecha_instalacion, estado, observaciones';

export async function contadorActual(supabase: SupabaseClient, usuarioServicioId: string): Promise<Contador | null> {
  const { data, error } = await supabase
    .from('contadores')
    .select(COLUMNAS_CONTADOR)
    .eq('usuario_servicio_id', usuarioServicioId)
    .eq('estado', 'activo')
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar el contador activo: ${error.message}`);
  return data as Contador | null;
}

export interface DatosCrearContador {
  usuario_servicio_id: string;
  serial: string;
  marca?: string;
  capacidad_maxima: number;
  lectura_inicial?: number;
  fecha_instalacion: string;
}

// Alta del PRIMER contador de un suscriptor (plan.md §5: endpoint separado
// de la creación del suscriptor). Un INSERT directo — no hay concurrencia
// que resolver aquí porque no existe un "contador anterior" que cerrar.
// uq_contador_activo rechaza el caso de que el suscriptor ya tenga uno.
export async function crearContador(
  supabase: SupabaseClient,
  clienteId: string,
  datos: DatosCrearContador,
): Promise<Contador> {
  const { data: contador, error } = await supabase
    .from('contadores')
    .insert({ cliente_id: clienteId, estado: 'activo', ...datos })
    .select(COLUMNAS_CONTADOR)
    .single();
  if (error) throw new Error(`No se pudo crear el contador: ${error.message}`);
  const { error: errorUpdate } = await supabase
    .from('usuarios_servicio')
    .update({ contador_actual_id: contador.id })
    .eq('id', datos.usuario_servicio_id);
  if (errorUpdate) throw new Error(`No se pudo asignar el contador al suscriptor: ${errorUpdate.message}`);
  return contador as Contador;
}

export interface ReemplazoContador {
  id: string;
  cliente_id: string;
  usuario_servicio_id: string;
  contador_anterior_id: string;
  contador_nuevo_id: string;
  fecha_reemplazo: string;
  lectura_final_anterior: number;
  lectura_inicial_nuevo: number;
  motivo: string | null;
}

export async function historialReemplazos(supabase: SupabaseClient, usuarioServicioId: string): Promise<ReemplazoContador[]> {
  const { data, error } = await supabase
    .from('reemplazos_contador')
    .select('id, cliente_id, usuario_servicio_id, contador_anterior_id, contador_nuevo_id, fecha_reemplazo, lectura_final_anterior, lectura_inicial_nuevo, motivo')
    .eq('usuario_servicio_id', usuarioServicioId)
    .order('fecha_reemplazo', { ascending: false });
  if (error) throw new Error(`No se pudo consultar el historial de reemplazos: ${error.message}`);
  return (data ?? []) as ReemplazoContador[];
}

export interface DatosReemplazarContador {
  usuario_servicio_id: string;
  serial_nuevo: string;
  marca_nuevo?: string;
  capacidad_maxima_nuevo: number;
  lectura_final_anterior: number;
  lectura_inicial_nuevo?: number;
  motivo?: string;
}

// Única forma soportada de reemplazar un contador: RPC a
// reemplazar_contador() (SELECT FOR UPDATE + cierre/alta/actualización en la
// misma transacción, plan.md §2). Nunca varios pasos sueltos desde aquí.
export async function reemplazarContador(supabase: SupabaseClient, datos: DatosReemplazarContador): Promise<string> {
  const { data, error } = await supabase.rpc('reemplazar_contador', {
    p_usuario_servicio_id: datos.usuario_servicio_id,
    p_serial_nuevo: datos.serial_nuevo,
    p_marca_nuevo: datos.marca_nuevo ?? null,
    p_capacidad_maxima_nuevo: datos.capacidad_maxima_nuevo,
    p_lectura_final_anterior: datos.lectura_final_anterior,
    p_lectura_inicial_nuevo: datos.lectura_inicial_nuevo ?? 0,
    p_motivo: datos.motivo ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
