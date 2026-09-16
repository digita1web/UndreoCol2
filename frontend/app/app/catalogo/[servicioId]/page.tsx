'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TarifaForm } from '@/components/tarifa-form';
import {
  crearAutorizacionTarifa,
  listarAutorizacionesTarifa,
  listarServicios,
  listarTarifas,
  obtenerContextoUsuario,
  revocarAutorizacionTarifa,
  type AutorizacionTarifa,
  type Servicio,
  type Tarifa,
} from '@/lib/api';

const CATEGORIAS = [
  'estrato_1', 'estrato_2', 'estrato_3', 'estrato_4', 'estrato_5', 'estrato_6',
  'comercial', 'industrial', 'oficial',
] as const;

// 041: función, no Record — vigencia_hasta es string | null, no un union
// chico (mismo criterio que suscriptorDelContador en 039).
function badgeVigencia(tarifa: Tarifa): { variante: 'success' | 'gray'; etiqueta: string } {
  return tarifa.vigencia_hasta === null
    ? { variante: 'success', etiqueta: 'Vigente' }
    : { variante: 'gray', etiqueta: 'Histórica' };
}

interface PageProps {
  params: Promise<{ servicioId: string }>;
}

export default function HistorialTarifasPage({ params }: PageProps) {
  const { servicioId } = use(params);
  const [servicio, setServicio] = useState<Servicio | null>(null);
  const [categoria, setCategoria] = useState<string>('estrato_3');
  const [tarifas, setTarifas] = useState<Tarifa[] | null>(null);
  const [rol, setRol] = useState<string | null>(null);
  const [autorizaciones, setAutorizaciones] = useState<AutorizacionTarifa[]>([]);
  const [motivo, setMotivo] = useState('');
  const [expiraEn, setExpiraEn] = useState('');
  const [autorizacionId, setAutorizacionId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarServicios()
      .then((r) => setServicio(r.servicios.find((s) => s.id === servicioId) ?? null))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el servicio'));
  }, [servicioId]);

  useEffect(() => {
    obtenerContextoUsuario().then((r) => setRol(r.cliente.rol)).catch(() => setRol(null));
    listarAutorizacionesTarifa().then((r) => setAutorizaciones(r.autorizaciones)).catch(() => setAutorizaciones([]));
  }, []);

  function recargarHistorial() {
    setError(null);
    listarTarifas(servicioId, categoria)
      .then((r) => setTarifas(r.tarifas))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el historial de tarifas'));
  }

  useEffect(() => {
    recargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId, categoria]);

  const autorizacionesDeEstaCategoria = autorizaciones.filter((a) =>
    a.servicio_id === servicioId &&
    a.categoria === categoria &&
    !a.usada_en &&
    !a.revocada_en &&
    new Date(a.expira_en).getTime() > Date.now(),
  );

  async function crearAutorizacion() {
    setError(null);
    if (!motivo.trim() || !expiraEn) {
      setError('Motivo y expiración son obligatorios');
      return;
    }
    try {
      await crearAutorizacionTarifa({ servicio_id: servicioId, categoria, motivo: motivo.trim(), expira_en: new Date(expiraEn).toISOString() });
      const r = await listarAutorizacionesTarifa();
      setAutorizaciones(r.autorizaciones);
      setMotivo('');
      setExpiraEn('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la autorización');
    }
  }

  async function revocar(id: string) {
    try {
      await revocarAutorizacionTarifa(id);
      setAutorizaciones((prev) => prev.map((a) => a.id === id ? { ...a, revocada_en: new Date().toISOString() } : a));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo revocar la autorización');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Catálogo y tarifas</p>
          <h1 className="text-[28px] font-bold tracking-tight">{servicio?.nombre ?? 'Servicio'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Historial de tarifas por categoría.</p>
        </div>
        <Link href="/app/catalogo" className="text-sm text-accent hover:underline">
          ← Catálogo
        </Link>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Historial de tarifas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <select
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          >
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {tarifas === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {tarifas?.length === 0 && <p className="text-sm text-muted-foreground">Sin tarifas para esta categoría.</p>}
          {tarifas?.map((t) => {
            const badge = badgeVigencia(t);
            return (
              <div key={t.id} className="border-b border-border py-2 text-sm last:border-0">
                <p className="flex items-center gap-2 font-medium">
                  <Badge variante={badge.variante}>{badge.etiqueta}</Badge>
                  {t.vigencia_desde} — {t.vigencia_hasta ?? 'hoy'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Cargo fijo {t.cargo_fijo} · límite {t.limite_basico_m3} m³ · básico {t.precio_basico_m3}/m³ · no básico {t.precio_no_basico_m3}/m³
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {rol === 'admin_acueducto' && (
        <Card>
          <CardHeader>
            <CardTitle>Autorizar a secretaria</CardTitle>
            <p className="text-sm text-muted-foreground">Autorización específica, temporal y de un solo uso para {categoria}.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <input className="h-9 rounded-md border border-border bg-background px-3 text-sm" placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <input className="h-9 rounded-md border border-border bg-background px-3 text-sm" type="datetime-local" value={expiraEn} onChange={(e) => setExpiraEn(e.target.value)} />
            <button className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700" onClick={crearAutorizacion}>Crear autorización</button>
            {autorizacionesDeEstaCategoria.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variante="info">Autorización vigente</Badge>
                  {a.motivo} · expira {new Date(a.expira_en).toLocaleString('es-CO')}
                </span>
                <button className="text-sm font-medium text-red-600 hover:underline" onClick={() => revocar(a.id)}>Revocar</button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {rol === 'secretaria' && (
        <Card>
          <CardHeader>
            <CardTitle>Autorización del administrador</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {autorizacionesDeEstaCategoria.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay una autorización vigente para esta categoría.</p>
            ) : (
              <>
                <select className="h-9 rounded-md border border-border bg-background px-3 text-sm" value={autorizacionId} onChange={(e) => setAutorizacionId(e.target.value)}>
                  <option value="">Selecciona una autorización…</option>
                  {autorizacionesDeEstaCategoria.map((a) => <option key={a.id} value={a.id}>{a.motivo} · {new Date(a.expira_en).toLocaleString('es-CO')}</option>)}
                </select>
                {autorizacionId && <TarifaForm servicioId={servicioId} categoria={categoria} autorizacionId={autorizacionId} onCreada={() => { setAutorizacionId(''); recargarHistorial(); }} />}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Nueva tarifa</CardTitle>
        </CardHeader>
        <CardContent>
          {rol === 'admin_acueducto' && <TarifaForm servicioId={servicioId} onCreada={recargarHistorial} />}
          {rol === 'secretaria' && <p className="text-sm text-muted-foreground">Selecciona una autorización vigente arriba para aplicar una nueva tarifa.</p>}
        </CardContent>
      </Card>
    </main>
  );
}
