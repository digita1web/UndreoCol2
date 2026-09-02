# TASKS — 004: lecturas-y-consumo

**Spec aprobado:** 2026-09-04 (spec.md commit `b5236ec`)
**Plan aprobado:** 2026-09-04 (plan.md commit `61d94fe`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Entorno actual (2026-09-04, distinto de 002/003):** este contenedor ahora DISPONE de
  Docker con Supabase local completo (CLI 2.116.0, PostgreSQL 17.6, esquemas auth/storage/realtime,
  rol `authenticated`, `auth.uid()` nativo). La verificación de esquema/RLS/funciones se hace contra
  **Supabase local real** (MÁS fiel que el shim de 002/003): `supabase db reset --local` aplica las
  migraciones 001→004 desde cero. Las rutas HTTP (curl contra `wrangler dev`) y el flujo en
  navegador siguen como pendiente de Mateo si el Worker no puede apuntar a una base real durante
  `/implement`; si no, "NO VERIFICADO" con pasos exactos.
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
**Estado:** Completado (2026-09-04)
**Evidencia:**
```
Entorno: Supabase local completo (CLI 2.116.0, PostgreSQL 17.6) vía docker.
Base previa solo tenía 001; faltaban 002/003. Se usó `supabase db reset --local`
(aplica las migraciones 001→004 desde cero, lo más fiel posible):

$ supabase db reset --local --debug (tail)
  Applying migration 20260831150000_fundacion-tenancy.sql...
  Applying migration 20260901120000_catalogo-y-tarifas.sql...
  Applying migration 20260902090000_suscriptores-contadores.sql...
  Applying migration 20260904090000_lecturas-consumo.sql...     <-- 004 SIN ERRORES
  Finished supabase db reset on branch claude/sleepy-einstein-jehcn4.
  (WARN benigno: no seed.sql. "NotFound profile" al inicio es solo config, no bloquea.)

Verificación estructural tras el reset (psql -tAc contra postgres:postgres@localhost:54322/postgres):
  tablas: lecturas, periodos existen.
  enums:  estado_periodo = abierto,cerrado
          revision_lectura = normal,consumo_alto,consumo_bajo,consumo_cero
  RLS:    lecturas force=true ; periodos force=true
  trigger: trg_lectura_periodo_cerrado on lecturas
  índice: uq_periodo_abierto ON periodos (cliente_id) WHERE (estado='abierto')
  unique: lecturas_contador_id_periodo_id_key (UNIQUE (contador_id, periodo_id))
          lecturas_id_cliente_offline_key (UNIQUE (id_cliente_offline))
  check:  chk_consumo (CHECK (consumo_m3 >= 0)); chk_rango (fecha_fin >= fecha_inicio)
  FKs:    lecturas_contador_id_fkey/periodo_id_fkey ON DELETE RESTRICT

Fixtures 001/002/003 cargados tras el reset (base lista para T-002):
  fundacion.sql: 5 perfiles, 5 membresias, 2 configuracion, 3 usuarios_servicio (COMMIT)
  catalogo.sql:  3 servicios, 2 tarifas (COMMIT)
  suscriptores.sql: 2 contadores (A1/B1), 2 UPDATE contador_actual_id (COMMIT)
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
**Estado:** Completado (2026-09-04)
**Evidencia:**
```
Base: tras T-001 (reset + fixtures 001/002/003). Se aplicó el fixture de 004 y el test:
$ psql ... -f tests/fixtures/lecturas.sql
  BEGIN / DELETE 0 / DELETE 0 / INSERT 0 2 / INSERT 0 1 / COMMIT
$ psql ... -f tests/aislamiento/004_lecturas_consumo_aislamiento.sql
  ... (PASOS 1-9, cada uno con transacción+rollback)
  LECTURAS-CONSUMO-AISLAMIENTO OK        <-- (segunda corrida tras 2 correcciones)

La primera corrida FALLÓ en PASO 6 y PASO 9 (hallazgos reales documentados abajo);
la segunda pasó.

HALLAZGO REAL 1 (PASO 6): RLS es SILENCIOSO para UPDATE/DELETE. El test asumió que
"el lector NO puede marcar revisada" lanzaría un error de row-level security, pero la
política lecturas_admin usa `using (es_admin_de(cliente_id))`; al ser false para el
lector, PostgreSQL simplemente FILTRA la fila y el UPDATE afecta 0 filas SIN excepción.
Corregido: se verifica `get diagnostics n = row_count` → n = 0. (El admin SÍ marca → 1.)

HALLAZGO REAL 2 (PASO 9): un `insert ... on conflict (id_cliente_offline) do nothing`
sobre el contador/periodo A1 que YA tenía lectura de la fixture fallaba con
"duplicate key ... lecturas_contador_id_periodo_id_key": el conflicto de ese insert
violaba el unique (contador_id, periodo_id), no solo id_cliente_offline. Reescribí el
PASO 9 para probar la idempotencia de reenvío sobre el cliente B (periodo B1 abierto y
sin lecturas en el fixture): insertar el reenvío idéntico dos veces deja exactamente 1
fila (do nothing), y se verifica estructuralmente que existe el unique de id_cliente_offline.

Regresión sobre el mismo estado final (re-corrida en verde):
  001_fundacion_aislamiento.sql → FUNDACION-AISLAMIENTO OK
  002_catalogo_aislamiento.sql  → CATALOGO-AISLAMIENTO OK
  003_suscriptores_aislamiento.sql → SUSCRIPTORES-AISLAMIENTO OK
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
**Estado:** Completado (2026-09-04)
**Evidencia:**
```
$ npm test  (backend)
  ✓ tests/unit/monitor-db.test.ts (6 tests)
  ✓ tests/unit/tarifas.test.ts (8 tests)
  ✓ tests/unit/consumo.test.ts (22 tests)      <-- nuevo, CA-3
  Test Files  3 passed (3)
       Tests  36 passed (36)

$ npx tsc --noEmit  → sin salida (sin errores)

Consumo.test.ts cubre: consumo simple y primera lectura; rollover por
debajo/en el umbral/por encima, dígitos 5 (99999) y 6 (999999); lectura menor
sin rollover → rechazo; lectura > capacidad → rechazo; datos invalid (capacidad/
umbral no positivos); reemplazo (tramos y rechazo por tramo negativo); anomalías
alto (con/sin piso), bajo, cero, sin histórico; y la propiedad de no negativo/
<= capacidad + determinismo (ESTRATEGIA-CALIDAD §5.4).
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
**Estado:** Completado (2026-09-04) — se amplió `requerirClienteActivo` para incluir `perfilId`
**Evidencia:**
```
$ npx tsc --noEmit  → sin salida, sin errores
$ npx eslint .     → sin salida, sin errores
$ npx wrangler deploy --dry-run -c wrangler.toml
  Total Upload: 814.66 KiB / gzip: 160.91 KiB
  --dry-run: exiting now.          (sin errores; bundle dentro del límite)

Se amplió `ResultadoClienteActivo`/`requerirClienteActivo` para que `ctx` incluya
`perfilId` (antes solo supabase/clienteId): las rutas nuevas necesitan el autor
(cerrado_por, tomada_por, revisada_por). No rompe las rutas existentes (campo añadido).

Rutas nuevas: POST /periodos · GET /periodos · PATCH /periodos/:id/cerrar ·
GET /lecturas?periodo_id=&solo_revision= · POST /lecturas · PATCH /lecturas/:id/revisar.
Toda escritura de consumo pasa por core/consumo.ts; la lectura_anterior la resuelve
lib/lecturas.ts (última lectura del contador / contadores.lectura_inicial / datos del
reemplazo), nunca del cliente. POST /lecturas respeta id_cliente_offline (devuelve la
existente si se reenvía).

Integración HTTP (curl real contra `wrangler dev` conectado a la base local) NO
VERIFICADO — requiere validación manual de Mateo: configurar wrangler.toml con la
URL/key de Supabase local, crear sesión admin real (login), y probar el flujo
POST /periodos → POST /lecturas → PATCH /.../revisar (mismo patrón que 002/003).
El aislamiento (CA-2/CA-5) ya valida las políticas RLS de estas tablas en T-002.
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

