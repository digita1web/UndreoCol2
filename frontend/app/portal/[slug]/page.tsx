'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  logoutPortal,
  obtenerConsumoPortal,
  obtenerFacturasPortal,
  obtenerSaldoFavorPortal,
  urlPdfFacturaPortal,
  type FacturaResumenPortal,
  type LecturaConsumoPortal,
} from '@/lib/api';

const formatoPeso = (v: number): string => `$${Math.round(v).toLocaleString('es-CO')}`;

export default function PortalSuscriptorPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [facturaActual, setFacturaActual] = useState<FacturaResumenPortal | null>(null);
  const [historial, setHistorial] = useState<FacturaResumenPortal[]>([]);
  const [saldoFavor, setSaldoFavor] = useState(0);
  const [lecturas, setLecturas] = useState<LecturaConsumoPortal[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      obtenerFacturasPortal(),
      obtenerSaldoFavorPortal(),
      obtenerConsumoPortal(),
    ])
      .then(([f, s, c]) => {
        setFacturaActual(f.facturaActual);
        setHistorial(f.historial);
        setSaldoFavor(s.saldoFavor);
        setLecturas(c.lecturas);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los datos'));
  }, []);

  async function alSalir() {
    try {
      await logoutPortal();
    } finally {
      router.push(`/portal/${slug}/login`);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Mi factura</h1>
        <button className="text-sm text-red-600 hover:underline" onClick={alSalir}>
          Salir
        </button>
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {facturaActual ? (
        <Card>
          <CardHeader>
            <CardTitle>Factura actual · {facturaActual.numero}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>
              <strong>Total:</strong> {formatoPeso(facturaActual.total)} ·{' '}
              <strong>Pagado:</strong> {formatoPeso(facturaActual.totalPagado)} ·{' '}
              <strong>Saldo:</strong> {formatoPeso(facturaActual.saldo)}
            </p>
            <p>
              <strong>Vence:</strong> {facturaActual.fechaVencimiento} ·{' '}
              <strong>Estado:</strong> {facturaActual.estado}
            </p>
            <a
              className="mt-2 w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              href={urlPdfFacturaPortal(facturaActual.id)}
              target="_blank"
              rel="noreferrer"
            >
              Ver PDF
            </a>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          No tiene una factura vigente.{historial.length > 0 ? ' Vea su historial abajo.' : ''}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Saldo a favor</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {saldoFavor > 0 ? formatoPeso(saldoFavor) : 'Sin saldo a favor.'}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de facturas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {historial.length === 0 && <p className="text-sm text-muted-foreground">Sin facturas anteriores.</p>}
          {historial.map((f) => (
            <div key={f.id} className="flex items-center justify-between border-b border-border py-1 text-sm last:border-0">
              <div>
                <p className="font-medium">{f.numero}</p>
                <p className="text-xs text-muted-foreground">
                  {formatoPeso(f.total)} · {f.estado} · vence {f.fechaVencimiento}
                </p>
              </div>
              <a
                className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                href={urlPdfFacturaPortal(f.id)}
                target="_blank"
                rel="noreferrer"
              >
                Ver PDF
              </a>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de consumo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {lecturas.length === 0 && <p className="text-sm text-muted-foreground">Sin lecturas registradas.</p>}
          {lecturas.map((l, i) => (
            <div key={i} className="flex justify-between border-b border-border py-1 last:border-0">
              <span>{l.fecha_lectura}</span>
              <span>
                {l.lectura_anterior} → {l.lectura_actual} m³ · consumo {l.consumo_m3} m³
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
