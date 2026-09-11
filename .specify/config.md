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
| 020 | proxy-cookies-mismo-origen (el navegador deja de hablar directo con la API) | 001 | **Implementada y verificada en producción real (Sesión 035)** — cerró el bloqueador total de login. La causa raíz final no fue el proxy en sí (correcto desde el principio) sino un `frontend/.env.production` local que lo sobrescribía en cada build — ver CHANGELOG Sesión 035 |
| 021 | cerrar-sesion-admin (botón "Salir" en `/app/*` y `/plataforma`) | 018, 020 | **Implementada** — nace de una petición directa de Mateo, no de un hallazgo. El portal del suscriptor ya tenía su propio botón, no se tocó |
| 022 | despliegue-automático (CI/CD a Cloudflare vía GitHub Actions) | 020 | **Implementada** — nace de dos incidentes reales de despliegue manual en esta sesión (021 y 035). Incluye verificaciones automáticas que repiten en CI los diagnósticos manuales que encontraron ambos bugs |
| 023 | personalizacion-factura (color de acento por acueducto + encabezado faltante en la vista de impresión) | 006, 018 | **Implementada** — nace de una pregunta directa de Mateo; de paso cerró que 006 quedó incompleto (la vista de impresión nunca mostró el encabezado del acueducto). Renderizado final en navegador real: NO VERIFICADO, requiere Mateo |
| 024 | permisos-lector (cierra M-2 y M-2b) | 001, 003, 004, 005 | **Implementada** — el lector pierde lectura de 10 tablas (facturas/pagos/tarifas/configuración/etc.); usuarios_servicio queda acotado a 5 columnas sin PII vía función nueva. De paso cerró M-2b, hallazgo más grave encontrado auditando: un lector podía disparar la emisión real de facturas de todo el acueducto por una ruta sin guard de rol. Asignación de rutas/órdenes queda fuera de alcance (no existe todavía, ESPECIFICACION-FUNCIONAL.md §2.14.1) |
| 025 | app-lector-movil ("AquaLectura": rediseño móvil de /app/lecturas solo para el rol lector) | 004, 024 | **Implementada** — nace de un mockup de Figma de Mateo; acotado en conversación: sin OCR real (eso es 015), sin zona/ruta asignada (fuera de alcance de 024). De paso corrigió un efecto colateral real de 024 (GET /dashboard mostraba 0 usuarios_servicio al lector). Renderizado final en navegador real: NO VERIFICADO, requiere Mateo |
| 026 | shell-panel-admin (tokens de diseño + barra lateral/cabecera, primera fase del rediseño de `undreocol_ui_propuesta.html`) | 018, 021, 023 | **Implementada** — marco compartido (sidebar con 9 enlaces reales y estado activo por ruta, topbar, tipografía Inter, tokens de color, Badge/KpiCard sin usar todavía). AquaLectura (025) se mantiene tal cual para el lector. Colapso responsivo y aspecto final de Inter en navegador real: NO VERIFICADO, requiere Mateo |
| 027 | panel-principal (re-viste /app/dashboard con KpiCard/Badge de 026 — segunda pantalla del rediseño) | 011, 026 | **Implementada** — cero datos nuevos (usa GET /dashboard/indicadores tal como existe). "Recaudo del mes" gana una variación real vs. mes anterior, calculada de datos ya existentes. Aspecto visual final en navegador real: NO VERIFICADO, requiere Mateo |
| 028 | rol-secretaria (nuevo rol dentro del acueducto: trabajo administrativo sin ver el panel financiero) | 001, 024, 026 | **Implementada** — RLS + guards de API + UI: gestiona operación administrativa y registro de pagos, sin indicadores ni acciones consecuentes; integración HTTP/navegador real pendiente de Mateo |
| 029 | autorizacion-tarifas-secretaria (delegación temporal, específica y de un solo uso para cambiar tarifas) | 002, 028 | **Implementada** — autorización con expiración, revocación, bitácora inmutable y uso único; selector multiacueducto visual del superadmin queda separado |

## Regla de git

La IA hace commit. Mateo hace push. Ver CLAUDE.md §9.
