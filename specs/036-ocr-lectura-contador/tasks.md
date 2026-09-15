# TASKS — 036: ocr-lectura-contador

**Plan aprobado:** 2026-09-14

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-001 es para Luna — pegala en una conversación nueva, siempre
después del prompt base de reglas de UndreoCol. T-002 es cierre, no es para Luna.

---

## T-001 — Sugerencia de lectura por foto en "Nueva lectura" (PARA LUNA)

### Objetivo

Agregar un botón "Sugerir lectura con foto" en "Nueva lectura" de AquaLectura que tome una foto con
la cámara nativa, corra OCR de mejor esfuerzo (Tesseract.js, restringido a dígitos) y pre-llene el
campo de lectura ya existente — sin bloquear ni reemplazar el ingreso manual.

### Reglas no negociables de este proyecto (léelas antes de escribir una línea)

- **El valor sugerido nunca se guarda automáticamente.** Solo pre-llena el `<input>` de lectura ya
  existente (`value={lecturaActual}`); el fontanero sigue tocando "Guardar lectura" para confirmar,
  exactamente igual que si lo hubiera tipeado a mano. No inventes ningún atajo que salte ese paso.
- **Cero llamadas nuevas al backend.** Todo el procesamiento de la foto ocurre en el navegador.
- Un OCR sin resultado deja el campo vacío, **sin ningún mensaje de error** — no es un fallo.
- Nada de `console.log`. TypeScript estricto, nada de `any`.
- No toques `EscanerQrContador`, `crearLectura`, ni la validación del formulario (`alGuardar`).

### Dependencia nueva — agregar a `frontend/package.json`, bloque `"dependencies"`

```json
"tesseract.js": "^7.0.0",
```

Licencia Apache-2.0, confirmada contra el registro de npm — cumple CLAUDE.md §2.

### API real de la librería (así se usa, no inventes otra firma)

```ts
import { createWorker } from 'tesseract.js';

const worker = await createWorker('eng');
await worker.setParameters({ tessedit_char_whitelist: '0123456789' }); // restringe a dígitos
const { data } = await worker.recognize(imagenOCanvas); // acepta File, Blob o HTMLCanvasElement
console.log(data.text); // el texto reconocido
await worker.terminate(); // libera el worker
```

### Archivo nuevo: `frontend/lib/ocr-lectura.ts`

```ts
import { createWorker } from 'tesseract.js';

// Preprocesado mínimo (plan §5: OpenCV.js es desproporcionado para v1 "mejor
// esfuerzo") — solo escala de grises, con Canvas nativo, sin dependencia
// nueva para esto.
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
    // Red de seguridad (plan §4/CLAUDE.md §3): el whitelist no siempre se
    // respeta igual de estricto según el modo del motor — se filtra de nuevo
    // el resultado acá, nunca se confía ciegamente en el whitelist solo.
    return data.text.replace(/[^0-9]/g, '');
  } catch (e) {
    console.error('ocr-lectura: no se pudo procesar la foto', e);
    return '';
  }
}
```

### Componente nuevo: `frontend/components/lector/sugerir-lectura-foto.tsx`

```tsx
'use client';

import { useRef, useState } from 'react';
import { sugerirLecturaDesdeFoto } from '@/lib/ocr-lectura';

interface SugerirLecturaFotoProps {
  onSugerida: (valor: string) => void;
}

// 036: el aviso de higiene está siempre visible (CA-5) — se ve antes de que
// se dispare la cámara nativa del sistema operativo, no es un popup aparte
// que haya que cerrar.
export function SugerirLecturaFoto({ onSugerida }: SugerirLecturaFotoProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [procesando, setProcesando] = useState(false);

  async function alElegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite elegir la misma foto de nuevo después
    if (!archivo) return;
    setProcesando(true);
    try {
      const valor = await sugerirLecturaDesdeFoto(archivo);
      if (valor) onSugerida(valor);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        Limpiá el visor del contador antes de tomar la foto, para mejor precisión.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={alElegirFoto}
      />
      <button
        type="button"
        className="h-11 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
        disabled={procesando}
        onClick={() => inputRef.current?.click()}
      >
        {procesando ? 'Leyendo…' : 'Sugerir lectura con foto'}
      </button>
    </div>
  );
}
```

`capture="environment"` abre la cámara trasera del celular directamente vía el selector nativo del
sistema operativo — no se implementa ningún `getUserMedia`/`<video>` propio para esto (distinto del
flujo de QR de 015, que sí necesita video en vivo).

### `frontend/components/lector/nueva-lectura-lector.tsx` — archivo completo tal cual está hoy

```tsx
'use client';

import { useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EscanerQrContador } from '@/components/lector/escaner-qr-contador';
import { crearLectura, type Suscriptor } from '@/lib/api';

interface NuevaLecturaLectorProps {
  suscriptores: Suscriptor[] | null;
  periodoAbiertoId: string | null;
  onCreada: () => void;
}

export function NuevaLecturaLector({ suscriptores, periodoAbiertoId, onCreada }: NuevaLecturaLectorProps) {
  const [contadorSel, setContadorSel] = useState('');
  const [lecturaActual, setLecturaActual] = useState('');
  const [fechaLectura, setFechaLectura] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const hidratado = useHidratado();

  const contadores = (suscriptores ?? [])
    .filter((s) => s.contador_actual_id)
    .map((s) => ({ id: s.contador_actual_id!, nombre: s.nombre, codigo: s.codigo_suscriptor }));

  function alDecodificarQr(texto: string) {
    const match = contadores.find((c) => c.id === texto);
    setEscaneando(false);
    if (!match) {
      setError('Este código no corresponde a ningún contador de tu acueducto.');
      return;
    }
    setError(null);
    setContadorSel(match.id);
  }

  async function alGuardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    const valor = Number(lecturaActual);
    if (!contadorSel || !periodoAbiertoId || !fechaLectura || Number.isNaN(valor)) {
      setError('Elegí un suscriptor, una fecha y la lectura del contador.');
      return;
    }
    setGuardando(true);
    try {
      await crearLectura({
        contador_id: contadorSel,
        periodo_id: periodoAbiertoId,
        fecha_lectura: fechaLectura,
        lectura_actual: valor,
      });
      setLecturaActual('');
      setAviso('Lectura guardada.');
      onCreada();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la lectura');
    } finally {
      setGuardando(false);
    }
  }

  if (!periodoAbiertoId) {
    return <p className="text-sm text-muted-foreground">No hay un periodo abierto para tomar lecturas todavía.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nueva lectura</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={alGuardar}>
          {escaneando ? (
            <EscanerQrContador onDecodificado={alDecodificarQr} onCerrar={() => setEscaneando(false)} />
          ) : (
            <>
              <select
                className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                value={contadorSel}
                onChange={(e) => setContadorSel(e.target.value)}
              >
                <option value="">Elegí el suscriptor…</option>
                {contadores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.codigo})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="h-11 rounded-md border border-border text-sm font-medium hover:bg-muted"
                onClick={() => setEscaneando(true)}
              >
                Escanear QR
              </button>
            </>
          )}
          <input
            type="date"
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            value={fechaLectura}
            onChange={(e) => setFechaLectura(e.target.value)}
          />
          <input
            type="number"
            inputMode="decimal"
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Lectura actual (m³)"
            value={lecturaActual}
            onChange={(e) => setLecturaActual(e.target.value)}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {aviso && <p className="text-sm text-green-700">{aviso}</p>}
          <button
            className="h-11 rounded-md bg-green-600 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            disabled={!hidratado || guardando}
          >
            {guardando ? 'Guardando…' : 'Guardar lectura'}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
```

**Cambios a hacer:**
1. Import nuevo: `import { SugerirLecturaFoto } from '@/components/lector/sugerir-lectura-foto';`.
2. Agregar `<SugerirLecturaFoto onSugerida={(v) => setLecturaActual(v)} />` **justo después** del
   `<input type="number">` de lectura actual (antes de los mensajes de error/aviso) — para que quede
   claro que sugiere el valor de ese mismo campo, no uno aparte.
3. No toques nada del bloque `escaneando ? ... : ...` del QR (015) — el botón nuevo va siempre
   visible, no depende de ese estado.

### Qué NO hacer

- No agregues ningún `<video>`/`getUserMedia` propio para esta feature — el `<input
  type="file" capture="environment">` ya resuelve la captura.
- No muestres el valor sugerido en un campo separado de solo lectura — tiene que pre-llenar el mismo
  `<input>` de lectura que ya existe.
- No agregues ningún mensaje de error cuando el OCR no encuentra nada — el campo simplemente queda
  como estaba.
- No inventes un flujo de reintento automático — un solo intento por foto (plan §4, decisión ya
  tomada).

### Formato de entrega esperado de Luna

`frontend/package.json` (solo la línea agregada, con contexto suficiente para ubicarla),
`frontend/lib/ocr-lectura.ts` completo (nuevo),
`frontend/components/lector/sugerir-lectura-foto.tsx` completo (nuevo),
`frontend/components/lector/nueva-lectura-lector.tsx` completo (con el cambio). Al final, la sección
"Asunciones sin verificar" de tu prompt base.

---

## T-002 — Cierre: verificación real, especificación funcional, CHANGELOG (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `docs/ESPECIFICACION-FUNCIONAL.md` (§2.14.1: la parte de OCR pasa de "sin empezar" a
implementada, mejor esfuerzo v1), `CHANGELOG.md`.

**Verificación real:**
```
cd frontend && npm run build && npm run lint && npm run knip
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
```
Backend se corre igual para confirmar que de verdad no se tocó (spec §4, cero backend).

Más, verificación manual real (no alcanza con build/lint para una feature de cámara/imagen):
1. `grep` confirmando cero peticiones HTTP nuevas asociadas a este flujo (CA-6) — inspección del
   código, no solo de la red.
2. Con una foto de prueba de dígitos claros (aunque no sea de un contador real): confirmar que el
   campo de lectura se pre-llena (CA-1), que se puede corregir libremente (CA-2), y que el valor
   guardado es el que quedó en el campo al tocar "Guardar lectura" (CA-3).
3. Con una foto borrosa o sin números: el campo queda vacío, sin mensaje de error (CA-4).
4. Confirmar que el aviso de higiene está visible antes de que se dispare la cámara (CA-5).
5. Si es posible conseguir una foto real de un contador de agua: probarla y anotar el resultado real
   (no es un criterio de aceptación de precisión — el spec ya documenta que no se puede prometer un
   % dado el estado del arte sin modelo propio — es para que quede registrado qué tan útil es en la
   práctica).

**CA-1, CA-4 y CA-5 — verificados con Playwright + Chromium real** (instalado en este entorno
específicamente para esto, no estaba disponible al cerrar la tarea originalmente). Metodología:
`app/test-036-temporal/` (ruta temporal, nunca commiteada, borrada al terminar) renderizando
`SugerirLecturaFoto` real sin cambios, contra `npm run dev` real. Con una imagen generada con
PIL (dígitos "012345" en fuente clara, sin ser una foto de contador real — exactamente lo que el
propio spec permite para la prueba automatizada, §6 CA-1), Tesseract.js leyó **"012345", exacto**.
Con la misma imagen desenfocada (`GaussianBlur`), el campo quedó vacío, sin mensaje de error. El
aviso de higiene se confirmó visible en el DOM antes de cualquier interacción. Detalle, script y
log completo en `CHANGELOG.md` de esta sesión.

**Seguimos sin verificar con Playwright (queda como razonamiento de código, no evidencia de
navegador):** CA-2 (que el valor se pueda corregir libremente) y CA-3 (que se guarde el valor
corregido, no el sugerido) — el campo es un `<input>` controlado normal, nunca `readOnly`, y
`alGuardar` siempre lee `lecturaActual` del estado en el momento de enviar, no un valor cacheado
del OCR; no cambió respecto al comportamiento anterior a 036. **NO VERIFICADO — requiere Mateo:**
una foto real de un contador de agua real, en un celular Android real — la única prueba que este
entorno no puede simular con evidencia honesta, sea cual sea el tooling.

**Estado:** HECHO — Sesión 056. T-001 implementado directamente por Claude (autorización expresa de
Mateo, no pasó por Luna esta vez). T-002 cerrado: build/lint/knip/tests/dry-run en verde, CA-3
(dedup)/CA-5(036 original, higiene)/CA-6 verificados por código + grep en su momento, y ahora
CA-1/CA-4/CA-5 además con Playwright real. `docs/ESPECIFICACION-FUNCIONAL.md` y `CHANGELOG.md`
actualizados. Solo la foto real de un contador con Mateo queda pendiente.
