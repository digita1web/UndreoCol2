# TASKS — 009: cortes-y-reconexiones

**Spec aprobado:** 2026-09-04 (spec.md, alcance reducido — opción a — aprobado explícitamente)
**Plan aprobado:** 2026-09-04 (plan.md commit `6771ccc`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Entorno de este contenedor:** sin Docker funcional (confirmado de nuevo antes de escribir esta
  tabla). La verificación de esquema/RLS/funciones se hace contra PostgreSQL 16 nativo con el shim
  de compatibilidad ya usado en 002/003 (`auth.uid()` vía GUC, roles
  `anon`/`authenticated`/`service_role`). Las rutas HTTP (curl real contra `wrangler dev`) y el
  flujo en navegador quedan "NO VERIFICADO — requiere validación manual de Mateo" si el contenedor
  de turno sigue sin Docker/PostgREST, con los pasos exactos. (El trabajo de 004-008 sí se hizo con
  Supabase local real en Docker, según su propio `tasks.md` — este contenedor específico no lo
  tiene disponible ahora mismo.)
- **Orden de verificación (plan.md §8):** migración + fixtures + aislamiento primero (bloquea todo
  lo demás — sin `cortes_reconexiones` no hay nada que exponer), luego backend, luego frontend,
  luego cierre. No hay `core/` nuevo en esta feature.
- **CA-3 es regresión, no reimplementación:** `backend/src/lib/facturacion.ts:136` y
  `backend/src/queues/cierre-facturacion.ts:86` ya filtran `estado = 'activo'`. 009 no toca esos
  archivos; T-002 solo confirma que el filtro sigue ahí después de aplicar la migración de 009.

---

## T-001 — Migración: `cortes_reconexiones`, `registrar_corte()`, `reconectar()`, RLS

**Archivos:** `supabase/migrations/20260911090000_cortes-reconexiones.sql`
**Hace:** (plan.md §2) enum `tipo_evento_corte`; tabla `cortes_reconexiones` (`motivo`/`responsable`
`NOT NULL` a nivel de esquema, `factura_reconexion_id`/`deuda_vencida_al_reconectar` nullable, sin
`DELETE` expuesto); función `registrar_corte()` (`SECURITY INVOKER`, `SELECT FOR UPDATE` sobre
`usuarios_servicio`, exige motivo, rechaza si ya está cortado); función `reconectar()` (mismo
patrón, exige motivo de excepción si `p_deuda_vencida > 0`, rechaza si no está cortado, llama
`siguiente_numero_factura()` con `prefijo_reconexion`, inserta la factura de reconexión + un
renglón en `factura_detalles` con `servicio_id`/`tarifa_id` `NULL`, deja que
`trg_factura_detalles_recalcula()` recalcule el total); RLS `FORCE` + políticas reutilizando
`es_admin_de()`/`mis_clientes()`/`es_admin_plataforma()`.
**Verificación:**
```bash
# 001 → 008 en secuencia (fixtures de cada una) + esta migración
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260831150000_fundacion-tenancy.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260901120000_catalogo-y-tarifas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260902090000_suscriptores-contadores.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260904090000_lecturas-consumo.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260905090000_facturacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260906090000_correo-factura.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260907090000_pagos.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260908090000_portal-suscriptor.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260909090000_portal-slug.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260911090000_cortes-reconexiones.sql
psql "$DATABASE_URL" -c "\d cortes_reconexiones"
psql "$DATABASE_URL" -c "\df public.registrar_corte"
psql "$DATABASE_URL" -c "\df public.reconectar"
psql "$DATABASE_URL" -c "select relname, relforcerowsecurity from pg_class where relname = 'cortes_reconexiones';"
```
**Resultado esperado:** las 9 migraciones previas y la nueva aplican sin errores; tabla y funciones
con la forma del plan; RLS `FORCE`.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-002 — Fixtures + test de aislamiento (CA-2) + regresión CA-3

**Archivos:** `tests/fixtures/cortes.sql`, `tests/aislamiento/009_cortes_aislamiento.sql`
**Hace:** Fixture con suscriptores de A y B con facturas vencidas (reutiliza clientes/suscriptores
de fixtures previos, agrega facturas vencidas mínimas para tener candidatos a corte). Test de
aislamiento cubriendo:
1. Acueducto A no lee/escribe `cortes_reconexiones` de B.
2. `registrar_corte()`/`reconectar()` sobre un `usuario_servicio_id` de B fallan con "no existe".
3. Rol `lector` no puede llamar ninguna de las dos funciones.
4. `registrar_corte()` sobre un suscriptor ya `cortado` falla explícitamente.
5. `reconectar()` sobre un suscriptor `activo` (no cortado) falla explícitamente.
6. `reconectar()` con deuda vencida simulada y sin motivo de excepción falla; con motivo, se acepta
   y la factura de reconexión queda con el monto de `configuracion.valor_reconexion`.
7. **Regresión CA-3:** tras cortar un suscriptor, se confirma (leyendo el archivo, no
   reimplementando el test) que `facturacion.ts`/`cierre-facturacion.ts` siguen filtrando
   `estado = 'activo'`.
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/cortes.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/009_cortes_aislamiento.sql
grep -n "estado', 'activo'" backend/src/lib/facturacion.ts backend/src/queues/cierre-facturacion.ts
```
**Resultado esperado:** ambos scripts en verde, terminan con `CORTES-AISLAMIENTO OK`; el `grep`
sigue encontrando el filtro en ambos archivos.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-003 — Backend: `lib/cortes.ts` + rutas (CA-4)

**Archivos:** `backend/src/lib/cortes.ts`, `backend/src/index.ts`
**Hace:** `lib/cortes.ts`: candidatos a corte (reutiliza `obtenerCartera()` de `lib/pagos.ts`,
filtra por `diasMoraMax >= configuracion.dias_umbral_corte`), llamada RPC a `registrar_corte()`,
cálculo de deuda vencida del suscriptor (vía `obtenerCartera({ suscriptorId })`) + llamada RPC a
`reconectar()`, historial (`SELECT` de `cortes_reconexiones`). Rutas: `GET /cortes/candidatos`,
`POST /suscriptores/:id/corte`, `POST /suscriptores/:id/reconexion`,
`GET /suscriptores/:id/historial-cortes` — todas detrás de `requerirClienteActivo()` (reutilizado).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
npx vitest run
```
**Resultado esperado:** `tsc`/`eslint` sin errores; el Worker sigue empaquetando; la suite completa
de `vitest` (incluida la de 007/otras) sigue en verde — sin `core/` nuevo en esta tarea, esto
confirma que no se rompió nada existente.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-004 — Frontend: `lib/api.ts` — funciones de cortes y reconexiones

**Archivos:** `frontend/lib/api.ts`
**Hace:** Añade `listarCandidatosCorte`, `cortarSuscriptor`, `reconectarSuscriptor`,
`historialCortes`, mismo wrapper `peticion<T>()` existente.
**Verificación:**
```bash
cd frontend && npx tsc --noEmit
grep -rn "@supabase" frontend/app/ frontend/components/ frontend/lib/
```
**Resultado esperado:** `tsc` sin errores; el `grep` de `@supabase` no encuentra ningún `import`
real (el comentario de cabecera de `lib/api.ts` sigue siendo el único match esperado, como en 002
T-006/003 T-005).
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)

## T-005 — Frontend: panel de candidatos + acciones en el detalle del suscriptor (CA-7)

**Archivos:** `frontend/app/app/cortes/page.tsx`, `frontend/components/corte-form.tsx`,
`frontend/components/reconexion-form.tsx`, `frontend/app/app/suscriptores/[id]/page.tsx` (editado)
**Hace:** `/app/cortes`: lista de candidatos a corte (deuda vencida, días de mora) con acción de
corte manual desde ahí. En el detalle del suscriptor: botón de cortar (si `activo`) o reconectar
(si `cortado`, con aviso de deuda vencida y campo de motivo de excepción cuando aplica) + historial
de `cortes_reconexiones`, mismo lugar que el historial de reemplazos de contador (003).
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

## T-006 — Verificación manual end-to-end (CA-7)

**Archivos:** ninguno (solo verificación)
**Hace:** Flujo completo en navegador: login admin → `/app/cortes` → ver candidatos → cortar un
suscriptor con motivo → entrar a su detalle → ver que aparece como cortado con el historial →
reconectar (con o sin deuda vencida, según el fixture) → confirmar que se generó la factura de
reconexión.
**Verificación:**
```bash
cd backend && npx wrangler dev
cd frontend && npm run dev
# navegar manualmente el flujo descrito arriba
```
**Resultado esperado:** el flujo completo funciona sin error visible en ningún paso.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente — si este contenedor no puede levantar wrangler dev + next dev simultáneos contra una
base real, se declara "NO VERIFICADO — requiere validación manual de Mateo" con los pasos exactos
de arriba)
```
**Commit:** (no aplica si queda NO VERIFICADO — tarea sin cambios de código)

## T-007 — Cierre: CHANGELOG + checklist `spec.md §8`

**Archivos:** `CHANGELOG.md`, `specs/009-cortes-y-reconexiones/spec.md` (checklist final)
**Hace:** Entrada de CHANGELOG resumiendo T-001 a T-006 (qué se hizo, qué quedó NO VERIFICADO) y la
checklist de "Definición de terminado" de `spec.md §8` marcada con evidencia real.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx wrangler deploy --dry-run -c wrangler.toml && npx vitest run
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** los 5 comandos en verde (no hay `vitest` nuevo propio de 009, pero la suite
completa debe seguir pasando), evidencia pegada en el CHANGELOG y en esta tarea.
**Estado:** Pendiente
**Evidencia:**
```
(pendiente)
```
**Commit:** (pendiente)
