'use client';

import { useRef, useState } from 'react';
import { sugerirLecturaDesdeFoto } from '@/lib/ocr-lectura';

interface SugerirLecturaFotoProps {
  onSugerida: (valor: string) => void;
}

// 036: el aviso de higiene está siempre visible (CA-5) — se ve antes de que
// se dispare la cámara nativa del sistema operativo, no es un popup aparte
// que haya que cerrar.
export function SugerirLecturaFoto({ onSugerida }: SugerirLecturaFotoProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [procesando, setProcesando] = useState(false);

  async function alElegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite elegir la misma foto de nuevo después
    if (!archivo) return;
    setProcesando(true);
    try {
      const valor = await sugerirLecturaDesdeFoto(archivo);
      if (valor) onSugerida(valor);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        Limpiá el visor del contador antes de tomar la foto, para mejor precisión.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={alElegirFoto}
      />
      <button
        type="button"
        className="h-11 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
        disabled={procesando}
        onClick={() => inputRef.current?.click()}
      >
        {procesando ? 'Leyendo…' : 'Sugerir lectura con foto'}
      </button>
    </div>
  );
}
