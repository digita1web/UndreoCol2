# TASKS — 023: personalizacion-factura

**Plan aprobado:** 2026-09-09

Una tarea = un commit. Sin evidencia no hay commit.

## T-001 — Migración: columna, RLS por fila y por columna, función del portal
**Archivos:** `supabase/migrations/20260920090000_personalizacion-factura.sql`
**Hace:** agrega `clientes.color_acento` (default `#14408C`, `CHECK` de formato hex); política
`clientes_color_acento` (`UPDATE`, `es_admin_de(id)`); `revoke update on clientes from
authenticated` + `grant update (color_acento)`; `create or replace function
portal_factura_completa(...)` con `color_acento` en el bloque `acueducto`.
**Verificación:**
```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260920090000_personalizacion-factura.sql
psql "$DATABASE_URL" -c "select color_acento from clientes limit 3;"
psql "$DATABASE_URL" -c "select has_column_privilege('authenticated','clientes','color_acento','UPDATE') as puede_color, has_column_privilege('authenticated','clientes','plan_id','UPDATE') as puede_plan;"
```
**Resultado esperado:** migración aplica sin error; `color_acento` = `#14408C` en filas existentes;
`puede_color = t`, `puede_plan = f`.
**Estado:** Hecho
**Evidencia:**
```
Aplicada contra Postgres 17 (imagen Supabase) descartable, desde cero, junto a las otras 19
migraciones — sin error.

INSERT (sin especificar color_acento) → color_acento = '#14408C'

has_column_privilege: puede_color=t puede_plan=f puede_estado=f puede_slug=f

INSERT con color_acento = 'rojo':
  ERROR: new row for relation "clientes" violates check constraint "clientes_color_acento_check"

portal_factura_completa: prosrc contiene 'color_acento' → t

Aplicada también con `supabase migration up --local --yes` sobre el Supabase local con fixtures:
  clientes.color_acento = '#14408C' en las filas existentes (Acueducto A, Acueducto B)
  puede_color=t puede_plan=f (mismo resultado)
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-002 — `core/color.ts`: validación y conversión, con tests
**Archivos:** `backend/src/core/color.ts`, `backend/src/core/color.test.ts`
**Hace:** `esColorHexValido` y `hexARgb01`, puras, sin dependencias.
**Verificación:** `cd backend && npx vitest run color`
**Resultado esperado:** todos los casos en verde, incluido que `hexARgb01('#14408C')` da
`{r:0.0784…, g:0.2510…, b:0.5490…}` (ida y vuelta contra el `rgb(0.08,0.25,0.55)` actual, con la
tolerancia de redondeo de 8 bits por canal — CA-1).
**Estado:** Hecho
**Evidencia:**
```
 RUN  v2.1.9 /home/oem/Desktop/UndreoCol2/backend
 ✓ src/core/color.test.ts (7 tests) 9ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-003 — `factura-pdf.ts` usa el color del acueducto
**Archivos:** `backend/src/lib/factura-pdf.ts`, `backend/src/lib/factura-pdf.test.ts`
**Hace:** `DatosAcueductoPdf.colorAcento: string`; `colorAcento` fijo se reemplaza por
`hexARgb01(acueducto.colorAcento)`. Test nuevo: dos colores distintos → bytes de PDF distintos.
**Verificación:** `cd backend && npx vitest run factura-pdf`
**Resultado esperado:** tests existentes siguen en verde + el caso nuevo pasa.
**Estado:** Hecho
**Evidencia:**
```
 ✓ tests/unit/factura-pdf.test.ts (6 tests) 232ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```
Nota: hasta T-004/T-005 el resto del proyecto (index.ts, lib/portal.ts) todavía no compila del
todo con TypeScript estricto porque `DatosAcueductoPdf.colorAcento` pasó a ser obligatorio — es
esperado en este punto intermedio; T-005 lo cierra y ahí se corre `tsc`/`wrangler deploy --dry-run`
sobre el proyecto completo.
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-004 — `lib/portal.ts` y `queues/cierre-facturacion.ts` propagan el color
**Archivos:** `backend/src/lib/portal.ts`, `backend/src/queues/cierre-facturacion.ts`
**Hace:** el mapeo de `completa.acueducto` a `DatosAcueductoPdf` incluye `colorAcento` desde
`color_acento` (ya presente en el JSON de `portal_factura_completa` tras T-001).
**Desviación del plan (encontrada con `tsc --noEmit`, no en el plan original):**
`queues/cierre-facturacion.ts` es un TERCER lugar que arma `DatosAcueductoPdf` (el envío por
correo del cierre masivo, 006) — el plan solo listaba `lib/portal.ts` e `index.ts`. Mismo ajuste
mecánico (agregar `color_acento` al `.select()` y al objeto), sin cambiar comportamiento ni
alcance — se corrige aquí en vez de abrir una tarea aparte.
**Verificación:** `cd backend && npx tsc --noEmit && npx vitest run cierre-facturacion`
**Resultado esperado:** el único error de tipos restante es en `index.ts` (T-005, ya esperado);
tests de `cierre-facturacion` en verde.
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit
src/index.ts(1093,13): error TS2741: Property 'colorAcento' is missing... (esperado, T-005)

$ npx vitest run cierre-facturacion
 ✓ tests/unit/cierre-facturacion-tenant.test.ts (5 tests) 9ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-005 — Rutas `GET /acueducto` y `PATCH /acueducto/color`
**Archivos:** `backend/src/index.ts`
**Hace:** `GET /acueducto` (cualquier rol del cliente, vía `requerirClienteActivo`) devuelve datos
de solo lectura + `color_acento`; `PATCH /acueducto/color` exige `ctx.rol === 'admin_acueducto'`
(403 explícito si no, mismo patrón que `GET /dashboard/indicadores`), valida con
`esColorHexValido` antes de tocar la base (400 si inválido). Las rutas `GET /facturas/:id/pdf` y
`GET /portal/facturas/:id/pdf` agregan `color_acento` a la selección/objeto que ya arman.
**Verificación:**
```
cd backend && npx vitest run
npx wrangler dev --port 8787 &  # + curl real: GET/PATCH /acueducto con sesión admin_acueducto y con lector
```
**Resultado esperado:** 206+ tests unitarios en verde; con `lector`, `PATCH /acueducto/color` → 403;
con `admin_acueducto` y un hex inválido → 400; con hex válido → 200 y el cambio persiste
(`GET /acueducto` posterior lo confirma).
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit        → sin errores (antes: 1 en index.ts, ya corregido)
$ npx vitest run          → 215 passed (20 archivos, antes 206 + 9 nuevos de esta feature)
$ npx wrangler deploy --dry-run → Total Upload: 1762.91 KiB / gzip: 400.73 KiB, EXIT=0

Contra wrangler dev real (puerto 8787), con sesiones reales:
  GET  /acueducto (admin_acueducto)         -> 200, colorAcento="#14408C"
  GET  /acueducto (lector)                  -> 200, mismo dato (lectura permitida a cualquier rol)
  PATCH /acueducto/color (lector)           -> 403 "Solo el administrador..."
  PATCH /acueducto/color (admin, "rojo")    -> 400 "color_acento debe ser un hexadecimal #RRGGBB"
  PATCH /acueducto/color (admin, "#FF0000") -> 200; GET posterior confirma colorAcento="#FF0000"

  Intento de colar slug/plan_id en el mismo PATCH (body con
  {color_acento, slug:"hackeado", plan_id:null}):
    -> 200 (la ruta solo lee color_acento del body, el resto se ignora)
    -> verificado en la base: slug sigue "acueducto-a", plan_id sin cambios,
       solo color_acento cambió — defensa a nivel de código, además del
       GRANT de columna en la base (probado aparte en T-006)

Color del fixture restaurado a #14408C después de la prueba.
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-006 — Test de aislamiento 013
**Archivos:** `tests/aislamiento/013_personalizacion_factura_aislamiento.sql`
**Hace:** contra PostgreSQL real: (1) admin de A cambia el color de A → OK; (2) admin de A
intenta cambiar el color de B → 0 filas; (3) admin de A intenta, en la misma actualización,
tocar `plan_id`/`estado_cuenta`/`slug` de su propia fila → falla por el `GRANT` de columna;
(4) `lector` de A intenta `UPDATE` sobre `color_acento` de A → falla.
**Verificación:** `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/013_personalizacion_factura_aislamiento.sql`
**Resultado esperado:** los 4 pasos verifican lo esperado (incluida la prueba de que el test SIRVE:
se relaja algo a propósito y el paso correspondiente cae, luego se restaura).
**Estado:** Hecho (5 pasos — se agregó un PASO 5 de control: confirma que la política
`clientes_color_acento` existe exactamente como se espera, no una variante más laxa)
**Evidencia:**
```
$ psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/013_personalizacion_factura_aislamiento.sql
...
PERSONALIZACION-FACTURA-AISLAMIENTO OK

Prueba de que el test SIRVE: se relajó el grant a propósito
  (grant update on clientes to authenticated, sin restricción de columna)
  -> PASO 3 FALLÓ: se pudo tocar plan_id junto con color_acento  (el test SÍ detecta el hueco)
Se restauró el grant correcto (revoke update / grant update (color_acento))
  -> PERSONALIZACION-FACTURA-AISLAMIENTO OK de nuevo, los 5 pasos en verde
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-007 — Frontend: cliente de la API (`lib/api.ts`)
**Archivos:** `frontend/lib/api.ts`
**Hace:** tipo `Acueducto`, `obtenerAcueducto()`, `actualizarColorAcentoAcueducto(hex: string)`.
**Verificación:** `cd frontend && npx tsc --noEmit`
**Resultado esperado:** sin errores de tipos.
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit
(sin salida — sin errores)
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-008 — Frontend: pantalla `/app/configuracion`
**Archivos:** `frontend/app/app/configuracion/page.tsx`
**Hace:** datos de solo lectura del acueducto + `<input type="color">` para `color_acento` con
vista previa en vivo (mismo layout del encabezado de la factura); `useHidratado()` en el submit
(CLAUDE.md §7); si la API responde 403 (rol `lector`), muestra "No autorizado" explícito, mismo
patrón que `/app/dashboard`.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Resultado esperado:** build y lint limpios, sin warnings de TypeScript.
**Estado:** Pendiente
**Evidencia:**
```
(se pega al ejecutar)
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-009 — Frontend: encabezado del acueducto en la vista de impresión
**Archivos:** `frontend/app/app/facturacion/[facturaId]/page.tsx`
**Hace:** llama a `obtenerAcueducto()`; agrega el encabezado (logo si existe, nombre, NIT,
municipio, teléfono, dirección) con el color de acento en el nombre y en el TOTAL — cierra CA-8 (el
hueco de 006). El resto de la vista no cambia de color.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Resultado esperado:** build y lint limpios; verificación manual con `wrangler dev` + `next dev`
(como en la sesión de portal de punta a punta): `GET /app/facturacion/:id` con sesión real muestra
el encabezado.
**Estado:** Pendiente
**Evidencia:**
```
(se pega al ejecutar)
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-010 — Frontend: enlace desde el dashboard
**Archivos:** `frontend/app/app/dashboard/page.tsx`
**Hace:** enlace a `/app/configuracion`, condicionado a `datos.cliente.rol === 'admin_acueducto'`
(mismo bloque donde ya está el enlace a `/app/lecturas`) — el `lector` no lo ve.
**Verificación:** `cd frontend && npm run build && npm run lint`
**Resultado esperado:** limpio; verificación manual: con sesión de `lector`, el enlace no aparece.
**Estado:** Pendiente
**Evidencia:**
```
(se pega al ejecutar)
```
**Commit:** se registra en la Bitácora de cierre (T-011)

## T-011 — Cierre: CHANGELOG y verificación final completa
**Archivos:** `CHANGELOG.md`
**Hace:** entrada de la sesión con lo implementado y su evidencia; corre la definición de
"terminado" completa del spec (§8).
**Verificación:**
```
cd backend && npm test && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
```
**Resultado esperado:** todo en verde, sin warnings.
**Estado:** Pendiente
**Evidencia:**
```
(se pega al ejecutar)
```
**Commit:** se registra en la Bitácora de cierre (T-011)
