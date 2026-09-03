'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registrarPago, type MetodoPago, type ResultadoRegistrarPago } from '@/lib/api';

const METODOS: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'consignacion', etiqueta: 'Consignación' },
  { valor: 'pse', etiqueta: 'PSE' },
  { valor: 'otro', etiqueta: 'Otro' },
];

interface PagoFormProps {
  usuarioServicioId: string;
  /** Si viene, el pago se aplica SOLO a esta factura (con el sobrante siguiendo
   *  a la siguiente pendiente del suscriptor, spec §3.2); si se omite, se
   *  aplica automáticamente a las pendientes más antiguas primero. */
  facturaId?: string;
  onRegistrado: (resultado: ResultadoRegistrarPago) => void;
  onCancelar?: () => void;
}

export function PagoForm({ usuarioServicioId, facturaId, onRegistrado, onCancelar }: PagoFormProps) {
  const [valor, setValor] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [referencia, setReferencia] = useState('');
  const [fechaPago, setFechaPago] = useState(() => new Date().toISOString().slice(0, 10));
  const [observaciones, setObservaciones] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const resultado = await registrarPago({
        usuario_servicio_id: usuarioServicioId,
        valor: Number(valor),
        metodo,
        fecha_pago: fechaPago,
        referencia: referencia.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        factura_ids: facturaId ? [facturaId] : undefined,
      });
      onRegistrado(resultado);
      setValor('');
      setReferencia('');
      setObservaciones('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el pago');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="valor">Valor</Label>
          <Input id="valor" type="number" min="1" step="1" required value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="metodo">Método</Label>
          <select
            id="metodo"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={metodo}
            onChange={(e) => setMetodo(e.target.value as MetodoPago)}
          >
            {METODOS.map((m) => (
              <option key={m.valor} value={m.valor}>{m.etiqueta}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="referencia">Referencia (opcional)</Label>
          <Input id="referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fecha_pago">Fecha</Label>
          <Input id="fecha_pago" type="date" required value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="observaciones">Observaciones (opcional)</Label>
        <Input id="observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={cargando}>
          {cargando ? 'Registrando…' : 'Registrar pago'}
        </Button>
        {onCancelar && (
          <Button type="button" variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
