'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ServicioForm } from '@/components/servicio-form';
import { actualizarServicio, listarServicios, type Servicio } from '@/lib/api';

// 041: Record indexado por la etiqueta, no por el boolean directo — activo
// es boolean, no un union chico, se normaliza a la clave antes de indexar.
const BADGE_SERVICIO: Record<'activo' | 'inactivo', { variante: 'success' | 'gray'; etiqueta: string }> = {
  activo: { variante: 'success', etiqueta: 'Vigente' },
  inactivo: { variante: 'gray', etiqueta: 'Inactivo' },
};

export default function CatalogoPage() {
  const [servicios, setServicios] = useState<Servicio[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarServicios()
      .then((r) => setServicios(r.servicios))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los servicios'));
  }, []);

  async function alCambiarActivo(servicio: Servicio) {
    setError(null);
    try {
      const { servicio: actualizado } = await actualizarServicio(servicio.id, { activo: !servicio.activo });
      setServicios((prev) => prev?.map((s) => (s.id === actualizado.id ? actualizado : s)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el servicio');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <section>
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Configuración comercial</p>
        <h1 className="text-[28px] font-bold tracking-tight">Catálogo y tarifas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Las tarifas se versionan; las versiones anteriores nunca se editan.
        </p>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {servicios === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {servicios?.length === 0 && <p className="text-sm text-muted-foreground">Sin servicios todavía.</p>}

      {servicios && servicios.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {servicios.map((s) => {
            const badge = BADGE_SERVICIO[s.activo ? 'activo' : 'inactivo'];
            return (
              <Card key={s.id}>
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{s.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.codigo} · {s.tipo_calculo === 'por_consumo' ? 'Por consumo' : 'Fijo'}
                      </p>
                    </div>
                    <Badge variante={badge.variante}>{badge.etiqueta}</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/app/catalogo/${s.id}`}
                      className="h-8 rounded-md border border-border px-3 text-xs font-medium leading-8 hover:bg-muted"
                    >
                      Ver historial
                    </Link>
                    <button
                      className="h-8 w-fit rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                      onClick={() => alCambiarActivo(s)}
                    >
                      {s.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Nuevo servicio</CardTitle>
        </CardHeader>
        <CardContent>
          <ServicioForm onCreado={(servicio) => setServicios((prev) => [...(prev ?? []), servicio])} />
        </CardContent>
      </Card>
    </main>
  );
}
