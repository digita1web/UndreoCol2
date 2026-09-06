# TASKS — 011: dashboard-de-indicadores

**Spec aprobado:** 2026-09-05 (spec.md en commit `4d7efd3`)
**Plan aprobado:** 2026-09-05 (plan.md en commit `c12d500`)

Una tarea = un commit. Sin evidencia no hay commit (CLAUDE.md §4 y §9). Nunca `git push`.

---

## Notas de entorno y prerrequisitos

- **Sin migraciones**: esta feature es de solo lectura (spec §4, plan §2). No se toca el esquema.
- **Supabase local real vía Docker** disponible (misma base persistente de la sesión 024 de 010, con su
  rastro permanente de pruebas). La base ya está migrada 001-012.
- **`wrangler dev` + `next dev` + curl/Playwright real son viables** en este entorno (verificado en las
  sesiones 023/024); la integración se verifica contra servidores reales.
- **Regresión obligatoria en cada tarea que toque `backend/src/`**: `npx vitest run` completo (suite
  entera, no solo el archivo tocado). En cada tarea con frontend: `npm run build` + `npm run lint`.
- **Regresión de aislamiento**: se esperan los fallos de conteo preexistentes documentados en el spec
  §0.5 y el CHANGELOG Sesión 024 (005/006/007/008/010 pueden fallar por conteo, no por RLS). Se
  reportan diferenciados de una fuga real; nunca se marcan como éxito sin verificar que no es fuga.
- **IDs de clientes/profiles de los fixtures 001-010**: cliente A `a0000000-…-0001`, admin de A
  `…a1`; cliente B `b0000000-…-0001`, admin de B `…b1` (patrón de las suites previas).
- **Fixture `tests/fixtures/dashboard.sql`** usa fechas relativas a `current_date` para pagos (D-6) y
  periodos cerrados con `anio` fijo lejano (2099) para el consumo promedio — así nunca colisionan con
  filas existentes ni se salen del eje de 12 meses con el tiempo.
- Orden de dependencia: T-001 (lib) bloquea T-002 (ruta). T-003 necesita la ruta (T-002) y el fixture
  propio para el curl CA-1…CA-6. T-004 usa el fixture y las consultas de T-001. T-005 depende de T-002
  (endpoint) y T-003 (datos). T-006 cierra.

---

## T-001 — `lib/dashboard.ts` (helpers puros + acceso a datos) y sus unit tests

**Archivos:** `backend/src/lib/dashboard.ts` (crear), `backend/tests/unit/dashboard.test.ts` (crear)
**Hace:** (plan §4) helpers puros `hoyUtc()`, `limitesConsultaTendencia()`, `armarEjeTendencia()`,
`armarTendencia()`, `resumirCartera()`; y `obtenerIndicadores(supabase, clienteId)` que reutiliza
`obtenerCartera()` (007) y consulta `pagos` (rango del eje, `anulado = false`), `periodos` (último
cerrado), `facturas` (consumo del periodo) y `usuarios_servicio` (4 conteos por estado). Sin cambios
de esquema y sin tocar `core/`.
**Verificación:**
```bash
cd backend
npx vitest run tests/unit/dashboard.test.ts   # helpers: eje 12 meses, cruce de año, cero-fill,
                                              # recaudoMes del mes actual, resumirCartera
npx vitest run                                # suite completa (116 existentes + nuevas)
npm run build && npm run lint                 # tsc --noEmit y eslint limpios
```
**Resultado esperado:** tests nuevos en verde; suite completa en verde; `tsc` y `lint` EXIT=0.
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí>
```
**Commit:** `<hash tras completar>`

---

## T-002 — Ruta `GET /dashboard/indicadores` con 403 explícito (`ctx.rol`)

**Archivos:** `backend/src/index.ts` (editar)
**Hace:** (plan §3) `requerirClienteActivo()` incluye `rol` en `ctx` (campo aditivo, retrocompatible);
nueva ruta `GET /dashboard/indicadores` que devuelve `200 { indicadores }` solo si `ctx.rol ===
'admin_acueducto'`, `403 { error: 'Solo el administrador del acueducto puede ver los indicadores' }`
para roles sin permiso, `401` sin sesión y `400 'Sin acueducto'` sin membresía activa. `GET /dashboard`
(001) no se toca.
**Verificación:**
```bash
cd backend
npm run build && npm run lint
npx wrangler deploy --dry-run -c wrangler.toml
npx vitest run
# curl contra wrangler dev + Supabase local:
# 1. sin cookie → 401
# 2. sesión de admin de A → 200 con { indicadores: { fecha, recaudoMes, carteraPendiente,
#    carteraVencida, usuariosEnMora, consumoPromedioUltimoPeriodo, tendencia[12], suscriptoresPorEstado } }
# 3. sesión de un miembro con rol no-admin (lector de A; sembrarlo si no existe, patrón de
#    tests/fixtures/fundacion.sql) → 403 con el error exacto
```
**Resultado esperado:** 401/403/200 con la forma del payload del plan §3 (los valores numéricos
exactos se validan en T-003 con el fixture).
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí>
```
**Commit:** `<hash tras completar>`

## T-003 — Fixture determinista `tests/fixtures/dashboard.sql` + integración CA-1…CA-6

**Archivos:** `tests/fixtures/dashboard.sql` (crear)
**Hace:** (plan §1/§8, D-6) siembra para cliente A y cliente B con **fechas relativas a
`current_date`**:
- **Pagos de A** (valores conocidos): 2 vigentes en el mes en curso (CA-1), un **anulado** en el mes en
  curso, un vigente del **mes anterior** (cuenta en la tendencia, no en `recaudoMes`), pagos en meses
  previos dentro del eje (incluido el bucket más antiguo del eje y un **mes vacío** dentro del eje), y
  un **pago fuera del eje** (no debe aparecer en la tendencia).
- **Pagos de B**: suficientes para verificar que no contaminan ningún indicador de A (CA-6).
- **Suscriptores de A** en los 4 estados (activo/suspendido/cortado/inactivo) para CA-5.
- **Facturas con saldo de A** para cartera (CA-2): una `vencida` y una `por vencer` (por
  `fecha_vencimiento` pasada/futura), `tipo = 'ciclo'`, números únicos, evitando `uq_factura_ciclo`.
- **Dos periodos `cerrado` de A con `anio` fijo 2099** (meses 1 y 2) y facturas `ciclo` con
  `consumo_m3` conocidos (CA-3: promedio sobre 2099-02, el de mayor `(anio, mes)`).
El fixture inserta como owner (patrón de fixtures 001-010) y no borra nada.
**Verificación:** tras aplicar el fixture contra Supabase local, correr `wrangler dev` y validar
CA-1…CA-6 por curl con **contraste SQL** (psql):
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/dashboard.sql
# curl admin de A → recaudoMes, carteraPendiente/Vencida, usuariosEnMora, consumoPromedio,
#   tendencia[12] y suscriptoresPorEstado iguales al SQL de contraste (sumas por mes de fecha_pago,
#   Σ saldos por fecha_vencimiento, avg(consumo_m3) de 2099-02, GROUP BY estado); el pago fuera del
#   eje no aparece en la tendencia
# curl admin de B → solo datos de B (CA-6 HTTP); curl lector de A → 403 (regresión de T-002)
```
**Resultado esperado:** fixture EXIT=0; valores del endpoint 1:1 con el SQL de contraste; pagos
anulados y de B excluidos de los indicadores de A; lector → 403.
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí — curl y SQL>
```
**Commit:** `<hash tras completar>`


## T-004 — Test de aislamiento `tests/aislamiento/011_dashboard_aislamiento.sql`

**Archivos:** `tests/aislamiento/011_dashboard_aislamiento.sql` (crear)
**Hace:** (spec CA-6, plan §8) bajo la sesión del admin de A (`set local role authenticated` +
`request.jwt.claim.sub` de `…a1`), ejecuta las mismas consultas de indicadores (pagos no anulados por
rango, cartera, último periodo cerrado + facturas de consumo, conteos por estado) y verifica que solo
ve filas de A: los agregados de A no cambian cuando existen filas de B. Incluye regresión de permisos
(rol `lector` de A no inserta) y termina en `DASHBOARD-AISLAMIENTO OK`. Reutiliza el fixture de T-003
o siembra sus propias filas en transacciones (patrón de suites 001-010).
**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/011_dashboard_aislamiento.sql
# y regresión de las suites previas (001-012), con la salida completa pegada
```
**Resultado esperado:** `DASHBOARD-AISLAMIENTO OK`; regresión reportada con los fallos de conteo
preexistentes (spec §0.5) diferenciados de una fuga real (una fuga real NO cierra la tarea).
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí>
```
**Commit:** `<hash tras completar>`

---

## T-005 — Frontend: bloque de indicadores y estado "No autorizado"

**Archivos:** `frontend/components/indicadores-dashboard.tsx` (crear),
`frontend/app/app/dashboard/page.tsx` (editar)
**Hace:** (spec §3.6, plan §1) componente presentacional sin hooks (tarjetas con formato COP `es-CO`,
consumo promedio en m³ con "—" cuando es `null`, gráfico de barras de 12 meses en CSS puro, conteos
por estado y vínculos a `/app/pagos` y `/app/suscriptores`); la página server component mantiene el
fetch del encabezado (GET /dashboard) y, según `cliente.rol`: si no es `admin_acueducto` renderiza el
estado **"No autorizado"** con enlace a `/app/lecturas` (sin llamar a indicadores); si lo es, llama a
`GET /dashboard/indicadores` reenviando la cookie re-codificada (patrón del fix Sesión 023) y
renderiza el bloque.
**Verificación:**
```bash
cd frontend && npm run build && npm run lint
# Playwright (Chromium real) contra wrangler dev + next dev + Supabase local:
# 1. admin de A → encabezado + tarjetas con los valores del fixture (CA-1…CA-5), gráfico de 12 barras,
#    vínculos a /app/pagos y /app/suscriptores
# 2. cliente sin periodos cerrados → tarjeta de consumo "—"
# 3. lector de A → /app/dashboard muestra "No autorizado" y NINGÚN indicador
# Si el entorno no permite correr ambos procesos → NO VERIFICADO con los pasos exactos para Mateo
```
**Resultado esperado:** build/lint limpios; la UI muestra los KPIs correctos, el gráfico y el estado
"No autorizado" para el lector.
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí>
```
**Commit:** `<hash tras completar>`

---

## T-006 — Cierre: CHANGELOG, checklist del spec y verificación final

**Archivos:** `CHANGELOG.md` (editar), `specs/011-dashboard/tasks.md` (editar — Estados, evidencias y
commits de T-001…T-005)
**Hace:** entrada de Sesión (025) en el CHANGELOG con lo construido, evidencia y hashes por tarea;
revisión del checklist del spec §8 (Definición de terminado) con salidas reales.
**Verificación:**
```bash
cd backend && npx vitest run && npm run build && npm run lint
cd backend && npx wrangler deploy --dry-run -c wrangler.toml
cd frontend && npm run build && npm run lint
git log --oneline | head -8   # un commit por T-001…T-005 más este de cierre
```
**Resultado esperado:** suite y builds en verde; checklist del spec §8 completo; git log con un commit
por tarea verificada. Se entrega el comando de push a Mateo (nunca se ejecuta aquí).
**Estado:** Pendiente
**Evidencia:**
```
<se pega la salida real aquí>
```
**Commit:** `<hash tras completar>`

