'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  emitirPeriodo,
  enviarCorreoPeriodo,
  listarFacturasDePeriodo,
  listarPeriodos,
  obtenerContextoUsuario,
  simularPeriodo,
  type EstadoFactura,
  type Factura,
  type Periodo,
  type ResumenSimulacion,
} from '@/lib/api';
import { configuracionEstado, formatearCategoria } from '@/lib/formato-factura';

const nombresAnomalia: Record<string, string> = {
  consumo_atipico: 'Consumo atípico',
  usuario_sin_lectura: 'Sin lectura',
  sin_tarifa: 'Sin tarifa (no se emite, 9d)',
  total_cero_o_negativo: 'Total cero/negativo',
  variacion_superior_20: 'Variación > 20% vs periodo anterior',
};

export default function FacturacionPage() {
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [periodoId, setPeriodoId] = useState('');
  const [facturas, setFacturas] = useState<Factura[] | null>(null);
  const [resumen, setResumen] = useState<ResumenSimulacion | null>(null);
  const [simulado, setSimulado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [rol, setRol] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFactura | ''>('');

  useEffect(() => {
    async function cargarContexto() {
      try {
        const respuesta = await obtenerContextoUsuario();
        const rolActual = respuesta.cliente.rol;

        setRol(rolActual);

        if (rolActual === 'lector') return;

        try {
          const periodosRespuesta = await listarPeriodos();
          setPeriodos(periodosRespuesta.periodos);
        } catch {
          setPeriodos([]);
        }
      } catch {
        setRol('admin_acueducto');

        try {
          const periodosRespuesta = await listarPeriodos();
          setPeriodos(periodosRespuesta.periodos);
        } catch {
          setPeriodos([]);
        }
      }
    }

    void cargarContexto();
  }, []);

  async function cargarFacturas(pid: string) {
    try {
      const respuesta = await listarFacturasDePeriodo(pid);
      setFacturas(respuesta.facturas);
    } catch {
      setFacturas([]);
    }
  }

  async function alSeleccionarPeriodo(pid: string) {
    setPeriodoId(pid);
    setResumen(null);
    setSimulado(false);
    setError(null);
    setInfo(null);
    setBusqueda('');
    setEstadoFiltro('');

    if (pid) await cargarFacturas(pid);
    else setFacturas(null);
  }

  async function alSimular() {
    if (!periodoId) return;

    setError(null);
    setInfo(null);
    setTrabajando(true);

    try {
      const respuesta = await simularPeriodo(periodoId);
      setResumen(respuesta.resumen);
      setSimulado(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo simular el periodo');
    } finally {
      setTrabajando(false);
    }
  }

  async function alEmitir() {
    if (!periodoId || !simulado) return;

    if (
      !window.confirm(
        '¿Confirmar la emisión de las facturas del periodo? Revisa el resumen de la simulación antes.',
      )
    ) {
      return;
    }

    setError(null);
    setInfo(null);
    setTrabajando(true);

    try {
      const respuesta = await emitirPeriodo(periodoId);
      setInfo(
        `${respuesta.mensaje} · encoladas ${respuesta.encoladas}, omitidas ${respuesta.omitidas}`,
      );
      setSimulado(false);
      await cargarFacturas(periodoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo emitir el periodo');
    } finally {
      setTrabajando(false);
    }
  }

  async function alEnviarCorreosPeriodo() {
    if (!periodoId || !facturas?.length) return;

    if (
      !window.confirm(
        '¿Enviar el correo con el PDF a los suscriptores de las facturas del periodo que tengan email? (sin email se entregan impresas)',
      )
    ) {
      return;
    }

    setError(null);
    setInfo(null);
    setTrabajando(true);

    try {
      const respuesta = await enviarCorreoPeriodo(periodoId);
      setInfo(
        `${respuesta.mensaje} · encolados ${respuesta.encoladas}, omitidos ${respuesta.omitidas}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo encolar el lote de correos');
    } finally {
      setTrabajando(false);
    }
  }

  const periodoSeleccionado = useMemo(
    () => periodos?.find((periodo) => periodo.id === periodoId) ?? null,
    [periodos, periodoId],
  );

  const facturasFiltradas = useMemo(() => {
    if (!facturas) return null;

    const texto = busqueda.trim().toLocaleLowerCase();

    return facturas.filter((factura) => {
      const nombre = String(factura.snapshot_suscriptor.nombre ?? '');
      const coincideBusqueda =
        !texto ||
        factura.numero.toLocaleLowerCase().includes(texto) ||
        nombre.toLocaleLowerCase().includes(texto);
      const coincideEstado = !estadoFiltro || factura.estado === estadoFiltro;

      return coincideBusqueda && coincideEstado;
    });
  }, [busqueda, estadoFiltro, facturas]);

  const facturasVencidas = useMemo(
    () => facturas?.filter((factura) => factura.estado === 'vencida') ?? [],
    [facturas],
  );

  const saldoVencido = useMemo(
    () =>
      facturasVencidas.reduce(
        (saldo, factura) => saldo + (factura.total - factura.total_pagado),
        0,
      ),
    [facturasVencidas],
  );

  if (rol === null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-8">
        <p className="text-sm text-muted-foreground">Cargando facturación…</p>
      </main>
    );
  }

  if (rol === 'lector') {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-8">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-lg font-semibold">No autorizado</p>
          <p className="text-sm text-muted-foreground">
            Las facturas del acueducto son visibles solo para quien administra la facturación.
          </p>
          <Link href="/app/lecturas" className="text-sm text-accent hover:underline">
            Ir a lecturas →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-8">
      <section className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Facturación</p>
          <h1 className="text-[28px] font-bold tracking-tight">Facturas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {periodoSeleccionado
              ? `${periodoSeleccionado.nombre} · ${periodoSeleccionado.estado}`
              : 'Selecciona un periodo para consultar sus facturas.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={periodoId}
            onChange={(e) => void alSeleccionarPeriodo(e.target.value)}
          >
            <option value="">Selecciona un periodo…</option>
            {(periodos ?? []).map((periodo) => (
              <option key={periodo.id} value={periodo.id}>
                {periodo.nombre} ({periodo.estado})
              </option>
            ))}
          </select>

          {rol === 'admin_acueducto' && (
            <>
              <button
                className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={() => void alSimular()}
                disabled={!periodoId || trabajando}
              >
                {trabajando ? 'Procesando…' : 'Simular periodo'}
              </button>
              {simulado && (
                <button
                  className="h-9 rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
                  onClick={() => void alEmitir()}
                  disabled={trabajando}
                >
                  Confirmar emisión
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {info && <p className="text-sm text-green-700">{info}</p>}

      {facturasVencidas.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4">
          <Badge variante="danger">Atención</Badge>
          <p className="text-sm text-danger">
            {facturasVencidas.length}{' '}
            {facturasVencidas.length === 1 ? 'factura vencida' : 'facturas vencidas'} por un saldo de{' '}
            <strong>${saldoVencido.toLocaleString('es-CO')}</strong>.
          </p>
        </div>
      )}

      {resumen && (
        <Card>
          <CardHeader>
            <CardTitle>Resumen de la simulación</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              Suscriptores: <strong>{resumen.totalSuscriptores}</strong> · con factura:{' '}
              <strong>{resumen.suscriptoresConFactura}</strong> · consumo total:{' '}
              <strong>{resumen.consumoTotalM3} m³</strong> · facturación total:{' '}
              <strong>${resumen.facturacionTotal.toLocaleString('es-CO')}</strong>
            </p>
            {resumen.anomalias.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3">
                {resumen.anomalias.map((anomalia, indice) => (
                  <li key={`${anomalia.tipo}-${indice}`}>
                    {nombresAnomalia[anomalia.tipo] ?? anomalia.tipo} — {anomalia.detalle}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-green-700">Sin anomalías.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Facturas del periodo</CardTitle>
            {facturas && facturas.length > 0 && (
              <button
                className="h-9 rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 print:hidden"
                onClick={() => void alEnviarCorreosPeriodo()}
                disabled={trabajando}
              >
                {trabajando ? 'Encolando…' : 'Enviar correos del periodo'}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {facturas !== null && facturas.length > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="search"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm sm:flex-1"
                placeholder="Buscar por número o suscriptor…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <select
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                value={estadoFiltro}
                onChange={(e) => setEstadoFiltro(e.target.value as EstadoFactura | '')}
              >
                <option value="">Todos los estados</option>
                <option value="pendiente">Pendiente</option>
                <option value="pagada">Pagada</option>
                <option value="vencida">Vencida</option>
                <option value="anulada">Anulada</option>
              </select>
            </div>
          )}

          {facturas === null && <p className="text-sm text-muted-foreground">Selecciona un periodo…</p>}
          {facturas?.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin facturas emitidas para este periodo.</p>
          )}
          {facturas !== null && facturas.length > 0 && facturasFiltradas?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay facturas que coincidan con los filtros seleccionados.
            </p>
          )}

          {facturasFiltradas && facturasFiltradas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3 font-medium">Suscriptor</th>
                    <th className="px-3 py-3 font-medium">Factura</th>
                    <th className="px-3 py-3 font-medium">Total</th>
                    <th className="px-3 py-3 font-medium">Estado</th>
                    <th className="px-3 py-3 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {facturasFiltradas.map((factura) => {
                    const estado = configuracionEstado[factura.estado];
                    const nombre = String(factura.snapshot_suscriptor.nombre ?? '—');
                    const codigo = String(factura.snapshot_suscriptor.codigo_suscriptor ?? '—');
                    const categoria = formatearCategoria(factura.snapshot_suscriptor.categoria);

                    return (
                      <tr key={factura.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-4">
                          <p className="font-medium">{nombre}</p>
                          <p className="text-xs text-muted-foreground">
                            {codigo} · {categoria}
                          </p>
                        </td>
                        <td className="px-3 py-4 font-medium">{factura.numero}</td>
                        <td className="px-3 py-4">
                          ${factura.total.toLocaleString('es-CO')}
                        </td>
                        <td className="px-3 py-4">
                          <Badge variante={estado.variante}>{estado.etiqueta}</Badge>
                        </td>
                        <td className="px-3 py-4 text-right">
                          <Link
                            href={`/app/facturacion/${factura.id}`}
                            className="text-sm font-medium text-accent hover:underline"
                          >
                            Ver
                          </Link>
                        </td>
                      </tr>
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