'use client';

import { useState, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { cptable } from 'xlsx/dist/cpexcel.full.mjs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { CampoSuscriptorImportacion, FilaCrudaImportacion, MapeoColumnasImportacion } from '@/lib/api';

// Carga y parseo de .xlsx/.xls/.csv EN EL NAVEGADOR (xlsx/SheetJS) — al Worker
// solo llegan las filas ya parseadas como JSON, nunca el archivo crudo
// (CLAUDE.md §5.5: evita el límite de bundle/memoria/CPU de Cloudflare
// Workers con un archivo grande).
//
// set_cptable una sola vez, a nivel de módulo (investigación de la comunidad,
// docs.sheetjs.com — sin esto, un .csv/.xls con codificación heredada
// (Windows-1252/Latin-1, frecuente en exportes de Excel en Colombia) llega
// con tildes y "ñ" corrompidas): carga la tabla de codepages de SheetJS para
// que XLSX.read decodifique bien texto que no es UTF-8.
XLSX.set_cptable(cptable);

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

const FILAS_PREVIA = 10;

// Heurística de detección de la fila de encabezado (investigación de la
// comunidad, docs.sheetjs.com — la librería no detecta esto sola): una fila
// de título ("ACUEDUCTO XYZ — BASE DE SUSCRIPTORES") suele tener una sola
// celda con contenido; la fila de encabezado real tiene varias. Se ofrece
// como punto de partida razonable, siempre editable por el admin (selector
// de abajo) — nunca se asume en silencio.
function detectarFilaEncabezado(filasPrevia: unknown[][]): number {
  const idx = filasPrevia.findIndex(
    (fila) => fila.filter((celda) => celda !== null && celda !== undefined && celda !== '').length >= 2,
  );
  return idx === -1 ? 0 : idx;
}

function etiquetaFila(fila: unknown[] | undefined, indice: number): string {
  const celdas = (fila ?? []).filter((c) => c !== null && c !== undefined && c !== '').slice(0, 3);
  return `Fila ${indice + 1}${celdas.length ? `: ${celdas.join(' · ')}` : ' (vacía)'}`;
}

interface ImportacionMapeoProps {
  onValidar: (filas: FilaCrudaImportacion[], mapeo: MapeoColumnasImportacion, nombreArchivo: string) => void;
  cargando: boolean;
}

export function ImportacionMapeo({ onValidar, cargando }: ImportacionMapeoProps) {
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [libro, setLibro] = useState<XLSX.WorkBook | null>(null);
  const [nombreHoja, setNombreHoja] = useState('');
  const [previaCruda, setPreviaCruda] = useState<unknown[][]>([]);
  const [filaEncabezado, setFilaEncabezado] = useState(0);
  const [columnas, setColumnas] = useState<string[]>([]);
  const [filas, setFilas] = useState<FilaCrudaImportacion[]>([]);
  const [mapeo, setMapeo] = useState<MapeoColumnasImportacion>({});
  const [error, setError] = useState<string | null>(null);

  // Reconstruye la previa y las filas parseadas para una hoja + fila de
  // encabezado dadas. Se llama al cargar el archivo, al cambiar de hoja
  // (fila de encabezado se recalcula) y al cambiar la fila de encabezado a
  // mano (misma hoja).
  function reconstruir(libroActual: XLSX.WorkBook, hoja: string, filaForzada: number | null) {
    const hojaObjeto = libroActual.Sheets[hoja];
    const crudo = XLSX.utils.sheet_to_json<unknown[]>(hojaObjeto, { header: 1, defval: null });
    const previa = crudo.slice(0, FILAS_PREVIA);
    const filaElegida = filaForzada ?? detectarFilaEncabezado(previa);
    // raw: false (investigación de la comunidad, docs.sheetjs.com) — evita
    // que un numero_documento o codigo_suscriptor largo, que Excel guarda
    // como número, llegue con ceros a la izquierda perdidos o en notación
    // científica: todos los campos de esta importación son texto.
    const filasParseadas = XLSX.utils.sheet_to_json<FilaCrudaImportacion>(hojaObjeto, {
      range: filaElegida,
      raw: false,
      defval: null,
    });
    setPreviaCruda(previa);
    setFilaEncabezado(filaElegida);
    setMapeo({});
    if (filasParseadas.length === 0) {
      setError('La hoja no tiene filas de datos debajo de la fila de encabezado elegida');
      setColumnas([]);
      setFilas([]);
      return;
    }
    setError(null);
    setColumnas(Object.keys(filasParseadas[0]));
    setFilas(filasParseadas);
  }

  async function alSeleccionarArchivo(evento: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const archivo = evento.target.files?.[0];
    if (!archivo) return;
    try {
      const buffer = await archivo.arrayBuffer();
      const libroLeido = XLSX.read(buffer, { type: 'array' });
      if (libroLeido.SheetNames.length === 0) {
        setError('El archivo no tiene ninguna hoja');
        return;
      }
      const primeraHoja = libroLeido.SheetNames[0];
      setLibro(libroLeido);
      setNombreHoja(primeraHoja);
      setNombreArchivo(archivo.name);
      reconstruir(libroLeido, primeraHoja, null);
    } catch {
      setError('No se pudo leer el archivo. Debe ser .xlsx, .xls o .csv válido.');
      setLibro(null);
      setColumnas([]);
      setFilas([]);
    }
  }

  function alCambiarHoja(hoja: string) {
    if (!libro) return;
    setNombreHoja(hoja);
    reconstruir(libro, hoja, null);
  }

  function alCambiarFilaEncabezado(fila: number) {
    if (!libro) return;
    reconstruir(libro, nombreHoja, fila);
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
        <Label htmlFor="archivo_importacion">Archivo (.xlsx, .xls o .csv)</Label>
        <input
          id="archivo_importacion"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={alSeleccionarArchivo}
          className="text-sm"
        />
      </div>

      {libro && libro.SheetNames.length > 1 && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="hoja_importacion">Hoja</Label>
          <select
            id="hoja_importacion"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={nombreHoja}
            onChange={(e) => alCambiarHoja(e.target.value)}
          >
            {libro.SheetNames.map((hoja) => (
              <option key={hoja} value={hoja}>
                {hoja}
              </option>
            ))}
          </select>
        </div>
      )}

      {previaCruda.length > 1 && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="fila_encabezado">Fila de encabezado</Label>
          <select
            id="fila_encabezado"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={filaEncabezado}
            onChange={(e) => alCambiarFilaEncabezado(Number(e.target.value))}
          >
            {previaCruda.map((fila, indice) => (
              <option key={indice} value={indice}>
                {etiquetaFila(fila, indice)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Elegida automáticamente; cambiala si el archivo trae una fila de título antes de la tabla.
          </p>
        </div>
      )}

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
