'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ErrorFilaImportacion, ReporteImportacion, ResultadoValidacionImportacion } from '@/lib/api';

interface ImportacionResumenProps {
  resultado: ResultadoValidacionImportacion;
  nombreArchivo: string;
  onConfirmar: (
    filasValidas: ResultadoValidacionImportacion['validas'],
    errores: ErrorFilaImportacion[],
    nombreArchivo: string,
  ) => Promise<ReporteImportacion>;
  onCancelar: () => void;
}

// Resumen de validación (3.3) + confirmación explícita (3.4: nunca "importar
// todo e ignorar errores" — solo las filas válidas se envían) + reporte final
// (3.5), incluyendo la advertencia no bloqueante de categorías sin tarifa.
export function ImportacionResumen({ resultado, nombreArchivo, onConfirmar, onCancelar }: ImportacionResumenProps) {
  const [reporte, setReporte] = useState<ReporteImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function alConfirmar() {
    setError(null);
    setCargando(true);
    try {
      const r = await onConfirmar(resultado.validas, resultado.errores, nombreArchivo);
      setReporte(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo confirmar la importación');
    } finally {
      setCargando(false);
    }
  }

  if (reporte) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Importación completada: <strong>{reporte.filasImportadas}</strong> suscriptor(es)
          nuevo(s) de {reporte.filasIntentadas} fila(s) intentada(s)
          {reporte.filasConError > 0 && ` (${reporte.filasConError} con error)`}.
        </p>
        {reporte.categoriasSinTarifa.length > 0 && (
          <p className="text-sm text-amber-600">
            Advertencia: sin tarifa vigente configurada para: {reporte.categoriasSinTarifa.join(', ')}.
            No bloquea la importación, pero esos suscriptores no se podrán facturar hasta que se
            configure la tarifa.
          </p>
        )}
        <p className="text-xs text-muted-foreground">ID de la importación: {reporte.id}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <strong>{resultado.validas.length}</strong> fila(s) lista(s) para importar,{' '}
        <strong>{resultado.errores.length}</strong> con error.
      </p>

      {resultado.errores.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-border p-3">
          <p className="text-sm font-medium">Filas con error</p>
          <ul className="flex flex-col gap-1 text-sm text-red-600">
            {resultado.errores.map((e) => (
              <li key={e.indiceFila}>
                Fila {e.indiceFila + 1}: {e.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" onClick={alConfirmar} disabled={cargando || resultado.validas.length === 0}>
          {cargando ? 'Importando…' : `Importar ${resultado.validas.length} fila(s) válida(s)`}
        </Button>
        <Button type="button" variant="outline" onClick={onCancelar} disabled={cargando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
