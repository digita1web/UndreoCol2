'use client';

import { useEffect, useState } from 'react';

export type PestanaLector = 'inicio' | 'nueva' | 'pendientes' | 'historial';

const PESTANAS: Array<{ id: PestanaLector; etiqueta: string }> = [
  { id: 'inicio', etiqueta: 'Inicio' },
  { id: 'nueva', etiqueta: 'Nueva' },
  { id: 'pendientes', etiqueta: 'Pendientes' },
  { id: 'historial', etiqueta: 'Historial' },
];

function IconoGota() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c-4 5.5-7 9.2-7 12.5A7 7 0 0 0 19 14.5C19 11.2 16 7.5 12 2z" />
    </svg>
  );
}

function IconoInicio() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconoMas() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  );
}

function IconoAlerta() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3 2 20h20L12 3z" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
    </svg>
  );
}

function IconoReloj() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONOS: Record<PestanaLector, () => React.ReactElement> = {
  inicio: IconoInicio,
  nueva: IconoMas,
  pendientes: IconoAlerta,
  historial: IconoReloj,
};

/** navigator.onLine + eventos online/offline — conectividad real del
 * dispositivo, sin prometer guardado offline (plan.md §5, riesgo). */
function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(true);
  useEffect(() => {
    setEnLinea(navigator.onLine);
    const alConectar = () => setEnLinea(true);
    const alDesconectar = () => setEnLinea(false);
    window.addEventListener('online', alConectar);
    window.addEventListener('offline', alDesconectar);
    return () => {
      window.removeEventListener('online', alConectar);
      window.removeEventListener('offline', alDesconectar);
    };
  }, []);
  return enLinea;
}

interface ShellLectorProps {
  pestana: PestanaLector;
  onPestanaChange: (pestana: PestanaLector) => void;
  pendientesCount?: number;
  sinSubirCount?: number;
  children: React.ReactNode;
}

export function ShellLector({ pestana, onPestanaChange, pendientesCount, sinSubirCount, children }: ShellLectorProps) {
  const enLinea = useEnLinea();

  return (
    <div className="flex min-h-screen flex-col bg-muted/40 print:hidden">
      <header className="flex items-center justify-between bg-blue-600 px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <IconoGota />
          <div>
            <p className="text-lg font-bold leading-tight">AquaLectura</p>
            <p className="text-xs leading-tight text-blue-100">Lectura de contadores</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
            <span className={`h-1.5 w-1.5 rounded-full ${enLinea ? 'bg-emerald-300' : 'bg-red-300'}`} />
            {enLinea ? 'En línea' : 'Sin conexión'}
          </span>
          {/* 038: badge distinto del de la pestaña "Pendientes" (revisión de
              anomalías, otro concepto) — este cuenta lecturas guardadas en
              el celular que todavía no confirmó el servidor (CA-6). */}
          {!!sinSubirCount && (
            <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-semibold text-amber-950">
              {sinSubirCount} sin subir
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 flex border-t border-border bg-background">
        {PESTANAS.map((p) => {
          const Icono = ICONOS[p.id];
          const activa = pestana === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPestanaChange(p.id)}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
                activa ? 'text-blue-600' : 'text-muted-foreground'
              }`}
            >
              <Icono />
              {p.id === 'pendientes' && !!pendientesCount && (
                <span className="absolute right-1/4 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {pendientesCount}
                </span>
              )}
              {p.etiqueta}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
