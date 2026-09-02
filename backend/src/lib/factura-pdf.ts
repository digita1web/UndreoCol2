// Generación del PDF adjunto de la factura con pdf-lib (decisión D-9).
// Plantilla programática (posiciones de texto, desglose) — NO pdfme, NO editor
// visual, NO Chromium (CLAUDE.md §6/§12).
// Personalización por acueducto (análogo al Print Format de Frappe): logo (si
// clientes.logo_url lo tiene) y datos del acueducto desde la tabla clientes.
// Referencia: specs/006-impresion-y-correo-factura/plan.md §4.

import { PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib';
import type { DetalleFacturaRow, FacturaRow } from './facturacion';

export interface DatosAcueductoPdf {
  nombre: string;
  nit: string | null;
  direccion: string | null;
  telefono: string | null;
  municipio: string | null;
  logoUrl: string | null;
}

function formatoPeso(valor: number): string {
  return `$${Math.round(valor).toLocaleString('es-CO')}`;
}

// Carga el logo (PNG o JPG) si hay URL descargable; si no devuelve null (el PDF
// nunca falla por el logo).
async function cargarLogo(
  pdf: PDFDocument,
  logoUrl: string | null,
): Promise<{ img: PDFImage; x: number; ancho: number } | null> {
  if (!logoUrl) return null;
  try {
    const respuesta = await fetch(logoUrl);
    if (!respuesta.ok) return null;
    const bytes = await respuesta.arrayBuffer();
    let img: PDFImage;
    try {
      img = await pdf.embedPng(bytes);
    } catch {
      img = await pdf.embedJpg(bytes);
    }
    const alto = 55;
    const ancho = (img.width / img.height) * alto;
    return { img, x: 50, ancho: Math.min(ancho, 120) };
  } catch {
    return null; // el logo es decorativo; nunca rompe la generación
  }
}

export async function generarPdfFactura(input: {
  factura: FacturaRow;
  detalles: DetalleFacturaRow[];
  acueducto: DatosAcueductoPdf;
}): Promise<Uint8Array> {
  const { factura, detalles, acueducto } = input;
  const snap = factura.snapshot_suscriptor as Record<string, string>;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Factura ${factura.numero}`);
  const pagina = pdf.addPage([612, 792]); // carta
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const colorTexto = rgb(0.15, 0.15, 0.15);
  const colorAcento = rgb(0.08, 0.25, 0.55);
  const colorGris = rgb(0.45, 0.45, 0.45);

  // ---- encabezado del acueducto (personalización) --------------------------
  const logo = await cargarLogo(pdf, acueducto.logoUrl);
  const xTexto = logo ? logo.x + logo.ancho + 10 : 50;
  let y = 745;
  if (logo) {
    pagina.drawImage(logo.img, { x: logo.x, y: y - 55, width: logo.ancho, height: 55 });
  }
  pagina.drawText(acueducto.nombre, { x: xTexto, y, size: 20, font: helveticaBold, color: colorAcento });
  y -= 18;
  const linea1 = [
    acueducto.nit ? `NIT: ${acueducto.nit}` : '',
    acueducto.municipio ?? '',
    acueducto.telefono ? `Tel: ${acueducto.telefono}` : '',
  ].filter(Boolean).join(' · ');
  if (linea1) {
    pagina.drawText(linea1, { x: xTexto, y, size: 9, font: helvetica, color: colorTexto });
    y -= 13;
  }
  if (acueducto.direccion) {
    pagina.drawText(acueducto.direccion, { x: xTexto, y, size: 9, font: helvetica, color: colorGris });
  }

  // ---- título y datos de la factura ----------------------------------------
  y = 640;
  pagina.drawText(`FACTURA ${factura.numero}`, { x: 50, y, size: 15, font: helveticaBold, color: colorTexto });
  y -= 20;
  const lineasFactura: Array<[string, string]> = [
    ['Emitida:', factura.fecha_emision],
    ['Vence:', factura.fecha_vencimiento],
    ['Suscriptor:', snap.nombre ?? ''],
    ['Codigo:', snap.codigo_suscriptor ?? ''],
    ['Direccion:', snap.direccion ?? ''],
    ['Categoria:', snap.categoria ?? ''],
  ];
  for (const [etiqueta, valor] of lineasFactura) {
    if (!valor) continue;
    pagina.drawText(etiqueta, { x: 50, y, size: 9, font: helveticaBold, color: colorTexto });
    pagina.drawText(valor, { x: 140, y, size: 9, font: helvetica, color: colorTexto });
    y -= 14;
  }

  // ---- desglose por servicio ----------------------------------------------
  y -= 10;
  pagina.drawText('DESGLOSE POR SERVICIO', { x: 50, y, size: 10, font: helveticaBold, color: colorTexto });
  y -= 6;
  pagina.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.6, color: colorGris });
  y -= 16;

  for (const d of detalles) {
    const consumo = d.tipo_calculo === 'por_consumo'
      ? `${d.consumo_basico_m3} m3 basico + ${d.consumo_no_basico_m3} m3 no basico`
      : 'cargo fijo';
    pagina.drawText(d.descripcion, { x: 52, y, size: 9, font: helveticaBold, color: colorTexto });
    pagina.drawText(formatoPeso(d.subtotal), { x: 470, y, size: 9, font: helveticaBold, color: colorTexto });
    y -= 12;
    pagina.drawText(consumo, { x: 52, y, size: 8, font: helvetica, color: colorGris });
    y -= 14;
  }

  // ---- totales -------------------------------------------------------------
  y -= 4;
  pagina.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 0.6, color: colorGris });
  y -= 16;
  const totales: Array<[string, number, boolean]> = [
    ['Subtotal servicios', factura.subtotal_servicios, false],
    ['Recargo mora', factura.recargo_mora, false],
    ['Saldo anterior', factura.saldo_anterior, false],
    ['TOTAL', factura.total, true],
  ];
  for (const [etiqueta, valor, esTotal] of totales) {
    pagina.drawText(etiqueta, { x: 340, y, size: esTotal ? 12 : 10, font: helveticaBold, color: colorTexto });
    pagina.drawText(formatoPeso(valor), {
      x: 500,
      y,
      size: esTotal ? 12 : 10,
      font: esTotal ? helveticaBold : helvetica,
      color: esTotal ? colorAcento : colorTexto,
    });
    y -= esTotal ? 18 : 14;
  }

  // ---- pie -----------------------------------------------------------------
  pagina.drawText('Generado por UndreoCol', { x: 50, y: 30, size: 7, font: helvetica, color: colorGris });

  return pdf.save();
}

