// Proxy de mismo origen (020, proxy-cookies-mismo-origen).
//
// El navegador NUNCA debe hablar directo con undreocol-api.undreocol.workers.dev:
// workers.dev está en la Public Suffix List, así que ese dominio y
// undreocol-frontend.undreocol.workers.dev son sitios distintos para efectos
// de cookies. La cookie de sesión (uc_sesion_admin / uc_sesion_suscriptor)
// quedaba guardada bajo el dominio de la API y el frontend nunca la veía —
// el login respondía 200 pero no llevaba a ningún lado (bug real, confirmado
// con la pestaña Network de Mateo contra producción).
//
// Esta ruta captura todo /api/* y lo reenvía al Worker de la API por el
// Service Binding (frontend/wrangler.toml [[services]]), Worker-a-Worker. La
// respuesta —código, cuerpo y sobre todo Set-Cookie— vuelve tal cual: el
// navegador solo ve al Worker del frontend, así que la cookie queda scopeada
// al dominio correcto.

import { getCloudflareContext } from '@opennextjs/cloudflare';

// getCloudflareContext() en una ruta dinámica puede fallar en build sin esto
// (issue conocido de @opennextjs/cloudflare, ver plan §0).
export const dynamic = 'force-dynamic';

// Host de referencia únicamente: el Service Binding enruta directo al Worker
// de destino, no resuelve DNS ni mira este host. Hono (backend) enruta solo
// por método+path, así que es irrelevante que no coincida con el dominio real.
const HOST_REFERENCIA = 'https://undreocol-api.undreocol.workers.dev';

async function reenviar(request: Request): Promise<Response> {
  const { env } = getCloudflareContext<CloudflareEnv>();
  const entrante = new URL(request.url);
  const destino = new URL(
    entrante.pathname.replace(/^\/api/, '') + entrante.search,
    HOST_REFERENCIA,
  );
  // Se reconstruye con la petición original como init: conserva método,
  // headers (Cookie, Content-Type, Origin) y cuerpo — nunca se lee ni se
  // transforma, así que el streaming binario (PDFs, urlPdfFactura) pasa
  // intacto en ambas direcciones.
  const peticion = new Request(destino, request);
  return env.API.fetch(peticion);
}

export {
  reenviar as GET,
  reenviar as POST,
  reenviar as PATCH,
  reenviar as PUT,
  reenviar as DELETE,
  reenviar as OPTIONS,
};
