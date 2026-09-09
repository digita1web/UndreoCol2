# PLAN — 021: cerrar-sesion-admin

**Spec aprobada:** 2026-09-09. Sin decisiones abiertas.

**Estado de este plan:** EN REVISIÓN. Checkpoint antes de `/tasks`.

---

## 0. Punto de partida (verificado leyendo el código real)

- `frontend/app/app/layout.tsx`: envuelve las 8 páginas de `/app/*`, hoy un `<div>` vacío sin
  encabezado.
- `frontend/app/plataforma/page.tsx`: server component, ruta hermana, **usa la misma cookie**
  `uc_sesion_admin` que `/app/*` — mismo `logout()`, sin distinción.
- `frontend/lib/api.ts:109`: `export function logout(): Promise<{ ok: true }>` ya existe, llama
  `POST /auth/logout` (idempotente, borra la cookie).
- `frontend/components/ui/button.tsx`: `Button` con `variant="outline"|"default"`, `size="sm"|...`.
- Patrón de referencia ya en el repo: `app/portal/[slug]/page.tsx:54`, botón `<button
  className="text-sm text-red-600 hover:underline" onClick={alSalir}>Salir</button>` — mismo texto,
  mismo estilo de enlace rojo. Se replica el mismo criterio visual por consistencia, no el `Button`
  con fondo (evita competir visualmente con las acciones reales de cada página).

---

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/components/boton-salir.tsx` | crear | Client component reutilizable, un solo lugar para la lógica de salir |
| `frontend/app/app/layout.tsx` | editar | Agrega `<header>` con `<BotonSalir />` |
| `frontend/app/plataforma/page.tsx` | editar | Agrega `<BotonSalir />` en su encabezado |
| `CHANGELOG.md` | editar | Entrada de la sesión |

---

## 2. `boton-salir.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/api';

// Cierra sesión y SIEMPRE termina en /login, incluso si la petición falla
// (red caída, etc.) — la cookie es HttpOnly+Secure con expiración de 7 días,
// no tiene sentido dejar al usuario atrapado por un error de red al salir.
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
```

**Por qué no usa `useHidratado()` (CLAUDE.md §7):** esa regla es específicamente para
`<form onSubmit>` — previene el submit nativo de HTML durante la hidratación. Este es un
`<button type="button">` fuera de cualquier `<form>`, sin submit que interceptar; no aplica la misma
carrera.

**Por qué el `catch` solo hace `console.error` y sigue:** mismo criterio que `registrarIntentoLoginAdmin`
(017) y la regla 20 (correo) — un fallo al avisar al servidor no puede dejar a alguien sin poder
salir de la pantalla.

---

## 3. `app/app/layout.tsx`

```tsx
import { BotonSalir } from '@/components/boton-salir';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-end border-b border-border px-8 py-3">
        <BotonSalir />
      </header>
      {children}
    </div>
  );
}
```

`children` no cambia de contenedor ni de `max-w-*` propio — cada página sigue controlando su propio
`<main>` como hoy (CA-3: no empuja ni oculta nada, solo agrega una franja de 1 línea arriba).

## 4. `app/plataforma/page.tsx`

Se agrega `<BotonSalir />` junto al `<h1>Panel de plataforma</h1>` existente, mismo criterio visual
(fila superior, alineado a la derecha).

---

## 5. Decisiones técnicas

### 5.1 Un componente compartido, no dos copias
`/app/*` y `/plataforma` usan la misma cookie y la misma llamada `logout()` — un solo
`boton-salir.tsx` para los dos casos, en vez de duplicar la lógica (CLAUDE.md: una función, un
lugar).

### 5.2 No se toca el portal
`alSalir`/`logoutPortal` en `app/portal/[slug]/page.tsx` ya funciona con su propia cookie
(`uc_sesion_suscriptor`) y su propio criterio — no se generaliza a un componente compartido en esta
tarea para no arriesgar algo que ya funciona, por una tarea que no lo pidió (spec §4).

---

## 6. Dependencias nuevas

Ninguna.

---

## 7. Estrategia de pruebas

**Real, en el navegador de Mateo (ya hay acceso real en esta sesión):**
1. `npm run build && npm run lint` limpios.
2. Entrar a `/app/dashboard`, confirmar el botón visible arriba a la derecha, sin romper el resto
   del contenido.
3. Clic en "Salir" → termina en `/login`, y una petición posterior a `/app/dashboard` redirige a
   `/login` (cookie realmente borrada, no solo visual).
4. Repetir en `/app/suscriptores` (página con tabla ancha, el caso más propenso a que un header
   nuevo rompa algo) y en `/plataforma`.

## 8. Lo que este plan NO hace

No toca el portal del suscriptor. No agrega navegación, logo ni menú — solo el botón. No cambia
`logout()` ni `POST /auth/logout` del backend, ya funcionan.
