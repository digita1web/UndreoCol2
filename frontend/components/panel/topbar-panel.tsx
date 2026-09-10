'use client';

import { useEffect, useState } from 'react';
import { obtenerAcueducto } from '@/lib/api';

export function TopbarPanel() {
  const [enLinea, setEnLinea] = useState(true);
  const [nombreAcueducto, setNombreAcueducto] = useState<string | null>(null);

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

  useEffect(() => {
    obtenerAcueducto()
      .then((r) => setNombreAcueducto(r.acueducto.nombre))
      .catch((e) => console.error('No se pudo cargar el acueducto para la cabecera', e));
  }, []);

  return (
    <header className="sticky top-0 z-[5] flex h-[60px] items-center justify-between border-b border-border bg-background px-6 print:hidden">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${enLinea ? 'bg-success' : 'bg-danger'}`} />
        {enLinea ? 'En línea' : 'Sin conexión'}
      </span>
      <span className="rounded-md border border-border px-3 py-1.5 text-sm font-medium">
        {nombreAcueducto ?? 'Cargando…'}
      </span>
    </header>
  );
}
