'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { obtenerCartera, reconectarSuscriptor } from '@/lib/api';

interface ReconexionFormProps {
  suscriptorId: string;
  onReconectado: () => void;
}

// Bloqueada con deuda vencida salvo excepción explícita (spec.md §3.2,
// CLAUDE.md §10 punto 18): se muestra la deuda ANTES de intentar reconectar
// (misma fuente que /app/pagos: obtenerCartera()) para que el admin sepa si
// necesita justificar una excepción antes de escribir el motivo.
export function ReconexionForm({ suscriptorId, onReconectado }: ReconexionFormProps) {
  const [deudaVencida, setDeudaVencida] = useState<number | null>(null);
  const [motivoExcepcion, setMotivoExcepcion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  useEffect(() => {
    obtenerCartera({ suscriptorId })
      .then((r) => setDeudaVencida(r.cartera[0]?.vencida ?? 0))
      .catch(() => setDeudaVencida(null));
  }, [suscriptorId]);

  const tieneDeuda = (deudaVencida ?? 0) > 0;

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await reconectarSuscriptor(suscriptorId, tieneDeuda ? motivoExcepcion.trim() : undefined);
      setMotivoExcepcion('');
      onReconectado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reconectar el suscriptor');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      {deudaVencida === null ? (
        <p className="text-sm text-muted-foreground">Consultando deuda vencida…</p>
      ) : tieneDeuda ? (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Deuda vencida: ${deudaVencida.toLocaleString('es-CO')}. Para reconectar de todas formas,
          escriba el motivo de la excepción — queda registrado en el historial.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Sin deuda vencida.</p>
      )}
      {tieneDeuda && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="motivo_excepcion">Motivo de la excepción</Label>
          <Input
            id="motivo_excepcion"
            required
            value={motivoExcepcion}
            onChange={(e) => setMotivoExcepcion(e.target.value)}
          />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={!hidratado || cargando || deudaVencida === null}>
        {cargando ? 'Reconectando…' : 'Reconectar'}
      </Button>
    </form>
  );
}
