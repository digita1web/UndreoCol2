'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HistorialLector } from '@/components/lector/historial-lector';
import { InicioLector } from '@/components/lector/inicio-lector';
import { NuevaLecturaLector } from '@/components/lector/nueva-lectura-lector';
import { PendientesLector } from '@/components/lector/pendientes-lector';
import { ShellLector, type PestanaLector } from '@/components/lector/shell-lector';
import { useColaLecturasOffline } from '@/lib/use-cola-lecturas-offline';
import {
  crearLectura,
  listarLecturas,
  listarPeriodos,
  listarSuscriptores,
  obtenerAcueducto,
  obtenerContextoUsuario,
  revisarLectura,
  type Acueducto,
  type Lectura,
  type Periodo,
  type Suscriptor,
} from '@/lib/api';

// 025: /app/lecturas se ve distinto según el rol. admin_acueducto sigue
// exactamente como estaba (VistaAdmin, sin tocar); lector ve el shell móvil
// "AquaLectura" (VistaLector) — es la misma ruta, no dos páginas separadas.
export default function LecturasPage() {
  const [rol, setRol] = useState<string | null>(null);

  useEffect(() => {
    obtenerContextoUsuario()
      .then((r) => setRol(r.cliente.rol))
      .catch(() => setRol('admin_acueducto')); // ante un error de red, se degrada a la vista actual
  }, []);

  if (rol === null) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">Cargando…</main>;
  }
  if (rol === 'lector') return <VistaLector />;
  return <VistaAdmin rol={rol} />;
}

function VistaLector() {
  const [pestana, setPestana] = useState<PestanaLector>('inicio');
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [suscriptores, setSuscriptores] = useState<Suscriptor[] | null>(null);
  const [lecturasAbiertas, setLecturasAbiertas] = useState<Lectura[] | null>(null);
  const [acueducto, setAcueducto] = useState<Acueducto | null>(null);
  const [sectoresAsignados, setSectoresAsignados] = useState<string[]>([]);

  const periodoAbierto = (periodos ?? []).find((p) => p.estado === 'abierto') ?? null;

  useEffect(() => {
    listarPeriodos().then((r) => setPeriodos(r.periodos)).catch(() => setPeriodos([]));
    listarSuscriptores().then((r) => setSuscriptores(r.suscriptores)).catch(() => setSuscriptores([]));
    obtenerAcueducto()
      .then((r) => setAcueducto(r.acueducto))
      .catch((e) => console.error('No se pudo cargar el acueducto', e));
    // 037: "Zona actual" en Inicio — vacío si el lector no tiene sectores
    // asignados (sigue viendo todo el acueducto, spec CA-3).
    obtenerContextoUsuario()
      .then((r) => setSectoresAsignados(r.cliente.sectoresAsignados))
      .catch((e) => console.error('No se pudieron cargar los sectores asignados', e));
  }, []);

  const recargarLecturasAbiertas = useCallback(() => {
    if (!periodoAbierto) return;
    listarLecturas({ periodoId: periodoAbierto.id })
      .then((r) => setLecturasAbiertas(r.lecturas))
      .catch((e) => console.error('No se pudieron cargar las lecturas del periodo abierto', e));
  }, [periodoAbierto]);

  useEffect(recargarLecturasAbiertas, [recargarLecturasAbiertas]);

  // 038: vive acá, no dentro de NuevaLecturaLector — ese componente se
  // desmonta al cambiar de pestaña, y la cola tiene que seguir drenando
  // aunque el fontanero esté en "Historial" cuando vuelve la señal.
  const colaOffline = useColaLecturasOffline(recargarLecturasAbiertas);

  const pendientesCount = (lecturasAbiertas ?? []).filter((l) => l.revision !== 'normal' && !l.revisada).length;

  return (
    <ShellLector
      pestana={pestana}
      onPestanaChange={setPestana}
      pendientesCount={pendientesCount}
      sinSubirCount={colaOffline.sinSubirCount}
    >
      {pestana === 'inicio' && (
        <InicioLector
          nombreAcueducto={acueducto?.nombre ?? null}
          lecturasAbiertas={lecturasAbiertas}
          sectoresAsignados={sectoresAsignados}
        />
      )}
      {pestana === 'nueva' && (
        <NuevaLecturaLector
          suscriptores={suscriptores}
          periodoAbiertoId={periodoAbierto?.id ?? null}
          onCreada={recargarLecturasAbiertas}
          colaOffline={colaOffline}
        />
      )}
      {pestana === 'pendientes' && <PendientesLector lecturas={lecturasAbiertas} />}
      {pestana === 'historial' && <HistorialLector periodos={periodos} />}
    </ShellLector>
  );
}

// 039: mapeo de Badge por revisión — 'normal' deliberadamente ausente (sin
// Badge, spec §3.4). consumo_cero es 'danger' (más severo que alto/bajo):
// investigado contra prácticas de la industria de servicios públicos, no
// inventado (spec §3.4, fuente ahí) — suele indicar contador roto/atascado
// o un bypass, no solo una variación esperable como consumo alto/bajo.
const BADGE_REVISION: Partial<Record<Lectura['revision'], { variante: 'warning' | 'danger'; etiqueta: string }>> = {
  consumo_bajo: { variante: 'warning', etiqueta: 'Consumo bajo' },
  consumo_alto: { variante: 'warning', etiqueta: 'Consumo alto' },
  consumo_cero: { variante: 'danger', etiqueta: 'Consumo cero' },
};

function VistaAdmin({ rol }: { rol: string }) {
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [suscriptores, setSuscriptores] = useState<Suscriptor[] | null>(null);
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState<string>('');
  const [soloAnomalias, setSoloAnomalias] = useState(false);
  const [lecturas, setLecturas] = useState<Lectura[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // alta manual
  const [contadorSel, setContadorSel] = useState('');
  const [lecturaActual, setLecturaActual] = useState('');
  const [fechaLectura, setFechaLectura] = useState(new Date().toISOString().slice(0, 10));

  const refConsulta = useRef<HTMLDivElement>(null);
  const refNuevaLectura = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listarPeriodos().then((r) => setPeriodos(r.periodos)).catch(() => setPeriodos([]));
    listarSuscriptores().then((r) => setSuscriptores(r.suscriptores)).catch(() => setSuscriptores([]));
  }, []);

  useEffect(() => {
    if (!periodoSeleccionado) {
      setLecturas([]);
      return;
    }
    setLecturas(null);
    listarLecturas({ periodoId: periodoSeleccionado, soloAnomalias })
      .then((r) => setLecturas(r.lecturas))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las lecturas'));
  }, [periodoSeleccionado, soloAnomalias]);

  const contadores = (suscriptores ?? [])
    .filter((s) => s.contador_actual_id)
    .map((s) => ({ id: s.contador_actual_id!, nombre: s.nombre, codigo: s.codigo_suscriptor }));

  // 039: nombre del suscriptor por lectura, cruzado en el cliente contra
  // contador_actual_id — sin llamada nueva al backend (spec §3.1). Puede no
  // encontrar coincidencia si el contador de la lectura ya no es el vigente
  // (reemplazo de contador, 003 regla 7) — se muestra "Sin suscriptor" en
  // vez de inventar una relación histórica (plan §5).
  function suscriptorDelContador(contadorId: string): Suscriptor | null {
    return (suscriptores ?? []).find((s) => s.contador_actual_id === contadorId) ?? null;
  }

  const periodoActivo = (periodos ?? []).find((p) => p.id === periodoSeleccionado) ?? null;
  const pendientesRevision = (lecturas ?? []).filter((l) => l.revision !== 'normal' && !l.revisada).length;

  function irAIngresoManual() {
    refNuevaLectura.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function irARevisarAnomalias() {
    setSoloAnomalias(true);
    refConsulta.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function alCrearLectura() {
    setError(null);
    const valor = Number(lecturaActual);
    if (!contadorSel || !periodoSeleccionado || !fechaLectura || Number.isNaN(valor)) {
      setError('Selecciona contador, periodo, fecha y lectura actual.');
      return;
    }
    try {
      await crearLectura({
        contador_id: contadorSel,
        periodo_id: periodoSeleccionado,
        fecha_lectura: fechaLectura,
        lectura_actual: valor,
      });
      setLecturaActual('');
      const r = await listarLecturas({ periodoId: periodoSeleccionado, soloAnomalias });
      setLecturas(r.lecturas);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la lectura');
    }
  }

  async function alRevisar(id: string) {
    setError(null);
    try {
      await revisarLectura(id);
      const r = await listarLecturas({ periodoId: periodoSeleccionado, soloAnomalias });
      setLecturas(r.lecturas);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar como revisada');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Lecturas</p>
          <h1 className="text-[28px] font-bold tracking-tight">Lecturas del periodo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {periodoActivo
              ? `${periodoActivo.nombre} · ${periodoActivo.estado}`
              : 'Elegí un periodo para consultar sus lecturas.'}
          </p>
        </div>
        <Link href="/app/lecturas/periodo" className="text-sm text-accent hover:underline">
          Gestionar periodo →
        </Link>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-2 p-5">
            <p className="text-sm font-semibold">Ingreso manual</p>
            <p className="text-sm text-muted-foreground">
              Elegí un contador y registrá la lectura directamente.
            </p>
            <button
              className="mt-2 h-9 w-fit rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              onClick={irAIngresoManual}
            >
              Ingresar lectura
            </button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-2 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold">
              Anomalías
              {pendientesRevision > 0 && <Badge variante="danger">{pendientesRevision}</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">
              Consumos altos, bajos o en cero que requieren revisión antes del cierre.
            </p>
            <button
              className="mt-2 h-9 w-fit rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              onClick={irARevisarAnomalias}
            >
              Revisar anomalías
            </button>
          </CardContent>
        </Card>
      </div>

      <Card ref={refConsulta}>
        <CardHeader>
          <CardTitle>Consulta por periodo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
              value={periodoSeleccionado}
              onChange={(e) => setPeriodoSeleccionado(e.target.value)}
            >
              <option value="">Selecciona un periodo…</option>
              {(periodos ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({p.estado})
                </option>
              ))}
            </select>
            <label className="flex w-fit items-center gap-2 text-sm">
              <input type="checkbox" checked={soloAnomalias} onChange={(e) => setSoloAnomalias(e.target.checked)} />
              Solo anomalías pendientes de revisión
            </label>
          </div>

          {lecturas?.length === 0 && <p className="text-sm text-muted-foreground">Sin lecturas para este filtro.</p>}

          {lecturas && lecturas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3 font-medium">Suscriptor</th>
                    <th className="px-3 py-3 font-medium">Contador</th>
                    <th className="px-3 py-3 font-medium">Lectura</th>
                    <th className="px-3 py-3 font-medium">Consumo</th>
                    <th className="px-3 py-3 font-medium">Revisión</th>
                    <th className="px-3 py-3 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {lecturas.map((l) => {
                    const suscriptor = suscriptorDelContador(l.contador_id);
                    const badge = BADGE_REVISION[l.revision];
                    return (
                      <tr key={l.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-4">
                          {suscriptor ? (
                            <>
                              <p className="font-medium">{suscriptor.nombre}</p>
                              <p className="text-xs text-muted-foreground">{suscriptor.codigo_suscriptor}</p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">Sin suscriptor</span>
                          )}
                        </td>
                        <td className="px-3 py-4 text-muted-foreground">{l.contador_id.slice(0, 8)}</td>
                        <td className="px-3 py-4">
                          {l.lectura_anterior} → {l.lectura_actual}
                          {l.hubo_rollover && <span className="text-muted-foreground"> (rollover)</span>}
                          <p className="text-xs text-muted-foreground">{l.fecha_lectura}</p>
                        </td>
                        <td className="px-3 py-4 font-medium">{l.consumo_m3} m³</td>
                        <td className="px-3 py-4">
                          {badge ? <Badge variante={badge.variante}>{badge.etiqueta}</Badge> : '—'}
                        </td>
                        <td className="px-3 py-4 text-right">
                          {rol === 'admin_acueducto' && l.revision !== 'normal' && !l.revisada && (
                            <button
                              className="h-8 w-fit rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                              onClick={() => alRevisar(l.id)}
                            >
                              Marcar revisada
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card ref={refNuevaLectura}>
        <CardHeader>
          <CardTitle>Nueva lectura</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <select
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={contadorSel}
            onChange={(e) => setContadorSel(e.target.value)}
          >
            <option value="">Contador…</option>
            {contadores.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} ({c.codigo})
              </option>
            ))}
          </select>
          <input
            type="date"
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={fechaLectura}
            onChange={(e) => setFechaLectura(e.target.value)}
          />
          <input
            type="number"
            className="h-9 w-40 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Lectura actual (m³)"
            value={lecturaActual}
            onChange={(e) => setLecturaActual(e.target.value)}
          />
          <button
            className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
            onClick={alCrearLectura}
          >
            Guardar lectura
          </button>
        </CardContent>
      </Card>
    </main>
  );
}
