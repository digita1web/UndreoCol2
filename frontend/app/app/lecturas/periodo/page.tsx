'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  cerrarPeriodo,
  crearPeriodo,
  listarPeriodos,
  type Periodo,
} from '@/lib/api';

function hoy(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function inicialesDelMes() {
  const base = hoy();
  const inicio = new Date(base);
  const fin = new Date(base.getFullYear(), base.getMonth() + 1, 0); // último día del mes
  const vencimiento = new Date(base.getFullYear(), base.getMonth() + 1, fin.getDate()); // ~mes siguiente
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    anio: base.getFullYear(),
    mes: base.getMonth() + 1,
    fecha_inicio: fmt(inicio),
    fecha_fin: fmt(fin),
    fecha_vencimiento: fmt(vencimiento),
  };
}

export default function PeriodoPage() {
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const recargar = () =>
    listarPeriodos()
      .then((r) => setPeriodos(r.periodos))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los periodos'));

  useEffect(() => {
    recargar();
  }, []);

  const abierto = periodos?.find((p) => p.estado === 'abierto');

  async function alCrearPeriodo() {
    setError(null);
    setCreando(true);
    try {
      const def = inicialesDelMes();
      const nombre = new Date(def.anio, def.mes - 1, 1).toLocaleString('es-CO', { month: 'long', year: 'numeric' });
      await crearPeriodo({
        nombre,
        anio: def.anio,
        mes: def.mes,
        fecha_inicio: def.fecha_inicio,
        fecha_fin: def.fecha_fin,
        fecha_vencimiento: def.fecha_vencimiento,
      });
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el periodo');
    } finally {
      setCreando(false);
    }
  }

  async function alCerrarPeriodo() {
    if (!abierto) return;
    setError(null);
    if (!window.confirm(`¿Cerrar el periodo "${abierto.nombre}"? No aceptará más lecturas.`)) return;
    try {
      await cerrarPeriodo(abierto.id);
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el periodo');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Periodo de facturación</h1>
        <Link href="/app/lecturas" className="text-sm text-blue-600 hover:underline">
          ← Lecturas
        </Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Periodo del mes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!abierto && (
            <>
              <p className="text-sm text-muted-foreground">
                No hay un periodo abierto. Se creará el del mes actual (el primer periodo abierto de
                este acueducto).
              </p>
              <button
                className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={alCrearPeriodo}
                disabled={creando}
              >
                {creando ? 'Creando…' : 'Crear periodo del mes'}
              </button>
            </>
          )}

          {abierto && (
            <div className="flex flex-col gap-3">
              <div>
                <p className="font-medium">{abierto.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  {abierto.fecha_inicio} → {abierto.fecha_fin} · vence {abierto.fecha_vencimiento}
                </p>
              </div>
              <button
                className="h-9 w-fit rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
                onClick={alCerrarPeriodo}
              >
                Cerrar periodo
              </button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Solo puede haber <strong>un periodo abierto</strong> a la vez. Un periodo cerrado es
            inmutable: no acepta más lecturas.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de periodos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {periodos === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {periodos?.length === 0 && <p className="text-sm text-muted-foreground">Sin periodos todavía.</p>}
          {periodos?.map((p) => (
            <div key={p.id} className="border-b border-border py-2 last:border-0">
              <p className="text-sm font-medium">{p.nombre}</p>
              <p className="text-xs text-muted-foreground">
                {p.estado}
                {p.fecha_cierre && ` · cerrado ${p.fecha_cierre.slice(0, 10)}`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
