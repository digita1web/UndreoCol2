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
| 001 | fundacion (Pages+Workers+Hono+Supabase, keepalive, backup, monitoreo) | — | Completa (CHANGELOG Sesiones 007-008) |
| 002 | catalogo-y-tarifas   | 001 | Completa (CHANGELOG Sesión 009) |
| 003 | suscriptores-contadores | 002 | Completa (CHANGELOG Sesión 010) |
| 004 | lecturas-y-consumo   | 003 | Completa (CHANGELOG Sesión 011) |
| 005 | facturacion          | 004 | Completa (CHANGELOG Sesión 012) |
| 006 | impresion-y-correo-factura (D-8, D-9 — reemplaza "pdf-facturas") | 005 | Completa (CHANGELOG Sesión 013) |
| 007 | pagos-y-cartera      | 005 | Completa (CHANGELOG Sesión 014) |
| 008 | portal-suscriptor    | 006 | Completa (CHANGELOG Sesión 015) |
| 009 | cortes-reconexiones  | 007 | En /specify — spec.md en revisión, 2 decisiones de alcance pendientes de aprobación |
| 010 | notificaciones       | 006 | Pendiente |
| 011 | dashboard            | 007 | Pendiente |
| 012 | importacion-suscriptores-excel (carga masiva del acueducto piloto desde Excel/CSV) | 003 | En /specify — spec.md en revisión |
| 013 | exportes-contables   | 007 | Pendiente |
| 014 | rrhh-incapacidades   | 001 | Pendiente |
| 015 | qr-ocr-lector (identificación de contador por QR + lectura automática por OCR, ver `docs/ESPECIFICACION-FUNCIONAL.md §2.14.1`) | 004 | Pendiente — diferenciador tecnológico principal, requiere máximo rigor de precisión y confiabilidad |
| 016 | limpieza-automatica  | 009 | Pendiente (Worker de limpieza completo, ver INFRAESTRUCTURA.md §9). La purga de los contadores de intentos de login ya la hace 017 |
| 017 | rate-limit-login-admin (límite de intentos del login administrativo) | 001, 008 | **Implementada** — **PRERREQUISITO DE PRODUCCIÓN: va antes que 013-016 pese al número.** Nace del hallazgo A-2 (ALTO) de la auditoría pre-producción, no del roadmap original |
| 018 | panel-plataforma (alta de acueductos por el superadmin, `/plataforma`) | 001 | **Implementada** — **PRERREQUISITO DE PRODUCCIÓN: va antes que 013-016 pese al número.** Sin esto, dar de alta un acueducto solo se puede hacer por SQL manual. No nace de un hallazgo de auditoría: nace de una petición directa de Mateo en sesión, más el bug de `resolverClienteActivo` encontrado al intentar cumplirla |
| 019 | invitación por correo para el alta de acueductos (Opción A descartada en 018 §0.3) | 018 | Pendiente — mejora futura, sin fecha. El admin nuevo fijaría su propia contraseña al aceptar una invitación, en vez de recibir una temporal generada por el superadmin |
| 020 | proxy-cookies-mismo-origen (el navegador deja de hablar directo con la API) | 001 | **Implementada, pendiente de verificación real de Mateo** — **PRERREQUISITO DE PRODUCCIÓN, bloqueador total: hoy ningún login funciona en producción** (ni el administrativo ni el del portal). Nace de un bug encontrado al probar 018 en producción, no de la auditoría ni del roadmap. Corrige el hallazgo M-4, que la auditoría había cerrado mal ("probablemente ya no aplica") |

## Regla de git

La IA hace commit. Mateo hace push. Ver CLAUDE.md §9.
