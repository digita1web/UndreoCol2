# CHANGELOG — UndreoCol

Formato: una entrada por sesión de trabajo. Lo más reciente arriba.

## [Sin publicar]

### 2026-09-01 — Sesión 008: T-010 (frontend base) y T-014 (restaura INFRAESTRUCTURA.md)

**Hecho**
- **T-010** — Frontend Next.js 15 + `@opennextjs/cloudflare` verificado de punta a punta
  (`npm ci`, `npm run lint`, `npm run build`, `npm run pages:build`, todo en verde). Se
  encontraron y corrigieron 4 problemas reales durante la verificación, ninguno anticipado en
  `plan.md`: faltaba `open-next.config.ts` (se agregó sin caché incremental en R2, decisión de
  Mateo); faltaba `frontend/wrangler.toml` (formato `.toml`, mismo `compatibility_date` que
  `backend/`); recursión infinita en el script `build` de `package.json` (`opennextjs-cloudflare
  build` se autoinvocaba vía `npm run build`); `eslint.config.mjs` con import roto y, tras
  corregirlo, incompatibilidad real entre el eslintrc clásico que exporta `eslint-config-next` y
  flat config — resuelta con `FlatCompat`. `plan.md §1.2` actualizado con los dos archivos que
  faltaban en el plan original.
- **T-014** — `docs/INFRAESTRUCTURA.md` reconstruido por completo (379 líneas, 12 secciones),
  reemplazando la copia corrupta de `ARQUITECTURA.md` que llevaba desde la sesión 007. El
  contenido de reemplazo llegó de un borrador de Mateo redactado antes de que existiera el código
  real de T-002 a T-009; **cada sección se verificó contra el código/config real y contra
  `plan.md`/`docs/DECISIONES.md` antes de escribirse, y donde hubo contradicción ganó el código o
  el plan aprobado, nunca el borrador.** Discrepancias encontradas y corregidas: cron del
  keepalive (`0 5 * * *` real, no `0 9 * * *`) y su mecanismo (`@supabase/supabase-js`, no `fetch`
  REST manual); backup diario — `.github/workflows/backup-diario.yml` no existe todavía (T-013
  pendiente), y el borrador usaba puerto `5432` y una GitHub Action de terceros en vez del puerto
  `6543` y `wrangler r2 object put` que exige D-7, además de un paso de purga manual en CI que D-7
  descarta explícitamente a favor de la regla *lifecycle* de R2; y, el hallazgo más importante, la
  sesión del suscriptor (§10) — el borrador asumía un mecanismo ya implementado, pero
  `sesion-suscriptor.ts` es solo el contrato reservado de la feature 008 (todas sus funciones
  lanzan `ErrorSesionSuscriptorPendiente`), documentado como tal, sin inventar un mecanismo de
  firma que no existe en el código.
- **Corrección posterior (misma sesión):** al aplicar los commits en la máquina de Mateo, el
  commit de T-014 se saltó por conflicto (`git am --skip`) y el reemplazo manual de
  `docs/INFRAESTRUCTURA.md`/`CHANGELOG.md` terminó publicando en `main` el **borrador original sin
  corregir** (con los mismos errores ya documentados arriba: cron `0 9 * * *`, puerto `5432`,
  `SUPABASE_SESSION_POOLER_URL`, la GitHub Action de terceros). Detectado por `grep` contra el
  contenido real tras sincronizar con `origin/main` para empezar T-011; corregido reescribiendo
  ambos archivos con el contenido verificado.

**Pendiente**
- T-011, T-012 (frontend: login/middleware/api, onboarding/dashboard) — sin empezar.
- T-013 (workflow de backup diario) — sin empezar; requiere secretos de Mateo para verificarse
  contra R2 real.
- T-015 (cierre de la feature, CHANGELOG final, flujo manual CA-11 con Mateo en navegador).

### 2026-08-31 — Sesión 007: Arquitectura definitiva sin servidor propio
**Hecho**
- Reescritos `ARQUITECTURA.md`, `docs/INFRAESTRUCTURA.md`, `CLAUDE.md`,
  `docs/ESPECIFICACION-FUNCIONAL.md`, `docs/ESTRATEGIA-CALIDAD.md` y
  `specs/001-fundacion/spec.md` con la arquitectura definitiva
- Documentadas las decisiones D-6, D-7, D-8, D-9 en `docs/DECISIONES.md`
  función `tamano_base_mb()`
- Actualizado el roadmap en `.specify/config.md` con las features 006
  (renombrada a impresión-y-correo), 014 (PWA con QR) y 015 (limpieza
  automática completa)

**Decisiones**
- **D-6:** arquitectura sin VPS — Next.js/Cloudflare Pages + Hono.js/Cloudflare
  Workers + Supabase PostgreSQL. Se descartaron VPS en Hetzner, Hostinger y
  LightNode tras investigación exhaustiva de comunidad, costos y fricción de
  pago desde Colombia.
- **D-7:** Supabase Free se explota al máximo con tres controles propios
  (keepalive diario, backup diario a R2 vía GitHub Actions, monitoreo de
  tamaño con alertas en 300/400/480 MB) en vez de pagar Supabase Pro desde el
  inicio. Proyección: con 1 cliente de ~1.000 suscriptores, el límite de
  500 MB no se alcanza en varios años.
- **D-8:** la entrega de factura tiene como flujo principal la impresión
  directa desde el navegador (`@media print`), no la generación de PDF. El
  correo con PDF adjunto es un flujo secundario y opcional.
- **D-9:** el PDF (solo para el flujo de correo) se genera con `pdf-lib`, no
  con `pdfme` completo ni con Chromium/Puppeteer — corre dentro de los límites
  de memoria y CPU de Cloudflare Workers.
- El escaneo de código QR se incorpora a la PWA del lector para identificar el
  contador sin error de digitación (nueva feature 014 en el roadmap).

**Pendientes**
- Tarifas reales verificadas (D-5) — bloqueante para el dataset dorado
  definitivo
- Aprobación de `specs/001-fundacion/spec.md` actualizado por Mateo
- Redactar `specs/001-fundacion/plan.md`
