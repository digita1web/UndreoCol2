'use client';

import { useState } from 'react';
import { restablecerContrasenaAcueducto } from '@/lib/api';

interface RestablecerContrasenaAcueductoProps {
  email: string | null;
}

export function RestablecerContrasenaAcueducto({
  email,
}: RestablecerContrasenaAcueductoProps) {
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function alRestablecer() {
    if (!email || cargando) return;

    setAviso(null);
    setError(null);
    setCargando(true);
    try {
      await restablecerContrasenaAcueducto(email);
      setAviso('Correo de restablecimiento enviado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el correo');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => void alRestablecer()}
        disabled={!email || cargando}
      >
        {cargando ? 'Enviando…' : 'Restablecer contraseña'}
      </button>
      {aviso && <p className="text-right text-xs text-green-700">{aviso}</p>}
      {error && <p className="text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}