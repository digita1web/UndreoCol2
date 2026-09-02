'use client';

import { use, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TarifaForm } from '@/components/tarifa-form';
import { listarServicios, listarTarifas, type Servicio, type Tarifa } from '@/lib/api';

const CATEGORIAS = [
  'estrato_1', 'estrato_2', 'estrato_3', 'estrato_4', 'estrato_5', 'estrato_6',
  'comercial', 'industrial', 'oficial',
] as const;

interface PageProps {
  params: Promise<{ servicioId: string }>;
}

export default function HistorialTarifasPage({ params }: PageProps) {
  const { servicioId } = use(params);
  const [servicio, setServicio] = useState<Servicio | null>(null);
  const [categoria, setCategoria] = useState<string>('estrato_3');
  const [tarifas, setTarifas] = useState<Tarifa[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarServicios()
      .then((r) => setServicio(r.servicios.find((s) => s.id === servicioId) ?? null))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el servicio'));
  }, [servicioId]);

  function recargarHistorial() {
    setError(null);
    listarTarifas(servicioId, categoria)
      .then((r) => setTarifas(r.tarifas))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el historial de tarifas'));
  }

  useEffect(() => {
    recargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId, categoria]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{servicio?.nombre ?? 'Servicio'}</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Historial de tarifas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <select
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {tarifas === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {tarifas?.length === 0 && <p className="text-sm text-muted-foreground">Sin tarifas para esta categoría.</p>}
          {tarifas?.map((t) => (
            <div key={t.id} className="border-b border-border py-2 text-sm last:border-0">
              <p className="font-medium">
                {t.vigencia_desde} — {t.vigencia_hasta ?? 'vigente'}
              </p>
              <p className="text-xs text-muted-foreground">
                Cargo fijo {t.cargo_fijo} · límite {t.limite_basico_m3} m³ · básico {t.precio_basico_m3}/m³ · no básico {t.precio_no_basico_m3}/m³
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nueva tarifa</CardTitle>
        </CardHeader>
        <CardContent>
          <TarifaForm servicioId={servicioId} onCreada={recargarHistorial} />
        </CardContent>
      </Card>
    </main>
  );
}
