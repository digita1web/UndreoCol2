// Capa fina del portal del suscriptor (008, D-10). TODAS las llamadas a las
// funciones SECURITY DEFINER del portal se hacen con crearClienteAnon — NUNCA
// con SUPABASE_SERVICE_ROLE_KEY (CLAUDE.md §5.4/§12, sin excepción). Cada
// función revalida numeroDocumento+codigoSuscriptor dentro del cliente_id, así
// que un resultado null/vacío significa "no es tu dato" y el portal responde
// 404/ninguno — el aislamiento nunca depende de filtrar en el Worker.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';
import { crearClienteAnon, type Env } from './db';
import { verificarSesionSuscriptor, type SesionSuscriptor } from './sesion-suscriptor';
import type { DetalleFacturaRow, FacturaRow } from './facturacion';
import type { DatosAcueductoPdf } from './factura-pdf';

export type EstadoCredencialesPortal = 'ok' | 'invalido' | 'bloqueado' | 'inactivo';

// Resuelve el clientes.id a partir del slug de la URL (spec §3.1) vía la
// función SECURITY DEFINER portal_cliente_por_slug (D-10): anon no puede leer
// clientes (RLS), el slug es público (está en la URL).
export async function resolverClientePorSlug(env: Env, slug: string): Promise<string | null> {
  const supabase = crearClienteAnon(env);
  const { data, error } = await supabase.rpc('portal_cliente_por_slug', { p_slug: slug });
  if (error) throw new Error(`No se pudo resolver el acueducto: ${error.message}`);
  return data ? String(data) : null;
}

export async function validarCredencialesPortal(
  env: Env,
  clienteId: string,
  numeroDocumento: string,
  codigoSuscriptor: string,
): Promise<{ estado: EstadoCredencialesPortal; usuarioServicioId?: string; reintentarEn?: string }> {
  const supabase = crearClienteAnon(env);
  const { data, error } = await supabase.rpc('portal_validar_credenciales', {
    p_cliente_id: clienteId,
    p_numero_documento: numeroDocumento,
    p_codigo_suscriptor: codigoSuscriptor,
  });
  if (error) throw new Error(`No se pudo validar el acceso: ${error.message}`);
  const r = (data ?? {}) as { estado?: string; usuario_servicio_id?: string; reintentar_en?: string };
  const estado = (['ok', 'invalido', 'bloqueado', 'inactivo'] as const).includes(
    r.estado as 'ok' | 'invalido' | 'bloqueado' | 'inactivo',
  )
    ? (r.estado as EstadoCredencialesPortal)
    : 'invalido';
  return { estado, usuarioServicioId: r.usuario_servicio_id, reintentarEn: r.reintentar_en };
}

export interface FacturaResumenPortal {
  id: string;
  numero: string;
  tipo: string;
  total: number;
  totalPagado: number;
  saldo: number;
  fechaEmision: string;
  fechaVencimiento: string;
  estado: 'pendiente' | 'pagada' | 'vencida' | 'anulada';
}

// La más reciente NO anulada es la "factura actual" (CA-4); el resto (incluidas
// las anuladas) va al historial. La RPC ya las trae más recientes primero.
export async function obtenerFacturasPortal(
  env: Env,
  sesion: SesionSuscriptor,
): Promise<{ facturaActual: FacturaResumenPortal | null; historial: FacturaResumenPortal[] }> {
  const supabase = crearClienteAnon(env);
  const { data, error } = await supabase.rpc('portal_facturas_suscriptor', {
    p_cliente_id: sesion.clienteId,
    p_numero_documento: sesion.numeroDocumento,
    p_codigo_suscriptor: sesion.codigoSuscriptor,
  });
  if (error) throw new Error(`No se pudieron leer las facturas: ${error.message}`);

  const hoyIso = new Date().toISOString().slice(0, 10);
  const filas = ((data ?? []) as Array<{
    id: string;
    numero: string;
    tipo: string;
    total: number;
    total_pagado: number;
    fecha_emision: string;
    fecha_vencimiento: string;
    estado: 'pendiente' | 'pagada' | 'vencida' | 'anulada';
  }>).map((f) => {
    const estadoEfectivo: FacturaResumenPortal['estado'] =
      f.estado === 'pendiente' && f.fecha_vencimiento < hoyIso ? 'vencida' : f.estado;
    return {
      id: f.id,
      numero: f.numero,
      tipo: f.tipo,
      total: f.total,
      totalPagado: f.total_pagado,
      saldo: f.total - f.total_pagado,
      fechaEmision: f.fecha_emision,
      fechaVencimiento: f.fecha_vencimiento,
      estado: estadoEfectivo,
    };
  });

  const indiceActual = filas.findIndex((f) => f.estado !== 'anulada');
  if (indiceActual === -1) return { facturaActual: null, historial: filas };
  const actual = filas[indiceActual];
  if (!actual) return { facturaActual: null, historial: filas };
  const historial = filas.filter((_, i) => i !== indiceActual);
  return { facturaActual: actual, historial };
}

export interface FacturaCompletaPortal {
  factura: FacturaRow;
  detalles: DetalleFacturaRow[];
  acueducto: DatosAcueductoPdf;
}

// Factura + detalles + datos del acueducto SOLO si es del suscriptor de la
// sesión; null si no existe o es de otro suscriptor/cliente (la ruta responde
// 404 y nunca sirve bytes — CA-5).
export async function obtenerFacturaCompletaPortal(
  env: Env,
  sesion: SesionSuscriptor,
  facturaId: string,
): Promise<FacturaCompletaPortal | null> {
  const supabase = crearClienteAnon(env);
  const { data, error } = await supabase.rpc('portal_factura_completa', {
    p_cliente_id: sesion.clienteId,
    p_numero_documento: sesion.numeroDocumento,
    p_codigo_suscriptor: sesion.codigoSuscriptor,
    p_factura_id: facturaId,
  });
  if (error) throw new Error(`No se pudo leer la factura: ${error.message}`);
  if (!data) return null;

  const completa = data as {
    factura: FacturaRow;
    detalles: DetalleFacturaRow[];
    acueducto: { nombre: string; nit: string | null; direccion: string | null; telefono: string | null; municipio: string | null; logo_url: string | null };
  };
  return {
    factura: completa.factura,
    detalles: completa.detalles ?? [],
    acueducto: {
      nombre: completa.acueducto?.nombre ?? '',
      nit: completa.acueducto?.nit ?? null,
      direccion: completa.acueducto?.direccion ?? null,
      telefono: completa.acueducto?.telefono ?? null,
      municipio: completa.acueducto?.municipio ?? null,
      logoUrl: completa.acueducto?.logo_url ?? null,
    },
  };
}

export async function obtenerSaldoFavorPortal(env: Env, sesion: SesionSuscriptor): Promise<number> {
  const supabase = crearClienteAnon(env);
  const { data, error } = await supabase.rpc('portal_saldo_favor_suscriptor', {
    p_cliente_id: sesion.clienteId,
    p_numero_documento: sesion.numeroDocumento,
    p_codigo_suscriptor: sesion.codigoSuscriptor,
  });
  if (error) throw new Error(`No se pudo leer el saldo a favor: ${error.message}`);
  return Number(data ?? 0);
}

export interface LecturaConsumoPortal {
  fecha_lectura: string;
  lectura_anterior: number;
  lectura_actual: number;
  consumo_m3: number;
}

export async function obtenerConsumoPortal(
  env: Env,
  sesion: SesionSuscriptor,
): Promise<LecturaConsumoPortal[]> {
  const supabase = crearClienteAnon(env);
  const { data, error } = await supabase.rpc('portal_consumo_suscriptor', {
    p_cliente_id: sesion.clienteId,
    p_numero_documento: sesion.numeroDocumento,
    p_codigo_suscriptor: sesion.codigoSuscriptor,
  });
  if (error) throw new Error(`No se pudo leer el consumo: ${error.message}`);
  return (data ?? []) as LecturaConsumoPortal[];
}

// Middleware/helper del portal: espejo de requerirClienteActivo pero verifica la
// sesión propia del suscriptor (cookie JWT). El supabase SIEMPRE es anon (D-10).
type ResultadoSesionPortal =
  | { ctx: { supabase: SupabaseClient; sesion: SesionSuscriptor }; respuesta?: undefined }
  | { ctx: null; respuesta: Response };

export async function requerirSesionSuscriptor(c: Context<{ Bindings: Env }>): Promise<ResultadoSesionPortal> {
  const sesion = await verificarSesionSuscriptor(c); // lee/renueva la cookie; null si inválida
  if (!sesion) {
    return { ctx: null, respuesta: c.json({ error: 'No autenticado' }, 401) };
  }
  return { ctx: { supabase: crearClienteAnon(c.env), sesion } };
}

