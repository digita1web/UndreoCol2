// Lógica de negocio pura de la importación masiva de suscriptores desde
// Excel/CSV: validación de filas requeridas, traducción de categoría tarifaria
// y detección de duplicados DENTRO del archivo recibido. Sin dependencias de
// Hono, Cloudflare ni Supabase (CLAUDE.md §5.3).
// Referencia: specs/012-importacion-suscriptores-excel/plan.md §4 y spec.md §3.2/§3.3.
//
// No sabe nada de formatos de archivo (.xlsx/.csv): recibe filas ya parseadas
// como objetos. La detección de duplicados CONTRA la base (usuarios_servicio
// existentes) no es pura por definición — vive en lib/importacion-suscriptores.ts.

export type CampoSuscriptor =
  | 'codigo_suscriptor' | 'nombre' | 'numero_documento' | 'direccion' | 'categoria'
  | 'tipo_documento' | 'telefono' | 'email' | 'sector' | 'notas';

const CAMPOS_REQUERIDOS: readonly CampoSuscriptor[] = [
  'codigo_suscriptor', 'nombre', 'numero_documento', 'direccion', 'categoria',
];

// Mapeo elegido por el admin: campo de usuarios_servicio → nombre de columna
// del archivo. Las 5 claves requeridas deben estar presentes.
export type MapeoColumnas = Partial<Record<CampoSuscriptor, string>>;

// Una fila cruda tal como la entregó el parser de .xlsx/.csv.
export type FilaCruda = Record<string, string | number | null | undefined>;

export interface FilaNormalizada {
  codigo_suscriptor: string;
  nombre: string;
  numero_documento: string;
  direccion: string;
  categoria: string;
  tipo_documento?: string;
  telefono?: string;
  email?: string;
  sector?: string;
  notas?: string;
}

export interface ErrorFila {
  indiceFila: number;
  motivo: string;
}

export interface ResultadoValidacion {
  validas: Array<{ indiceFila: number; fila: FilaNormalizada }>;
  errores: ErrorFila[];
}

// Tabla de alias fija (plan.md §5): sin Excel real del cliente todavía, una
// tabla configurable en base de datos especularía sobre una necesidad no
// confirmada. Normaliza a minúsculas/sin tildes/sin espacios extra antes de
// buscar, así que las claves de este mapa ya están en esa forma normalizada.
const ALIAS_CATEGORIA: Record<string, string> = {
  'estrato1': 'estrato_1', '1': 'estrato_1',
  'estrato2': 'estrato_2', '2': 'estrato_2',
  'estrato3': 'estrato_3', '3': 'estrato_3',
  'estrato4': 'estrato_4', '4': 'estrato_4',
  'estrato5': 'estrato_5', '5': 'estrato_5',
  'estrato6': 'estrato_6', '6': 'estrato_6',
  'comercial': 'comercial',
  'industrial': 'industrial',
  'oficial': 'oficial',
};

// minúsculas, sin tildes, sin espacios/guiones bajos: "Estrato_3" y "ESTRATO 3"
// y "estrato3" normalizan todos a "estrato3", una sola clave en ALIAS_CATEGORIA.
function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '');
}

// Traduce un valor libre de categoría a categoria_tarifaria, o null si no se
// reconoce (spec §3.2: un valor no reconocido es error de fila, nunca se
// adivina ni se deja en blanco silenciosamente).
export function traducirCategoria(valorLibre: string): string | null {
  return ALIAS_CATEGORIA[normalizar(valorLibre)] ?? null;
}

function textoNoVacio(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const texto = String(v).trim();
  return texto.length > 0 ? texto : null;
}

// CA-1 + CA-2. No lanza: todo error queda en `errores`, ninguna fila con
// problema se cuela como "válida" con datos parciales.
export function validarFilas(filas: FilaCruda[], mapeo: MapeoColumnas): ResultadoValidacion {
  const validas: Array<{ indiceFila: number; fila: FilaNormalizada }> = [];
  const errores: ErrorFila[] = [];

  const codigosVistos = new Set<string>();
  const documentosVistos = new Set<string>();

  filas.forEach((filaCruda, indiceFila) => {
    const valores: Partial<Record<CampoSuscriptor, string>> = {};
    let motivoFaltante: string | null = null;

    for (const campo of CAMPOS_REQUERIDOS) {
      const columna = mapeo[campo];
      const valor = columna ? textoNoVacio(filaCruda[columna]) : null;
      if (!valor) {
        motivoFaltante = `Falta el campo requerido '${campo}'`;
        break;
      }
      valores[campo] = valor;
    }
    if (motivoFaltante) {
      errores.push({ indiceFila, motivo: motivoFaltante });
      return;
    }

    const categoriaTraducida = traducirCategoria(valores.categoria!);
    if (!categoriaTraducida) {
      errores.push({ indiceFila, motivo: `Categoría no reconocida: '${valores.categoria}'` });
      return;
    }

    if (codigosVistos.has(valores.codigo_suscriptor!)) {
      errores.push({ indiceFila, motivo: `codigo_suscriptor duplicado dentro del archivo: '${valores.codigo_suscriptor}'` });
      return;
    }
    if (documentosVistos.has(valores.numero_documento!)) {
      errores.push({ indiceFila, motivo: `numero_documento duplicado dentro del archivo: '${valores.numero_documento}'` });
      return;
    }
    codigosVistos.add(valores.codigo_suscriptor!);
    documentosVistos.add(valores.numero_documento!);

    const fila: FilaNormalizada = {
      codigo_suscriptor: valores.codigo_suscriptor!,
      nombre: valores.nombre!,
      numero_documento: valores.numero_documento!,
      direccion: valores.direccion!,
      categoria: categoriaTraducida,
    };
    for (const campoOpcional of ['tipo_documento', 'telefono', 'email', 'sector', 'notas'] as const) {
      const columna = mapeo[campoOpcional];
      const valor = columna ? textoNoVacio(filaCruda[columna]) : null;
      if (valor) fila[campoOpcional] = valor;
    }

    validas.push({ indiceFila, fila });
  });

  return { validas, errores };
}
