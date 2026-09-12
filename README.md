# UndreoCol

SaaS colombiano para la gestión de acueductos comunitarios y pequeñas empresas de
servicios públicos: facturación por consumo, lecturas de contador, pagos, cortes y
reconexiones, RRHH e indicadores.

**Estado:** en desarrollo activo, siguiendo Spec-Driven Development (`specs/001` a
`specs/029`). La infraestructura de producción (`undreocol-produccion`, Cloudflare
Workers) está desplegada y con el esquema al día — pero sin cliente piloto real
todavía: 0 acueductos, 0 suscriptores. Detalle completo del estado y de lo pendiente en
`docs/PLAN-PRODUCCION.md`.

## Documentación

| Archivo | Contenido |
|---|---|
| `CLAUDE.md` | Reglas de desarrollo. Lectura obligatoria antes de tocar código |
| `ARQUITECTURA.md` | Stack definitivo, costos, roadmap |
| `docs/DECISIONES.md` | Registro de decisiones D-1 a D-9, con contexto y razón |
| `docs/ESPECIFICACION-FUNCIONAL.md` | Qué debe hacer el sistema |
| `docs/INFRAESTRUCTURA.md` | Configuración operativa: keepalive, backups, monitoreo |
| `docs/INFRAESTRUCTURA-Y-COSTOS.md` | Investigación de costos e infraestructura |
| `docs/ESTRATEGIA-CALIDAD.md` | Cómo se previenen y contienen los bugs |
| `docs/PLAN-PRODUCCION.md` | Auditoría de seguridad pre-producción + consolidado de todo lo pendiente |
| `docs/esquema-propuesto.sql` | Esquema PostgreSQL de referencia (`supabase/migrations/` es la fuente de verdad real, versionada) |
| `.specify/config.md` | Flujo SDD y roadmap de features |
| `specs/` | Spec, plan y tasks por feature |
| `CHANGELOG.md` | Historial de sesiones |

## Stack

Next.js 15 (frontend + PWA del lector) · Hono.js sobre Cloudflare Workers · PostgreSQL
vía Supabase (Free) · Supabase Auth (sesión admin) + JWT propio firmado en Worker
(sesión del suscriptor) · Row Level Security · Cloudflare R2 · Cloudflare Queues ·
Cloudflare Email Service · `pdf-lib` (solo adjunto de correo) · Tailwind + shadcn/ui

**Sin servidor propio.** Ver `docs/DECISIONES.md` D-6.

## Desarrollo

Costo de infraestructura en desarrollo: $0.

Requiere **Node ≥22** para `wrangler` (backend y frontend). Con una versión anterior,
`wrangler` rehúsa arrancar con un mensaje explícito — usar `nvm use 22` si hace falta.

```bash
# Base de datos local (aplica las migraciones de supabase/migrations/ automáticamente)
supabase start

# Backend (Hono en Workers, modo local)
cd backend && npm install && npx wrangler dev

# Tests del backend (unitarios; los de aislamiento RLS corren aparte contra Postgres real)
cd backend && npm test

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

**Despliegue:** automático por GitHub Actions (`deploy-backend.yml`/`deploy-frontend.yml`)
en cada push a `main` que toque `backend/**`/`frontend/**` — nunca `wrangler deploy` a
mano (ver `docs/PLAN-PRODUCCION.md`, incidentes de despliegue manual de las sesiones 021
y 035).

**Regla de git:** la IA hace commit, el humano hace push.
