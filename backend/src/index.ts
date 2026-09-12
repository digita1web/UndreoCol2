import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearClienteAnon, crearClienteSuscriptor, type Env } from './lib/db';
import {
  cerrarSesion,
  completarRecuperacion,
  iniciarSesion,
  obtenerAccessToken,
  obtenerTokensSesion,
  verificarSesionAdministrativa,
} from './lib/auth';
import { resolverClienteActivo } from './lib/tenant';
import { estadoLoginAdmin, registrarIntentoLoginAdmin } from './lib/auth-intentos';
import {
  asignarAdminAcueducto,
  crearAcueductoBase,
  generarContrasenaTemporal,
  obtenerAdminsDeAcueductos,
  signUpAdminAcueducto,
} from './lib/plataforma';
import { enviarCorreo } from './lib/email';
import {
  actualizarServicio,
  crearServicio,
  crearTarifa,
  crearAutorizacionTarifa,
  listarAutorizacionesTarifa,
  listarServicios,
  listarTarifas,
  matrizTarifas,
  revocarAutorizacionTarifa,
  usarAutorizacionTarifa,
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
  regenerarCodigoSuscriptor,
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
import { generarPdfFactura, type DatosAcueductoPdf } from './lib/factura-pdf';
import { esColorHexValido } from './core/color';
import {
  anularPago,
  obtenerCartera,
  obtenerPagosDeFactura,
  obtenerPagosDeSuscriptor,
  registrarPago,
} from './lib/pagos';
import { obtenerIndicadores } from './lib/dashboard';
import { redondearPeso } from './core/pagos';
import {
  cortarSuscriptor,
  historialCortes,
  listarCandidatosCorte,
  reconectarSuscriptor,
} from './lib/cortes';
import { validarFilas, type FilaCruda, type MapeoColumnas, type ErrorFila, type FilaNormalizada } from './core/importacion-suscriptores';
import { confirmarImportacion, detectarDuplicadosContraBase } from './lib/importacion-suscriptores';
import {
  obtenerConsumoPortal,
  obtenerFacturaCompletaPortal,
  obtenerFacturasPortal,
  obtenerSaldoFavorPortal,
  requerirSesionSuscriptor,
  resolverClientePorSlug,
  validarCredencialesPortal,
} from './lib/portal';
import {
  cerrarSesionSuscriptor,
  iniciarSesionSuscriptor,
} from './lib/sesion-suscriptor';
import cierreFacturacion from './queues/cierre-facturacion';
import { encolarNotificacion } from './lib/notificaciones';
import {
  contenidoConfirmacionPago,
  contenidoCorteEjecutado,
  contenidoReconexionCompletada,
} from './core/notificaciones';

const app = new Hono<{ Bindings: Env }>();

// CORS: solo el(los) origen(es) de ALLOWED_ORIGIN; credentials para la cookie.
//
// allowMethods incluye PATCH porque la API registra 4 rutas PATCH — editar
// servicio, editar suscriptor, CERRAR PERIODO y marcar lectura revisada. Sin
// PATCH aquí el preflight del navegador rechaza esas cuatro operaciones desde
// otro origen; cerrar el periodo es la operación central del mes (hallazgo B-4
// de la auditoría pre-producción, docs/PLAN-PRODUCCION.md).
//
// El origen no permitido cae al PRIMER origen de la lista, no a la cadena
// completa de ALLOWED_ORIGIN: si la variable trae varios separados por coma,
// devolverla entera produce una cabecera Access-Control-Allow-Origin inválida.
// En ambos casos el navegador bloquea al origen no permitido (que es lo que se
// busca), pero devolver un valor válido evita diagnosticar un fallo de CORS
// legítimo como si fuera una cabecera malformada.
app.use('*', cors({
  origin: (origin: string, c: Context<{ Bindings: Env }>) => {
    const permitidos = c.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
    if (origin && permitidos.includes(origin)) return origin;
    return permitidos[0] ?? '';
  },
  allowHeaders: ['Content-Type'],
  allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
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

// POST /auth/login — signInWithPassword + cookie HttpOnly; devuelve perfil y
// membresías activas para que el frontend decida onboarding vs dashboard.
//
// Límite de intentos (017, hallazgo A-2 de la auditoría): se consulta el estado
// ANTES de golpear GoTrue y se registra el resultado después. El caso caro —un
// email bloqueado— es el más barato: corta en la primera RPC y no llega a
// Supabase Auth. El 401 genérico no cambia: sigue sin revelar si el email
// existe, y el contador cuenta igual los emails inexistentes (CA-4).
app.post('/auth/login', async (c) => {
  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch(() => ({ email: undefined, password: undefined }));
  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';

  // Falla CERRADO (plan §5.4): si no se puede saber si está bloqueado, no se
  // intenta el login. GoTrue y esta tabla son el mismo PostgreSQL, así que el
  // login iba a fallar igual; fallar abierto haría desaparecer la protección
  // justo cuando un atacante puede provocarlo.
  try {
    const estado = await estadoLoginAdmin(c.env, email);
    if (estado.bloqueado) {
      // Mismo contrato que el 429 del portal (POST /portal/:slug/login).
      return c.json(
        { error: 'Demasiados intentos. Intente más tarde.', reintentar_en: estado.reintentarEn },
        429,
      );
    }
  } catch (e) {
    console.error('auth/login: no se pudo consultar el límite de intentos', e instanceof Error ? e.message : e);
    return c.json({ error: 'Servicio no disponible. Intente más tarde.' }, 503);
  }

  let sesion: Awaited<ReturnType<typeof iniciarSesion>>['sesion'];
  let accessToken: string;
  try {
    ({ sesion, accessToken } = await iniciarSesion(c, email, password));
  } catch (e) {
    // El registro del intento va aquí y no en un catch que envuelva también las
    // consultas de abajo: un fallo al leer el perfil NO es un fallo de
    // credenciales y no debe contar contra el límite.
    await registrarIntentoLoginAdmin(c.env, email, false);
    return c.json({ error: e instanceof Error ? e.message : 'Error de autenticación' }, 401);
  }
  await registrarIntentoLoginAdmin(c.env, email, true);

  {
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
      // El mensaje al cliente queda genérico a propósito (no filtrar detalles
      // internos de Postgres/PostgREST) — pero el error real SIEMPRE queda en
      // el log del Worker (CLAUDE.md §7: nunca silenciar un fallo de auth).
      console.error('auth/login: no se pudo leer perfil/membresías tras iniciar sesión', {
        perfilId: sesion.perfilId,
        errPerfil: errPerfil?.message,
        errMembresias: errMembresias?.message,
      });
      return c.json({ error: 'Sesión iniciada pero no se pudo leer el perfil' }, 500);
    }
    return c.json({ sesion, perfil, membresias });
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
  // El enlace debe caer en /restablecer-contrasena (034), no en la raíz — ahí
  // es donde se lee el fragmento #access_token=...&type=recovery. Mismo
  // criterio de "primer origen de la lista" que ya usa CORS (B-4): ALLOWED_ORIGIN
  // puede traer varios separados por coma, concatenar la cadena entera
  // produciría una URL inválida.
  const primerOrigen = c.env.ALLOWED_ORIGIN.split(',')[0]?.trim() ?? '';
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${primerOrigen}/restablecer-contrasena`,
  });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// POST /auth/completar-recuperacion — valida el enlace de recuperación,
// cambia la contraseña y deja activa la sesión administrativa resultante.
app.post('/auth/completar-recuperacion', async (c) => {
  const body = await c.req
    .json<{ accessToken?: string; refreshToken?: string; passwordNueva?: string }>()
    .catch(() => ({ accessToken: undefined, refreshToken: undefined, passwordNueva: undefined }));
  const accessToken = body.accessToken ?? '';
  const refreshToken = body.refreshToken ?? '';
  const passwordNueva = body.passwordNueva ?? '';

  if (passwordNueva.length < 8) {
    return c.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
  }

  let resultado: Awaited<ReturnType<typeof completarRecuperacion>>;
  try {
    resultado = await completarRecuperacion(c, accessToken, refreshToken, passwordNueva);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Enlace de recuperación inválido o vencido' }, 401);
  }

  const supabase = crearClienteSuscriptor(c.env, resultado.accessToken);
  const { data: perfil, error: errPerfil } = await supabase
    .from('perfiles')
    .select('id, nombre, email')
    .eq('id', resultado.sesion.perfilId)
    .maybeSingle();
  const { data: membresias, error: errMembresias } = await supabase
    .from('membresias')
    .select('id, cliente_id, rol')
    .eq('perfil_id', resultado.sesion.perfilId)
    .eq('activo', true);
  if (errPerfil || errMembresias) {
    console.error('auth/completar-recuperacion: no se pudo leer perfil/membresías', {
      perfilId: resultado.sesion.perfilId,
      errPerfil: errPerfil?.message,
      errMembresias: errMembresias?.message,
    });
    return c.json({ error: 'Contraseña actualizada pero no se pudo leer el perfil' }, 500);
  }

  return c.json({ sesion: resultado.sesion, perfil, membresias });
});

// POST /auth/cambiar-contrasena — el usuario de la sesión activa cambia su
// propia contraseña. Nunca usa service_role: la sesión JWT autoriza la acción.
// auth.updateUser() (a diferencia de las consultas PostgREST del resto de las
// rutas) necesita una sesión activa en el cliente, no solo el access_token
// como header — de ahí setSession() con ambos tokens, mismo patrón que ya usa
// verificarSesionAdministrativa()/cerrarSesion() en lib/auth.ts. Sin este
// paso, updateUser() falla con "Auth session missing!" (confirmado real).
app.post('/auth/cambiar-contrasena', async (c) => {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) return c.json({ error: 'No autenticado' }, 401);

  const body = await c.req
    .json<{ passwordNueva?: string }>()
    .catch(() => ({ passwordNueva: undefined }));
  const passwordNueva = body.passwordNueva ?? '';
  if (passwordNueva.length < 8) {
    return c.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
  }

  const tokens = obtenerTokensSesion(c);
  if (!tokens) return c.json({ error: 'No autenticado' }, 401);
  const supabase = crearClienteAnon(c.env);
  const { error: errSesion } = await supabase.auth.setSession({
    access_token: tokens.at,
    refresh_token: tokens.rt,
  });
  if (errSesion) return c.json({ error: 'No se pudo validar la sesión' }, 401);

  const { error } = await supabase.auth.updateUser({ password: passwordNueva });
  if (error) return c.json({ error: error.message }, 400);

  const resultadoCorreo = await enviarCorreo(c.env, {
    destinatario: sesion.email,
    remitente: 'no-responder@undreocol.app',
    asunto: 'Tu contraseña de UndreoCol cambió',
    cuerpoHtml: `<p>La contraseña de tu cuenta (${sesion.email}) se cambió el ${new Date().toISOString()}.</p><p>Si no fuiste vos, contactá al soporte de inmediato.</p>`,
  });
  if (!resultadoCorreo.ok) {
    console.error('cambiar-contrasena: no se pudo enviar el aviso de correo', resultadoCorreo.error);
  }

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

// GET /dashboard — payload de /app/dashboard (spec §4.7): nombre del acueducto,
// nombre y rol del usuario, y conteo de usuarios_servicio del cliente.
app.get('/dashboard', async (c) => {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) return c.json({ error: 'No autenticado' }, 401);
  const accessToken = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, accessToken ?? '');
  const { activo, lista, esAdminPlataforma } = await resolverClienteActivo(supabase, sesion.perfilId);
  if (!activo) {
    // 018: un superadmin puro (esAdminPlataforma) no tiene "acueducto" que
    // mostrar — el frontend lo manda a /plataforma en vez de /onboarding.
    return c.json({ error: 'Sin acueducto', clientes: lista, esAdminPlataforma }, 400);
  }
  const { data: perfil } = await supabase
    .from('perfiles')
    .select('nombre')
    .eq('id', sesion.perfilId)
    .maybeSingle();
  // 024 le quitó a `lector` el SELECT directo sobre usuarios_servicio (RLS);
  // usuarios_servicio_lector() sigue accesible a cualquier rol del acueducto
  // (revalida pertenencia, no rol — igual que tarifa_vigente, B-3), así que
  // sirve para este conteo sin depender de qué rol esté mirando el dashboard.
  const { data: usuariosServicio, error } = await supabase.rpc('usuarios_servicio_lector', {
    p_cliente_id: activo.clienteId,
  });
  if (error) return c.json({ error: 'No se pudo consultar usuarios_servicio' }, 500);
  return c.json({
    cliente: activo,
    perfil: { id: sesion.perfilId, email: sesion.email, nombre: (perfil as { nombre?: string } | null)?.nombre ?? sesion.email },
    conteoUsuariosServicio: usuariosServicio?.length ?? 0,
  });
});

// --- Panel de plataforma (018): alta de acueductos por el superadmin -------

type ResultadoAdminPlataforma =
  | { ctx: { supabase: ReturnType<typeof crearClienteSuscriptor>; perfilId: string }; respuesta?: undefined }
  | { ctx: null; respuesta: Response };

async function requerirAdminPlataforma(c: Context<{ Bindings: Env }>): Promise<ResultadoAdminPlataforma> {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) {
    return { ctx: null, respuesta: c.json({ error: 'No autenticado' }, 401) };
  }
  const accessToken = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, accessToken ?? '');
  const { data: membresia } = await supabase
    .from('membresias')
    .select('rol')
    .eq('perfil_id', sesion.perfilId)
    .is('cliente_id', null)
    .eq('rol', 'administrador')
    .eq('activo', true)
    .maybeSingle();
  if (!membresia) {
    return { ctx: null, respuesta: c.json({ error: 'No autorizado' }, 403) };
  }
  return { ctx: { supabase, perfilId: sesion.perfilId } };
}

// GET /plataforma — lista de acueductos, solo para el superadmin.
app.get('/plataforma', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;
  const { data, error } = await ctx.supabase
    .from('clientes')
    .select('id, nombre, slug, fecha_alta')
    .order('fecha_alta', { ascending: false });
  if (error) return c.json({ error: 'No se pudo listar los acueductos' }, 500);
  const acueductos = data ?? [];
  const adminsPorCliente = await obtenerAdminsDeAcueductos(ctx.supabase, acueductos.map((a) => a.id));
  return c.json({
    acueductos: acueductos.map((a) => ({ ...a, adminEmail: adminsPorCliente[a.id] ?? null })),
  });
});

// POST /plataforma/acueductos — alta de un acueducto + su primer admin.
// Orden de 3 pasos (plan §3, §5.1): sin transacción atómica única entre
// Postgres y GoTrue — ver los comentarios de cada paso para el porqué y el
// modo de falla de cada uno.
app.post('/plataforma/acueductos', async (c) => {
  const { ctx, respuesta } = await requerirAdminPlataforma(c);
  if (!ctx) return respuesta;

  const body = await c.req
    .json<{ nombre?: string; slug?: string; nombreAdmin?: string; correoAdmin?: string }>()
    .catch(() => ({ nombre: undefined, slug: undefined, nombreAdmin: undefined, correoAdmin: undefined }));
  const nombre = body.nombre?.trim() ?? '';
  const slug = body.slug?.trim().toLowerCase() ?? '';
  const nombreAdmin = body.nombreAdmin?.trim() ?? '';
  const correoAdmin = body.correoAdmin?.trim().toLowerCase() ?? '';
  if (!nombre || !slug || !nombreAdmin || !correoAdmin) {
    return c.json({ error: 'nombre, slug, nombreAdmin y correoAdmin son requeridos' }, 400);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return c.json({ error: 'El slug solo admite minúsculas, números y guiones' }, 400);
  }

  // Paso 1: clientes + configuracion. Si falla (slug duplicado), no se ha
  // tocado Auth todavía — error limpio, nada que limpiar.
  let clienteId: string;
  try {
    ({ clienteId } = await crearAcueductoBase(ctx.supabase, nombre, slug));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo crear el acueducto' }, 400);
  }

  // Paso 2: signUp con la clave anon (nunca service_role, CLAUDE.md §12). Si
  // falla, queda un `clientes` sin admin — visible en GET /plataforma, no un
  // usuario huérfano invisible. No hay reintento automático en v1 (plan §5.1).
  const contrasenaTemporal = generarContrasenaTemporal();
  let usuarioId: string;
  try {
    ({ usuarioId } = await signUpAdminAcueducto(c.env, correoAdmin, contrasenaTemporal));
  } catch (e) {
    return c.json(
      {
        error: `El acueducto '${slug}' se creó pero no se pudo dar de alta el correo del admin: ${
          e instanceof Error ? e.message : 'error desconocido'
        }. El acueducto queda sin administrador; reintente el alta del admin para este acueducto.`,
        clienteId,
      },
      500,
    );
  }

  // Paso 3: perfiles + membresias. A esta altura clientes y auth.users ya
  // existen y son válidos; si esto falla, el auth.users queda con la
  // contraseña ya entregada — recuperable a mano (plan §5.1).
  try {
    await asignarAdminAcueducto(ctx.supabase, clienteId, usuarioId, nombreAdmin, correoAdmin);
  } catch (e) {
    return c.json(
      {
        error: `El acueducto '${slug}' y el usuario de ${correoAdmin} se crearon, pero no se pudo vincularlos: ${
          e instanceof Error ? e.message : 'error desconocido'
        }. Requiere corrección manual.`,
        clienteId,
        usuarioId,
      },
      500,
    );
  }

  return c.json({ clienteId, slug, correoAdmin, contrasenaTemporal }, 201);
});

// --- Catálogo de servicios y tarifas (002-catalogo-y-tarifas) --------------

// Resuelve sesión + cliente activo. `respuesta` viene poblado con el error
// correspondiente (401/400) cuando `ctx` es null; el caller solo necesita
// `if (!r.ctx) return r.respuesta;`. `rol` es el rol del miembro en el acueducto
// activo (aditivo, retrocompatible — los callers previos lo ignoran); lo usa el
// endpoint de indicadores (011) para exigir `admin_acueducto` (403 explícito).
type ResultadoClienteActivo =
  | { ctx: { supabase: ReturnType<typeof crearClienteSuscriptor>; clienteId: string; perfilId: string; rol: string }; respuesta?: undefined }
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
  return { ctx: { supabase, clienteId: activo.clienteId, perfilId: sesion.perfilId, rol: activo.rol } };
}

// GET /dashboard/indicadores — indicadores operativos del acueducto (011).
// Solo `admin_acueducto`: cualquier otro rol autenticado recibe 403 EXPLÍCITO
// (decisión del spec §0.4); nunca datos vacíos ni un 200 parcial. Los datos se
// agregan con el JWT del usuario (RLS FORCE); nunca service_role.
app.get('/dashboard/indicadores', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json(
      { error: 'Solo el administrador del acueducto puede ver los indicadores' },
      403,
    );
  }
  try {
    const indicadores = await obtenerIndicadores(ctx.supabase, ctx.clienteId);
    return c.json({ indicadores });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudieron obtener los indicadores' }, 400);
  }
});

// GET /acueducto — datos del acueducto activo (023): nombre, NIT, dirección,
// teléfono, municipio, logo y color de acento. Cualquier rol del acueducto
// puede leerlo (RLS clientes_lectura ya lo permite) — lo usan tanto
// /app/configuracion como el encabezado de /app/facturacion/[facturaId].
app.get('/acueducto', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const { data, error } = await ctx.supabase
    .from('clientes')
    .select('nombre, nit, direccion, telefono, municipio, logo_url, color_acento')
    .eq('id', ctx.clienteId)
    .single();
  if (error || !data) return c.json({ error: 'No se pudo leer el acueducto' }, 400);
  return c.json({
    acueducto: {
      nombre: data.nombre,
      nit: data.nit,
      direccion: data.direccion,
      telefono: data.telefono,
      municipio: data.municipio,
      logoUrl: data.logo_url,
      colorAcento: data.color_acento,
    },
  });
});

// PATCH /acueducto/color — cambia el color de acento (023). Solo
// `admin_acueducto` (403 explícito, mismo patrón que /dashboard/indicadores);
// el hex se valida ANTES de tocar la base (400 si es inválido) — el CHECK de
// la migración es la segunda capa, no la única (CA-4).
app.patch('/acueducto/color', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede cambiar el color' }, 403);
  }
  const body = await c.req.json<{ color_acento?: string }>().catch(() => ({ color_acento: undefined }));
  const colorAcento = body.color_acento?.trim() ?? '';
  if (!esColorHexValido(colorAcento)) {
    return c.json({ error: 'color_acento debe ser un hexadecimal #RRGGBB' }, 400);
  }
  const { error } = await ctx.supabase
    .from('clientes')
    .update({ color_acento: colorAcento })
    .eq('id', ctx.clienteId);
  if (error) return c.json({ error: 'No se pudo guardar el color' }, 400);
  return c.json({ colorAcento });
});

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
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Use una autorización vigente del administrador para cambiar tarifas' }, 403);
  }
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
  const valores = [cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3];
  if (valores.some((v) => !Number.isFinite(v) || v < 0)) {
    return c.json({ error: 'Los valores de la tarifa deben ser números finitos no negativos' }, 400);
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

app.get('/catalogo/autorizaciones-tarifa', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const autorizaciones = await listarAutorizacionesTarifa(ctx.supabase, ctx.clienteId);
    return c.json({ autorizaciones });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudieron listar las autorizaciones' }, 500);
  }
});

app.post('/catalogo/autorizaciones-tarifa', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede autorizar cambios de tarifas' }, 403);
  }
  const body = await c.req.json<{
    servicio_id?: string; categoria?: string; motivo?: string; expira_en?: string;
  }>().catch(() => ({
    servicio_id: undefined, categoria: undefined, motivo: undefined, expira_en: undefined,
  }));
  if (!body.servicio_id || !body.categoria || !body.motivo?.trim() || !body.expira_en) {
    return c.json({ error: 'servicio_id, categoria, motivo y expira_en son requeridos' }, 400);
  }
  try {
    const id = await crearAutorizacionTarifa(ctx.supabase, {
      servicio_id: body.servicio_id,
      categoria: body.categoria,
      motivo: body.motivo.trim(),
      expira_en: body.expira_en,
    });
    return c.json({ id }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo crear la autorización' }, 400);
  }
});

app.post('/catalogo/autorizaciones-tarifa/:id/revocar', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede revocar autorizaciones' }, 403);
  }
  try {
    await revocarAutorizacionTarifa(ctx.supabase, c.req.param('id'));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo revocar la autorización' }, 400);
  }
});

app.post('/catalogo/tarifas/autorizada', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'secretaria') {
    return c.json({ error: 'Esta ruta es exclusiva para secretaria con autorización vigente' }, 403);
  }
  const body = await c.req.json<{
    autorizacion_id?: string; cargo_fijo?: number; limite_basico_m3?: number;
    precio_basico_m3?: number; precio_no_basico_m3?: number;
  }>().catch(() => ({
    autorizacion_id: undefined, cargo_fijo: undefined, limite_basico_m3: undefined,
    precio_basico_m3: undefined, precio_no_basico_m3: undefined,
  }));
  const valores = [body.cargo_fijo, body.limite_basico_m3, body.precio_basico_m3, body.precio_no_basico_m3];
  if (!body.autorizacion_id || valores.some((v) => v === undefined)) {
    return c.json({ error: 'autorizacion_id y todos los valores de la tarifa son requeridos' }, 400);
  }
  if (valores.some((v) => !Number.isFinite(v) || (v as number) < 0)) {
    return c.json({ error: 'Los valores de la tarifa deben ser números finitos no negativos' }, 400);
  }
  try {
    const tarifaId = await usarAutorizacionTarifa(ctx.supabase, {
      autorizacion_id: body.autorizacion_id,
      cargo_fijo: body.cargo_fijo as number,
      limite_basico_m3: body.limite_basico_m3 as number,
      precio_basico_m3: body.precio_basico_m3 as number,
      precio_no_basico_m3: body.precio_no_basico_m3 as number,
    });
    return c.json({ tarifaId }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo aplicar la autorización' }, 400);
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
    const suscriptores = await listarSuscriptores(
      ctx.supabase,
      ctx.clienteId,
      c.req.query('estado'),
      ctx.rol === 'lector',
    );
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
  // 024 (M-2b): calcula montos de facturación completos — solo admin_acueducto.
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede simular el cierre' }, 403);
  }
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
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede anular facturas' }, 403);
  }
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
  // 024 (M-2b, CRÍTICO del hallazgo): sin este guard, cualquier rol podía
  // encolar la emisión REAL de facturas de todo el acueducto — el consumidor
  // de la cola escribe con service_role, sin pasar por RLS en absoluto.
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede emitir facturas' }, 403);
  }
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
        tipo: 'emitir_factura',
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
// POST /facturas/:id/enviar-correo — encola el envío del correo de UNA factura
// (202). Crea la fila en notificaciones (pendiente). El envío nunca ocurre en
// este request (cola) — regla 20.
app.post('/facturas/:id/enviar-correo', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  // 024 (M-2b): ya fallaba para el lector (notificaciones_admin exige
  // admin_acueducto), pero en silencio — este guard da un 403 explícito.
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede enviar la factura por correo' }, 403);
  }
  const cola = c.env.FACTURACION_COLA;
  if (!cola) return c.json({ error: 'La cola de facturación no está configurada' }, 500);
  const facturaId = c.req.param('id');
  try {
    const { factura } = await obtenerFactura(ctx.supabase, ctx.clienteId, facturaId);
    const { data: suscriptor } = await ctx.supabase
      .from('usuarios_servicio')
      .select('email')
      .eq('id', factura.usuario_servicio_id)
      .single();
    const email = (suscriptor?.email ?? '').trim();
    if (!email) {
      return c.json({ error: 'El suscriptor de la factura no tiene email registrado' }, 400);
    }
    const { data: notificacion, error: errNotif } = await ctx.supabase
      .from('notificaciones')
      .insert({
        cliente_id: ctx.clienteId,
        usuario_servicio_id: factura.usuario_servicio_id,
        factura_id: facturaId,
        tipo: 'factura_generada',
        canal: 'email',
        destinatario: email,
        asunto: `Factura ${factura.numero}`,
        estado: 'pendiente',
        intentos: 0,
      })
      .select('id')
      .single();
    if (errNotif || !notificacion) throw new Error(`No se pudo registrar el envío: ${errNotif?.message ?? ''}`);
    await cola.send({
      tipo: 'enviar_correo_factura',
      clienteId: ctx.clienteId,
      facturaId,
      notificacionId: notificacion.id,
    });
    return c.json({ encolado: true, notificacionId: notificacion.id }, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo encolar el envío' }, 400);
  }
});

// POST /facturacion/periodos/:id/enviar-correo — encola el envío del correo de
// las facturas del periodo cuyos suscriptores tienen email. Devuelve cuántos se
// encolaron y cuántos se omitieron (sin email → se entregan impresas, D-8).
app.post('/facturacion/periodos/:id/enviar-correo', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  // 024 (M-2b): ya fallaba para el lector (notificaciones_admin exige
  // admin_acueducto), pero en silencio — este guard da un 403 explícito.
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede enviar las facturas por correo' }, 403);
  }
  const cola = c.env.FACTURACION_COLA;
  if (!cola) return c.json({ error: 'La cola de facturación no está configurada' }, 500);
  const periodoId = c.req.param('id');
  try {
    const facturas = await listarFacturasDePeriodo(ctx.supabase, ctx.clienteId, periodoId);
    let encoladas = 0;
    let omitidas = 0;
    for (const factura of facturas) {
      const { data: suscriptor } = await ctx.supabase
        .from('usuarios_servicio')
        .select('email')
        .eq('id', factura.usuario_servicio_id)
        .single();
      const email = (suscriptor?.email ?? '').trim();
      if (!email) {
        omitidas += 1;
        continue;
      }
      const { data: notificacion, error: errNotif } = await ctx.supabase
        .from('notificaciones')
        .insert({
          cliente_id: ctx.clienteId,
          usuario_servicio_id: factura.usuario_servicio_id,
          factura_id: factura.id,
          tipo: 'factura_generada',
          canal: 'email',
          destinatario: email,
          asunto: `Factura ${factura.numero}`,
          estado: 'pendiente',
          intentos: 0,
        })
        .select('id')
        .single();
      if (errNotif || !notificacion) {
        omitidas += 1; // no rompe el lote (regla 20)
        continue;
      }
      await cola.send({
        tipo: 'enviar_correo_factura',
        clienteId: ctx.clienteId,
        facturaId: factura.id,
        notificacionId: notificacion.id,
      });
      encoladas += 1;
    }
    return c.json({
      encoladas,
      omitidas,
      mensaje: 'Envíos encolados (uno por factura con email); sin email se entregan impresas',
    }, 202);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo encolar el lote' }, 400);
  }
});

// GET /facturas/:id/pdf — sirve el PDF de la factura (application/pdf). Si no
// está en R2 lo genera con pdf-lib y lo sube (pdf_url queda en la factura).
app.get('/facturas/:id/pdf', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const facturaId = c.req.param('id');
  try {
    const { factura, detalles } = await obtenerFactura(ctx.supabase, ctx.clienteId, facturaId);
    const bucket = c.env.FACTURAS_R2;
    const key = `facturas/${ctx.clienteId}/${facturaId}.pdf`;

    let pdfBytes: Uint8Array | null = null;
    if (bucket) {
      const objeto = await bucket.get(key);
      if (objeto) {
        pdfBytes = new Uint8Array(await objeto.arrayBuffer());
      }
    }
    if (!pdfBytes) {
      const { data: acueductoRow } = await ctx.supabase
        .from('clientes')
        .select('nombre, nit, direccion, telefono, municipio, logo_url, color_acento')
        .eq('id', ctx.clienteId)
        .single();
      const acueducto: DatosAcueductoPdf = {
        nombre: acueductoRow?.nombre ?? '',
        nit: acueductoRow?.nit ?? null,
        direccion: acueductoRow?.direccion ?? null,
        telefono: acueductoRow?.telefono ?? null,
        municipio: acueductoRow?.municipio ?? null,
        logoUrl: acueductoRow?.logo_url ?? null,
        colorAcento: acueductoRow?.color_acento ?? '#14408C',
      };
      pdfBytes = await generarPdfFactura({ factura, detalles, acueducto });
      if (bucket) {
        await bucket.put(key, pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });
        await ctx.supabase.from('facturas').update({ pdf_url: `/facturas/${facturaId}/pdf` }).eq('id', facturaId);
      }
    }
    return new Response(pdfBytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${factura.numero}.pdf"`,
      },
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo generar el PDF' }, 400);
  }
});

// POST /suscriptores/:id/regenerar-codigo — el admin asigna un código de portal
// nuevo (008, CA-8). El lector recibe 403 por RLS (no solo la interfaz); un
// código ya existente en el cliente → 409.
app.post('/suscriptores/:id/regenerar-codigo', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req.json<{ codigo_nuevo?: string }>().catch(() => ({ codigo_nuevo: undefined }));
  const codigoNuevo = body.codigo_nuevo?.trim() ?? '';
  if (!codigoNuevo) {
    return c.json({ error: 'codigo_nuevo es requerido' }, 400);
  }
  // CA-8: solo el admin_acueducto regenera códigos (el lector NO, por RLS y
  // también con una comprobación explícita de membresía → 403 claro).
  const { data: membresia } = await ctx.supabase
    .from('membresias')
    .select('rol')
    .eq('perfil_id', ctx.perfilId)
    .eq('cliente_id', ctx.clienteId)
    .eq('activo', true)
    .maybeSingle();
  if (!membresia || membresia.rol !== 'admin_acueducto') {
    return c.json({ error: 'No autorizado: solo el administrador del acueducto puede regenerar códigos' }, 403);
  }
  try {
    const suscriptor = await regenerarCodigoSuscriptor(
      ctx.supabase,
      ctx.clienteId,
      c.req.param('id'),
      codigoNuevo,
    );
    return c.json({ suscriptor });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'No se pudo regenerar el código';
    // 23505 llega como mensaje 'Ese código ya existe...' → 409. La violación de
    // RLS (lector) llega como error de la base → 403 (CA-8: no solo la interfaz).
    if (mensaje.includes('ya existe')) return c.json({ error: mensaje }, 409);
    if (mensaje.toLowerCase().includes('row-level security') || mensaje.toLowerCase().includes('permission denied')) {
      return c.json({ error: 'No autorizado: solo el administrador del acueducto puede regenerar códigos' }, 403);
    }
    return c.json({ error: mensaje }, 400);
  }
});

// --- Pagos y cartera (007-pagos-y-cartera) ------------------------------------

// Métodos de pago permitidos (enum metodo_pago de la base; validación aquí para
// responder 400 antes de llegar a la RPC).
const METODOS_PAGO = ['efectivo', 'transferencia', 'consignacion', 'pse', 'otro'];

// POST /pagos — registra un pago y lo aplica a las facturas del suscriptor
// (201). El admin elige el valor, método, referencia opcional y las facturas a
// abonar (si no las elige, se aplica a las pendientes más antiguas primero —
// core.distribuirPago). La RPC valida y aplica atómicamente.
app.post('/pagos', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req
    .json<{
      usuario_servicio_id?: string;
      valor?: number;
      metodo?: string;
      fecha_pago?: string;
      referencia?: string | null;
      observaciones?: string | null;
      factura_ids?: string[];
    }>()
    .catch(() => ({
      usuario_servicio_id: undefined,
      valor: undefined,
      metodo: undefined,
      fecha_pago: undefined,
      referencia: undefined,
      observaciones: undefined,
      factura_ids: undefined,
    }));
  const valor = body.valor === undefined ? Number.NaN : redondearPeso(Number(body.valor));
  if (!body.usuario_servicio_id || !Number.isFinite(valor) || valor <= 0) {
    return c.json({ error: 'usuario_servicio_id y valor (> 0) son requeridos' }, 400);
  }
  if (!body.metodo || !METODOS_PAGO.includes(body.metodo)) {
    return c.json({ error: `metodo debe ser uno de: ${METODOS_PAGO.join(', ')}` }, 400);
  }
  try {
    const resultado = await registrarPago(ctx.supabase, ctx.clienteId, ctx.perfilId, {
      usuario_servicio_id: body.usuario_servicio_id,
      valor,
      metodo: body.metodo as 'efectivo' | 'transferencia' | 'consignacion' | 'pse' | 'otro',
      fecha_pago: body.fecha_pago,
      referencia: body.referencia,
      observaciones: body.observaciones,
      factura_ids: body.factura_ids,
    });
    await notificarConfirmacionPago(ctx.supabase, c.env.FACTURACION_COLA, ctx.clienteId, body.usuario_servicio_id, resultado);
    return c.json(resultado, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo registrar el pago' }, 400);
  }
});

// POST /pagos/:id/anular — anula un pago vigente (motivo obligatorio; revierte
// las facturas abonadas recalculando desde los pagos vigentes).
app.post('/pagos/:id/anular', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede anular pagos' }, 403);
  }
  const body = await c.req.json<{ motivo?: string }>().catch(() => ({ motivo: undefined }));
  if (!body.motivo || !body.motivo.trim()) {
    return c.json({ error: 'El motivo de anulación es obligatorio' }, 400);
  }
  try {
    const resultado = await anularPago(
      ctx.supabase,
      ctx.clienteId,
      c.req.param('id'),
      body.motivo,
      ctx.perfilId,
    );
    return c.json(resultado);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo anular el pago' }, 400);
  }
});

// GET /cartera — cartera por suscriptor con deuda (por vencer / vencida con días
// de mora / total / saldo a favor). Filtros opcionales: suscriptor_id, solo_morosos.
app.get('/cartera', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const cartera = await obtenerCartera(ctx.supabase, ctx.clienteId, {
      suscriptorId: c.req.query('suscriptor_id') || null,
      soloMorosos: c.req.query('solo_morosos') === 'true',
    });
    return c.json({ cartera });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo obtener la cartera' }, 400);
  }
});

// GET /facturas/:id/pagos — historial de pagos aplicados a una factura + saldo.
app.get('/facturas/:id/pagos', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const facturaId = c.req.param('id');
    const [pagos, { factura }] = await Promise.all([
      obtenerPagosDeFactura(ctx.supabase, ctx.clienteId, facturaId),
      obtenerFactura(ctx.supabase, ctx.clienteId, facturaId),
    ]);
    return c.json({
      pagos,
      factura: {
        id: factura.id,
        numero: factura.numero,
        total: factura.total,
        total_pagado: factura.total_pagado,
        saldo: factura.total - factura.total_pagado,
        estado: factura.estado,
      },
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo leer el historial' }, 400);
  }
});

// GET /suscriptores/:id/pagos — historial de pagos de un suscriptor (vigentes y
// anulados) con sus aplicaciones y el valor sin aplicar (saldo a favor).
app.get('/suscriptores/:id/pagos', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const pagos = await obtenerPagosDeSuscriptor(ctx.supabase, ctx.clienteId, c.req.param('id'));
    const saldoFavor = pagos
      .filter((p) => !p.anulado)
      .reduce((acc, p) => acc + p.sinAplicar, 0);
    return c.json({ pagos, saldoFavor });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo leer el historial' }, 400);
  }
});

// --- Cortes y reconexiones (009-cortes-y-reconexiones) ----------------------
// Alcance reducido (opción a, aprobado por Mateo): acciones de admin_acueducto
// desde el panel, con confirmación humana siempre explícita — nunca corte
// desatendido. Sin "orden" asignada al lector (queda como feature futura).

// GET /cortes/candidatos — suscriptores activos con deuda vencida por encima
// del umbral configurado (sugerencia, no ejecución automática).
app.get('/cortes/candidatos', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const candidatos = await listarCandidatosCorte(ctx.supabase, ctx.clienteId);
    return c.json({ candidatos });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudieron listar los candidatos a corte' }, 400);
  }
});

// POST /suscriptores/:id/corte — corta el servicio con motivo obligatorio.
app.post('/suscriptores/:id/corte', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede ejecutar cortes' }, 403);
  }
  const body = await c.req.json<{ motivo?: string }>().catch(() => ({ motivo: undefined }));
  const motivo = body.motivo?.trim();
  if (!motivo) {
    return c.json({ error: 'El motivo del corte es obligatorio' }, 400);
  }
  try {
    const eventoId = await cortarSuscriptor(ctx.supabase, c.req.param('id'), motivo, ctx.perfilId);
    await notificarCorteEjecutado(ctx.supabase, c.env.FACTURACION_COLA, ctx.clienteId, c.req.param('id'), motivo);
    return c.json({ eventoId }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo cortar el suscriptor' }, 400);
  }
});

// POST /suscriptores/:id/reconexion — bloqueada con deuda vencida salvo
// motivo_excepcion explícito; genera automáticamente la factura de reconexión.
app.post('/suscriptores/:id/reconexion', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  if (ctx.rol !== 'admin_acueducto') {
    return c.json({ error: 'Solo el administrador del acueducto puede ejecutar reconexiones' }, 403);
  }
  const body = await c.req
    .json<{ motivo_excepcion?: string }>()
    .catch(() => ({ motivo_excepcion: undefined }));
  const motivoExcepcion = body.motivo_excepcion?.trim() || null;
  try {
    const resultado = await reconectarSuscriptor(
      ctx.supabase, ctx.clienteId, c.req.param('id'), motivoExcepcion, ctx.perfilId,
    );
    await notificarReconexionCompletada(ctx.supabase, c.env.FACTURACION_COLA, ctx.clienteId, c.req.param('id'), resultado.eventoId);
    return c.json({ eventoId: resultado.eventoId, deudaVencida: resultado.deudaVencida }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo reconectar el suscriptor' }, 400);
  }
});

// GET /suscriptores/:id/historial-cortes — historial de cortes/reconexiones.
app.get('/suscriptores/:id/historial-cortes', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    const historial = await historialCortes(ctx.supabase, c.req.param('id'));
    return c.json({ historial });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo consultar el historial' }, 400);
  }
});

// --- Notificaciones generales (010-notificaciones) --------------------------
// Los 3 helpers de abajo son efectos secundarios best-effort de rutas de 007/
// 009 que YA existen: encolarNotificacion() nunca lanza, pero cada helper
// igual queda envuelto en su propio try/catch — un error de red o de tipo en
// las consultas de contenido (nombre del acueducto, número de factura, etc.)
// TAMPOCO debe poder aparecer en la respuesta de un pago/corte/reconexión ya
// confirmado (plan.md §5, decisión técnica: el contrato de esas rutas no
// cambia).

async function notificarConfirmacionPago(
  supabase: SupabaseClient,
  cola: Env['FACTURACION_COLA'],
  clienteId: string,
  usuarioServicioId: string,
  resultado: { pago: Record<string, unknown>; aplicaciones: Array<{ factura_id: string; valor: number }> },
): Promise<void> {
  try {
    const { data: suscriptor } = await supabase
      .from('usuarios_servicio')
      .select('email')
      .eq('id', usuarioServicioId)
      .single();
    const email = (suscriptor?.email ?? '').trim() || null;
    if (!email) return;

    const { data: acueducto } = await supabase.from('clientes').select('nombre').eq('id', clienteId).single();

    const idsFacturas = resultado.aplicaciones.map((a) => a.factura_id);
    let facturasAplicadas: string[] = [];
    if (idsFacturas.length) {
      const { data: facturasNumeros } = await supabase.from('facturas').select('numero').in('id', idsFacturas);
      facturasAplicadas = (facturasNumeros ?? []).map((f) => String(f.numero));
    }

    const contenido = contenidoConfirmacionPago({
      nombreAcueducto: acueducto?.nombre ?? '',
      valor: Number(resultado.pago.valor ?? 0),
      fechaPago: String(resultado.pago.fecha_pago ?? ''),
      facturasAplicadas,
    });
    await encolarNotificacion(supabase, cola, {
      clienteId, usuarioServicioId, tipo: 'confirmacion_pago', destinatarioEmail: email, contenido,
    });
  } catch (e) {
    console.error('notificarConfirmacionPago: no se pudo encolar (no bloquea el pago)', e instanceof Error ? e.message : e);
  }
}

async function notificarCorteEjecutado(
  supabase: SupabaseClient,
  cola: Env['FACTURACION_COLA'],
  clienteId: string,
  usuarioServicioId: string,
  motivo: string,
): Promise<void> {
  try {
    const { data: suscriptor } = await supabase
      .from('usuarios_servicio')
      .select('email')
      .eq('id', usuarioServicioId)
      .single();
    const email = (suscriptor?.email ?? '').trim() || null;
    if (!email) return;

    const { data: acueducto } = await supabase.from('clientes').select('nombre').eq('id', clienteId).single();

    const contenido = contenidoCorteEjecutado({
      nombreAcueducto: acueducto?.nombre ?? '',
      motivo,
      fecha: new Date().toISOString().slice(0, 10),
    });
    await encolarNotificacion(supabase, cola, {
      clienteId, usuarioServicioId, tipo: 'corte_ejecutado', destinatarioEmail: email, contenido,
    });
  } catch (e) {
    console.error('notificarCorteEjecutado: no se pudo encolar (no bloquea el corte)', e instanceof Error ? e.message : e);
  }
}

async function notificarReconexionCompletada(
  supabase: SupabaseClient,
  cola: Env['FACTURACION_COLA'],
  clienteId: string,
  usuarioServicioId: string,
  eventoId: string,
): Promise<void> {
  try {
    const { data: suscriptor } = await supabase
      .from('usuarios_servicio')
      .select('email')
      .eq('id', usuarioServicioId)
      .single();
    const email = (suscriptor?.email ?? '').trim() || null;
    if (!email) return;

    const { data: acueducto } = await supabase.from('clientes').select('nombre').eq('id', clienteId).single();

    const { data: evento } = await supabase
      .from('cortes_reconexiones')
      .select('factura_reconexion_id')
      .eq('id', eventoId)
      .maybeSingle();
    let facturaReconexionNumero: string | null = null;
    if (evento?.factura_reconexion_id) {
      const { data: factura } = await supabase
        .from('facturas')
        .select('numero')
        .eq('id', evento.factura_reconexion_id)
        .maybeSingle();
      facturaReconexionNumero = factura?.numero ? String(factura.numero) : null;
    }

    const contenido = contenidoReconexionCompletada({
      nombreAcueducto: acueducto?.nombre ?? '',
      fecha: new Date().toISOString().slice(0, 10),
      facturaReconexionNumero,
    });
    await encolarNotificacion(supabase, cola, {
      clienteId, usuarioServicioId, tipo: 'reconexion_completada', destinatarioEmail: email, contenido,
    });
  } catch (e) {
    console.error('notificarReconexionCompletada: no se pudo encolar (no bloquea la reconexión)', e instanceof Error ? e.message : e);
  }
}

// GET /notificaciones — historial del cliente activo, filtrable por tipo/estado.
app.get('/notificaciones', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  try {
    let query = ctx.supabase
      .from('notificaciones')
      .select('id, tipo, canal, destinatario, asunto, estado, intentos, ultimo_error, enviada_en, created_at')
      .eq('cliente_id', ctx.clienteId)
      .order('created_at', { ascending: false });
    const tipo = c.req.query('tipo');
    const estado = c.req.query('estado');
    if (tipo) query = query.eq('tipo', tipo);
    if (estado) query = query.eq('estado', estado);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return c.json({ notificaciones: data ?? [] });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudieron listar las notificaciones' }, 400);
  }
});

// --- Importación masiva de suscriptores (012-importacion-suscriptores-excel) --
// Límite explícito de filas por archivo (plan.md §7, CLAUDE.md §5.5): un
// acueducto piloto tiene unos pocos cientos de suscriptores; un archivo más
// grande se rechaza antes de procesar nada, nunca un intento silencioso.
const LIMITE_FILAS_IMPORTACION = 2000;

// POST /suscriptores/importar/validar — corre CA-1/CA-2 (core/, puro) + CA-3
// (duplicados contra la base, lib/), no escribe nada.
app.post('/suscriptores/importar/validar', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req
    .json<{ filas?: FilaCruda[]; mapeo?: MapeoColumnas }>()
    .catch(() => ({ filas: undefined, mapeo: undefined }));
  const filas = body.filas ?? [];
  const mapeo = body.mapeo ?? {};
  if (!Array.isArray(filas) || filas.length === 0) {
    return c.json({ error: 'El archivo no tiene filas' }, 400);
  }
  if (filas.length > LIMITE_FILAS_IMPORTACION) {
    return c.json({ error: `El archivo supera el límite de ${LIMITE_FILAS_IMPORTACION} filas por importación` }, 400);
  }
  try {
    const resultadoCore = validarFilas(filas, mapeo);
    const resultado = await detectarDuplicadosContraBase(ctx.supabase, ctx.clienteId, resultadoCore);
    return c.json(resultado);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo validar el archivo' }, 400);
  }
});

// POST /suscriptores/importar/confirmar — recibe las filas ya validadas (de
// /validar, sin volver a tocarlas) y las errores a registrar en el
// historial; inserta transaccionalmente (CA-6) vía la RPC importar_suscriptores().
app.post('/suscriptores/importar/confirmar', async (c) => {
  const { ctx, respuesta } = await requerirClienteActivo(c);
  if (!ctx) return respuesta;
  const body = await c.req
    .json<{
      filasValidas?: Array<{ indiceFila: number; fila: FilaNormalizada }>;
      errores?: ErrorFila[];
      nombreArchivo?: string;
    }>()
    .catch(() => ({ filasValidas: undefined, errores: undefined, nombreArchivo: undefined }));
  const filasValidas = body.filasValidas ?? [];
  const errores = body.errores ?? [];
  const nombreArchivo = body.nombreArchivo?.trim();
  if (!nombreArchivo) {
    return c.json({ error: 'Falta el nombre del archivo importado' }, 400);
  }
  if (filasValidas.length === 0) {
    return c.json({ error: 'No hay filas válidas para importar' }, 400);
  }
  try {
    const reporte = await confirmarImportacion(
      ctx.supabase, ctx.clienteId, filasValidas, errores, nombreArchivo, ctx.perfilId,
    );
    return c.json(reporte, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo confirmar la importación' }, 400);
  }
});

// --- Portal del suscriptor (008, D-2/D-4/D-10) -------------------------------

// POST /portal/:slug/login — público. Resuelve el cliente por el slug de la URL
// y valida numero_documento + codigo_suscriptor contra las funciones SECURITY
// DEFINER del portal (D-10, sin contraseña). ok → 200 + cookie uc_sesion_suscriptor.
app.post('/portal/:slug/login', async (c) => {
  const slug = c.req.param('slug').trim().toLowerCase();
  const body = await c.req
    .json<{ numero_documento?: string; codigo_suscriptor?: string }>()
    .catch(() => ({ numero_documento: undefined, codigo_suscriptor: undefined }));
  const numeroDocumento = body.numero_documento?.trim() ?? '';
  const codigoSuscriptor = body.codigo_suscriptor?.trim() ?? '';
  if (!numeroDocumento || !codigoSuscriptor) {
    return c.json({ error: 'numero_documento y codigo_suscriptor son requeridos' }, 400);
  }
  try {
    const clienteId = await resolverClientePorSlug(c.env, slug);
    if (!clienteId) return c.json({ error: 'Acueducto no encontrado' }, 404);

    const credenciales = await validarCredencialesPortal(c.env, clienteId, numeroDocumento, codigoSuscriptor);
    if (credenciales.estado === 'ok' && credenciales.usuarioServicioId) {
      const sesion = await iniciarSesionSuscriptor(c, {
        usuarioServicioId: credenciales.usuarioServicioId,
        clienteId,
        numeroDocumento,
        codigoSuscriptor,
      });
      return c.json({ sesion });
    }
    if (credenciales.estado === 'inactivo') {
      return c.json({ error: 'El suscriptor está inactivo. Contacte a su acueducto.' }, 403);
    }
    if (credenciales.estado === 'bloqueado') {
      return c.json({ error: 'Demasiados intentos. Intente más tarde.', reintentar_en: credenciales.reintentarEn }, 429);
    }
    // 'invalido': mensaje genérico, nunca revela cuál campo falló (CA-1/CA-9)
    return c.json({ error: 'Credenciales incorrectas' }, 401);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo iniciar sesión' }, 500);
  }
});

// POST /portal/logout — borra la cookie del portal (idempotente).
app.post('/portal/logout', async (c) => {
  cerrarSesionSuscriptor(c);
  return c.json({ ok: true });
});

// GET /portal/facturas — factura actual + historial del suscriptor autenticado.
app.get('/portal/facturas', async (c) => {
  const { ctx, respuesta } = await requerirSesionSuscriptor(c);
  if (!ctx) return respuesta;
  try {
    const { facturaActual, historial } = await obtenerFacturasPortal(c.env, ctx.sesion);
    return c.json({ facturaActual, historial });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudieron leer las facturas' }, 500);
  }
});

// GET /portal/facturas/:id/pdf — sirve el PDF SOLO de una factura del suscriptor
// autenticado. Si portal_factura_completa devuelve null (factura inexistente o
// de OTRO suscriptor/cliente → IDOR) responde 404 sin servir bytes (CA-5).
app.get('/portal/facturas/:id/pdf', async (c) => {
  const { ctx, respuesta } = await requerirSesionSuscriptor(c);
  if (!ctx) return respuesta;
  const facturaId = c.req.param('id');
  try {
    const completa = await obtenerFacturaCompletaPortal(c.env, ctx.sesion, facturaId);
    if (!completa) {
      return c.json({ error: 'Factura no encontrada' }, 404);
    }
    const { factura, detalles, acueducto } = completa;
    const pdfBytes = await generarPdfFactura({ factura, detalles, acueducto });
    return new Response(pdfBytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${factura.numero}.pdf"`,
      },
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo generar el PDF' }, 500);
  }
});

// GET /portal/saldo-favor — remanente de pagos vigentes sin aplicar (CA-6).
app.get('/portal/saldo-favor', async (c) => {
  const { ctx, respuesta } = await requerirSesionSuscriptor(c);
  if (!ctx) return respuesta;
  try {
    const saldoFavor = await obtenerSaldoFavorPortal(c.env, ctx.sesion);
    return c.json({ saldoFavor });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo leer el saldo a favor' }, 500);
  }
});

// GET /portal/consumo — historial de consumo de TODOS los contadores (CA-7).
app.get('/portal/consumo', async (c) => {
  const { ctx, respuesta } = await requerirSesionSuscriptor(c);
  if (!ctx) return respuesta;
  try {
    const lecturas = await obtenerConsumoPortal(c.env, ctx.sesion);
    return c.json({ lecturas });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'No se pudo leer el consumo' }, 500);
  }
});

export default {
  fetch: app.fetch,
  queue: cierreFacturacion.queue,
};
