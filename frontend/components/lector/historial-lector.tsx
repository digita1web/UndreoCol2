'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listarLecturas, type Lectura, type Periodo } from '@/lib/api';

interface HistorialLectorProps {
  periodos: Periodo[] | null;
}

export function HistorialLector({ periodos }: HistorialLectorProps) {
  const [periodoSel, setPeriodoSel] = useState('');
  const [lecturas, setLecturas] = useState<Lectura[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!periodoSel) {
      setLecturas(null);
      return;
    }
    setLecturas(null);
    listarLecturas({ periodoId: periodoSel })
      .then((r) => setLecturas(r.lecturas))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las lecturas'));
  }, [periodoSel]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial por periodo</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <select
          className="h-11 rounded-md border border-border bg-background px-3 text-sm"
          value={periodoSel}
          onChange={(e) => setPeriodoSel(e.target.value)}
        >
          <option value="">Elegí un periodo…</option>
          {(periodos ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} ({p.estado})
            </option>
          ))}
        </select>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {periodoSel && lecturas?.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin lecturas en este periodo.</p>
        )}
        {lecturas?.map((l) => (
          <div key={l.id} className="flex items-start justify-between border-b border-border py-2 last:border-0">
            <div>
              <p className="text-sm font-medium">
                Contador {l.contador_id.slice(0, 8)} · {l.consumo_m3} m³
                {l.hubo_rollover && ' · (rollover)'}
              </p>
              <p className="text-xs text-muted-foreground">
                {l.lectura_anterior} → {l.lectura_actual} · {l.fecha_lectura}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
