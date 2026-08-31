import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

// Único punto de acceso a Supabase desde el servidor Next.js (CLAUDE.md §5.1).
// app/ y components/ NUNCA importan @supabase/* (CLAUDE.md §5.2); si necesitan
// datos o sesión, pasan por lib/.

export async function crearClienteServidor(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno.'
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        // Errores explícitos (CLAUDE.md §6): escribir cookies desde un Server
        // Component no está permitido; no se silencia.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch (error) {
          throw new Error(
            `No se pudieron escribir las cookies de sesión desde este contexto: ${String(error)}`
          );
        }
      },
    },
  });
}
