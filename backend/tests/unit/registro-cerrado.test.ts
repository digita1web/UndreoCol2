// Cierre del autoservicio de alta de acueductos — hallazgo M-5 de la auditoría
// pre-producción (docs/PLAN-PRODUCCION.md). POST /auth/registro y POST
// /onboarding se eliminaron del Worker: la única vía de alta de acueductos es
// POST /plataforma/acueductos (018), gateada a `administrador`.
//
// Mismo patrón que cors.test.ts: se ejercita `app.fetch` REAL, sin mockear
// Supabase — ninguna de las dos rutas debe llegar a ningún handler.

import { describe, expect, it } from 'vitest';
import app from '../../src/index';

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon-de-prueba',
  SUPABASE_SERVICE_ROLE_KEY: 'service-de-prueba',
  SESSION_SECRET: 'secreto-de-prueba',
  ALLOWED_ORIGIN: 'https://panel.undreocol.test',
};

describe('M-5 — registro público cerrado', () => {
  it('POST /auth/registro ya no existe (404)', async () => {
    const r = await app.fetch(
      new Request('https://api.undreocol.test/auth/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ataque@test.local', password: 'contrasena123' }),
      }),
      env,
    );
    expect(r.status).toBe(404);
  });

  it('POST /onboarding ya no existe (404)', async () => {
    const r = await app.fetch(
      new Request('https://api.undreocol.test/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: 'Acueducto Gratis', slug: 'acueducto-gratis' }),
      }),
      env,
    );
    expect(r.status).toBe(404);
  });
});
