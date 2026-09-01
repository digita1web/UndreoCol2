import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { crearClienteAnon, crearClienteSuscriptor, type Env } from './lib/db';
import {
  cerrarSesion,
  iniciarSesion,
  obtenerAccessToken,
  verificarSesionAdministrativa,
} from './lib/auth';

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

// POST /auth/registro — signUp de Supabase Auth. No crea tenant (eso es
// onboarding). Con confirmación de email desactivada (D-9, dev) la sesión
// queda lista de inmediato.
app.post('/auth/registro', async (c) => {
  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch(() => ({ email: undefined, password: undefined }));
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password || password.length < 8) {
    return c.json({ error: 'Email inválido o contraseña de menos de 8 caracteres' }, 400);
  }
  const supabase = crearClienteAnon(c.env);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true, usuarioId: data.user?.id }, 201);
});

// POST /auth/login — signInWithPassword + cookie HttpOnly; devuelve perfil y
// membresías activas para que el frontend decida onboarding vs dashboard.
app.post('/auth/login', async (c) => {
  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch(() => ({ email: undefined, password: undefined }));
  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';
  try {
    const { sesion, accessToken } = await iniciarSesion(c, email, password);
    const supabase = crearClienteSuscriptor(c.env, accessToken);
    const { data: perfil, error: errPerfil } = await supabase
      .from('perfiles')
      .select('id, nombre, email')
      .eq('id', sesion.perfilId)
      .maybeSingle();
    const { data: membresias, error: errMembresias } = await supabase
      .from('membresias')
      .select('id, cliente_id, rol')
      .eq('perfil_id', sesion.perfilId)
      .eq('activo', true);
    if (errPerfil || errMembresias) {
      return c.json({ error: 'Sesión iniciada pero no se pudo leer el perfil' }, 500);
    }
    return c.json({ sesion, perfil, membresias });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error de autenticación' }, 401);
  }
});

// POST /auth/logout — revoca la sesión y borra la cookie. Idempotente.
app.post('/auth/logout', async (c) => {
  await cerrarSesion(c);
  return c.json({ ok: true });
});

// POST /auth/recuperar — resetPasswordForEmail.
app.post('/auth/recuperar', async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({ email: undefined }));
  const email = body.email?.trim().toLowerCase();
  if (!email) return c.json({ error: 'Email requerido' }, 400);
  const supabase = crearClienteAnon(c.env);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: c.env.ALLOWED_ORIGIN,
  });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// GET /auth/sesion — valida/refresca la cookie; devuelve sesión, perfil y
// membresías activas. 401 si no hay sesión.
app.get('/auth/sesion', async (c) => {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) return c.json({ error: 'No autenticado' }, 401);
  const token = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, token ?? '');
  const { data: perfil, error: errPerfil } = await supabase
    .from('perfiles')
    .select('id, nombre, email')
    .eq('id', sesion.perfilId)
    .maybeSingle();
  const { data: membresias, error: errMembresias } = await supabase
    .from('membresias')
    .select('id, cliente_id, rol')
    .eq('perfil_id', sesion.perfilId)
    .eq('activo', true);
  if (errPerfil || errMembresias) {
    return c.json({ error: 'No se pudo leer el perfil' }, 500);
  }
  return c.json({ sesion, perfil, membresias });
});

export default app;
