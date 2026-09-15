import { createWorker } from 'tesseract.js';

// Preprocesado mínimo (036 plan §5: OpenCV.js es desproporcionado para v1
// "mejor esfuerzo") — solo escala de grises, con Canvas nativo, sin
// dependencia nueva para esto.
async function aCanvasEnGrises(imagen: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(imagen);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen');
  ctx.drawImage(bitmap, 0, 0);
  const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < datos.data.length; i += 4) {
    const gris = (datos.data[i] + datos.data[i + 1] + datos.data[i + 2]) / 3;
    datos.data[i] = gris;
    datos.data[i + 1] = gris;
    datos.data[i + 2] = gris;
  }
  ctx.putImageData(datos, 0, 0);
  return canvas;
}

// Sugiere una lectura a partir de una foto — mejor esfuerzo (036 spec §2):
// nunca lanza, string vacío si no hay resultado usable (CA-4).
export async function sugerirLecturaDesdeFoto(imagen: File): Promise<string> {
  try {
    const canvas = await aCanvasEnGrises(imagen);
    const worker = await createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
    const { data } = await worker.recognize(canvas);
    await worker.terminate();
    // Red de seguridad (036 plan §4/CLAUDE.md §3): el whitelist no siempre se
    // respeta igual de estricto según el modo del motor — se filtra de nuevo
    // el resultado acá, nunca se confía ciegamente en el whitelist solo.
    return data.text.replace(/[^0-9]/g, '');
  } catch (e) {
    console.error('ocr-lectura: no se pudo procesar la foto', e);
    return '';
  }
}
