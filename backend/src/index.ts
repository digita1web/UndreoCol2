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
  validarCamposEditables as validarCamposEditablesServicio,
} from './lib/catalogo';
import {
  actualizarSuscriptor,
  contadorActual,
  crearContador,
  crearSuscriptor,
  historialReemplazos,
  listarSuscriptores,
  obtenerSuscriptor,
  reemplazarContador,
  validarCamposEditables as validarCamposEditablesSuscriptor,
} from './lib/suscriptores';
import {
  cerrarPeriodo,
  crearLectura,
  crearPeriodo,
  listarLecturas,
  listarPeriodos,
  revisarLectura,
} from './lib/lecturas';
import {
  anularFactura,
  listarFacturasDePeriodo,
  obtenerFactura,
  simularPeriodo,
} from './lib/facturacion';
import cierreFacturacion from './queues/cierre-facturacion';

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
  | { ctx: { supabase: ReturnType<typeof crearClienteSuscriptor>; clienteId: string; perfilId: string }; respuesta?: undefined }
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
  return { ctx: { supabase, clienteId: activo.clienteId, perfilId: sesion.perfilId } };
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
  const errorCampos = validarCamposEditablesServicio(body);
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

// --- Suscriptores y contadores (003-suscriptores-contadores) ---------------

app.get('/suscriptores', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const suscriptores = await listarSuscriptores(ctx.supabase, ctx.clienteId, c.req.query('estado'));
    return c.json({ suscriptores });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al listar suscriptores' }, 500);
  }
});

app.post('/suscriptores', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req
    .json<{
      codigo_suscriptor?: string; nombre?: string; tipo_documento?: string; numero_documento?: string;
      telefono?: string; email?: string; direccion?: string; sector?: string; categoria?: string; notas?: string;
    }>()
    .catch(() => ({
      codigo_suscriptor: undefined, nombre: undefined, tipo_documento: undefined, numero_documento: undefined,
      telefono: undefined, email: undefined, direccion: undefined, sector: undefined, categoria: undefined, notas: undefined,
    }));
  const codigoSuscriptor = body.codigo_suscriptor?.trim();
  const nombre = body.nombre?.trim();
  const numeroDocumento = body.numero_documento?.trim();
  const direccion = body.direccion?.trim();
  const categoria = body.categoria?.trim();
  if (!codigoSuscriptor || !nombre || !numeroDocumento || !direccion || !categoria) {
    return c.json({ error: 'codigo_suscriptor, nombre, numero_documento, direccion y categoria son requeridos' }, 400);
  }
  try {
    const suscriptor = await crearSuscriptor(ctx.supabase, ctx.clienteId, {
      codigo_suscriptor: codigoSuscriptor,
      nombre,
      numero_documento: numeroDocumento,
      direccion,
      categoria,
      tipo_documento: body.tipo_documento,
      telefono: body.telefono,
      email: body.email,
      sector: body.sector,
      notas: body.notas,
    });
    return c.json({ suscriptor }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al crear el suscriptor' }, 400);
  }
});

app.get('/suscriptores/:id', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const id = c.req.param('id');
  try {
    const suscriptor = await obtenerSuscriptor(ctx.supabase, id);
    if (!suscriptor) return c.json({ error: 'Suscriptor no encontrado' }, 404);
    const [contador, reemplazos] = await Promise.all([
      contadorActual(ctx.supabase, id),
      historialReemplazos(ctx.supabase, id),
    ]);
    return c.json({ suscriptor, contador, reemplazos });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al obtener el suscriptor' }, 500);
  }
});

app.patch('/suscriptores/:id', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const errorCampos = validarCamposEditablesSuscriptor(body);
  if (errorCampos) return c.json({ error: errorCampos }, 400);
  const {
    nombre, estado, tipo_documento, numero_documento, telefono, email, direccion, sector, categoria, notas,
  } = body as {
    nombre?: string; estado?: string; tipo_documento?: string; numero_documento?: string; telefono?: string;
    email?: string; direccion?: string; sector?: string; categoria?: string; notas?: string;
  };
  try {
    const suscriptor = await actualizarSuscriptor(ctx.supabase, c.req.param('id'), {
      nombre, estado, tipo_documento, numero_documento, telefono, email, direccion, sector, categoria, notas,
    });
    return c.json({ suscriptor });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al actualizar el suscriptor' }, 400);
  }
});

app.post('/suscriptores/:id/contador', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const usuarioServicioId = c.req.param('id');
  const body = await c.req
    .json<{ serial?: string; marca?: string; capacidad_maxima?: number; lectura_inicial?: number; fecha_instalacion?: string }>()
    .catch(() => ({
      serial: undefined, marca: undefined, capacidad_maxima: undefined, lectura_inicial: undefined, fecha_instalacion: undefined,
    }));
  const serial = body.serial?.trim();
  const fechaInstalacion = body.fecha_instalacion?.trim();
  if (!serial || body.capacidad_maxima === undefined || !fechaInstalacion) {
    return c.json({ error: 'serial, capacidad_maxima y fecha_instalacion son requeridos' }, 400);
  }
  try {
    const contador = await crearContador(ctx.supabase, ctx.clienteId, {
      usuario_servicio_id: usuarioServicioId,
      serial,
      marca: body.marca,
      capacidad_maxima: body.capacidad_maxima,
      lectura_inicial: body.lectura_inicial,
      fecha_instalacion: fechaInstalacion,
    });
    return c.json({ contador }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al crear el contador' }, 400);
  }
});

app.post('/suscriptores/:id/reemplazar-contador', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const usuarioServicioId = c.req.param('id');
  const body = await c.req
    .json<{
      serial_nuevo?: string; marca_nuevo?: string; capacidad_maxima_nuevo?: number;
      lectura_final_anterior?: number; lectura_inicial_nuevo?: number; motivo?: string;
    }>()
    .catch(() => ({
      serial_nuevo: undefined, marca_nuevo: undefined, capacidad_maxima_nuevo: undefined,
      lectura_final_anterior: undefined, lectura_inicial_nuevo: undefined, motivo: undefined,
    }));
  const serialNuevo = body.serial_nuevo?.trim();
  if (!serialNuevo || body.capacidad_maxima_nuevo === undefined || body.lectura_final_anterior === undefined) {
    return c.json({ error: 'serial_nuevo, capacidad_maxima_nuevo y lectura_final_anterior son requeridos' }, 400);
  }
  try {
    const reemplazoId = await reemplazarContador(ctx.supabase, {
      usuario_servicio_id: usuarioServicioId,
      serial_nuevo: serialNuevo,
      marca_nuevo: body.marca_nuevo,
      capacidad_maxima_nuevo: body.capacidad_maxima_nuevo,
      lectura_final_anterior: body.lectura_final_anterior,
      lectura_inicial_nuevo: body.lectura_inicial_nuevo,
      motivo: body.motivo,
    });
    return c.json({ reemplazoId }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al reemplazar el contador' }, 400);
  }
});

// --- Periodos y lecturas (004-lecturas-y-consumo) ---------------------------

// POST /periodos — crea el periodo abierto del mes (único abierto por cliente).
app.post('/periodos', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req
    .json<{ nombre?: string; anio?: number; mes?: number; fecha_inicio?: string; fecha_fin?: string; fecha_vencimiento?: string }>()
    .catch(() => ({
      nombre: undefined, anio: undefined, mes: undefined,
      fecha_inicio: undefined, fecha_fin: undefined, fecha_vencimiento: undefined,
    }));
  if (!body.nombre || !body.anio || !body.mes || !body.fecha_inicio || !body.fecha_fin || !body.fecha_vencimiento) {
    return c.json({ error: 'nombre, anio, mes, fecha_inicio, fecha_fin y fecha_vencimiento son requeridos' }, 400);
  }
  try {
    const periodo = await crearPeriodo(ctx.supabase, ctx.clienteId, {
      nombre: body.nombre.trim(),
      anio: body.anio,
      mes: body.mes,
      fecha_inicio: body.fecha_inicio,
      fecha_fin: body.fecha_fin,
      fecha_vencimiento: body.fecha_vencimiento,
    });
    return c.json({ periodo }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al crear el periodo' }, 400);
  }
});

// GET /periodos — lista periodos del cliente (admin o lector).
app.get('/periodos', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const periodos = await listarPeriodos(ctx.supabase, ctx.clienteId);
    return c.json({ periodos });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al listar los periodos' }, 400);
  }
});

// PATCH /periodos/:id/cerrar — cierra el periodo (solo admin_acueducto, vía RLS).
app.patch('/periodos/:id/cerrar', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const periodo = await cerrarPeriodo(ctx.supabase, ctx.clienteId, c.req.param('id'), ctx.perfilId);
    return c.json({ periodo });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al cerrar el periodo' }, 400);
  }
});

// GET /lecturas?periodo_id=&solo_revision=true — lista lecturas por periodo,
// con opción de filtrar la cola de anomalías pendientes.
app.get('/lecturas', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const periodoId = c.req.query('periodo_id') || undefined;
  const soloAnomalias = c.req.query('solo_revision') === 'true';
  try {
    const lecturas = await listarLecturas(ctx.supabase, ctx.clienteId, { periodoId, soloAnomalias });
    return c.json({ lecturas });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al listar las lecturas' }, 400);
  }
});

// POST /lecturas — crea una lectura; calcula consumo y anomalía en core/consumo.ts;
// respeta id_cliente_offline para no duplicar reenvíos offline.
app.post('/lecturas', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req
    .json<{
      contador_id?: string;
      periodo_id?: string;
      fecha_lectura?: string;
      lectura_actual?: number;
      id_cliente_offline?: string;
    }>()
    .catch(() => ({
      contador_id: undefined, periodo_id: undefined, fecha_lectura: undefined,
      lectura_actual: undefined, id_cliente_offline: undefined,
    }));
  if (!body.contador_id || !body.periodo_id || !body.fecha_lectura || typeof body.lectura_actual !== 'number') {
    return c.json({ error: 'contador_id, periodo_id, fecha_lectura y lectura_actual son requeridos' }, 400);
  }
  try {
    const { lectura, nuevo } = await crearLectura(ctx.supabase, ctx.clienteId, {
      contador_id: body.contador_id,
      periodo_id: body.periodo_id,
      fecha_lectura: body.fecha_lectura,
      lectura_actual: body.lectura_actual,
      id_cliente_offline: body.id_cliente_offline,
      tomada_por: ctx.perfilId,
    });
    return c.json({ lectura, nuevo }, nuevo ? 201 : 200);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al crear la lectura' }, 400);
  }
});

// PATCH /lecturas/:id/revisar — marca una lectura como revisada (solo admin).
app.patch('/lecturas/:id/revisar', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const lectura = await revisarLectura(ctx.supabase, ctx.clienteId, c.req.param('id'), ctx.perfilId);
    return c.json({ lectura });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Error al marcar la lectura como revisada' }, 400);
  }
});

// --- Facturación (005-facturacion) -------------------------------------------

// POST /facturacion/periodos/:id/simular — modo simulación (dry-run): calcula
// el cierre SIN insertar nada (spec §3.3). Solo lectura.
app.post('/facturacion/periodos/:id/simular', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const resumen = await simularPeriodo(ctx.supabase, ctx.clienteId, c.req.param('id'));
    return c.json({ resumen });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo simular el periodo' }, 400);
  }
});

// GET /facturacion/periodos/:id/facturas — lista facturas emitidas del periodo.
app.get('/facturacion/periodos/:id/facturas', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const facturas = await listarFacturasDePeriodo(ctx.supabase, ctx.clienteId, c.req.param('id'));
    return c.json({ facturas });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudieron listar las facturas' }, 400);
  }
});

// GET /facturas/:id — detalle de una factura con sus renglones.
app.get('/facturas/:id', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const { factura, detalles } = await obtenerFactura(ctx.supabase, ctx.clienteId, c.req.param('id'));
    return c.json({ factura, detalles });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo obtener la factura' }, 400);
  }
});

// POST /facturas/:id/anular — anula una factura emitida (motivo obligatorio).
app.post('/facturas/:id/anular', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req.json<{ motivo?: string }>().catch(() => ({ motivo: undefined }));
  const motivo = body.motivo?.trim();
  if (!motivo) return c.json({ error: 'El motivo de anulación es obligatorio' }, 400);
  try {
    const factura = await anularFactura(ctx.supabase, ctx.clienteId, c.req.param('id'), motivo, ctx.perfilId);
    return c.json({ factura });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo anular la factura' }, 400);
  }
});

// POST /facturacion/periodos/:id/emitir — modo emisión. Encola UNA factura por
// mensaje en FACTURACION_COLA (devuelve 202). Defensa: rechaza si el periodo ya
// tiene facturas emitidas (no duplicar). El gate de "se simuló" es de UI.
app.post('/facturacion/periodos/:id/emitir', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const cola = c.env.FACTURACION_COLA;
  if (!cola) return c.json({ error: 'La cola de facturación no está configurada' }, 500);
  const periodoId = c.req.param('id');

  try {
    // defensa: no re-emitir un periodo que ya tiene facturas
    const existentes = await listarFacturasDePeriodo(ctx.supabase, ctx.clienteId, periodoId);
    if (existentes.length > 0) {
      return c.json({ error: 'El periodo ya tiene facturas emitidas (no se duplica la emisión)' }, 409);
    }
    // resuelve quién se factura (los que tienen lectura + tarifa) y encola 1 c/u
    const resumen = await simularPeriodo(ctx.supabase, ctx.clienteId, periodoId);
    const aEmitir = resumen.detalle.filter((d) => d.consumoM3 !== null && d.tieneTarifa && d.total > 0);
    for (const d of aEmitir) {
      await cola.send({
        clienteId: ctx.clienteId,
        periodoId,
        usuarioServicioId: d.usuarioServicioId,
      });
    }
    return c.json({
      encoladas: aEmitir.length,
      omitidas: resumen.detalle.length - aEmitir.length,
      mensaje: 'Emisión encolada: una factura por mensaje en Cloudflare Queues',
    }, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo encolar la emisión' }, 400);
  }
});

// El Worker principal es a la vez HTTP (Hono) y consumidor de la cola de
// facturación (mismo worker producer+consumer: round-trip local verificado en
// plan.md §0). En producción Cloudflare enruta igual: un Worker puede tener
// fetch + queue.
export default {
  fetch: app.fetch,
  queue: cierreFacturacion.queue,
};
