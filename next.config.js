/** @type {import('next').NextConfig} */
const nextConfig = {
  // Portabilidad (CLAUDE.md §5.2 / INFRAESTRUCTURA.md §6): el servidor se
  // despliega en cualquier contenedor sin depender de Vercel.
  output: 'standalone',
};

module.exports = nextConfig;
