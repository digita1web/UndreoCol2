import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UndreoCol',
  description: 'Gestión integral para acueductos comunitarios y pequeñas empresas de servicios públicos.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
