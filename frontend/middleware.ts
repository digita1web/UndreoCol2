import { NextResponse, type NextRequest } from 'next/server';

// Protege /app/*: solo verifica la PRESENCIA de la cookie de sesión
// administrativa (uc_sesion_admin, backend/src/lib/auth.ts). La validación
// real del token ocurre en el server component (GET /auth/sesion) — decisión
// D-2 del plan: evita una llamada de red extra en cada navegación.
const NOMBRE_COOKIE_SESION = 'uc_sesion_admin';

export function middleware(request: NextRequest) {
  const tieneSesion = request.cookies.has(NOMBRE_COOKIE_SESION);
  if (!tieneSesion) {
    const urlLogin = new URL('/login', request.url);
    return NextResponse.redirect(urlLogin);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*'],
};
