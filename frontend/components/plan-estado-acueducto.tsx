'use client';

import { useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { cambiarPlanEstadoAcueducto, type AcueductoPlataforma } from '@/lib/api';

// 035: lista fija de planes reales (Basico/Pro, sembrados por fixture) — el
// catálogo de planes en sí no se gestiona desde acá (spec §4, fuera de
// alcance). Si Mateo agrega un plan nuevo alguna vez, esta lista se actualiza
// a mano hasta que exista una ruta de catálogo de planes.
const PLANES_CONOCIDOS = [
  { id: '10000000-0000-0000-0000-000000000001', nombre: 'Basico' },
  { id: '10000000-0000-0000-0000-000000000002', nombre: 'Pro' },
];

const ESTADOS_CUENTA = ['activa', 'vencida', 'suspendida', 'cancelada'] as const;

interface PlanEstadoAcueductoProps {
  acueducto: AcueductoPlataforma;
}

// El padre (frontend/app/plataforma/page.tsx) es un server component — no se
// le puede pasar una función como prop (RSC no serializa closures salvo
// Server Actions). Este componente ya es cliente, así que recarga la página
// él mismo tras guardar, en vez de depender de un callback del padre.
export function PlanEstadoAcueducto({ acueducto }: PlanEstadoAcueductoProps) {
  const [planId, setPlanId] = useState(acueducto.planId ?? '');
  const [estadoCuenta, setEstadoCuenta] = useState(acueducto.estadoCuenta);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hidratado = useHidratado();

  async function alGuardar() {
    setError(null);
    setGuardando(true);
    try {
      await cambiarPlanEstadoAcueducto(acueducto.id, { planId: planId || undefined, estadoCuenta });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        className="h-9 rounded-md border border-border bg-background px-2"
        value={planId}
        onChange={(e) => setPlanId(e.target.value)}
      >
        <option value="">Sin plan</option>
        {PLANES_CONOCIDOS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      <select
        className="h-9 rounded-md border border-border bg-background px-2"
        value={estadoCuenta}
        onChange={(e) => setEstadoCuenta(e.target.value as typeof estadoCuenta)}
      >
        {ESTADOS_CUENTA.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={!hidratado || guardando} onClick={alGuardar}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
