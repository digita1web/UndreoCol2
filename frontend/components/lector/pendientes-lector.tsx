import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Lectura } from '@/lib/api';

const ETIQUETA_REVISION: Record<string, string> = {
  consumo_alto: 'Consumo alto',
  consumo_bajo: 'Consumo bajo',
  consumo_cero: 'Consumo cero',
};

interface PendientesLectorProps {
  lecturas: Lectura[] | null;
}

// Solo lectura para el lector (CA-4, 025): marcar una anomalía como revisada
// exige admin_acueducto por RLS (lecturas_admin) — no se muestra ningún botón
// de acción acá, sería ofrecer algo que el backend va a rechazar.
export function PendientesLector({ lecturas }: PendientesLectorProps) {
  const anomalias = (lecturas ?? []).filter((l) => l.revision !== 'normal');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Anomalías del periodo abierto</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {anomalias.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin anomalías por ahora.</p>
        )}
        {anomalias.map((l) => (
          <div key={l.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
            <div>
              <p className="text-sm font-medium">
                Contador {l.contador_id.slice(0, 8)} · {l.consumo_m3} m³
              </p>
              <p className="text-xs text-muted-foreground">
                lectura {l.lectura_anterior} → {l.lectura_actual} · {l.fecha_lectura}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                l.revisada ? 'bg-muted text-muted-foreground' : 'bg-red-50 text-red-700'
              }`}
            >
              {l.revisada ? 'Revisada' : ETIQUETA_REVISION[l.revision] ?? l.revision}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
