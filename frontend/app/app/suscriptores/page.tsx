'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SuscriptorForm } from '@/components/suscriptor-form';
import { listarSuscriptores, type Suscriptor } from '@/lib/api';

// 040: mismo criterio de Badge que la ficha (039/040) — constante local, sin
// compartir un módulo de "badges de estado" para tan pocos usos (CLAUDE.md
// §1: no sobre-diseñar).
const BADGE_ESTADO: Record<Suscriptor['estado'], { variante: 'success' | 'warning' | 'danger' | 'gray'; etiqueta: string }> = {
  activo: { variante: 'success', etiqueta: 'Activo' },
  suspendido: { variante: 'warning', etiqueta: 'Suspendido' },
  cortado: { variante: 'danger', etiqueta: 'Cortado' },
  inactivo: { variante: 'gray', etiqueta: 'Inactivo' },
};

export default function SuscriptoresPage() {
  const [suscriptores, setSuscriptores] = useState<Suscriptor[] | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    listarSuscriptores(filtroEstado || undefined)
      .then((r) => setSuscriptores(r.suscriptores))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los suscriptores'));
  }, [filtroEstado]);

  // 040 CA-1: filtro de texto 100% en el cliente, sin llamada nueva — mismo
  // criterio que 030/032/039.
  const texto = busqueda.trim().toLocaleLowerCase();
  const suscriptoresFiltrados = (suscriptores ?? []).filter(
    (s) => !texto || s.nombre.toLocaleLowerCase().includes(texto) || s.codigo_suscriptor.toLocaleLowerCase().includes(texto),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Suscriptores</p>
          <h1 className="text-[28px] font-bold tracking-tight">Suscriptores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {suscriptores === null ? 'Cargando…' : `${suscriptores.length} suscriptores registrados.`}
          </p>
        </div>
        <Link href="/app/suscriptores/importar" className="text-sm text-accent hover:underline">
          Importar desde Excel →
        </Link>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Lista</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm sm:w-72"
              placeholder="Buscar por nombre o código…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <select
              className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
            >
              <option value="">Todos los estados</option>
              <option value="activo">Activo</option>
              <option value="suspendido">Suspendido</option>
              <option value="cortado">Cortado</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>

          {suscriptores === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {suscriptores?.length === 0 && <p className="text-sm text-muted-foreground">Sin suscriptores todavía.</p>}
          {suscriptores !== null && suscriptores.length > 0 && suscriptoresFiltrados.length === 0 && (
            <p className="text-sm text-muted-foreground">Ningún suscriptor coincide con la búsqueda.</p>
          )}

          {suscriptoresFiltrados.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3 font-medium">Suscriptor</th>
                    <th className="px-3 py-3 font-medium">Categoría</th>
                    <th className="px-3 py-3 font-medium">Estado</th>
                    <th className="px-3 py-3 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {suscriptoresFiltrados.map((s) => {
                    const badge = BADGE_ESTADO[s.estado];
                    return (
                      <tr key={s.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-4">
                          <p className="font-medium">{s.nombre}</p>
                          <p className="text-xs text-muted-foreground">{s.codigo_suscriptor}</p>
                        </td>
                        <td className="px-3 py-4 text-muted-foreground">{s.categoria ?? '—'}</td>
                        <td className="px-3 py-4">
                          <Badge variante={badge.variante}>{badge.etiqueta}</Badge>
                        </td>
                        <td className="px-3 py-4 text-right">
                          <Link
                            href={`/app/suscriptores/${s.id}`}
                            className="text-sm font-medium text-accent hover:underline"
                          >
                            Abrir
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

      <Card>
        <CardHeader>
          <CardTitle>Nuevo suscriptor</CardTitle>
        </CardHeader>
        <CardContent>
          <SuscriptorForm onCreado={(suscriptor) => setSuscriptores((prev) => [...(prev ?? []), suscriptor])} />
        </CardContent>
      </Card>
    </main>
  );
}
