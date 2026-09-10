import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  DashboardIndicadores,
  type IndicadoresDashboard,
} from '@/components/indicadores-dashboard';
import { urlBaseApiServidor } from '@/lib/url-base-api-servidor';

// Server component: llama a GET /dashboard reenviando la cookie de sesión
// administrativa (uc_sesion_admin) — un fetch de servidor no incluye
// automáticamente las cookies del navegador, a diferencia de lib/api.ts
// (client-only, usa credentials: 'include').
//
// `cookies().get().value` de next/headers ya viene decodificado con
// decodeURIComponent (next/dist/compiled/@edge-runtime/cookies). El backend
// escribe la cookie con hono/cookie, que la codifica con encodeURIComponent
// porque el valor es un JSON con `{`, `"` y `:` (caracteres inválidos en un
// cookie-value crudo). Sin volver a codificar aquí, el header Cookie sale
// malformado, hono/cookie no puede decodificarlo, la sesión no se reconoce,
// /dashboard responde 401 y esta página redirige a /login pese a que el login
// fue exitoso y la cookie del navegador es válida (bug real, confirmado con
// curl: mismo valor crudo → 200, mismo valor ya decodificado → 401).
//
// La URL base (lib/url-base-api-servidor.ts) ya no es una constante fija:
// en producción NEXT_PUBLIC_API_URL se deja sin definir a propósito (020), así
// que se resuelve por petición contra el propio host del proxy /api.
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

  const respuesta = await fetch(`${await urlBaseApiServidor()}/dashboard`, {
    headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${encodeURIComponent(cookieSesion.value)}` },
    cache: 'no-store',
  });

  if (respuesta.status === 401) redirect('/login');

  const cuerpo: { error?: string; esAdminPlataforma?: boolean } & Partial<RespuestaDashboard> =
    await respuesta.json().catch(() => ({}));

  if (respuesta.status === 400) {
    // 018: un superadmin puro (solo la membresía 'administrador', sin ningún
    // acueducto) no va a /onboarding — ese formulario crea SU PROPIO
    // acueducto (crear_tenant_con_admin, 001), y el superadmin no es quien
    // debe pasar por ahí. Va a /plataforma, donde da de alta acueductos
    // ajenos (ver lib/tenant.ts resolverClienteActivo, T-004).
    if (cuerpo.error === 'Sin acueducto') {
      redirect(cuerpo.esAdminPlataforma ? '/plataforma' : '/onboarding');
    }
    throw new Error(cuerpo.error ?? 'No se pudo cargar el dashboard');
  }
  if (!respuesta.ok) {
    throw new Error(cuerpo.error ?? 'No se pudo cargar el dashboard');
  }
  return cuerpo as RespuestaDashboard;
}

// GET /dashboard/indicadores — payload del bloque de indicadores (011).
// Replica el patrón de reenvío de cookie del fetch del encabezado (Sesión 023).
// El endpoint responde 403 a roles sin permiso, pero esta función solo se llama
// cuando el rol ya se validó como admin_acueducto (ver DashboardPage abajo).
async function obtenerIndicadores(): Promise<IndicadoresDashboard> {
  const almacenCookies = await cookies();
  const cookieSesion = almacenCookies.get(NOMBRE_COOKIE_SESION);
  if (!cookieSesion) redirect('/login');

  const respuesta = await fetch(`${await urlBaseApiServidor()}/dashboard/indicadores`, {
    headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${encodeURIComponent(cookieSesion.value)}` },
    cache: 'no-store',
  });

  if (respuesta.status === 401) redirect('/login');

  const cuerpo: { error?: string } & { indicadores?: IndicadoresDashboard } = await respuesta
    .json()
    .catch(() => ({}));

  if (respuesta.status === 400) {
    if (cuerpo.error === 'Sin acueducto') redirect('/onboarding');
    throw new Error(cuerpo.error ?? 'No se pudieron obtener los indicadores');
  }
  if (!respuesta.ok || !cuerpo.indicadores) {
    throw new Error(cuerpo.error ?? 'No se pudieron obtener los indicadores');
  }
  return cuerpo.indicadores;
}

function etiquetaRol(rol: string): string {
  if (rol === 'admin_acueducto') return 'Administrador del acueducto';
  if (rol === 'lector') return 'Lector';
  return rol;
}

export default async function DashboardPage() {
  const datos = await obtenerDashboard();

  // Decisión del spec §0.4: los indicadores son SOLO de admin_acueducto. Un
  // miembro con otro rol ve un estado explícito de "No autorizado" (con enlace a
  // su espacio) y NUNCA los indicadores — no se degrada a "solo el encabezado".
  let indicadores: IndicadoresDashboard | null = null;
  if (datos.cliente.rol === 'admin_acueducto') {
    indicadores = await obtenerIndicadores();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{datos.cliente.nombre}</h1>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Usuario</dt>
        <dd>{datos.perfil.nombre}</dd>
        <dt className="text-muted-foreground">Rol</dt>
        <dd>{etiquetaRol(datos.cliente.rol)}</dd>
        <dt className="text-muted-foreground">Usuarios de servicio</dt>
        <dd>{datos.conteoUsuariosServicio}</dd>
      </dl>

      {datos.cliente.rol === 'admin_acueducto' && indicadores ? (
        <>
          <DashboardIndicadores indicadores={indicadores} />
          <Link href="/app/configuracion" className="text-sm text-blue-600 hover:underline">
            Configuración del acueducto →
          </Link>
        </>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-lg font-semibold">No autorizado</p>
          <p className="text-sm text-muted-foreground">
            Los indicadores del acueducto son visibles solo para el administrador del acueducto.
          </p>
          <Link href="/app/lecturas" className="text-sm text-blue-600 hover:underline">
            Ir a lecturas →
          </Link>
        </div>
      )}
    </main>
  );
}
