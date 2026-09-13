'use client';

import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import type { Contador } from '@/lib/api';

interface EtiquetaQrContadorProps {
  contador: Contador;
}

// 015: el QR codifica el `id` del contador (único globalmente), no el `serial`
// (único solo dentro de un mismo acueducto). Nivel de corrección de errores H
// (~30% de daño tolerado) — recomendación de la comunidad para etiquetas
// industriales sucias/rayadas/a la intemperie (spec §3.1), no el valor por
// defecto de la librería.
export function EtiquetaQrContador({ contador }: EtiquetaQrContadorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, contador.id, { errorCorrectionLevel: 'H' }, (err) => {
      if (err) console.error('etiqueta-qr-contador: no se pudo generar el QR', err);
    });
  }, [contador.id]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-6">
      <canvas ref={canvasRef} />
      <p className="font-mono text-sm">Serial: {contador.serial}</p>
      <Button className="print:hidden" onClick={() => window.print()}>
        Imprimir etiqueta
      </Button>
    </div>
  );
}
