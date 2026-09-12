'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PagoForm } from '@/components/pago-form';
import { obtenerCartera, type FilaCartera, type ResultadoRegistrarPago } from '@/lib/api';

export default function CarteraPage() {
  const [cartera, setCartera] = useState<FilaCartera[] | null>(null);
  const [soloMorosos, setSoloMorosos] = useState(false);
  const [pagoAbiertoPara, setPagoAbiertoPara] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setError(null);
    obtenerCartera({ soloMorosos })
      .then((respuesta) => setCartera(respuesta.cartera))
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

  const carteraOrdenada = useMemo(() => {
    if (!cartera) return null;

    return [...cartera].sort((a, b) => {
      const diferenciaVencida = b.vencida - a.vencida;
      if (diferenciaVencida !== 0) return diferenciaVencida;
      return b.porVencer - a.porVencer;
    });
  }, [cartera]);

  const carteraFiltrada = useMemo(() => {
    if (!carteraOrdenada) return null;

    const texto = busqueda.trim().toLocaleLowerCase();
    if (!texto) return carteraOrdenada;

    return carteraOrdenada.filter((fila) =>
      [fila.nombre, fila.codigoSuscriptor].some((valor) =>
        valor.toLocaleLowerCase().includes(texto),
      ),
    );
  }, [busqueda, carteraOrdenada]);

  const filasEnMora = useMemo(
    () => cartera?.filter((fila) => fila.vencida > 0) ?? [],
    [cartera],
  );

  const totalVencido = useMemo(
    () => filasEnMora.reduce((total, fila) => total + fila.vencida, 0),
    [filasEnMora],
  );

  function obtenerEstadoUrgencia(fila: FilaCartera) {
    if (fila.vencida > 0) return { variante: 'danger' as const, etiqueta: 'En mora' };
    if (fila.porVencer > 0) return { variante: 'warning' as const, etiqueta: 'Por vencer' };
    return { variante: 'info' as const, etiqueta: 'Saldo a favor' };
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-8">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-accent">Cartera</p>
            <h1 className="text-[28px] font-bold tracking-tight">Suscriptores con deuda</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Consulta y registra pagos pendientes.
            </p>
          </div>
          <Link href="/app/dashboard" className="text-sm text-accent hover:underline">
            ← Dashboard
          </Link>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex w-fit items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={soloMorosos}
              onChange={(e) => setSoloMorosos(e.target.checked)}
            />
            Solo morosos (con deuda vencida)
          </label>
          <input
            type="search"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm sm:w-80"
            placeholder="Buscar por nombre o código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-green-700">{aviso}</p>}

      {filasEnMora.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4">
          <Badge variante="danger">Atención</Badge>
          <p className="text-sm text-danger">
            {filasEnMora.length}{' '}
            {filasEnMora.length === 1 ? 'suscriptor en mora' : 'suscriptores en mora'} ·{' '}
            <strong>${totalVencido.toLocaleString('es-CO')} vencido en total</strong>
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Suscriptores con deuda o saldo a favor</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {cartera === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {cartera?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin suscriptores con deuda ni saldo a favor.
            </p>
          )}
          {cartera !== null && cartera.length > 0 && carteraFiltrada?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay suscriptores que coincidan con la búsqueda.
            </p>
          )}

          {carteraFiltrada && carteraFiltrada.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3 font-medium">Suscriptor</th>
                    <th className="px-3 py-3 font-medium">Urgencia</th>
                    <th className="px-3 py-3 font-medium">Días de mora</th>
                    <th className="px-3 py-3 font-medium">Por vencer</th>
                    <th className="px-3 py-3 font-medium">Vencida</th>
                    <th className="px-3 py-3 font-medium">Total adeudado</th>
                    <th className="px-3 py-3 font-medium">Saldo a favor</th>
                    <th className="px-3 py-3 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {carteraFiltrada.map((fila) => {
                    const urgencia = obtenerEstadoUrgencia(fila);
                    const formularioAbierto = pagoAbiertoPara === fila.usuarioServicioId;

                    return (
                      <Fragment key={fila.usuarioServicioId}>
                        <tr className="border-b border-border last:border-0">
                          <td className="px-3 py-4">
                            <Link
                              href={`/app/pagos/${fila.usuarioServicioId}`}
                              className="font-medium hover:underline"
                            >
                              {fila.nombre}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {fila.codigoSuscriptor} · {fila.estado}
                            </p>
                          </td>
                          <td className="px-3 py-4">
                            <Badge variante={urgencia.variante}>{urgencia.etiqueta}</Badge>
                            {fila.facturaVencidaMasAntigua && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {fila.facturaVencidaMasAntigua.numero}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-4">
                            {fila.diasMoraMax === null ? '—' : `${fila.diasMoraMax} días`}
                          </td>
                          <td className="px-3 py-4">
                            ${fila.porVencer.toLocaleString('es-CO')}
                          </td>
                          <td className={fila.vencida > 0 ? 'px-3 py-4 font-medium text-danger' : 'px-3 py-4'}>
                            ${fila.vencida.toLocaleString('es-CO')}
                          </td>
                          <td className="px-3 py-4 font-medium">
                            ${fila.totalAdeudado.toLocaleString('es-CO')}
                          </td>
                          <td className={fila.saldoFavor > 0 ? 'px-3 py-4 font-medium text-success' : 'px-3 py-4'}>
                            ${fila.saldoFavor.toLocaleString('es-CO')}
                          </td>
                          <td className="px-3 py-4 text-right">
                            <button
                              className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
                              onClick={() =>
                                setPagoAbiertoPara(formularioAbierto ? null : fila.usuarioServicioId)
                              }
                            >
                              {formularioAbierto ? 'Cerrar' : 'Registrar pago'}
                            </button>
                          </td>
                        </tr>
                        {formularioAbierto && (
                          <tr className="border-b border-border last:border-0">
                            <td colSpan={8} className="bg-muted/30 px-3 py-4">
                              <PagoForm
                                usuarioServicioId={fila.usuarioServicioId}
                                onRegistrado={(resultado) => alRegistrar(fila, resultado)}
                                onCancelar={() => setPagoAbiertoPara(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}