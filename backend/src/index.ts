import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { crearClienteAnon, crearClienteSuscriptor, type Env } from './lib/db';
import {
  cerrarSesion,
  iniciarSesion,
  obtenerAccessToken,
  verificarSesionAdministrativa,
} from './lib/auth';
import { resolverClienteActivo } from './lib/tenant';
import {
  actualizarServicio,
  crearServicio,
  crearTarifa,
  listarServicios,
  listarTarifas,
  matrizTarifas,
  validarCamposEditables,
} from './lib/catalogo';

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

// POST /onboarding — crea el acueducto del usuario en UNA transacción vía
// rpc('crear_tenant_con_admin') (CA-7: sin huérfanos). Requiere sesión.
app.post('/onboarding', async (c) => {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) return c.json({ error: 'No autenticado' }, 401);
  const body = await c.req
    .json<{ nombre?: string; slug?: string }>()
    .catch(() => ({ nombre: undefined, slug: undefined }));
  const nombre = body.nombre?.trim();
  const slug = body.slug?.trim().toLowerCase();
  // Misma regla que clientes.chk_slug.
  if (!nombre || !slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return c.json({ error: 'Nombre requerido y slug en minúsculas, sin espacios ni símbolos' }, 400);
  }
  const accessToken = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, accessToken ?? '');
  const { data, error } = await supabase.rpc('crear_tenant_con_admin', {
    p_nombre_cliente: nombre,
    p_slug: slug,
    p_email: sesion.email,
  });
  if (error) {
    const msg = error.message.includes('El slug ya está en uso')
      ? 'El slug ya está en uso'
      : error.message.includes('El usuario ya tiene un acueducto')
        ? 'El usuario ya tiene un acueducto'
        : error.message;
    return c.json({ error: msg }, 409);
  }
  return c.json({ clienteId: data }, 201);
});

// GET /dashboard — payload de /app/dashboard (spec §4.7): nombre del acueducto,
// nombre y rol del usuario, y conteo de usuarios_servicio del cliente.
app.get('/dashboard', async (c) => {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) return c.json({ error: 'No autenticado' }, 401);
  const accessToken = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, accessToken ?? '');
  const { activo, lista } = await resolverClienteActivo(supabase, sesion.perfilId);
  if (!activo) {
    return c.json({ error: 'Sin acueducto', clientes: lista }, 400);
  }
  const { data: perfil } = await supabase
    .from('perfiles')
    .select('nombre')
    .eq('id', sesion.perfilId)
    .maybeSingle();
  const { count, error } = await supabase
    .from('usuarios_servicio')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', activo.clienteId);
  if (error) return c.json({ error: 'No se pudo consultar usuarios_servicio' }, 500);
  return c.json({
    cliente: activo,
    perfil: { id: sesion.perfilId, email: sesion.email, nombre: (perfil as { nombre?: string } | null)?.nombre ?? sesion.email },
    conteoUsuariosServicio: count ?? 0,
  });
});

// --- Catálogo de servicios y tarifas (002-catalogo-y-tarifas) --------------

// Resuelve sesión + cliente activo. `respuesta` viene poblado con el error
// correspondiente (401/400) cuando `ctx` es null; el caller solo necesita
// `if (!r.ctx) return r.respuesta;`.
type ResultadoClienteActivo =
  | { ctx: { supabase: ReturnType<typeof crearClienteSuscriptor>; clienteId: string }; respuesta?: undefined }
  | { ctx: null; respuesta: Response };

async function requerirClienteActivo(c: Context<{ Bindings: Env }>): Promise<ResultadoClienteActivo> {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) {
    return { ctx: null, respuesta: c.json({ error: 'No autenticado' }, 401) };
  }
  const accessToken = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, accessToken ?? '');
  const { activo, lista } = await resolverClienteActivo(supabase, sesion.perfilId);
  if (!activo) {
    return { ctx: null, respuesta: c.json({ error: 'Sin acueducto', clientes: lista }, 400) };
  }
  return { ctx: { supabase, clienteId: activo.clienteId } };
}

app.get('/catalogo/servicios', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const servicios = await listarServicios(ctx.supabase, ctx.clienteId);
    return c.json({ servicios });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al listar servicios' }, 500);
  }
});

app.post('/catalogo/servicios', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req
    .json<{ codigo?: string; nombre?: string; tipo_calculo?: string; facturable_en_ciclo?: boolean; orden?: number }>()
    .catch(() => ({ codigo: undefined, nombre: undefined, tipo_calculo: undefined, facturable_en_ciclo: undefined, orden: undefined }));
  const codigo = body.codigo?.trim();
  const nombre = body.nombre?.trim();
  const tipoCalculo = body.tipo_calculo;
  if (!codigo || !nombre || (tipoCalculo !== 'por_consumo' && tipoCalculo !== 'fijo')) {
    return c.json({ error: "codigo, nombre y tipo_calculo ('por_consumo'|'fijo') son requeridos" }, 400);
  }
  try {
    const servicio = await crearServicio(ctx.supabase, ctx.clienteId, {
      codigo,
      nombre,
      tipo_calculo: tipoCalculo,
      facturable_en_ciclo: body.facturable_en_ciclo,
      orden: body.orden,
    });
    return c.json({ servicio }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al crear el servicio' }, 400);
  }
});

app.patch('/catalogo/servicios/:id', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const errorCampos = validarCamposEditables(body);
  if (errorCampos) return c.json({ error: errorCampos }, 400);
  const { nombre, facturable_en_ciclo, orden, activo } = body as {
    nombre?: string; facturable_en_ciclo?: boolean; orden?: number; activo?: boolean;
  };
  try {
    const servicio = await actualizarServicio(ctx.supabase, c.req.param('id'), {
      nombre, facturable_en_ciclo, orden, activo,
    });
    return c.json({ servicio });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al actualizar el servicio' }, 400);
  }
});

app.get('/catalogo/tarifas', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const servicioId = c.req.query('servicio_id');
  const categoria = c.req.query('categoria');
  if (!servicioId || !categoria) {
    return c.json({ error: 'servicio_id y categoria son requeridos' }, 400);
  }
  try {
    const tarifas = await listarTarifas(ctx.supabase, servicioId, categoria);
    return c.json({ tarifas });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al listar tarifas' }, 500);
  }
});

app.post('/catalogo/tarifas', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req
    .json<{
      servicio_id?: string; categoria?: string; cargo_fijo?: number;
      limite_basico_m3?: number; precio_basico_m3?: number; precio_no_basico_m3?: number;
    }>()
    .catch(() => ({
      servicio_id: undefined, categoria: undefined, cargo_fijo: undefined,
      limite_basico_m3: undefined, precio_basico_m3: undefined, precio_no_basico_m3: undefined,
    }));
  const { servicio_id, categoria, cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3 } = body;
  if (
    !servicio_id || !categoria ||
    cargo_fijo === undefined || limite_basico_m3 === undefined ||
    precio_basico_m3 === undefined || precio_no_basico_m3 === undefined
  ) {
    return c.json({ error: 'servicio_id, categoria, cargo_fijo, limite_basico_m3, precio_basico_m3 y precio_no_basico_m3 son requeridos' }, 400);
  }
  try {
    const tarifaId = await crearTarifa(ctx.supabase, {
      servicio_id, categoria, cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3,
    });
    return c.json({ tarifaId }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al crear la tarifa' }, 400);
  }
});

app.get('/catalogo/matriz-tarifas', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const matriz = await matrizTarifas(ctx.supabase, ctx.clienteId);
    return c.json({ matriz });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al consultar la matriz de tarifas' }, 500);
  }
});

export default app;
