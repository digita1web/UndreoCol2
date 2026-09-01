# UndreoCol

SaaS colombiano para la gestión de acueductos comunitarios y pequeñas empresas de
servicios públicos: facturación por consumo, lecturas de contador, pagos, cortes y
reconexiones, RRHH e indicadores.

**Estado:** en construcción. Sin producción.

## Documentación

| Archivo | Contenido |
|---|---|
| `CLAUDE.md` | Reglas de desarrollo. Lectura obligatoria antes de tocar código |
| `ARQUITECTURA.md` | Stack definitivo, costos, roadmap |
| `docs/DECISIONES.md` | Registro de decisiones D-1 a D-9, con contexto y razón |
| `docs/ESPECIFICACION-FUNCIONAL.md` | Qué debe hacer el sistema |
| `docs/INFRAESTRUCTURA.md` | Configuración operativa: keepalive, backups, monitoreo |
| `docs/ESTRATEGIA-CALIDAD.md` | Cómo se previenen y contienen los bugs |
| `docs/esquema-propuesto.sql` | Esquema PostgreSQL de referencia |
| `docs/esquema-propuesto.sql` (sección 18) | Adiciones del esquema para D-7 |
| `.specify/config.md` | Flujo SDD y roadmap de features |
| `specs/` | Spec, plan y tasks por feature |
| `CHANGELOG.md` | Historial de sesiones |

## Stack

Next.js 15 (Cloudflare Pages) · Hono.js (Cloudflare Workers) · PostgreSQL vía
Supabase (Free) · Row Level Security · Cloudflare R2 · Cloudflare Queues ·
Cloudflare Email Service · Tailwind + shadcn/ui

**Sin servidor propio.** Ver `docs/DECISIONES.md` D-6.

## Desarrollo

Costo de infraestructura en desarrollo: $0.

```bash
# Base de datos local
supabase start

# Backend (Hono en Workers, modo local)
cd backend && npx wrangler dev

# Frontend
cd frontend && npm install && npm run dev
```

## Costos de producción

| Etapa | Costo/mes |
|---|---|
| Desarrollo y demos | $0 |
| Primer cliente pagando | $5 USD (Cloudflare Workers Paid) |
| Base de datos > 400 MB | $30 USD (+ Supabase Pro) |

Detalle completo de disparadores en `ARQUITECTURA.md §6`.

## Metodología

Spec-Driven Development: `/specify` → `/plan` → `/tasks` → `/implement`, con
checkpoint de aprobación humana en cada fase. Detalle en `.specify/config.md`.

**Regla de git:** la IA hace commit, el humano hace push.
