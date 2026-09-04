import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { NOMBRE_COOKIE_SESION_SUSCRIPTOR } from '../../src/lib/sesion-suscriptor';
import {
  DURACION_SESION_SUSCRIPTOR_SEG,
  UMBRAL_RENOVACION_SUSCRIPTOR_SEG,
  cerrarSesionSuscriptor,
  iniciarSesionSuscriptor,
  renovarSesionSuscriptor,
  verificarSesionSuscriptor,
  type SesionSuscriptor,
} from '../../src/lib/sesion-suscriptor';
import type { Env } from '../../src/lib/db';

const datosA1 = {
  usuarioServicioId: 'd0000000-0000-0000-0000-0000000000a1',
  clienteId: 'a0000000-0000-0000-0000-000000000001',
  numeroDocumento: '1000000001',
  codigoSuscriptor: 'A-001',
};

function crearEnv(secreto: string): Env {
  return {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'servicio',
    ALLOWED_ORIGIN: 'http://localhost:3000',
    SESSION_SECRET: secreto,
  };
}

// Mini-app para poder ejecutar las funciones con un Context real de Hono
// (getCookie/setCookie necesitan request/response) sin Workers ni base.
function crearApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.get('/iniciar', async (c) => {
    const s = await iniciarSesionSuscriptor(c, datosA1);
    return c.json({ s });
  });
  app.get('/verificar', async (c) => {
    const s = await verificarSesionSuscriptor(c);
    return c.json({ s });
  });
  app.get('/renovar', async (c) => {
    const s = await renovarSesionSuscriptor(c, {
      ...datosA1,
      tipo: 'suscriptor',
      expiraEn: Math.floor(Date.now() / 1000) + 60,
    });
    return c.json({ s });
  });
  app.get('/cerrar', (c) => {
    cerrarSesionSuscriptor(c);
    return c.json({ ok: true });
  });
  return app;
}

function cookieDe(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  if (!setCookie.startsWith(`${NOMBRE_COOKIE_SESION_SUSCRIPTOR}=`)) {
    throw new Error('La respuesta no trae la cookie de sesión del suscriptor');
  }
  return setCookie;
}

// App de prueba global (mismo secreto); los tests que necesitan otro secreto
// crean su propia app.
const app = crearApp();

const ahoraSeg = (): number => Math.floor(Date.now() / 1000);

describe('sesion-suscriptor (D-4/D-10, JWT propio HS256)', () => {
  it('round-trip: iniciar escribe la cookie y verificar devuelve los mismos claims', async () => {
    const app = crearApp();
    const rIniciar = await app.request('/iniciar', {}, crearEnv('secreto-de-prueba'));
    expect(rIniciar.status).toBe(200);
    const cookie = cookieDe(rIniciar);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');

    const body = (await rIniciar.json()) as { s: SesionSuscriptor };
    expect(body.s.tipo).toBe('suscriptor');
    expect(body.s.usuarioServicioId).toBe(datosA1.usuarioServicioId);
    expect(body.s.numeroDocumento).toBe('1000000001');
    expect(body.s.codigoSuscriptor).toBe('A-001');

    // verificar con la cookie emitida
    const rVerificar = await app.request(
      '/verificar',
      { headers: { cookie: (cookie.split(';')[0] ?? '') } },
      crearEnv('secreto-de-prueba'),
    );
    const v = (await rVerificar.json()) as { s: SesionSuscriptor | null };
    expect(v.s).not.toBeNull();
    expect(v.s?.usuarioServicioId).toBe(datosA1.usuarioServicioId);
    expect(v.s?.clienteId).toBe(datosA1.clienteId);
    expect(v.s?.numeroDocumento).toBe('1000000001');
    expect(v.s?.codigoSuscriptor).toBe('A-001');
  });

  it('sin cookie → null (nunca lanza)', async () => {
    const app = crearApp();
    const r = await app.request('/verificar', {}, crearEnv('secreto-de-prueba'));
    const v = (await r.json()) as { s: SesionSuscriptor | null };
    expect(v.s).toBeNull();
  });

  it('tipo distinto de suscriptor → null (CLAUDE.md §10-22c)', async () => {
    const secreto = 'secreto-de-prueba';
    const exp = ahoraSeg() + 3600;
    const token = await sign(
      { sub: datosA1.usuarioServicioId, cid: datosA1.clienteId, doc: 'x', cod: 'y', tipo: 'administrativa', exp },
      secreto,
      'HS256',
    );
    const r = await app.request(
      '/verificar',
      { headers: { cookie: `${NOMBRE_COOKIE_SESION_SUSCRIPTOR}=${token}` } },
      crearEnv(secreto),
    );
    const v = (await r.json()) as { s: SesionSuscriptor | null };
    expect(v.s).toBeNull();
  });

  it('firma con secreto distinto → null', async () => {
    const token = await sign(
      { sub: 'x', cid: 'y', doc: 'd', cod: 'c', tipo: 'suscriptor', exp: ahoraSeg() + 3600 },
      'otro-secreto',
      'HS256',
    );
    const r = await app.request(
      '/verificar',
      { headers: { cookie: `${NOMBRE_COOKIE_SESION_SUSCRIPTOR}=${token}` } },
      crearEnv('secreto-de-prueba'),
    );
    const v = (await r.json()) as { s: SesionSuscriptor | null };
    expect(v.s).toBeNull();
  });

  it('token vencido (exp pasado) → null', async () => {
    const secreto = 'secreto-de-prueba';
    const token = await sign(
      { sub: 'x', cid: 'y', doc: 'd', cod: 'c', tipo: 'suscriptor', exp: ahoraSeg() - 60 },
      secreto,
      'HS256',
    );
    const r = await app.request(
      '/verificar',
      { headers: { cookie: `${NOMBRE_COOKIE_SESION_SUSCRIPTOR}=${token}` } },
      crearEnv(secreto),
    );
    const v = (await r.json()) as { s: SesionSuscriptor | null };
    expect(v.s).toBeNull();
  });

  it('con menos de 7 días de vida, verificar renueva (expiraEn mayor y reescribe la cookie)', async () => {
    const secreto = 'secreto-de-prueba';
    const app = crearApp();
    const expCorto = ahoraSeg() + 3 * 24 * 60 * 60; // quedan 3 días < 7
    const token = await sign(
      { sub: datosA1.usuarioServicioId, cid: datosA1.clienteId, doc: '1000000001', cod: 'A-001', tipo: 'suscriptor', exp: expCorto },
      secreto,
      'HS256',
    );
    const r = await app.request(
      '/verificar',
      { headers: { cookie: `${NOMBRE_COOKIE_SESION_SUSCRIPTOR}=${token}` } },
      crearEnv(secreto),
    );
    const v = (await r.json()) as { s: SesionSuscriptor | null };
    expect(v.s).not.toBeNull();
    expect(v.s!.expiraEn).toBeGreaterThan(expCorto);
    expect(v.s!.expiraEn - ahoraSeg()).toBeGreaterThanOrEqual(DURACION_SESION_SUSCRIPTOR_SEG - 60);
    // la respuesta reescribió la cookie (renovación)
    expect(r.headers.get('set-cookie')).not.toBeNull();
  });

  it('con más de 7 días de vida, NO renueva (mismo expiraEn y sin Set-Cookie)', async () => {
    const secreto = 'secreto-de-prueba';
    const app = crearApp();
    const expLargo = ahoraSeg() + 20 * 24 * 60 * 60; // quedan 20 días > 7
    const token = await sign(
      { sub: datosA1.usuarioServicioId, cid: datosA1.clienteId, doc: '1000000001', cod: 'A-001', tipo: 'suscriptor', exp: expLargo },
      secreto,
      'HS256',
    );
    const r = await app.request(
      '/verificar',
      { headers: { cookie: `${NOMBRE_COOKIE_SESION_SUSCRIPTOR}=${token}` } },
      crearEnv(secreto),
    );
    const v = (await r.json()) as { s: SesionSuscriptor | null };
    expect(v.s?.expiraEn).toBe(expLargo);
    expect(r.headers.get('set-cookie')).toBeNull(); // no reescribió la cookie
  });

  it('renovarSesionSuscriptor devuelve expiraEn futuro y escribe la cookie', async () => {
    const app = crearApp();
    const r = await app.request('/renovar', {}, crearEnv('secreto-de-prueba'));
    const body = (await r.json()) as { s: SesionSuscriptor };
    expect(body.s.expiraEn - ahoraSeg()).toBeGreaterThanOrEqual(DURACION_SESION_SUSCRIPTOR_SEG - 60);
    expect(r.headers.get('set-cookie')).not.toBeNull();
  });

  it('el umbral de renovación es 7 días (constante)', () => {
    expect(UMBRAL_RENOVACION_SUSCRIPTOR_SEG).toBe(7 * 24 * 60 * 60);
    expect(DURACION_SESION_SUSCRIPTOR_SEG).toBe(30 * 24 * 60 * 60);
  });

  it('cerrar borra la cookie (logout)', async () => {
    const app = crearApp();
    const r = await app.request('/cerrar', {}, crearEnv('secreto-de-prueba'));
    const borrado = r.headers.get('set-cookie') ?? '';
    expect(borrado).toContain('Max-Age=0');
  });
});
