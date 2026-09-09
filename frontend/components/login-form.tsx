'use client';

import { useState, type FormEvent } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorPeticion, login, minutosParaReintentar } from '@/lib/api';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const hidratado = useHidratado();

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);
    try {
      await login(email, password);
      router.push('/app/dashboard');
      router.refresh();
    } catch (e) {
      // 429 del límite de intentos (017): se dice cuántos minutos faltan en vez
      // del mensaje genérico. Si el backend no mandó `reintentar_en` o la fecha
      // ya pasó, se cae al mensaje del servidor tal cual.
      if (e instanceof ErrorPeticion && e.status === 429) {
        const minutos = minutosParaReintentar(e.reintentarEn);
        setError(
          minutos === null
            ? e.message
            : `Demasiados intentos. Vuelva a intentar en ${minutos} minuto${minutos === 1 ? '' : 's'}.`,
        );
      } else if (e instanceof Error) {
        // Ayuda de diagnóstico temporal: se incluye e.name (p. ej.
        // "TypeError" en un fallo de red antes de llegar al servidor) para
        // que el error real sea visible en pantalla sin abrir DevTools.
        setError(`${e.name}: ${e.message}`);
      } else {
        setError('No se pudo iniciar sesión (error desconocido, sin instancia de Error)');
      }
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <div className="rounded-md border-2 border-red-600 bg-red-50 p-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}
      <Button type="submit" disabled={!hidratado || cargando}>
        {cargando ? 'Ingresando…' : 'Ingresar'}
      </Button>
    </form>
  );
}
