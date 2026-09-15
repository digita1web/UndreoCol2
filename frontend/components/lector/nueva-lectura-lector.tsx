'use client';

import { useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EscanerQrContador } from '@/components/lector/escaner-qr-contador';
import { SugerirLecturaFoto } from '@/components/lector/sugerir-lectura-foto';
import { crearLectura, type Suscriptor } from '@/lib/api';

interface NuevaLecturaLectorProps {
  suscriptores: Suscriptor[] | null;
  periodoAbiertoId: string | null;
  onCreada: () => void;
}

export function NuevaLecturaLector({ suscriptores, periodoAbiertoId, onCreada }: NuevaLecturaLectorProps) {
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
    try {
      await crearLectura({
        contador_id: contadorSel,
        periodo_id: periodoAbiertoId,
        fecha_lectura: fechaLectura,
        lectura_actual: valor,
      });
      setLecturaActual('');
      setAviso('Lectura guardada.');
      onCreada();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la lectura');
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
