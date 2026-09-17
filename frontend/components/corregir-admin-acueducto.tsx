'use client';

import { useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { corregirAdminAcueducto } from '@/lib/api';

interface CorregirAdminAcueductoProps {
  clienteId: string;
}

// Corrige el correo del admin de un acueducto ya creado (ej. se cargó mal al
// darlo de alta) — reemplaza al admin, no renombra la cuenta existente
// (plan.md de este cambio, Sesión 057). Botón que revela un formulario
// chico, mismo patrón de toggle que EditarSuscriptorForm.
export function CorregirAdminAcueducto({ clienteId }: CorregirAdminAcueductoProps) {
  const [abierto, setAbierto] = useState(false);
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [correoAdmin, setCorreoAdmin] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hidratado = useHidratado();

  async function alGuardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await corregirAdminAcueducto(clienteId, { nombreAdmin, correoAdmin });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo corregir el admin');
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        onClick={() => setAbierto(true)}
      >
        Corregir correo del admin
      </button>
    );
  }

  return (
    <form onSubmit={alGuardar} className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          required
          placeholder="Nombre del admin"
          value={nombreAdmin}
          onChange={(e) => setNombreAdmin(e.target.value)}
          className="h-9 w-40 rounded-md border border-border bg-background px-2 text-sm"
        />
        <input
          type="email"
          required
          placeholder="correo@correcto.com"
          value={correoAdmin}
          onChange={(e) => setCorreoAdmin(e.target.value)}
          className="h-9 w-52 rounded-md border border-border bg-background px-2 text-sm"
        />
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hidratado || guardando}
        >
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
          onClick={() => setAbierto(false)}
          disabled={guardando}
        >
          Cancelar
        </button>
      </div>
      {error && <p className="text-right text-xs text-red-600">{error}</p>}
    </form>
  );
}
