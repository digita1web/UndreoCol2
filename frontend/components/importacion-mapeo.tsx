'use client';

import { useState, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { CampoSuscriptorImportacion, FilaCrudaImportacion, MapeoColumnasImportacion } from '@/lib/api';

// Carga y parseo de .xlsx/.csv EN EL NAVEGADOR (xlsx/SheetJS) — al Worker
// solo llegan las filas ya parseadas como JSON, nunca el archivo crudo
// (CLAUDE.md §5.5: evita el límite de bundle/memoria/CPU de Cloudflare
// Workers con un archivo grande).

const CAMPOS_REQUERIDOS: readonly CampoSuscriptorImportacion[] = [
  'codigo_suscriptor', 'nombre', 'numero_documento', 'direccion', 'categoria',
];
const CAMPOS_OPCIONALES: readonly CampoSuscriptorImportacion[] = [
  'tipo_documento', 'telefono', 'email', 'sector', 'notas',
];
const ETIQUETAS: Record<CampoSuscriptorImportacion, string> = {
  codigo_suscriptor: 'Código de suscriptor',
  nombre: 'Nombre',
  numero_documento: 'Número de documento',
  direccion: 'Dirección',
  categoria: 'Categoría',
  tipo_documento: 'Tipo de documento',
  telefono: 'Teléfono',
  email: 'Correo electrónico',
  sector: 'Sector',
  notas: 'Notas',
};

interface ImportacionMapeoProps {
  onValidar: (filas: FilaCrudaImportacion[], mapeo: MapeoColumnasImportacion, nombreArchivo: string) => void;
  cargando: boolean;
}

export function ImportacionMapeo({ onValidar, cargando }: ImportacionMapeoProps) {
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [columnas, setColumnas] = useState<string[]>([]);
  const [filas, setFilas] = useState<FilaCrudaImportacion[]>([]);
  const [mapeo, setMapeo] = useState<MapeoColumnasImportacion>({});
  const [error, setError] = useState<string | null>(null);

  async function alSeleccionarArchivo(evento: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    try {
      const buffer = await archivo.arrayBuffer();
      const libro = XLSX.read(buffer, { type: 'array' });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const filasParseadas = XLSX.utils.sheet_to_json<FilaCrudaImportacion>(hoja, { defval: null });
      if (filasParseadas.length === 0) {
        setError('El archivo no tiene filas de datos');
        setColumnas([]);
        setFilas([]);
        return;
      }
      setColumnas(Object.keys(filasParseadas[0]));
      setFilas(filasParseadas);
      setNombreArchivo(archivo.name);
      setMapeo({});
    } catch {
      setError('No se pudo leer el archivo. Debe ser .xlsx o .csv válido.');
      setColumnas([]);
      setFilas([]);
    }
  }

  const mapeoCompleto = CAMPOS_REQUERIDOS.every((campo) => mapeo[campo]);

  function alValidar() {
    if (!mapeoCompleto) {
      setError('Asigna una columna del archivo a cada campo requerido antes de continuar');
      return;
    }
    setError(null);
    onValidar(filas, mapeo, nombreArchivo);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="archivo_importacion">Archivo (.xlsx o .csv)</Label>
        <input
          id="archivo_importacion"
          type="file"
          accept=".xlsx,.csv"
          onChange={alSeleccionarArchivo}
          className="text-sm"
        />
      </div>

      {columnas.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {filas.length} fila(s) detectada(s) en {nombreArchivo}. Asigna cada columna del archivo a un campo:
          </p>
          {[...CAMPOS_REQUERIDOS, ...CAMPOS_OPCIONALES].map((campo) => (
            <div key={campo} className="flex flex-col gap-1">
              <Label htmlFor={`mapeo_${campo}`}>
                {ETIQUETAS[campo]}
                {CAMPOS_REQUERIDOS.includes(campo) && ' *'}
              </Label>
              <select
                id={`mapeo_${campo}`}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={mapeo[campo] ?? ''}
                onChange={(e) =>
                  setMapeo((prev) => ({ ...prev, [campo]: e.target.value || undefined }))
                }
              >
                <option value="">Sin asignar</option>
                {columnas.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {columnas.length > 0 && (
        <Button type="button" onClick={alValidar} disabled={cargando || !mapeoCompleto}>
          {cargando ? 'Validando…' : 'Validar'}
        </Button>
      )}
    </div>
  );
}
