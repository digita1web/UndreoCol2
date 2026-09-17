'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BotonSalir } from '@/components/boton-salir';
import { obtenerContextoUsuario } from '@/lib/api';
import {
  IconoCartera,
  IconoCatalogo,
  IconoConfiguracion,
  IconoCortes,
  IconoFacturacion,
  IconoLectores,
  IconoLecturas,
  IconoNotificaciones,
  IconoPanel,
  IconoSuscriptores,
} from '@/components/panel/iconos';

const SECCIONES = [
  { href: '/app/dashboard', etiqueta: 'Panel', Icono: IconoPanel },
  { href: '/app/facturacion', etiqueta: 'Facturación', Icono: IconoFacturacion },
  { href: '/app/pagos', etiqueta: 'Cartera', Icono: IconoCartera },
  { href: '/app/lecturas', etiqueta: 'Lecturas', Icono: IconoLecturas },
  { href: '/app/lectores', etiqueta: 'Lectores', Icono: IconoLectores },
  { href: '/app/suscriptores', etiqueta: 'Suscriptores', Icono: IconoSuscriptores },
  { href: '/app/catalogo', etiqueta: 'Catálogo y tarifas', Icono: IconoCatalogo },
  { href: '/app/cortes', etiqueta: 'Cortes', Icono: IconoCortes },
  { href: '/app/notificaciones', etiqueta: 'Notificaciones', Icono: IconoNotificaciones },
  { href: '/app/configuracion', etiqueta: 'Configuración', Icono: IconoConfiguracion },
] as const;

// 026 (mejora propia): activo por prefijo de ruta real, no un estado fijo —
// el prototipo era una sola pantalla sin sub-páginas que resolver; la app
// real sí tiene /app/facturacion/[id], /app/suscriptores/[id], etc.
function esSeccionActiva(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ETIQUETA_ROL: Record<string, string> = {
  admin_acueducto: 'Administrador',
  secretaria: 'Secretaria',
  lector: 'Lector',
  administrador: 'Superadmin',
};

export function SidebarPanel() {
  const pathname = usePathname();
  const [operador, setOperador] = useState<{ nombre: string; rol: string } | null>(null);

  useEffect(() => {
    obtenerContextoUsuario()
      .then((r) => setOperador({ nombre: r.perfil.nombre, rol: r.cliente.rol }))
      .catch((e) => console.error('No se pudo cargar el operador para la barra lateral', e));
  }, []);

  const iniciales = (operador?.nombre ?? '')
    .trim()
    .split(/\s+/)
    .map((parte) => parte[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="flex w-full flex-col border-b border-border bg-background p-4 sm:fixed sm:inset-y-0 sm:left-0 sm:w-[250px] sm:border-b-0 sm:border-r print:hidden">
      <div className="flex items-center gap-2.5 px-2 pb-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático de public/, sin optimización de next/image necesaria */}
        <img src="/logo/logo.svg" alt="" aria-hidden className="h-9 w-9 shrink-0 rounded-[11px]" />
        <div>
          <p className="text-[17px] font-bold leading-tight tracking-tight">UndreoCol</p>
          <p className="text-[11px] leading-tight text-muted-foreground">Gestión de acueductos</p>
        </div>
      </div>

      <nav className="grid grid-cols-3 gap-1 sm:flex sm:flex-col">
        {SECCIONES.filter(
          ({ href }) =>
            (href !== '/app/configuracion' || operador?.rol !== 'secretaria') &&
            (href !== '/app/lectores' || operador?.rol === 'admin_acueducto'),
        ).map(({ href, etiqueta, Icono }) => {
          const activa = esSeccionActiva(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm font-medium ${
                activa ? 'bg-accent-soft font-bold text-accent' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icono />
              <span className="truncate">{etiqueta}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 flex items-center justify-between gap-2.5 border-t border-border pt-3.5 sm:mt-auto">
        <div className="flex min-w-0 items-center gap-2.5 px-2">
          <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
            {iniciales || '··'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold">{operador?.nombre ?? 'Cargando…'}</p>
            <p className="text-[11px] text-muted-foreground">
              {operador ? ETIQUETA_ROL[operador.rol] ?? operador.rol : ''}
            </p>
          </div>
        </div>
        <BotonSalir />
      </div>
    </aside>
  );
}
