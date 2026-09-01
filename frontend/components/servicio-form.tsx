'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearServicio, type Servicio, type TipoCalculo } from '@/lib/api';

interface ServicioFormProps {
  onCreado: (servicio: Servicio) => void;
}

export function ServicioForm({ onCreado }: ServicioFormProps) {
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipoCalculo, setTipoCalculo] = useState<TipoCalculo>('por_consumo');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const { servicio } = await crearServicio({ codigo: codigo.trim(), nombre: nombre.trim(), tipo_calculo: tipoCalculo });
      onCreado(servicio);
      setCodigo('');
      setNombre('');
      setTipoCalculo('por_consumo');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el servicio');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="codigo">Código</Label>
        <Input id="codigo" name="codigo" type="text" required value={codigo} onChange={(e) => setCodigo(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="nombre">Nombre</Label>
        <Input id="nombre" name="nombre" type="text" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="tipo_calculo">Tipo de cálculo</Label>
        <select
          id="tipo_calculo"
          name="tipo_calculo"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={tipoCalculo}
          onChange={(e) => setTipoCalculo(e.target.value as TipoCalculo)}
        >
          <option value="por_consumo">Por consumo (cargo fijo + m³)</option>
          <option value="fijo">Fijo (solo cargo fijo)</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={cargando}>
        {cargando ? 'Creando…' : 'Crear servicio'}
      </Button>
    </form>
  );
}
