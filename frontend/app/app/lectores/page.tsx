'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LectorForm } from '@/components/lector-form';
import {
  asignarSectorLector,
  listarLectoresConSectores,
  listarSectoresDisponibles,
  quitarSectorLector,
  type LectorConSectores,
  type RespuestaCrearLector,
} from '@/lib/api';

export default function LectoresPage() {
  const [lectores, setLectores] = useState<LectorConSectores[] | null>(null);
  const [sectoresDisponibles, setSectoresDisponibles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function recargar() {
    setError(null);
    listarLectoresConSectores()
      .then((r) => setLectores(r.lectores))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los lectores'));
    listarSectoresDisponibles()
      .then((r) => setSectoresDisponibles(r.sectores))
      .catch(() => setSectoresDisponibles([]));
  }

  useEffect(recargar, []);

  async function alCambiar(perfilId: string, sector: string, asignado: boolean) {
    setError(null);
    try {
      if (asignado) {
        await quitarSectorLector(perfilId, sector);
      } else {
        await asignarSectorLector(perfilId, sector);
      }
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar la asignación');
    }
  }

  function alCrear(respuesta: RespuestaCrearLector) {
    setAviso(
      respuesta.invitacionEnviada
        ? `Lector creado — invitación enviada a ${respuesta.correo}.`
        : (respuesta.avisoCorreo ?? `Lector creado, pero no se pudo enviar la invitación a ${respuesta.correo}.`),
    );
    recargar();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <section>
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Equipo</p>
        <h1 className="text-[28px] font-bold tracking-tight">Lectores</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Asigná uno o más sectores a cada lector. Sin ningún sector asignado, el lector sigue
          viendo todo el acueducto.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nuevo lector</CardTitle>
        </CardHeader>
        <CardContent>
          <LectorForm sectoresDisponibles={sectoresDisponibles} onCreado={alCrear} />
        </CardContent>
      </Card>

      {aviso && <p className="text-sm text-green-700">{aviso}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {sectoresDisponibles.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay ningún suscriptor con sector cargado — no hay nada que asignar por ahora.
        </p>
      )}
      {(lectores ?? []).map((l) => (
        <Card key={l.perfilId}>
          <CardHeader>
            <CardTitle className="text-base">{l.nombre || l.email}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {sectoresDisponibles.map((sector) => {
              const asignado = l.sectores.includes(sector);
              return (
                <label key={sector} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={asignado}
                    onChange={() => alCambiar(l.perfilId, sector, asignado)}
                  />
                  {sector}
                </label>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </main>
  );
}
