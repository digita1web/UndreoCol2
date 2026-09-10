import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { inflateSync } from 'zlib';
import { generarPdfFactura } from '../../src/lib/factura-pdf';
import type { DatosAcueductoPdf } from '../../src/lib/factura-pdf';
import type { DetalleFacturaRow, FacturaRow } from '../../src/lib/facturacion';

const acueducto: DatosAcueductoPdf = {
  nombre: 'Acueducto Ejemplo',
  nit: '900.000.000-1',
  direccion: 'Calle 1 # 1-01',
  telefono: '300 000 0000',
  municipio: 'Soacha',
  logoUrl: null,
  colorAcento: '#14408C',
};

const factura: FacturaRow = {
  id: 'ff000000-0000-0000-0000-0000000000a1',
  cliente_id: 'a0000000-0000-0000-0000-000000000001',
  usuario_servicio_id: 'd0000000-0000-0000-0000-0000000000a1',
  periodo_id: 'e0000000-0000-0000-0000-0000000000a1',
  tipo: 'ciclo',
  numero: 'FAC-2026-00001',
  snapshot_suscriptor: {
    nombre: 'Suscriptor A1',
    codigo_suscriptor: 'A-001',
    categoria: 'estrato_3',
    direccion: 'Calle 1 # 1-01',
    estado: 'activo',
  },
  consumo_m3: 25,
  subtotal_servicios: 38600,
  recargo_mora: 0,
  saldo_anterior: 0,
  total: 38600,
  total_pagado: 0,
  fecha_emision: '2026-09-02',
  fecha_vencimiento: '2026-10-02',
  estado: 'pendiente',
  motivo_anulacion: null,
  anulada_por: null,
};

const detalle: DetalleFacturaRow = {
  id: 'dd000000-0000-0000-0000-000000000001',
  factura_id: factura.id,
  servicio_id: 'f0000000-0000-0000-0000-0000000000a1',
  tarifa_id: '90000000-0000-0000-0000-0000000000a1',
  orden: 1,
  descripcion: 'Acueducto',
  tipo_calculo: 'por_consumo',
  consumo_m3: 25,
  cargo_fijo: 5000,
  consumo_basico_m3: 22,
  valor_basico: 26400,
  consumo_no_basico_m3: 3,
  valor_no_basico: 7200,
  subtotal: 38600,
};

// Extrae el contenido de los streams del PDF: pdf-lib no expone un extractor de
// texto. Se leen los bloques /stream..endstream (descomprimiendo con zlib si es
// Flate) y se decodifican los strings hex `<...>` (WinAnsi) que pdf-lib usa en
// los operadores de texto. Evidencia real de numero/total/desglose.
function decodificarHex(texto: string): string {
  return texto.replace(/<([0-9A-Fa-f\s]+)>/g, (_t, hex: string) => {
    const limpio = hex.replace(/\s/g, '');
    const bytes = Buffer.from(limpio, 'hex');
    return bytes.toString('latin1');
  });
}

function textoDelPdf(bytes: Uint8Array): string {
  const crudo = Buffer.from(bytes).toString('latin1');
  const trozos: string[] = [];
  const regex = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(crudo)) !== null) {
    const stream = Buffer.from(match[1] ?? '', 'latin1');
    try {
      trozos.push(inflateSync(stream).toString('latin1'));
    } catch {
      trozos.push(stream.toString('latin1')); // stream sin comprimir (pdf-lib)
    }
  }
  return decodificarHex(trozos.join('\n'));
}

describe('generarPdfFactura (pdf-lib, D-9)', () => {
  it('devuelve un PDF válido con una página', async () => {
    const bytes = await generarPdfFactura({ factura, detalles: [detalle], acueducto });
    // cabecera %PDF
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    // se puede reabrir con pdf-lib y tiene 1 página
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('el contenido incluye el numero, el total, el suscriptor y el desglose', async () => {
    const bytes = await generarPdfFactura({ factura, detalles: [detalle], acueducto });
    const texto = textoDelPdf(bytes);
    expect(texto).toContain('FAC-2026-00001');
    expect(texto).toContain('Suscriptor A1');
    expect(texto).toContain('Acueducto'); // desglose del servicio
    expect(texto).toContain('$38.600'); // total (es-CO con separador de miles)
  });

  it('incluye los datos del acueducto (personalización por cliente)', async () => {
    const bytes = await generarPdfFactura({ factura, detalles: [detalle], acueducto });
    const texto = textoDelPdf(bytes);
    expect(texto).toContain('Acueducto Ejemplo');
    expect(texto).toContain('900.000.000-1');
  });

  it('sin logo (logoUrl null) genera igual sin romper', async () => {
    await expect(generarPdfFactura({ factura, detalles: [detalle], acueducto })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('dos acueductos con color_acento distinto producen PDF con bytes distintos (023)', async () => {
    const acueductoRojo: DatosAcueductoPdf = { ...acueducto, colorAcento: '#FF0000' };
    const bytesAzul = await generarPdfFactura({ factura, detalles: [detalle], acueducto });
    const bytesRojo = await generarPdfFactura({ factura, detalles: [detalle], acueducto: acueductoRojo });
    expect(Buffer.from(bytesAzul).equals(Buffer.from(bytesRojo))).toBe(false);
  });

  it('un color de acento inválido lanza en vez de generar un PDF con datos corruptos', async () => {
    const acueductoInvalido: DatosAcueductoPdf = { ...acueducto, colorAcento: 'no-es-un-color' };
    await expect(
      generarPdfFactura({ factura, detalles: [detalle], acueducto: acueductoInvalido }),
    ).rejects.toThrow(/inválido/);
  });
});
