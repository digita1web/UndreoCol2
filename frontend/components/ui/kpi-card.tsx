import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  etiqueta: string;
  valor: string;
  variacion?: string;
  /** Color de la variación — 'success' (verde) por defecto, 'danger' para lo negativo/urgente. */
  variacionColor?: 'success' | 'warning' | 'danger';
  icono?: React.ReactNode;
  /** Si viene, toda la tarjeta es un enlace (027: "Cartera vencida"/"Por vencer" → /app/pagos). */
  href?: string;
}

const COLOR_VARIACION = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

export function KpiCard({ etiqueta, valor, variacion, variacionColor = 'success', icono, href }: KpiCardProps) {
  const contenido = (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{etiqueta}</span>
        {icono && (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft text-accent">
            {icono}
          </span>
        )}
      </div>
      <p className="my-2 text-2xl font-extrabold tracking-tight">{valor}</p>
      {variacion && <p className={cn('text-xs font-semibold', COLOR_VARIACION[variacionColor])}>{variacion}</p>}
    </>
  );

  if (href) {
    return (
      <Link href={href}>
        <Card className="p-5 transition-colors hover:border-accent">{contenido}</Card>
      </Link>
    );
  }
  return <Card className="p-5">{contenido}</Card>;
}
