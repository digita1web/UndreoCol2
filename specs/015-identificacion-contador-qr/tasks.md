# TASKS — 015: identificacion-contador-qr

**Plan aprobado:** 2026-09-13

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-001 y T-002 son para Luna — pegalas en conversaciones
nuevas, siempre después del prompt base de reglas de UndreoCol. **No dependen entre sí** (a
diferencia de otras features): T-001 es la ficha del suscriptor (admin/secretaria), T-002 es
"Nueva lectura" del lector — podés pegarlas en cualquier orden, o cada una en su propia
conversación con Luna. T-003 es cierre, no es para Luna — esta feature usa la cámara del navegador,
algo que no se puede verificar con mocks ni en este entorno (sin Chromium/cámara real): la
verificación real de T-003 queda parcialmente en NO VERIFICADO, con los pasos exactos para Mateo.

---

## T-001 — Ver e imprimir la etiqueta QR de un contador (PARA LUNA)

### Objetivo

En la ficha del suscriptor, agregar un botón "Ver etiqueta QR" en la tarjeta "Contador" que muestre
el código QR de ese contador (codifica su `id`, no su `serial`) más el `serial` en texto legible, con
corrección de errores nivel `H`, y que se pueda imprimir con `Ctrl+P` mostrando solo la etiqueta.

### Reglas no negociables de este proyecto (léelas antes de escribir una línea)

- El QR codifica `contador.id` (el UUID), **nunca** `contador.serial` — el `serial` solo es único
  dentro de un mismo acueducto, el `id` es único globalmente.
- `errorCorrectionLevel: 'H'` explícito al generar el QR — no dejar el valor por defecto de la
  librería (que es `M`).
- Nada de `console.log`. TypeScript estricto, nada de `any`.
- No toques `ContadorForm` ni `ReemplazoContadorForm` — sin cambios, siguen exactamente igual.
- No inventes ninguna ruta de backend nueva — el `id` y el `serial` del contador ya están en el
  estado `contador` de la página (ver abajo), no hace falta pedir nada al servidor.

### Dependencia nueva — agregar a `frontend/package.json`, bloque `"dependencies"` (no
`"devDependencies"`, se usa en producción)

```json
"qrcode": "^1.5.4",
```

Licencia MIT, confirmada contra el registro de npm — cumple CLAUDE.md §2.

### API real de la librería (así se usa, no inventes otra firma)

```ts
import QRCode from 'qrcode';

// Dibuja el QR directamente en un <canvas> ya montado:
QRCode.toCanvas(
  canvasElement, // HTMLCanvasElement
  'texto-a-codificar',
  { errorCorrectionLevel: 'H' },
  (err) => {
    if (err) console.error('No se pudo generar el QR', err);
  },
);
```

En React: guardá una referencia al `<canvas>` con `useRef<HTMLCanvasElement>(null)` y llamá a
`QRCode.toCanvas` dentro de un `useEffect` que dependa del texto a codificar (el `id` del contador).

### Componente nuevo: `frontend/components/etiqueta-qr-contador.tsx`

```tsx
'use client';

import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import type { Contador } from '@/lib/api';

interface EtiquetaQrContadorProps {
  contador: Contador;
}

// 015: el QR codifica el `id` del contador (único globalmente), no el `serial`
// (único solo dentro de un mismo acueducto). Nivel de corrección de errores H
// (~30% de daño tolerado) — recomendación de la comunidad para etiquetas
// industriales sucias/rayadas/a la intemperie (spec §3.1), no el valor por
// defecto de la librería.
export function EtiquetaQrContador({ contador }: EtiquetaQrContadorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, contador.id, { errorCorrectionLevel: 'H' }, (err) => {
      if (err) console.error('etiqueta-qr-contador: no se pudo generar el QR', err);
    });
  }, [contador.id]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-6">
      <canvas ref={canvasRef} />
      <p className="font-mono text-sm">Serial: {contador.serial}</p>
      <Button className="print:hidden" onClick={() => window.print()}>
        Imprimir etiqueta
      </Button>
    </div>
  );
}
```

### `frontend/app/app/suscriptores/[id]/page.tsx` — archivo completo tal cual está hoy

```tsx
'use client';

import { use, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContadorForm } from '@/components/contador-form';
import { ReemplazoContadorForm } from '@/components/reemplazo-contador-form';
import { CorteForm } from '@/components/corte-form';
import { ReconexionForm } from '@/components/reconexion-form';
import {
  historialCortes,
  matrizTarifas,
  obtenerContextoUsuario,
  obtenerSuscriptor,
  regenerarCodigoSuscriptor,
  type Contador,
  type EventoCorte,
  type ReemplazoContador,
  type Suscriptor,
} from '@/lib/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DetalleSuscriptorPage({ params }: PageProps) {
  const { id } = use(params);
  const [suscriptor, setSuscriptor] = useState<Suscriptor | null>(null);
  const [contador, setContador] = useState<Contador | null>(null);
  const [reemplazos, setReemplazos] = useState<ReemplazoContador[]>([]);
  const [historialEventos, setHistorialEventos] = useState<EventoCorte[]>([]);
  const [sinTarifaConfigurada, setSinTarifaConfigurada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rol, setRol] = useState<string | null>(null);

  function recargar() {
    setError(null);
    obtenerSuscriptor(id)
      .then((r) => {
        setSuscriptor(r.suscriptor);
        setContador(r.contador);
        setReemplazos(r.reemplazos);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el suscriptor'));
    historialCortes(id)
      .then((r) => setHistorialEventos(r.historial))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el historial de cortes'));
  }

  async function alRegenerarCodigo() {
    if (!suscriptor) return;
    const codigoNuevo = window.prompt('Nuevo código de suscriptor para el portal:');
    if (!codigoNuevo?.trim()) return;
    if (!window.confirm(`¿Cambiar el código de ${suscriptor.nombre} a "${codigoNuevo.trim()}"? El código anterior dejará de servir.`)) return;
    setError(null);
    setAviso(null);
    try {
      await regenerarCodigoSuscriptor(suscriptor.id, codigoNuevo.trim());
      setAviso(`Código actualizado a "${codigoNuevo.trim()}". El anterior ya no sirve para ingresar al portal.`);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo regenerar el código');
    }
  }

  useEffect(recargar, [id]);

  useEffect(() => {
    obtenerContextoUsuario()
      .then((r) => setRol(r.cliente.rol))
      .catch(() => setRol('admin_acueducto'));
  }, []);

  useEffect(() => {
    if (!suscriptor?.categoria) return;
    matrizTarifas()
      .then((r) => {
        const tieneAlguna = r.matriz.some((f) => f.categoria === suscriptor.categoria && f.tarifa_id !== null);
        setSinTarifaConfigurada(!tieneAlguna);
      })
      .catch(() => setSinTarifaConfigurada(false));
  }, [suscriptor?.categoria]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{suscriptor?.nombre ?? 'Suscriptor'}</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-green-700">{aviso}</p>}
      {sinTarifaConfigurada && (
        <p className="rounded-md border border-yellow-500 bg-yellow-50 p-3 text-sm text-yellow-800">
          La categoría &quot;{suscriptor?.categoria}&quot; no tiene ninguna tarifa vigente configurada
          todavía. El suscriptor puede crearse igual, pero no se le podrá facturar hasta que exista
          una tarifa para su categoría.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>Código: {suscriptor?.codigo_suscriptor}</p>
          <p>Documento: {suscriptor?.numero_documento}</p>
          <p>Dirección: {suscriptor?.direccion}</p>
          <p>Categoría: {suscriptor?.categoria}</p>
          <p>Estado: {suscriptor?.estado}</p>
          {rol === 'admin_acueducto' && <button
            className="mt-3 h-9 w-fit rounded-md border border-blue-300 px-4 text-sm font-medium text-blue-700 hover:bg-blue-50"
            onClick={alRegenerarCodigo}
          >
            Regenerar código del portal
          </button>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Corte y reconexión</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rol === 'admin_acueducto' ? (
            suscriptor?.estado === 'cortado' ? (
              <ReconexionForm suscriptorId={id} onReconectado={recargar} />
            ) : (
              <CorteForm suscriptorId={id} onCortado={recargar} />
            )
          ) : (
            <p className="text-sm text-muted-foreground">Solo el administrador del acueducto puede ejecutar cortes o reconexiones.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de cortes y reconexiones</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {historialEventos.length === 0 && <p className="text-sm text-muted-foreground">Sin eventos registrados.</p>}
          {historialEventos.map((ev) => (
            <div key={ev.id} className="border-b border-border py-2 text-sm last:border-0">
              <p className="font-medium">{ev.fecha} · {ev.tipo === 'corte' ? 'Corte' : 'Reconexión'}</p>
              <p className="text-xs text-muted-foreground">
                {ev.motivo}
                {ev.deuda_vencida_al_reconectar !== null &&
                  ` · deuda vencida al reconectar: $${ev.deuda_vencida_al_reconectar.toLocaleString('es-CO')}`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contador</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {contador ? (
            <div className="text-sm">
              <p>Serial: {contador.serial}</p>
              <p>Capacidad máxima: {contador.capacidad_maxima}</p>
              <p>Instalado: {contador.fecha_instalacion}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin contador instalado todavía.</p>
          )}

          {contador ? (
            <ReemplazoContadorForm usuarioServicioId={id} onReemplazado={recargar} />
          ) : (
            <ContadorForm usuarioServicioId={id} onCreado={recargar} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de reemplazos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {reemplazos.length === 0 && <p className="text-sm text-muted-foreground">Sin reemplazos registrados.</p>}
          {reemplazos.map((r) => (
            <div key={r.id} className="border-b border-border py-2 text-sm last:border-0">
              <p className="font-medium">{r.fecha_reemplazo}</p>
              <p className="text-xs text-muted-foreground">
                Lectura final anterior {r.lectura_final_anterior} · lectura inicial nueva {r.lectura_inicial_nuevo}
                {r.motivo && ` · ${r.motivo}`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
```

**Cambio a hacer en este archivo:** dentro de la `<Card>` "Contador" (la que muestra
Serial/Capacidad/Instalado), agregar un botón "Ver etiqueta QR" que muestre/oculte
`<EtiquetaQrContador contador={contador} />` (un `useState<boolean>` simple, ej.
`mostrarEtiqueta`) — solo cuando `contador` no es `null`. El resto del archivo queda idéntico, no
reescribas ninguna otra `<Card>`.

### `frontend/app/globals.css` — bloque de impresión ya existente (no lo reescribas completo, el
archivo tiene más contenido arriba; esto es lo que ya hay)

```css
@media print {
  html,
  body {
    background: white !important;
  }
  * {
    box-shadow: none !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

No hace falta agregar nada a este bloque — `EtiquetaQrContador` ya usa `print:hidden` de Tailwind
en su propio botón (igual que hace `facturacion/[facturaId]/page.tsx` con sus botones), y el resto
de la página de suscriptor también necesita `print:hidden` en lo que NO es la etiqueta para que
`Ctrl+P` no imprima toda la ficha. **Agregá `print:hidden`** a las demás `<Card>` de la página
(Datos, Corte y reconexión, Historial de cortes, el formulario de contador/reemplazo dentro de la
Card "Contador", Historial de reemplazos) — solo la etiqueta QR (cuando está visible) debe quedar
sin esa clase.

### Qué NO hacer

- No toques `ContadorForm`, `ReemplazoContadorForm`, `CorteForm`, `ReconexionForm` — sin cambios.
- No agregues ninguna llamada nueva a `lib/api.ts` — `contador.id` y `contador.serial` ya están en
  el estado que la página ya carga.
- No uses `serial` como contenido del QR — tiene que ser `contador.id`.
- No dejes el `errorCorrectionLevel` en su valor por defecto — tiene que ser `'H'` explícito.

### Formato de entrega esperado de Luna

`frontend/package.json` (solo la línea agregada, con contexto suficiente para ubicarla),
`frontend/components/etiqueta-qr-contador.tsx` completo (nuevo),
`frontend/app/app/suscriptores/[id]/page.tsx` completo (con el botón y los `print:hidden`
agregados). Al final, la sección "Asunciones sin verificar" de tu prompt base.

---

## T-002 — Escanear el QR desde "Nueva lectura" (PARA LUNA)

### Objetivo

En la pestaña "Nueva lectura" de AquaLectura (rol `lector`), agregar un botón "Escanear QR" que
abra la cámara, decodifique un QR, y si su contenido coincide con el `contador_actual_id` de algún
suscriptor ya cargado, preseleccione ese contador en el `<select>` existente — sin tocar el
`<select>` en sí, que sigue siempre disponible.

### Reglas no negociables de este proyecto (léelas antes de escribir una línea)

- El matching es **100% client-side**, contra la prop `suscriptores` que el componente ya recibe —
  **cero llamadas nuevas a `lib/api.ts` o al backend**.
- Preferir la capacidad nativa del navegador para decodificar (la librería de abajo ya lo hace
  sola) — no escribas tu propia lógica de detección, usá la librería tal cual.
- Escanear un QR **nunca** guarda ni envía la lectura por sí solo — solo preselecciona el contador;
  ingresar el valor y tocar "Guardar lectura" sigue siendo un paso separado y explícito del
  fontanero.
- Nada de `console.log`. TypeScript estricto, nada de `any`.
- No toques `crearLectura`, la validación de la lectura, ni ninguna otra pestaña de AquaLectura
  (Inicio, Pendientes, Historial).

### Dependencia nueva — agregar a `frontend/package.json`, bloque `"dependencies"`

```json
"qr-scanner": "^1.4.2",
```

Licencia MIT, confirmada contra el registro de npm. Esta librería ya usa la API nativa
`BarcodeDetector` del navegador cuando está disponible (Chrome/Android — el navegador real de este
proyecto), y solo si no está disponible carga un decodificador JS de respaldo — no hace falta
implementar ese criterio a mano, la librería ya lo trae.

### API real de la librería (así se usa, no inventes otra firma)

```ts
import QrScanner from 'qr-scanner';

// videoElem es un <video> ya montado en el DOM.
const escaner = new QrScanner(
  videoElem,
  (resultado) => {
    // resultado.data es el texto crudo decodificado del QR (el id del contador).
    console.info(resultado.data); // reemplazar por el manejo real, nunca console.log
  },
  { returnDetailedScanResult: true }, // resultado viene como { data, cornerPoints }
);

escaner.start(); // pide permiso de cámara al navegador
// ...
escaner.stop();     // pausa
escaner.destroy();  // libera la cámara del todo — SIEMPRE llamar al desmontar el componente
```

### Componente nuevo: `frontend/components/lector/escaner-qr-contador.tsx`

```tsx
'use client';

import { useEffect, useRef } from 'react';
import QrScanner from 'qr-scanner';
import { Button } from '@/components/ui/button';

interface EscanerQrContadorProps {
  onDecodificado: (texto: string) => void;
  onCerrar: () => void;
}

// 015: escanea con la cámara y entrega el texto crudo del QR al padre — el
// padre (nueva-lectura-lector.tsx) es quien decide si matchea con algún
// contador conocido. Este componente NUNCA guarda ninguna lectura ni decide
// nada de negocio, solo decodifica.
export function EscanerQrContador({ onDecodificado, onCerrar }: EscanerQrContadorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const escanerRef = useRef<QrScanner | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const escaner = new QrScanner(
      videoRef.current,
      (resultado) => onDecodificado(resultado.data),
      { returnDetailedScanResult: true },
    );
    escanerRef.current = escaner;
    escaner.start().catch((err) => console.error('escaner-qr-contador: no se pudo iniciar la cámara', err));

    return () => {
      escaner.destroy();
      escanerRef.current = null;
    };
  }, [onDecodificado]);

  return (
    <div className="flex flex-col gap-3">
      <video ref={videoRef} className="w-full rounded-lg" muted playsInline />
      <Button variant="outline" onClick={onCerrar}>
        Cancelar escaneo
      </Button>
    </div>
  );
}
```

### `frontend/components/lector/nueva-lectura-lector.tsx` — archivo completo tal cual está hoy

```tsx
'use client';

import { useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  const hidratado = useHidratado();

  const contadores = (suscriptores ?? [])
    .filter((s) => s.contador_actual_id)
    .map((s) => ({ id: s.contador_actual_id!, nombre: s.nombre, codigo: s.codigo_suscriptor }));

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

**Cambios a hacer en este archivo:**
1. Agregar un `useState<boolean>` (ej. `escaneando`) y un botón "Escanear QR" junto al `<select>`
   (antes o después, tu criterio de layout) que ponga `escaneando` en `true`.
2. Cuando `escaneando` es `true`, renderizar `<EscanerQrContador onDecodificado={...}
   onCerrar={() => setEscaneando(false)} />` en vez del `<select>` (o encima, tu criterio — pero no
   los dos escaneando cámara y mostrando el `<select>` al mismo tiempo, para no confundir).
3. `onDecodificado`: buscá en `contadores` (el array que ya se calcula arriba en el componente) uno
   cuyo `id` sea igual al texto decodificado. Si lo encontrás: `setContadorSel(match.id)` y
   `setEscaneando(false)`. Si no lo encontrás: `setError('Este código no corresponde a ningún
   contador de tu acueducto.')` y `setEscaneando(false)` — **no** rompas la pantalla, dejá el
   `<select>` disponible para seguir manual (CA-4 del spec).

### Qué NO hacer

- No agregues ninguna llamada a `lib/api.ts` para resolver el contador — el matching es contra
  `contadores` (ya calculado en el componente desde la prop `suscriptores`).
- No dejes la cámara abierta si el componente se desmonta o si el usuario cancela — siempre
  `escaner.destroy()` al cerrar (ya está en el `useEffect` de limpieza de `EscanerQrContador`, no lo
  quites).
- No toques `crearLectura`, la validación del formulario (`alGuardar`), ni ninguna otra pestaña de
  AquaLectura.
- No agregues `frontend/next.config.ts` a esta entrega — el permiso de cámara en esa ruta lo maneja
  Claude/Mateo directamente en el cierre (T-003), no es para Luna.

### Formato de entrega esperado de Luna

`frontend/package.json` (solo la línea agregada), `frontend/components/lector/escaner-qr-contador.tsx`
completo (nuevo), `frontend/components/lector/nueva-lectura-lector.tsx` completo (con los cambios).
Al final, la sección "Asunciones sin verificar" de tu prompt base.

---

## T-003 — Cierre: permiso de cámara, corrección de la especificación, CHANGELOG, verificación real (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `frontend/next.config.ts`, `docs/ESPECIFICACION-FUNCIONAL.md`, `CHANGELOG.md`.

### `frontend/next.config.ts` — agregar un segundo bloque de `headers()`

Después del bloque global existente (`source: '/:path*'`), agregar:

```ts
{
  source: '/app/lecturas',
  headers: [{ key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' }],
},
```

Solo esta ruta gana permiso de cámara — las otras cuatro cabeceras de seguridad siguen viniendo del
bloque global (comportamiento de "última clave gana" de Next.js, confirmado contra su
documentación oficial en plan.md §5) — **verificar con un build real y `curl -I`, no asumir.**

### `docs/ESPECIFICACION-FUNCIONAL.md` §2.14.1

Cambiar el encabezado `### 2.14.1 Identificación de contador por QR + lectura automática por OCR
(Feature 014)` a `(Feature 015)`, y agregar una nota breve señalando que la identificación por QR
(este spec) y el OCR quedaron divididos en dos specs.

### Verificación real

```
cd backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
```

Más:
1. `curl -I` real contra `/app/lecturas` (tras el build) y contra otra ruta cualquiera del panel:
   confirmar que solo `/app/lecturas` permite cámara y que las otras cuatro cabeceras de seguridad
   siguen presentes en ambas.
2. `grep` confirmando que `contador.serial` no aparece en ningún lado como contenido del QR (solo
   como texto visible) — que de verdad se está codificando `id`.
3. Confirmar visualmente (sin cámara real, con una captura de pantalla o inspección del DOM) que
   `EtiquetaQrContador` renderiza un `<canvas>` con contenido no vacío.

**NO VERIFICADO — requiere Mateo, este entorno no tiene cámara física ni Chromium/Playwright:**
- Escanear con un celular Android real la etiqueta impresa de un contador de prueba y confirmar que
  preselecciona el contador correcto en "Nueva lectura" (CA-3).
- Escanear un QR que no sea de ningún contador del acueducto y confirmar el aviso claro, sin romper
  la pantalla (CA-4).
- Que la librería `qr-scanner` cargue su worker de respaldo correctamente bajo el bundler de
  Next.js/`@opennextjs/cloudflare` sin configurar `WORKER_PATH` a mano — las versiones recientes lo
  cargan solo con `import`, pero **esto no se puede confirmar sin una cámara real abriendo la
  librería en un navegador real**; si falla, el paso exacto es fijar `QrScanner.WORKER_PATH` al
  archivo del worker copiado al build de salida (revisar la documentación de la librería en ese
  momento, no inventar la ruta).
- Que la etiqueta impresa en una impresora real, a tamaño real, siga siendo legible por una cámara
  de celular a la distancia habitual de trabajo.

**Estado:** COMPLETADO — implementado directamente por Claude (autorización expresa de Mateo, no
pasó por Luna). Permiso de cámara agregado a `next.config.ts`, encabezado de
`ESPECIFICACION-FUNCIONAL.md §2.14.1` corregido a "Feature 015" con nota de la división en dos
specs. `.specify/config.md` (registro maestro del roadmap) actualizado: fila 015 refleja la
división QR/OCR, y de paso se corrigió que la fila 019 (Sesión 053) seguía sin marcar como
implementada. Verificación real: `npm run build`/`npm run lint` limpios en frontend; backend
confirmado sin cambios (229/229 tests, `wrangler deploy --dry-run` limpio, `git diff --stat
backend/` vacío). Cabeceras reales comparadas con una sesión de lector real contra `wrangler dev`
(backend + frontend conectados por su service binding local): `/app/lecturas` responde
`permissions-policy: camera=(self)…`, `/app/facturacion` con la misma sesión responde `camera=()`
— confirma en la práctica el criterio de "última clave gana" de Next.js, no solo la documentación.
Hallazgo propio durante la verificación: `wrangler dev` servía un build de OpenNext desactualizado
(`npm run build` genera el de Next.js; `wrangler dev` sirve `.open-next/`, que solo genera `npm run
pages:build`) — corregido antes de repetir la prueba. Datos de prueba (contraseña del fixture
`lector-a@test.local`) sin filas nuevas que limpiar. Verificación con cámara real, worker de
respaldo de `qr-scanner` bajo el bundler, y legibilidad de la etiqueta impresa: NO VERIFICADO,
requiere Mateo con un celular real (este entorno no tiene cámara física ni Chromium/Playwright).
