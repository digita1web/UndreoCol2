'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearContador, type Contador } from '@/lib/api';

interface ContadorFormProps {
  usuarioServicioId: string;
  onCreado: (contador: Contador) => void;
}

// Alta del PRIMER contador del suscriptor (un suscriptor puede existir sin
// contador todavía — alta administrativa antes de la instalación física).
export function ContadorForm({ usuarioServicioId, onCreado }: ContadorFormProps) {
  const [serial, setSerial] = useState('');
  const [capacidadMaxima, setCapacidadMaxima] = useState('99999');
  const [fechaInstalacion, setFechaInstalacion] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const { contador } = await crearContador(usuarioServicioId, {
        serial: serial.trim(),
        capacidad_maxima: Number(capacidadMaxima),
        fecha_instalacion: fechaInstalacion,
      });
      onCreado(contador);
      setSerial('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el contador');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="serial">Serial</Label>
        <Input id="serial" required value={serial} onChange={(e) => setSerial(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="capacidad_maxima">Capacidad máxima (define el rollover)</Label>
        <Input id="capacidad_maxima" type="number" required value={capacidadMaxima} onChange={(e) => setCapacidadMaxima(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fecha_instalacion">Fecha de instalación</Label>
        <Input id="fecha_instalacion" type="date" required value={fechaInstalacion} onChange={(e) => setFechaInstalacion(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={cargando}>
        {cargando ? 'Creando…' : 'Instalar contador'}
      </Button>
    </form>
  );
}
