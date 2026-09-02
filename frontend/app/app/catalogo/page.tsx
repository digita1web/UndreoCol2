'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ServicioForm } from '@/components/servicio-form';
import { actualizarServicio, listarServicios, type Servicio } from '@/lib/api';

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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Catálogo de servicios</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Servicios</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {servicios === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {servicios?.length === 0 && <p className="text-sm text-muted-foreground">Sin servicios todavía.</p>}
          {servicios?.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-0">
              <div>
                <Link href={`/app/catalogo/${s.id}`} className="font-medium hover:underline">
                  {s.nombre}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {s.codigo} · {s.tipo_calculo === 'por_consumo' ? 'Por consumo' : 'Fijo'}
                  {!s.activo && ' · Inactivo'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => alCambiarActivo(s)}>
                {s.activo ? 'Desactivar' : 'Activar'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

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
