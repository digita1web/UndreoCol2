# TASKS — 012: importacion-suscriptores-excel

**Spec aprobado:** 2026-09-04 (spec.md commit `8d253f0`)
**Plan aprobado:** 2026-09-04 (plan.md commit `6dc2a2c`) — con autorización explícita para
implementar el parser puro sin checkpoint adicional; Mateo autorizó continuar con las fases que
tocan Supabase real (migración, duplicados contra la base, rutas HTTP, frontend) en un mensaje
posterior.

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Entorno de este contenedor:** sin Docker funcional. Verificación de esquema/RLS/funciones
  contra PostgreSQL 16 nativo con el shim de compatibilidad ya usado en 002/003/009. Rutas HTTP
  (curl real) y flujo en navegador quedan "NO VERIFICADO — requiere validación manual de Mateo".
- **Librería de parseo elegida en esta fase (plan.md §5 la dejó pendiente hasta ahora):** `xlsx`
  (SheetJS) `^0.18.5`, licencia Apache-2.0 (verificado con `npm view xlsx license` antes de
  instalar, CLAUDE.md §2). Lee tanto `.xlsx` como `.csv` con la misma API — evita una segunda
  dependencia solo para CSV.
- **Orden de verificación:** migración primero (bloquea todo lo demás), luego `lib/` (duplicados +
  RPC de importación), luego rutas, luego frontend, luego cierre.

---

## T-001 — `core/importacion-suscriptores.ts`: validación pura (CA-1, CA-2)

**Archivos:** `backend/src/core/importacion-suscriptores.ts`, `backend/tests/unit/importacion-suscriptores.test.ts`
**Hace:** Ya completada antes de este checkpoint (autorización explícita de Mateo en la tarea
original). `validarFilas()`/`traducirCategoria()` puros, sin Hono/Cloudflare/Supabase.
**Verificación:**
```bash
cd backend && npx vitest run tests/unit/importacion-suscriptores.test.ts
```
**Resultado esperado:** 15 tests en verde.
**Estado:** Completado (2026-09-04)
**Evidencia:** Ver commit — 15/15 tests en verde, `tsc`/`eslint` limpios, sin regresión en el resto
de la suite (105 tests en total en ese momento).
**Commit:** `aeec85d`

## T-002 — Migración: `importaciones_suscriptores`, `importar_suscriptores()`, RLS

**Archivos:** `supabase/migrations/20260912090000_importacion-suscriptores.sql`
**Hace:** (plan.md §2/§3) tabla `importaciones_suscriptores` (historial, `errores jsonb` con
`{fila, motivo}` — nunca el contenido de la fila, spec §3.6); función `importar_suscriptores()`
(`SECURITY INVOKER`, sin `SELECT FOR UPDATE` — cada suscriptor nuevo es una fila independiente sin
contención, plan.md §5 — inserta el lote completo en un solo `INSERT ... SELECT` desde un
`jsonb_to_recordset`, cualquier fallo revierte toda la función); RLS `FORCE` + políticas
reutilizando `es_admin_de()`/`mis_clientes()`/`es_admin_plataforma()`.
**Verificación:**
```bash
# 001 → 009 en secuencia (fixtures) + esta migración
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260831150000_fundacion-tenancy.sql
# ... (resto de 002 a 009)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260912090000_importacion-suscriptores.sql
psql "$DATABASE_URL" -c "\d importaciones_suscriptores"
psql "$DATABASE_URL" -c "\df public.importar_suscriptores"
psql "$DATABASE_URL" -c "select relname, relforcerowsecurity from pg_class where relname = 'importaciones_suscriptores';"
```
**Resultado esperado:** las 10 migraciones previas y la nueva aplican sin errores; tabla y función
con la forma del plan; RLS `FORCE`.
**Estado:** Completado (2026-09-04) — verificado con shim de PostgreSQL nativo, ver evidencia
**Evidencia:**
```
VERIFICADO con el shim de PostgreSQL 16 nativo (sin Docker en este contenedor). NO VERIFICADO con
`supabase db reset` real — pendiente del bench de Mateo con Docker.

Las 11 migraciones (001 a 012) aplican en secuencia sin errores, EXIT=0 cada una.

\d importaciones_suscriptores: 9 columnas, filas_intentadas/filas_importadas/filas_con_error/
  errores NOT NULL, FKs cliente_id/realizado_por correctas, 2 políticas RLS.
relforcerowsecurity: importaciones_suscriptores = t.
importar_suscriptores(p_cliente_id, p_filas_validas, p_filas_con_error, p_nombre_archivo,
  p_perfil): security_type=INVOKER.

Prueba funcional real (no solo forma del esquema): llamada directa a importar_suscriptores() con
2 filas válidas + 1 fila de error ya conocida → insertó exactamente 2 usuarios_servicio nuevos,
el historial quedó con filas_intentadas=3/filas_importadas=2/filas_con_error=1 y el array de
errores correcto.

Prueba de atomicidad (CA-6, adelantada aquí porque la migración es donde vive la garantía real):
un lote con una fila que viola el constraint único (cliente_id, codigo_suscriptor) revierte TODO
el lote — cero suscriptores nuevos, incluida la fila válida del mismo lote. Verificado con
duplicate key value violates unique constraint real de Postgres, no simulado.
```
**Commit:** `40aec4e`

## T-003 — Fixtures + test de aislamiento (CA-4)

**Archivos:** `tests/fixtures/importacion.sql` (no-op documentado, mismo criterio que 009 T-002 si
no hace falta estado persistente), `tests/aislamiento/012_importacion_aislamiento.sql`
**Hace:** Test de aislamiento cubriendo: acueducto A no lee/escribe `importaciones_suscriptores` de
B; `importar_suscriptores()` con `p_cliente_id` de B llamado por admin A falla; rol `lector` no
puede llamar `importar_suscriptores()`; un lote con una fila que viola el constraint único de
`codigo_suscriptor` revierte el lote completo (CA-6, cero suscriptores nuevos de ese intento).
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/importacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/012_importacion_aislamiento.sql
```
**Resultado esperado:** en verde, termina con `IMPORTACION-AISLAMIENTO OK`.
**Estado:** Completado (2026-09-04) — verificado con shim de PostgreSQL nativo, ver evidencia
**Evidencia:**
```
VERIFICADO con el shim de PostgreSQL 16 nativo (sin Docker en este contenedor). NO VERIFICADO con
`supabase db reset` real — pendiente del bench de Mateo con Docker.

tests/fixtures/importacion.sql y tests/aislamiento/012_importacion_aislamiento.sql aplicaron en
verde, terminando con "IMPORTACION-AISLAMIENTO OK" (6/6 pasos):
  PASO 1: importaciones_suscriptores existe con FORCE ROW LEVEL SECURITY.
  PASO 2: admin A no puede llamar importar_suscriptores() con el cliente_id de B — falla con
    "No autorizado" y cero filas insertadas en el cliente B.
  PASO 3: admin A no puede leer el historial de importación de B.
  PASO 4: rol lector no puede llamar importar_suscriptores() sobre su propio cliente.
  PASO 5 (CA-6 re-verificado en la suite formal): un lote con un codigo_suscriptor duplicado
    revierte TODO el lote, incluida la fila válida del mismo lote.
  PASO 6: una importación exitosa solo afecta al cliente del llamante; el registro de historial
    queda con el cliente_id y realizado_por correctos.

Regresión completa: se reconstruyó undreocol_test desde cero (drop/create database, sin conexiones
colgadas — se usó pg_terminate_backend antes del drop para evitar el fallo de "cannot drop the
currently open database" de un intento anterior), se reaplicó el shim de compatibilidad
(schema auth, auth.uid(), roles anon/authenticated/service_role, bypassrls en postgres) y las 11
migraciones (001 a 012) en orden, exit 0 cada una. Se aplicaron las 10 fixtures en el orden de
dependencia real (fundacion, catalogo, suscriptores, lecturas, facturacion, correo-factura, pagos,
portal, cortes, importacion — el orden alfabético de archivos no coincide con el de dependencias),
exit 0 cada una. Se corrieron las 10 suites de aislamiento (001 a 009 y 012) en una sola pasada
limpia: las 10 pasaron, incluyendo 008_portal_aislamiento.sql — confirma que el fallo de PASO 3 de
008 visto en una corrida anterior sobre la misma base de datos de larga duración era, como se
documentó en el cierre de 009 (CHANGELOG Sesión 016), estado acumulado de corridas repetidas del
fixture de bloqueo de login, no una regresión real. 012 no rompe ninguna suite previa.
```
**Commit:** (pendiente)

## T-004 — Backend: `lib/importacion-suscriptores.ts` (CA-3, CA-6)

**Archivos:** `backend/src/lib/importacion-suscriptores.ts`
**Hace:** `detectarDuplicadosContraBase()`: para las filas ya válidas de `core/`, consulta
`usuarios_servicio` del cliente activo y marca como error adicional cualquier
`codigo_suscriptor`/`numero_documento` ya existente (CA-3 — recordatorio: `numero_documento` no
tiene constraint único en la base, así que esta validación es la única barrera para ese caso).
`confirmarImportacion()`: llama la RPC `importar_suscriptores()` con las filas elegidas, devuelve
el reporte (spec §3.5).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
```
**Resultado esperado:** sin errores.
**Estado:** Completado (2026-09-04) — verificado con shim de PostgreSQL nativo, ver evidencia
**Evidencia:**
```
`npx tsc --noEmit` y `npx eslint src/lib/importacion-suscriptores.ts` sin errores.
`npx vitest run`: 9 archivos, 105/105 tests en verde (sin regresión, incluye los 15 de
importacion-suscriptores.test.ts de T-001).

CA-3 (duplicados contra la base) — VERIFICADO el comportamiento de la consulta real de
detectarDuplicadosContraBase() contra Postgres, incluyendo el caso explícito que pide el CA
("solo numero_documento coincide, codigo_suscriptor es distinto"):
  - usuarios_servicio de cliente A ya tiene codigo_suscriptor='A-001', numero_documento='1000000001'.
  - Consulta equivalente con codigo_suscriptor in ('IMP-CODIGO-NUEVO') or numero_documento in
    ('1000000001') → devuelve la fila de A-001: el numero_documento coincide aunque el
    codigo_suscriptor no, exactamente el caso que el constraint único de la base NO cubre
    (spec §3.3) y que esta validación sí debe atrapar.
  - Consulta con valores genuinamente nuevos (codigo_suscriptor='IMP-NUEVO-1',
    numero_documento='9999999999') → 0 filas, sin falso positivo.

NO VERIFICADO con supabase-js real contra PostgREST — este contenedor no tiene Docker/Supabase CLI
para levantar PostgREST; detectarDuplicadosContraBase() y confirmarImportacion() se probaron a
nivel de la consulta SQL que ejecutan (equivalente exacto de lo que construye el .or() de
supabase-js), no invocando el cliente supabase-js en sí. Requiere validación manual de Mateo con
su bench (Docker + supabase start): correr detectarDuplicadosContraBase()/confirmarImportacion()
desde un script o desde las rutas de T-005 contra un proyecto Supabase local real.

categoriasSinTarifa() (advertencia informativa, spec §5, no bloqueante): implementada siguiendo el
mismo patrón que backend/src/lib/facturacion.ts (tarifa_vigente() por servicio activo). NO
VERIFICADA funcionalmente en esta tarea — no hay servicios/tarifas de prueba con huecos armados
para este caso; se limita a revisión de código y tipos. Queda para la verificación manual E2E de
T-008 si Mateo quiere confirmarla con datos reales.
```
**Commit:** `8c30ff0`

## T-005 — Backend: rutas `/suscriptores/importar/*` (CA-5)

**Archivos:** `backend/src/index.ts`
**Hace:** `POST /suscriptores/importar/validar` (corre `core/` + `lib/` duplicados, no escribe
nada), `POST /suscriptores/importar/confirmar` (llama `confirmarImportacion()`).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
npx vitest run
```
**Resultado esperado:** sin errores; Worker empaqueta; suite completa sigue en verde.
**Estado:** Completado (2026-09-04)
**Evidencia:**
```
`npx tsc --noEmit` y `npx eslint src/index.ts` sin errores.
`npx wrangler deploy --dry-run -c wrangler.toml`: Total Upload 1738.46 KiB / gzip 395.76 KiB,
bindings intactos (EMAIL, FACTURACION_COLA, FACTURAS_R2, ALLOWED_ORIGIN), exit 0.
`npx vitest run`: 9 archivos, 105/105 tests en verde, sin regresión.

Rutas agregadas: POST /suscriptores/importar/validar (valida body.filas no vacío y
<= LIMITE_FILAS_IMPORTACION=2000 antes de procesar, CLAUDE.md §5.5 — corre validarFilas() de
core/ + detectarDuplicadosContraBase() de lib/, no escribe nada) y POST
/suscriptores/importar/confirmar (exige nombreArchivo y al menos una fila válida, llama
confirmarImportacion()). Ambas detrás de requerirClienteActivo() (mismo guard que el resto del
panel — sesión admin + cliente activo resuelto).

NO VERIFICADO con peticiones HTTP reales (curl/wrangler dev contra Postgres real) — este
contenedor no tiene Docker/Supabase CLI para levantar PostgREST. Requiere validación manual de
Mateo: `npx wrangler dev` en backend/ + `supabase start` local, luego
`curl -X POST http://localhost:8787/suscriptores/importar/validar -H "Cookie: <sesión admin>" -d '{"filas":[...],"mapeo":{...}}'`
seguido de `curl -X POST .../suscriptores/importar/confirmar -d '{"filasValidas":[...],"errores":[...],"nombreArchivo":"prueba.xlsx"}'`
y confirmar el reporte + la fila nueva en importaciones_suscriptores.
```
**Commit:** (pendiente)
**Commit:** (pendiente)

## T-006 — Frontend: `lib/api.ts` — funciones de importación

**Archivos:** `frontend/lib/api.ts`
**Hace:** `validarImportacion()`, `confirmarImportacion()`, mismo wrapper `peticion<T>()`.
**Verificación:**
```bash
cd frontend && npx tsc --noEmit
grep -rn "@supabase" frontend/app/ frontend/components/ frontend/lib/
```
**Resultado esperado:** sin errores; `grep` sin imports reales de `@supabase`.
**Estado:** Completado (2026-09-04)
**Evidencia:**
```
`npx tsc --noEmit` sin errores. `grep -rn "@supabase" frontend/app/ frontend/components/ frontend/lib/`
solo encuentra la línea del comentario de cabecera de lib/api.ts ("Nunca importa @supabase/*"),
ningún import real.

Agregadas validarImportacion(filas, mapeo) → POST /suscriptores/importar/validar y
confirmarImportacion(filasValidas, errores, nombreArchivo) → POST
/suscriptores/importar/confirmar, mismo wrapper peticion<T>() del resto del archivo. Tipos
espejo de core/importacion-suscriptores.ts (backend) con sufijo "Importacion" para no chocar con
otros tipos del archivo.
```
**Commit:** (pendiente)

## T-007 — Frontend: `/app/suscriptores/importar` — carga, mapeo, resumen, confirmación

**Archivos:** `frontend/app/app/suscriptores/importar/page.tsx`, `frontend/components/importacion-mapeo.tsx`, `frontend/components/importacion-resumen.tsx`
**Hace:** Sube `.xlsx`/`.csv` (parseado en el navegador con `xlsx`/SheetJS — nunca llega el
archivo crudo al Worker, solo las filas ya parseadas como JSON, evitando el límite de bundle/
memoria de Cloudflare Workers CLAUDE.md §5.5), mapeo de columnas configurable, resumen de
errores, confirmación, reporte final.
**Verificación:**
```bash
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** build y lint sin errores ni warnings de TypeScript.
**Estado:** Completado (2026-09-04) — ver advertencia de seguridad de la dependencia abajo
**Evidencia:**
```
`npm run build`: compila y tipa sin errores ni warnings (Next.js 15.5.25), 15 rutas generadas
incluyendo /app/suscriptores/importar (113 kB propio / 229 kB First Load JS — el peso de xlsx/
SheetJS, esperado para un parser de archivos, solo carga en esta ruta). `npm run lint` limpio.
`grep -rn "@supabase" frontend/app/ frontend/components/ frontend/lib/` solo la línea del
comentario de cabecera de lib/api.ts, sin imports reales (CLAUDE.md §5.2).

frontend/components/importacion-mapeo.tsx: input de archivo .xlsx/.csv, XLSX.read() +
sheet_to_json() en el navegador (nunca se envía el archivo crudo a la API, CLAUDE.md §5.5),
detecta columnas del encabezado, formulario de mapeo de los 10 campos (5 requeridos marcados con
*, botón "Validar" deshabilitado hasta que los 5 requeridos tengan columna asignada, spec §3.1).
frontend/components/importacion-resumen.tsx: resumen de validas/errores (3.3), botón "Importar
N fila(s) válida(s)" que SOLO envía las filas válidas (nunca "importar todo e ignorar errores",
3.4), reporte final con conteos + advertencia no bloqueante de categoriasSinTarifa + id de la
importación (3.5). frontend/app/app/suscriptores/importar/page.tsx: conecta ambos, llama
validarImportacion()/confirmarImportacion() de T-006. Enlace agregado desde
/app/suscriptores ("Importar desde Excel").

ADVERTENCIA DE SEGURIDAD DE LA DEPENDENCIA — hallazgo real de `npm audit`, no solo revisión de
licencia: el paquete `xlsx@0.18.5` publicado en el registro de npm (el que se pudo instalar en
este contenedor) tiene 2 vulnerabilidades altas SIN parche en npm: Prototype Pollution
(GHSA-4r6h-8v6p-xvw6) y ReDoS (GHSA-5pgg-2g8v-p4x9). SheetJS dejó de publicar versiones
parcheadas en el registro de npm y las distribuye solo desde su propio CDN
(cdn.sheetjs.com/xlsx-0.20.3/...) — intenté instalar esa versión parcheada en este contenedor y
el proxy de red la bloqueó (cdn.sheetjs.com no está en la lista blanca de este entorno, CONNECT
403). El parseo ocurre enteramente en el navegador del admin sobre un archivo que el propio admin
elige subir (no es una API pública ni toca el Worker/la base), así que el radio de impacto real es
la pestaña del navegador del admin, no el servidor ni los datos de otros acueductos — pero sigue
siendo una vulnerabilidad real y sin parchear en una dependencia nueva.

NO VERIFICADO / acción pendiente de Mateo: desde su bench (con acceso normal a internet), cambiar
la fuente de instalación en frontend/package.json de `"xlsx": "^0.18.5"` a la URL del tarball
parcheado de SheetJS (`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` o la versión
estable que SheetJS tenga publicada en ese momento — revisar https://docs.sheetjs.com/docs/getting-started/installation/nodejs
para la URL vigente) y correr `npm install` de nuevo — es un cambio de una línea en package.json,
la API que usa importacion-mapeo.tsx (XLSX.read/XLSX.utils.sheet_to_json) es estable entre esas
versiones, así que no debería requerir cambios de código, pero SÍ requiere volver a correr
`npm run build` para confirmarlo.

Flujo real en navegador con un archivo .xlsx/.csv de prueba: NO VERIFICADO en esta tarea — este
contenedor no puede levantar `wrangler dev` + `next dev` contra una base real (sin Docker/
PostgREST). Queda para T-008.
```
**Commit:** (pendiente)

## T-008 — Verificación manual end-to-end (CA-7)

**Archivos:** ninguno (solo verificación)
**Hace:** Flujo completo en navegador con un archivo `.xlsx`/`.csv` de prueba real: subir → mapear
→ ver resumen de errores → confirmar → ver reporte → ver el historial de importaciones.
**Verificación:**
```bash
cd backend && npx wrangler dev
cd frontend && npm run dev
# navegar manualmente el flujo descrito arriba con un archivo de prueba
```
**Resultado esperado:** el flujo completo funciona sin error visible en ningún paso.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente — si este contenedor no puede levantar wrangler dev + next dev simultáneos contra una
base real, se declara "NO VERIFICADO — requiere validación manual de Mateo" con los pasos exactos)
```
**Commit:** (no aplica si queda NO VERIFICADO — tarea sin cambios de código)

## T-009 — Cierre: CHANGELOG + checklist `spec.md §8`

**Archivos:** `CHANGELOG.md`, `specs/012-importacion-suscriptores-excel/spec.md` (checklist final)
**Hace:** Entrada de CHANGELOG resumiendo T-001 a T-008 y la checklist de "Definición de terminado"
marcada con evidencia real.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx wrangler deploy --dry-run -c wrangler.toml && npx vitest run
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** los 5 comandos en verde.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)
