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
**Commit:** (pendiente)

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
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
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
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

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
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
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
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
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
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
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
