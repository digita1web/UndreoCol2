# TASKS — 004: lecturas-y-consumo

**Spec aprobado:** 2026-09-04 (spec.md commit `b5236ec`)
**Plan aprobado:** 2026-09-04 (plan.md commit `61d94fe`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Mismo entorno que 002/003:** este contenedor no tiene Docker funcional ni PostgREST. La
  verificación de esquema/RLS/funciones se hace contra PostgreSQL 16 nativo con el shim de
  compatibilidad ya usado en 002/003 (`auth.uid()` vía GUC, roles `anon`/`authenticated`/`service_role`).
  Las rutas HTTP (curl real contra `wrangler dev`) y el flujo en navegador quedan "NO VERIFICADO —
  requiere validación manual de Mateo" si el contenedor de turno sigue sin esas piezas, con los pasos
  exactos.
- **Orden de verificación (plan.md §8):** migración + aislamiento primero (bloquea todo lo demás),
  luego `core/consumo.ts` + unit, luego `lib/lecturas.ts` + rutas, luego frontend, luego cierre.
- **Orden de aplicación antes de cada paso de base:** `001 + 002 + 003` migraciones, luego
  `tests/fixtures/fundacion.sql + catalogo.sql + suscriptores.sql`, luego los fixtures nuevos de 004.
- **Regla de decimales (plan.md §4):** el consumo se maneja en m³ con 2 decimales (`number` en
  `core/`, `numeric(12,2)` en Postgres). El redondeo a la unidad de pesos es de 005, no de 004.

---

## T-001 — Migración: enums + tablas `periodos`/`lecturas` + trigger + RLS (CA-1)

**Archivos:** `supabase/migrations/20260904090000_lecturas-consumo.sql`
**Hace:** `create type estado_periodo` y `revision_lectura`; tabla `periodos` con unique
`(cliente_id, anio, mes)` + índice parcial `uq_periodo_abierto` + `chk_rango` + trigger `updated_at`;
tabla `lecturas` con FKs `ON DELETE RESTRICT` a `contadores`/`periodos`, unique
`(contador_id, periodo_id)`, unique `id_cliente_offline`, `chk_consumo >= 0` y sus índices
(incluido el parcial de la cola de revisión); función + trigger `bloquear_lectura_periodo_cerrado()`
(`SECURITY DEFINER`, solo lee `estado` de `periodos`); RLS `FORCE` + políticas en `periodos`
(lector solo lee) y `lecturas` (lector inserta/lee, revisión/delete solo `admin_acueducto`),
siguiendo el esquema de plan.md §2.
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260831150000_fundacion-tenancy.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260901120000_catalogo-y-tarifas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260902090000_suscriptores-contadores.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/catalogo.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/suscriptores.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260904090000_lecturas-consumo.sql
psql "$DATABASE_URL" -c "\d periodos"
psql "$DATABASE_URL" -c "\d lecturas"
psql "$DATABASE_URL" -c "select relname, relforcerowsecurity from pg_class where relname in ('periodos','lecturas');"
```
**Resultado esperado:** la migración aplica sobre una base con los fixtures de 001/002/003 sin
perder filas (los fixtures ya aplicados siguen intactos); `periodos` y `lecturas` tienen la forma del
plan.md §2; RLS `FORCE` en ambas; existe `uq_periodo_abierto`, el unique `(contador_id, periodo_id)`,
el unique de `id_cliente_offline` y el trigger `bloquear_lectura_periodo_cerrado`.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)
## T-002 — Fixtures + test de aislamiento (CA-2, CA-5)

**Archivos:** `tests/fixtures/lecturas.sql`, `tests/aislamiento/004_lecturas_consumo_aislamiento.sql`
**Hace:** Fixture con periodos y lecturas de ejemplo para los acueductos A y B (reutiliza los
contadores A1/B1 de `tests/fixtures/suscriptores.sql`; abre un periodo por acueducto y registra
lecturas de ejemplo, teniendo presente que `lecturas.consumo_m3` es calculado por `core/` en la
migración pero en el fixture se inserta el valor consistente con la regla de rollover). Test de
aislamiento cubriendo:
1. Acueducto A no lee/escribe periodos ni lecturas de B por `SELECT`/`INSERT` directo.
2. Solo un periodo `abierto` por cliente (`uq_periodo_abierto`).
3. `lector` puede leer y **insertar** lecturas de su cliente, pero NO crear/cerrar `periodos` ni
   marcar `revisada` en lecturas (solo `admin_acueducto`).
4. Insertar una lectura en un `periodo` `cerrado` falla (trigger `bloquear_lectura_periodo_cerrado`).
5. `(contador_id, periodo_id)` duplicado viola el unique (cláusula punto 3).
6. `id_cliente_offline` duplicado no produce dos filas (idempotencia).
7. Regresión: re-corre 001/002/003 sobre el mismo estado final y sigue en verde.
**Verificación:**
```bash
# previo: 001+002+003 migraciones y fixtures de 001/002/003 (igual que T-001)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/lecturas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/004_lecturas_consumo_aislamiento.sql
```
**Resultado esperado:** ambos scripts en verde, terminan con `LECTURAS-CONSUMO-AISLAMIENTO OK`; las
aserciones de cada paso del enunciado quedan cubiertas y documentadas en el script.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-003 — `core/consumo.ts` + unit tests (CA-3)

**Archivos:** `backend/src/core/consumo.ts`, `backend/tests/unit/consumo.test.ts`
**Hace:** Lógica pura (CLAUDE.md §5.3): `calcularConsumoPeriodo` (rollover punto 1 y rechazo punto 2),
`calcularConsumoConReemplazo` (punto 7), `clasificarAnomalia` (puntos 5/6) y tipos
`ResultadoConsumo`/`ErrorLectura`/`VerificacionAnomalia` según las firmas de plan.md §4. Tests unit
con `vitest` cubriendo: rollover en umbral exacto/por encima/por debajo y dígitos 5 (99999) y 6
(999999); `lectura_menor_sin_rollover`; primera lectura; reemplazo (tramo saliente + entrante, y
tramo negativo → rechazo); anomalías alto (con/sin piso)/bajo/cero/normal y `promedioHistoricoM3 =
null`; propiedad de que el consumo nunca es negativo ni mayor que `capacidad_maxima` y determinismo.
**Verificación:**
```bash
cd backend && npm test
cd backend && npx tsc --noEmit
```
**Resultado esperado:** `npm test` (vitest) en verde con la salida de todos los casos pegada;
`tsc --noEmit` sin errores.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-004 — Backend: `lib/lecturas.ts` + rutas (CA-4)

**Archivos:** `backend/src/lib/lecturas.ts`, `backend/src/index.ts`
**Hace:** Capa fina de acceso a datos (sin lógica) para `periodos` (listar/crear/cerrar) y
`lecturas` (listar por periodo, crear, marcar revisada). Para `POST /lecturas` la `lectura_anterior`
se resuelve en esta capa (última lectura del contador o `contadores.lectura_inicial`, y en el caso
de reemplazo se usan los datos de `reemplazos_contador` — decisión plan.md §3/§5: nunca se acepta del
cliente). Las rutas de plan.md §3: `POST /periodos`, `GET /periodos`, `PATCH /periodos/:id/cerrar`,
`GET /lecturas?periodo_id=`, `POST /lecturas`, `PATCH /lecturas/:id/revisar`. El consumo y la
anomalía se calculan SIEMPRE en `core/consumo.ts`; si devuelve rechazo, la ruta responde 400 con el
motivo. `POST /lecturas` respeta la idempotencia por `id_cliente_offline` (si ya existe, devuelve la
fila existente, no duplica).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** `tsc`/`eslint` sin errores; el Worker sigue empaquetando sin superar el
límite de bundle. Cuando el entorno permita `wrangler dev` contra una base real, verificar con curl
las 6 rutas; si no, dejar "NO VERIFICADO" con los pasos exactos (patrón 002/003).
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-005 — Frontend: `lib/api.ts` + paneles de periodos/lecturas (CA-6)

**Archivos:** `frontend/lib/api.ts`, `frontend/app/app/lecturas/page.tsx`,
`frontend/app/app/lecturas/periodo/page.tsx`
**Hace:** Funciones de `api.ts` para crear/listar/cerrar periodos y listar/crear/revisar lecturas
(todo a través del backend Hono, nunca `@supabase/*` directo — CLAUDE.md §5.2). Panel
`/app/lecturas` (lecturas por periodo, alta manual con la validación del Motor, y cola de revisión
de anomalías `revision <> 'normal' and not revisada`); panel `periodo` (crear el periodo del mes,
cerrarlo). Protegidos por el middleware existente.
**Verificación:**
```bash
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** `build` compila las páginas nuevas y `lint` limpio. El flujo completo en
navegador real (login admin → crear periodo → registrar lectura → revisar anomalía) queda
"NO VERIFICADO — requiere validación manual de Mateo" si el entorno no permite `wrangler dev` +
`next dev` contra una base real; en ese caso, con los pasos exactos (patrón 003 T-008).
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-006 — Cierre: CHANGELOG + checklist CLAUDE.md §11

**Archivos:** `CHANGELOG.md`, `specs/004-lecturas-y-consumo/spec.md` (checklist final §8)
**Hace:** Entrada de CHANGELOG resumiendo T-001 a T-005 (qué se hizo, qué quedó NO VERIFICADO) y la
checklist de "Definición de terminado" de `spec.md §8` marcada con evidencia real (CA-1/CA-2/CA-5
contra PostgreSQL 16 + shim; CA-3 con `vitest`; CA-4/CA-6 con los estados reales).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx wrangler deploy --dry-run -c wrangler.toml && npm test
cd frontend && npm run build && npm run lint
# re-correr los 4 tests de aislamiento SQL sobre el estado final
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/001_fundacion_aislamiento.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/002_catalogo_aislamiento.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/003_suscriptores_aislamiento.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/004_lecturas_consumo_aislamiento.sql
```
**Resultado esperado:** los 4 comandos del backend y los 2 del frontend en verde (incluido
`vitest` de `core/consumo.ts`), los 4 tests de aislamiento SQL en verde sobre el mismo estado final,
evidencia pegada en el CHANGELOG y en esta tarea.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

