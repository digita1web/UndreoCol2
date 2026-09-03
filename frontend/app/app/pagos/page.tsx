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
