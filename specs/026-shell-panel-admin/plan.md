# PLAN — 026: shell-panel-admin

**Spec aprobado:** 2026-09-10

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/globals.css` | Modificado | Tokens nuevos: `--accent`/`--accent-soft`, `--success`/`-soft`, `--warning`/`-soft`, `--danger`/`-soft`, `--info`/`-soft` |
| `frontend/tailwind.config.ts` | Modificado | Expone los tokens nuevos como utilidades (`bg-success`, `text-danger-foreground`, etc.) |
| `frontend/components/ui/badge.tsx` | Nuevo | Variantes `success`/`warning`/`danger`/`info`/`gray` |
| `frontend/components/ui/kpi-card.tsx` | Nuevo | Ícono + etiqueta + valor + variación |
| `frontend/components/panel/iconos.tsx` | Nuevo | 9 íconos SVG del menú (mejora respecto al prototipo, ver §5) |
| `frontend/components/panel/sidebar-panel.tsx` | Nuevo | Barra lateral: logo, 9 enlaces con estado activo real, operador + Salir |
| `frontend/app/app/layout.tsx` | Modificado | Reemplaza el header simple por `<SidebarPanel>` + cabecera superior; carga Inter (`next/font/google`), acotado a `/app/*` |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna — feature puramente de interfaz.

## 4. Contratos de core/

Ninguno.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| **Mejora propia:** los 9 íconos del menú son SVG en línea (`iconos.tsx`), no los glifos Unicode del prototipo (⌂ ▣ $ ◉ **♙** ▤ ⚡ ◌ ⚙) | Mantener los glifos tal cual | El prototipo es una demo de un solo archivo; en producción esos glifos dependen de qué fuentes tenga instaladas el sistema operativo del usuario (se ven distinto en Windows/Android/Linux, y **♙ es un peón de ajedrez** para "Suscriptores" — un accidente de la fuente de emoji del prototipo, no una elección real) y no tienen etiqueta accesible para lectores de pantalla. SVG fijo + `aria-hidden` en el ícono + el texto real del enlace como etiqueta: mismo resultado visual en cualquier dispositivo, accesible de verdad. Mismo criterio de cero dependencias ya usado en 023/025 |
| **Mejora propia:** el enlace activo de la barra lateral se calcula con `usePathname()` de Next.js contra el prefijo real de cada sección (`pathname.startsWith('/app/facturacion')`, etc.), no un estado fijo | Una prop `activo` fija por página, como en el prototipo (que solo alternaba `display:none/block` sobre un único archivo, sin rutas reales) | El prototipo no tenía sub-páginas que resolver; la app real sí: `/app/facturacion/[facturaId]`, `/app/suscriptores/[id]`, `/app/suscriptores/importar`, `/app/pagos/[suscriptorId]`, `/app/catalogo/[servicioId]` y `/app/lecturas/periodo` tienen que resaltar la sección padre correcta. Calcularlo por prefijo de ruta lo resuelve una sola vez, para todas |
| Tipografía Inter cargada con `next/font/google`, no un `<link>` de Google Fonts | `<link rel="stylesheet">` en el `<head>` | `next/font` auto-hospeda el archivo de la fuente en el build (sin llamada externa en producción) y evita el parpadeo de fuente sin estilo (FOUT) — mejor rendimiento que un link externo, cero configuración adicional |
| Los tokens de color nuevos se **agregan** a `globals.css`, no reemplazan los de shadcn (`--background`, `--border`, etc.) | Migrar todos los nombres de variable al esquema del prototipo | Cada componente ya construido (`Button`, `Card`, `Input`, `Label`, y las 15 pantallas existentes) usa los nombres actuales — reemplazarlos sin re-vestir cada pantalla a la vez rompería el panel completo hoy mismo, contra el propio alcance de la feature (§4 del spec) |

## 6. Dependencias nuevas

`next/font/google` ya es parte de Next.js (no es una dependencia nueva de `package.json`) — solo
se usa una importación que ya viene con el framework instalado.

## 7. Límites de Cloudflare Workers a considerar

Ninguno — `next/font` resuelve la fuente en tiempo de build, no agrega peso relevante al Worker
del backend (que no cambia).

## 8. Estrategia de pruebas

- **Unitarias / aislamiento:** no aplica (sin `core/`, sin RLS).
- **Integración (manual, `wrangler dev` + `next dev` reales):** con sesión de `admin_acueducto`
  real, recorrer las 9 rutas del panel y confirmar que (a) el shell nuevo envuelve cada una, (b) el
  enlace activo de la barra lateral es el correcto incluso en sub-páginas
  (`/app/facturacion/[id]`, `/app/suscriptores/[id]`, etc.), (c) "Salir" sigue funcionando, (d) las
  9 pantallas no perdieron ninguna función existente (regresión).
- **Manual, requiere Mateo:** confirmar visualmente que la barra lateral colapsa bien en pantalla
  angosta y que Inter se ve como se espera (este entorno sigue sin Chromium/Playwright).
