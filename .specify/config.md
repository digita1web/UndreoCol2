# Configuración del harness SDD — UndreoCol

## Flujo obligatorio

    /specify  →  spec.md   →  [CHECKPOINT: aprobación de Mateo]
    /plan     →  plan.md   →  [CHECKPOINT: aprobación de Mateo]
    /tasks    →  tasks.md  →  [CHECKPOINT: aprobación de Mateo]
    /implement→  código    →  commit por tarea verificada

Ninguna fase avanza sin aprobación humana explícita. No se encadenan fases.

## Arquitectura vigente (ver ARQUITECTURA.md y docs/DECISIONES.md D-6)

    Frontend  → Next.js       → Cloudflare Pages
    Backend   → Hono.js       → Cloudflare Workers
    Datos     → PostgreSQL    → Supabase (Free, ver D-7)
    Archivos  → Cloudflare R2
    Procesos  → Cloudflare Queues

Sin VPS, sin servidor propio.

## Convención de carpetas

    specs/NNN-nombre-corto/
      spec.md    Qué se construye y cómo se verifica
      plan.md    Cómo: archivos, esquema, decisiones
      tasks.md   Tareas atómicas con su verificación

NNN es correlativo de tres dígitos: 001, 002, 003...

## Plantillas

En `specs/plantillas/`. Se copian al crear cada feature nueva.

## Roadmap de features

| NNN | Feature | Depende de | Estado |
|-----|---------|-----------|--------|
| 001 | fundacion (Pages+Workers+Hono+Supabase, keepalive, backup, monitoreo) | — | Spec aprobado, pendiente /plan |
| 002 | catalogo-y-tarifas   | 001 | Pendiente |
| 003 | suscriptores-contadores | 002 | Pendiente |
| 004 | lecturas-y-consumo   | 003 | Pendiente |
| 005 | facturacion          | 004 | Pendiente |
| 006 | impresion-y-correo-factura (D-8, D-9 — reemplaza "pdf-facturas") | 005 | Pendiente |
| 007 | pagos                | 005 | Pendiente |
| 008 | portal-suscriptor    | 006 | Pendiente |
| 009 | cortes-reconexiones  | 007 | Pendiente |
| 010 | notificaciones       | 006 | Pendiente |
| 011 | dashboard            | 007 | Pendiente |
| 012 | rrhh-incapacidades   | 001 | Pendiente |
| 013 | exportes-contables   | 007 | Pendiente |
| 014 | pwa-lector-qr        | 004 | Pendiente |
| 015 | limpieza-automatica  | 009 | Pendiente (Worker de limpieza completo, ver INFRAESTRUCTURA.md §9) |

## Regla de git

La IA hace commit. Mateo hace push. Ver CLAUDE.md §9.
