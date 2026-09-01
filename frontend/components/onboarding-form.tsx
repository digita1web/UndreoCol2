'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearAcueducto } from '@/lib/api';

// Misma regla que backend/src/index.ts (POST /onboarding) y clientes.chk_slug:
// minúsculas, dígitos y guiones, sin espacios ni símbolos.
function normalizarSlug(valor: string): string {
  return valor
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function OnboardingForm() {
  const router = useRouter();
  const [nombre, setNombre] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

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
    setCargando(true);
    try {
      await crearAcueducto(nombre.trim(), slug);
      router.push('/app/dashboard');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el acueducto');
    } finally {
      setCargando(false);
    }
  }

  return (
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={cargando}>
        {cargando ? 'Creando…' : 'Crear acueducto'}
      </Button>
    </form>
  );
}
