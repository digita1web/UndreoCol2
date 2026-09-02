# CHANGELOG — UndreoCol

Formato: una entrada por sesión de trabajo. Lo más reciente arriba.

## [Sin publicar]

### 2026-09-04 — Sesión 011: 004-lecturas-y-consumo completa (T-001 a T-006)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/004-lecturas-y-consumo/`): commit `b5236ec`, `61d94fe`,
  `30123e1`.
- **T-001** — Migración `20260904090000_lecturas-consumo.sql`: enums `estado_periodo` y
  `revision_lectura`; tabla `periodos` (unique `(cliente_id, anio, mes)` + índice parcial
  `uq_periodo_abierto`: un solo periodo abierto por cliente); tabla `lecturas` con FKs `ON DELETE
  RESTRICT`, unique `(contador_id, periodo_id)`, unique `id_cliente_offline`, `chk_consumo >= 0` y
  el índice parcial de la cola de anomalías. Función+trigger `bloquear_lectura_periodo_cerrado()`
  (`SECURITY DEFINER`, solo lee `estado`). RLS `FORCE` en ambas tablas: el lector lee periodos y
  puede insertar/leer lecturas de su cliente, pero gestionar periodos y marcar revisiones es solo
  `admin_acueducto`. Verificado contra **Supabase local real** (`supabase db reset --local`,
  PostgreSQL 17.6) — entorno con Docker disponible por primera vez en 004 (vs shim de 002/003).
- **T-002** — Fixtures `tests/fixtures/lecturas.sql` (periodo abierto por cliente; A con lectura,
  B sin lecturas) y `tests/aislamiento/004_lecturas_consumo_aislamiento.sql` (9 pasos). **Dos
  hallazgos reales**: (1) RLS es **silencioso** para UPDATE/DELETE — el lector que intenta marcar
  `revisada` no lanza excepción, simplemente afecta 0 filas; el test verifica `row_count = 0`.
  (2) `ON CONFLICT (id_cliente_offline)` no bastaba porque la misma fila también violaba
  `(contador_id, periodo_id)`; el PASO 9 ahora prueba la idempotencia de reenvío sobre el cliente
  B (verifica 1 sola fila). Regresión 001/002/003 en verde.
- **T-003** — `core/consumo.ts` (lógica pura, CLAUDE.md §5.3): `calcularConsumoPeriodo` (rollover y
  rechazo puntos 1-2), `calcularConsumoConReemplazo` (punto 7) y `clasificarAnomalia` (puntos
  5-6), con m³ a 2 decimales. 22 unit tests `vitest` (umbral exacto/por encima/por debajo, dígitos
  5 y 6, tramos de reemplazo, anomalías alto/bajo/cero, y propiedad no negativo/<= capacidad +
  determinismo). `npm test` → 36 tests en verde.
- **T-004** — `lib/lecturas.ts` (capa fina; `lectura_anterior` SIEMPRE resuelta por el backend, nunca
  del cliente; idempotencia por `id_cliente_offline`) y las rutas `POST/GET /periodos`,
  `PATCH /periodos/:id/cerrar`, `GET/POST /lecturas`, `PATCH /lecturas/:id/revisar`. Se amplió
  `requerirClienteActivo` para exponer `perfilId` (autor de cierre/lectura/revisión). `tsc`, `eslint`
  y `wrangler deploy --dry-run` en verde (814.66 KiB / gzip 160.91 KiB).
- **T-005** — Frontend: `lib/api.ts` ampliado con funciones de periodos/lecturas y los paneles
  `/app/lecturas` (consulta por periodo, cola de anomalías, alta manual) y `/app/lecturas/periodo`
  (crear/cerrar el periodo del mes), protegidos por el middleware existente. `npm run build` (11/11)
  y `npm run lint` en verde.
- **T-006** — Cierre: checklist de `spec.md §8`, CHANGELOG y re-corrida de los 4 tests de
  aislamiento sobre el estado final.

**Entorno (cambio respecto a 002/003)**
Este contenedor ahora DISPONE de Docker con Supabase local completo (CLI 2.116.0, PostgreSQL 17.6,
esquemas auth/storage/realtime, `auth.uid()` nativo). La verificación de esquema/RLS/funciones se
hizo contra Supabase local real (`supabase db reset --local`), más fiel que el shim de 002/003.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- **CA-4** (T-004): correr los `curl` reales de `tasks.md` contra `wrangler dev` conectado a la base
  local (login admin real → POST /periodos → POST /lecturas → PATCH /.../revisar). Pasos exactos en
  `tasks.md` T-004.
- **CA-6** (T-005): flujo completo en navegador (`next dev` + `wrangler dev`). Pasos exactos en
  `tasks.md` T-005.

### 2026-09-02 — Sesión 010: 003-suscriptores-contadores completa (T-001 a T-009)

**Hecho**
- **T-001** — Migración `20260902090000_suscriptores-contadores.sql`: `ALTER TABLE
  usuarios_servicio` con 10 columnas nuevas **NULLABLE** (la tabla ya tenía filas de fixtures de
  001/002; un `NOT NULL` directo habría roto el reset — requerido real exigido en la capa de
  aplicación para suscriptores nuevos). Enum `estado_contador`, tablas `contadores` (índice único
  parcial de contador activo) y `reemplazos_contador` (FKs de contador `ON DELETE RESTRICT`).
  Función `reemplazar_contador()` (`SECURITY INVOKER`, `SELECT FOR UPDATE` sobre
  `usuarios_servicio`, no sobre `contadores` — es la fila que decide cuál es "el activo"). RLS
  `FORCE` + políticas reutilizando `es_admin_de()`/`mis_clientes()`/`es_admin_plataforma()` de
  001, sin funciones de seguridad nuevas. Verificado explícitamente que la migración no pierde
  las 3 filas existentes de `usuarios_servicio`.
- **T-002** — Fixtures y test de aislamiento (7 pasos) cubriendo CA-2 y CA-5. **Hallazgo real**: el
  `SELECT ... FOR UPDATE` de `reemplazar_contador()` aplica la política RLS de **escritura** de
  `usuarios_servicio`, no la de lectura — confirmado directamente comparando un `SELECT` plano
  contra el mismo `SELECT ... FOR UPDATE` para un lector del mismo acueducto (0 filas). El chequeo
  `es_admin_de()` explícito dentro de la función queda como defensa adicional, no como ruta
  principal, para ese caso — documentado en la migración y en el test.
- **T-003/T-004** — Backend: `lib/suscriptores.ts` y las rutas `GET/POST /suscriptores`,
  `GET/PATCH /suscriptores/:id` (contador activo + historial de reemplazos en el detalle),
  `POST /suscriptores/:id/contador`, `POST /suscriptores/:id/reemplazar-contador`. Corrección de
  alcance sobre el plan: se quitó una ruta `GET /suscriptores/:id/contadores` que no estaba en
  `plan.md §3` (el detalle ya cubre lo que pide el spec).
- **T-005 a T-007** — Frontend: `lib/api.ts` ampliado, panel `/app/suscriptores` (lista con filtro
  por estado, alta) y `/app/suscriptores/[id]` (datos, contador activo/alta/reemplazo, historial
  de reemplazos, advertencia — nunca bloqueo — si la categoría no tiene tarifa vigente configurada
  en el catálogo de 002).
- **T-009** — Cierre: checklist de `spec.md §8` y esta entrada.

**Desviación de entorno (igual que la sesión de 002, CLAUDE.md §8)**
Este contenedor sigue sin Docker funcional ni PostgREST. Verificación de esquema/RLS/funciones
contra PostgreSQL 16 nativo con el mismo shim de compatibilidad de la sesión anterior.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- **CA-3/CA-4** (T-003/T-004): correr los `curl` reales de `tasks.md` contra `wrangler dev` +
  Supabase local real — sin PostgREST en este contenedor no hay endpoint REST real detrás de
  `@supabase/supabase-js`, aunque `tsc`, `eslint` y `wrangler deploy --dry-run` están en verde.
- **CA-6** (T-008): flujo completo en navegador. Pasos exactos en `tasks.md` T-008.
- Repetir `supabase db reset` en un entorno con Docker para la verificación oficial completa de
  T-001 (incluye PostgREST/GoTrue).

### 2026-09-01 — Sesión 009: 002-catalogo-y-tarifas completa (T-001 a T-010)

**Hecho**
- **T-001** — Migración `20260901120000_catalogo-y-tarifas.sql`: enums `categoria_tarifaria`/
  `tipo_calculo`, tablas `servicios`/`tarifas` (DDL de `docs/esquema-propuesto.sql §6` + columna
  `updated_at` en `servicios`), `tarifa_vigente()` (`SECURITY DEFINER`) y `crear_tarifa_version()`
  nueva (`SECURITY INVOKER`, `SELECT FOR UPDATE`, cierra la tarifa vigente y crea la nueva en una
  sola transacción). RLS `FORCE` + políticas reutilizando `es_admin_de()`/`mis_clientes()`/
  `es_admin_plataforma()` de 001, sin funciones de seguridad nuevas. `servicios`/`tarifas` usan
  `ON DELETE RESTRICT` (no `CASCADE` como la referencia): un servicio con tarifas nunca se borra
  en cascada silenciosamente.
- **T-002** — Fixtures (`tests/fixtures/catalogo.sql`, valores explícitamente marcados como no
  reales — D-5 sigue pendiente) y test de aislamiento (`002_catalogo_aislamiento.sql`, 6 pasos)
  cubriendo CA-2 (incluida `crear_tarifa_version()` contra un `servicio_id` de otro acueducto) y
  CA-6 (una sola tarifa vigente tras cambios sucesivos). **El propio test encontró un bug real**
  en `crear_tarifa_version()` de T-001: dos cambios de precio el mismo día violaban
  `chk_vigencia` al cerrar una tarifa cuya `vigencia_desde` ya era hoy con `vigencia_hasta = hoy-1`.
  Corregido: si la tarifa anterior nació hoy mismo se elimina en vez de cerrarse (nunca estuvo
  vigente un día completo, y no puede tener facturas — esa tabla no existe todavía).
- **T-003** — `core/tarifas.ts`: `calcularSubtotalServicio()` (fórmula D-1, límite inclusivo,
  redondeo a la unidad una sola vez). 8 tests unitarios en verde (límite exacto, límite±1,
  consumo 0, `tipo_calculo = 'fijo'`, redondeo).
- **T-004/T-005** — Backend: `lib/catalogo.ts` (capa de acceso a datos) y las rutas
  `GET/POST /catalogo/servicios`, `PATCH /catalogo/servicios/:id` (rechaza explícitamente cambios
  a `codigo`/`tipo_calculo`), `GET/POST /catalogo/tarifas`, `GET /catalogo/matriz-tarifas`.
- **T-006 a T-008** — Frontend: `lib/api.ts` ampliado (mismo wrapper `peticion<T>()`, sin
  `@supabase/*`), panel `/app/catalogo` (lista, alta, activar/desactivar) y
  `/app/catalogo/[servicioId]` (historial de tarifas por categoría + alta de tarifa nueva, con
  nota explícita de que esto cierra la vigente y nunca la edita).
- **T-010** — Cierre: checklist de `spec.md §8` y esta entrada.

**Desviación de entorno señalada en cada tarea afectada (CLAUDE.md §8)**
Este contenedor no tiene Docker funcional (el daemon no arranca — restricción del sandbox), así
que no hay CLI de `supabase` ni forma de correr `supabase start`/`supabase db reset` ni
PostgREST. La verificación de esquema, RLS y funciones (T-001, T-002) se hizo contra PostgreSQL 16
nativo instalado en el contenedor, con un shim de compatibilidad (`auth.uid()` vía GUC, roles
`anon`/`authenticated`/`service_role`) que la propia migración de 001 ya documentaba como opción
self-hosted — real evidencia contra un motor Postgres real, pero no el stack completo de Supabase.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- **CA-3/CA-4** (T-004/T-005): correr los `curl` reales de `tasks.md` contra `wrangler dev` +
  Supabase local real — este contenedor no tiene PostgREST, así que no hay endpoint REST real
  detrás de `@supabase/supabase-js` para probar las rutas end-to-end, aunque `tsc`, `eslint` y
  `wrangler deploy --dry-run` están en verde.
- **CA-7** (T-009): flujo completo en navegador (`wrangler dev` + `next dev` simultáneos contra
  una base real). Pasos exactos en `tasks.md` T-009.
- Repetir `supabase db reset` en un entorno con Docker para la verificación oficial completa de
  T-001 (incluye PostgREST/GoTrue, que el shim de este contenedor no cubre).

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

- **T-011** — Login, middleware y `lib/api.ts` (CA-4, CA-5). `frontend/middleware.ts` protege
  `/app/*` verificando solo la presencia de la cookie `uc_sesion_admin` (D-2 del plan); la
  validación real queda para el server component. `grep -rn "@supabase" frontend/app/
  frontend/components/` y `grep -rn "SERVICE_ROLE" frontend/` → cero resultados en ambos.
- **T-012** — Onboarding y dashboard protegido. `frontend/app/app/dashboard/page.tsx` es un
  server component que reenvía la cookie a mano vía `next/headers` (un fetch de servidor no
  hereda cookies del navegador, a diferencia del wrapper cliente `lib/api.ts`). Redirige a
  `/onboarding` sin acueducto y a `/login` con sesión inválida.
- **Corrección — `frontend/app/page.tsx`** seguía con el placeholder de T-010 a pesar de que
  `plan.md §1.2` ya especificaba que debía redirigir a `/login`. Corregido: redirige a
  `/app/dashboard` si hay cookie de sesión, o a `/login` si no la hay.
- **T-013** — Workflow `.github/workflows/backup-diario.yml` (CA-10) según D-7: Session Pooler
  puerto 6543 (`SUPABASE_DB_URL`), `pg_dump --format=custom --no-owner` vía imagen
  `postgres:16-alpine`, subida con `wrangler r2 object put` (sin GitHub Action de terceros),
  retención de 30 días por regla *lifecycle* del bucket (sin purga manual en CI). Solo se
  verificó la sintaxis YAML — la ejecución real requiere secretos de GitHub que no existen en
  este entorno.
- **Segunda corrección de `docs/INFRAESTRUCTURA.md`/`CHANGELOG.md` en `main`:** al aplicar un
  patch posterior, `origin/main` volvió a mostrar señales de haberse reconciliado manualmente en
  algún punto de la sesión; se resincronizó la rama local contra `origin/main` en cada entrega de
  patch para evitar duplicar commits ya aplicados con hashes distintos.
- **Decisión de alcance (Mateo):** no se construye una página `/registro` en el frontend para
  esta feature. El registro del primer admin de cada acueducto se hace vía `curl` directo contra
  `POST /auth/registro` (Mateo da de alta manualmente); el flujo de navegador para CA-11 empieza
  en `/login` con un usuario ya registrado así. Queda anotada como mejora futura, no como tarea
  de 001-fundación.

**Pendiente (bloqueadores externos, no de código)**
- **CA-10** (backup real a R2): requiere que Mateo configure `SUPABASE_DB_URL`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` como secretos de GitHub y cree el bucket
  `undreocol-backups` con su regla *lifecycle*; luego disparar `workflow_dispatch` y verificar con
  `wrangler r2 object list undreocol-backups`.
- **CA-11** (flujo manual completo en navegador): requiere a Mateo — este contenedor no tiene el
  CLI de `supabase` instalado, así que no se puede levantar `wrangler dev` contra una base real.
  Pasos exactos documentados en `tasks.md` T-012 y T-015.
- Despliegue real de los 4 Workers de `backend/` (`wrangler deploy`, sin `--dry-run`) — requiere
  las credenciales de Cloudflare de Mateo.

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
