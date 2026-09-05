'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearSuscriptor, type Suscriptor } from '@/lib/api';

const CATEGORIAS = [
  'estrato_1', 'estrato_2', 'estrato_3', 'estrato_4', 'estrato_5', 'estrato_6',
  'comercial', 'industrial', 'oficial',
] as const;

interface SuscriptorFormProps {
  onCreado: (suscriptor: Suscriptor) => void;
}

export function SuscriptorForm({ onCreado }: SuscriptorFormProps) {
  const [codigoSuscriptor, setCodigoSuscriptor] = useState('');
  const [nombre, setNombre] = useState('');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [direccion, setDireccion] = useState('');
  const [categoria, setCategoria] = useState<string>('estrato_3');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const { suscriptor } = await crearSuscriptor({
        codigo_suscriptor: codigoSuscriptor.trim(),
        nombre: nombre.trim(),
        numero_documento: numeroDocumento.trim(),
        direccion: direccion.trim(),
        categoria,
      });
      onCreado(suscriptor);
      setCodigoSuscriptor('');
      setNombre('');
      setNumeroDocumento('');
      setDireccion('');
      setCategoria('estrato_3');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el suscriptor');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="codigo_suscriptor">Código de suscriptor</Label>
        <Input id="codigo_suscriptor" required value={codigoSuscriptor} onChange={(e) => setCodigoSuscriptor(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="nombre">Nombre</Label>
        <Input id="nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="numero_documento">Número de documento</Label>
        <Input id="numero_documento" required value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="direccion">Dirección</Label>
        <Input id="direccion" required value={direccion} onChange={(e) => setDireccion(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="categoria">Categoría tarifaria</Label>
        <select
          id="categoria"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={!hidratado || cargando}>
        {cargando ? 'Creando…' : 'Crear suscriptor'}
      </Button>
    </form>
  );
}
