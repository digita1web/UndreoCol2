# CHANGELOG — UndreoCol

Formato: una entrada por sesión de trabajo. Lo más reciente arriba.

## [Sin publicar]

### 2026-09-04 — Sesión 020: fix de seguridad — xlsx migrado a SheetJS 0.20.3 (CDN oficial)

Cierre del pendiente de la Sesión 017 (Feature 012). `xlsx@0.18.5` — la única versión que el
registro de npm distribuye, con 2 vulnerabilidades altas sin parche allí
(GHSA-4r6h-8v6p-xvw6 Prototype Pollution y GHSA-5pgg-2g8v-p4x9 ReDoS) — se reemplaza por
**0.20.3**, la versión parcheada que SheetJS distribuye solo desde su CDN oficial
(`cdn.sheetjs.com`; el registro de npm está desactualizado por diseño, verificado contra
docs.sheetjs.com).

Ejecutado por Mateo en su bench (este contenedor no alcanza `cdn.sheetjs.com`, lista blanca de
red — ya evidenciado en la Sesión 017). Cambio de una línea en `frontend/package.json`
(`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`) + `npm install` con lockfile
regenerado. La API que usa `frontend/components/importacion-mapeo.tsx`
(`XLSX.read` / `XLSX.utils.sheet_to_json`) es estable entre 0.18.5 y 0.20.3 → **cero cambios de
código** más allá de la dependencia.

**Verificado en este repo (evidencia pegada, CLAUDE.md §4):**
```text
npm audit    → ya NO lista GHSA-4r6h-8v6p-xvw6 ni GHSA-5pgg-2g8v-p4x9
npm run lint → LINT_EXIT=0
npm run build→ BUILD_EXIT=0 (Next 15.5.25 · 15/15 páginas · /app/suscriptores/importar 124 kB)
git diff     → solo frontend/package.json (1 línea) y frontend/package-lock.json
```

**Hallazgo NUEVO y SEPARADO tras el fix — `postcss` (dependencia transitiva de `next`), NO
relacionado con la Feature 012. Pendiente de severidad a evaluar en una sesión futura dedicada
a actualizar Next.js con cuidado; no se toca en esta sesión (commit aparte a propósito).**

El mismo `npm audit` que confirma el fix de xlsx reporta **2 vulnerabilidades (1 moderate + 1
high)** en `postcss`, la copia ANIDADA que fija `next@15.5.25`
(`node_modules/next/node_modules/postcss@8.4.31`). El `postcss@8.5.26` del root
(autoprefixer/tailwind) NO cubre esa copia anidada, por eso `next` figura como dependencia
vulnerable:
- `GHSA-qx2v-qp2m-jg93` (XSS por `</style>` sin escapar en el stringify de CSS) — moderate
- `GHSA-6g55-p6wh-862q` (lectura de archivos / divulgación vía `sourceMappingURL`) — high
- `GHSA-fxqj-rqcc-2cmp` (fix incompleto del anterior cuando `from` no está definido) — moderate
- `GHSA-r28c-9q8g-f849` (path traversal → divulgación de archivos `.map`) — high

`npm audit fix --force` la resolvería instalando `next@16.3.4` (cambio de versión mayor,
breaking) — **NO se ejecutó**, está fuera del alcance de esta tarea. Contexto para la sesión
futura: la copia afectada la usa Next para procesar CSS del propio proyecto en build-time (no
procesa CSS de usuarios finales), así que el impacto práctico en runtime se evalúa allí — no se
asume cero ni se descarta.

### 2026-09-04 — Sesión 019: Semgrep automatizado + plan de auditoría final por LLM

Dos entregables: (1) implementación real de Semgrep en CI, (2) documentación del plan de auditoría
de seguridad pre-producción. Incluye además la corrección de un error de la Sesión 018 (ver nota
en esa entrada, abajo).

**T-1 — `.github/workflows/semgrep.yml` (implementación real)**
Corre en cada `push` y `pull_request` a cualquier rama (sin filtro `branches`). Dos pasos:
1. Reporte completo con `p/security-audit` + `p/typescript` + `p/react` + `p/secrets`, todas las
   severidades, subido a GitHub Code Scanning vía SARIF (`github/codeql-action/upload-sarif@v3`) —
   no bloqueante (`continue-on-error: true`).
2. Gate real: el mismo ruleset filtrado a `--severity ERROR` con `--error`, sin
   `continue-on-error` — falla el job (y por lo tanto el check de CI) si hay al menos un hallazgo
   de severidad ERROR.

Ruleset elegido tras investigar: Semgrep no publica un pack específico de Cloudflare Workers;
`p/security-audit` (el pedido explícitamente) combinado con `p/typescript` (todo el proyecto),
`p/react` (frontend/, Next.js usa React — no hay pack "Next.js" propio) y `p/secrets` (relevante
por CLAUDE.md §12, que prohíbe absolutamente commitear claves/tokens) es la combinación más
apropiada para este stack.

**Verificado de verdad, no asumido:** este contenedor no puede alcanzar `semgrep.dev` (proxy de
red restringido). Se instaló Semgrep 1.176.0 en un venv aislado y se clonó
`github.com/semgrep/semgrep-rules` (la fuente abierta de la que salen los packs del registro) para
correr el equivalente exacto de `p/typescript` + `p/react` + `p/security-audit` (subconjunto
javascript/lang/security) + `p/secrets` contra el código real de `backend/src/` y `frontend/`:
**2 hallazgos reales, ambos severidad WARNING, 0 ERROR** — `backend/src/index.ts:204` (regex de
slug con posible ReDoS) y `backend/src/queues/cierre-facturacion.ts:298` (HTML sin escapar en un
template string del correo de factura, XSS potencial si `acueducto.nombre` contuviera markup).
Ninguno de los dos bloquea el workflow (ninguno es ERROR) — quedan como hallazgos visibles en
Code Scanning para revisión, no forzados a corregirse en esta sesión (fuera de alcance: la tarea
pedida era activar Semgrep, no corregir hallazgos).

**Hallazgo real sobre el propio Semgrep, verificado con un caso construido a propósito:** el CLI
open-source de Semgrep (`semgrep scan`, sin conexión a Semgrp Cloud Platform) **sale con código 0
sin importar cuántos hallazgos tenga**, incluso con un hallazgo ERROR real forzado deliberadamente
(`child_process.exec` con input de función, un caso clásico de inyección de comandos) — la
etiqueta "❰❰ Blocking ❱❱" que se ve en pantalla es solo visual, no afecta el exit code. Hace falta
el flag `--error` (exit 1 si hay hallazgos) combinado con `--severity ERROR` (para que solo cuenten
los ERROR) — verificado con el mismo caso construido: exit 1 con el hallazgo ERROR presente, exit
0 cuando el único hallazgo real del proyecto era WARNING. Sin este detalle, el workflow habría
"funcionado" (reportado) pero nunca habría bloqueado nada — exactamente el tipo de "debería
funcionar" que CLAUDE.md §4 prohíbe aceptar sin evidencia real.

**NO VERIFICADO — requiere acción de Mateo:** un archivo de workflow en rojo no bloquea un merge
por sí solo. GitHub solo lo hace si la rama tiene "Require status checks to pass before merging"
activado (Settings → Branches) con el check `semgrep` seleccionado — es una configuración del
repositorio que Mateo tiene que activar una vez, no algo que este workflow pueda activar por sí
mismo. Documentado explícitamente en el propio archivo del workflow.

**T-2 — `docs/PLAN-PRODUCCION.md` (nuevo)**
Sección "Auditoría de seguridad pre-producción" con el texto exacto que dio Mateo: auditoría única
por LLM de mayor capacidad de razonamiento disponible (Claude Opus o DeepSeek Reasoner/Pro), al
completar el roadmap 001-014, revisando RLS/SECURITY DEFINER/sesiones/rate limiting/hallazgos
pendientes de Semgrep — complementa, no reemplaza, la verificación feature por feature ya hecha.

### 2026-09-04 — Sesión 018: planificación de costos e infraestructura (documentación, sin código)

> **Corrección posterior (Sesión 019, mismo día):** el punto 2 de abajo describía el backup
> automático como "PENDIENTE DE IMPLEMENTACIÓN" sin haber verificado primero si ya existía en el
> repositorio. Era incorrecto — `.github/workflows/backup-diario.yml` ya estaba implementado
> desde el 2026-09-01 (feature 001, commit `87afd9e`). Corregido en la Sesión 019, ver abajo.

Sesión de solo documentación (Mateo lo pidió explícito: "Solo documentación, no implementación de
código todavía"). Registra las decisiones de una sesión de investigación de costos, en
`docs/INFRAESTRUCTURA-Y-COSTOS.md` (documento nuevo).

**Decisiones documentadas**
1. **Supabase Free alcanza para el primer cliente** (500-600 suscriptores, muy por debajo de los
   límites de 500 MB de DB / 50.000 MAU de Auth — este último ni aplica de fondo porque el
   suscriptor no es un usuario de `auth.users`, D-2). El riesgo de pausa por inactividad a 7 días
   ya estaba resuelto (`keepalive.ts`, `docs/INFRAESTRUCTURA.md §5`) — se verificó en esta sesión
   que la configuración del cron (`wrangler.keepalive.toml`) y el empaquetado del Worker
   (`wrangler deploy --dry-run`) siguen intactos, sin tocar código.
2. **Backups automáticos sin costo vía GitHub Actions** (`supabase db dump` + `SUPABASE_DB_URL`
   como secret + subida a repo privado o Cloudflare R2 Free + retención de 30 días), reemplazando
   la idea de backup manual. **Prioridad ALTA, pendiente de implementación.** Se detectó y reportó
   una contradicción con el diseño ya aprobado como decisión D-7 (`docs/INFRAESTRUCTURA.md §6`,
   que usa `pg_dump` en contenedor + R2 exclusivamente + nombre de workflow distinto) — ambos
   diseños resuelven el mismo problema con mecanismos distintos; hay que reconciliarlos antes de
   implementar, no se implementó ninguno de los dos en esta sesión.
3. **Cloudflare Workers Free confirmado suficiente**, sin cambios sobre lo ya proyectado en
   `ARQUITECTURA.md §6`.
4. **Cambio de decisión de correo:** Resend (3.000/mes, 100/día, gratis) en vez de Cloudflare
   Email Service — evita que el flujo de correo (D-8, secundario) dependa de que Workers Paid ya
   esté activo, como asume hoy `ARQUITECTURA.md §6`. **Prioridad MEDIA**, amplía la Feature 006 ya
   cerrada (`backend/src/lib/email.ts`); requiere además actualizar D-8 en `docs/DECISIONES.md`
   cuando se implemente, para no dejar el registro de decisiones contradiciendo el código.
5. **Monitoreo de errores con Sentry** (5.000 errores/mes gratis, backend + frontend). **Prioridad
   MEDIA** — confirma una intención que ya existía en `docs/ESTRATEGIA-CALIDAD.md` y
   `docs/INFRAESTRUCTURA.md §2` pero sin implementar ni límites documentados hasta ahora.
6. **Costo total del primer cliente: USD $0/mes**, con backups 100% automáticos (sin
   intervención manual periódica, salvo el ritual mensual de verificación de restauración que
   `docs/INFRAESTRUCTURA.md §7.3` ya definía como deliberadamente manual).

**Pendientes técnicos abiertos** (tabla completa en `docs/INFRAESTRUCTURA-Y-COSTOS.md §7`):
backup automático (ALTA), migración de correo a Resend (MEDIA), instrumentación de Sentry
(MEDIA). Ninguno tiene `spec.md` todavía — no se escribe código sin pasar por `/specify`
(CLAUDE.md §3).

### 2026-09-04 — Sesión 017: 012-importacion-suscriptores-excel completa (T-002 a T-009)

Continuación desde el checkpoint pendiente (T-001, parser/validador puro, ya estaba completo e
implementado con autorización explícita de Mateo antes de este checkpoint). Esta sesión hizo las
fases que tocan Supabase real: migración, duplicados contra la base, rutas HTTP, frontend.

**Hecho**
- **T-002** — Migración `20260912090000_importacion-suscriptores.sql`: tabla
  `importaciones_suscriptores` (historial, `errores jsonb` solo `{fila, motivo}`, nunca el
  contenido de la fila) + `importar_suscriptores()` (`SECURITY INVOKER`, sin `SELECT FOR UPDATE`
  — cada suscriptor nuevo es una fila independiente sin contención — `INSERT` en lote vía
  `jsonb_to_recordset`, atómico por ser una sola función `plpgsql`). RLS `FORCE` + políticas
  estándar. Probado funcionalmente contra Postgres real: inserción de lote válido con conteos
  correctos, y atomicidad real (CA-6) forzando una violación del constraint único
  `(cliente_id, codigo_suscriptor)` — el lote completo se revierte, cero suscriptores nuevos.
- **T-003** — Fixture no-op (mismo criterio que 009: los lotes de prueba se arman inline con jsonb
  dentro de cada transacción) + test de aislamiento (6 pasos): cross-tenant en `importar_suscriptores()`
  y en el historial, rol `lector` rechazado, atomicidad del lote re-verificada en la suite formal.
  Regresión completa: se reconstruyó `undreocol_test` desde cero (shim + 11 migraciones + 10
  fixtures en orden de dependencia real + 10 suites de aislamiento 001-009/012) en una sola pasada
  limpia — las 10 en verde, confirmando que el fallo de `008_portal_aislamiento.sql` visto en una
  corrida anterior (mismo hallazgo que en el cierre de la Sesión 016) era estado acumulado de la
  base de datos de larga duración, no una regresión de 012.
- **T-004** — `lib/importacion-suscriptores.ts`: `detectarDuplicadosContraBase()` (CA-3 —
  `numero_documento` no tiene constraint único en la base, es la única barrera real para ese caso,
  verificado explícitamente con el caso "solo `numero_documento` coincide"), `categoriasSinTarifa()`
  (advertencia informativa no bloqueante, mismo patrón que `lib/facturacion.ts`) y
  `confirmarImportacion()` (RPC `importar_suscriptores()`).
- **T-005** — Rutas `POST /suscriptores/importar/validar` y `POST /suscriptores/importar/confirmar`,
  con un límite explícito de 2000 filas por archivo (CLAUDE.md §5.5) rechazado antes de procesar.
- **T-006** — `lib/api.ts` ampliado: `validarImportacion()`/`confirmarImportacion()`.
- **T-007** — Panel `/app/suscriptores/importar`: carga de `.xlsx`/`.csv` parseado en el navegador
  con `xlsx`/SheetJS (nunca llega el archivo crudo al Worker), mapeo de columnas configurable
  (ningún nombre de columna asumido en el código, spec §3.1), resumen de errores, confirmación que
  solo importa las filas válidas, reporte final con la advertencia de categorías sin tarifa.
- **T-009** — Cierre: checklist de `spec.md §8` y esta entrada.

**Hallazgo de seguridad en una dependencia nueva (se reporta explícito, CLAUDE.md §8)**
`xlsx@0.18.5`, la única versión instalable desde el registro de npm en este contenedor, tiene 2
vulnerabilidades altas confirmadas por `npm audit` **sin parche disponible en npm**: Prototype
Pollution (`GHSA-4r6h-8v6p-xvw6`) y ReDoS (`GHSA-5pgg-2g8v-p4x9`). SheetJS solo distribuye
versiones parcheadas desde su propio CDN (`cdn.sheetjs.com`), bloqueado por la lista blanca de red
de este contenedor — se intentó instalar y falló con `CONNECT 403`. El parseo ocurre enteramente
en el navegador del admin sobre un archivo que él mismo elige subir (no toca el Worker ni la base
de otros acueductos), pero es una dependencia nueva con CVEs reales sin parchear. **Acción
pendiente de Mateo antes de producción:** desde su bench con acceso normal a internet, cambiar
`"xlsx": "^0.18.5"` en `frontend/package.json` por la URL del tarball parcheado de SheetJS y correr
`npm install` de nuevo (un cambio de una línea, la API usada es estable entre versiones) — pasos
exactos en `specs/012-importacion-suscriptores-excel/tasks.md` T-007.

**Brecha de alcance detectada (se reporta, no se oculta)**
`tasks.md` T-008 menciona "ver el historial de importaciones" como parte del flujo E2E, pero
`plan.md` §3 (aprobado) solo definió las rutas `validar`/`confirmar` — nunca se planeó una ruta ni
pantalla para LISTAR `importaciones_suscriptores`. No se improvisó esa ruta fuera de plan (CLAUDE.md
§3). Si Mateo quiere verlo desde el panel, es una tarea adicional a definir explícitamente.

**Desviación de entorno (igual que 002/003/009, CLAUDE.md §8)**
Sin Docker en este contenedor. Verificación de esquema/RLS/RPC contra PostgreSQL 16 nativo con el
shim de compatibilidad ya usado en sesiones previas.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- CA-3/CA-5 con `curl` real contra `wrangler dev` + PostgREST real (sin Docker en este contenedor,
  la lib de duplicados se verificó a nivel de la consulta SQL equivalente, no vía `supabase-js`).
- CA-7: flujo completo en navegador con un archivo de prueba real. Pasos exactos en `tasks.md`
  T-008.
- Cambiar la fuente de instalación de `xlsx` a la versión parcheada de SheetJS antes de producción
  (ver hallazgo de seguridad arriba).

### 2026-09-04 — Sesión 016: 009-cortes-y-reconexiones completa (T-001 a T-007)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/009-cortes-y-reconexiones/`): alcance reducido (opción a)
  aprobado explícitamente por Mateo — el corte y la reconexión son acciones de `admin_acueducto`
  desde el panel, con confirmación humana siempre explícita (nunca corte desatendido). La "orden de
  corte ejecutada por el lector desde su celular" que describe
  `docs/ESPECIFICACION-FUNCIONAL.md §2.11` (opción b) queda documentada como feature futura — el
  volumen actual del acueducto piloto no la justifica todavía.
- **T-001** — Migración `20260911090000_cortes-reconexiones.sql`: tabla `cortes_reconexiones`
  (`motivo`/`responsable` `NOT NULL` a nivel de esquema), `registrar_corte()` y `reconectar()`
  (`SECURITY INVOKER`, `SELECT FOR UPDATE`, mismo patrón que `anular_pago()` de 007).
  `reconectar()` reutiliza `siguiente_numero_factura()` (005) sin modificarla e inserta la factura
  de reconexión con un renglón en `factura_detalles` (`servicio_id`/`tarifa_id` `NULL`), dejando que
  el trigger de 005 calcule el total.
- **T-002** — Fixture no-op documentado (agregar una factura vencida al fixture compartido rompería
  el conteo de filas que 005/007 ya asumen) + test de aislamiento (7 pasos): cross-tenant, rol
  lector, rechazo de doble corte, rechazo de reconexión sobre activo, bloqueo de reconexión con
  deuda vencida sin motivo de excepción, factura de reconexión con monto/tipo/prefijo/periodo_id
  correctos. Regresión CA-3 confirmada por `grep`: el filtro `estado = 'activo'` de
  `facturacion.ts`/`cierre-facturacion.ts` sigue intacto.
- **T-003** — `lib/cortes.ts` (candidatos por umbral reutilizando `obtenerCartera()` de 007, RPCs
  de corte/reconexión, historial) + 4 rutas Hono.
- **T-004/T-005** — `lib/api.ts` ampliado + panel `/app/cortes` (candidatos, nunca ejecuta nada por
  sí solo) + tarjetas de corte/reconexión e historial en el detalle del suscriptor.
  `ReconexionForm` consulta la deuda vencida antes de intentar reconectar, para pedir el motivo de
  excepción en el propio formulario.
- **T-007** — Cierre: checklist de `spec.md §8` y esta entrada.

**Desviación de entorno (igual que 002/003, CLAUDE.md §8)**
Este contenedor no tiene Docker funcional. Verificación de esquema/RLS/funciones contra
PostgreSQL 16 nativo con el shim de compatibilidad ya usado en sesiones previas (el trabajo de
004-008 sí se hizo con Supabase local real en Docker, según su propio `tasks.md` — este contenedor
específico no lo tiene disponible).

**Hallazgo durante el cierre:** la primera corrida de la regresión completa 001-009 mostró
`008_portal_aislamiento.sql` fallando en su PASO 3 ("A1 bloqueado devolvió ok"). Investigado antes
de reportarlo: no era una regresión de 009 — era estado acumulado de correr los tests de
aislamiento repetidamente sobre la misma base a lo largo de la sesión (el fixture de intentos de
login no es idempotente para corridas repetidas sin reset). Reconstruida la base desde cero
(`drop`/`create database`, 10 migraciones, 9 fixtures) y corridos los 9 tests de aislamiento en una
sola pasada limpia: los 9 en verde, incluido 008.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- CA-3/CA-4 de tasks.md (T-003): `curl` real contra `wrangler dev` — sin PostgREST en este
  contenedor no hay endpoint REST real detrás de `@supabase/supabase-js`.
- CA-7 (T-006): flujo completo en navegador. Pasos exactos en `tasks.md` T-006.
- Repetir `supabase db reset` en un entorno con Docker para la verificación oficial completa de
  T-001/T-002 (incluye PostgREST/GoTrue, que el shim de este contenedor no cubre).

### 2026-09-03 — Sesión 015: 008-portal-suscriptor completa (T-001 a T-007)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/008-portal-suscriptor/`): CA-1 a CA-10 y **D-10** nueva en
  `docs/DECISIONES.md` (el aislamiento del portal se hace con funciones `SECURITY DEFINER` acotadas
  invocadas con la clave `anon`; `SUPABASE_SERVICE_ROLE_KEY` nunca se usa en rutas del portal —
  CLAUDE.md §12 sin excepción).
- **T-001** — Migración `20260908090000_portal-suscriptor.sql`: columnas de `configuracion`
  (`portal_umbral_intentos_login` 8 / `portal_bloqueo_minutos` 15), tabla `portal_intentos_login`
  (fuerza bruta por `(cliente_id, numero_documento)`; RLS FORCE con única política de lectura para
  la plataforma; la escriben solo las funciones security definer) y las 5 funciones del portal
  (`portal_validar_credenciales`, `portal_facturas_suscriptor`, `portal_factura_completa`,
  `portal_saldo_favor_suscriptor`, `portal_consumo_suscriptor`) — cada una revalida
  `numero_documento`+`codigo_suscriptor` dentro del `cliente_id` recibido. Smoke con rol `anon`:
  login ok/invalido/bloqueado tras 8 fallos/inactivo (sin contar como intento fallido) y datos sin
  fixtures → vacíos.
- **T-002** — Fixture `portal.sql` (dos filas de `portal_intentos_login`: A1 bloqueo vigente, A2
  bloqueo vencido) + aislamiento `008_portal_aislamiento.sql` (CA-2/CA-9). Regla aprendida en 005/007
  aplicada: el fixture NO agrega contadores/lecturas de A1 (romperían los conteos de los aislamientos
  003/004) — el histórico de dos contadores de CA-7 se crea en el aislamiento con ROLLBACK
  (cerrando temporalmente el periodo actual para respetar `uq_periodo_abierto`). `PORTAL-AISLAMIENTO
  OK` + regresión 001-007 en verde.
- **T-003** — `sesion-suscriptor.ts` implementado (JWT propio HS256 con `hono/jwt`, cookie
  `uc_sesion_suscriptor` HttpOnly+Secure+SameSite=Lax, 30 días, renovación < 7 días; `SesionSuscriptor`
  lleva `numeroDocumento`+`codigoSuscriptor` por D-10). 10 unit tests; `npm test` 90 en verde.
  Nota: hono 4 exporta `sign`/`verify` desde `hono/jwt` (no `hono/utils/jwt`). `SESSION_SECRET` en
  `.dev.vars` (gitignored).
- **T-004** — `lib/portal.ts` (todas las llamadas con `crearClienteAnon`, D-10) + rutas
  `POST /portal/:slug/login` (401 genérico / 403 inactivo / 429 bloqueado), `POST /portal/logout`,
  `GET /portal/facturas`, `GET /portal/facturas/:id/pdf` (404 si no es del suscriptor — **IDOR
  bloqueado**), `GET /portal/saldo-favor`, `GET /portal/consumo`. **Desviación de implementación
  documentada**: el login resuelve el slug con la función `SECURITY DEFINER`
  `portal_cliente_por_slug` (migración nueva `20260909090000_portal-slug.sql`) porque `anon` no puede
  leer `clientes` (RLS). **Ataques IDOR verificados con curl** (sesiones reales de A1/A2/B1): PDF de
  factura ajena y de otro acueducto → 404 sin bytes; listados aislados; fuerza bruta → 429; logout →
  401.
- **T-005** — Regenerar código (CA-8): `POST /suscriptores/:id/regenerar-codigo` (admin → 200,
  lector → 403 por membresía + RLS, código duplicado → 409). Login con el código viejo → 401; con el
  nuevo → 200. Hallazgo con evidencia: por D-10, una sesión previa no recibe 401 pero deja de ver
  datos (las funciones revalidan el código) — la regeneración invalida de facto la sesión anterior.
- **T-006** — Frontend del portal (CA-10): `middleware.ts` separa por área con cookies DISTINTAS
  (`uc_sesion_admin` para `/app/*`, `uc_sesion_suscriptor` para `/portal/:slug/*` salvo el login);
  páginas `/portal/[slug]/login` y `/portal/[slug]`; botón de regenerar código en el detalle del
  suscriptor. `next build` 12 páginas OK. **Separación de sesiones verificada con curl**: un admin
  con su cookie NO ve el portal (307 al login del portal) y un suscriptor NO ve el panel `/app`
  (307 a `/login`); con ambas cookies cada área responde con la suya.
- **T-007** — Cierre: checklist `spec.md §8`, CHANGELOG y regresión completa desde cero
  (`supabase db reset --local`, 9 migraciones, fixtures 001-008, aislamientos 001-008 en verde).

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- CA-10: flujo click-a-click en navegador (`next dev` + `wrangler dev`) con los pasos exactos
  documentados en tasks.md T-006 (la API y la separación de sesiones ya quedaron verificadas con curl).

### 2026-09-03 — Sesión 014: 007-pagos-y-cartera completa (T-001 a T-006)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/007-pagos-y-cartera/`): CA-1 a CA-8, RPCs atómicas con
  remanente y reversión recalculada, sin colas (cada pago es una transacción por request).
- **T-001** — Migración `20260907090000_pagos.sql`: enum `metodo_pago`, tablas `pagos` y
  `pago_aplicaciones` (checks de integridad: valor > 0, suma de aplicaciones ≤ valor del pago, nunca
  se abona más del saldo vivo de una factura, no se aplica a facturas anuladas ni de otro
  suscriptor) + trigger `trg_pago_aplicacion_valida` + RLS `FORCE` + RPCs `SECURITY INVOKER`
  `registrar_pago`/`anular_pago` (`SELECT FOR UPDATE`, distribución más antigua primero, remanente,
  reversión recalculada desde los pagos vigentes). Desviación documentada: la distribución de la
  aplicación la calcula `core/pagos.ts` (CLAUDE §5.3) y se pasa a la RPC como jsonb ya calculado, en
  vez de distribuirse en SQL.
- **T-002** — Fixtures `pagos.sql` (abono parcial de 10.000 + pago a favor de 2.000 sobre la factura
  de 005, sin crear facturas nuevas) y test de aislamiento 007 (RLS + RPCs rechazando al `lector`,
  facturas de otro cliente, facturas anuladas y anulación sin motivo) con regresión 001-006 en verde.
- **T-003** — `core/pagos.ts`: `redondearPeso` (regla única del peso), `distribuirPago` (más antigua
  primero, remanente) y `calcularEstadoTrasPago`. 15 unit tests (`npm test` 80 en verde).
- **T-004** — `lib/pagos.ts` + rutas Hono (`POST /pagos`, `POST /pagos/:id/anular`, `GET /cartera`,
  `GET /facturas/:id/pagos`, `GET /suscriptores/:id/pagos`). Verificado con curl real contra
  `wrangler dev` + Supabase local: pago total/parcial, remanente a favor, anulación con reversión
  recalculada (no resetea a cero: recalcula desde el pago vigente restante), cartera con `vencida`
  derivada por fecha e historiales por factura y por suscriptor.
- **T-005** — Frontend: `api.ts` ampliado + páginas `/app/pagos` (cartera con registrar pago) y
  `/app/pagos/[suscriptorId]` (historial); detalle de factura con bloque de pagos aplicados,
  registrar pago y anular pago con motivo. `build`/`lint`/`tsc` limpios.
- **T-006** — Cierre: `supabase db reset --local` + fixtures 001-007 de cero + los 7 tests de
  aislamiento en verde, checklist de `spec.md §8` + esta entrada.

**Hallazgo real corregido durante la verificación (CA-4)**
`obtenerCartera` (`lib/pagos.ts`) excluía por completo del reporte a cualquier suscriptor sin
facturas con saldo vivo, **aunque tuviera saldo a favor** — un sobrepago dejaba un remanente que no
aparecía en ningún lado de `/cartera`, contradiciendo el texto exacto de CA-4 ("aparece en la cartera
como saldo a favor") y la spec §3.5. Corregido: la fila se incluye si hay deuda viva **o** saldo a
favor > 0; `solo_morosos` sigue exigiendo deuda vencida.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- CA-8: flujo click-a-click en navegador real (registrar pago, ver el sobrante, anular con motivo).
  Este entorno no tiene Chromium/Playwright; se verificó que las 3 rutas nuevas/editadas renderizan
  sin error por SSR con la cookie de sesión real, pero no la interacción de cliente. Pasos exactos en
  `specs/007-pagos-y-cartera/tasks.md` T-005.

### 2026-09-06 — Sesión 013: 006-impresion-y-correo-factura completa (T-001 a T-006)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/006-impresion-y-correo-factura/`).
- **T-001** — Migración `20260906090000_correo-factura.sql`: tabla `notificaciones` con trazabilidad
  del envío (`intentos`, `ultimo_error`, `enviada_en`) + RLS aislada (admin/lector del cliente).
  Fixtures `correo-factura.sql` (email a A1 + notificación enviada) y test de aislamiento 006
  (es_admin_de en notificaciones). 6 tests de aislamiento en verde sobre el mismo estado final.
  Decisión de arquitectura: **no se crea cola nueva** — se amplía el mensaje de la cola
  `undreocol-facturacion` (005) con `tipo: 'emitir_factura' | 'enviar_correo_factura'`.
- **T-002** — `pdf-lib` ^1.17.1 + `src/lib/factura-pdf.ts` (genera el PDF de la factura con renglones,
  datos del acueducto y totales; logo opcional). Se respetó D-9: **sin pdfme ni Chromium** (el chat
  inicial los pidió, pero contradicen la especificación aprobada). 4 unit tests → `npm test` 59 en
  verde (el test decodifica los streams hex de pdf-lib para verificar el contenido del PDF).
- **T-003** — `src/lib/email.ts` (`env.EMAIL.send` con adjunto en `ArrayBuffer`; sin `env.EMAIL`
  devuelve `{ok:false}` sin lanzar, regla 20) + bindings `EMAIL`/`FACTURAS_R2` + consumidor ampliado
  (enruta por `tipo`; para el correo: genera PDF → sube a R2 → envía → actualiza notificaciones con
  `intentos+1`/`ultimo_error`) + rutas `POST /facturas/:id/enviar-correo` y
  `POST /facturacion/periodos/:id/enviar-correo` (202, uno por factura con email; sin email se
  entregan impresas, D-8). **Round-trip local REAL verificado** (202 → log del consumidor → fila en
  notificaciones actualizada). La decisión de estado (pendiente/fallida + `ultimo_error`) se extrajo
  a `computarActualizacionNotificacion()` y quedó cubierta por unit tests (fallo trazable con
  `intentos+1` y error; fallida tras 3 reintentos). `npm test` 65 en verde.
- **T-004** — `GET /facturas/:id/pdf`: lee R2 (`facturas/{clienteId}/{facturaId}.pdf`) o genera y
  sube, actualiza `facturas.pdf_url`, responde `200 application/pdf` (inline). **Hallazgo real
  corregido**: `trg_factura_inmutable` (005) bloqueaba el UPDATE de `pdf_url` → se reescribió la
  función para permitir el cambio exclusivo de `pdf_url`/`total_pagado`/`estado` (metadata de 006 y
  avances de 007) manteniendo el bloqueo de valores económicos y el recálculo del cierre (round-trip
  REAL del cierre re-verificado: factura con total 38.600). Se descartó `pg_trigger_depth()` (dentro
  del propio trigger siempre es ≥ 1) y se documentó que las GUCs locales no se propagan entre roles.
- **T-005** — Frontend: `api.ts` (`enviarCorreoFactura`, `enviarCorreoPeriodo`, `urlPdfFactura`);
  detalle de factura con botones **Ver PDF** / **Imprimir** (`window.print`) / **Enviar por correo**;
  listado del periodo con **Enviar correos del periodo**; `@media print` (la impresión deja solo la
  factura, sin acciones). `next build` 12/12 sin errores.
- **T-006** — Cierre: checklist de `spec.md §8` + esta entrada de CHANGELOG.

**Hallazgo de entorno (send_email en local)**
En `wrangler dev` el binding `[[send_email]]` se materializa como **mock de miniflare** que "envía"
con éxito (la fila queda `enviada`). Por eso el caso de fallo (que exige trazar `intentos`/
`ultimo_error`) no se puede reproducir por la API en local; quedó verificado con unit tests de
`computarActualizacionNotificacion()` y de `email.ts`. Además Node 20 sin WebSocket no puede
instanciar supabase-js (realtime) fuera de workerd, así que la verificación end-to-end de las rutas
es vía curl contra wrangler dev.

**Pendiente (NO VERIFICADO — requiere la cuenta de Cloudflare de Mateo)**
- Envío real de correo: Workers Paid + dominio verificado (`EMAIL` se ignora/falla en local).
- R2 real: bucket `undreocol-facturas` en producción (en local el PDF se genera/sirve y `pdf_url` se
  persiste, pero la simulación de R2 no persiste entre arranques sin `--persist-to`).
- CA-6: flujo click-a-click en navegador (`next dev` + `wrangler dev`).

### 2026-09-05 — Sesión 012: 005-facturacion completa (T-001 a T-007)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/005-facturacion/`): commit `b5d3e50`, `f08ae42`, `58a1a91`.
- **T-001** — Migración `20260905090000_facturacion.sql`: enums `tipo_factura`/`estado_factura`,
  tablas `facturas` (unique `(cliente_id, numero)`, `uq_factura_ciclo`, `chk_total_pagado <= total`),
  `factura_detalles` (referencia permanente `tarifa_id`/`servicio_id`) y `factura_lecturas`; RLS
  `FORCE`. **Dos hallazgos reales corregidos**: (1) el trigger inicial bloqueaba el INSERT de un
  periodo cerrado, lo que habría impedido la emisión del cierre (004 cierra el periodo y 005 factura
  sobre él) → se reemplazó por `trg_factura_inmutable` (INSERT permitido; UPDATE solo anulación con
  motivo o `total_pagado` de 007; DELETE bloqueado; recálculo interno de `total` = suma de detalles
  permitido vía GUC `app.recalculo_interno`). (2) el recálculo de `factura_detalles` chocaba con el
  trigger de inmutabilidad → se marcó la transacción con GUC.
- **T-002** — Fixtures `facturacion.sql` + `005_facturacion_aislamiento.sql` (8 pasos). **Hallazgo de
  regresión**: el fixture cerraba el periodo A y rompía el test de 004 (que asume el periodo A
  abierto); corregido: los fixtures de features posteriores no mutan el estado que los tests previos
  asumen. 5 tests de aislamiento (001-005) en verde sobre el mismo estado final.
- **T-003** — `core/facturacion.ts` (lógica pura, reusa `core/tarifas.ts` D-1): `armarRenglones`,
  `calcularRecargoMora`, `componerTotal`, `componerNumeroFactura` (D-3), `clasificarAnomaliasFacturacion`.
  19 unit tests → `npm test` 55 en verde.
- **T-004** — `lib/facturacion.ts` (capa fina) + rutas `POST /facturacion/periodos/:id/simular`,
  `GET /facturacion/periodos/:id/facturas`, `GET /facturas/:id`, `POST /facturas/:id/anular`.
  **Simulación real verificada con curl** (wrangler dev + Supabase local): resumen con
  facturación total 38.600 (D-1 básico/no básico) y anomalías de A2 (sin tarifa 9d, sin lectura);
  no insertó nada. Anulación real verificada (sin motivo → 400, con motivo → 200).
  Corrección de alcance: no se implementó `GET /facturacion/simulaciones/:periodoId` — la simulación
  no persiste (spec §3.3); el gate de la emisión es de UI + defensa en backend.
- **T-005** — Consumidor `src/queues/cierre-facturacion.ts` + ruta `POST .../emitir` + binding
  `FACTURACION_COLA` (producer+consumer en el mismo worker). **Round-trip local REAL de Cloudflare
  Queues verificado**: `POST /emitir` → 202 (1 encolada), log del consumidor "factura FAC-2026-00001
  emitida", factura con total 38.600 + 1 detalle, consecutivo atómico en 1, re-emisión → 409.
  Corrección de arquitectura: se usó un solo worker (fetch+queue) en vez del
  `wrangler.facturacion.toml` separado. Se añadió la RPC `siguiente_numero_factura()` (SELECT FOR
  UPDATE, puntos 9b/9c).
- **T-006** — Frontend: `api.ts` ampliado + paneles `/app/facturacion` (simular → resumen/anomalías →
  confirmar emisión → listado) y `/app/facturacion/[facturaId]` (datos + desglose + anular).
  `npm run build` 12/12 y lint en verde.
- **T-007** — Cierre: checklist de `spec.md §8`, CHANGELOG y los 5 tests de aislamiento re-corridos.

**Hallazgo de entorno (importante para toda esta sesión)**
`http_proxy`/`https_proxy` están seteados sin `NO_PROXY`, así que las llamadas a `127.0.0.1` pasaban
por el proxy y devolvían **502** (a Supabase local y a Kong). Solución: `curl --noproxy '*'` y
`wrangler dev` lanzado con `env -u http_proxy ...`. También se detectó que tras `supabase db reset`
Kong podía quedar sin inicializar: `supabase stop && supabase start` lo resolvió.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- Despliegue real a Cloudflare: crear la cola `undreocol-facturacion` en la cuenta, conectar
  producer/consumer y correr el cierre con cron real en la nube (el round-trip local ya está
  verificado).
- CA-6: flujo click-a-click en navegador (`next dev` + `wrangler dev`) — la API de simulación/emisión/
  anulación ya fue verificada por curl y el build/lint confirman el render.

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
Ninguno tras la re-validación posterior: **CA-4** y **CA-6** se re-validaron contra `wrangler dev` +
`next dev` + Supabase local real (ver evidencia en `tasks.md` T-004/T-005 y la actualización de
esta entrada). CA-4: flujo curl end-to-end en verde (login → periodo/lecturas/revisar/cerrar + los
bloqueos por unique/periodo cerrado reales). CA-6: `/app/lecturas` y `/app/lecturas/periodo` se
sirven con sesión (HTTP 200) y el middleware redirige a `/login` sin sesión (307). La interacción
de clic en navegador sigue disponible como verificación manual opcional.

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
