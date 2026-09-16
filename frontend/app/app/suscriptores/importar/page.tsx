'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ImportacionMapeo } from '@/components/importacion-mapeo';
import { ImportacionResumen } from '@/components/importacion-resumen';
import {
  confirmarImportacion,
  validarImportacion,
  type FilaCrudaImportacion,
  type MapeoColumnasImportacion,
  type ResultadoValidacionImportacion,
} from '@/lib/api';

// 012-importacion-suscriptores-excel: carga → mapeo → resumen de errores →
// confirmación → reporte (spec.md §3). El archivo se parsea en el navegador
// (ImportacionMapeo, xlsx/SheetJS); solo las filas ya parseadas como JSON
// llegan a la API.
export default function ImportarSuscriptoresPage() {
  const [resultado, setResultado] = useState<ResultadoValidacionImportacion | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function alValidar(filas: FilaCrudaImportacion[], mapeo: MapeoColumnasImportacion, archivo: string) {
    setError(null);
    setCargando(true);
    try {
      const r = await validarImportacion(filas, mapeo);
      setResultado(r);
      setNombreArchivo(archivo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo validar el archivo');
    } finally {
      setCargando(false);
    }
  }

  function alCancelar() {
    setResultado(null);
    setNombreArchivo('');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Suscriptores</p>
          <h1 className="text-[28px] font-bold tracking-tight">Importar suscriptores</h1>
          <p className="mt-1 text-sm text-muted-foreground">Cargá un archivo Excel o CSV con tus suscriptores.</p>
        </div>
        <Link href="/app/suscriptores" className="text-sm text-accent hover:underline">
          ← Suscriptores
        </Link>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!resultado && (
        <Card>
          <CardHeader>
            <CardTitle>1. Cargar archivo y mapear columnas</CardTitle>
          </CardHeader>
          <CardContent>
            <ImportacionMapeo onValidar={alValidar} cargando={cargando} />
          </CardContent>
        </Card>
      )}

      {resultado && (
        <Card>
          <CardHeader>
            <CardTitle>2. Resumen y confirmación</CardTitle>
          </CardHeader>
          <CardContent>
            <ImportacionResumen
              resultado={resultado}
              nombreArchivo={nombreArchivo}
              onConfirmar={(filasValidas, errores, archivo) => confirmarImportacion(filasValidas, errores, archivo)}
              onCancelar={alCancelar}
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
