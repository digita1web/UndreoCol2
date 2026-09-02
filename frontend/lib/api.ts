// Wrapper fetch hacia la API de Hono (backend/). Nunca importa `@supabase/*`
// (CA-4) — todo pasa por aquí, con `credentials: 'include'` para la cookie
// HttpOnly `uc_sesion_admin` que pone el backend (D-3 del plan).

const URL_BASE_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export interface SesionAdministrativa {
  tipo: 'administrativa';
  perfilId: string;
  email: string;
}

export interface Perfil {
  id: string;
  nombre: string;
  email: string;
}

export interface Membresia {
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
    const mensaje = (cuerpo as ErrorApi | null)?.error ?? `Error ${respuesta.status}`;
    throw new Error(mensaje);
  }
  return cuerpo as T;
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

export interface RespuestaOnboarding {
  clienteId: string;
}

export function crearAcueducto(nombre: string, slug: string): Promise<RespuestaOnboarding> {
  return peticion<RespuestaOnboarding>('/onboarding', {
    method: 'POST',
    body: JSON.stringify({ nombre, slug }),
  });
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

export type EstadoSuscriptor = 'activo' | 'suspendido' | 'cortado' | 'inactivo';

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
export interface DatosActualizarSuscriptor {
  nombre?: string;
  estado?: EstadoSuscriptor;
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

export type RevisionLectura = 'normal' | 'consumo_alto' | 'consumo_bajo' | 'consumo_cero';

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
