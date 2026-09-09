// Layout del área protegida /app/* (middleware.ts exige la cookie de sesión
// administrativa antes de llegar aquí).
import { BotonSalir } from '@/components/boton-salir';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-end border-b border-border px-8 py-3">
        <BotonSalir />
      </header>
      {children}
    </div>
  );
}
