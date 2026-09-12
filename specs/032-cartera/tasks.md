# TASKS — 032: cartera

**Plan aprobado:** 2026-09-12

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-001 es la única tarea para Luna — pegala completa en una
conversación nueva, después del prompt base de reglas de UndreoCol. T-002 es cierre, no es para
Luna.

---

## T-001 — Re-vestido de `/app/pagos` (Cartera) + contenedor de `PagoForm` (PARA LUNA)

### Objetivo

Reescribir `frontend/app/app/pagos/page.tsx` con el sistema visual de 026: encabezado, resumen
agregado de urgencia, orden por urgencia, filtro de búsqueda (cliente-side), tabla con `Badge`. Y
ajustar **solo el contenedor visual** de `frontend/components/pago-form.tsx` (clases CSS del
`<form>`, no su lógica) para que combine con el resto. Cero llamadas nuevas a la API.

### Archivo 1 a modificar (completo, tal cual está hoy)

`frontend/app/app/pagos/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PagoForm } from '@/components/pago-form';
import { obtenerCartera, type FilaCartera, type ResultadoRegistrarPago } from '@/lib/api';

export default function CarteraPage() {
  const [cartera, setCartera] = useState<FilaCartera[] | null>(null);
  const [soloMorosos, setSoloMorosos] = useState(false);
  const [pagoAbiertoPara, setPagoAbiertoPara] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setError(null);
    obtenerCartera({ soloMorosos })
      .then((r) => setCartera(r.cartera))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar la cartera'));
  }, [soloMorosos]);

  useEffect(cargar, [cargar]);

  function alRegistrar(fila: FilaCartera, resultado: ResultadoRegistrarPago) {
    setPagoAbiertoPara(null);
    setAviso(
      resultado.remanente > 0
        ? `Pago registrado para ${fila.nombre}: quedó un saldo a favor de $${resultado.remanente.toLocaleString('es-CO')}.`
        : `Pago registrado para ${fila.nombre}.`,
    );
    cargar();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cartera</h1>
        <Link href="/app/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-green-700">{aviso}</p>}

      <label className="flex w-fit items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={soloMorosos}
          onChange={(e) => setSoloMorosos(e.target.checked)}
        />
        Solo morosos (con deuda vencida)
      </label>

      <Card>
        <CardHeader>
          <CardTitle>Suscriptores con deuda o saldo a favor</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {cartera === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {cartera?.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin suscriptores con deuda ni saldo a favor.</p>
          )}
          {cartera?.map((fila) => (
            <div key={fila.usuarioServicioId} className="flex flex-col gap-3 border-b border-border pb-4 last:border-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/app/pagos/${fila.usuarioServicioId}`} className="font-medium hover:underline">
                    {fila.nombre}
                  </Link>
                  <p className="text-xs text-muted-foreground">{fila.codigoSuscriptor} · {fila.estado}</p>
                </div>
                <button
                  className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
                  onClick={() => setPagoAbiertoPara(pagoAbiertoPara === fila.usuarioServicioId ? null : fila.usuarioServicioId)}
                >
                  {pagoAbiertoPara === fila.usuarioServicioId ? 'Cerrar' : 'Registrar pago'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Por vencer</p>
                  <p>${fila.porVencer.toLocaleString('es-CO')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vencida</p>
                  <p className={fila.vencida > 0 ? 'font-medium text-red-600' : ''}>
                    ${fila.vencida.toLocaleString('es-CO')}
                    {fila.facturaVencidaMasAntigua && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {fila.facturaVencidaMasAntigua.numero} · {fila.facturaVencidaMasAntigua.diasMora} días de mora
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total adeudado</p>
                  <p className="font-medium">${fila.totalAdeudado.toLocaleString('es-CO')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Saldo a favor</p>
                  <p className={fila.saldoFavor > 0 ? 'font-medium text-green-700' : ''}>
                    ${fila.saldoFavor.toLocaleString('es-CO')}
                  </p>
                </div>
              </div>
              {pagoAbiertoPara === fila.usuarioServicioId && (
                <PagoForm
                  usuarioServicioId={fila.usuarioServicioId}
                  onRegistrado={(resultado) => alRegistrar(fila, resultado)}
                  onCancelar={() => setPagoAbiertoPara(null)}
                />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
```

### Archivo 2 a modificar (completo, tal cual está hoy) — solo tocar el contenedor

`frontend/components/pago-form.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registrarPago, type MetodoPago, type ResultadoRegistrarPago } from '@/lib/api';

const METODOS: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'consignacion', etiqueta: 'Consignación' },
  { valor: 'pse', etiqueta: 'PSE' },
  { valor: 'otro', etiqueta: 'Otro' },
];

interface PagoFormProps {
  usuarioServicioId: string;
  facturaId?: string;
  onRegistrado: (resultado: ResultadoRegistrarPago) => void;
  onCancelar?: () => void;
}

export function PagoForm({ usuarioServicioId, facturaId, onRegistrado, onCancelar }: PagoFormProps) {
  const [valor, setValor] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [referencia, setReferencia] = useState('');
  const [fechaPago, setFechaPago] = useState(() => new Date().toISOString().slice(0, 10));
  const [observaciones, setObservaciones] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const resultado = await registrarPago({
        usuario_servicio_id: usuarioServicioId,
        valor: Number(valor),
        metodo,
        fecha_pago: fechaPago,
        referencia: referencia.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        factura_ids: facturaId ? [facturaId] : undefined,
      });
      onRegistrado(resultado);
      setValor('');
      setReferencia('');
      setObservaciones('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el pago');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="valor">Valor</Label>
          <Input id="valor" type="number" min="1" step="1" required value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="metodo">Método</Label>
          <select
            id="metodo"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={metodo}
            onChange={(e) => setMetodo(e.target.value as MetodoPago)}
          >
            {METODOS.map((m) => (
              <option key={m.valor} value={m.valor}>{m.etiqueta}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="referencia">Referencia (opcional)</Label>
          <Input id="referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fecha_pago">Fecha</Label>
          <Input id="fecha_pago" type="date" required value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="observaciones">Observaciones (opcional)</Label>
        <Input id="observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={!hidratado || cargando}>
          {cargando ? 'Registrando…' : 'Registrar pago'}
        </Button>
        {onCancelar && (
          <Button type="button" variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
```

**Sobre este archivo 2: NO tocar nada salvo la clase del `<form>` en la línea
`className="flex flex-col gap-4 rounded-md border border-border p-4"`.** No cambies `useHidratado()`,
`disabled={!hidratado || cargando}`, ningún input, ninguna validación, ninguna llamada a
`registrarPago`. Es un componente compartido por 3 pantallas (`facturacion/page.tsx`,
`facturacion/[facturaId]/page.tsx` y este `pagos/page.tsx`) — cualquier otro cambio se propaga a
las tres sin que sea su spec.

### Tipos y funciones ya existentes (no inventar otros)

De `@/lib/api`:

```ts
export type EstadoSuscriptor = 'activo' | 'suspendido' | 'cortado' | 'inactivo';

export interface FacturaVencidaMasAntigua {
  numero: string;
  diasMora: number;
}

export interface FilaCartera {
  usuarioServicioId: string;
  nombre: string;
  codigoSuscriptor: string;
  estado: EstadoSuscriptor;
  porVencer: number;
  vencida: number;
  diasMoraMax: number | null;
  facturaVencidaMasAntigua: FacturaVencidaMasAntigua | null;
  totalAdeudado: number;
  saldoFavor: number;
}

export interface ResultadoRegistrarPago {
  pago: Pago;
  aplicaciones: AplicacionPago[];
  remanente: number;
  facturas: FacturaTrasPago[];
}

function obtenerCartera(filtros: { suscriptorId?: string; soloMorosos?: boolean }): Promise<{ cartera: FilaCartera[] }>;
```

### `Badge` ya existente (no crear uno nuevo)

`import { Badge } from '@/components/ui/badge';` — variantes disponibles: `'success' | 'warning' |
'danger' | 'info' | 'gray'`. Uso: `<Badge variante="danger">En mora</Badge>`.

### Patrón real del encabezado (usar exactamente estas clases)

Eyebrow: `<p className="text-xs font-bold uppercase tracking-wide text-accent">Cartera</p>`.
`<h1 className="text-[28px] font-bold tracking-tight">Suscriptores con deuda</h1>` (**no**
`text-3xl` ni `text-2xl` — es `text-[28px] font-bold`, así están 027/030/031). Subtítulo:
`<p className="mt-1 text-sm text-muted-foreground">Consulta y registra pagos pendientes.</p>`.
**Nunca** una clase `page-head` — no existe en el CSS de esta app (error ya visto y corregido en
030, no repetirlo).

### Qué construir (plan.md §1 y §5)

1. **Encabezado**: eyebrow + `<h1>` + subtítulo con las clases exactas de arriba, más el link
   "← Dashboard" reubicado ahí (podés usar `text-accent` en vez de `text-blue-600`, como ya se hizo
   en 031).
2. **Resumen agregado** (spec §3.6b, nuevo): calculado sobre la `cartera` **completa ya cargada**
   (antes de aplicar el filtro de búsqueda del punto 4): cantidad de filas con `vencida > 0` y la
   suma de su `vencida`. Si esa cantidad es 0, no se muestra nada. Formato sugerido: "N
   suscriptores en mora · $X vencido en total", con `Badge variante="danger"` o similar tratamiento
   visual de alerta (mismo criterio que el resumen de 030).
3. **Orden por urgencia** (spec §3.6b, nuevo): antes de filtrar por búsqueda, ordenar una copia del
   arreglo (`[...cartera]`, nunca mutar el original) por `vencida` descendente y, en empate, por
   `porVencer` descendente.
4. **Filtro de búsqueda** (spec §3.3, nuevo): un `<input>` que filtra por `nombre` o
   `codigoSuscriptor` (case-insensitive, `includes`), 100% en el cliente, sobre el arreglo ya
   ordenado — ninguna llamada nueva. El checkbox "Solo morosos" existente no cambia (sigue
   disparando `obtenerCartera({ soloMorosos })`).
5. **Tabla con `Badge` de urgencia** (spec §3.4): reemplaza las tarjetas sueltas por filas de tabla
   (o tarjetas re-vestidas, tu criterio de maquetado, mientras se vea consistente con 030/031) con:
   Suscriptor (nombre + código + estado), Días de mora (`diasMoraMax`, o "—" si es `null`), las 4
   cifras de §3.5 (por vencer, vencida, total adeudado, saldo a favor — **no las reduzcas a una
   sola columna**), un `Badge` calculado así:
   - `vencida > 0` → `variante="danger"`, etiqueta "En mora"
   - si no, `porVencer > 0` → `variante="warning"`, etiqueta "Por vencer"
   - si no, `saldoFavor > 0` → `variante="info"`, etiqueta "Saldo a favor"

   y el botón "Registrar pago"/"Cerrar" que abre `PagoForm` inline, igual que hoy (mismo patrón de
   expandir/cerrar, no un modal).
6. **`PagoForm`**: solo el ajuste de contenedor descrito arriba.

### Qué NO hacer

- No cambiar ninguna ruta de `@/lib/api` ni agregar una llamada nueva.
- No tocar la lógica de `PagoForm` — solo su clase de contenedor.
- No crear el flujo de "+ Registrar pago" del encabezado de la propuesta — no existe sin partir de
  un suscriptor puntual (spec §4, fuera de alcance).
- No tocar `/app/pagos/[suscriptorId]` — fuera de alcance.
- No usar la clase `page-head`.

### Criterios de aceptación (spec.md §6, verificación real pendiente de Claude/Mateo — no tuya)

- CA-1 a CA-6 de `specs/032-cartera/spec.md` §6.

### Formato de entrega esperado de Luna

Los dos archivos completos, listos para pegar, cada uno con su ruta exacta arriba. Al final, la
sección "Asunciones sin verificar" de tu prompt base.

---

## T-002 — Cierre: verificación real, CHANGELOG y PLAN-PRODUCCION.md (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (contador de pantallas re-vestidas, hoy
"4 de 15").

**Verificación real, no supuesta:**
```
cd frontend && npm run build && npm run lint
```
Más inspección manual contra `next dev` real, sesión de `admin_acueducto`, y confirmar que
`PagoForm` sigue funcionando igual en las otras 2 pantallas que lo usan
(`facturacion/page.tsx`, `facturacion/[facturaId]/page.tsx`) — regresión, no solo esta pantalla.

**Estado:** COMPLETADO — auditoría real sin bloqueantes de compilación. 1 problema de diseño
corregido: el formulario de pago quedó desconectado de su fila al pasar a tabla (spec pedía
"expandir/cerrar inline"); se insertó como fila de tabla (`<tr><td colSpan>`) justo debajo de la
fila correspondiente. `npm run build`/`lint` verificados en verde. Regresión confirmada:
`PagoForm` sigue intacto en `facturacion/page.tsx` y `facturacion/[facturaId]/page.tsx`.
Verificación visual en navegador real (CA-1 a CA-6) queda pendiente de Mateo.
