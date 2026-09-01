'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SuscriptorForm } from '@/components/suscriptor-form';
import { listarSuscriptores, type Suscriptor } from '@/lib/api';

export default function SuscriptoresPage() {
  const [suscriptores, setSuscriptores] = useState<Suscriptor[] | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    listarSuscriptores(filtroEstado || undefined)
      .then((r) => setSuscriptores(r.suscriptores))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los suscriptores'));
  }, [filtroEstado]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Suscriptores</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Lista</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
          {suscriptores === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {suscriptores?.length === 0 && <p className="text-sm text-muted-foreground">Sin suscriptores todavía.</p>}
          {suscriptores?.map((s) => (
            <div key={s.id} className="border-b border-border py-2 last:border-0">
              <Link href={`/app/suscriptores/${s.id}`} className="font-medium hover:underline">
                {s.nombre}
              </Link>
              <p className="text-xs text-muted-foreground">
                {s.codigo_suscriptor} · {s.estado}
                {s.categoria && ` · ${s.categoria}`}
              </p>
            </div>
          ))}
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
