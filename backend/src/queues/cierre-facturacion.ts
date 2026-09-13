// Consumidor de Cloudflare Queues del cierre de facturación
// (specs/005-facturacion/plan.md §3/§5, tasks.md T-005).
//
// El cierre NUNCA se procesa en un solo fetch (CLAUDE.md §5.5): el productor
// encola UNA factura por mensaje ({ clienteId, periodoId, usuarioServicioId })
// y este consumidor la emite en su propia invocación. En local el round-trip se
// probó con `wrangler dev` (producer+consumer del mismo worker) — plan.md §0.
//
// La emisión inserta facturas + factura_detalles + factura_lecturas con
// service_role (BYPASSRLS): es un worker de sistema (CLAUDE.md §5.4), nunca una
// ruta que atiende usuarios. El número se genera con la RPC
// siguiente_numero_factura() (SELECT FOR UPDATE sobre configuracion, punto 9b/9c).
//
// DEFENSA EN PROFUNDIDAD (hallazgo M-1 de la auditoría pre-producción,
// docs/PLAN-PRODUCCION.md): precisamente porque aquí service_role SALTA RLS, el
// `cliente_id` del mensaje es la única frontera multi-tenant que queda. Antes,
// las consultas buscaban `periodos`, `usuarios_servicio`, `contadores`,
// `tarifas`, `facturas`, `factura_detalles` y `notificaciones` SOLO por su `id`:
// un mensaje con un id de otro acueducto habría cruzado datos entre clientes sin
// que nada lo impidiera. Hoy no es explotable —el único productor es el propio
// Worker y siempre encola `ctx.clienteId` tras lecturas ya filtradas por RLS—
// pero es el mismo patrón del "identificador desnudo" que causó el hallazgo
// CRÍTICO C-1. Por eso TODAS las consultas de este archivo van acotadas además
// por `.eq('cliente_id', clienteId)`, y las tres ramas validan que el mensaje
// traiga `clienteId`. Regla para quien añada un productor nuevo: el mensaje
// nunca se cree con un id que no se haya leído antes bajo RLS.
// Si el suscriptor no tiene tarifa (tarifa_vigente NULL) se aborta el mensaje
// (punto 9d) — el productor ya lo marcó como anomalía en la simulación.

import { crearClienteServicio, type Env, type MensajeFacturaCierre } from '../lib/db';
import {
  armarRenglones,
  calcularRecargoMora,
  componerTotal,
  type RenglonFactura,
} from '../core/facturacion';
import type { Tarifa } from '../core/tarifas';
import { generarPdfFactura, type DatosAcueductoPdf } from '../lib/factura-pdf';
import { enviarCorreo, enviarFacturaPorCorreo } from '../lib/email';
import { computarActualizacionNotificacion, escaparHtml } from '../core/notificaciones';

const REMITENTE_NOTIFICACIONES = 'no-responder@undreocol.app'; // dominio verificado (producción)

export type MensajeFactura = MensajeFacturaCierre;

interface DatosPeriodo {
  nombre: string;
  fecha_fin: string;
}

interface DatosSuscriptor {
  id: string;
  nombre: string;
  codigo_suscriptor: string;
  direccion: string | null;
  categoria: string | null;
  estado: string;
}

// Convierte un mensaje en una factura emitida. Lanza si hay algo que impide la
// emisión (p.ej. sin tarifa) para que el error quede en el log del consumidor.
export async function emitirFacturaDeMensaje(env: Env, mensaje: MensajeFactura): Promise<string> {
  const supabase = crearClienteServicio(env);

  const { clienteId, periodoId, usuarioServicioId } = mensaje;
  if (!clienteId || !periodoId || !usuarioServicioId) {
    throw new Error('Mensaje emitir_factura inválido: faltan clienteId/periodoId/usuarioServicioId');
  }

  // --- contexto del periodo y del suscriptor ------------------------------
  const { data: periodo } = await supabase
    .from('periodos')
    .select('nombre, fecha_fin')
    .eq('id', periodoId)
    .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
    .single();
  if (!periodo) throw new Error(`Periodo ${periodoId} no existe`);
  const periodoRow = periodo as DatosPeriodo;
  const fechaPeriodo = String(periodoRow.fecha_fin).slice(0, 10);

  const { data: suscriptor } = await supabase
    .from('usuarios_servicio')
    .select('id, nombre, codigo_suscriptor, direccion, categoria, estado')
    .eq('id', usuarioServicioId)
    .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
    .single();
  if (!suscriptor) throw new Error(`Suscriptor ${usuarioServicioId} no existe`);
  const suscriptorRow = suscriptor as DatosSuscriptor;

  const { data: config } = await supabase
    .from('configuracion')
    .select('prefijo_factura, dias_vencimiento, porcentaje_mora')
    .eq('cliente_id', clienteId)
    .single();
  if (!config) throw new Error(`Configuración del cliente ${clienteId} no existe`);
  const prefijo = String(config.prefijo_factura ?? 'FAC');
  const diasVencimiento = Number(config.dias_vencimiento ?? 30);
  const porcentajeMora = Number(config.porcentaje_mora ?? 0);

  // --- lectura del suscriptor en el periodo ------------------------------
  const { data: contador } = await supabase
    .from('contadores')
    .select('id')
    .eq('usuario_servicio_id', usuarioServicioId)
    .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
    .eq('estado', 'activo')
    .maybeSingle();
  const { data: lectura } = contador
    ? await supabase
        .from('lecturas')
        .select('id, consumo_m3')
        .eq('contador_id', contador.id)
        .eq('periodo_id', periodoId)
        .maybeSingle()
    : { data: null };
  const consumoM3 = lectura ? Number(lectura.consumo_m3) : null;
  if (consumoM3 === null) {
    throw new Error(`Suscriptor ${usuarioServicioId} sin lectura en el periodo ${periodoId} — no se emite`);
  }

  // --- servicios activos y tarifas vigentes (puntos 10/12; 9d) ---------------
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

  const tarifasVigentes = new Map<string, Tarifa>();
  const tarifasIds = new Map<string, string>();
  for (const svc of servicios) {
    const { data: tarifaId, error } = await supabase.rpc('tarifa_vigente', {
      p_servicio_id: svc.id,
      p_categoria: suscriptorRow.categoria,
      p_fecha: fechaPeriodo,
    });
    if (error || !tarifaId) continue; // sin tarifa → servicio sin renglón
    const { data: filaTarifa } = await supabase
      .from('tarifas')
      .select('cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3')
      .eq('id', tarifaId)
      .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
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
  if (tarifasVigentes.size === 0) {
    // punto 9d: sin tarifa configurada → no se emite
    throw new Error(`Suscriptor ${usuarioServicioId} sin tarifa vigente (9d) — no se emite`);
  }

  // --- armar renglones / total (core) --------------------------------------
  const renglones = armarRenglones({ servicios, tarifasVigentes, tarifasIds, consumoM3 });
  const subtotalServicios = renglones.reduce((acc, r) => acc + r.subtotal, 0);
  const recargoMora = calcularRecargoMora(porcentajeMora, 0); // saldo vencido 0 en 005
  const saldoAnterior = 0;
  const total = componerTotal({ subtotalServicios, recargoMora, saldoAnterior });

  // --- número atómico (RPC con SELECT FOR UPDATE, punto 9b/9c) --------------
  const { data: numero, error: errNumero } = await supabase.rpc('siguiente_numero_factura', {
    p_cliente_id: clienteId,
    p_prefijo: prefijo,
  });
  if (errNumero || !numero) {
    throw new Error(`No se pudo generar el número de factura: ${errNumero?.message ?? 'desconocido'}`);
  }
  const numeroFactura = String(numero);

  // --- persistir factura + detalles + factura_lecturas ----------------------
  const snapshot = {
    nombre: suscriptorRow.nombre,
    direccion: suscriptorRow.direccion,
    categoria: suscriptorRow.categoria,
    codigo_suscriptor: suscriptorRow.codigo_suscriptor,
    estado: suscriptorRow.estado,
  };
  const fechaVencimiento = new Date(fechaPeriodo);
  fechaVencimiento.setDate(fechaVencimiento.getDate() + diasVencimiento);

  const { data: factura, error: errFactura } = await supabase
    .from('facturas')
    .insert({
      cliente_id: clienteId,
      usuario_servicio_id: usuarioServicioId,
      periodo_id: periodoId,
      tipo: 'ciclo',
      numero: numeroFactura,
      snapshot_suscriptor: snapshot,
      consumo_m3: consumoM3,
      subtotal_servicios: subtotalServicios,
      recargo_mora: recargoMora,
      saldo_anterior: saldoAnterior,
      total,
      total_pagado: 0,
      fecha_emision: new Date().toISOString().slice(0, 10),
      fecha_vencimiento: fechaVencimiento.toISOString().slice(0, 10),
      estado: 'pendiente',
    })
    .select('id')
    .single();
  if (errFactura || !factura) {
    throw new Error(`No se pudo insertar la factura: ${errFactura?.message ?? 'desconocido'}`);
  }

  const detallesParaInsertar: Array<Record<string, unknown>> = renglones.map((r: RenglonFactura) => ({
    cliente_id: clienteId,
    factura_id: factura.id,
    servicio_id: r.servicioId,
    tarifa_id: r.tarifaId || null,
    orden: r.orden,
    descripcion: r.descripcion,
    tipo_calculo: r.tipoCalculo,
    consumo_m3: r.consumoM3,
    cargo_fijo: r.cargoFijo,
    consumo_basico_m3: r.consumoBasicoM3,
    valor_basico: r.valorBasico,
    consumo_no_basico_m3: r.consumoNoBasicoM3,
    valor_no_basico: r.valorNoBasico,
    subtotal: r.subtotal,
  }));
  const { error: errDetalles } = await supabase.from('factura_detalles').insert(detallesParaInsertar);
  if (errDetalles) throw new Error(`No se pudieron insertar los detalles: ${errDetalles.message}`);

  if (lectura) {
    const { error: errFL } = await supabase.from('factura_lecturas').insert({
      factura_id: factura.id,
      lectura_id: lectura.id,
      cliente_id: clienteId,
    });
    if (errFL) throw new Error(`No se pudo vincular la lectura: ${errFL.message}`);
  }

  return numeroFactura;
}

// ---------------------------------------------------------------------------
// Envío del correo de una factura (006): genera el PDF, lo sube a R2, envía y
// actualiza la fila de notificaciones (intentos/ultimo_error) — el fallo NUNCA
// bloquea el flujo y queda trazable para el reintento (spec 006 §3.4).
// ---------------------------------------------------------------------------

function clavePdf(clienteId: string, facturaId: string): string {
  return `facturas/${clienteId}/${facturaId}.pdf`;
}

export async function enviarCorreoDeFactura(env: Env, mensaje: MensajeFactura): Promise<string> {
  const supabase = crearClienteServicio(env);

  const { clienteId, facturaId, notificacionId } = mensaje;
  if (!clienteId || !facturaId) {
    throw new Error('Mensaje enviar_correo_factura inválido: falta clienteId/facturaId');
  }

  // lee factura + detalles + cliente (acueducto) + email del suscriptor
  const { data: factura } = await supabase
    .from('facturas')
    .select('*, usuario_servicio_id')
    .eq('id', facturaId)
    .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
    .single();
  if (!factura) throw new Error(`Factura ${facturaId} no existe`);

  const { data: detallesData } = await supabase
    .from('factura_detalles')
    .select('*')
    .eq('factura_id', facturaId)
    .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
    .order('orden', { ascending: true });
  const detalles = detallesData ?? [];

  const { data: acueductoRow } = await supabase
    .from('clientes')
    .select('nombre, nit, direccion, telefono, municipio, logo_url, color_acento')
    .eq('id', clienteId)
    .single();

  const { data: suscriptor } = await supabase
    .from('usuarios_servicio')
    .select('email')
    .eq('id', factura.usuario_servicio_id)
    .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
    .single();

  const destinatario = (suscriptor?.email ?? '').trim();
  if (!destinatario) {
    throw new Error(`Suscriptor de la factura ${facturaId} sin email registrado`);
  }

  const acueducto: DatosAcueductoPdf = {
    nombre: acueductoRow?.nombre ?? '',
    nit: acueductoRow?.nit ?? null,
    direccion: acueductoRow?.direccion ?? null,
    telefono: acueductoRow?.telefono ?? null,
    municipio: acueductoRow?.municipio ?? null,
    logoUrl: acueductoRow?.logo_url ?? null,
    colorAcento: acueductoRow?.color_acento ?? '#14408C',
  };

  // genera el PDF y lo sube a R2 (la primera vez); pdf_url queda en la factura
  const pdfBytes = await generarPdfFactura({ factura, detalles, acueducto });
  const key = clavePdf(clienteId, facturaId);
  const bucket = env.FACTURAS_R2;
  if (bucket) {
    await bucket.put(key, pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });
    await supabase.from('facturas').update({ pdf_url: `/facturas/${facturaId}/pdf` })
      .eq('id', facturaId).eq('cliente_id', clienteId);   // defensa M-1
  }

  const numero = String(factura.numero ?? facturaId);
  // El cuerpo es HTML y `acueducto.nombre` es texto libre que escribe una
  // persona en POST /plataforma/acueductos (018): se escapa antes de interpolarlo (fix de la
  // auditoría pre-producción; hallazgo WARNING de Semgrep en esta línea).
  // El asunto NO se escapa: es texto plano de la cabecera del correo, no HTML.
  const resultado = await enviarFacturaPorCorreo(env, {
    destinatario,
    remitente: REMITENTE_NOTIFICACIONES,
    asunto: `Factura ${numero} — ${acueducto.nombre}`,
    cuerpoHtml: `<p>Adjuntamos la factura <strong>${escaparHtml(numero)}</strong> de ${escaparHtml(acueducto.nombre)}.</p>`,
    pdfBytes,
    pdfNombre: `${numero}.pdf`,
  });

  // actualiza la fila de notificaciones (si el mensaje trae notificacionId):
  // SIEMPRE con intentos + 1 y, si falla, ultimo_error poblado (trazabilidad
  // del fallo para el reintento — spec 006 §3.4, requerimiento explícito).
  if (notificacionId) {
    const { data: notif } = await supabase
      .from('notificaciones')
      .select('intentos')
      .eq('id', notificacionId)
      .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
      .single();
    const actualizacion = computarActualizacionNotificacion(resultado, Number(notif?.intentos ?? 0));
    const { error: errNotif } = await supabase
      .from('notificaciones')
      .update(actualizacion)
      .eq('id', notificacionId)
      .eq('cliente_id', clienteId);   // defensa M-1
    if (errNotif) {
      console.error('cierre-facturacion: no se pudo actualizar la notificación', errNotif.message);
    }
  }

  if (!resultado.ok) {
    throw new Error(`Envío fallido: ${resultado.error}`);
  }
  return numero;
}

// ---------------------------------------------------------------------------
// Envío de una notificación general (010): recordatorio de vencimiento, aviso
// de mora, confirmación de pago, corte ejecutado o reconexión completada. Sin
// adjunto, contenido (asunto/cuerpoHtml) ya armado por quien encoló el
// mensaje (core/notificaciones.ts) — este consumidor no vuelve a construirlo,
// solo envía y actualiza `notificaciones` (mismo patrón de trazabilidad que
// enviarCorreoDeFactura, plan.md §5, decisión técnica).
// ---------------------------------------------------------------------------

async function enviarNotificacionGenerica(env: Env, mensaje: MensajeFactura): Promise<void> {
  const supabase = crearClienteServicio(env);
  const { clienteId, notificacionId, destinatario, asunto, cuerpoHtml } = mensaje;
  if (!clienteId || !notificacionId || !destinatario || !asunto || !cuerpoHtml) {
    throw new Error('Mensaje enviar_notificacion inválido: falta clienteId/notificacionId/destinatario/asunto/cuerpoHtml');
  }

  const resultado = await enviarCorreo(env, {
    destinatario,
    remitente: REMITENTE_NOTIFICACIONES,
    asunto,
    cuerpoHtml,
  });

  // Trazabilidad del intento SIEMPRE, igual que enviarCorreoDeFactura (006).
  const { data: notif } = await supabase
    .from('notificaciones')
    .select('intentos')
    .eq('id', notificacionId)
    .eq('cliente_id', clienteId)   // defensa M-1: service_role salta RLS
    .single();
  const actualizacion = computarActualizacionNotificacion(resultado, Number(notif?.intentos ?? 0));
  const { error: errNotif } = await supabase
    .from('notificaciones')
    .update(actualizacion)
    .eq('id', notificacionId)
    .eq('cliente_id', clienteId);   // defensa M-1
  if (errNotif) {
    console.error('cierre-facturacion: no se pudo actualizar la notificación', errNotif.message);
  }

  if (!resultado.ok) {
    throw new Error(`Envío fallido: ${resultado.error}`);
  }
}

// Handler de cola de Cloudflare Queues (export default del worker consumidor):
// enruta por `tipo` — 'emitir_factura' (005), 'enviar_correo_factura' (006) o
// 'enviar_notificacion' (010).
export default {
  async queue(batch: { messages: Array<{ body: MensajeFactura }> }, env: Env): Promise<void> {
    for (const mensaje of batch.messages) {
      try {
        if (mensaje.body.tipo === 'enviar_correo_factura') {
          const numero = await enviarCorreoDeFactura(env, mensaje.body);
          console.info(`cierre-facturacion: correo de factura ${numero} procesado`);
        } else if (mensaje.body.tipo === 'enviar_notificacion') {
          await enviarNotificacionGenerica(env, mensaje.body);
          console.info(`cierre-facturacion: notificación ${mensaje.body.notificacionId} procesada`);
        } else {
          const numero = await emitirFacturaDeMensaje(env, mensaje.body);
          console.info(`cierre-facturacion: factura ${numero} emitida`);
        }
      } catch (e) {
        console.error('cierre-facturacion: error procesando mensaje', e instanceof Error ? e.message : e);
        // El error queda en el log y en notificaciones (intentos/ultimo_error);
        // sin reintento automático en esta versión (lo gestiona el admin).
      }
    }
  },
};


