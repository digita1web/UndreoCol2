'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listarNotificaciones,
  type EstadoNotificacion,
  type Notificacion,
  type TipoNotificacion,
} from '@/lib/api';

const ETIQUETAS_TIPO: Record<TipoNotificacion, string> = {
  factura_generada: 'Factura generada',
  recordatorio_vencimiento: 'Recordatorio de vencimiento',
  aviso_mora: 'Aviso de mora',
  confirmacion_pago: 'Confirmación de pago',
  corte_ejecutado: 'Corte ejecutado',
  reconexion_completada: 'Reconexión completada',
};

const ETIQUETAS_ESTADO: Record<EstadoNotificacion, string> = {
  pendiente: 'Pendiente',
  enviada: 'Enviada',
  fallida: 'Fallida',
  cancelada: 'Cancelada',
};

export default function NotificacionesPage() {
  const [notificaciones, setNotificaciones] = useState<Notificacion[] | null>(null);
  const [tipo, setTipo] = useState<TipoNotificacion | ''>('');
  const [estado, setEstado] = useState<EstadoNotificacion | ''>('');
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setError(null);
    listarNotificaciones({ tipo: tipo || undefined, estado: estado || undefined })
      .then((r) => setNotificaciones(r.notificaciones))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las notificaciones'));
  }, [tipo, estado]);

  useEffect(cargar, [cargar]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notificaciones</h1>
        <Link href="/app/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          Tipo
          <select
            className="h-9 rounded-md border border-border bg-transparent px-2"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoNotificacion | '')}
          >
            <option value="">Todos</option>
            {Object.entries(ETIQUETAS_TIPO).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Estado
          <select
            className="h-9 rounded-md border border-border bg-transparent px-2"
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoNotificacion | '')}
          >
            <option value="">Todos</option>
            {Object.entries(ETIQUETAS_ESTADO).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
        </label>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historial de notificaciones</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {notificaciones === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {notificaciones?.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin notificaciones para los filtros seleccionados.</p>
          )}
          {notificaciones?.map((n) => (
            <div key={n.id} className="flex flex-col gap-1 border-b border-border pb-3 text-sm last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{ETIQUETAS_TIPO[n.tipo] ?? n.tipo}</p>
                <span
                  className={
                    n.estado === 'fallida'
                      ? 'font-medium text-red-600'
                      : n.estado === 'enviada'
                        ? 'text-green-700'
                        : 'text-muted-foreground'
                  }
                >
                  {ETIQUETAS_ESTADO[n.estado] ?? n.estado}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {n.destinatario ?? 'Sin destinatario'} · {n.canal} · {new Date(n.created_at).toLocaleString('es-CO')}
              </p>
              {n.asunto && <p className="text-xs">{n.asunto}</p>}
              <p className="text-xs text-muted-foreground">
                Intentos: {n.intentos}
                {n.enviada_en && ` · Enviada: ${new Date(n.enviada_en).toLocaleString('es-CO')}`}
              </p>
              {n.ultimo_error && <p className="text-xs text-red-600">Error: {n.ultimo_error}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
