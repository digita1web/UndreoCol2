'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CATEGORIAS } from '@/components/suscriptor-form';
import { actualizarSuscriptor, type DatosActualizarSuscriptor, type Suscriptor } from '@/lib/api';

interface EditarSuscriptorFormProps {
  suscriptor: Suscriptor;
  onActualizado: (suscriptor: Suscriptor) => void;
  onCancelar: () => void;
}

// 040: nunca expone codigo_suscriptor (credencial del portal, D-2 — ya tiene
// su propio flujo "Regenerar código del portal") ni estado (ya tiene su
// camino correcto — CorteForm/ReconexionForm, con las reglas reales de
// CLAUDE.md §10 puntos 16-19; exponerlo acá abriría un atajo para
// saltárselas).
export function EditarSuscriptorForm({ suscriptor, onActualizado, onCancelar }: EditarSuscriptorFormProps) {
  const [nombre, setNombre] = useState(suscriptor.nombre);
  const [tipoDocumento, setTipoDocumento] = useState(suscriptor.tipo_documento ?? '');
  const [numeroDocumento, setNumeroDocumento] = useState(suscriptor.numero_documento ?? '');
  const [telefono, setTelefono] = useState(suscriptor.telefono ?? '');
  const [email, setEmail] = useState(suscriptor.email ?? '');
  const [direccion, setDireccion] = useState(suscriptor.direccion ?? '');
  const [sector, setSector] = useState(suscriptor.sector ?? '');
  const [categoria, setCategoria] = useState(suscriptor.categoria ?? '');
  const [notas, setNotas] = useState(suscriptor.notas ?? '');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);

    // Solo se manda lo que cambió (plan.md §5) — evita sobrescribir con el
    // mismo valor si otro admin editó casi al mismo tiempo (sin optimistic
    // locking en esta tabla).
    const datos: DatosActualizarSuscriptor = {};
    if (nombre !== suscriptor.nombre) datos.nombre = nombre.trim();
    if (tipoDocumento !== (suscriptor.tipo_documento ?? '')) datos.tipo_documento = tipoDocumento.trim();
    if (numeroDocumento !== (suscriptor.numero_documento ?? '')) datos.numero_documento = numeroDocumento.trim();
    if (telefono !== (suscriptor.telefono ?? '')) datos.telefono = telefono.trim();
    if (email !== (suscriptor.email ?? '')) datos.email = email.trim();
    if (direccion !== (suscriptor.direccion ?? '')) datos.direccion = direccion.trim();
    if (sector !== (suscriptor.sector ?? '')) datos.sector = sector.trim();
    if (categoria !== (suscriptor.categoria ?? '')) datos.categoria = categoria;
    if (notas !== (suscriptor.notas ?? '')) datos.notas = notas.trim();

    if (Object.keys(datos).length === 0) {
      onCancelar();
      return;
    }

    setCargando(true);
    try {
      const { suscriptor: actualizado } = await actualizarSuscriptor(suscriptor.id, datos);
      onActualizado(actualizado);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el suscriptor');
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_nombre">Nombre</Label>
        <Input id="editar_nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_tipo_documento">Tipo de documento</Label>
        <Input id="editar_tipo_documento" value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_numero_documento">Número de documento</Label>
        <Input id="editar_numero_documento" value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_telefono">Teléfono</Label>
        <Input id="editar_telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_email">Email</Label>
        <Input id="editar_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_direccion">Dirección</Label>
        <Input id="editar_direccion" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_sector">Sector</Label>
        <Input id="editar_sector" value={sector} onChange={(e) => setSector(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_categoria">Categoría tarifaria</Label>
        <select
          id="editar_categoria"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          <option value="">Sin categoría</option>
          {CATEGORIAS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="editar_notas">Notas</Label>
        <textarea
          id="editar_notas"
          className="min-h-20 rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!hidratado || cargando}>
          {cargando ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancelar} disabled={cargando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
