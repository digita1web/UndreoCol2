import type { NextConfig } from 'next';

// Configuración mínima; el adaptador @opennextjs/cloudflare gestiona el resto.
//
// Cabeceras de seguridad (hallazgo B-6 de la auditoría pre-producción,
// docs/PLAN-PRODUCCION.md): el panel administrativo se servía sin ninguna, así
// que se podía embeber en un iframe de otro sitio (clickjacking sobre un panel
// que anula facturas y cambia tarifas).
//
// Se aplica el subconjunto que NO puede romper una aplicación normal.
// DELIBERADAMENTE NO se añade `Content-Security-Policy`: una CSP mal ajustada
// rompe la aplicación en silencio y en este entorno no se puede ejecutar
// `next build` para comprobarlo (el proxy deniega cdn.sheetjs.com, de donde
// package.json toma `xlsx` desde la Sesión 020, así que `npm ci` aborta).
// Añadir CSP merece su propia tarea, con el navegador delante.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Todas las rutas: panel, portal del suscriptor y páginas públicas.
        source: '/:path*',
        headers: [
          // Clickjacking: nadie embebe el panel en un iframe ajeno.
          // Se ponen las dos: `frame-ancestors` es la moderna, X-Frame-Options
          // cubre navegadores que aún no la aplican.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          // Evita que el navegador adivine el tipo de un recurso servido.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // No filtrar la URL completa (que lleva ids de factura y de
          // suscriptor) a terceros al salir del sitio.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // El sistema no usa cámara, micrófono ni geolocalización en el panel.
          // La PWA del lector (feature 015, QR+OCR) SÍ necesitará cámara: al
          // implementarla habrá que exceptuar su ruta aquí.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
