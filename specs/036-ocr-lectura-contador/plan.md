# PLAN — 036: ocr-lectura-contador

**Spec aprobado:** 2026-09-14

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/package.json` | Modificado | Dependencia nueva `tesseract.js` (Apache-2.0) |
| `frontend/lib/ocr-lectura.ts` | Nuevo | `sugerirLecturaDesdeFoto(imagen)` — preprocesa (escala de grises) y corre Tesseract.js con `tessedit_char_whitelist` a solo dígitos |
| `frontend/components/lector/sugerir-lectura-foto.tsx` | Nuevo | Botón "Sugerir lectura con foto" + aviso de higiene siempre visible + indicador "Leyendo…" |
| `frontend/components/lector/nueva-lectura-lector.tsx` | Modificado | Cablea el componente nuevo; el resultado pre-llena el mismo campo `lecturaActual` que ya existe |

Cero cambios de backend — confirmado en `/specify` (spec §4): todo el OCR corre en el navegador,
ninguna foto ni dato de imagen se envía a ningún servidor.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna — ni nueva ni modificada.

## 4. Contratos de `core/`

Ninguno.

### `frontend/lib/ocr-lectura.ts` — función nueva

```ts
// Preprocesa (escala de grises, único paso — spec §2: OpenCV-level de
// preprocesado es desproporcionado para v1 "mejor esfuerzo") y corre
// Tesseract.js restringido a dígitos. Nunca lanza por un OCR sin resultado:
// devuelve '' (string vacío), el caller decide qué hacer (spec CA-4).
export async function sugerirLecturaDesdeFoto(imagen: File): Promise<string>
```

API real de Tesseract.js v7 (confirmada contra su documentación, no inventada):

```ts
import { createWorker } from 'tesseract.js';

const worker = await createWorker('eng');
await worker.setParameters({ tessedit_char_whitelist: '0123456789' });
const { data: { text } } = await worker.recognize(imagenOCanvas); // acepta File, Blob o canvas
await worker.terminate();
```

Preprocesado (Canvas nativo, sin dependencia nueva): cargar `imagen` en un `<img>` fuera del DOM,
dibujarla en un `<canvas>`, convertir cada píxel a escala de grises (`(r+g+b)/3` o luminancia
estándar), `putImageData` de vuelta, pasar el `canvas` (no el `File` original) a `worker.recognize()`.

`text` se limpia en JavaScript después de `recognize()` (`.replace(/[^0-9]/g, '')`) — red de
seguridad ante el hallazgo de la investigación (spec §2: `tessedit_char_whitelist` puede no
respetarse igual de estricto según el modo del motor).

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Captura de foto vía `<input type="file" accept="image/*" capture="environment">` | Un `<video>` en vivo (como `qr-scanner`, 015) + botón "Tomar foto" que recorta un cuadro con Canvas | El input nativo abre la cámara del sistema operativo directamente, sin código propio de preview/captura — más simple, cero `getUserMedia` nuevo para este flujo, patrón HTML estándar bien soportado en navegadores móviles |
| Preprocesado mínimo: solo escala de grises, en Canvas nativo | Pipeline completo (filtro de mediana, Gaussiano, Canny, Hough — lo que describe la investigación de la comunidad para mejorar precisión real) | Ese pipeline exige OpenCV.js (dependencia pesada, WASM) — desproporcionado para v1 "mejor esfuerzo" (spec §2, decisión de Mateo); la escala de grises es prácticamente gratis y ya ayuda sin sumar una dependencia nueva |
| Limpieza adicional del resultado con una regex de solo dígitos en JavaScript | Confiar únicamente en `tessedit_char_whitelist` | La propia investigación de `/specify` encontró que el whitelist no siempre se respeta igual de estricto según el motor (LSTM vs. legacy) — la regex es la red de seguridad barata que ya se había anotado como mitigación en el spec (§7) |
| Un solo `Worker` de Tesseract, creado y terminado en cada uso (`createWorker`/`terminate` por captura) | Mantener un worker vivo entre lecturas | Este flujo es esporádico (una foto por lectura, no continuo); mantener el worker cargado en memoria todo el tiempo que dura la sesión de AquaLectura no se justifica frente a la simplicidad de crear/destruir por uso |

## 6. Dependencias nuevas

| Paquete | Licencia (confirmada contra el registro de npm) | Uso |
|---|---|---|
| `tesseract.js` | Apache-2.0 | OCR de la foto del contador (§4) |

Cumple CLAUDE.md §2. Verificar en `/implement` el tamaño real que agrega al bundle de `frontend/`
(Tesseract.js carga sus datos de idioma/modelo por separado, no como parte del bundle de JS — no
debería inflar el `First Load JS` de forma notoria, pero se confirma con `npm run build` real).

## 7. Límites de Cloudflare Workers a considerar

No aplica — todo el procesamiento (imagen + OCR) ocurre en el navegador del fontanero, nunca en un
Worker.

## 8. Estrategia de pruebas

`frontend/` no tiene framework de tests unitarios configurado (mismo estado que 015/035) — la
verificación es manual, contra un navegador real, con una foto real:

- **Build/lint/knip:** `npm run build`, `npm run lint`, `npm run knip` limpios en `frontend/`.
- **Manual — sugerencia real (CA-1, CA-2, CA-3):** con una foto de prueba de dígitos claros (aunque
  no sea de un contador real), confirmar que el campo de lectura se pre-llena, que se puede corregir
  libremente, y que el valor guardado es el que quedó en el campo al momento de tocar "Guardar
  lectura" — nunca uno oculto o distinto.
- **Manual — sin resultado (CA-4):** con una foto borrosa o sin números, confirmar que el campo queda
  vacío, sin ningún mensaje de error.
- **Manual — aviso de higiene (CA-5):** confirmar que el texto está visible antes de que se dispare
  la apertura de la cámara del sistema operativo.
- **Manual — sin red (CA-6):** con las DevTools abiertas (pestaña Network) o `wrangler dev` corriendo,
  confirmar que tomar y procesar la foto no genera ninguna petición HTTP nueva.
- **Manual, requiere Mateo:** una foto real de un contador de agua real, para tener una primera
  medida honesta de qué tan útil es la sugerencia en la práctica — el spec ya documenta (§7) que la
  precisión real puede ser baja sin entrenamiento propio; esta prueba no es un criterio de
  aceptación de precisión (no se puede prometer un % dado el estado del arte sin modelo propio), es
  para que Mateo vea el comportamiento real con sus propios ojos.
