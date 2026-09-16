'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContadorForm } from '@/components/contador-form';
import { ReemplazoContadorForm } from '@/components/reemplazo-contador-form';
import { CorteForm } from '@/components/corte-form';
import { ReconexionForm } from '@/components/reconexion-form';
import { EtiquetaQrContador } from '@/components/etiqueta-qr-contador';
import { EditarSuscriptorForm } from '@/components/editar-suscriptor-form';
import {
  historialCortes,
  matrizTarifas,
  obtenerContextoUsuario,
  obtenerSuscriptor,
  regenerarCodigoSuscriptor,
  type Contador,
  type EventoCorte,
  type ReemplazoContador,
  type Suscriptor,
} from '@/lib/api';

interface PageProps {
  params: Promise<{ id: string }>;
}

// 040: Badge por estado del suscriptor y por tipo de evento de corte —
// constantes, mismo criterio que 030/039.
const BADGE_ESTADO: Record<Suscriptor['estado'], { variante: 'success' | 'warning' | 'danger' | 'gray'; etiqueta: string }> = {
  activo: { variante: 'success', etiqueta: 'Activo' },
  suspendido: { variante: 'warning', etiqueta: 'Suspendido' },
  cortado: { variante: 'danger', etiqueta: 'Cortado' },
  inactivo: { variante: 'gray', etiqueta: 'Inactivo' },
};

const BADGE_EVENTO: Record<EventoCorte['tipo'], { variante: 'danger' | 'success'; etiqueta: string }> = {
  corte: { variante: 'danger', etiqueta: 'Corte' },
  reconexion: { variante: 'success', etiqueta: 'Reconexión' },
};

export default function DetalleSuscriptorPage({ params }: PageProps) {
  const { id } = use(params);
  const [suscriptor, setSuscriptor] = useState<Suscriptor | null>(null);
  const [contador, setContador] = useState<Contador | null>(null);
  const [reemplazos, setReemplazos] = useState<ReemplazoContador[]>([]);
  const [historialEventos, setHistorialEventos] = useState<EventoCorte[]>([]);
  const [sinTarifaConfigurada, setSinTarifaConfigurada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rol, setRol] = useState<string | null>(null);
  const [mostrarEtiqueta, setMostrarEtiqueta] = useState(false);
  const [editando, setEditando] = useState(false);

  function recargar() {
    setError(null);
    obtenerSuscriptor(id)
      .then((r) => {
        setSuscriptor(r.suscriptor);
        setContador(r.contador);
        setReemplazos(r.reemplazos);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el suscriptor'));
    historialCortes(id)
      .then((r) => setHistorialEventos(r.historial))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el historial de cortes'));
  }

  // CA-8: el admin asigna un código de portal nuevo. El código anterior deja de
  // servir (con D-10 la sesión previa pierde el acceso a los datos de inmediato).
  async function alRegenerarCodigo() {
    if (!suscriptor) return;
    const codigoNuevo = window.prompt('Nuevo código de suscriptor para el portal:');
    if (!codigoNuevo?.trim()) return;
    if (!window.confirm(`¿Cambiar el código de ${suscriptor.nombre} a "${codigoNuevo.trim()}"? El código anterior dejará de servir.`)) return;
    setError(null);
    setAviso(null);
    try {
      await regenerarCodigoSuscriptor(suscriptor.id, codigoNuevo.trim());
      setAviso(`Código actualizado a "${codigoNuevo.trim()}". El anterior ya no sirve para ingresar al portal.`);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo regenerar el código');
    }
  }

  useEffect(recargar, [id]);

  useEffect(() => {
    obtenerContextoUsuario()
      .then((r) => setRol(r.cliente.rol))
      .catch(() => setRol('admin_acueducto'));
  }, []);

  // Advertencia (nunca bloqueo, spec.md §3.1): la categoría del suscriptor no
  // tiene ningún servicio con tarifa vigente configurada. El bloqueo real es
  // del cierre de facturación (005, CLAUDE.md §10 punto 9d).
  useEffect(() => {
    if (!suscriptor?.categoria) return;
    matrizTarifas()
      .then((r) => {
        const tieneAlguna = r.matriz.some((f) => f.categoria === suscriptor.categoria && f.tarifa_id !== null);
        setSinTarifaConfigurada(!tieneAlguna);
      })
      .catch(() => setSinTarifaConfigurada(false));
  }, [suscriptor?.categoria]);

  const badgeEstado = suscriptor ? BADGE_ESTADO[suscriptor.estado] : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <section className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Suscriptores</p>
          <h1 className="text-[28px] font-bold tracking-tight">{suscriptor?.nombre ?? 'Suscriptor'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{suscriptor?.codigo_suscriptor}</p>
        </div>
        <Link href="/app/suscriptores" className="text-sm text-accent hover:underline">
          ← Suscriptores
        </Link>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-green-700">{aviso}</p>}
      {sinTarifaConfigurada && (
        <p className="rounded-md border border-yellow-500 bg-yellow-50 p-3 text-sm text-yellow-800">
          La categoría &quot;{suscriptor?.categoria}&quot; no tiene ninguna tarifa vigente configurada
          todavía. El suscriptor puede crearse igual, pero no se le podrá facturar hasta que exista
          una tarifa para su categoría.
        </p>
      )}

      <Card className="print:hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Datos</CardTitle>
          {!editando && rol === 'admin_acueducto' && (
            <button
              className="h-8 w-fit rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
              onClick={() => setEditando(true)}
            >
              Editar
            </button>
          )}
        </CardHeader>
        <CardContent>
          {editando && suscriptor ? (
            <EditarSuscriptorForm
              suscriptor={suscriptor}
              onActualizado={(actualizado) => {
                setSuscriptor(actualizado);
                setEditando(false);
                setAviso('Datos del suscriptor actualizados.');
              }}
              onCancelar={() => setEditando(false)}
            />
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p className="flex items-center gap-2">
                Estado: {badgeEstado && <Badge variante={badgeEstado.variante}>{badgeEstado.etiqueta}</Badge>}
              </p>
              <p>Documento: {suscriptor?.tipo_documento ?? '—'} {suscriptor?.numero_documento ?? '—'}</p>
              <p>Dirección: {suscriptor?.direccion ?? '—'}</p>
              <p>Sector: {suscriptor?.sector ?? '—'}</p>
              <p>Categoría: {suscriptor?.categoria ?? '—'}</p>
              <p>Teléfono: {suscriptor?.telefono ?? '—'}</p>
              <p>Email: {suscriptor?.email ?? '—'}</p>
              <p>Notas: {suscriptor?.notas ?? '—'}</p>
              {rol === 'admin_acueducto' && (
                <button
                  className="mt-3 h-9 w-fit rounded-md border border-blue-300 px-4 text-sm font-medium text-blue-700 hover:bg-blue-50"
                  onClick={alRegenerarCodigo}
                >
                  Regenerar código del portal
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Corte y reconexión</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rol === 'admin_acueducto' ? (
            suscriptor?.estado === 'cortado' ? (
              <ReconexionForm suscriptorId={id} onReconectado={recargar} />
            ) : (
              <CorteForm suscriptorId={id} onCortado={recargar} />
            )
          ) : (
            <p className="text-sm text-muted-foreground">Solo el administrador del acueducto puede ejecutar cortes o reconexiones.</p>
          )}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Historial de cortes y reconexiones</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {historialEventos.length === 0 && <p className="text-sm text-muted-foreground">Sin eventos registrados.</p>}
          {historialEventos.map((ev) => (
            <div key={ev.id} className="flex flex-col gap-1 border-b border-border py-2 text-sm last:border-0">
              <p className="flex items-center gap-2 font-medium">
                <Badge variante={BADGE_EVENTO[ev.tipo].variante}>{BADGE_EVENTO[ev.tipo].etiqueta}</Badge>
                {ev.fecha}
              </p>
              <p className="text-xs text-muted-foreground">
                {ev.motivo}
                {ev.deuda_vencida_al_reconectar !== null &&
                  ` · deuda vencida al reconectar: $${ev.deuda_vencida_al_reconectar.toLocaleString('es-CO')}`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Contador</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {contador ? (
            <div className="text-sm">
              <p>Serial: {contador.serial}</p>
              <p>Capacidad máxima: {contador.capacidad_maxima}</p>
              <p>Instalado: {contador.fecha_instalacion}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin contador instalado todavía.</p>
          )}

          {contador && (
            <button
              className="h-9 w-fit rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
              onClick={() => setMostrarEtiqueta((v) => !v)}
            >
              {mostrarEtiqueta ? 'Ocultar etiqueta QR' : 'Ver etiqueta QR'}
            </button>
          )}

          {contador ? (
            <ReemplazoContadorForm usuarioServicioId={id} onReemplazado={recargar} />
          ) : (
            <ContadorForm usuarioServicioId={id} onCreado={recargar} />
          )}
        </CardContent>
      </Card>

      {contador && mostrarEtiqueta && <EtiquetaQrContador contador={contador} />}

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Historial de reemplazos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {reemplazos.length === 0 && <p className="text-sm text-muted-foreground">Sin reemplazos registrados.</p>}
          {reemplazos.map((r) => (
            <div key={r.id} className="border-b border-border py-2 text-sm last:border-0">
              <p className="font-medium">{r.fecha_reemplazo}</p>
              <p className="text-xs text-muted-foreground">
                Lectura final anterior {r.lectura_final_anterior} · lectura inicial nueva {r.lectura_inicial_nuevo}
                {r.motivo && ` · ${r.motivo}`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
