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
