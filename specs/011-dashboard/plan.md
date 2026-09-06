# PLAN — 011: dashboard-de-indicadores

**Spec aprobado:** 2026-09-05 (spec.md en commit `4d7efd3`; decisiones §0.2/§0.3/§0.4 confirmadas por
Mateo)
**Estado:** Borrador para aprobación — pendiente de `/tasks`.

---

## 0. Punto de partida (verificado leyendo el código real)

Reutilizado sin tocar:
- **`GET /dashboard`** (`backend/src/index.ts:234`) — encabezado actual `{ cliente { clienteId, rol,
  nombre }, perfil, conteoUsuariosServicio }`. El rol del miembro ya viaja en `activo.rol`
  (`lib/tenant.ts`). **No se modifica este contrato** (001): el encabezado sigue siendo útil para
  cualquier miembro y para el fix de cookie (Sesión 023).
- **`obtenerCartera(supabase, clienteId, filtros)`** (`backend/src/lib/pagos.ts:136`) — devuelve
  `FilaCartera[]` (`porVencer`, `vencida`, `diasMoraMax`, `totalAdeudado`, `saldoFavor`, `estado`…)
  para el acueducto, respetando RLS. Es la fuente ÚNICA de cartera/mora (spec §3.2/§3.3).
- **Reloj canónico UTC en JS**: el formulario de pago fija `fecha_pago` con
  `new Date().toISOString().slice(0,10)` (`frontend/components/pago-form.tsx:32`) y `obtenerCartera()`
  deriva su "hoy" igual (UTC). El dashboard usa **el mismo reloj** para no divergir del módulo de
  pagos (decisión D-1).
- **RLS FORCE + `cliente_id`**: `pagos`, `facturas`, `periodos`, `usuarios_servicio` ya tienen
  políticas del patrón 001 (lectura para miembros del cliente). No se toca esquema ni RLS (spec §4:
  feature de solo lectura, sin migración).
- **`requerirClienteActivo()`** (`backend/src/index.ts:269`) resuelve sesión + acueducto activo y hoy
  descarta el `rol`; se extiende para incluirlo (D-3).
- Patrón de server component de `/app/dashboard`: reenvía la cookie `uc_sesion_admin` re-codificada con
  `encodeURIComponent` (CHANGELOG Sesión 023). El fetch nuevo de indicadores replica ese mismo patrón.

**Confirmado en el repo (no asumido):** no existe ninguna ruta ni función de "indicadores" previa;
`/app/dashboard/page.tsx` solo muestra el encabezado. El proyecto no tiene dependencia de gráficos
(`frontend/package.json`): solo Tailwind + shadcn/ui (`Card`, `Input`, etc.).

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `backend/src/lib/dashboard.ts` | crear | Capa fina de solo lectura que arma el payload de indicadores: consultas a `pagos`/`periodos`/`facturas`/`usuarios_servicio` (todas con `cliente_id` de la sesión, RLS), reutiliza `obtenerCartera()` de 007, y exporta **helpers puros** (`armarTendencia`, `resumirCartera`, `limitesConsultaTendencia`) unit-testeados |
| `backend/src/index.ts` | editar | `requerirClienteActivo()` devuelve también `rol` en `ctx`; nueva ruta `GET /dashboard/indicadores` (200 solo para `admin_acueducto`, **403** para roles sin permiso) |
| `frontend/app/app/dashboard/page.tsx` | editar | Server component: mantiene el fetch del encabezado (GET /dashboard), decide por `cliente.rol`: si no es `admin_acueducto` renderiza el estado **"No autorizado"** (sin llamar a indicadores); si lo es, fetches GET /dashboard/indicadores y renderiza el bloque |
| `frontend/components/indicadores-dashboard.tsx` | crear | Componente presentacional (sin hooks, usable desde server component): tarjetas numéricas, gráfico de barras de 12 meses en **CSS puro** (sin dependencia), conteos por estado, formateo COP/m³ con `Intl('es-CO')` |
| `backend/tests/unit/dashboard.test.ts` | crear | Unit tests de los helpers puros de `lib/dashboard.ts` (eje de 12 meses, cruce de año, cero-fill, resumen de cartera) |
| `tests/fixtures/dashboard.sql` | crear | Datos deterministas para CA-1…CA-6 con **fechas relativas a `current_date`**: pagos en el mes en curso/anterior/meses previos (incluido bucket fuera del eje), un pago anulado, dos periodos cerrados con facturas `ciclo` de consumos conocidos para A **y** B, suscriptores de A en los 4 estados |
| `tests/aislamiento/011_dashboard_aislamiento.sql` | crear | Aislamiento multi-tenant de las consultas de indicadores (patrón 001-010) + regresión 001-010/012 |

Sin migraciones. Sin cambios de esquema, RLS ni `docs/esquema-propuesto.sql` (no hay DDL nuevo).

## 2. Esquema de base de datos

### Migraciones
Ninguna. `docs/ESPECIFICACION-FUNCIONAL.md §2.15` y el spec 011 §4 fijan esta feature como de solo
lectura; las consultas corren sobre el esquema existente (001/004/005/007).

### Tablas y políticas RLS
No hay tablas, enums, columnas, índices ni políticas nuevas. Las consultas del dashboard heredan las
políticas `FORCE` existentes de `pagos`, `pago_aplicaciones`, `facturas`, `periodos`,
`usuarios_servicio` (patrón 001-010): cada lectura se hace con el cliente Supabase creado con el JWT
del usuario autenticado y filtrada por `cliente_id` de la sesión (nunca `service_role`).

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| GET | `/dashboard` | Sesión admin + acueducto activo (cualquier rol) | **Sin cambios** — encabezado actual (001) |
| GET | `/dashboard/indicadores` | Sesión admin + acueducto activo + **rol `admin_acueducto`** | Payload completo de indicadores (spec §3.1-§3.5/§3.7). Respuestas: `200 { indicadores }`; `401` sin sesión; `400 { error: 'Sin acueducto' }` sin membresía activa; **`403 { error: 'Solo el administrador del acueducto puede ver los indicadores' }`** para roles sin permiso (decisión §0.4: 403 explícito, no datos vacíos ni 200 parcial) |

La ruta reutiliza `requerirClienteActivo()` (ahora con `ctx.rol`) y delega todo el armado en
`obtenerIndicadores(ctx.supabase, ctx.clienteId)` (`lib/dashboard.ts`). Cualquier error de datos se
devuelve como `400 { error }` con el mensaje de la capa (mismo estilo que `GET /cartera`).

### Contrato del payload (observable, spec §6)

```jsonc
{
  "indicadores": {
    "fecha": "2026-09-05",                     // "hoy" UTC del Worker (mismo reloj de 007)
    "recaudoMes": 350000,                        // COP enteros — suma de pagos vigentes del mes en curso
    "carteraPendiente": 120000,                  // COP enteros — Σ porVencer de obtenerCartera()
    "carteraVencida": 300000,                    // COP enteros — Σ vencida de obtenerCartera()
    "usuariosEnMora": 4,                         // filas de cartera con vencida > 0
    "consumoPromedioUltimoPeriodo": 21.5,        // m³, 1 decimal, o null si no hay periodo cerrado
    "tendencia": [                               // SIEMPRE 12 buckets, cronológico, mes actual inclusive
      { "anio": 2025, "mes": 10, "total": 0 },   // meses sin pagos en 0 (no se omiten)
      { "anio": 2026, "mes": 9, "total": 350000 }
    ],
    "suscriptoresPorEstado": {
      "activo": 12, "suspendido": 1, "cortado": 2, "inactivo": 0   // los 4, incluso en 0
    }
  }
}
```

## 4. Contratos de la capa de datos (sin `core/`)

No se toca `core/`: esta feature no calcula dinero (solo agrega valores ya persistidos por 005/007,
regla `CLAUDE.md §5.3` y spec §5). La agregación read-model vive en `lib/`, mismo patrón que
`obtenerCartera()` de 007.

```ts
// backend/src/lib/dashboard.ts

export interface PagoPlano { fechaPago: string; valor: number }
export interface TendenciaMes { anio: number; mes: number; total: number } // mes 1..12
export type EstadoSuscriptorKey = 'activo' | 'suspendido' | 'cortado' | 'inactivo';

export interface IndicadoresDashboard {
  fecha: string;                              // hoyIso (UTC)
  recaudoMes: number;                         // pesos enteros
  carteraPendiente: number;                   // pesos enteros
  carteraVencida: number;                     // pesos enteros
  usuariosEnMora: number;
  consumoPromedioUltimoPeriodo: number | null; // m³ con 1 decimal; null sin periodo cerrado
  tendencia: TendenciaMes[];                   // 12 buckets asc; mes actual inclusive
  suscriptoresPorEstado: Record<EstadoSuscriptorKey, number>;
}

// --- helpers puros (exportados, unit-testeados) ----------------------------

/** Fecha de hoy en el reloj UTC del módulo de pagos (mismo `toISOString().slice(0,10)` de 007). */
export function hoyUtc(ahora?: Date): string;

/** Primer día del mes que abre el eje de 12 meses y último día del mes actual (límites de consulta). */
export function limitesConsultaTendencia(hoyIso: string): { desde: string; hasta: string };

/** 12 buckets mes-año cronológicos terminando en el mes de `hoyIso`, totales en 0. */
export function armarEjeTendencia(hoyIso: string): TendenciaMes[];

/** Asigna pagos a su bucket por mes de `fechaPago`, suma y cero-fill; devuelve eje completo + recaudo del mes actual. */
export function armarTendencia(hoyIso: string, filas: PagoPlano[]): { tendencia: TendenciaMes[]; recaudoMes: number };

/** Totales a partir de las filas de `obtenerCartera()` (fuente única de 007, spec §3.2/§3.3). */
export function resumirCartera(filas: import('./pagos').FilaCartera[]): {
  carteraPendiente: number; carteraVencida: number; usuariosEnMora: number;
};

// --- acceso a datos (solo lectura, cliente_id de la sesión, RLS) -----------

/** Endpoint completo. Consultas internas: */
export async function obtenerIndicadores(
  supabase: SupabaseClient, clienteId: string,
): Promise<IndicadoresDashboard>;
```

### Consultas internas de `obtenerIndicadores()` (todas `eq('cliente_id', clienteId)` + RLS)

1. **Recaudo/tendencia** — `pagos` con `anulado = false` y `fecha_pago` entre
   `limitesConsultaTendencia()` (`gte`/`lte`, límite de paginación 1000, mismo supuesto de 007).
   Se pasa por `armarTendencia(hoyIso, filas)`: `recaudoMes` es el bucket del mes de `hoyIso`
   (spec §3.1) y `tendencia` los 12 buckets (spec §3.4). Los pagos anulados se excluyen en SQL.
2. **Cartera y mora** — `obtenerCartera(supabase, clienteId)` (007, sin filtros) → `resumirCartera()`:
   `carteraPendiente = Σ porVencer`, `carteraVencida = Σ vencida`, `usuariosEnMora = filas con
   vencida > 0`. Nunca se recalcula un saldo por su cuenta.
3. **Consumo promedio** — `periodos` del cliente con `estado = 'cerrado'`, orden `anio desc, mes desc`,
   `limit 1` → `id`. Si existe: `facturas` con `periodo_id = id`, `tipo = 'ciclo'`,
   `estado <> 'anulada'`, seleccionando `consumo_m3`; promedio en TS redondeado a 1 decimal
   (spec §3.7). Sin periodo cerrado → `null`.
4. **Estados** — cuatro conteos (`count: 'exact', head: true`) sobre `usuarios_servicio` filtrando
   `estado` (los 4 valores del enum, incluidos los que den 0).


## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| **D-1 — Reloj UTC para "hoy"/mes en curso** (`hoyUtc()`, mismo `toISOString().slice(0,10)` de 007) | Reloj de Colombia (UTC-5) en el Worker | El formulario de pago ya persiste `fecha_pago` por defecto en UTC y `obtenerCartera()` clasifica `vencida` con la misma fecha UTC. Usar otro reloj crearía un desfase entre "mes actual" del dashboard y el mes en que 007 registra/clasifica pagos (p. ej. en las horas 19:00–23:59 de Colombia el día ya es el siguiente en UTC). El dashboard debe ser coherente con el módulo que produce el dato (spec §0.2). Riesgo residual documentado: el borde 00:00 UTC; los fixtures del CA usan fechas en días seguros del mes, no el borde |
| **D-2 — Endpoint separado `GET /dashboard/indicadores`** | Extender `GET /dashboard` con los indicadores | El contrato de 001 (`GET /dashboard`, encabezado) sirve a cualquier miembro y ya tiene consumidores y un fix de cookie asociado; mezclarle indicadores admin-only obligaría a devolver 403 rompiendo el encabezado del `lector`. Separar permite 403 explícito (decisión §0.4) sin tocar 001 |
| **D-3 — `requerirClienteActivo()` expone `ctx.rol`** | Duplicar `resolverClienteActivo()` dentro de la ruta | Cambio aditivo y retrocompatible (los callers actuales ignoran el campo nuevo); la ruta de indicadores valida `ctx.rol === 'admin_acueducto'` y responde 403. Sin este campo, el control de rol habría que repetir la resolución de membresía |
| **D-4 — Agregación read-model en `lib/dashboard.ts` (no en `core/`)** | Crear `core/dashboard.ts` | Esta feature no calcula dinero (no hay tarifa, recargo ni distribución): suma/promedia valores persistidos. Crear módulo en `core/` sugeriría reglas de negocio nuevas donde no las hay; el patrón de 007 (`obtenerCartera` agrega en `lib/`) es el precedente. Los helpers puros se exportan desde `lib/` y se unit-testean igual |
| **D-5 — Gráfico de 12 meses en CSS/Tailwind puro** | Añadir librería de gráficos (recharts, chart.js, nivo…) | Spec §3.4 exige un gráfico simple, estático, sin drill-down. El frontend no tiene ninguna dependencia de gráficos hoy; añadir una librería solo para 12 barras contradice el criterio de "algo ligero" del encargo y la regla de dependencias de `CLAUDE.md §2`. Las barras se dibujan con `div` + altura proporcional (accesibles con `role="img"`/etiqueta y `title`) |
| **D-6 — Datos de CA con fechas relativas a `current_date`** | Fechas fijas en el fixture | El eje de 12 meses depende de "hoy"; fechas fijas envejecerían fuera del eje y romperían CA-1/CA-4 al correrse en otra fecha. El fixture calcula las fechas en SQL sobre `current_date` (p. ej. `date_trunc('month', current_date)` = día 1 del mes en curso; mes anterior = primer día del mes − 1 día). El contraste SQL usa las mismas reglas. El residuo de filas en la base local se maneja igual que 010/012 (documentado; ver §0.5 del spec y §8) |
| **D-7 — Cero-fill y eje de 12 meses en TS puro** | `generate_series` + `LEFT JOIN` vía una RPC SQL | `generate_series` no es expresable con el builder de `supabase-js`; requeriría una función SQL nueva (cambio de esquema), prohibido por el spec §4 sin aprobación. El rango se acota en SQL y el armado de buckets es un helper puro con unit tests |

## 6. Dependencias nuevas

Ninguna. Backend no agrega paquetes (solo `@supabase/supabase-js` y `hono` ya presentes); frontend no
agrega paquetes (gráfico en CSS, D-5). Sin nuevas licencias que evaluar.


## 7. Límites de Cloudflare Workers a considerar

- **Cantidad de consultas por request**: `obtenerIndicadores()` hace ~11 consultas acotadas y
  paralelizables (1 de pagos del rango + 4 internas de `obtenerCartera()` de 007 + 1 de periodo
  cerrado + 1 de facturas del periodo + 4 conteos de estado en
  `Promise.all`). Son consultas por `cliente_id` con índices existentes (`facturas(cliente_id,estado)`,
  `pagos(cliente_id, fecha_pago desc)`, `periodos(cliente_id, estado)`,
  `usuarios_servicio(cliente_id,…)`), mismo perfil que el panel de cartera de 007 ya aprobado.
- **Tope de paginación 1000** (patrón de 007): aplica a la consulta de pagos del rango y a las facturas
  del periodo. Para el acueducto piloto (~1000 suscriptores) cabe; si en verificación real se alcanza
  el tope, se reporta como hallazgo (no se improvisa una consulta fuera del patrón en /implement).
- **Bundle**: solo se agrega `lib/dashboard.ts` (sin dependencias nuevas) → aumento marginal en los 3
  dry-run del backend (principal, `avisos-vencimiento`, `monitor-db`).
- **CPU/latencia**: sin bucles sobre miles de filas en el peor caso razonable; la agregación recorre
  solo las filas del rango de pagos. Sin procesamiento masivo en una invocación (regla 5.5 de 007).

## 8. Estrategia de pruebas

- **Unitarias (`backend/tests/unit/dashboard.test.ts`, `npx vitest run`)**: helpers puros de
  `lib/dashboard.ts` —
  - `armarEjeTendencia`/`armarTendencia`: 12 buckets cronológicos terminando en el mes de `hoyIso`;
    cruce de año (p. ej. `hoyIso = 2026-01-15` → eje feb-2025…ene-2026); meses sin pagos en `0`;
    `recaudoMes` = bucket del mes de hoy; un pago del mes anterior no cuenta en `recaudoMes` pero sí
    en su bucket de tendencia; un pago del mes actual con fecha posterior a hoy (mismo mes) sí cuenta.
  - `resumirCartera`: sumas `porVencer`/`vencida` y conteo de morosos con filas de ejemplo
    (incluido un suscriptor `cortado` con deuda vencida → cuenta como moroso; y uno con solo saldo a
    favor → no cuenta).
- **Aislamiento (RLS) — `tests/aislamiento/011_dashboard_aislamiento.sql`** contra Supabase local
  (patrón 001-010, psql con `ON_ERROR_STOP`, termina en `DASHBOARD-AISLAMIENTO OK`): bajo la sesión
  del admin de A (`set local role authenticated` + `request.jwt.claim.sub` de A1) las consultas de
  indicadores (pagos no anulados, cartera, periodo cerrado + facturas, conteos por estado) devuelven
  únicamente filas de A; las filas sembradas para B no alteran ningún agregado de A. Incluye además el
  control de que un rol `lector` de A no inserta (regresión de permisos) y la regresión de las suites
  previas 001-010/012. Los fallos de conteo preexistentes documentados en el spec §0.5 se reportan
  diferenciados de una fuga real.
- **Integración (curl contra `wrangler dev` + Supabase local)** tras aplicar `tests/fixtures/dashboard.sql`:
  - CA-1: `GET /dashboard/indicadores` con admin de A → `recaudoMes` coincide con el SQL de contraste
    (pagos no anulados del mes en curso); excluye el anulado del mes y el pago del mes anterior.
  - CA-2: `carteraPendiente`/`carteraVencida`/`usuariosEnMora` coinciden con `GET /cartera` del mismo
    momento (misma sesión) y con el SQL de contraste.
  - CA-3: dos periodos cerrados con consumos distintos → promedio del más reciente (`1` decimal);
    cliente sin periodos cerrados → `consumoPromedioUltimoPeriodo: null`.
  - CA-4: tendencia = 12 buckets cronológicos, mes sin pagos en `0`, valores = SQL agrupado por mes
    sobre el mismo rango.
  - CA-5: `suscriptoresPorEstado` con los 4 estados (incluido `inactivo: 0`) y suma = total del
    acueducto.
  - 403 explícito: sesión de un `lector` de A → `403 { error: 'Solo el administrador…' }`; sesión de
    admin de B → ve solo datos de B (CA-6 a nivel HTTP).
- **UI (CA-7)**: Playwright (Chromium real) contra `wrangler dev` + `next dev` + Supabase local:
  admin de A ve encabezado + tarjetas + gráfico de 12 barras + "—" sin periodo cerrado; un `lector` de
  A ve el estado "No autorizado" (sin indicadores); `npm run build`/`npm run lint`/`tsc` limpios.
  Si el entorno no permite correr ambos procesos, se declara NO VERIFICADO con los pasos exactos para
  Mateo (precedente CA-8 de 007).
- **Manual (requiere Mateo)**: ninguno previsto más allá del fallback de CA-7.

