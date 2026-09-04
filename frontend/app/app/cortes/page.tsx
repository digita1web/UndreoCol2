'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listarCandidatosCorte, type CandidatoCorte } from '@/lib/api';

// Sugerencia por umbral (spec.md §5, decisión 1 aprobada): esta lista NUNCA
// corta por sí sola — el admin decide y ejecuta el corte desde el detalle de
// cada suscriptor, con motivo obligatorio.
export default function CortesPage() {
  const [candidatos, setCandidatos] = useState<CandidatoCorte[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarCandidatosCorte()
      .then((r) => setCandidatos(r.candidatos))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los candidatos'));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Candidatos a corte</h1>
        <Link href="/app/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Suscriptores con mora por encima del umbral configurado</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {candidatos === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {candidatos?.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin candidatos a corte por ahora.</p>
          )}
          {candidatos?.map((c) => (
            <Link
              key={c.usuarioServicioId}
              href={`/app/suscriptores/${c.usuarioServicioId}`}
              className="border-b border-border py-2 text-sm last:border-0 hover:underline"
            >
              <p className="font-medium">{c.nombre} ({c.codigoSuscriptor})</p>
              <p className="text-xs text-muted-foreground">
                Deuda vencida: ${c.vencida.toLocaleString('es-CO')} · {c.diasMoraMax} días de mora
              </p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
