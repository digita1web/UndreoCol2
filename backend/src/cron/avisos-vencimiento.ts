// Worker `undreocol-avisos-vencimiento` — cron diario "0 6 * * *" (spec
// specs/010-notificaciones/spec.md §3.5, plan.md §7).
//
// Primera notificación que NO nace de una acción de un admin sino de una
// condición de TIEMPO: recordatorio de vencimiento (factura `pendiente` cuya
// `fecha_vencimiento` cae dentro de `configuracion.dias_aviso_vencimiento`
// días) y aviso de mora (factura `pendiente` ya vencida). Una sola consulta
// por cliente trae ambos casos (`fecha_vencimiento <= hoy + dias_aviso`); se
// clasifica en memoria por si ya venció o no.
//
// Idempotencia estricta por (factura_id, tipo): como máximo una notificación
// por combinación, verificada contra `notificaciones` antes de insertar —
// evita duplicados si el cron corre dos veces el mismo día, y hace que una
// factura vencida hace varios días (p. ej. si el cron no corrió ayer) reciba
// su aviso de mora una sola vez, no uno por día de atraso.
//
// Recorre TODOS los clientes: `clientes.estado_cuenta` existe en el esquema
// pero ninguna otra parte del código lo usa todavía para excluir
// procesamiento (ni el cierre de facturación, ni keepalive/monitor-db) —
// introducir ese filtro aquí sería una regla nueva fuera del alcance de esta
// feature.
//
// Cron, no fetch (CLAUDE.md §5.5): hasta 15 min de CPU, sin el límite de 30s
// de una invocación HTTP — el volumen del acueducto piloto está lejos de eso.

import { crearClienteServicio, type MensajeFacturaCierre } from '../lib/db';
import { encolarNotificacion } from '../lib/notificaciones';
import { contenidoAvisoMora, contenidoRecordatorioVencimiento } from '../core/notificaciones';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FACTURACION_COLA: Queue<MensajeFacturaCierre>;
}

interface FacturaCandidata {
  id: string;
  numero: string;
  usuario_servicio_id: string;
  total: number;
  fecha_vencimiento: string;
}

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

async function yaNotificada(
  supabase: ReturnType<typeof crearClienteServicio>,
  facturaId: string,
  tipo: 'recordatorio_vencimiento' | 'aviso_mora',
): Promise<boolean> {
  const { data } = await supabase
    .from('notificaciones')
    .select('id')
    .eq('factura_id', facturaId)
    .eq('tipo', tipo)
    .limit(1)
    .maybeSingle();
  return !!data;
}

export interface ResultadoAvisos {
  recordatorios: number;
  moras: number;
}

export async function procesarAvisosVencimiento(env: Env): Promise<ResultadoAvisos> {
  const supabase = crearClienteServicio(env);
  let recordatorios = 0;
  let moras = 0;

  const { data: clientes, error: errClientes } = await supabase.from('clientes').select('id, nombre');
  if (errClientes) {
    throw new Error(`avisos-vencimiento: no se pudo listar clientes — ${errClientes.message}`);
  }

  const hoy = new Date().toISOString().slice(0, 10);

  for (const cliente of clientes ?? []) {
    const { data: config } = await supabase
      .from('configuracion')
      .select('dias_aviso_vencimiento')
      .eq('cliente_id', cliente.id)
      .single();
    const diasAviso = Number(config?.dias_aviso_vencimiento ?? 3);

    const limite = new Date();
    limite.setDate(limite.getDate() + diasAviso);
    const fechaLimite = limite.toISOString().slice(0, 10);

    const { data: facturas, error: errFacturas } = await supabase
      .from('facturas')
      .select('id, numero, usuario_servicio_id, total, fecha_vencimiento')
      .eq('cliente_id', cliente.id)
      .eq('estado', 'pendiente')
      .lte('fecha_vencimiento', fechaLimite);
    if (errFacturas) {
      console.error(`avisos-vencimiento: no se pudieron leer facturas del cliente ${cliente.id}`, errFacturas.message);
      continue;
    }

    for (const factura of (facturas ?? []) as FacturaCandidata[]) {
      const tipo = factura.fecha_vencimiento < hoy ? 'aviso_mora' : 'recordatorio_vencimiento';
      if (await yaNotificada(supabase, factura.id, tipo)) continue;

      const { data: suscriptor } = await supabase
        .from('usuarios_servicio')
        .select('email')
        .eq('id', factura.usuario_servicio_id)
        .single();
      const email = (suscriptor?.email ?? '').trim() || null;
      if (!email) continue; // sin email no rompe nada (spec §3.5)

      const contenido = tipo === 'aviso_mora'
        ? contenidoAvisoMora({
            nombreAcueducto: cliente.nombre,
            numeroFactura: factura.numero,
            diasMora: Math.round((Date.parse(hoy) - Date.parse(factura.fecha_vencimiento)) / MILISEGUNDOS_POR_DIA),
            total: Number(factura.total),
          })
        : contenidoRecordatorioVencimiento({
            nombreAcueducto: cliente.nombre,
            numeroFactura: factura.numero,
            fechaVencimiento: factura.fecha_vencimiento,
            total: Number(factura.total),
          });

      const resultado = await encolarNotificacion(supabase, env.FACTURACION_COLA, {
        clienteId: cliente.id,
        usuarioServicioId: factura.usuario_servicio_id,
        facturaId: factura.id,
        tipo,
        destinatarioEmail: email,
        contenido,
      });
      if (resultado.encolado) {
        if (tipo === 'aviso_mora') moras += 1;
        else recordatorios += 1;
      }
    }
  }

  return { recordatorios, moras };
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const resultado = await procesarAvisosVencimiento(env);
    console.info(
      `avisos-vencimiento: ${resultado.recordatorios} recordatorio(s) de vencimiento y ${resultado.moras} aviso(s) de mora encolados`,
    );
  },
};
