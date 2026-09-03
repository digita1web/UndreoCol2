import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Variables de entorno del Worker (wrangler.toml [vars] + .dev.vars + secrets).
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGIN: string;
  // Secreto de firma del JWT propio del portal del suscriptor (D-2/D-4/D-10):
  // vive en .dev.vars y en los secretos del Worker; nunca se commitea.
  SESSION_SECRET: string;
  // Binding de Cloudflare Queues del cierre de facturación (producer/consumer).
  FACTURACION_COLA?: Queue<MensajeFacturaCierre>;
  // Email Workers (D-9): solo existe en producción/remote; en dev local NO está
  // (lib/email.ts lo detecta y no bloquea — regla 20). workers-types no expone
  // el tipo del binding send_email en esta versión; se usa uno mínimo local.
  EMAIL?: { send: (m: unknown) => Promise<{ messageId?: string }> };
  // R2: bucket de los PDF de factura. En dev local wrangler lo simula.
  FACTURAS_R2?: R2Bucket;
}

// Mensaje de la cola de facturación: UNA factura por mensaje (CLAUDE.md §5.5).
// El consumidor (src/queues/cierre-facturacion.ts) enruta por `tipo`:
//   'emitir_factura'        → emite la factura de ciclo de un suscriptor (005)
//   'enviar_correo_factura' → genera el PDF, sube a R2 y lo envía por correo (006)
export type TipoMensajeFacturaCierre = 'emitir_factura' | 'enviar_correo_factura';

export interface MensajeFacturaCierre {
  tipo: TipoMensajeFacturaCierre;
  clienteId: string;
  periodoId?: string;          // para 'emitir_factura'
  usuarioServicioId?: string;  // para 'emitir_factura'
  facturaId?: string;          // para 'enviar_correo_factura'
  notificacionId?: string;     // para 'enviar_correo_factura' (fila a actualizar)
}

// Cliente anónimo: solo para rutas públicas (p. ej. GET /salud). Sin JWT de
// usuario: auth.uid() = null y las políticas de RLS aplican para el rol anon.
export function crearClienteAnon(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Cliente con el JWT del usuario autenticado: auth.uid() resuelve en RLS
// (CLAUDE.md §5.4). NUNCA con service_role en rutas que atienden usuarios.
export function crearClienteSuscriptor(env: Env, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Solo para Workers de cron y GitHub Actions (backup). CLAUDE.md §5.4.
// Acepta un Env mínimo: los Workers de mantenimiento no necesitan las demás
// variables (anon key, CORS).
export function crearClienteServicio(
  env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
