# TASKS — 007: pagos-y-cartera

**Spec aprobado:** 2026-09-07 (spec.md commit `fae4457`)
**Plan aprobado:** 2026-09-07 (plan.md commit `9c0dcce`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Entorno:** Supabase local real (CLI 2.116.0, PostgreSQL 17.6) + Docker. La base se reconstruye
  con `supabase db reset --local` (001→007 migraciones) y se cargan los fixtures 001-007 antes de
  cada paso que lo requiera. `http_proxy` sin NO_PROXY da 502 a 127.0.0.1 → usar
  `curl --noproxy '*'` y lanzar `wrangler dev` con `env -u http_proxy -u https_proxy`.
- **Estado del trigger de facturas (005+corrección 006):** `bloquear_factura_inmutable` ya permite el
  UPDATE que cambia SOLO `pdf_url` (006), `total_pagado` y/o `estado` (007); el recálculo del cierre
  sigue intacto (GUC). La RPC de 007 debe actualizar esas columnas sin tocar valores económicos.
- **RLS + RPCs:** el registro/anulación de pagos va por **RPC `SECURITY INVOKER`** (patrón
  `crear_tarifa_version`/`reemplazar_contador`): `revoke` anon/public + `grant` authenticated. El
  Worker llama `supabase.rpc('registrar_pago'|'anular_pago', {...})` con el JWT del admin. Las RPC
  rechazan al no-admin y a facturas de otro cliente (mensajes legibles).
- **Sin colas ni dependencias nuevas** (decisión del plan §5/§6): cada pago es una transacción por
  request; cartera/historiales son consultas de lectura.
- **Orden de verificación (plan.md §8):** migración + fixtures + aislamiento (CA-1/CA-2) →
  `core/pagos.ts` + unit (CA-3/CA-4/CA-5 lógica pura) → `lib/pagos.ts` + rutas + curl/wrangler dev
  (CA-3 a CA-7) → frontend (CA-8) → cierre.

---

## T-001 — Migración: `metodo_pago` + `pagos` + `pago_aplicaciones` + RPCs (CA-1)

**Archivos:** `supabase/migrations/20260907090000_pagos.sql`
**Hace:** (plan.md §2) `create type metodo_pago`
(`efectivo`,`transferencia`,`consignacion`,`pse`,`otro`); tabla `pagos` (FK `usuarios_servicio`
RESTRICT, `recibido_por` → `perfiles`, check `valor > 0`, `anulado`/`motivo_anulacion`, `created_at`)
y `pago_aplicaciones` (`pago_id` CASCADE, `factura_id` RESTRICT, check `valor > 0`, unique
`(pago_id, factura_id)`), con sus índices; trigger `trg_pago_aplicacion_valida` (BEFORE INSERT OR
UPDATE: pago del mismo cliente no anulado, factura del mismo cliente/suscriptor no anulada, valor no
supera el saldo vivo de la factura, suma de aplicaciones no supera el valor del pago); RLS `FORCE` +
políticas (lectura miembros/plataforma; escritura `es_admin_de`); RPCs transaccionales `SECURITY
INVOKER` `registrar_pago(...)` y `anular_pago(...)` (plan §2; `SELECT FOR UPDATE` de las facturas
candidatas, distribución más antigua primero, remanente, `total_pagado`/estado derivado, reversión
recalculando desde pagos vigentes); `revoke`/`grant` de ejecución.
**Verificación:**
```bash
supabase db reset --local
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
\d pagos
\d pago_aplicaciones
select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='metodo_pago';
select tgname from pg_trigger where tgrelid='pago_aplicaciones'::regclass and not tgisinternal;
SQL
```
**Resultado esperado:** reset 001→007 desde cero; tablas/enum/trigger existen; un INSERT que viola
cada check/regla del trigger se rechaza con mensaje claro.
**Estado:** Completado (2026-09-07)
**Evidencia:**
```
$ supabase db reset --local → Finished (001→007 migraciones aplicadas desde cero)
  tablas: pagos, pago_aplicaciones · enum metodo_pago: efectivo,transferencia,consignacion,pse,otro
  trigger trg_pago_aplicacion_valida (BEFORE INSERT OR UPDATE) · RLS FORCE en ambas tablas
  RPCs: registrar_pago, anular_pago (SECURITY INVOKER; revoke anon/public + grant authenticated)

Smoke contra Supabase local real (checks/trigger, como postgres, transacción rollback):
  P1 OK  abono a factura de OTRO suscriptor → rechazado
  P2 OK  suma de abonos > valor del pago → rechazado
  P3 OK  abono > saldo vivo de la factura → rechazado
  P4 OK  pago con valor <= 0 → rechazado (check de tabla)
  P5 OK  abono a factura anulada → rechazado
  P6 OK  mismo pago abonando 2 veces la misma factura → rechazado (unique)

Smoke de RPCs (rol authenticated + jwt del admin A; transacción rollback):
  R1 OK  pago total 38600 → factura pagada, total_pagado=38600, remanente 0
  R2 OK  anular sin motivo → rechazado
  R3 OK  anular con motivo → revierte a pendiente con total_pagado 0
  R4 OK  pago parcial 10000 → pendiente con total_pagado 10000
  R5 OK  segundo pago 28600 → factura pagada (dos pagos)
  R6 OK  anular el 2.º pago → reversión RECALCULADA: quedó pendiente con 10000 (NO 0)
  R7 OK  pago 40000 con abono 38600 → remanente 1400 a favor del suscriptor (regla 14)
  R8 OK  suma de abonos > valor del pago → rechazada por la RPC
  R9 OK  el lector no registra pagos → rechazado

DESVIACIÓN TÉCNICA vs plan.md §2 (documentada en la cabecera de la migración):
registrar_pago recibe p_aplicaciones jsonb calculadas por core/pagos.ts (CLAUDE §5.3: el
dinero se calcula en core/) en vez de distribuir en SQL; la RPC valida con FOR UPDATE y
aplica. Comportamiento observable del spec idéntico. Se corrigió en el camino: (a)
parámetros con default antes que recibido_por (42P13) → reordenados; (b) CASE del update de
anular_pago necesitaba cast a estado_factura (columna enum).
```
**Commit:** (tras completar)

## T-002 — Fixtures `pagos.sql` + aislamiento `007_` (CA-2)

**Archivos:** `tests/fixtures/pagos.sql`, `tests/aislamiento/007_pagos_aislamiento.sql`
**Hace:** Fixture sobre el estado de 001-006 (cliente A: factura `ciclo` FAC-2026-00001 total 38.600
de A1 del fixture 005; cliente B sin facturas): registra pagos directos sobre esa factura SIN crear
facturas nuevas (regla: los fixtures posteriores no mutan el estado que los tests previos asumen) —
deja un **abono parcial de 10.000** (factura pendiente con saldo 28.600) y un **pago a favor sin
aplicar de 2.000** (saldo a favor, regla 14) con `recibido_por` = admin A. La factura vencida para
CA-6 la crea la verificación de integración (T-004). Test de aislamiento (CA-2, patrón 001-006): A no
lee/escribe pagos de B; el admin de A registra y anula pagos de su cliente vía RPC; el `lector` lee
pagos de su cliente pero no escribe (INSERT y RPC rechazados); RPC con factura de otro
cliente rechazada; aplicar a factura anulada rechazado; anular sin motivo rechazado. Regresión
001-006 en verde sobre el mismo estado final.
**Verificación:**
```bash
# tras el reset + fixtures 001-006 de T-001
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/pagos.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/007_pagos_aislamiento.sql
for f in 001_fundacion 002_catalogo 003_suscriptores 004_lecturas_consumo 005_facturacion 006_correo_factura; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/${f}_aislamiento.sql
done
```
**Resultado esperado:** `PAGOS-AISLAMIENTO OK` y los 6 previos en verde sobre el mismo estado final.
**Estado:** Completado (2026-09-07)
**Evidencia:**
```
Fixtures 001-007 (fundacion..pagos) cargados sobre la base recién reseteada (001→007):
  cada fixture termina con COMMIT (0 errores).

$ tests/aislamiento/007_pagos_aislamiento.sql → PAGOS-AISLAMIENTO OK
  PASO 1 tablas+FORCE+enum+trigger+RPCs · PASO 2 admin A ve 2 pagos propios, 0 de B;
  admin B ve 0 · PASO 3 admin A no inserta pagos de B (RLS) · PASO 4 el lector ve 2
  pagos pero no inserta ni usa la RPC · PASO 5 la RPC rechaza una factura del cliente B
  · PASO 6 anular sin motivo rechazado y con motivo revierte ff000000 a 0/pendiente ·
  PASO 7 la RPC rechaza pagar una factura anulada.

Regresión sobre el mismo estado final (fixtures 001-007):
  001_fundacion=1 OK · 002_catalogo=1 OK · 003_suscriptores=1 OK
  004_lecturas_consumo=1 OK · 005_facturacion=1 OK · 006_correo_factura=1 OK

NOTA DE DISEÑO (regla aprendida en 005): el fixture de pagos NO crea facturas nuevas
porque el aislamiento 005 espera UNA factura del cliente A; solo registra pagos sobre la
factura FAC-2026-00001 del fixture 005 (abono parcial 10.000 + pago a favor 2.000). La
factura vencida para CA-6 la crea la verificación de integración (T-004).
```
**Commit:** (tras completar)

## T-003 — `core/pagos.ts` + unit tests (CA-3/CA-4/CA-5 lógica pura)

**Archivos:** `backend/src/core/pagos.ts`, `backend/tests/unit/pagos.test.ts`
**Hace:** `core/pagos.ts` con las firmas del plan §4: `redondearPeso` (regla única del peso);
`distribuirPago` (más antigua primero; `facturasSeleccionadas` null = todas las candidatas, si vienen
primero esas y el sobrante sigue a las demás; nunca abona más del saldo de una factura; devuelve
`aplicaciones` + `remanente`); `calcularEstadoTrasPago` (`pagada` solo con saldo cubierto). Unit
tests de los casos límite del plan §8.
**Verificación:**
```bash
cd backend && npm test 2>&1 | tail -6
npx tsc --noEmit && npx eslint src/core/pagos.ts tests/unit/pagos.test.ts
```
**Resultado esperado:** tests de pagos en verde (remanente incluido) y `npm test` total sin romper.
**Estado:** Completado (2026-09-07)
**Evidencia:**
```
$ npx vitest run tests/unit/pagos.test.ts → 15 passed (redondearPeso, distribuirPago 11,
  calcularEstadoTrasPago 2)
$ npm test → 7 files / 80 tests OK (65 previos + 15 de pagos)
$ npx tsc --noEmit → sin salida · $ npx eslint → sin salida
```
**Commit:** (tras completar)

## T-004 — `lib/pagos.ts` + rutas Hono + verificación curl (CA-3 a CA-7)

**Archivos:** `backend/src/lib/pagos.ts`, `backend/src/index.ts`
**Hace:** `lib/pagos.ts`: `registrarPago(supabase, clienteId, input)` y `anularPago(supabase,
clienteId, pagoId, motivo, perfilId)` que llaman las RPC `registrar_pago`/`anular_pago` y devuelven
su jsonb; `obtenerCartera(supabase, clienteId, filtros)` (por suscriptor con deuda: por vencer /
vencida derivada por fecha con días de mora / total adeudado / saldo a favor / estado del suscriptor);
`obtenerPagosDeFactura` y `obtenerPagosDeSuscriptor` (aplicaciones con fecha, método, referencia,
quién registró y si el pago está anulado). Rutas en `index.ts` (plan §3): `POST /pagos` (201),
`POST /pagos/:id/anular` (400 sin motivo), `GET /cartera`, `GET /facturas/:id/pagos`,
`GET /suscriptores/:id/pagos`. Validación y redondeo del body con `core/pagos.ts` (nunca dinero en la
ruta).
**Verificación:**
```bash
# con wrangler dev (:8787, env sin proxy) + Supabase local con fixtures 001-007 + usuario admin A
curl -sS --noproxy '*' -b cookie -X POST localhost:8787/pagos -H 'Content-Type: application/json' \
  -d '{"usuario_servicio_id":"d0000000-0000-0000-0000-0000000000a1","valor":38600,"metodo":"efectivo"}' \
  -w '\nHTTP %{http_code}\n'
curl ... /pagos/<id>/anular -d '{"motivo":"error de caja"}'
curl ... /cartera?solo_morosos=true
curl ... /facturas/:id/pagos
curl ... /suscriptores/:id/pagos
psql "$DATABASE_URL" -c "select numero,estado,total_pagado from facturas ..."
```
**Resultado esperado:** pago total → factura `pagada` con `total_pagado = total`; parcial → sigue
`pendiente` con `total_pagado` crecido; pago mayor a la deuda → remanente a favor visible en cartera;
anulación con motivo revierte (recalculado) y sin motivo → 400; cartera deriva `vencida` por fecha;
historiales muestran las aplicaciones; `tsc`/`eslint`/`wrangler deploy --dry-run` limpios.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-005 — Frontend: cartera, registro/anulación de pagos e historiales (CA-8)

**Archivos:** `frontend/lib/api.ts`, `frontend/app/app/pagos/page.tsx` (crear),
`frontend/app/app/facturacion/[facturaId]/page.tsx` (editar),
`frontend/app/app/pagos/[suscriptorId]/page.tsx` (crear)
**Hace:** `api.ts`: tipos `Pago`/`AplicacionPago`/`FilaCartera` + funciones `registrarPago`,
`anularPago`, `obtenerCartera`, `obtenerPagosDeFactura`, `obtenerPagosDeSuscriptor`. Página
`/app/pagos`: cartera del acueducto por suscriptor (por vencer / vencida con días de mora / total /
saldo a favor) con botón registrar pago (método, valor, referencia, fecha, observaciones) y enlace al
historial del suscriptor. Detalle de factura: bloque de pagos aplicados (historial) + registrar pago +
anular pago con motivo. Página `/app/pagos/[suscriptorId]`: historial del suscriptor (pagos vigentes y
anulados con aplicaciones y saldo a favor).
**Verificación:**
```bash
cd frontend && npm run build && npm run lint && npx tsc --noEmit
```
**Resultado esperado:** build/lint/tsc limpios (páginas nuevas y las de facturación compilan). El
flujo click-a-click queda NO VERIFICADO si el entorno no permite `next dev` + `wrangler dev`
(validación de Mateo con pasos exactos; la API ya quedó verificada en T-004 vía curl).
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)

## T-006 — Cierre: CHANGELOG + checklist CLAUDE.md §11

**Archivos:** `CHANGELOG.md`, `specs/007-pagos-y-cartera/spec.md` (checklist §8)
**Hace:** Entrada de CHANGELOG (Sesión 014) y checklist de `spec.md §8` con evidencia real. Queda
documentado el pendiente de Mateo (flujo click-a-click; la lógica de pagos/cartera quedó verificada
por SQL/RPC + curl contra Supabase local).
**Verificación:**
```bash
cd backend && npx tsc --noEmit && npx eslint . && npm test
npx wrangler deploy --dry-run -c wrangler.toml
cd frontend && npm run build && npm run lint
for f in 001_fundacion 002_catalogo 003_suscriptores 004_lecturas_consumo 005_facturacion 006_correo_factura 007_pagos; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/${f}_aislamiento.sql
done
```
**Resultado esperado:** builds/tests/aislamientos en verde sobre el estado final; evidencia pegada.
**Estado:** Pendiente
**Evidencia:**
```

```
**Commit:** (tras completar)
