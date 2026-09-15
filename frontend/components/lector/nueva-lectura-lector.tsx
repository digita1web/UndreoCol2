'use client';

import { useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EscanerQrContador } from '@/components/lector/escaner-qr-contador';
import { SugerirLecturaFoto } from '@/components/lector/sugerir-lectura-foto';
import { crearLectura, ErrorPeticion, type DatosCrearLectura, type Suscriptor } from '@/lib/api';
import type { LecturaEnCola } from '@/lib/use-cola-lecturas-offline';

interface NuevaLecturaLectorProps {
  suscriptores: Suscriptor[] | null;
  periodoAbiertoId: string | null;
  onCreada: () => void;
  colaOffline: {
    rechazadas: LecturaEnCola[];
    encolar: (datos: DatosCrearLectura) => Promise<void>;
    descartar: (idClienteOffline: string) => Promise<void>;
  };
}

export function NuevaLecturaLector({
  suscriptores,
  periodoAbiertoId,
  onCreada,
  colaOffline,
}: NuevaLecturaLectorProps) {
  const [contadorSel, setContadorSel] = useState('');
  const [lecturaActual, setLecturaActual] = useState('');
  const [fechaLectura, setFechaLectura] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const hidratado = useHidratado();

  const contadores = (suscriptores ?? [])
    .filter((s) => s.contador_actual_id)
    .map((s) => ({ id: s.contador_actual_id!, nombre: s.nombre, codigo: s.codigo_suscriptor }));

  // 015: matching 100% client-side contra los datos que ya recibió esta
  // pantalla — sin ninguna llamada nueva al backend. Si el QR escaneado no
  // corresponde a ningún contador de este acueducto, se avisa sin romper la
  // pantalla (CA-4 del spec) y el <select> manual sigue disponible.
  function alDecodificarQr(texto: string) {
    const match = contadores.find((c) => c.id === texto);
    setEscaneando(false);
    if (!match) {
      setError('Este código no corresponde a ningún contador de tu acueducto.');
      return;
    }
    setError(null);
    setContadorSel(match.id);
  }

  async function alGuardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    const valor = Number(lecturaActual);
    if (!contadorSel || !periodoAbiertoId || !fechaLectura || Number.isNaN(valor)) {
      setError('Elegí un suscriptor, una fecha y la lectura del contador.');
      return;
    }
    setGuardando(true);
    // 038: se genera siempre, guarde online o quede en cola — así el envío
    // ya es idempotente ante cualquier ambigüedad (ej. el POST sí llegó pero
    // la respuesta se perdió), sin dos caminos de código distintos
    // (plan.md §5).
    const datos: DatosCrearLectura = {
      contador_id: contadorSel,
      periodo_id: periodoAbiertoId,
      fecha_lectura: fechaLectura,
      lectura_actual: valor,
      id_cliente_offline: crypto.randomUUID(),
    };
    try {
      await crearLectura(datos);
      setLecturaActual('');
      setAviso('Lectura guardada.');
      onCreada();
    } catch (err) {
      if (err instanceof ErrorPeticion) {
        // Rechazo real del backend (duplicado, fuera de orden, periodo
        // cerrado...) — no es un problema de conexión, se le muestra tal
        // cual para que lo corrija a mano, igual que siempre.
        setError(err.message);
      } else {
        // Falla de red real: no se pierde el trabajo, queda en la cola local
        // y se sube sola cuando vuelva la señal (038, CA-1/CA-2).
        try {
          await colaOffline.encolar(datos);
          setLecturaActual('');
          setAviso('Lectura guardada. Se subirá sola cuando haya señal.');
        } catch (errCola) {
          console.error('nueva-lectura-lector: no se pudo guardar en la cola offline', errCola);
          setError('No se pudo guardar la lectura ni siquiera sin conexión. Intentá de nuevo.');
        }
      }
    } finally {
      setGuardando(false);
    }
  }

  if (!periodoAbiertoId) {
    return <p className="text-sm text-muted-foreground">No hay un periodo abierto para tomar lecturas todavía.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nueva lectura</CardTitle>
      </CardHeader>
      <CardContent>
        {colaOffline.rechazadas.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold text-red-800">
              {colaOffline.rechazadas.length} lectura(s) no se pudieron subir:
            </p>
            {colaOffline.rechazadas.map((r) => (
              <div key={r.id_cliente_offline} className="flex items-center justify-between gap-2 text-xs text-red-700">
                <span>{r.errorRechazo ?? 'Rechazada por el servidor'} — volvé a escribirla a mano.</span>
                <button
                  type="button"
                  className="shrink-0 rounded border border-red-300 px-2 py-1 font-medium hover:bg-red-100"
                  onClick={() => colaOffline.descartar(r.id_cliente_offline)}
                >
                  Descartar
                </button>
              </div>
            ))}
          </div>
        )}
        <form className="flex flex-col gap-3" onSubmit={alGuardar}>
          {escaneando ? (
            <EscanerQrContador onDecodificado={alDecodificarQr} onCerrar={() => setEscaneando(false)} />
          ) : (
            <>
              <select
                className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                value={contadorSel}
                onChange={(e) => setContadorSel(e.target.value)}
              >
                <option value="">Elegí el suscriptor…</option>
                {contadores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.codigo})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="h-11 rounded-md border border-border text-sm font-medium hover:bg-muted"
                onClick={() => setEscaneando(true)}
              >
                Escanear QR
              </button>
            </>
          )}
          <input
            type="date"
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            value={fechaLectura}
            onChange={(e) => setFechaLectura(e.target.value)}
          />
          <input
            type="number"
            inputMode="decimal"
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Lectura actual (m³)"
            value={lecturaActual}
            onChange={(e) => setLecturaActual(e.target.value)}
          />
          <SugerirLecturaFoto onSugerida={(v) => setLecturaActual(v)} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {aviso && <p className="text-sm text-green-700">{aviso}</p>}
          <button
            className="h-11 rounded-md bg-green-600 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            disabled={!hidratado || guardando}
          >
            {guardando ? 'Guardando…' : 'Guardar lectura'}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
