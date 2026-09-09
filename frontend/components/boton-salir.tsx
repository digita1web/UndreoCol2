'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/api';

// Cierra sesión y SIEMPRE termina en /login, incluso si la petición al
// servidor falla (red caída, etc.) — la cookie es HttpOnly+Secure con
// expiración de 7 días de todas formas; no tiene sentido dejar a alguien
// atrapado en la pantalla por un error de red al salir (021, plan §2).
export function BotonSalir() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function alSalir() {
    setSaliendo(true);
    try {
      await logout();
    } catch (e) {
      console.error('No se pudo cerrar sesión en el servidor', e instanceof Error ? e.message : e);
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={alSalir}
      disabled={saliendo}
      className="text-sm text-red-600 hover:underline disabled:opacity-50"
    >
      {saliendo ? 'Saliendo…' : 'Salir'}
    </button>
  );
}
