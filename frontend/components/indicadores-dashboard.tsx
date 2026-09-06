// Bloque de indicadores del dashboard (specs/011-dashboard/, spec §3.6).
// Componente presentacional SIN hooks: recibe el payload ya resuelto por el
// server component /app/dashboard y lo pinta con las piezas de shadcn/ui del
// proyecto. El gráfico de 12 meses es CSS puro (plan D-5: sin dependencia de
// gráficos). Nunca importa @supabase/* (CLAUDE.md §5.2).

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface TendenciaMes {
  anio: number;
  mes: number; // 1..12
  total: number;
}

export interface IndicadoresDashboard {
  fecha: string;
  recaudoMes: number;
  carteraPendiente: number;
  carteraVencida: number;
  usuariosEnMora: number;
  consumoPromedioUltimoPeriodo: number | null;
  tendencia: TendenciaMes[];
  suscriptoresPorEstado: Record<'activo' | 'suspendido' | 'cortado' | 'inactivo', number>;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

const formatearPesos = (valor: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(valor);

const etiquetaMes = (anio: number, mes: number): string =>
  `${MESES_CORTOS[mes - 1] ?? ''} ${String(anio).slice(2)}`;

function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-1 text-2xl font-semibold">{children}</CardContent>
    </Card>
  );
}

function GraficoTendencia({ tendencia }: { tendencia: TendenciaMes[] }) {
  const maximo = Math.max(...tendencia.map((b) => b.total), 1);
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Recaudo de los últimos 12 meses">
      {tendencia.map((b) => {
        const alto = b.total > 0 ? Math.max((b.total / maximo) * 100, 4) : 0;
        return (
          <div key={`${b.anio}-${b.mes}`} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-blue-600"
              style={{ height: `${alto}%` }}
              title={`${etiquetaMes(b.anio, b.mes)}: ${formatearPesos(b.total)}`}
            />
          </div>
        );
      })}
    </div>
  );
}

export function DashboardIndicadores({ indicadores }: { indicadores: IndicadoresDashboard }) {
  const { suscriptoresPorEstado: e } = indicadores;
  const etiquetasEstados: Array<{ clave: keyof typeof e; texto: string }> = [
    { clave: 'activo', texto: 'Activos' },
    { clave: 'suspendido', texto: 'Suspendidos' },
    { clave: 'cortado', texto: 'Cortados' },
    { clave: 'inactivo', texto: 'Inactivos' },
  ];

  return (
    <section className="flex flex-col gap-6" aria-label="Indicadores del acueducto">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta titulo="Recaudo del mes">
          <p className="text-2xl font-semibold">{formatearPesos(indicadores.recaudoMes)}</p>
        </Tarjeta>
        <Tarjeta titulo="Cartera">
          <div className="flex flex-col gap-1 text-sm">
            <span>
              Por vencer:{' '}
              <Link href="/app/pagos" className="font-semibold text-blue-600 hover:underline">
                {formatearPesos(indicadores.carteraPendiente)}
              </Link>
            </span>
            <span>
              Vencida:{' '}
              <Link href="/app/pagos" className="font-semibold text-blue-600 hover:underline">
                {formatearPesos(indicadores.carteraVencida)}
              </Link>
            </span>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Usuarios en mora">
          <Link href="/app/pagos" className="text-2xl font-semibold text-blue-600 hover:underline">
            {indicadores.usuariosEnMora}
          </Link>
        </Tarjeta>
        <Tarjeta titulo="Consumo promedio (último periodo)">
          <p className="text-2xl font-semibold">
            {indicadores.consumoPromedioUltimoPeriodo === null
              ? '—'
              : `${indicadores.consumoPromedioUltimoPeriodo.toLocaleString('es-CO', { maximumFractionDigits: 1 })} m³`}
          </p>
        </Tarjeta>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Tendencia de recaudo — últimos 12 meses
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <GraficoTendencia tendencia={indicadores.tendencia} />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>{etiquetaMes(indicadores.tendencia[0]?.anio ?? 0, indicadores.tendencia[0]?.mes ?? 1)}</span>
            <span>{etiquetaMes(Number(indicadores.fecha.slice(0, 4)), Number(indicadores.fecha.slice(5, 7)))}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Suscriptores por estado</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid gap-2 sm:grid-cols-4">
            {etiquetasEstados.map(({ clave, texto }) => (
              <Link
                key={clave}
                href="/app/suscriptores"
                className="flex flex-col rounded-md border border-border p-3 hover:border-blue-600"
              >
                <span className="text-2xl font-semibold">{e[clave]}</span>
                <span className="text-sm text-muted-foreground">{texto}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
