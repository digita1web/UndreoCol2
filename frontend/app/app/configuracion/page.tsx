'use client';

import { useEffect, useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { actualizarColorAcentoAcueducto, obtenerAcueducto, type Acueducto } from '@/lib/api';

const COLOR_POR_DEFECTO = '#14408C';

export default function ConfiguracionAcueductoPage() {
  const [acueducto, setAcueducto] = useState<Acueducto | null>(null);
  const [color, setColor] = useState(COLOR_POR_DEFECTO);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const hidratado = useHidratado();

  useEffect(() => {
    obtenerAcueducto()
      .then((r) => {
        setAcueducto(r.acueducto);
        setColor(r.acueducto.colorAcento);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el acueducto'));
  }, []);

  async function alGuardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setGuardando(true);
    try {
      await actualizarColorAcentoAcueducto(color);
      setAviso('Color de acento actualizado.');
    } catch (err) {
      // 403 si el rol no es admin_acueducto (CA-2); mensaje genérico del
      // backend en cualquier otro caso (color inválido, etc.).
      setError(err instanceof Error ? err.message : 'No se pudo guardar el color');
    } finally {
      setGuardando(false);
    }
  }

  if (error && !acueducto) {
    return <main className="mx-auto max-w-2xl p-8 text-sm text-red-600">{error}</main>;
  }
  if (!acueducto) {
    return <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">Cargando…</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <section>
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Acueducto</p>
        <h1 className="text-[28px] font-bold tracking-tight">Configuración</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Datos del acueducto y personalización de la marca.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Datos del acueducto</CardTitle>
              <p className="text-sm text-muted-foreground">
                Son los que aparecen en el encabezado de la factura. Para cambiarlos, contacte a soporte.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">Nombre</span>
              <span>{acueducto.nombre}</span>
              <span className="text-muted-foreground">NIT</span>
              <span>{acueducto.nit ?? '—'}</span>
              <span className="text-muted-foreground">Municipio</span>
              <span>{acueducto.municipio ?? '—'}</span>
              <span className="text-muted-foreground">Teléfono</span>
              <span>{acueducto.telefono ?? '—'}</span>
              <span className="text-muted-foreground">Dirección</span>
              <span>{acueducto.direccion ?? '—'}</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Color de acento de la factura</CardTitle>
              <p className="text-sm text-muted-foreground">
                Se usa en el nombre del acueducto y en el TOTAL, tanto en el PDF como al imprimir.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form className="flex items-center gap-4" onSubmit={alGuardar}>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded-md border border-border"
                  aria-label="Color de acento"
                />
                <button
                  className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={!hidratado || guardando}
                >
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </form>
              {error && <p className="text-sm text-red-600">{error}</p>}
              {aviso && <p className="text-sm text-green-700">{aviso}</p>}
            </CardContent>
          </Card>
        </div>

        {/* Vista previa: patrón "Live Preview" (plan.md §5) — mismo estado
            (acueducto, color) que el formulario de la izquierda, sin llamada
            nueva ni guardado propio. */}
        <Card>
          <CardHeader>
            <p className="text-xs font-bold uppercase tracking-wide text-accent">Vista previa</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-lg font-bold" style={{ color }}>
              {acueducto.nombre}
            </p>
            <p className="text-sm text-muted-foreground">NIT: {acueducto.nit ?? '—'}</p>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-10 w-16 rounded-md border border-border" style={{ background: color }} aria-hidden />
              <span className="text-sm font-medium uppercase text-muted-foreground">{color}</span>
            </div>
            <div className="mt-4 flex justify-between border-t border-border pt-4 text-sm">
              <span className="font-semibold">TOTAL</span>
              <span className="font-bold" style={{ color }}>
                $38.600
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
