# TASKS — 031: detalle-factura

**Plan aprobado:** 2026-09-12

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna:** T-002 es la única tarea para Luna — está armada para pegarse
completa en una conversación nueva (después del prompt base de reglas de UndreoCol). T-001 la hizo
Claude directo (mecánica, bajo riesgo: mover dos funciones ya probadas a un archivo compartido, sin
cambiar su comportamiento). T-003 es cierre, tampoco es para Luna.

---

## T-001 — Extraer `formatearCategoria`/`configuracionEstado` a `lib/formato-factura.ts` (Claude)

**Archivos:** `frontend/lib/formato-factura.ts` (nuevo), `frontend/app/app/facturacion/page.tsx`
(modificado: importa en vez de definir localmente).

**Hace:** mueve las dos funciones que 030 dejó locales a un archivo compartido, sin cambiar una
sola línea de su comportamiento — 031 las necesita también.

**Verificación:** `npm run build` y `npm run lint` en verde.

**Estado:** COMPLETADO.

---

## T-002 — Re-vestido de `/app/facturacion/[facturaId]` (PARA LUNA)

### Objetivo

Reescribir `frontend/app/app/facturacion/[facturaId]/page.tsx` con el sistema visual de 026:
encabezado (`page-head`, mismo patrón real de 027/030 — `text-xs font-bold uppercase tracking-wide
text-accent` para el eyebrow, **nunca** una clase `page-head` de CSS, que no existe en esta app),
`Badge` de estado, acciones reubicadas en el encabezado, y una confirmación nueva
(`window.confirm()`) antes de anular una factura o un pago. Cero llamadas nuevas a la API: se
reordena y se le agrega presentación y una guarda de confirmación a lo que ya existe.

### Archivo a modificar (completo, tal cual está hoy)

`frontend/app/app/facturacion/[facturaId]/page.tsx`:

```tsx
'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PagoForm } from '@/components/pago-form';
import {
  anularFactura,
  anularPago,
  enviarCorreoFactura,
  obtenerAcueducto,
  obtenerFactura,
  obtenerContextoUsuario,
  obtenerPagosDeFactura,
  urlPdfFactura,
  type Acueducto,
  type AplicacionHistorialFactura,
  type DetalleFactura,
  type Factura,
} from '@/lib/api';

const NOMBRES_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  consignacion: 'Consignación',
  pse: 'PSE',
  otro: 'Otro',
};

interface PageProps {
  params: Promise<{ facturaId: string }>;
}

export default function DetalleFacturaPage({ params }: PageProps) {
  const { facturaId } = use(params);
  const [factura, setFactura] = useState<Factura | null>(null);
  const [acueducto, setAcueducto] = useState<Acueducto | null>(null);
  const [detalles, setDetalles] = useState<DetalleFactura[]>([]);
  const [pagos, setPagos] = useState<AplicacionHistorialFactura[]>([]);
  const [mostrarFormPago, setMostrarFormPago] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [rol, setRol] = useState<string | null>(null);

  const recargar = useCallback(() => {
    if (!facturaId) return;
    obtenerFactura(facturaId)
      .then((r) => {
        setFactura(r.factura);
        setDetalles(r.detalles);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar la factura'));
    obtenerPagosDeFactura(facturaId)
      .then((r) => setPagos(r.pagos))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el historial de pagos'));
  }, [facturaId]);

  useEffect(recargar, [recargar]);

  // Encabezado del acueducto (023, cierra el hueco de 006): mismos datos que
  // ya usa el PDF, no depende de la factura — se carga aparte.
  useEffect(() => {
    obtenerAcueducto()
      .then((r) => setAcueducto(r.acueducto))
      .catch((e) => console.error('No se pudo cargar el encabezado del acueducto', e));
  }, []);

  useEffect(() => {
    obtenerContextoUsuario()
      .then((r) => setRol(r.cliente.rol))
      .catch(() => setRol('admin_acueducto'));
  }, []);

  async function alAnularPago(pagoId: string) {
    const motivo = window.prompt('Motivo de anulación del pago (obligatorio):');
    if (!motivo) return;
    try {
      await anularPago(pagoId, motivo);
      setError(null);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular el pago');
    }
  }

  async function alEnviarCorreo() {
    if (!factura) return;
    setAviso(null);
    setError(null);
    setEnviando(true);
    try {
      const r = await enviarCorreoFactura(factura.id);
      setAviso(`Envío encolado con la factura ${factura.numero} como PDF adjunto.`);
      void r;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo encolar el envío');
    } finally {
      setEnviando(false);
    }
  }

  async function alAnular() {
    if (!factura) return;
    const motivo = window.prompt(`Motivo de anulación de ${factura.numero} (obligatorio):`);
    if (!motivo) return;
    try {
      const r = await anularFactura(factura.id, motivo);
      setFactura(r.factura);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular la factura');
    }
  }

  if (error) return <main className="mx-auto max-w-3xl p-8 text-sm text-red-600">{error}</main>;
  if (!factura) return <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">Cargando…</main>;

  const snap = factura.snapshot_suscriptor as Record<string, string>;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-600">{error}</p>}
      {aviso && <p className="rounded-md border border-green-200 bg-green-50 p-2 text-sm text-green-700">{aviso}</p>}
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold">Factura {factura.numero}</h1>
        <Link href="/app/facturacion" className="text-sm text-blue-600 hover:underline">
          ← Facturación
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <a
          className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
          href={urlPdfFactura(factura.id)}
          target="_blank"
          rel="noreferrer"
        >
          Ver PDF
        </a>
        <button
          className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          onClick={() => window.print()}
        >
          Imprimir
        </button>
        {factura.estado !== 'anulada' && (
          <button
            className="h-9 w-fit rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
            onClick={alEnviarCorreo}
            disabled={enviando}
          >
            {enviando ? 'Encolando…' : 'Enviar por correo'}
          </button>
        )}
      </div>

      {acueducto && (
        <div className="flex items-start gap-3 border-b border-border pb-4">
          {acueducto.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- logo externo (R2), no un asset local
            <img src={acueducto.logoUrl} alt="" className="h-14 w-auto object-contain" />
          )}
          <div className="text-sm">
            <p className="text-lg font-bold" style={{ color: acueducto.colorAcento }}>
              {acueducto.nombre}
            </p>
            <p className="text-muted-foreground">
              {[
                acueducto.nit ? `NIT: ${acueducto.nit}` : null,
                acueducto.municipio,
                acueducto.telefono ? `Tel: ${acueducto.telefono}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {acueducto.direccion && <p className="text-muted-foreground">{acueducto.direccion}</p>}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p><strong>Estado:</strong> {factura.estado}</p>
          <p><strong>Suscriptor:</strong> {snap.nombre} ({snap.codigo_suscriptor})</p>
          <p><strong>Categoría:</strong> {snap.categoria ?? '—'} · <strong>Dirección:</strong> {snap.direccion ?? '—'}</p>
          <p><strong>Consumo:</strong> {factura.consumo_m3} m³</p>
          <p><strong>Subtotal servicios:</strong> ${factura.subtotal_servicios.toLocaleString('es-CO')}</p>
          <p><strong>Recargo mora:</strong> ${factura.recargo_mora.toLocaleString('es-CO')}</p>
          <p><strong>Saldo anterior:</strong> ${factura.saldo_anterior.toLocaleString('es-CO')}</p>
          <p className="text-base" style={{ color: acueducto?.colorAcento }}>
            <strong>Total:</strong> ${factura.total.toLocaleString('es-CO')}
          </p>
          <p><strong>Pagado:</strong> ${factura.total_pagado.toLocaleString('es-CO')} · <strong>Saldo:</strong> ${(factura.total - factura.total_pagado).toLocaleString('es-CO')}</p>
          <p className="text-xs text-muted-foreground">Emisión {factura.fecha_emision} · vence {factura.fecha_vencimiento}</p>
          {factura.motivo_anulacion && (
            <p className="text-xs text-red-600">Anulada: {factura.motivo_anulacion}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Desglose por servicio</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {detalles.length === 0 && <p className="text-sm text-muted-foreground">Sin renglones.</p>}
          {detalles.map((d) => (
            <div key={d.id} className="flex items-center justify-between border-b border-border py-1 text-sm last:border-0">
              <div>
                <p>{d.descripcion}</p>
                <p className="text-xs text-muted-foreground">
                  {d.tipo_calculo === 'por_consumo'
                    ? `${d.consumo_basico_m3} m³ básico + ${d.consumo_no_basico_m3} m³ no básico`
                    : 'Cargo fijo'}
                </p>
              </div>
              <p className="font-medium">${d.subtotal.toLocaleString('es-CO')}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Pagos aplicados</CardTitle>
            {factura.estado !== 'anulada' && factura.total_pagado < factura.total && (
              <button
                className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
                onClick={() => setMostrarFormPago((v) => !v)}
              >
                {mostrarFormPago ? 'Cerrar' : 'Registrar pago'}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mostrarFormPago && (
            <PagoForm
              usuarioServicioId={factura.usuario_servicio_id}
              facturaId={factura.id}
              onRegistrado={(resultado) => {
                setMostrarFormPago(false);
                setAviso(
                  resultado.remanente > 0
                    ? `Pago registrado. Sobrante a favor del suscriptor: $${resultado.remanente.toLocaleString('es-CO')}.`
                    : 'Pago registrado.',
                );
                recargar();
              }}
              onCancelar={() => setMostrarFormPago(false)}
            />
          )}
          {pagos.length === 0 && <p className="text-sm text-muted-foreground">Sin pagos aplicados a esta factura.</p>}
          {pagos.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0">
              <div>
                <p className={p.anulado ? 'text-muted-foreground line-through' : 'font-medium'}>
                  ${p.valor.toLocaleString('es-CO')} · {NOMBRES_METODO[p.metodo] ?? p.metodo}
                  {p.referencia && ` · ${p.referencia}`}
                </p>
                <p className="text-xs text-muted-foreground">{p.fecha_pago} · registrado por {p.recibido_por ?? '—'}</p>
                {p.anulado && <p className="text-xs text-red-600">Anulado: {p.motivo_anulacion}</p>}
              </div>
              {rol === 'admin_acueducto' && !p.anulado && (
                <button
                  className="h-8 w-fit rounded-md border border-red-300 px-3 text-xs font-medium text-red-600 hover:bg-red-50"
                  onClick={() => alAnularPago(p.id)}
                >
                  Anular
                </button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {rol === 'admin_acueducto' && factura.estado !== 'anulada' && (
        <button
          className="h-9 w-fit rounded-md border border-red-300 px-4 text-sm font-medium text-red-600 hover:bg-red-50 print:hidden"
          onClick={alAnular}
        >
          Anular factura
        </button>
      )}
    </main>
  );
}
```

### Ya existen, no inventar otros (importar de acá)

`frontend/lib/formato-factura.ts` (ya creado, T-001):

```ts
export const configuracionEstado: Record<
  EstadoFactura,
  { variante: BadgeProps['variante']; etiqueta: string }
> = {
  pendiente: { variante: 'warning', etiqueta: 'Pendiente' },
  pagada: { variante: 'success', etiqueta: 'Pagada' },
  vencida: { variante: 'danger', etiqueta: 'Vencida' },
  anulada: { variante: 'gray', etiqueta: 'Anulada' },
};

export function formatearCategoria(categoria: unknown): string; // ya implementada, solo importar
```

Import: `import { configuracionEstado, formatearCategoria } from '@/lib/formato-factura';`.

`frontend/components/ui/badge.tsx` — mismo `Badge` que ya usa `frontend/app/app/facturacion/page.tsx`
(030): `import { Badge } from '@/components/ui/badge';`, uso `<Badge variante="danger">Vencida</Badge>`.

Tipo real de `Acueducto` usado en esta pantalla (de `@/lib/api`, ya existe, no inventar campos):
`{ nombre: string; nit: string | null; direccion: string | null; telefono: string | null;
municipio: string | null; logoUrl: string | null; colorAcento: string }`.

Patrón real del eyebrow de 027/030 (`text-xs font-bold uppercase tracking-wide text-accent`) —
**usar exactamente esta clase**, no una clase `page-head` (no existe en el CSS de esta app; en 030
Luna la agregó por error, copiándola del prototipo estático, y hubo que sacarla en la auditoría).

### Qué construir (plan.md §1 y §5)

1. **Encabezado**: eyebrow "Detalle de factura" (clases de arriba), `<h1>Factura {numero}</h1>`,
   subtítulo con `{snap.nombre} · {snap.codigo_suscriptor}`. Ahí mismo, reubicar los 4 botones que
   hoy están en el `<div className="flex ... print:hidden">` de más arriba: Ver PDF, Imprimir,
   Enviar por correo (condicional a `estado !== 'anulada'`), y Anular factura (condicional a
   `rol === 'admin_acueducto' && estado !== 'anulada'`, hoy al final de la página). El link
   "← Facturación" se conserva, en el encabezado.
2. **Bloque de marca del acueducto** (023): se mueve tal cual, sin cambiar su lógica, debajo del
   encabezado nuevo.
3. **Tarjeta "Datos"**: reemplaza `<p><strong>Estado:</strong> {factura.estado}</p>` por
   `<Badge variante={configuracionEstado[factura.estado].variante}>{configuracionEstado[factura.estado].etiqueta}</Badge>`.
   Reemplaza `{snap.categoria ?? '—'}` por `{formatearCategoria(snap.categoria)}`. El resto de los
   campos (consumo, subtotal, recargo, saldo anterior, total con `colorAcento`, pagado/saldo,
   fechas, motivo de anulación) se conservan tal cual, solo con las clases/tarjetas que ya usa esta
   misma pantalla hoy (no hace falta inventar tokens nuevos).
4. **Desglose por servicio**: sin cambios de datos, solo re-vestido si hace falta para que no
   desentone con el resto (puede quedar igual si ya combina bien).
5. **Pagos aplicados**: sin cambios de lógica. Al llamar `alAnularPago(pagoId)`, después del
   `window.prompt()` del motivo, agregar un `window.confirm()` mostrando el valor del pago (`p.valor`)
   antes de llamar a `anularPago` — si se cancela, no se llama a la API. `PagoForm` no se toca (spec
   §4, fuera de alcance — es compartido con `/app/pagos`).
6. **Anular factura**: al llamar `alAnular()`, después del `window.prompt()` del motivo, agregar un
   `window.confirm()` mostrando `factura.numero` y `factura.total` (formateado) antes de llamar a
   `anularFactura` — si se cancela, no se llama a la API. Mismo criterio que `alEmitir` en
   `facturacion/page.tsx` (030), que ya tiene este patrón — podés mirarlo como referencia de estilo
   si hace falta, aunque ese archivo no forma parte de esta tarea.

### Qué NO hacer

- No cambiar ninguna ruta de `@/lib/api` ni agregar una llamada nueva.
- No tocar `PagoForm` (`frontend/components/pago-form.tsx`) — no es parte de esta tarea.
- No usar la clase `page-head` ni ninguna otra clase CSS que no sea Tailwind o un componente
  existente (`Card`, `Badge`).
- No cambiar quién puede anular, cuándo se puede registrar un pago, ni ningún cálculo de dinero.
- No rediseñar el layout de impresión (`@media print`) — solo confirmar que `print:hidden` sigue en
  los mismos elementos.

### Criterios de aceptación (spec.md §6, verificación real pendiente de Claude/Mateo — no tuya)

- CA-1: los datos de "Datos" coinciden con `GET /facturas/:id`.
- CA-2: el `Badge` de estado usa el mismo mapeo que 030.
- CA-3: registrar/ver/anular pagos funciona igual que hoy.
- CA-4: anular factura funciona igual que hoy, con el `window.confirm()` nuevo antes de ejecutar.
- CA-4b: anular pago pide la misma confirmación nueva.
- CA-5: Ver PDF, Imprimir, Enviar por correo siguen funcionando.
- CA-6: la vista impresa no se rompió (`print:hidden` en los mismos elementos).

### Formato de entrega esperado de Luna

El archivo completo `frontend/app/app/facturacion/[facturaId]/page.tsx` listo para pegar,
reemplazando el actual entero. Al final, la sección "Asunciones sin verificar" de tu prompt base.

---

## T-003 — Cierre: verificación real, CHANGELOG y PLAN-PRODUCCION.md (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (contador de pantallas re-vestidas, hoy
"3 de 15").

**Verificación real, no supuesta:**
```
cd frontend && npm run build && npm run lint
```
Más inspección manual contra `next dev` real, sesión de `admin_acueducto` (CA-3, CA-4, CA-4b) y de
un rol sin permiso de anular.

**Estado:** COMPLETADO — auditoría real sin bloqueantes; 1 inconsistencia menor corregida (`h1`
con `text-3xl font-semibold` en vez de `text-[28px] font-bold`, el patrón real de 027/030). `npm run
build` y `npm run lint` verificados en verde. Verificación visual en navegador real (CA-3, CA-4,
CA-4b con sesión de `admin_acueducto`) queda pendiente de Mateo.
