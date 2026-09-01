import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Server component: llama a GET /dashboard reenviando la cookie de sesión
// administrativa (uc_sesion_admin) — un fetch de servidor no incluye
// automáticamente las cookies del navegador, a diferencia de lib/api.ts
// (client-only, usa credentials: 'include').
const URL_BASE_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';

interface ClienteActivo {
  clienteId: string;
  rol: string;
  nombre: string;
}

interface RespuestaDashboard {
  cliente: ClienteActivo;
  perfil: { id: string; email: string; nombre: string };
  conteoUsuariosServicio: number;
}

async function obtenerDashboard(): Promise<RespuestaDashboard> {
  const almacenCookies = await cookies();
  const cookieSesion = almacenCookies.get(NOMBRE_COOKIE_SESION);
  if (!cookieSesion) redirect('/login');

  const respuesta = await fetch(`${URL_BASE_API}/dashboard`, {
    headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${cookieSesion.value}` },
    cache: 'no-store',
  });

  if (respuesta.status === 401) redirect('/login');

  const cuerpo: { error?: string } & Partial<RespuestaDashboard> = await respuesta
    .json()
    .catch(() => ({}));

  if (respuesta.status === 400) {
    if (cuerpo.error === 'Sin acueducto') redirect('/onboarding');
    throw new Error(cuerpo.error ?? 'No se pudo cargar el dashboard');
  }
  if (!respuesta.ok) {
    throw new Error(cuerpo.error ?? 'No se pudo cargar el dashboard');
  }
  return cuerpo as RespuestaDashboard;
}

export default async function DashboardPage() {
  const datos = await obtenerDashboard();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{datos.cliente.nombre}</h1>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Usuario</dt>
        <dd>{datos.perfil.nombre}</dd>
        <dt className="text-muted-foreground">Rol</dt>
        <dd>{datos.cliente.rol}</dd>
        <dt className="text-muted-foreground">Usuarios de servicio</dt>
        <dd>{datos.conteoUsuariosServicio}</dd>
      </dl>
    </main>
  );
}
