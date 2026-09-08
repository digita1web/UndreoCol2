import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlataformaForm } from '@/components/plataforma-form';

// Server component, mismo patrón que frontend/app/app/dashboard/page.tsx: lee
// la cookie de sesión administrativa y reenvía el header Cookie a mano (un
// fetch de servidor no incluye las cookies del navegador). Ver el comentario
// de dashboard/page.tsx para el porqué de encodeURIComponent.
const URL_BASE_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';

interface Acueducto {
  id: string;
  nombre: string;
  slug: string;
  fecha_alta: string;
}

interface RespuestaPlataforma {
  autorizado: boolean;
  acueductos: Acueducto[];
}

async function obtenerAcueductos(): Promise<RespuestaPlataforma> {
  const almacenCookies = await cookies();
  const cookieSesion = almacenCookies.get(NOMBRE_COOKIE_SESION);
  if (!cookieSesion) redirect('/login');

  const respuesta = await fetch(`${URL_BASE_API}/plataforma`, {
    headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${encodeURIComponent(cookieSesion.value)}` },
    cache: 'no-store',
  });

  if (respuesta.status === 401) redirect('/login');
  if (respuesta.status === 403) {
    // No es un error de la página: un admin_acueducto que llegó aquí por
    // error de navegación. Se muestra explícito, sin redirigir en silencio.
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

export default async function PlataformaPage() {
  const { autorizado, acueductos } = await obtenerAcueductos();

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
      <h1 className="text-2xl font-semibold">Panel de plataforma</h1>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Dar de alta un acueducto</h2>
        <PlataformaForm />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Acueductos ({acueductos.length})</h2>
        {acueductos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay ningún acueducto dado de alta.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {acueductos.map((a) => (
              <li key={a.id} className="flex items-center justify-between p-4 text-sm">
                <span className="font-medium">{a.nombre}</span>
                <span className="text-muted-foreground">{a.slug}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
