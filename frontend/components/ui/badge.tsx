import * as React from 'react';
import { cn } from '@/lib/utils';

const VARIANTES = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  gray: 'bg-muted text-muted-foreground',
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variante: keyof typeof VARIANTES;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variante, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold',
        VARIANTES[variante],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = 'Badge';

export { Badge };
