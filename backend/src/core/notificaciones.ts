// Lógica de negocio pura del subsistema general de notificaciones. Sin
// dependencias de Hono, Cloudflare ni Supabase (CLAUDE.md §5.3).
// Referencia: specs/010-notificaciones/plan.md §4 y spec.md §3.2.
//
// Dos responsabilidades puras:
// 1. Contenido (asunto + cuerpo) de cada tipo de notificación nuevo — a partir
//    de los datos del evento que ya tiene quien la dispara (ruta o cron), sin
//    plantillas editables ni motor de templates (mismo criterio que 006 con el
//    correo de factura: un string HTML simple parametrizado).
// 2. computarActualizacionNotificacion()/MAX_INTENTOS_ENVIO, movidos tal cual
//    desde backend/src/lib/email.ts (006): ya eran puros, solo vivían ahí por
//    dónde nacieron. Ahora los usan los 6 tipos de notificación, no solo el
//    correo de factura — lib/email.ts es infraestructura de envío, no el dueño
//    del cálculo de reintentos (plan.md §5, decisión técnica).

// 'factura_generada' NO está aquí: su contenido lo sigue armando
// enviarCorreoDeFactura() en queues/cierre-facturacion.ts (006, sin cambios).
export type TipoNotificacionNueva =
  | 'recordatorio_vencimiento'
  | 'aviso_mora'
  | 'confirmacion_pago'
  | 'corte_ejecutado'
  | 'reconexion_completada';

export interface ContenidoNotificacion {
  asunto: string;
  cuerpoHtml: string;
}

// Escape de HTML para todo valor que se interpole en el cuerpo de un correo.
// Los contenidos de abajo son strings HTML (`<p>…</p>`) que salen hacia el
// buzón del suscriptor firmados con el dominio del acueducto. Varios de los
// valores interpolados son texto libre que escribe una persona en el panel
// —`nombreAcueducto` (POST /onboarding) y `motivo` del corte— así que sin
// escapar permiten inyectar marcado arbitrario en un correo que el suscriptor
// recibe como legítimo (enlace de pago falso, formulario de phishing). Hallazgo
// WARNING de Semgrep en queues/cierre-facturacion.ts:298, confirmado real en la
// auditoría pre-producción (docs/PLAN-PRODUCCION.md).
//
// Puro y sin dependencias (CLAUDE.md §5.3). Se escapan los cinco caracteres de
// la recomendación de OWASP para contexto de contenido HTML; `&` va primero
// para no re-escapar las entidades que generan los demás.
export function escaparHtml(valor: string | number): string {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function contenidoRecordatorioVencimiento(datos: {
  nombreAcueducto: string;
  numeroFactura: string;
  fechaVencimiento: string;
  total: number;
}): ContenidoNotificacion {
  return {
    asunto: `Recordatorio: la factura ${datos.numeroFactura} vence el ${datos.fechaVencimiento}`,
    cuerpoHtml: `<p>Tu factura <strong>${escaparHtml(datos.numeroFactura)}</strong> de ${escaparHtml(datos.nombreAcueducto)}, por valor de $${escaparHtml(datos.total)}, vence el <strong>${escaparHtml(datos.fechaVencimiento)}</strong>.</p>`,
  };
}

export function contenidoAvisoMora(datos: {
  nombreAcueducto: string;
  numeroFactura: string;
  diasMora: number;
  total: number;
}): ContenidoNotificacion {
  return {
    asunto: `Factura ${datos.numeroFactura} vencida — ${datos.nombreAcueducto}`,
    cuerpoHtml: `<p>Tu factura <strong>${escaparHtml(datos.numeroFactura)}</strong> de ${escaparHtml(datos.nombreAcueducto)} está vencida hace ${escaparHtml(datos.diasMora)} día(s), por un valor de $${escaparHtml(datos.total)}.</p>`,
  };
}

export function contenidoConfirmacionPago(datos: {
  nombreAcueducto: string;
  valor: number;
  fechaPago: string;
  facturasAplicadas: string[];
}): ContenidoNotificacion {
  const detalleFacturas = datos.facturasAplicadas.length
    ? `aplicado a la(s) factura(s): ${datos.facturasAplicadas.map(escaparHtml).join(', ')}`
    : 'sin facturas pendientes por abonar — queda como saldo a favor';
  return {
    asunto: `Confirmación de pago — ${datos.nombreAcueducto}`,
    cuerpoHtml: `<p>Recibimos tu pago de $${escaparHtml(datos.valor)} el ${escaparHtml(datos.fechaPago)}, ${detalleFacturas}.</p>`,
  };
}

export function contenidoCorteEjecutado(datos: {
  nombreAcueducto: string;
  motivo: string;
  fecha: string;
}): ContenidoNotificacion {
  return {
    asunto: `Corte del servicio — ${datos.nombreAcueducto}`,
    cuerpoHtml: `<p>Tu servicio con ${escaparHtml(datos.nombreAcueducto)} fue cortado el ${escaparHtml(datos.fecha)}. Motivo: ${escaparHtml(datos.motivo)}.</p>`,
  };
}

export function contenidoReconexionCompletada(datos: {
  nombreAcueducto: string;
  fecha: string;
  facturaReconexionNumero: string | null;
}): ContenidoNotificacion {
  const notaFactura = datos.facturaReconexionNumero
    ? ` Se generó la factura de reconexión ${escaparHtml(datos.facturaReconexionNumero)}.`
    : '';
  return {
    asunto: `Reconexión completada — ${datos.nombreAcueducto}`,
    cuerpoHtml: `<p>Tu servicio con ${escaparHtml(datos.nombreAcueducto)} fue reconectado el ${escaparHtml(datos.fecha)}.${notaFactura}</p>`,
  };
}

// Intento máximo antes de marcar la notificación como 'fallida' (reintento del
// worker; después lo gestiona el admin desde el panel). Movido desde
// lib/email.ts (006) sin cambios de comportamiento.
export const MAX_INTENTOS_ENVIO = 3;

// Decisión pura del estado de la notificación tras un intento de envío
// (spec 006 §3.4): SIEMPRE incrementa intentos y, si falla, deja ultimo_error
// poblado para que el fallo quede trazable y reintentable. Movido desde
// lib/email.ts (006) sin cambios de comportamiento — ahora lo usan los 6
// tipos de notificación, no solo el correo de factura.
export function computarActualizacionNotificacion(
  resultado: { ok: boolean; error?: string },
  intentosActuales: number,
): { estado: 'pendiente' | 'enviada' | 'fallida'; intentos: number; ultimo_error?: string; enviada_en?: string } {
  const intentos = intentosActuales + 1;
  if (resultado.ok) {
    return { estado: 'enviada', intentos, enviada_en: new Date().toISOString() };
  }
  return {
    estado: intentos >= MAX_INTENTOS_ENVIO ? 'fallida' : 'pendiente',
    intentos,
    ultimo_error: resultado.error ?? 'Error de envío',
  };
}
