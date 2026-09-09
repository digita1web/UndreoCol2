// URL base de la API para fetches de SERVIDOR (Server Components de
// dashboard/page.tsx y plataforma/page.tsx). Usa `next/headers` — server-only,
// nunca se importa desde un componente cliente (por eso vive separado de
// lib/api.ts, que sí importan componentes 'use client').
//
// Bug real (020, incidente de producción posterior al cierre de la feature):
// en desarrollo local, NEXT_PUBLIC_API_URL apunta directo a `wrangler dev`
// (http://localhost:8787). En producción esa variable se deja SIN definir a
// propósito, para que el navegador use la ruta relativa /api (lib/api.ts).
// Pero estos dos Server Components tenían su PROPIO respaldo hardcodeado a
// `http://localhost:8787` — que ya no existe en Cloudflare una vez la
// variable deja de definirse, y el dashboard tiraba "Application error"
// (confirmado con `wrangler tail` contra producción real: "Error: No se pudo
// cargar el dashboard"). Se construye la URL a partir del host de la propia
// petición entrante en vez de asumir una URL fija: en producción resuelve al
// mismo proxy /api que ya usa el navegador.

import { headers } from 'next/headers';

export async function urlBaseApiServidor(): Promise<string> {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  const cabeceras = await headers();
  const host = cabeceras.get('host');
  const protocolo = cabeceras.get('x-forwarded-proto') ?? 'https';
  return `${protocolo}://${host}/api`;
}
