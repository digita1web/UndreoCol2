'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { obtenerPagosDeSuscriptor, obtenerSuscriptor, type PagoHistorial, type Suscriptor } from '@/lib/api';

const NOMBRES_METODO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  consignacion: 'Consignación',
  pse: 'PSE',
  otro: 'Otro',
};

interface PageProps {
  params: Promise<{ suscriptorId: string }>;
}

export default function HistorialPagosSuscriptorPage({ params }: PageProps) {
  const { suscriptorId } = use(params);
  const [suscriptor, setSuscriptor] = useState<Suscriptor | null>(null);
  const [pagos, setPagos] = useState<PagoHistorial[] | null>(null);
  const [saldoFavor, setSaldoFavor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!suscriptorId) return;
    obtenerSuscriptor(suscriptorId)
      .then((r) => setSuscriptor(r.suscriptor))
      .catch(() => setSuscriptor(null));
    obtenerPagosDeSuscriptor(suscriptorId)
      .then((r) => {
        setPagos(r.pagos);
        setSaldoFavor(r.saldoFavor);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el historial'));
  }, [suscriptorId]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{suscriptor?.nombre ?? 'Historial de pagos'}</h1>
        <Link href="/app/pagos" className="text-sm text-blue-600 hover:underline">
          ← Cartera
        </Link>
      </div>
      {suscriptor && <p className="text-sm text-muted-foreground">{suscriptor.codigo_suscriptor} · {suscriptor.estado}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Saldo a favor</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={saldoFavor > 0 ? 'text-lg font-medium text-green-700' : 'text-lg'}>
            ${saldoFavor.toLocaleString('es-CO')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de pagos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pagos === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {pagos?.length === 0 && <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>}
          {pagos?.map((p) => (
            <div key={p.id} className="border-b border-border pb-3 text-sm last:border-0">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  ${p.valor.toLocaleString('es-CO')} · {NOMBRES_METODO[p.metodo] ?? p.metodo}
                </p>
                <p className="text-xs text-muted-foreground">{p.fecha_pago}</p>
              </div>
              {p.referencia && <p className="text-xs text-muted-foreground">Referencia: {p.referencia}</p>}
              <p className="text-xs text-muted-foreground">
                {p.aplicaciones.length > 0
                  ? `Aplicado a ${p.aplicaciones.length} factura(s): $${p.aplicaciones
                      .reduce((acc, a) => acc + a.valor, 0)
                      .toLocaleString('es-CO')}`
                  : 'Sin aplicar a ninguna factura'}
                {p.sinAplicar > 0 && ` · sin aplicar: $${p.sinAplicar.toLocaleString('es-CO')}`}
              </p>
              {p.anulado ? (
                <p className="text-xs text-red-600">Anulado: {p.motivo_anulacion}</p>
              ) : (
                <p className="text-xs text-green-700">Vigente</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
