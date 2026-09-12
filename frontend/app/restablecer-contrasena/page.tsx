'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { completarRecuperacion } from '@/lib/api';
import { useHidratado } from '@/lib/use-hidratado';

interface TokensRecuperacion {
  accessToken: string;
  refreshToken: string;
}

function leerFragmento(): TokensRecuperacion | null {
  if (typeof window === 'undefined') return null;

  const parametros = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = parametros.get('access_token');
  const refreshToken = parametros.get('refresh_token');
  const tipo = parametros.get('type');
  if (!accessToken || !refreshToken || tipo !== 'recovery') return null;

  return { accessToken, refreshToken };
}

export default function RestablecerContrasenaPage() {
  const router = useRouter();
  const hidratado = useHidratado();
  const [tokens, setTokens] = useState<TokensRecuperacion | null | undefined>(undefined);
  const [passwordNueva, setPasswordNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    setTokens(leerFragmento());
  }, []);

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);

    if (passwordNueva !== confirmacion) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (!tokens) return;

    setCargando(true);
    try {
      await completarRecuperacion(tokens.accessToken, tokens.refreshToken, passwordNueva);
      router.push('/app/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo restablecer la contraseña');
    } finally {
      setCargando(false);
    }
  }

  if (tokens === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Validando enlace…</p>
      </main>
    );
  }

  if (tokens === null) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Enlace inválido o vencido</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Solicita un nuevo enlace de recuperación para continuar.
            </p>
            <Link href="/login" className="text-sm text-accent hover:underline">
              Volver al inicio de sesión
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Restablecer contraseña</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={alEnviar} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="passwordNueva">Contraseña nueva</Label>
              <Input
                id="passwordNueva"
                type="password"
                minLength={8}
                required
                value={passwordNueva}
                onChange={(e) => setPasswordNueva(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmacion">Confirmar contraseña nueva</Label>
              <Input
                id="confirmacion"
                type="password"
                minLength={8}
                required
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={!hidratado || cargando}>
              {cargando ? 'Guardando…' : 'Restablecer contraseña'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}