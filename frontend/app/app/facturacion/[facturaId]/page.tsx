'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  anularFactura,
  enviarCorreoFactura,
  obtenerFactura,
  urlPdfFactura,
  type DetalleFactura,
  type Factura,
} from '@/lib/api';

interface PageProps {
  params: Promise<{ facturaId: string }>;
}

export default function DetalleFacturaPage({ params }: PageProps) {
  const { facturaId } = use(params);
  const [factura, setFactura] = useState<Factura | null>(null);
  const [detalles, setDetalles] = useState<DetalleFactura[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!facturaId) return;
    obtenerFactura(facturaId)
      .then((r) => {
        setFactura(r.factura);
        setDetalles(r.detalles);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar la factura'));
  }, [facturaId]);

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
          <p className="text-base"><strong>Total:</strong> ${factura.total.toLocaleString('es-CO')}</p>
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

      {factura.estado !== 'anulada' && (
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
