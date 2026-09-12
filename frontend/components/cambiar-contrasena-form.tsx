'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cambiarContrasena } from '@/lib/api';

export function CambiarContrasenaForm() {
  const [passwordNueva, setPasswordNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    if (passwordNueva !== confirmacion) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setCargando(true);
    try {
      await cambiarContrasena(passwordNueva);
      setAviso('Contraseña actualizada.');
      setPasswordNueva('');
      setConfirmacion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar la contraseña');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="passwordNueva">Contraseña nueva</Label>
        <Input
          id="passwordNueva"
          type="password"
          minLength={8}
          required
          value={passwordNueva}
          onChange={(e) => setPasswordNueva(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmacion">Confirmar contraseña nueva</Label>
        <Input
          id="confirmacion"
          type="password"
          minLength={8}
          required
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-green-700">{aviso}</p>}
      <Button type="submit" disabled={!hidratado || cargando}>
        {cargando ? 'Guardando…' : 'Cambiar contraseña'}
      </Button>
    </form>
  );
}