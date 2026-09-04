import { NextResponse, type NextRequest } from 'next/server';

// Dos áreas con cookies de sesión DISTINTAS que nunca se mezclan:
//   /app/*   → uc_sesion_admin       (sesión administrativa, backend/lib/auth.ts)
//   /portal/*→ uc_sesion_suscriptor  (sesión del portal, backend/lib/sesion-suscriptor.ts)
// Un admin sin cookie de suscriptor NO ve el portal como suscriptor (se le
// pide el login del portal) y un suscriptor sin cookie de admin no ve el panel.
// El login del portal (/portal/:slug/login) es público. Al igual que en /app,
// solo se verifica la PRESENCIA de la cookie; la validación real ocurre en el
// backend (las rutas /portal/* devuelven 401 si el JWT no es válido).

const NOMBRE_COOKIE_ADMIN = 'uc_sesion_admin';
const NOMBRE_COOKIE_SUSCRIPTOR = 'uc_sesion_suscriptor';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Área administrativa /app/*: exige la cookie del administrador.
  if (pathname.startsWith('/app')) {
    if (!request.cookies.has(NOMBRE_COOKIE_ADMIN)) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    return NextResponse.next();
  }

  // Portal del suscriptor /portal/:slug/*: exige la cookie del suscriptor,
  // salvo el login público /portal/:slug/login.
  if (pathname.startsWith('/portal/')) {
    const partes = pathname.split('/').filter(Boolean); // ['portal', slug, ...]
    const slug = partes[1];
    const resto = partes.slice(2).join('/');
    if (resto === 'login') return NextResponse.next(); // login público
    if (!request.cookies.has(NOMBRE_COOKIE_SUSCRIPTOR)) {
      if (slug) return NextResponse.redirect(new URL(`/portal/${slug}/login`, request.url));
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/portal/:slug/:path*'],
};
