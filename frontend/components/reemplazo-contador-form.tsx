'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reemplazarContador } from '@/lib/api';

interface ReemplazoContadorFormProps {
  usuarioServicioId: string;
  onReemplazado: () => void;
}

export function ReemplazoContadorForm({ usuarioServicioId, onReemplazado }: ReemplazoContadorFormProps) {
  const [serialNuevo, setSerialNuevo] = useState('');
  const [capacidadMaximaNuevo, setCapacidadMaximaNuevo] = useState('99999');
  const [lecturaFinalAnterior, setLecturaFinalAnterior] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await reemplazarContador(usuarioServicioId, {
        serial_nuevo: serialNuevo.trim(),
        capacidad_maxima_nuevo: Number(capacidadMaximaNuevo),
        lectura_final_anterior: Number(lecturaFinalAnterior),
        motivo: motivo.trim() || undefined,
      });
      setSerialNuevo('');
      setLecturaFinalAnterior('');
      setMotivo('');
      onReemplazado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reemplazar el contador');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Registra el cambio físico de contador. El consumo del periodo que combina ambos contadores
        lo calcula 004-lecturas-y-consumo; aquí solo se deja el registro.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="lectura_final_anterior">Lectura final del contador saliente</Label>
        <Input id="lectura_final_anterior" type="number" step="0.01" required value={lecturaFinalAnterior} onChange={(e) => setLecturaFinalAnterior(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="serial_nuevo">Serial del contador nuevo</Label>
        <Input id="serial_nuevo" required value={serialNuevo} onChange={(e) => setSerialNuevo(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="capacidad_maxima_nuevo">Capacidad máxima del contador nuevo</Label>
        <Input id="capacidad_maxima_nuevo" type="number" required value={capacidadMaximaNuevo} onChange={(e) => setCapacidadMaximaNuevo(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="motivo">Motivo</Label>
        <Input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={!hidratado || cargando}>
        {cargando ? 'Reemplazando…' : 'Reemplazar contador'}
      </Button>
    </form>
  );
}
