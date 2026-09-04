'use client';

import { use, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContadorForm } from '@/components/contador-form';
import { ReemplazoContadorForm } from '@/components/reemplazo-contador-form';
import { CorteForm } from '@/components/corte-form';
import { ReconexionForm } from '@/components/reconexion-form';
import {
  historialCortes,
  matrizTarifas,
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

export default function DetalleSuscriptorPage({ params }: PageProps) {
  const { id } = use(params);
  const [suscriptor, setSuscriptor] = useState<Suscriptor | null>(null);
  const [contador, setContador] = useState<Contador | null>(null);
  const [reemplazos, setReemplazos] = useState<ReemplazoContador[]>([]);
  const [historialEventos, setHistorialEventos] = useState<EventoCorte[]>([]);
  const [sinTarifaConfigurada, setSinTarifaConfigurada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">{suscriptor?.nombre ?? 'Suscriptor'}</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {aviso && <p className="text-sm text-green-700">{aviso}</p>}
      {sinTarifaConfigurada && (
        <p className="rounded-md border border-yellow-500 bg-yellow-50 p-3 text-sm text-yellow-800">
          La categoría &quot;{suscriptor?.categoria}&quot; no tiene ninguna tarifa vigente configurada
          todavía. El suscriptor puede crearse igual, pero no se le podrá facturar hasta que exista
          una tarifa para su categoría.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>Código: {suscriptor?.codigo_suscriptor}</p>
          <p>Documento: {suscriptor?.numero_documento}</p>
          <p>Dirección: {suscriptor?.direccion}</p>
          <p>Categoría: {suscriptor?.categoria}</p>
          <p>Estado: {suscriptor?.estado}</p>
          <button
            className="mt-3 h-9 w-fit rounded-md border border-blue-300 px-4 text-sm font-medium text-blue-700 hover:bg-blue-50"
            onClick={alRegenerarCodigo}
          >
            Regenerar código del portal
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Corte y reconexión</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {suscriptor?.estado === 'cortado' ? (
            <ReconexionForm suscriptorId={id} onReconectado={recargar} />
          ) : (
            <CorteForm suscriptorId={id} onCortado={recargar} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de cortes y reconexiones</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {historialEventos.length === 0 && <p className="text-sm text-muted-foreground">Sin eventos registrados.</p>}
          {historialEventos.map((ev) => (
            <div key={ev.id} className="border-b border-border py-2 text-sm last:border-0">
              <p className="font-medium">{ev.fecha} · {ev.tipo === 'corte' ? 'Corte' : 'Reconexión'}</p>
              <p className="text-xs text-muted-foreground">
                {ev.motivo}
                {ev.deuda_vencida_al_reconectar !== null &&
                  ` · deuda vencida al reconectar: $${ev.deuda_vencida_al_reconectar.toLocaleString('es-CO')}`}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
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

          {contador ? (
            <ReemplazoContadorForm usuarioServicioId={id} onReemplazado={recargar} />
          ) : (
            <ContadorForm usuarioServicioId={id} onCreado={recargar} />
          )}
        </CardContent>
      </Card>

      <Card>
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
