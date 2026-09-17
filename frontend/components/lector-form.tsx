'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearLector, type RespuestaCrearLector } from '@/lib/api';

interface LectorFormProps {
  sectoresDisponibles: string[];
  onCreado: (respuesta: RespuestaCrearLector) => void;
}

// Crea un lector nuevo e invita por correo (Sesión 057 — hueco real, el
// admin_acueducto no tenía forma de hacer esto desde la interfaz). Los
// sectores son opcionales: sin ninguno, el lector sigue viendo todo el
// acueducto (misma retrocompatibilidad que la asignación por checkbox).
export function LectorForm({ sectoresDisponibles, onCreado }: LectorFormProps) {
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [sectoresElegidos, setSectoresElegidos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  function alternarSector(sector: string) {
    setSectoresElegidos((prev) =>
      prev.includes(sector) ? prev.filter((s) => s !== sector) : [...prev, sector],
    );
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const respuesta = await crearLector({
        nombre: nombre.trim(),
        correo: correo.trim(),
        sectores: sectoresElegidos,
      });
      onCreado(respuesta);
      setNombre('');
      setCorreo('');
      setSectoresElegidos([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el lector');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="nombre_lector">Nombre</Label>
        <Input id="nombre_lector" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="correo_lector">Correo</Label>
        <Input
          id="correo_lector"
          type="email"
          required
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
        />
      </div>
      {sectoresDisponibles.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Sectores (opcional — sin ninguno, ve todo el acueducto)</Label>
          <div className="flex flex-wrap gap-3">
            {sectoresDisponibles.map((sector) => (
              <label key={sector} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sectoresElegidos.includes(sector)}
                  onChange={() => alternarSector(sector)}
                />
                {sector}
              </label>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={!hidratado || cargando}>
        {cargando ? 'Creando…' : 'Crear lector'}
      </Button>
    </form>
  );
}
