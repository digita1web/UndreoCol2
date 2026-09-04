'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cortarSuscriptor } from '@/lib/api';

interface CorteFormProps {
  suscriptorId: string;
  onCortado: () => void;
}

// Corte SIEMPRE con confirmación humana explícita (spec.md §5, decisión 1
// aprobada): el motivo es obligatorio, nunca hay corte desatendido.
export function CorteForm({ suscriptorId, onCortado }: CorteFormProps) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await cortarSuscriptor(suscriptorId, motivo.trim());
      setMotivo('');
      onCortado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cortar el suscriptor');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="motivo_corte">Motivo del corte</Label>
        <Input id="motivo_corte" required value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" variant="outline" disabled={cargando}>
        {cargando ? 'Cortando…' : 'Cortar servicio'}
      </Button>
    </form>
  );
}
