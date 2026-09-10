// Layout del área protegida /app/* (middleware.ts exige la cookie de sesión
// administrativa antes de llegar aquí). 026: reemplaza el header simple por
// la barra lateral + cabecera del prototipo de Mateo — el enlace "Panel" de
// la barra lateral ya cubre lo que antes hacía "← Inicio".
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { SidebarPanel } from '@/components/panel/sidebar-panel';
import { TopbarPanel } from '@/components/panel/topbar-panel';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${inter.className} min-h-screen bg-background`}>
      <SidebarPanel />
      <div className="sm:ml-[250px]">
        <TopbarPanel />
        {children}
      </div>
    </div>
  );
}
