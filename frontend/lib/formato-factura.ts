import type { BadgeProps } from '@/components/ui/badge';
import type { EstadoFactura } from '@/lib/api';

export const configuracionEstado: Record<
  EstadoFactura,
  { variante: BadgeProps['variante']; etiqueta: string }
> = {
  pendiente: { variante: 'warning', etiqueta: 'Pendiente' },
  pagada: { variante: 'success', etiqueta: 'Pagada' },
  vencida: { variante: 'danger', etiqueta: 'Vencida' },
  anulada: { variante: 'gray', etiqueta: 'Anulada' },
};

export function formatearCategoria(categoria: unknown): string {
  if (typeof categoria !== 'string' || !categoria) return '—';

  if (categoria.startsWith('estrato_')) {
    return `Estrato ${categoria.replace('estrato_', '')}`;
  }

  return categoria
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letra) => letra.toUpperCase());
}
