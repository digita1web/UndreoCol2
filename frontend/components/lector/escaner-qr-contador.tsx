'use client';

import { useEffect, useRef } from 'react';
import QrScanner from 'qr-scanner';
import { Button } from '@/components/ui/button';

interface EscanerQrContadorProps {
  onDecodificado: (texto: string) => void;
  onCerrar: () => void;
}

// 015: escanea con la cámara y entrega el texto crudo del QR al padre — el
// padre (nueva-lectura-lector.tsx) es quien decide si matchea con algún
// contador conocido. Este componente NUNCA guarda ninguna lectura ni decide
// nada de negocio, solo decodifica. qr-scanner ya prioriza la API nativa
// BarcodeDetector del navegador y solo cae a un decodificador JS de respaldo
// si el navegador no la soporta (spec §3.3) — no se reimplementa ese criterio.
export function EscanerQrContador({ onDecodificado, onCerrar }: EscanerQrContadorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const escaner = new QrScanner(
      videoRef.current,
      (resultado) => onDecodificado(resultado.data),
      { returnDetailedScanResult: true },
    );
    escaner.start().catch((err) => console.error('escaner-qr-contador: no se pudo iniciar la cámara', err));

    return () => {
      escaner.destroy();
    };
  }, [onDecodificado]);

  return (
    <div className="flex flex-col gap-3">
      <video ref={videoRef} className="w-full rounded-lg" muted playsInline />
      <Button variant="outline" onClick={onCerrar}>
        Cancelar escaneo
      </Button>
    </div>
  );
}
