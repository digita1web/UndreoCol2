'use client';

import { use, useState } from 'react';
import { useHidratado } from '@/lib/use-hidratado';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loginPortal } from '@/lib/api';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default function PortalLoginPage({ params }: PageProps) {
  const { slug } = use(params);
  const router = useRouter();
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [codigoSuscriptor, setCodigoSuscriptor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const hidratado = useHidratado();

  async function alEntrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTrabajando(true);
    try {
      await loginPortal(slug, numeroDocumento.trim(), codigoSuscriptor.trim());
      router.push(`/portal/${slug}`);
    } catch (err) {
      // Mensaje genérico del backend (CA-1): nunca revela cuál campo falló.
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
      setTrabajando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <Card>
        <CardHeader>
          <CardTitle>Portal del suscriptor</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ingrese con el número de documento y el código que aparece en su recibo.
          </p>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={alEntrar}>
            <label className="text-sm">
              Número de documento
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={numeroDocumento}
                onChange={(e) => setNumeroDocumento(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <label className="text-sm">
              Código de suscriptor
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={codigoSuscriptor}
                onChange={(e) => setCodigoSuscriptor(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              className="h-9 w-full rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={!hidratado || trabajando}
            >
              {trabajando ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
