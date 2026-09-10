import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Lectura } from '@/lib/api';

interface InicioLectorProps {
  nombreAcueducto: string | null;
  lecturasAbiertas: Lectura[] | null;
}

export function InicioLector({ nombreAcueducto, lecturasAbiertas }: InicioLectorProps) {
  const hoy = new Date().toISOString().slice(0, 10);
  const lecturasHoy = (lecturasAbiertas ?? []).filter((l) => l.fecha_lectura === hoy).length;
  const pendientes = (lecturasAbiertas ?? []).filter((l) => l.revision !== 'normal' && !l.revisada).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">¡Hola!</h1>
        <p className="text-sm text-muted-foreground">
          {nombreAcueducto ? `Lecturas de ${nombreAcueducto}.` : 'Cargando tu acueducto…'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Lecturas hoy</p>
            <p className="text-2xl font-bold">{lecturasHoy}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pendientes</p>
            <p className="text-2xl font-bold text-red-600">{pendientes}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrar una lectura</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Andá a la pestaña <strong>Nueva</strong> para elegir un suscriptor y cargar la lectura de su contador.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
