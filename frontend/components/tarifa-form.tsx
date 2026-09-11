'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearTarifa, usarAutorizacionTarifa } from '@/lib/api';

const CATEGORIAS = [
  'estrato_1', 'estrato_2', 'estrato_3', 'estrato_4', 'estrato_5', 'estrato_6',
  'comercial', 'industrial', 'oficial',
] as const;

interface TarifaFormProps {
  servicioId: string;
  onCreada: () => void;
  categoria?: string;
  autorizacionId?: string;
}

// Deja explícito en la UI (plan.md §3.4) que esto CIERRA la tarifa vigente
// de la categoría elegida y crea una nueva — nunca la edita.
export function TarifaForm({ servicioId, onCreada, categoria: categoriaInicial, autorizacionId }: TarifaFormProps) {
  const [categoria, setCategoria] = useState<string>(categoriaInicial ?? 'estrato_3');
  const [cargoFijo, setCargoFijo] = useState('');
  const [limiteBasico, setLimiteBasico] = useState('');
  const [precioBasico, setPrecioBasico] = useState('');
  const [precioNoBasico, setPrecioNoBasico] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const valores = {
        cargo_fijo: Number(cargoFijo),
        limite_basico_m3: Number(limiteBasico),
        precio_basico_m3: Number(precioBasico),
        precio_no_basico_m3: Number(precioNoBasico),
      };
      if (Object.values(valores).some((v) => !Number.isFinite(v) || v < 0)) {
        throw new Error('Los valores deben ser números finitos no negativos');
      }
      if (autorizacionId) {
        await usarAutorizacionTarifa({ autorizacion_id: autorizacionId, ...valores });
      } else {
        await crearTarifa({ servicio_id: servicioId, categoria, ...valores });
      }
      setCargoFijo('');
      setLimiteBasico('');
      setPrecioBasico('');
      setPrecioNoBasico('');
      onCreada();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la tarifa');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {autorizacionId
          ? 'Aplicará una autorización temporal de un solo uso. La tarifa vigente se cierra y se crea una nueva.'
          : 'Esto cierra la tarifa vigente de la categoría elegida y crea una nueva. Una tarifa nunca se edita.'}
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="categoria">Categoría</Label>
        <select
          id="categoria"
          name="categoria"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={categoria}
          disabled={Boolean(autorizacionId)}
          onChange={(e) => setCategoria(e.target.value)}
        >
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cargo_fijo">Cargo fijo</Label>
        <Input id="cargo_fijo" type="number" step="0.01" required value={cargoFijo} onChange={(e) => setCargoFijo(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="limite_basico_m3">Límite básico (m³, inclusivo)</Label>
        <Input id="limite_basico_m3" type="number" step="0.01" required value={limiteBasico} onChange={(e) => setLimiteBasico(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="precio_basico_m3">Precio básico por m³</Label>
        <Input id="precio_basico_m3" type="number" step="0.0001" required value={precioBasico} onChange={(e) => setPrecioBasico(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="precio_no_basico_m3">Precio no básico por m³</Label>
        <Input id="precio_no_basico_m3" type="number" step="0.0001" required value={precioNoBasico} onChange={(e) => setPrecioNoBasico(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={!hidratado || cargando}>
              {cargando ? 'Guardando…' : autorizacionId ? 'Aplicar autorización' : 'Crear nueva versión de tarifa'}
      </Button>
    </form>
  );
}
