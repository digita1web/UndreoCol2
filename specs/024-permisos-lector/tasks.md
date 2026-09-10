# TASKS — 024: permisos-lector

**Plan aprobado:** 2026-09-10

Una tarea = un commit. Sin evidencia no hay commit.

## T-001 — Migración: elimina 10 políticas de lectura sobre-amplias + función `usuarios_servicio_lector`
**Archivos:** `supabase/migrations/20260921090000_permisos-lector.sql`
**Hace:** `drop policy` de las 10 `_lectura` (facturas, factura_detalles, pagos,
pago_aplicaciones, tarifas, configuracion, cortes_reconexiones, notificaciones,
importaciones_suscriptores, reemplazos_contador, usuarios_servicio); crea
`usuarios_servicio_lector(p_cliente_id, p_estado)`.
**Verificación:**
```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260921090000_permisos-lector.sql
-- lector de A: 0 filas en las 10 tablas
-- admin_acueducto de A: mismos conteos que antes (regresión)
-- usuarios_servicio_lector(cliente A) desde lector: filas de A, 5 columnas
```
**Estado:** Hecho
**Evidencia:**
```
Aplicada contra Postgres 17 descartable, desde cero, junto a las otras 20 migraciones — sin error.

Lector de A (jwt sub a2): facturas=0, factura_detalles=0, pagos=0, pago_aplicaciones=0, tarifas=0,
configuracion=0, cortes_reconexiones=0, notificaciones=0, importaciones_suscriptores=0,
reemplazos_contador=0, usuarios_servicio=0  (11/11 en cero)

Admin de A (jwt sub a1), regresión — mismos conteos que antes de 024:
  facturas=9, pagos=8, tarifas=1, configuracion=1, usuarios_servicio=6

usuarios_servicio_lector('cliente A') desde lector de A: 6 filas, solo
  {id, codigo_suscriptor, nombre, contador_actual_id, estado} — sin PII
usuarios_servicio_lector('cliente B') desde lector de A: 0 filas (aislamiento intacto)

Aplicada también con `supabase migration up --local --yes` sobre el Supabase local con fixtures.
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-002 — Backend: `listarSuscriptores` usa la RPC para `lector`
**Archivos:** `backend/src/lib/suscriptores.ts`, `backend/src/index.ts`
**Hace:** `listarSuscriptores(supabase, clienteId, estado?, soloLector?)`: si `soloLector`, llama
`usuarios_servicio_lector` en vez de `.from('usuarios_servicio')`, mapea a la forma `Suscriptor`
con los campos sensibles en `null`. `GET /suscriptores` pasa `ctx.rol === 'lector'`.
**Verificación:** `cd backend && npx tsc --noEmit && npx vitest run`
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit   → sin errores
$ npx vitest run     → 215 passed (20 archivos)
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-003 — Backend: guard de rol en las 4 rutas de facturación por cola
**Archivos:** `backend/src/index.ts`
**Hace:** `POST /facturacion/periodos/:id/simular`, `.../emitir`, `.../enviar-correo`, `POST
/facturas/:id/enviar-correo`: `if (ctx.rol !== 'admin_acueducto') return c.json({error:...}, 403)`,
mismo patrón que `GET /dashboard/indicadores`.
**Verificación:** `cd backend && npx tsc --noEmit && npx vitest run && npx wrangler deploy --dry-run`
**Estado:** Hecho
**Evidencia:**
```
$ npx tsc --noEmit               → sin errores
$ npx vitest run                 → 215 passed
$ npx wrangler deploy --dry-run  → EXIT=0

Contra wrangler dev real, con sesiones reales de admin-a@test.local y lector-a@test.local:
  POST /facturacion/periodos/:id/emitir        (lector) -> 403  <- el hallazgo más grave (M-2b)
  POST /facturacion/periodos/:id/simular       (lector) -> 403
  POST /facturacion/periodos/:id/enviar-correo (lector) -> 403
  POST /facturas/:id/enviar-correo             (lector) -> 403
  POST /facturacion/periodos/:id/simular       (admin)  -> 200  (regresión: sigue funcionando)
  GET  /suscriptores (lector) -> solo 5 campos reales (id, codigo_suscriptor, nombre, estado,
       contador_actual_id); numero_documento/telefono/email/direccion/notas en null
  GET  /suscriptores (admin)  -> los 15 campos completos, sin cambios
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-004 — Test de aislamiento 014
**Archivos:** `tests/aislamiento/014_permisos_lector_aislamiento.sql`
**Hace:** los 4 pasos de plan.md §8, contra PostgreSQL real, con la prueba de que el test SIRVE
(relajar algo a propósito, ver caer el paso, restaurar).
**Verificación:** `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/014_permisos_lector_aislamiento.sql`
**Estado:** Hecho (con una corrección no prevista, ver abajo)
**Evidencia:**
```
014: PERMISOS-LECTOR-AISLAMIENTO OK (4 pasos, incluida la prueba de que SIRVE: se restauró a
propósito facturas_lectura, el PASO 1 cayó con el mensaje exacto esperado, se restauró y volvió
a pasar).

Regresión completa (18 suites, entorno limpio desde cero, reproducida dos veces en contenedores
Postgres 17 nuevos): 4 suites viejas (005, 006, 007, 011) tenían su propio "PASO 4: el lector LEE
X pero no escribe" — aserciones correctas ANTES de 024, ahora obsoletas a propósito porque 024
le quita esa lectura. Se corrigieron las 4 (lector ahora espera 0 facturas/notificaciones/pagos,
no 1/1/2/>=1) — no es una regresión real, es actualizar aserciones que verificaban el
comportamiento viejo que esta misma feature cambia.

18/18 OK tras la corrección, reproducido en 2 contenedores nuevos y contra el Supabase local.
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-005 — Verificación de integración real (wrangler dev + next dev)
**Archivos:** ninguno (solo verificación)
**Hace:** confirma con sesiones reales (`admin-a@test.local`, y un `lector` real de A) que: `GET
/suscriptores` con lector devuelve solo 5 campos; las 4 rutas de facturación dan `403` a lector y
funcionan igual para admin; `/app/lecturas` arma su desplegable igual que antes.
**Verificación:** curl real contra `wrangler dev` + carga real de `/app/lecturas` contra `next dev`.
**Estado:** Hecho
**Evidencia:**
```
GET /app/lecturas (next dev, sesión real de lector) -> HTTP 200
GET /periodos (wrangler dev, lector)    -> 200, periodo real devuelto (sin cambios, no tocado)
GET /suscriptores (wrangler dev, lector) -> 6 suscriptores, con contador_actual_id/nombre/
  codigo_suscriptor intactos (A-001 - Suscriptor A1 - contador c0000000-...-0a1) — exactamente
  los 3 campos que /app/lecturas usa para armar el desplegable (CA-4 confirmado).
```
**Commit:** se registra en la Bitácora de cierre (T-006)

## T-006 — Cierre: PLAN-PRODUCCION.md, CHANGELOG, regresión completa
**Archivos:** `docs/PLAN-PRODUCCION.md`, `CHANGELOG.md`
**Hace:** marca M-2 y M-2b resueltos con su evidencia; entrada de CHANGELOG; corre la definición de
"terminado" completa (spec §8).
**Verificación:**
```
cd backend && npm test && npx wrangler deploy --dry-run
cd frontend && npm run build && npm run lint
psql "$DATABASE_URL" -f (las 18 suites de aislamiento, regresión completa)
```
**Estado:** Hecho
**Evidencia:**
```
$ npm test                        → 215 passed (20 archivos)
$ npx wrangler deploy --dry-run   → EXIT=0
$ npm run build (frontend)        → 18/18 páginas, sin errores
$ npm run lint (frontend)         → ESLint: No issues found
18/18 suites de aislamiento en verde, reproducido dos veces en Postgres 17 descartables desde
cero, y contra el Supabase local persistente.
docs/PLAN-PRODUCCION.md: M-2 y M-2b marcados RESUELTO con su evidencia y el hash del commit.
CHANGELOG.md: Sesión 038.
```
**Commit:** este commit (cierre)

## Bitácora de cierre

| Tarea | Commit | Estado |
|---|---|---|
| T-001 migración: 10 DROP POLICY + usuarios_servicio_lector() | `f5b2953` | COMPLETADO |
| T-002 listarSuscriptores usa la vista mínima para el lector | `24ca2f5` | COMPLETADO |
| T-003 guard de rol en 4 rutas de facturación por cola (M-2b) | `1e767b6` | COMPLETADO |
| T-004 test de aislamiento 014 + corrección de 4 suites obsoletas | `277f869` | COMPLETADO |
| T-005 verificación de integración real | `cabe256` | COMPLETADO |
| T-006 cierre | este commit | COMPLETADO |

### Checklist de `CLAUDE.md §11`

- [x] Hace lo que dice el spec, ni más ni menos — alcance ampliado explícitamente con Mateo en el
      checkpoint de `/specify` (M-2b), no por iniciativa propia
- [x] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [x] `npx wrangler deploy --dry-run` (backend) exitoso
- [x] `npm run lint` limpio en ambos proyectos
- [x] Tests de la tarea en verde, con la salida pegada — 215/215 backend, build/lint frontend
- [x] Migración versionada + test de aislamiento en verde —
      `20260921090000_permisos-lector.sql`, `tests/aislamiento/014`, verificado que el test SIRVE
- [x] Si toca `core/`: no aplica — sin lógica de negocio nueva (plan §4)
- [x] Evidencia pegada en la conversación y en este documento
- [x] `CHANGELOG.md` actualizado (Sesión 038)
- [x] Commit hecho por tarea verificada; sin `push` salvo autorización expresa (§9.1)

### Desviaciones respecto del plan, todas señaladas en su commit

1. **Alcance ampliado antes de `/plan`:** una segunda auditoría (pedida explícitamente por Mateo)
   encontró 4 tablas más sin revisar (mismo patrón) y M-2b (emisión de facturas sin guard,
   más grave que M-2). El spec se actualizó y se re-presentó para aprobación antes de continuar.
2. **T-004:** la regresión completa reveló 4 suites de aislamiento viejas (005, 006, 007, 011) con
   aserciones que verificaban el comportamiento ANTERIOR a esta feature ("el lector lee X") —
   corregidas para reflejar el comportamiento nuevo, no es una regresión real.
