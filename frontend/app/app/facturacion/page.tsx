'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  emitirPeriodo,
  enviarCorreoPeriodo,
  listarFacturasDePeriodo,
  listarPeriodos,
  simularPeriodo,
  type Factura,
  type Periodo,
  type ResumenSimulacion,
} from '@/lib/api';

export default function FacturacionPage() {
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [periodoId, setPeriodoId] = useState('');
  const [facturas, setFacturas] = useState<Factura[] | null>(null);
  const [resumen, setResumen] = useState<ResumenSimulacion | null>(null);
  const [simulado, setSimulado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    listarPeriodos().then((r) => setPeriodos(r.periodos)).catch(() => setPeriodos([]));
  }, []);

  async function cargarFacturas(pid: string) {
    try {
      const r = await listarFacturasDePeriodo(pid);
      setFacturas(r.facturas);
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
    if (pid) await cargarFacturas(pid);
    else setFacturas(null);
  }

  async function alSimular() {
    if (!periodoId) return;
    setError(null);
    setInfo(null);
    setTrabajando(true);
    try {
      const r = await simularPeriodo(periodoId);
      setResumen(r.resumen);
      setSimulado(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo simular el periodo');
    } finally {
      setTrabajando(false);
    }
  }

  async function alEmitir() {
    if (!periodoId || !simulado) return;
    if (!window.confirm('¿Confirmar la emisión de las facturas del periodo? Revisa el resumen de la simulación antes.')) return;
    setError(null);
    setInfo(null);
    setTrabajando(true);
    try {
      const r = await emitirPeriodo(periodoId);
      setInfo(`${r.mensaje} · encoladas ${r.encoladas}, omitidas ${r.omitidas}`);
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
    if (!window.confirm('¿Enviar el correo con el PDF a los suscriptores de las facturas del periodo que tengan email? (sin email se entregan impresas)')) return;
    setError(null);
    setInfo(null);
    setTrabajando(true);
    try {
      const r = await enviarCorreoPeriodo(periodoId);
      setInfo(`${r.mensaje} · encolados ${r.encoladas}, omitidos ${r.omitidas}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo encolar el lote de correos');
    } finally {
      setTrabajando(false);
    }
  }

  const nombresAnomalia: Record<string, string> = {
    consumo_atipico: 'Consumo atípico',
    usuario_sin_lectura: 'Sin lectura',
    sin_tarifa: 'Sin tarifa (no se emite, 9d)',
    total_cero_o_negativo: 'Total cero/negativo',
    variacion_superior_20: 'Variación > 20% vs periodo anterior',
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Facturación</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {info && <p className="text-sm text-green-700">{info}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Cierre del periodo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <select
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={periodoId}
            onChange={(e) => alSeleccionarPeriodo(e.target.value)}
          >
            <option value="">Selecciona un periodo…</option>
            {(periodos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} ({p.estado})
              </option>
            ))}
          </select>
          <div className="flex gap-3">
            <button
              className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={alSimular}
              disabled={!periodoId || trabajando}
            >
              {trabajando ? 'Procesando…' : 'Simular periodo'}
            </button>
            {simulado && (
              <button
                className="h-9 w-fit rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
                onClick={alEmitir}
                disabled={trabajando}
              >
                Confirmar emisión
              </button>
            )}
          </div>
        </CardContent>
      </Card>

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
                {resumen.anomalias.map((a, i) => (
                  <li key={i}>
                    {nombresAnomalia[a.tipo] ?? a.tipo} — {a.detalle}
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
                className="h-9 w-fit rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 print:hidden"
                onClick={alEnviarCorreosPeriodo}
                disabled={trabajando}
              >
                {trabajando ? 'Encolando…' : 'Enviar correos del periodo'}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {facturas === null && <p className="text-sm text-muted-foreground">Selecciona un periodo…</p>}
          {facturas?.length === 0 && <p className="text-sm text-muted-foreground">Sin facturas emitidas para este periodo.</p>}
          {facturas?.map((f) => (
            <div key={f.id} className="border-b border-border py-2 last:border-0">
              <Link href={`/app/facturacion/${f.id}`} className="font-medium hover:underline">
                {f.numero}
              </Link>
              <p className="text-xs text-muted-foreground">
                {(f.snapshot_suscriptor.nombre as string) ?? '—'} · $
                {f.total.toLocaleString('es-CO')} · {f.estado}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}

