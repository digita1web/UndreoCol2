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
