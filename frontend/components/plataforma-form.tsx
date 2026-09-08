'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearAcueductoPlataforma, type RespuestaAltaAcueducto } from '@/lib/api';

// Misma normalización de slug que onboarding-form.tsx (regla compartida con
// backend/src/index.ts y clientes.chk_slug).
function normalizarSlug(valor: string): string {
  return valor
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function PlataformaForm() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [correoAdmin, setCorreoAdmin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // Resultado del último alta exitosa: la contraseña se muestra UNA sola vez,
  // el backend no la guarda en ningún lado (plan §5.4). Se pierde al recargar
  // o al dar de alta otro acueducto — es a propósito.
  const [resultado, setResultado] = useState<RespuestaAltaAcueducto | null>(null);
  const hidratado = useHidratado();

  function alCambiarNombre(valor: string) {
    setNombre(valor);
    if (!slugTocado) {
      setSlug(normalizarSlug(valor));
    }
  }

  function alCambiarSlug(valor: string) {
    setSlugTocado(true);
    setSlug(normalizarSlug(valor));
  }

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setResultado(null);
    setCargando(true);
    try {
      const r = await crearAcueductoPlataforma({
        nombre: nombre.trim(),
        slug,
        nombreAdmin: nombreAdmin.trim(),
        correoAdmin: correoAdmin.trim(),
      });
      setResultado(r);
      setNombre('');
      setSlug('');
      setSlugTocado(false);
      setNombreAdmin('');
      setCorreoAdmin('');
      router.refresh(); // refresca la lista de acueductos del server component
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el acueducto');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {resultado && (
        <div className="flex flex-col gap-2 rounded-lg border border-green-600 bg-green-50 p-4 text-sm">
          <p className="font-semibold">
            Acueducto &quot;{resultado.slug}&quot; creado. Contraseña temporal de {resultado.correoAdmin}
            :
          </p>
          <code className="rounded bg-white px-2 py-1 font-mono text-base">
            {resultado.contrasenaTemporal}
          </code>
          <p className="text-muted-foreground">
            Se muestra una sola vez — no queda guardada en ningún lado. Entréguesela al admin del
            acueducto por un canal seguro.
          </p>
        </div>
      )}

      <form onSubmit={alEnviar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="nombre">Nombre del acueducto</Label>
          <Input
            id="nombre"
            name="nombre"
            type="text"
            required
            value={nombre}
            onChange={(e) => alCambiarNombre(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="slug">Identificador (slug)</Label>
          <Input
            id="slug"
            name="slug"
            type="text"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={slug}
            onChange={(e) => alCambiarSlug(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="nombreAdmin">Nombre del administrador</Label>
          <Input
            id="nombreAdmin"
            name="nombreAdmin"
            type="text"
            required
            value={nombreAdmin}
            onChange={(e) => setNombreAdmin(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="correoAdmin">Correo del administrador</Label>
          <Input
            id="correoAdmin"
            name="correoAdmin"
            type="email"
            required
            value={correoAdmin}
            onChange={(e) => setCorreoAdmin(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={!hidratado || cargando}>
          {cargando ? 'Creando…' : 'Crear acueducto'}
        </Button>
      </form>
    </div>
  );
}
