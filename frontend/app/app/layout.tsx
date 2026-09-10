// Layout del área protegida /app/* (middleware.ts exige la cookie de sesión
// administrativa antes de llegar aquí).
import Link from 'next/link';
import { BotonSalir } from '@/components/boton-salir';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-8 py-3 print:hidden">
        <Link href="/app/dashboard" className="text-sm font-medium text-blue-600 hover:underline">
          ← Inicio
        </Link>
        <BotonSalir />
      </header>
      {children}
    </div>
  );
}
