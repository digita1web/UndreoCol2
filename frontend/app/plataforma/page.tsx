import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlataformaForm } from '@/components/plataforma-form';
import { urlBaseApiServidor } from '@/lib/url-base-api-servidor';
import { BotonSalir } from '@/components/boton-salir';
import { CambiarContrasenaForm } from '@/components/cambiar-contrasena-form';
import { RestablecerContrasenaAcueducto } from '@/components/restablecer-contrasena-acueducto';
import { PlanEstadoAcueducto } from '@/components/plan-estado-acueducto';
import { SaludSistema as SaludSistemaCard } from '@/components/salud-sistema';
import type { SaludSistema as TipoSaludSistema } from '@/lib/api';

const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';

interface Acueducto {
  id: string;
  nombre: string;
  slug: string;
  fecha_alta: string;
  adminEmail: string | null;
  planId: string | null;
  planNombre: string | null;
  estadoCuenta: 'activa' | 'vencida' | 'suspendida' | 'cancelada';
}

interface RespuestaPlataforma {
  autorizado: boolean;
  acueductos: Acueducto[];
}

async function obtenerAcueductos(): Promise<RespuestaPlataforma> {
  const almacenCookies = await cookies();
  const cookieSesion = almacenCookies.get(NOMBRE_COOKIE_SESION);
  if (!cookieSesion) redirect('/login');

  const respuesta = await fetch(`${await urlBaseApiServidor()}/plataforma`, {
    headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${encodeURIComponent(cookieSesion.value)}` },
    cache: 'no-store',
  });

  if (respuesta.status === 401) redirect('/login');
  if (respuesta.status === 403) {
    return { autorizado: false, acueductos: [] };
  }

  const cuerpo: { error?: string; acueductos?: Acueducto[] } = await respuesta
    .json()
    .catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(cuerpo.error ?? 'No se pudo cargar el panel de plataforma');
  }
  return { autorizado: true, acueductos: cuerpo.acueductos ?? [] };
}

// 035: nunca lanza — si algo falla, la sección "Salud del sistema" muestra el
// aviso, pero el resto del panel (alta de acueductos, lista, credenciales)
// sigue funcionando igual. La misma sesión que ya validó obtenerAcueductos()
// (401/403) sirve acá; esta función no redirige por su cuenta.
interface RespuestaSalud {
  salud: TipoSaludSistema | null;
  error: string | null;
}

async function obtenerSalud(): Promise<RespuestaSalud> {
  const almacenCookies = await cookies();
  const cookieSesion = almacenCookies.get(NOMBRE_COOKIE_SESION);
  if (!cookieSesion) return { salud: null, error: null };

  try {
    const respuesta = await fetch(`${await urlBaseApiServidor()}/plataforma/salud`, {
      headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${encodeURIComponent(cookieSesion.value)}` },
      cache: 'no-store',
    });
    if (!respuesta.ok) {
      const cuerpo: { error?: string } = await respuesta.json().catch(() => ({}));
      return { salud: null, error: cuerpo.error ?? 'No se pudo cargar la salud del sistema' };
    }
    const salud: TipoSaludSistema = await respuesta.json();
    return { salud, error: null };
  } catch (e) {
    return { salud: null, error: e instanceof Error ? e.message : 'No se pudo cargar la salud del sistema' };
  }
}

export default async function PlataformaPage() {
  const [{ autorizado, acueductos }, { salud, error: errorSalud }] = await Promise.all([
    obtenerAcueductos(),
    obtenerSalud(),
  ]);

  if (!autorizado) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-lg font-semibold">No autorizado</p>
        <p className="text-sm text-muted-foreground">
          El panel de plataforma es solo para el superadministrador de UndreoCol.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Panel de plataforma</h1>
        <BotonSalir />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Dar de alta un acueducto</h2>
        <PlataformaForm />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h2 className="text-lg font-medium">Cambiar mi contraseña</h2>
        <CambiarContrasenaForm />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Acueductos ({acueductos.length})</h2>
        {acueductos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay ningún acueducto dado de alta.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {acueductos.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{a.nombre}</p>
                    <p className="text-muted-foreground">{a.slug}</p>
                    <p className="text-muted-foreground">
                      {a.adminEmail ?? 'sin admin asignado'}
                    </p>
                  </div>
                  <RestablecerContrasenaAcueducto email={a.adminEmail} />
                </div>
                <PlanEstadoAcueducto acueducto={a} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h2 className="text-lg font-medium">Salud del sistema</h2>
        {salud ? (
          <SaludSistemaCard salud={salud} />
        ) : (
          <p className="text-sm text-red-600">{errorSalud ?? 'No se pudo cargar la salud del sistema'}</p>
        )}
      </section>
    </main>
  );
}
