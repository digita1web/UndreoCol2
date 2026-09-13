import type { SaludSistema } from '@/lib/api';

interface SaludSistemaProps {
  salud: SaludSistema;
}

const ETIQUETA_NIVEL: Record<SaludSistema['nivel'], string> = {
  ok: 'Normal',
  atencion: 'Atención',
  alerta: 'Alerta',
  critico: 'Crítico',
};

// 035: los tres indicadores muestran la fecha de la última medición del cron
// correspondiente — nunca se miden en vivo dentro de esta petición (spec §4).
export function SaludSistema({ salud }: SaludSistemaProps) {
  return (
    <dl className="grid grid-cols-2 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Tamaño de la base</dt>
      <dd>
        {salud.tamanoBaseMb} MB · {ETIQUETA_NIVEL[salud.nivel]} (medido {new Date(salud.medidoEn).toLocaleString('es-CO')})
      </dd>
      <dt className="text-muted-foreground">Keepalive</dt>
      <dd>
        {salud.ultimoKeepalive ? new Date(salud.ultimoKeepalive).toLocaleString('es-CO') : 'sin registro'}
      </dd>
      <dt className="text-muted-foreground">Último backup</dt>
      <dd>
        {salud.ultimoBackup
          ? `${salud.ultimoBackup.archivo} (${new Date(salud.ultimoBackup.subidoEn).toLocaleString('es-CO')})`
          : 'sin backups todavía'}
      </dd>
    </dl>
  );
}
