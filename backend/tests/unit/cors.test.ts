// CORS del Worker — hallazgo B-4 de la auditoría pre-producción
// (docs/PLAN-PRODUCCION.md). Se ejercita el `app.fetch` REAL con peticiones
// preflight construidas a mano: no se inspecciona la configuración, se mide la
// respuesta que recibiría el navegador.
//
// Estas pruebas no tocan Supabase: el middleware de CORS responde el preflight
// (OPTIONS) antes de llegar a cualquier handler, así que basta un Env de
// mentira con la única variable que el middleware lee.

import { describe, expect, it } from 'vitest';
import app from '../../src/index';

const envBase = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon-de-prueba',
  SUPABASE_SERVICE_ROLE_KEY: 'service-de-prueba',
  SESSION_SECRET: 'secreto-de-prueba',
  ALLOWED_ORIGIN: 'https://panel.undreocol.test',
};

// `app.fetch` de Hono declara `Response | Promise<Response>`; se envuelve para
// que el tipo del helper sea el que esperan los `await` de las pruebas.
async function preflight(metodo: string, origen: string, env = envBase): Promise<Response> {
  return await app.fetch(
    new Request('https://api.undreocol.test/suscriptores/abc', {
      method: 'OPTIONS',
      headers: {
        Origin: origen,
        'Access-Control-Request-Method': metodo,
        'Access-Control-Request-Headers': 'Content-Type',
      },
    }),
    env,
  );
}

describe('CORS — métodos permitidos (B-4)', () => {
  // Las 4 rutas PATCH de la API: editar servicio, editar suscriptor,
  // cerrar periodo y marcar lectura revisada.
  it('el preflight de PATCH incluye PATCH en Access-Control-Allow-Methods', async () => {
    const r = await preflight('PATCH', 'https://panel.undreocol.test');
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain('PATCH');
  });

  it.each(['GET', 'POST', 'PATCH'])('%s sigue permitido para el origen configurado', async (m) => {
    const r = await preflight(m, 'https://panel.undreocol.test');
    expect(r.headers.get('Access-Control-Allow-Methods')).toContain(m);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://panel.undreocol.test');
  });

  it('DELETE no está permitido (la API no expone ninguna ruta DELETE)', async () => {
    const r = await preflight('DELETE', 'https://panel.undreocol.test');
    expect(r.headers.get('Access-Control-Allow-Methods')).not.toContain('DELETE');
  });
});

describe('CORS — origen (B-4, endurecimiento)', () => {
  it('un origen ajeno NO recibe su propio origen de vuelta', async () => {
    const r = await preflight('POST', 'https://sitio-malicioso.test');
    expect(r.headers.get('Access-Control-Allow-Origin')).not.toBe('https://sitio-malicioso.test');
  });

  it('con varios orígenes configurados, cada uno permitido se refleja tal cual', async () => {
    const env = { ...envBase, ALLOWED_ORIGIN: 'https://panel.undreocol.test, https://portal.undreocol.test' };
    const r = await preflight('POST', 'https://portal.undreocol.test', env);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://portal.undreocol.test');
  });

  it('con varios orígenes configurados, un origen ajeno NO recibe la lista entera como cabecera', async () => {
    const env = { ...envBase, ALLOWED_ORIGIN: 'https://panel.undreocol.test, https://portal.undreocol.test' };
    const r = await preflight('POST', 'https://sitio-malicioso.test', env);
    const acao = r.headers.get('Access-Control-Allow-Origin');
    expect(acao).not.toContain(','); // una cabecera con coma es inválida
    expect(acao).toBe('https://panel.undreocol.test');
  });

  it('mantiene credentials: la cookie de sesión viaja en las peticiones permitidas', async () => {
    const r = await preflight('POST', 'https://panel.undreocol.test');
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});
