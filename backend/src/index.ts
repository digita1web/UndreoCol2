import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { crearClienteAnon, type Env } from './lib/db';

const app = new Hono<{ Bindings: Env }>();

// CORS: solo el(los) origen(es) de ALLOWED_ORIGIN; credentials para la cookie.
app.use('*', cors({
  origin: (origin: string, c: Context<{ Bindings: Env }>) => {
    const permitidos = c.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim());
    return origin && permitidos.includes(origin) ? origin : c.env.ALLOWED_ORIGIN;
  },
  allowHeaders: ['Content-Type'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}));

// GET /salud — verifica conectividad con Supabase usando el cliente ANON (nunca
// service_role: prohibición absoluta de CLAUDE.md §12). planes es lectura
// pública, suficiente como prueba de que la base responde.
app.get('/salud', async (c) => {
  const supabase = crearClienteAnon(c.env);
  const { error } = await supabase.from('planes').select('id', { count: 'exact', head: true });
  if (error) {
    return c.json({ estado: 'error', detalle: error.message }, 503);
  }
  return c.json({ estado: 'ok' });
});

export default app;
