import { describe, expect, it } from 'vitest';
import { traducirCategoria, validarFilas, type MapeoColumnas } from '../../src/core/importacion-suscriptores';

const MAPEO_COMPLETO: MapeoColumnas = {
  codigo_suscriptor: 'Codigo',
  nombre: 'Nombre',
  numero_documento: 'Documento',
  direccion: 'Direccion',
  categoria: 'Estrato',
  telefono: 'Telefono',
};

function filaValida(overrides: Record<string, string> = {}) {
  return {
    Codigo: 'A-001',
    Nombre: 'Suscriptor A1',
    Documento: '1000000001',
    Direccion: 'Calle 1 # 1-01',
    Estrato: '3',
    Telefono: '3000000001',
    ...overrides,
  };
}

describe('traducirCategoria', () => {
  it('reconoce variantes de estrato con espacio, guión bajo y sin nada', () => {
    expect(traducirCategoria('Estrato 3')).toBe('estrato_3');
    expect(traducirCategoria('estrato_3')).toBe('estrato_3');
    expect(traducirCategoria('ESTRATO3')).toBe('estrato_3');
    expect(traducirCategoria('3')).toBe('estrato_3');
  });

  it('reconoce las categorías no residenciales sin importar mayúsculas', () => {
    expect(traducirCategoria('Comercial')).toBe('comercial');
    expect(traducirCategoria('INDUSTRIAL')).toBe('industrial');
    expect(traducirCategoria('oficial')).toBe('oficial');
  });

  it('devuelve null para un valor no reconocido', () => {
    expect(traducirCategoria('Estrato 7')).toBeNull();
    expect(traducirCategoria('residencial')).toBeNull();
    expect(traducirCategoria('')).toBeNull();
  });
});

describe('validarFilas', () => {
  it('acepta una fila válida completa (caso feliz)', () => {
    const r = validarFilas([filaValida()], MAPEO_COMPLETO);
    expect(r.errores).toHaveLength(0);
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]?.fila).toEqual({
      codigo_suscriptor: 'A-001',
      nombre: 'Suscriptor A1',
      numero_documento: '1000000001',
      direccion: 'Calle 1 # 1-01',
      categoria: 'estrato_3',
      telefono: '3000000001',
    });
  });

  it('archivo sin filas: ningún error, ninguna válida', () => {
    const r = validarFilas([], MAPEO_COMPLETO);
    expect(r.validas).toHaveLength(0);
    expect(r.errores).toHaveLength(0);
  });

  for (const campo of ['Codigo', 'Nombre', 'Documento', 'Direccion', 'Estrato'] as const) {
    it(`rechaza fila con '${campo}' vacío`, () => {
      const r = validarFilas([filaValida({ [campo]: '' })], MAPEO_COMPLETO);
      expect(r.validas).toHaveLength(0);
      expect(r.errores).toHaveLength(1);
      expect(r.errores[0]?.motivo).toContain('Falta el campo requerido');
    });
  }

  it('rechaza categoría no reconocida', () => {
    const r = validarFilas([filaValida({ Estrato: 'Estrato 9' })], MAPEO_COMPLETO);
    expect(r.validas).toHaveLength(0);
    expect(r.errores[0]?.motivo).toContain('Categoría no reconocida');
  });

  it('detecta codigo_suscriptor duplicado dentro del archivo', () => {
    const r = validarFilas(
      [filaValida(), filaValida({ Documento: '1000000002' })],
      MAPEO_COMPLETO,
    );
    expect(r.validas).toHaveLength(1);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.indiceFila).toBe(1);
    expect(r.errores[0]?.motivo).toContain('codigo_suscriptor duplicado');
  });

  it('detecta numero_documento duplicado dentro del archivo', () => {
    const r = validarFilas(
      [filaValida(), filaValida({ Codigo: 'A-002' })],
      MAPEO_COMPLETO,
    );
    expect(r.validas).toHaveLength(1);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.indiceFila).toBe(1);
    expect(r.errores[0]?.motivo).toContain('numero_documento duplicado');
  });

  it('un campo opcional sin mapear simplemente no aparece en la fila normalizada', () => {
    const mapeoSinTelefono: MapeoColumnas = { ...MAPEO_COMPLETO };
    delete mapeoSinTelefono.telefono;
    const r = validarFilas([filaValida()], mapeoSinTelefono);
    expect(r.validas[0]?.fila.telefono).toBeUndefined();
  });

  it('filas independientes: un error en una fila no descarta las demás', () => {
    const r = validarFilas(
      [filaValida(), filaValida({ Codigo: 'A-002', Documento: '', })],
      MAPEO_COMPLETO,
    );
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0]?.indiceFila).toBe(0);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.indiceFila).toBe(1);
  });
});
