# TASKS — 005: facturacion

**Spec aprobado:** 2026-09-05 (spec.md commit `b5d3e50`)
**Plan aprobado:** 2026-09-05 (plan.md commit `f08ae42`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Entorno:** Supabase local real (CLI 2.116.0, PostgreSQL 17.6, `auth.uid()` nativo) + Docker.
  La base se reconstruye por completo con `supabase db reset --local` (aplica 001→004 migraciones
  desde cero) y luego se cargan los fixtures existentes de 001/002/003/004 antes de cada paso de base
  que lo requiera.
- **Cloudflare Queues:** el round-trip producer→cola→consumer SÍ se puede probar en local con
  `wrangler dev` (miniflare): se verificó empíricamente en /plan (plan.md §0). No hay credenciales de
  Cuenta Cloudflare en el entorno (sin `~/.wrangler/config`), así que colas remotas reales y el
  despliegue a Cloudflare quedan "NO VERIFICADO — requiere Mateo".
- **Orden de verificación (plan.md §8):** migración + aislamiento primero, luego `core/` + unit,
  luego `lib/` + rutas (simulación/anulación), luego consumidor de Queues + emisión (round-trip
  local), luego frontend, luego cierre.
- **D-5:** las tarifas de los fixtures son provisionales; nunca se presentan como reales en ningún
  caso del dataset de simulación.

---

## T-001 — Migración: enums + tablas `facturas`/`factura_detalles`/`factura_lecturas` + triggers + RLS (CA-1)

**Archivos:** `supabase/migrations/20260905090000_facturacion.sql`
**Hace:** `create type tipo_factura`/`estado_factura`; tabla `facturas` (unique `(cliente_id, numero)`,
índice `uq_factura_ciclo`, check `total_pagado <= total`, FKs `ON DELETE RESTRICT` a
`usuarios_servicio`/`periodos`); tabla `factura_detalles` (`tarifa_id`/`servicio_id` como referencia
permanente `ON DELETE SET NULL`); tabla `factura_lecturas` (PK `(factura_id, lectura_id)`); función+
trigger `trg_factura_periodo_cerrado` (`SECURITY DEFINER`, rechaza emitir/modificar de periodo
cerrado salvo anulación) y el trigger de `total` = suma de detalles (decisión plan.md §5: recalculado
por `AFTER` en `factura_detalles`); RLS `FORCE` + políticas (lectura para miembros del cliente,
escritura solo `admin_acueducto`).
**Verificación:**
```bash
supabase db reset --local
# cargar fixtures previos para tener datos de contraste (patrón 004)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/catalogo.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/suscriptores.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/lecturas.sql
psql "$DATABASE_URL" -c "\d facturas" && psql "$DATABASE_URL" -c "\d factura_detalles"
psql "$DATABASE_URL" -c "select relname, relforcerowsecurity from pg_class where relname in ('facturas','factura_detalles','factura_lecturas');"
psql "$DATABASE_URL" -c "select tgname from pg_trigger where tgrelid='public.facturas'::regclass and not tgisinternal;"
```
**Resultado esperado:** la 005 aplica sobre las 4 anteriores sin romperlas; las 3 tablas tienen la
forma del plan.md §2; RLS `FORCE` en las 3; existen `uq_factura_ciclo` y el trigger de periodo
cerrado.
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
$ supabase db reset --local → Finished supabase db reset (001→005 migraciones aplicadas desde cero)

Verificación estructural (psql -tAc contra postgres@localhost:54322):
  tablas: facturas, factura_detalles, factura_lecturas existen.
  enums:  estado_factura = pendiente,pagada,vencida,anulada
          tipo_factura = ciclo,reconexion,ajuste
  RLS:    facturas force=true ; factura_detalles force=true ; factura_lecturas force=true
  triggers: trg_factura_periodo_cerrado on facturas
            trg_facturas_updated on facturas
            trg_factura_detalles_recalcula on factura_detalles
  índices: uq_factura_ciclo (usuario_servicio_id, periodo_id) WHERE tipo='ciclo'
           facturas_cliente_id_numero_key UNIQUE (cliente_id, numero)
  check:  chk_total_pagado (CHECK ((total_pagado <= total)))

Smoke test real del trigger de recálculo (transacción con rollback):
  factura insertada con total=0 (mal a propósito) + detalle subtotal=10000, recargo_mora=300
  → tras el insert del detalle: subtotal_servicios=10000.00, total=10300.00  ✔ (recalculado)

HALLAZGO REAL (corregido en el mismo T-001, commit --amend): el trigger inicial
trg_factura_periodo_cerrado BLOQUEABA el INSERT de facturas de un periodo cerrado, pero el flujo
de 004→005 emite facturas SOBRE periodos que 004 ya cerró (spec 004 §3.1). Eso habría impedido la
propia emisión del cierre. Se reemplazó por trg_factura_inmutable que implementa la invariante
correcta (ESTRATEGIA-CALIDAD §2): INSERT (emisión) permitido — la doble emisión la previene
uq_factura_ciclo; UPDATE solo anulación (con motivo obligatorio) o avance de total_pagado/estado
(007); DELETE siempre bloqueado. Smoke test del trigger corregido en base real (5/5):
  1) EMISIÓN en periodo cerrado: OK   2) Edición bloqueada: OK   3) DELETE bloqueado: OK
  4) Anulación sin motivo bloqueada: OK   5) Anulación con motivo: OK

Fixtures previos (001→004) cargados tras el reset para dejar base lista a T-002:
  fundacion.sql / catalogo.sql / suscriptores.sql / lecturas.sql → COMMIT cada uno.
```
**Commit:** `c8385bf` (amended en c8385bf con el trigger corregido)

## T-002 — Fixtures + test de aislamiento (CA-2)

**Archivos:** `tests/fixtures/facturacion.sql`, `tests/aislamiento/005_facturacion_aislamiento.sql`
**Hace:** Fixture con suscriptores que tienen lecturas en un periodo y sus tarifas de 002 para que la
simulación tenga datos; deja también un suscriptor SIN tarifa y uno SIN lectura (casos de la regla 9d
y del "usuario sin lectura" como anomalía). Test de aislamiento cubriendo: A no lee/escribe facturas
de B; solo `admin_acueducto` escribe/anula; el `lector` lee pero no escribe; un `numero` duplicado
del cliente y un segundo `ciclo` del mismo `(usuario_servicio, periodo)` violan sus unique; el
trigger rechaza emitir de un periodo cerrado (pero permite anular); `total_pagado > total` es
rechazado. Regresión de 001–004 sobre el mismo estado final en verde.
**Verificación:**
```bash
# previo: 001→004 migraciones + fixtures (igual que T-001)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/facturacion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/005_facturacion_aislamiento.sql
# regresión
for f in 001_fundacion 002_catalogo 003_suscriptores 004_lecturas_consumo; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/${f}_aislamiento.sql
done
```
**Resultado esperado:** `005_facturacion_aislamiento.sql` termina en verde
(`FACTURACION-AISLAMIENTO OK`) y los 4 previos siguen en verde.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-003 — `core/facturacion.ts` + unit tests (CA-3)

**Archivos:** `backend/src/core/facturacion.ts`, `backend/tests/unit/facturacion.test.ts`
**Hace:** Lógica pura (CLAUDE.md §5.3): `armarRenglones` (reusa `calcularSubtotalServicio` de
`core/tarifas.ts`; puntos 10 y 15/D-1), `calcularRecargoMora` (punto 11, excluye la factura actual),
`componerTotal` (§2.9), `componerNumeroFactura` (D-3) y `clasificarAnomaliasFacturacion`, según las
firmas de plan.md §4. Tests unit con `vitest`: renglones sobre un mismo consumo (límite exacto ±1),
mora con/sin deuda, total (con saldo anterior), formato del número, anomalías, y que el redondeo del
peso se aplica una sola vez.
**Verificación:**
```bash
cd backend && npm test
cd backend && npx tsc --noEmit
```
**Resultado esperado:** los unit de `facturacion` en verde (sumados a los existentes); `tsc` sin
errores.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-004 — Backend: `lib/facturacion.ts` + rutas de simulación/listado/anulación (CA-4 sim, CA-5)

**Archivos:** `backend/src/lib/facturacion.ts`, `backend/src/index.ts`
**Hace:** Capa fina (sin lógica) para leer lecturas/tarifas/suscriptores por periodo y armar los
datos de entrada de `core/`; construir el `snapshot_suscriptor`; calcular la simulación (resumen
agregado + anomalías) SIN insertar; listar facturas de un periodo; detalle de una factura; anular una
factura con motivo. Rutas de plan.md §3: `POST /facturacion/periodos/:id/simular`,
`GET /facturacion/periodos/:id/facturas`, `GET /facturacion/simulaciones/:periodoId`,
`GET /facturas/:id`, `POST /facturas/:id/anular`. El cálculo económico SIEMPRE pasa por `core/`; si
la capa detecta `tarifa_vigente()` NULL devuelve la anomalía 9d sin emitir.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** `tsc`/`eslint` sin errores; Worker empaqueta. Cuando el entorno permita
`wrangler dev` + curl contra Supabase local, validar la simulación real (resumen + anomalías,
sin insertar); si no, "NO VERIFICADO" con pasos exactos.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)


## T-005 — Consumidor de Cloudflare Queues + modo emisión (CA-4 emisión)

**Archivos:** `backend/src/queues/cierre-facturacion.ts`, `backend/wrangler.facturacion.toml`,
`backend/src/index.ts` (ruta `POST /facturacion/periodos/:id/emitir`), `backend/wrangler.toml`
**Hace:** `POST /facturacion/periodos/:id/emitir` valida el gate (hay simulación de ese periodo y no
facturas emitidas de él) y encola UNA factura por suscriptor en `FACTURACION_COLA` (devuelve 202).
El consumidor `cierre-facturacion.ts` (función `queue(batch, env)`) recibe cada mensaje y emite esa
factura: resuelve tarifa/lecturas/snapshot, arma los renglones vía `core/`, asigna el número con
`SELECT FOR UPDATE` sobre `configuracion` (punto 9b, formato D-3) en una transacción, e inserta
`facturas` + `factura_detalles` + `factura_lecturas`. Si `tarifa_vigente()` es NULL registra la
anomalía (punto 9d) y NO emite. `wrangler.toml` declara el producer y el consumer de `FACTURACION_COLA`
(round-trip local verificado).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.facturacion.toml
# round-trip local real de Queues:
npx wrangler dev -c wrangler.toml --port 8787  &   # producer + rutas
npx wrangler dev -c wrangler.facturacion.toml --port 8788  &   # consumidor
curl -b cookies -X POST localhost:8787/facturacion/periodos/<id>/simular
curl -b cookies -X POST localhost:8787/facturacion/periodos/<id>/emitir   # → 202
psql "$DATABASE_URL" -c "select count(*) from facturas where periodo_id='<id>';"  # > 0
```
**Resultado esperado:** la emisión encola, el consumidor local emité las facturas (el log muestra
"CONSUMIDOR EJECUTADO" y el SELECT confirma los inserts); los `numero` son únicos y consecutivos; un
segundo `ciclo` del mismo suscriptor/periodo falla por `uq_factura_ciclo`. Si algún detalle del
binding impide el round-trip local en este contenedor, se declara "NO VERIFICADO" con pasos exactos.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-006 — Frontend: `lib/api.ts` + paneles de facturación (CA-6)

**Archivos:** `frontend/lib/api.ts`, `frontend/app/app/facturacion/page.tsx`,
`frontend/app/app/facturacion/[facturaId]/page.tsx`
**Hace:** Funciones de `api.ts` para simular/emitir/listar/anular/detalle de facturas (todo vía
backend Hono, nunca `@supabase/*` directo). Panel `/app/facturacion`: seleccionar el periodo cerrado
→ simular (resumen agregado + anomalías) → botón "Confirmar emisión" (solo si el periodo ya fue
simulado y no emitido) → listado de facturas; ruta de detalle por `facturaId`. Protegido por
middleware `/app/:path*`. La impresión/PDF es de 006, no aquí.
**Verificación:**
```bash
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** `build` compila las páginas nuevas y `lint` limpio. El flujo completo en
pantalla (simular → ver anomalías → emitir) queda "NO VERIFICADO — requiere validación manual de
Mateo" si no se corre con `next dev` + `wrangler dev` contra la base real; con pasos exactos.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-007 — Cierre: CHANGELOG + checklist CLAUDE.md §11

**Archivos:** `CHANGELOG.md`, `specs/005-facturacion/spec.md` (checklist final §8)
**Hace:** Entrada de CHANGELOG (Sesión 012) resumiendo T-001 a T-006 y la checklist de
"Definición de terminado" de `spec.md §8` marcada con evidencia real. Queda documentado el pendiente
de Cloudflare (despliegue real, cola remota) para Mateo.
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint . && npm test
npx wrangler deploy --dry-run -c wrangler.toml && npx wrangler deploy --dry-run -c wrangler.facturacion.toml
cd frontend && npm run build && npm run lint
# re-correr los 5 tests de aislamiento sobre el estado final
for f in 001_fundacion 002_catalogo 003_suscriptores 004_lecturas_consumo 005_facturacion; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/${f}_aislamiento.sql
done
```
**Resultado esperado:** builds/tests en verde y los 5 tests de aislamiento en verde sobre el mismo
estado final; evidencia pegada en el CHANGELOG y en esta tarea.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

