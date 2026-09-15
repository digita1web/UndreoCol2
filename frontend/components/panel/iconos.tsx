// 026: íconos del menú del panel, SVG en línea — reemplaza los glifos Unicode
// del prototipo (⌂ ▣ $ ◉ ♙ ▤ ⚡ ◌ ⚙), que dependen de qué fuente de emoji
// tenga el sistema operativo del usuario y no tienen etiqueta accesible.
// Mismo estilo (stroke, 20x20) que components/lector/shell-lector.tsx.

type PropsIcono = React.SVGProps<SVGSVGElement>;
const BASE = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true } as const;

export function IconoPanel(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoFacturacion(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <path d="M7 3h10a1 1 0 0 1 1 1v16l-3-2-2 2-2-2-2 2-2-2-1 .5V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" strokeLinecap="round" />
    </svg>
  );
}

export function IconoCartera(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconoLecturas(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 13 15.5 9.5" strokeLinecap="round" />
      <path d="M9 4.5 12 3l3 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoSuscriptores(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8" strokeLinecap="round" />
      <path d="M15.5 14.3A5.5 5.5 0 0 1 20.5 20" strokeLinecap="round" />
    </svg>
  );
}

export function IconoCatalogo(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 3 4 7v4c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V7l-8-4z" strokeLinejoin="round" />
      <path d="M9 12.5 11 14.5 15.5 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoCortes(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoNotificaciones(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z" strokeLinejoin="round" />
      <path d="M10 18a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

export function IconoLectores(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 21s7-6.5 7-11.5a7 7 0 0 0-14 0C5 14.5 12 21 12 21z" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

export function IconoConfiguracion(props: PropsIcono) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19.5a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H4.5a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1.04-1.56V4.5a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.05a1.7 1.7 0 0 0 1.56 1.04h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04z" />
    </svg>
  );
}
