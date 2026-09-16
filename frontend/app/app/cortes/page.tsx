'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listarCandidatosCorte, type CandidatoCorte } from '@/lib/api';

// Sugerencia por umbral (spec.md §5, decisión 1 aprobada): esta lista NUNCA
// corta por sí sola — el admin decide y ejecuta el corte desde el detalle de
// cada suscriptor, con motivo obligatorio. 042: la propuesta visual muestra
// un botón "Ejecutar corte" por fila — no se adopta, sigue siendo la misma
// decisión aprobada de 009 (spec 042 §3.2).
export default function CortesPage() {
  const [candidatos, setCandidatos] = useState<CandidatoCorte[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarCandidatosCorte()
      .then((r) => setCandidatos(r.candidatos))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los candidatos'));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Cortes y reconexión</p>
          <h1 className="text-[28px] font-bold tracking-tight">Gestión de cortes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {candidatos === null
              ? 'Cargando…'
              : `${candidatos.length} candidato(s) con mora por encima del umbral configurado.`}
          </p>
        </div>
        <Link href="/app/dashboard" className="text-sm text-accent hover:underline">
          ← Dashboard
        </Link>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Candidatos a corte</CardTitle>
        </CardHeader>
        <CardContent>
          {candidatos === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {candidatos?.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin candidatos a corte por ahora.</p>
          )}
          {candidatos && candidatos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3 font-medium">Suscriptor</th>
                    <th className="px-3 py-3 font-medium">Días de mora</th>
                    <th className="px-3 py-3 font-medium">Deuda vencida</th>
                    <th className="px-3 py-3 font-medium">Estado</th>
                    <th className="px-3 py-3 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {candidatos.map((c) => (
                    <tr key={c.usuarioServicioId} className="border-b border-border last:border-0">
                      <td className="px-3 py-4">
                        <p className="font-medium">{c.nombre}</p>
                        <p className="text-xs text-muted-foreground">{c.codigoSuscriptor}</p>
                      </td>
                      <td className="px-3 py-4">{c.diasMoraMax} días</td>
                      <td className="px-3 py-4 font-medium">${c.vencida.toLocaleString('es-CO')}</td>
                      <td className="px-3 py-4">
                        <Badge variante="danger">Candidato</Badge>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <Link href={`/app/suscriptores/${c.usuarioServicioId}`} className="text-sm font-medium text-accent hover:underline">
                          Ver ficha →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
