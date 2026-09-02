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
y del "usuario sin lectura" como anomalía). **NO cierra el periodo A** (el test de aislamiento 004
asume que está abierto; cerrarlo rompería la regresión). Test de aislamiento cubriendo: A no
lee/escribe facturas de B; solo `admin_acueducto` escribe/anula; el `lector` lee pero no escribe; un
`numero` duplicado del cliente y un segundo `ciclo` del mismo `(usuario_servicio, periodo)` violan
sus unique; el trigger de inmutabilidad (trg_factura_inmutable) bloquea editar/borrar y exige motivo
para anular (el INSERT de emisión está permitido); `total_pagado > total` es rechazado. Regresión de
001–004 sobre el mismo estado final en verde.
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
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
$ psql ... -f tests/fixtures/facturacion.sql  → COMMIT (factura FAC-2026-00001 + 1 detalle)
$ psql ... -f tests/aislamiento/005_facturacion_aislamiento.sql
  → FACTURACION-AISLAMIENTO OK  (8 pasos)

Regresión sobre el mismo estado final:
  001_fundacion_aislamiento.sql       → FUNDACION-AISLAMIENTO OK
  002_catalogo_aislamiento.sql        → CATALOGO-AISLAMIENTO OK
  003_suscriptores_aislamiento.sql    → SUSCRIPTORES-AISLAMIENTO OK
  004_lecturas_consumo_aislamiento.sql → LECTURAS-CONSUMO-AISLAMIENTO OK
  005_facturacion_aislamiento.sql     → FACTURACION-AISLAMIENTO OK

El fixture deja la factura de A1 en el periodo A (que permanece ABIERTO). HALLAZGO REAL:
en la primera versión el fixture cerraba el periodo A, y eso ROMPIÓ la regresión de 004
(004 PASO 4 asume el periodo A abierto: un segundo periodo abierto debe violar
uq_periodo_abierto). Corregido: el fixture ya no cierra el periodo A — los fixtures de
features posteriores no mutan el estado que los tests de features previas asumen.
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
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
$ npm test  (backend)
  ✓ tests/unit/tarifas.test.ts (8 tests)
  ✓ tests/unit/consumo.test.ts (22 tests)
  ✓ tests/unit/facturacion.test.ts (19 tests)   <-- nuevo, CA-3
  ✓ tests/unit/monitor-db.test.ts (6 tests)
  Test Files  4 passed (4) · Tests 55 passed (55)

$ npx tsc --noEmit → sin salida (sin errores)
$ npx eslint src/core/facturacion.ts tests/unit/facturacion.test.ts → sin salida

facturacion.test.ts (19 tests) cubre: armarRenglones (mismo consumo para todos
los servicios activos, servicios sin tarifa ignorados, límite D-1 exacto/±1, fijo);
calcularRecargoMora (0/porcentaje 0/2%→2000/2%→200); componerTotal (con y sin
saldo); componerNumeroFactura (formato 5 dígitos, prefijo FAC/REC, reinicio anual);
clasificarAnomaliasFacturacion (sano/sin lectura/atípica/sin tarifa/total<=0/
variación>20% y <=20%).
```
**Commit:** (tras completar)

## T-004 — Backend: `lib/facturacion.ts` + rutas de simulación/listado/anulación (CA-4 sim, CA-5)

**Archivos:** `backend/src/lib/facturacion.ts`, `backend/src/index.ts`
**Hace:** Capa fina (sin lógica) para leer lecturas/tarifas/suscriptores por periodo y armar los
datos de entrada de `core/`; construir el `snapshot_suscriptor`; calcular la simulación (resumen
agregado + anomalías) SIN insertar; listar facturas de un periodo; detalle de una factura; anular una
factura con motivo. Rutas de plan.md §3: `POST /facturacion/periodos/:id/simular`,
`GET /facturacion/periodos/:id/facturas`, `GET /facturas/:id`, `POST /facturas/:id/anular`. El
cálculo económico SIEMPRE pasa por `core/`; si la capa detecta `tarifa_vigente()` NULL devuelve la
anomalía 9d sin emitir. **Corrección de alcance:** NO se implementó `GET /facturacion/simulaciones/:periodoId`
del plan — la simulación no persiste (spec §3.3 "nada se inserta"); el gate de la emisión es de UI +
defensa en backend (rechazar si el periodo ya tiene facturas).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint .
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** `tsc`/`eslint` sin errores; Worker empaqueta. Cuando el entorno permita
`wrangler dev` + curl contra Supabase local, validar la simulación real (resumen + anomalías,
sin insertar); si no, "NO VERIFICADO" con pasos exactos.
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
$ npx tsc --noEmit  → sin salida
$ npx eslint .     → sin salida
$ npx wrangler deploy --dry-run -c wrangler.toml
  Total Upload: 826.48 KiB / gzip: 163.19 KiB · --dry-run: exiting now.

Integración HTTP real (wrangler dev :8787 + Supabase local, curl con --noproxy '*'):
  POST /facturacion/periodos/e0000000-...0a1/simular  → 200
    resumen: totalSuscriptores=2, suscriptoresConFactura=1, consumoTotalM3=25,
             facturacionTotal=38600 (A1: cargo 5000 + 22*1200 básico + 3*2400 no básico)
    anomalías de A2 (estrato_2, sin tarifa ni lectura): usuario_sin_lectura,
             sin_tarifa (regla 9d) y total_cero_o_negativo
  count(facturas) antes/después → 1 (la del fixture) → la simulación NO insertó ✔
  GET /facturacion/periodos/:id/facturas → 200 (lista la factura FAC-2026-00001)
  POST /facturas/:id/anular sin motivo → 400 "El motivo de anulación es obligatorio"
  POST /facturas/:id/anular con motivo → 200 (factura anulada)

HALLAZGO de entorno: http_proxy/https_proxy sin NO_PROXY hacen que curl y el fetch del
Worker pasen por el proxy y den 502 a 127.0.0.1. Solución usada en TODA esta sesión:
curl con --noproxy '*' y wrangler dev lanzado con env -u http_proxy etc.
```
**Commit:** (tras completar)


## T-005 — Consumidor de Cloudflare Queues + modo emisión (CA-4 emisión)

**Archivos:** `backend/src/queues/cierre-facturacion.ts`, `backend/src/index.ts` (ruta
`POST /facturacion/periodos/:id/emitir` + export `{fetch, queue}`), `backend/src/lib/db.ts` (binding
`FACTURACION_COLA` + tipo `MensajeFacturaCierre`), `backend/wrangler.toml` (producer+consumer de
`undreocol-facturacion`), `supabase/migrations/20260905090000_facturacion.sql` (función
`siguiente_numero_factura` añadida)
**Hace:** `POST /facturacion/periodos/:id/emitir` rechaza si el periodo ya tiene facturas (defensa de
no duplicar; el gate de "se simuló" es de UI) y encola UNA factura por suscriptor en `FACTURACION_COLA`
(202). El consumidor `cierre-facturacion.ts` (handler `queue(batch, env)`) emite cada factura:
resuelve tarifa/lecturas/snapshot, arma renglones vía `core/`, asigna el número con la RPC
`siguiente_numero_factura()` (`SELECT FOR UPDATE` sobre `configuracion`, puntos 9b/9c, formato D-3),
e inserta `facturas` + `factura_detalles` + `factura_lecturas`. Sin tarifa (9d) aborta el mensaje.
**Corrección de arquitectura:** no se usó `wrangler.facturacion.toml` separado del plan — un Worker de
Cloudflare puede ser a la vez HTTP y consumidor de cola; el mismo `wrangler.toml` declara producer+
consumer (round-trip local verificado en plan.md §0 con UN worker).
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
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
$ npx tsc --noEmit → sin salida · $ npx eslint → sin salida
$ npx wrangler deploy --dry-run -c wrangler.toml
  env.FACTURACION_COLA (undreocol-facturacion) Queue · Total Upload: 834.27 KiB · sin errores

Round-trip local REAL de Cloudflare Queues (wrangler dev :8787, producer+consumer del mismo worker):
  base con fixtures 001-004 SIN el fixture facturacion (periodo A sin facturas)
  POST /facturacion/periodos/e0000000-...0a1/emitir → 202 {"encoladas":1,"omitidas":1}
    (encola A1 que tiene lectura+tarifa; omite A2 por 9d/sin lectura)
  Log del consumidor local:  "cierre-facturacion: factura FAC-2026-00001 emitida"
  SELECT facturas → FAC-2026-00001 | total=38600.00 | estado=pendiente
  SELECT factura_detalles → 1 (renglón de acueducto)
  SELECT configuracion.consecutivo_factura → 1 (número atómico, punto 9b)
  Re-emitir el mismo periodo → 409 "El periodo ya tiene facturas emitidas (no se duplica)"

Corrección de arquitectura: se usó el MISMO worker (wrangler.toml con producer+consumer) en vez del
wrangler.facturacion.toml separado — un Worker puede ser HTTP + consumidor de cola, y es lo que se
verificó en /plan. La migración facturacion ganó la función siguiente_numero_factura() (RPC con
SELECT FOR UPDATE, grant a service_role/authenticated).
```
**Commit:** (tras completar)

## T-006 — Frontend: `lib/api.ts` + paneles de facturación (CA-6)

**Archivos:** `frontend/lib/api.ts`, `frontend/app/app/facturacion/page.tsx`,
`frontend/app/app/facturacion/[facturaId]/page.tsx`
**Hace:** Funciones de `api.ts` para simular/emitir/listar/anular/detalle de facturas (todo vía
backend Hono, nunca `@supabase/*` directo). Panel `/app/facturacion`: seleccionar un periodo
→ simular (resumen agregado + anomalías) → botón "Confirmar emisión" (solo tras simular) →
listado de facturas; ruta de detalle por `facturaId`. Protegido por
middleware `/app/:path*`. La impresión/PDF es de 006, no aquí.
**Verificación:**
```bash
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** `build` compila las páginas nuevas y `lint` limpio. El flujo completo en
pantalla (simular → ver anomalías → emitir) queda "NO VERIFICADO — requiere validación manual de
Mateo" si no se corre con `next dev` + `wrangler dev` contra la base real; con pasos exactos.
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
$ npm run build  (frontend)
  ✓ Compiled successfully · ✓ Generating static pages (12/12)
  incluye /app/facturacion (2.86 kB) y /app/facturacion/[facturaId] (2.59 kB)
$ npm run lint → LINT=0 (sin salida)

api.ts: tipos Factura/DetalleFactura/ResumenSimulacion/Anomalia + funciones
simularPeriodo/emitirPeriodo/listarFacturasDePeriodo/obtenerFactura/anularFactura.
Paneles: /app/facturacion (simular → resumen+anomalías → confirmar emisión →
listado de facturas) y /app/facturacion/[facturaId] (datos + desglose + anular con
motivo). La emisión y la anulación ya fueron validadas contra la API real en
T-004/T-005; el build/lint confirman el render. Flujo click-a-click en navegador
(simular → emitir) NO VERIFICADO — requiere next dev + wrangler dev (pasos en el
cuerpo de esta tarea); la impresión/PDF es de 006.
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
**Estado:** Completado (2026-09-05)
**Evidencia:**
```
backend: $ npx tsc --noEmit → sin salida · $ npx eslint . → sin salida
         $ npm test → 4 files / 55 tests OK (incluye 19 de facturacion.ts)
         $ npx wrangler deploy --dry-run -c wrangler.toml
            Total Upload: 834.27 KiB / gzip: 164.69 KiB · --dry-run: exiting now.
frontend: $ npm run build → ✓ Compiled successfully · ✓ Generating static pages (12/12)
                              incluye /app/facturacion y /app/facturacion/[facturaId]
          $ npm run lint → LINT=0

Aislamiento (estado final, Supabase local 17.6):
  001_fundacion_aislamiento.sql       → FUNDACION-AISLAMIENTO OK
  002_catalogo_aislamiento.sql        → CATALOGO-AISLAMIENTO OK
  003_suscriptores_aislamiento.sql    → SUSCRIPTORES-AISLAMIENTO OK
  004_lecturas_consumo_aislamiento.sql → LECTURAS-CONSUMO-AISLAMIENTO OK
  005_facturacion_aislamiento.sql     → FACTURACION-AISLAMIENTO OK

CHANGELOG.md actualizado (Sesión 012) y checklist de spec.md §8 marcada con evidencia real,
incluidos los pendientes de Mateo (despliegue a Cloudflare de la cola, flujo click-a-click).
```
**Commit:** (tras completar)

