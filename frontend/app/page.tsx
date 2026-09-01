import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Redirige la raíz según la PRESENCIA de la cookie de sesión administrativa
// (mismo criterio que middleware.ts, decisión D-2 del plan: la validación
// real del token queda para /app/dashboard vía GET /auth/sesion/GET /dashboard).
const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';

export default async function Home() {
  const almacenCookies = await cookies();
  const tieneSesion = almacenCookies.has(NOMBRE_COOKIE_SESION);
  redirect(tieneSesion ? '/app/dashboard' : '/login');
}
