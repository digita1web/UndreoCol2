// Wrapper fetch hacia la API de Hono (backend/). Nunca importa `@supabase/*`
// (CA-4) — todo pasa por aquí, con `credentials: 'include'` para la cookie
// HttpOnly `uc_sesion_admin` que pone el backend (D-3 del plan).
//
// URL_BASE_API (020, proxy-cookies-mismo-origen): en producción NO se define
// NEXT_PUBLIC_API_URL — el valor por defecto es la ruta relativa `/api`, que
// intercepta `app/api/[...ruta]/route.ts` y reenvía por Service Binding al
// Worker de la API. Es a propósito: si esto siguiera apuntando a la URL
// absoluta `https://undreocol-api.undreocol.workers.dev`, el navegador vería
// la cookie de sesión bajo ESE dominio, no bajo el del frontend —
// workers.dev está en la Public Suffix List, son sitios distintos para
// cookies, y el login nunca llevaría a ningún lado (bug real, corregido en
// esta feature). En desarrollo local sí hay que definir `NEXT_PUBLIC_API_URL`
// en `.env.local` apuntando a `wrangler dev` (ver `.env.example`) — ahí el
// bug no existe (mismo host `localhost`, las cookies no distinguen puerto).
const URL_BASE_API = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface SesionAdministrativa {
  tipo: 'administrativa';
  perfilId: string;
  email: string;
}

interface Perfil {
  id: string;
  nombre: string;
  email: string;
}

interface Membresia {
  id: string;
  cliente_id: string;
  rol: string;
}

export interface RespuestaLogin {
  sesion: SesionAdministrativa;
  perfil: Perfil | null;
  membresias: Membresia[];
}

interface ErrorApi {
  error: string;
  /** Presente en las respuestas 429 (límite de intentos de login). */
  reintentar_en?: string;
}

/**
 * Error de la API que conserva el código de estado y, si viene, el
 * `reintentar_en` de un 429. Extiende `Error`, así que los `catch` que solo
 * miran `e.message` siguen funcionando igual.
 *
 * Existe porque el límite de intentos del login (017) responde 429 con el
 * momento en que se puede reintentar, y ese dato se perdía al convertir la
 * respuesta en un `Error` pelado. El portal usa el mismo contrato.
 */
export class ErrorPeticion extends Error {
  readonly status: number;
  readonly reintentarEn?: string;

  constructor(mensaje: string, status: number, reintentarEn?: string) {
    super(mensaje);
    this.name = 'ErrorPeticion';
    this.status = status;
    this.reintentarEn = reintentarEn;
  }
}

async function peticion<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const respuesta = await fetch(`${URL_BASE_API}${ruta}`, {
    ...opciones,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...opciones.headers,
    },
  });
  const cuerpo: unknown = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    const datos = cuerpo as ErrorApi | null;
    const mensaje = datos?.error ?? `Error ${respuesta.status}`;
    throw new ErrorPeticion(mensaje, respuesta.status, datos?.reintentar_en);
  }
  return cuerpo as T;
}

/**
 * Minutos que faltan hasta `reintentarEn`, redondeados hacia arriba y con un
 * mínimo de 1: decirle a alguien que espere "0 minutos" no ayuda. Devuelve
 * `null` si la fecha no es utilizable, para que quien llame use su mensaje
 * genérico en vez de mostrar un `NaN`.
 */
export function minutosParaReintentar(reintentarEn: string | undefined): number | null {
  if (!reintentarEn) return null;
  const objetivo = new Date(reintentarEn).getTime();
  if (Number.isNaN(objetivo)) return null;
  const restanteMs = objetivo - Date.now();
  if (restanteMs <= 0) return null;
  return Math.max(1, Math.ceil(restanteMs / 60000));
}

export function login(email: string, password: string): Promise<RespuestaLogin> {
  return peticion<RespuestaLogin>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return peticion<{ ok: true }>('/auth/logout', { method: 'POST' });
}

// --- Catálogo de servicios y tarifas (002-catalogo-y-tarifas) --------------

export type TipoCalculo = 'por_consumo' | 'fijo';

export interface Servicio {
  id: string;
  cliente_id: string;
  codigo: string;
  nombre: string;
  tipo_calculo: TipoCalculo;
  facturable_en_ciclo: boolean;
  orden: number;
  activo: boolean;
}

export function listarServicios(): Promise<{ servicios: Servicio[] }> {
  return peticion<{ servicios: Servicio[] }>('/catalogo/servicios');
}

export interface DatosCrearServicio {
  codigo: string;
  nombre: string;
  tipo_calculo: TipoCalculo;
  facturable_en_ciclo?: boolean;
  orden?: number;
}

export function crearServicio(datos: DatosCrearServicio): Promise<{ servicio: Servicio }> {
  return peticion<{ servicio: Servicio }>('/catalogo/servicios', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

// codigo y tipo_calculo NUNCA se aceptan aquí (no editables tras la creación).
export interface DatosActualizarServicio {
  nombre?: string;
  facturable_en_ciclo?: boolean;
  orden?: number;
  activo?: boolean;
}

export function actualizarServicio(
  id: string,
  datos: DatosActualizarServicio,
): Promise<{ servicio: Servicio }> {
  return peticion<{ servicio: Servicio }>(`/catalogo/servicios/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });
}

export interface Tarifa {
  id: string;
  cliente_id: string;
  servicio_id: string;
  categoria: string;
  vigencia_desde: string;
  vigencia_hasta: string | null;
  cargo_fijo: number;
  limite_basico_m3: number;
  precio_basico_m3: number;
  precio_no_basico_m3: number;
}

export function listarTarifas(servicioId: string, categoria: string): Promise<{ tarifas: Tarifa[] }> {
  const params = new URLSearchParams({ servicio_id: servicioId, categoria });
  return peticion<{ tarifas: Tarifa[] }>(`/catalogo/tarifas?${params.toString()}`);
}

export interface DatosCrearTarifa {
  servicio_id: string;
  categoria: string;
  cargo_fijo: number;
  limite_basico_m3: number;
  precio_basico_m3: number;
  precio_no_basico_m3: number;
}

export function crearTarifa(datos: DatosCrearTarifa): Promise<{ tarifaId: string }> {
  return peticion<{ tarifaId: string }>('/catalogo/tarifas', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export interface AutorizacionTarifa {
  id: string;
  cliente_id: string;
  servicio_id: string;
  categoria: string;
  autorizado_por: string;
  motivo: string;
  expira_en: string;
  usada_en: string | null;
  usada_por: string | null;
  revocada_en: string | null;
  revocada_por: string | null;
  created_at: string;
}

export function listarAutorizacionesTarifa(): Promise<{ autorizaciones: AutorizacionTarifa[] }> {
  return peticion<{ autorizaciones: AutorizacionTarifa[] }>('/catalogo/autorizaciones-tarifa');
}

export function crearAutorizacionTarifa(datos: {
  servicio_id: string;
  categoria: string;
  motivo: string;
  expira_en: string;
}): Promise<{ id: string }> {
  return peticion<{ id: string }>('/catalogo/autorizaciones-tarifa', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export function revocarAutorizacionTarifa(id: string): Promise<{ ok: true }> {
  return peticion<{ ok: true }>(`/catalogo/autorizaciones-tarifa/${id}/revocar`, { method: 'POST' });
}

export function usarAutorizacionTarifa(datos: {
  autorizacion_id: string;
  cargo_fijo: number;
  limite_basico_m3: number;
  precio_basico_m3: number;
  precio_no_basico_m3: number;
}): Promise<{ tarifaId: string }> {
  return peticion<{ tarifaId: string }>('/catalogo/tarifas/autorizada', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export interface FilaMatrizTarifas {
  servicio_id: string;
  servicio_codigo: string;
  servicio_nombre: string;
  categoria: string;
  tarifa_id: string | null;
  cargo_fijo: number | null;
  limite_basico_m3: number | null;
  precio_basico_m3: number | null;
  precio_no_basico_m3: number | null;
}

export function matrizTarifas(): Promise<{ matriz: FilaMatrizTarifas[] }> {
  return peticion<{ matriz: FilaMatrizTarifas[] }>('/catalogo/matriz-tarifas');
}

// --- Suscriptores y contadores (003-suscriptores-contadores) ---------------

type EstadoSuscriptor = 'activo' | 'suspendido' | 'cortado' | 'inactivo';

export interface Suscriptor {
  id: string;
  cliente_id: string;
  codigo_suscriptor: string;
  nombre: string;
  estado: EstadoSuscriptor;
  tipo_documento: string | null;
  numero_documento: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  sector: string | null;
  categoria: string | null;
  contador_actual_id: string | null;
  fecha_vinculacion: string;
  notas: string | null;
}

export function listarSuscriptores(estado?: string): Promise<{ suscriptores: Suscriptor[] }> {
  const query = estado ? `?estado=${encodeURIComponent(estado)}` : '';
  return peticion<{ suscriptores: Suscriptor[] }>(`/suscriptores${query}`);
}

export interface DatosCrearSuscriptor {
  codigo_suscriptor: string;
  nombre: string;
  numero_documento: string;
  direccion: string;
  categoria: string;
  tipo_documento?: string;
  telefono?: string;
  email?: string;
  sector?: string;
  notas?: string;
}

export function crearSuscriptor(datos: DatosCrearSuscriptor): Promise<{ suscriptor: Suscriptor }> {
  return peticion<{ suscriptor: Suscriptor }>('/suscriptores', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export interface Contador {
  id: string;
  cliente_id: string;
  usuario_servicio_id: string;
  serial: string;
  marca: string | null;
  capacidad_maxima: number;
  lectura_inicial: number;
  fecha_instalacion: string;
  estado: 'activo' | 'danado' | 'reemplazado';
  observaciones: string | null;
}

export interface ReemplazoContador {
  id: string;
  cliente_id: string;
  usuario_servicio_id: string;
  contador_anterior_id: string;
  contador_nuevo_id: string;
  fecha_reemplazo: string;
  lectura_final_anterior: number;
  lectura_inicial_nuevo: number;
  motivo: string | null;
}

export interface RespuestaDetalleSuscriptor {
  suscriptor: Suscriptor;
  contador: Contador | null;
  reemplazos: ReemplazoContador[];
}

export function obtenerSuscriptor(id: string): Promise<RespuestaDetalleSuscriptor> {
  return peticion<RespuestaDetalleSuscriptor>(`/suscriptores/${id}`);
}

// codigo_suscriptor NUNCA se acepta aquí (es la credencial del futuro portal, D-2).
// estado tampoco (hallazgo de security-review, Sesión 057): tiene su propio
// camino autorizado, corte/reconexión (009) — el backend lo rechaza (400) si
// llega en el body, esto solo evita construirlo desde acá.
export interface DatosActualizarSuscriptor {
  nombre?: string;
  tipo_documento?: string;
  numero_documento?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  sector?: string;
  categoria?: string;
  notas?: string;
}

export function actualizarSuscriptor(
  id: string,
  datos: DatosActualizarSuscriptor,
): Promise<{ suscriptor: Suscriptor }> {
  return peticion<{ suscriptor: Suscriptor }>(`/suscriptores/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });
}

export interface DatosCrearContador {
  serial: string;
  marca?: string;
  capacidad_maxima: number;
  lectura_inicial?: number;
  fecha_instalacion: string;
}

export function crearContador(usuarioServicioId: string, datos: DatosCrearContador): Promise<{ contador: Contador }> {
  return peticion<{ contador: Contador }>(`/suscriptores/${usuarioServicioId}/contador`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export interface DatosReemplazarContador {
  serial_nuevo: string;
  marca_nuevo?: string;
  capacidad_maxima_nuevo: number;
  lectura_final_anterior: number;
  lectura_inicial_nuevo?: number;
  motivo?: string;
}

export function reemplazarContador(
  usuarioServicioId: string,
  datos: DatosReemplazarContador,
): Promise<{ reemplazoId: string }> {
  return peticion<{ reemplazoId: string }>(`/suscriptores/${usuarioServicioId}/reemplazar-contador`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

// --- Periodos y lecturas (004-lecturas-y-consumo) ---------------------------

export interface Periodo {
  id: string;
  cliente_id: string;
  nombre: string;
  anio: number;
  mes: number;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_vencimiento: string;
  estado: 'abierto' | 'cerrado';
  fecha_cierre: string | null;
  cerrado_por: string | null;
}

type RevisionLectura = 'normal' | 'consumo_alto' | 'consumo_bajo' | 'consumo_cero';

export interface Lectura {
  id: string;
  cliente_id: string;
  contador_id: string;
  periodo_id: string;
  fecha_lectura: string;
  lectura_anterior: number;
  lectura_actual: number;
  consumo_m3: number;
  hubo_rollover: boolean;
  revision: RevisionLectura;
  promedio_historico: number | null;
  revisada: boolean;
  revisada_por: string | null;
  id_cliente_offline: string | null;
}

export interface DatosCrearPeriodo {
  nombre: string;
  anio: number;
  mes: number;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_vencimiento: string;
}

export function listarPeriodos(): Promise<{ periodos: Periodo[] }> {
  return peticion<{ periodos: Periodo[] }>('/periodos');
}

export function crearPeriodo(datos: DatosCrearPeriodo): Promise<{ periodo: Periodo }> {
  return peticion<{ periodo: Periodo }>('/periodos', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export function cerrarPeriodo(id: string): Promise<{ periodo: Periodo }> {
  return peticion<{ periodo: Periodo }>(`/periodos/${id}/cerrar`, { method: 'PATCH' });
}

export function listarLecturas(opciones: { periodoId?: string; soloAnomalias?: boolean } = {}): Promise<{ lecturas: Lectura[] }> {
  const params = new URLSearchParams();
  if (opciones.periodoId) params.set('periodo_id', opciones.periodoId);
  if (opciones.soloAnomalias) params.set('solo_revision', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return peticion<{ lecturas: Lectura[] }>(`/lecturas${query}`);
}

export interface DatosCrearLectura {
  contador_id: string;
  periodo_id: string;
  fecha_lectura: string;
  lectura_actual: number;
  id_cliente_offline?: string;
}

export function crearLectura(datos: DatosCrearLectura): Promise<{ lectura: Lectura; nuevo: boolean }> {
  return peticion<{ lectura: Lectura; nuevo: boolean }>('/lecturas', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export function revisarLectura(id: string): Promise<{ lectura: Lectura }> {
  return peticion<{ lectura: Lectura }>(`/lecturas/${id}/revisar`, { method: 'PATCH' });
}

// --- Facturación (005-facturacion) -------------------------------------------

type TipoFactura = 'ciclo' | 'reconexion' | 'ajuste';
export type EstadoFactura = 'pendiente' | 'pagada' | 'vencida' | 'anulada';
type TipoAnomaliaFacturacion =
  | 'consumo_atipico' | 'usuario_sin_lectura' | 'sin_tarifa'
  | 'total_cero_o_negativo' | 'variacion_superior_20';

export interface Factura {
  id: string;
  cliente_id: string;
  usuario_servicio_id: string;
  periodo_id: string | null;
  tipo: TipoFactura;
  numero: string;
  snapshot_suscriptor: Record<string, unknown>;
  consumo_m3: number;
  subtotal_servicios: number;
  recargo_mora: number;
  saldo_anterior: number;
  total: number;
  total_pagado: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: EstadoFactura;
  motivo_anulacion: string | null;
  anulada_por: string | null;
}

export interface DetalleFactura {
  id: string;
  factura_id: string;
  servicio_id: string | null;
  tarifa_id: string | null;
  orden: number;
  descripcion: string;
  tipo_calculo: 'por_consumo' | 'fijo';
  consumo_m3: number;
  cargo_fijo: number;
  consumo_basico_m3: number;
  valor_basico: number;
  consumo_no_basico_m3: number;
  valor_no_basico: number;
  subtotal: number;
}

interface AnomaliaFacturacion {
  tipo: TipoAnomaliaFacturacion;
  usuarioServicioId: string;
  detalle: string;
}

interface RenglonSimulado {
  descripcion: string;
  consumoM3: number;
  subtotal: number;
}

interface SuscriptorSimulado {
  usuarioServicioId: string;
  codigoSuscriptor: string;
  nombre: string;
  categoria: string | null;
  consumoM3: number | null;
  tieneTarifa: boolean;
  renglones: RenglonSimulado[];
  subtotalServicios: number;
  total: number;
  anomalias: AnomaliaFacturacion[];
}

export interface ResumenSimulacion {
  periodoId: string;
  totalSuscriptores: number;
  suscriptoresConFactura: number;
  consumoTotalM3: number;
  facturacionTotal: number;
  anomalias: AnomaliaFacturacion[];
  detalle: SuscriptorSimulado[];
}

export function simularPeriodo(periodoId: string): Promise<{ resumen: ResumenSimulacion }> {
  return peticion<{ resumen: ResumenSimulacion }>(`/facturacion/periodos/${periodoId}/simular`, { method: 'POST' });
}

export function emitirPeriodo(periodoId: string): Promise<{ encoladas: number; omitidas: number; mensaje: string }> {
  return peticion<{ encoladas: number; omitidas: number; mensaje: string }>(`/facturacion/periodos/${periodoId}/emitir`, { method: 'POST' });
}

export function listarFacturasDePeriodo(periodoId: string): Promise<{ facturas: Factura[] }> {
  return peticion<{ facturas: Factura[] }>(`/facturacion/periodos/${periodoId}/facturas`);
}

export function obtenerFactura(facturaId: string): Promise<{ factura: Factura; detalles: DetalleFactura[] }> {
  return peticion<{ factura: Factura; detalles: DetalleFactura[] }>(`/facturas/${facturaId}`);
}

export function anularFactura(facturaId: string, motivo: string): Promise<{ factura: Factura }> {
  return peticion<{ factura: Factura }>(`/facturas/${facturaId}/anular`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
}

// --- 006: impresión y correo de facturas ------------------------------------

export function urlPdfFactura(facturaId: string): string {
  return `${URL_BASE_API}/facturas/${facturaId}/pdf`;
}

export function enviarCorreoFactura(facturaId: string): Promise<{ encolado: boolean; notificacionId: string }> {
  return peticion<{ encolado: boolean; notificacionId: string }>(`/facturas/${facturaId}/enviar-correo`, { method: 'POST' });
}

export function enviarCorreoPeriodo(
  periodoId: string,
): Promise<{ encoladas: number; omitidas: number; mensaje: string }> {
  return peticion<{ encoladas: number; omitidas: number; mensaje: string }>(
    `/facturacion/periodos/${periodoId}/enviar-correo`,
    { method: 'POST' },
  );
}

// --- Pagos y cartera (007-pagos-y-cartera) ----------------------------------

export type MetodoPago = 'efectivo' | 'transferencia' | 'consignacion' | 'pse' | 'otro';

interface AplicacionPago {
  factura_id: string;
  valor: number;
}

interface Pago {
  id: string;
  valor: number;
  metodo: MetodoPago;
  fecha_pago: string;
  referencia: string | null;
  recibido_por: string | null;
  observaciones: string | null;
  usuario_servicio_id: string;
}

interface FacturaTrasPago {
  factura_id: string;
  total: number;
  total_pagado: number;
  estado: EstadoFactura;
}

export interface ResultadoRegistrarPago {
  pago: Pago;
  aplicaciones: AplicacionPago[];
  remanente: number;
  facturas: FacturaTrasPago[];
}

export interface DatosRegistrarPago {
  usuario_servicio_id: string;
  valor: number;
  metodo: MetodoPago;
  fecha_pago?: string;
  referencia?: string;
  observaciones?: string;
  /** Facturas elegidas a abonar; si se omite, se aplica a las pendientes más
   *  antiguas primero (regla por defecto del recaudo, spec §3.2). */
  factura_ids?: string[];
}

export function registrarPago(datos: DatosRegistrarPago): Promise<ResultadoRegistrarPago> {
  return peticion<ResultadoRegistrarPago>('/pagos', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export interface ResultadoAnularPago {
  pago: Pago & { anulado: boolean; motivo_anulacion: string };
  facturas: FacturaTrasPago[];
}

export function anularPago(pagoId: string, motivo: string): Promise<ResultadoAnularPago> {
  return peticion<ResultadoAnularPago>(`/pagos/${pagoId}/anular`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
}

interface FacturaVencidaMasAntigua {
  numero: string;
  diasMora: number;
}

export interface FilaCartera {
  usuarioServicioId: string;
  nombre: string;
  codigoSuscriptor: string;
  estado: EstadoSuscriptor;
  porVencer: number;
  vencida: number;
  diasMoraMax: number | null;
  facturaVencidaMasAntigua: FacturaVencidaMasAntigua | null;
  totalAdeudado: number;
  saldoFavor: number;
}

export function obtenerCartera(
  filtros: { suscriptorId?: string; soloMorosos?: boolean } = {},
): Promise<{ cartera: FilaCartera[] }> {
  const params = new URLSearchParams();
  if (filtros.suscriptorId) params.set('suscriptor_id', filtros.suscriptorId);
  if (filtros.soloMorosos) params.set('solo_morosos', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return peticion<{ cartera: FilaCartera[] }>(`/cartera${query}`);
}

export interface AplicacionHistorialFactura {
  id: string;
  valor: number;
  fecha_pago: string;
  metodo: MetodoPago;
  referencia: string | null;
  recibido_por: string | null;
  anulado: boolean;
  motivo_anulacion: string | null;
}

export function obtenerPagosDeFactura(facturaId: string): Promise<{
  pagos: AplicacionHistorialFactura[];
  factura: { id: string; numero: string; total: number; total_pagado: number; saldo: number; estado: EstadoFactura };
}> {
  return peticion(`/facturas/${facturaId}/pagos`);
}

export interface PagoHistorial {
  id: string;
  valor: number;
  fecha_pago: string;
  metodo: MetodoPago;
  referencia: string | null;
  recibido_por: string | null;
  anulado: boolean;
  motivo_anulacion: string | null;
  aplicaciones: AplicacionPago[];
  sinAplicar: number;
}

export function obtenerPagosDeSuscriptor(
  suscriptorId: string,
): Promise<{ pagos: PagoHistorial[]; saldoFavor: number }> {
  return peticion(`/suscriptores/${suscriptorId}/pagos`);
}

// --- 008: Portal del suscriptor (D-2/D-4/D-10) y regenerar código (CA-8) ------

// La cookie del portal es uc_sesion_suscriptor (distinta de la administrativa
// uc_sesion_admin): las funciones del portal envían credentials por defecto y
// el backend resuelve la sesión por su propia cookie — nunca se mezclan.

export interface SesionPortal {
  tipo: 'suscriptor';
  usuarioServicioId: string;
  clienteId: string;
  numeroDocumento: string;
  codigoSuscriptor: string;
  expiraEn: number;
}

export interface FacturaResumenPortal {
  id: string;
  numero: string;
  tipo: string;
  total: number;
  totalPagado: number;
  saldo: number;
  fechaEmision: string;
  fechaVencimiento: string;
  estado: 'pendiente' | 'pagada' | 'vencida' | 'anulada';
}

export interface LecturaConsumoPortal {
  fecha_lectura: string;
  lectura_anterior: number;
  lectura_actual: number;
  consumo_m3: number;
}

export function loginPortal(
  slug: string,
  numeroDocumento: string,
  codigoSuscriptor: string,
): Promise<{ sesion: SesionPortal }> {
  return peticion(`/portal/${slug}/login`, {
    method: 'POST',
    body: JSON.stringify({ numero_documento: numeroDocumento, codigo_suscriptor: codigoSuscriptor }),
  });
}

export function logoutPortal(): Promise<{ ok: true }> {
  return peticion<{ ok: true }>('/portal/logout', { method: 'POST' });
}

export function obtenerFacturasPortal(): Promise<{
  facturaActual: FacturaResumenPortal | null;
  historial: FacturaResumenPortal[];
}> {
  return peticion('/portal/facturas');
}

export function obtenerSaldoFavorPortal(): Promise<{ saldoFavor: number }> {
  return peticion('/portal/saldo-favor');
}

export function obtenerConsumoPortal(): Promise<{ lecturas: LecturaConsumoPortal[] }> {
  return peticion('/portal/consumo');
}

export function urlPdfFacturaPortal(facturaId: string): string {
  return `${URL_BASE_API}/portal/facturas/${facturaId}/pdf`;
}

export function regenerarCodigoSuscriptor(
  suscriptorId: string,
  codigoNuevo: string,
): Promise<{ suscriptor: Suscriptor }> {
  return peticion(`/suscriptores/${suscriptorId}/regenerar-codigo`, {
    method: 'POST',
    body: JSON.stringify({ codigo_nuevo: codigoNuevo }),
  });
}

// --- Cortes y reconexiones (009-cortes-y-reconexiones) ----------------------
// Alcance reducido (opción a): acciones de admin_acueducto desde el panel,
// siempre con confirmación humana explícita — nunca corte desatendido.

export interface CandidatoCorte {
  usuarioServicioId: string;
  nombre: string;
  codigoSuscriptor: string;
  vencida: number;
  diasMoraMax: number;
}

export function listarCandidatosCorte(): Promise<{ candidatos: CandidatoCorte[] }> {
  return peticion('/cortes/candidatos');
}

export function cortarSuscriptor(suscriptorId: string, motivo: string): Promise<{ eventoId: string }> {
  return peticion(`/suscriptores/${suscriptorId}/corte`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
}

export function reconectarSuscriptor(
  suscriptorId: string,
  motivoExcepcion?: string,
): Promise<{ eventoId: string; deudaVencida: number }> {
  return peticion(`/suscriptores/${suscriptorId}/reconexion`, {
    method: 'POST',
    body: JSON.stringify({ motivo_excepcion: motivoExcepcion }),
  });
}

export interface EventoCorte {
  id: string;
  tipo: 'corte' | 'reconexion';
  fecha: string;
  motivo: string;
  responsable: string;
  deuda_vencida_al_reconectar: number | null;
  factura_reconexion_id: string | null;
}

export function historialCortes(suscriptorId: string): Promise<{ historial: EventoCorte[] }> {
  return peticion(`/suscriptores/${suscriptorId}/historial-cortes`);
}

// --- Notificaciones generales (010-notificaciones) --------------------------

export type TipoNotificacion =
  | 'factura_generada'
  | 'recordatorio_vencimiento'
  | 'aviso_mora'
  | 'confirmacion_pago'
  | 'corte_ejecutado'
  | 'reconexion_completada';

export type EstadoNotificacion = 'pendiente' | 'enviada' | 'fallida' | 'cancelada';

export interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  canal: string;
  destinatario: string | null;
  asunto: string | null;
  estado: EstadoNotificacion;
  intentos: number;
  ultimo_error: string | null;
  enviada_en: string | null;
  created_at: string;
}

export function listarNotificaciones(
  filtros: { tipo?: TipoNotificacion; estado?: EstadoNotificacion } = {},
): Promise<{ notificaciones: Notificacion[] }> {
  const params = new URLSearchParams();
  if (filtros.tipo) params.set('tipo', filtros.tipo);
  if (filtros.estado) params.set('estado', filtros.estado);
  const query = params.toString() ? `?${params.toString()}` : '';
  return peticion<{ notificaciones: Notificacion[] }>(`/notificaciones${query}`);
}

// --- Importación masiva de suscriptores (012-importacion-suscriptores-excel) --

export type CampoSuscriptorImportacion =
  | 'codigo_suscriptor' | 'nombre' | 'numero_documento' | 'direccion' | 'categoria'
  | 'tipo_documento' | 'telefono' | 'email' | 'sector' | 'notas';

export type MapeoColumnasImportacion = Partial<Record<CampoSuscriptorImportacion, string>>;

export type FilaCrudaImportacion = Record<string, string | number | null | undefined>;

export interface FilaNormalizadaImportacion {
  codigo_suscriptor: string;
  nombre: string;
  numero_documento: string;
  direccion: string;
  categoria: string;
  tipo_documento?: string;
  telefono?: string;
  email?: string;
  sector?: string;
  notas?: string;
}

export interface ErrorFilaImportacion {
  indiceFila: number;
  motivo: string;
}

export interface ResultadoValidacionImportacion {
  validas: Array<{ indiceFila: number; fila: FilaNormalizadaImportacion }>;
  errores: ErrorFilaImportacion[];
}

export function validarImportacion(
  filas: FilaCrudaImportacion[],
  mapeo: MapeoColumnasImportacion,
): Promise<ResultadoValidacionImportacion> {
  return peticion('/suscriptores/importar/validar', {
    method: 'POST',
    body: JSON.stringify({ filas, mapeo }),
  });
}

export interface ReporteImportacion {
  id: string;
  filasIntentadas: number;
  filasImportadas: number;
  filasConError: number;
  errores: ErrorFilaImportacion[];
  categoriasSinTarifa: string[];
}

export function confirmarImportacion(
  filasValidas: Array<{ indiceFila: number; fila: FilaNormalizadaImportacion }>,
  errores: ErrorFilaImportacion[],
  nombreArchivo: string,
): Promise<ReporteImportacion> {
  return peticion('/suscriptores/importar/confirmar', {
    method: 'POST',
    body: JSON.stringify({ filasValidas, errores, nombreArchivo }),
  });
}

// --- Panel de plataforma (018) ----------------------------------------------
// Solo para el superadmin (rol 'administrador'); el backend lo exige por RLS
// y por requerirAdminPlataforma (index.ts), no solo aquí.
//
// Nombrado AcueductoPlataforma (035), no Acueducto: ya existe otro `Acueducto`
// más abajo (023, configuración del propio acueducto — nombre/nit/dirección/
// etc.) con un nombre igual pero un significado distinto. Dos `interface`
// homónimas en el mismo módulo se fusionan en TypeScript (declaration
// merging) en vez de dar error — bug real y previo a esta sesión, encontrado
// al construir PlanEstadoAcueducto (035 T-002): el tipo fusionado exigía
// campos de ambos significados a la vez. Se renombra este, el menos usado
// (solo como prop de PlanEstadoAcueducto), para no tocar los 4 archivos que
// ya dependen del otro `Acueducto`.
export interface AcueductoPlataforma {
  id: string;
  nombre: string;
  slug: string;
  fecha_alta: string;
  adminEmail: string | null;
  planId: string | null;
  planNombre: string | null;
  estadoCuenta: 'activa' | 'vencida' | 'suspendida' | 'cancelada';
}

export interface CambioPlanEstado {
  planId?: string;
  estadoCuenta?: 'activa' | 'vencida' | 'suspendida' | 'cancelada';
}

export function cambiarPlanEstadoAcueducto(
  clienteId: string,
  cambios: CambioPlanEstado,
): Promise<{ id: string; planId: string | null; estadoCuenta: string }> {
  return peticion(`/plataforma/acueductos/${clienteId}`, {
    method: 'PATCH',
    body: JSON.stringify(cambios),
  });
}

export interface SaludSistema {
  tamanoBaseMb: number;
  nivel: 'ok' | 'atencion' | 'alerta' | 'critico';
  medidoEn: string;
  ultimoKeepalive: string | null;
  ultimoBackup: { archivo: string; subidoEn: string } | null;
}

export interface DatosAltaAcueducto {
  nombre: string;
  slug: string;
  nombreAdmin: string;
  correoAdmin: string;
}

export interface RespuestaAltaAcueducto {
  clienteId: string;
  slug: string;
  correoAdmin: string;
  invitacionEnviada: boolean;
  avisoCorreo?: string;
}

export function crearAcueductoPlataforma(datos: DatosAltaAcueducto): Promise<RespuestaAltaAcueducto> {
  return peticion('/plataforma/acueductos', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export interface DatosCorregirAdminAcueducto {
  nombreAdmin: string;
  correoAdmin: string;
}

export interface RespuestaCorregirAdminAcueducto {
  correoAdmin: string;
  invitacionEnviada: boolean;
  avisoCorreo?: string;
}

// Corrige el correo del admin de un acueducto ya creado (ej. se cargó mal al
// darlo de alta) — reemplaza al admin, invitación nueva a la persona
// correcta (Sesión 057).
export function corregirAdminAcueducto(
  clienteId: string,
  datos: DatosCorregirAdminAcueducto,
): Promise<RespuestaCorregirAdminAcueducto> {
  return peticion(`/plataforma/acueductos/${clienteId}/admin`, {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });
}

// --- Credenciales del panel de plataforma (033) -----------------------------

export function restablecerContrasenaAcueducto(email: string): Promise<{ ok: true }> {
  return peticion<{ ok: true }>('/auth/recuperar', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function cambiarContrasena(passwordNueva: string): Promise<{ ok: true }> {
  return peticion<{ ok: true }>('/auth/cambiar-contrasena', {
    method: 'POST',
    body: JSON.stringify({ passwordNueva }),
  });
}

export function completarRecuperacion(
  accessToken: string,
  refreshToken: string,
  passwordNueva: string,
): Promise<{ sesion: unknown; perfil: unknown; membresias: unknown[] }> {
  return peticion('/auth/completar-recuperacion', {
    method: 'POST',
    body: JSON.stringify({ accessToken, refreshToken, passwordNueva }),
  });
}

// ---- Configuración del acueducto (023) ------------------------------------

export interface Acueducto {
  nombre: string;
  nit: string | null;
  direccion: string | null;
  telefono: string | null;
  municipio: string | null;
  logoUrl: string | null;
  colorAcento: string;
}

export function obtenerAcueducto(): Promise<{ acueducto: Acueducto }> {
  return peticion('/acueducto');
}

export function actualizarColorAcentoAcueducto(colorAcento: string): Promise<{ colorAcento: string }> {
  return peticion('/acueducto/color', {
    method: 'PATCH',
    body: JSON.stringify({ color_acento: colorAcento }),
  });
}

// ---- Contexto del usuario actual (025) -------------------------------------
// GET /dashboard ya existe (Server Component de /app/dashboard); esta función
// lo reutiliza desde el cliente, solo para saber el rol antes de decidir qué
// shell renderizar en /app/lecturas — sin ruta nueva de backend.

export interface ContextoUsuario {
  cliente: { clienteId: string; rol: string; nombre: string; sectoresAsignados: string[] };
  perfil: { id: string; email: string; nombre: string };
  conteoUsuariosServicio: number;
}

export function obtenerContextoUsuario(): Promise<ContextoUsuario> {
  return peticion('/dashboard');
}

// --- Sectores y asignación a lectores (037) ---------------------------------

export interface LectorConSectores {
  perfilId: string;
  nombre: string;
  email: string;
  sectores: string[];
}

export function listarSectoresDisponibles(): Promise<{ sectores: string[] }> {
  return peticion('/sectores');
}

export function listarLectoresConSectores(): Promise<{ lectores: LectorConSectores[] }> {
  return peticion('/lectores');
}

export interface DatosCrearLector {
  nombre: string;
  correo: string;
  sectores?: string[];
}

export interface RespuestaCrearLector {
  correo: string;
  invitacionEnviada: boolean;
  avisoCorreo?: string;
}

// Crea un lector nuevo del acueducto activo — hueco real que no tenía
// interfaz hasta ahora (Sesión 057): el admin_acueducto puede crearlos
// según la especificación funcional, pero nunca hubo pantalla.
export function crearLector(datos: DatosCrearLector): Promise<RespuestaCrearLector> {
  return peticion('/lectores', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export function asignarSectorLector(perfilId: string, sector: string): Promise<{ ok: true }> {
  return peticion(`/lectores/${perfilId}/sectores`, {
    method: 'POST',
    body: JSON.stringify({ sector }),
  });
}

export function quitarSectorLector(perfilId: string, sector: string): Promise<{ ok: true }> {
  return peticion(`/lectores/${perfilId}/sectores/${encodeURIComponent(sector)}`, {
    method: 'DELETE',
  });
}
