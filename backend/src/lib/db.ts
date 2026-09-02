import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Variables de entorno del Worker (wrangler.toml [vars] + .dev.vars + secrets).
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGIN: string;
  // Binding de Cloudflare Queues del cierre de facturación (producer/consumer).
  FACTURACION_COLA?: Queue<MensajeFacturaCierre>;
}

// Mensaje de la cola de facturación: UNA factura por mensaje (CLAUDE.md §5.5).
// El consumidor (src/queues/cierre-facturacion.ts) la emite en su invocación.
export interface MensajeFacturaCierre {
  clienteId: string;
  periodoId: string;
  usuarioServicioId: string;
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
