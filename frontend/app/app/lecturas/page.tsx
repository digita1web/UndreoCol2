'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  crearLectura,
  listarLecturas,
  listarPeriodos,
  listarSuscriptores,
  revisarLectura,
  type Lectura,
  type Periodo,
  type Suscriptor,
} from '@/lib/api';

export default function LecturasPage() {
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [suscriptores, setSuscriptores] = useState<Suscriptor[] | null>(null);
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState<string>('');
  const [soloAnomalias, setSoloAnomalias] = useState(false);
  const [lecturas, setLecturas] = useState<Lectura[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // alta manual
  const [contadorSel, setContadorSel] = useState('');
  const [lecturaActual, setLecturaActual] = useState('');
  const [fechaLectura, setFechaLectura] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    listarPeriodos().then((r) => setPeriodos(r.periodos)).catch(() => setPeriodos([]));
    listarSuscriptores().then((r) => setSuscriptores(r.suscriptores)).catch(() => setSuscriptores([]));
  }, []);

  useEffect(() => {
    if (!periodoSeleccionado) {
      setLecturas([]);
      return;
    }
    setLecturas(null);
    listarLecturas({ periodoId: periodoSeleccionado, soloAnomalias })
      .then((r) => setLecturas(r.lecturas))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las lecturas'));
  }, [periodoSeleccionado, soloAnomalias]);

  const contadores = (suscriptores ?? [])
    .filter((s) => s.contador_actual_id)
    .map((s) => ({ id: s.contador_actual_id!, nombre: s.nombre, codigo: s.codigo_suscriptor }));

  async function alCrearLectura() {
    setError(null);
    const valor = Number(lecturaActual);
    if (!contadorSel || !periodoSeleccionado || !fechaLectura || Number.isNaN(valor)) {
      setError('Selecciona contador, periodo, fecha y lectura actual.');
      return;
    }
    try {
      await crearLectura({
        contador_id: contadorSel,
        periodo_id: periodoSeleccionado,
        fecha_lectura: fechaLectura,
        lectura_actual: valor,
      });
      setLecturaActual('');
      const r = await listarLecturas({ periodoId: periodoSeleccionado, soloAnomalias });
      setLecturas(r.lecturas);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la lectura');
    }
  }

  async function alRevisar(id: string) {
    setError(null);
    try {
      await revisarLectura(id);
      const r = await listarLecturas({ periodoId: periodoSeleccionado, soloAnomalias });
      setLecturas(r.lecturas);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar como revisada');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Lecturas</h1>
        <Link href="/app/lecturas/periodo" className="text-sm text-blue-600 hover:underline">
          Gestionar periodo →
        </Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Consulta por periodo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <select
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={periodoSeleccionado}
            onChange={(e) => setPeriodoSeleccionado(e.target.value)}
          >
            <option value="">Selecciona un periodo…</option>
            {(periodos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} ({p.estado})
              </option>
            ))}
          </select>
          <label className="flex w-fit items-center gap-2 text-sm">
            <input type="checkbox" checked={soloAnomalias} onChange={(e) => setSoloAnomalias(e.target.checked)} />
            Solo anomalías pendientes de revisión
          </label>
          {lecturas?.length === 0 && <p className="text-sm text-muted-foreground">Sin lecturas para este filtro.</p>}
          {lecturas?.map((l) => (
            <div key={l.id} className="flex items-start justify-between border-b border-border py-2 last:border-0">
              <div>
                <p className="text-sm font-medium">
                  Contador {l.contador_id.slice(0, 8)} · {l.consumo_m3} m³
                  {l.hubo_rollover && ' · (rollover)'}
                </p>
                <p className="text-xs text-muted-foreground">
                  lectura {l.lectura_anterior} → {l.lectura_actual} · {l.fecha_lectura}
                  {l.revision !== 'normal' && ` · revisión: ${l.revision}`}
                </p>
              </div>
              {l.revision !== 'normal' && !l.revisada && (
                <button
                  className="h-8 w-fit rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                  onClick={() => alRevisar(l.id)}
                >
                  Marcar revisada
                </button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nueva lectura</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <select
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={contadorSel}
            onChange={(e) => setContadorSel(e.target.value)}
          >
            <option value="">Contador…</option>
            {contadores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} ({c.codigo})
              </option>
            ))}
          </select>
          <input
            type="date"
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={fechaLectura}
            onChange={(e) => setFechaLectura(e.target.value)}
          />
          <input
            type="number"
            className="h-9 w-40 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Lectura actual (m³)"
            value={lecturaActual}
            onChange={(e) => setLecturaActual(e.target.value)}
          />
          <button
            className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
            onClick={alCrearLectura}
          >
            Guardar lectura
          </button>
        </CardContent>
      </Card>
    </main>
  );
}

