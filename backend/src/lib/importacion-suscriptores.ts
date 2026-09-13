// Capa fina de acceso a datos para la importación masiva de suscriptores
// (specs/012-importacion-suscriptores-excel/plan.md §1/§3). CA-1/CA-2 (campos
// requeridos, traducción de categoría, duplicados DENTRO del archivo) ya se
// resolvieron en core/importacion-suscriptores.ts, puro. Este módulo agrega
// lo que necesita la base de datos: CA-3 (duplicados contra usuarios_servicio
// existentes) y CA-6 (inserción transaccional vía la RPC importar_suscriptores()).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ErrorFila, FilaNormalizada, ResultadoValidacion } from '../core/importacion-suscriptores';

// CA-3. numero_documento no tiene constraint único en la base (spec §3.3) —
// esta es la única barrera real para ese caso; codigo_suscriptor sí tiene
// constraint único (cliente_id, codigo_suscriptor), pero se valida aquí
// también para que el resumen de 3.3 sea útil (no un rechazo a mitad de
// importación). Mueve cualquier fila válida que choque con la base a
// `errores`, nunca deja pasar un duplicado.
export async function detectarDuplicadosContraBase(
  supabase: SupabaseClient,
  clienteId: string,
  resultado: ResultadoValidacion,
): Promise<ResultadoValidacion> {
  if (resultado.validas.length === 0) return resultado;

  const codigos = resultado.validas.map((v) => v.fila.codigo_suscriptor);
  const documentos = resultado.validas.map((v) => v.fila.numero_documento);

  const { data: existentes, error } = await supabase
    .from('usuarios_servicio')
    .select('codigo_suscriptor, numero_documento')
    .eq('cliente_id', clienteId)
    .or(`codigo_suscriptor.in.(${codigos.map((c) => `"${c}"`).join(',')}),numero_documento.in.(${documentos.map((d) => `"${d}"`).join(',')})`);
  if (error) throw new Error(`No se pudo verificar duplicados contra la base: ${error.message}`);

  const codigosExistentes = new Set((existentes ?? []).map((f) => f.codigo_suscriptor as string));
  const documentosExistentes = new Set((existentes ?? []).map((f) => f.numero_documento as string));

  const validas: Array<{ indiceFila: number; fila: FilaNormalizada }> = [];
  const erroresNuevos: ErrorFila[] = [];

  for (const v of resultado.validas) {
    if (codigosExistentes.has(v.fila.codigo_suscriptor)) {
      erroresNuevos.push({ indiceFila: v.indiceFila, motivo: `codigo_suscriptor ya existe en la base: '${v.fila.codigo_suscriptor}'` });
    } else if (documentosExistentes.has(v.fila.numero_documento)) {
      erroresNuevos.push({ indiceFila: v.indiceFila, motivo: `numero_documento ya existe en la base: '${v.fila.numero_documento}'` });
    } else {
      validas.push(v);
    }
  }

  return {
    validas,
    errores: [...resultado.errores, ...erroresNuevos],
  };
}

// Advertencia informativa (spec §5, mismo criterio que la creación manual de
// 003): categorías de filas válidas sin ninguna tarifa vigente en ningún
// servicio activo del cliente. NO bloquea la importación de esas filas —
// solo se reporta junto al resultado (3.5).
async function categoriasSinTarifa(
  supabase: SupabaseClient,
  clienteId: string,
  filas: FilaNormalizada[],
): Promise<string[]> {
  const categorias = [...new Set(filas.map((f) => f.categoria))];
  if (categorias.length === 0) return [];

  const { data: servicios, error: errServicios } = await supabase
    .from('servicios')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('activo', true);
  if (errServicios) throw new Error(`No se pudieron consultar los servicios: ${errServicios.message}`);
  if (!servicios || servicios.length === 0) return categorias;

  const sinTarifa: string[] = [];
  for (const categoria of categorias) {
    let tieneAlguna = false;
    for (const svc of servicios) {
      const { data: tarifaId, error } = await supabase.rpc('tarifa_vigente', {
        p_servicio_id: svc.id,
        p_categoria: categoria,
      });
      if (!error && tarifaId) {
        tieneAlguna = true;
        break;
      }
    }
    if (!tieneAlguna) sinTarifa.push(categoria);
  }
  return sinTarifa;
}

export interface ReporteImportacion {
  id: string;
  filasIntentadas: number;
  filasImportadas: number;
  filasConError: number;
  errores: ErrorFila[];
  categoriasSinTarifa: string[];
}

// Única forma soportada de confirmar una importación: RPC a
// importar_suscriptores() (INSERT en lote + registro de historial, misma
// transacción PL/pgSQL — CA-6, cualquier fallo revierte todo). `errores`
// llega en la forma {fila, motivo} que espera el jsonb de historial
// (spec §3.6, nunca el contenido de la fila).
export async function confirmarImportacion(
  supabase: SupabaseClient,
  clienteId: string,
  filasValidas: Array<{ indiceFila: number; fila: FilaNormalizada }>,
  errores: ErrorFila[],
  nombreArchivo: string,
  perfilId: string,
): Promise<ReporteImportacion> {
  const { data: id, error } = await supabase.rpc('importar_suscriptores', {
    p_cliente_id: clienteId,
    p_filas_validas: filasValidas.map((v) => v.fila),
    p_filas_con_error: errores.map((e) => ({ fila: e.indiceFila, motivo: e.motivo })),
    p_nombre_archivo: nombreArchivo,
    p_perfil: perfilId,
  });
  if (error) throw new Error(error.message);

  const advertencias = await categoriasSinTarifa(supabase, clienteId, filasValidas.map((v) => v.fila));

  return {
    id: id as string,
    filasIntentadas: filasValidas.length + errores.length,
    filasImportadas: filasValidas.length,
    filasConError: errores.length,
    errores,
    categoriasSinTarifa: advertencias,
  };
}
