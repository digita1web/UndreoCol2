# SPEC — 004: lecturas-y-consumo

**Estado:** Borrador para aprobación
**Depende de:** 003-suscriptores-contadores (tabla `contadores` con `capacidad_maxima`,
`usuarios_servicio.contador_actual_id`, tabla `reemplazos_contador` con
`lectura_final_anterior`/`lectura_inicial_nuevo`); 001-fundacion (tabla `configuracion` con los
umbrales `factor_consumo_alto`, `piso_consumo_alto_m3`, `factor_consumo_bajo`, `umbral_rollover_pct`;
RLS, funciones de seguridad).

## 1. Objetivo

Registrar la toma de lecturas de contador por periodo y calcular automáticamente el consumo en m³
aplicando las reglas de negocio de `CLAUDE.md §10` puntos 1–8: detección de rollover, rechazo de
lecturas inválidas (menor sin rollover, duplicada, fuera de orden cronológico, en periodo cerrado),
detección de anomalías (alto/bajo/cero — marcan, no bloquean), corte del consumo cuando hay un
reemplazo de contador a mitad de periodo (dato dispuesto por 003), e idempotencia por
`id_cliente_offline`. El **consumo calculado aquí — el número exacto en m³ — es la base que facturará
005**; por eso vive en `core/consumo.ts` (lógica pura, testeable), nunca en una ruta ni en SQL ad-hoc.

## 2. Por qué ahora

Según el roadmap (`.specify/config.md`), 004-lecturas-y-consumo depende de 003 (ya cerrada). 003
dejó expresamente preparados `contadores.capacidad_maxima` (techo de rollover), el historial de
`reemplazos_contador` (con `lectura_final_anterior` y `lectura_inicial_nuevo`) y los umbrales de
anomalía en `configuracion` — todo lo que 004 necesita para **calcular**. Sin este cálculo verificado
no hay número de consumo, y sin ese número la facturación (005) no tiene base. 004 es el primer
punto donde se toma una decisión aritmética sobre dinero real.

## 3. Alcance

### 3.1 Periodo de facturación (`periodos`)
- Tabla nueva `periodos` (de `docs/esquema-propuesto.sql §8`): `anio`, `mes`, `nombre`,
  `fecha_inicio`, `fecha_fin`, `fecha_vencimiento`, `estado` (`abierto`/`cerrado`),
  `fecha_cierre`, `cerrado_por`, único `(cliente_id, anio, mes)`.
- **Un solo periodo `abierto` por acueducto** — índice único parcial `uq_periodo_abierto`
  (`CLAUDE.md §10` punto 9).
- El admin crea el periodo abierto del mes, toma/encola lecturas contra él, y lo cierra al terminar.
- Un periodo `cerrado` es **inmutable**: no acepta lecturas ni cambios (`ESPECIFICACION-FUNCIONAL.md`
  §2.7). Las lecturas posteriores quedan bloqueadas hasta abrir el siguiente periodo.
- Abrir un periodo cerrado no existe en el esquema: se crea un periodo nuevo (mes siguiente).
- El cierre de facturación masivo de 005 es la feature que **usa** el estado cerrado del periodo
  para disparar el cálculo de factura; 004 solo gestiona el estado del periodo y rechaza lecturas
  contra un periodo cerrado. El armado de la factura NO es de 004 (ver §4).
### 3.2 Lectura (`lecturas`)
- Tabla nueva `lecturas` (de `docs/esquema-propuesto.sql §8`): `contador_id`, `periodo_id`,
  `fecha_lectura`, `lectura_anterior`, `lectura_actual`, `consumo_m3` (calculado por
  `core/consumo.ts`, nunca escrito por la ruta), `hubo_rollover`, `revision`
  (`normal`/`consumo_alto`/`consumo_bajo`/`consumo_cero`), `revisada`, `revisada_por`,
  `promedio_historico`, `tomada_por`, `foto_url`, `latitud`, `longitud`, `observaciones`,
  `id_cliente_offline` (único, idempotencia).
- **Consumo:** se calcula automáticamente al guardar (`core/consumo.ts`), incluido rollover.
- **Bloqueos** (rechazo, con motivo de error devuelto al cliente):
  - Lectura duplicada del mismo contador en el mismo periodo → rechazada (unique `(contador_id,
    periodo_id)`).
  - Lectura fuera de orden cronológico → rechazada (la `lectura_actual` debe ser consistente con la
    última lectura del mismo contador).
  - Lectura en un periodo cerrado → rechazada.
  - Lectura menor sin cumplir la condición de rollover → rechazada (error de digitación o contador
    dañado; jamás se factura en negativo ni en cero en silencio).
- **Anomalías** (marcan para revisión, **nunca bloquean el guardado**): `consumo_alto`,
  `consumo_bajo`, `consumo_cero` según los umbrales de `configuracion` (ver §5).
- El listado de lecturas incluye las pendientes de revisión (filtro `revision <> 'normal' and not
  revisada`) y el cambio de estado `revisada`/`revisada_por` al marcarlas como atendidas.

### 3.3 Cálculo de consumo y anomalías (`core/consumo.ts`)
- Lógica pura, sin Hono/Cloudflare/Supabase (`CLAUDE.md §5.3`). Los tipos de entrada/salida y las
  firmas exactas se definen en `/plan`.
- Funciones obligatorias:
  - `calcularConsumoPeriodo(...)`: rollover o consumo simple para un contador sin reemplazo.
  - `calcularConsumoConReemplazo(...)`: combina `lectura_final_anterior` y `lectura_inicial_nuevo`
    de `reemplazos_contador` con los datos del saliente y del entrante (CLAUDE.md §10 punto 7).
  - `clasificarAnomalia(...)`: devuelve `revision` según umbrales.
- Reglas límite de rollover y reemplazo en §5; los casos límite exactos se testean (estrategia de
  pruebas en `/plan`).

### 3.4 Frontend admin
- Lectura de lecturas por periodo, alta/edición de una lectura manual (con la validación del Motor),
  y cola de revisión de anomalías. Los paneles quedan protegidos por el middleware existente.
- La PWA del lector (offline-first, QR) es de 014 — aquí solo se deja el campo `id_cliente_offline`
  en el esquema y se respeta el comportamiento idempotente en la API.

## 4. Fuera de alcance

- **Facturación, número de factura, desglose por servicio, mora, cierre masivo** — feature 005.
  004 calcula y almacena `consumo_m3` por lectura; es el insumo de 005, no la factura.
- **PWA del lector (offline-first, QR, fotos, sincronización de cola)** — feature 014 (`pwa-lector-qr`).
  La API de 004 es compatible (acepta `id_cliente_offline` y la dedup), pero no construye la app.
- **Cortes y reconexiones; estado `cortado` en el ciclo de lecturas** — feature 009.
- **Regenerar `codigo_suscriptor` / portal del suscriptor (D-2/D-4)** — feature 008.
- **Dashboard de consumo promedio y tendencia** — feature 011 (usa el dato, no lo produce).
- **Notas de ajuste para corregir un periodo cerrado** — se documenta como regla de negocio en §5,
  pero la UI/acción de emitir la corrección es de la feature de facturación/ajustes (005+).
- **Cálculo del "promedio histórico" para consumo alto/bajo** — 004 define y computa el promedio
  que alimenta la anomalía (campo `promedio_historico`); la definición exacta de la ventana se fija
  en `/plan`. No se afecta tarifas ni categorías.

## 5. Reglas de negocio que aplican

De `CLAUDE.md §10` (sección **Lecturas y consumo**):
1. **Rollover.** Solo si `lectura_actual < lectura_anterior` **Y**
   `lectura_anterior > capacidad_maxima × umbral_rollover_pct/100`.
   Consumo = `(capacidad_maxima − anterior) + actual`.
2. **Lectura menor sin cumplir la condición de rollover.** Es error de digitación o contador
   dañado. Se rechaza; no se factura en negativo ni en cero en silencio.
3. **Lectura duplicada** del mismo contador en el mismo periodo: se bloquea.
4. **Lectura fuera de orden cronológico**: se bloquea.
5. **Consumo alto.** `> factor_consumo_alto%` del promedio histórico **Y** `> piso_consumo_alto_m3`.
   Marca para revisión, **no bloquea el guardado**.
6. **Consumo bajo o cero.** `< factor_consumo_bajo%` del promedio, o cero. Marca para revisión,
   no bloquea.
7. **Reemplazo de contador a mitad de periodo.** Consumo =
   `(lectura_final_anterior − última lectura del saliente) + (lectura del nuevo − lectura_inicial_nuevo)`.
   Una sola factura, vinculada a ambas lecturas (la factura la arma 005; 004 calcula y guarda el
   consumo del periodo considerando el reemplazo).
8. **Reenvío de lectura desde la PWA offline.** Idempotente vía `id_cliente_offline`. Nunca se
   duplica.

De `CLAUDE.md §10` (sección **Facturación**), solo lo que 004 toca:
- 9. **Un solo periodo abierto por cliente.** Garantizado por índice parcial único (`periodos`).

De `CLAUDE.md §10` (sección **Permisos**):
- 24. El **lector** solo crea/ve lecturas (y ejecuta órdenes asignadas a él — 009). En 004, el rol
   `lector` puede **crear y leer** lecturas de su propio acueducto; **no** gestiona periodos (eso es
   solo `admin_acueducto`). El resto de escrituras (cerrar periodo, revisar lecturas) son de
   `admin_acueducto`.

De `CLAUDE.md §5.4`: `periodos` y `lecturas` llevan `cliente_id` y RLS `FORCE`; test de aislamiento
en la misma tarea que crea cada tabla.

De `CLAUDE.md §5.6` y `docs/DECISIONES.md`: `consumo_m3` y demás valores en `numeric` de PostgreSQL,
**nunca** `float`. El consumo se guarda con 2 decimales; el redondeo monetario final lo aplica 005
una sola vez en `core/`, no aquí.

De `docs/ESPECIFICACION-FUNCIONAL.md`:
- §2.7 (periodo): un solo periodo `abierto` a la vez; periodo cerrado inmutable, no acepta lecturas.
- §2.8 (lectura): atributos, consumo automático al guardar, bloqueos y anomalías; el
  `piso_consumo_alto_m3` evita marcar como anomalía un salto de 2→4 m³.
- §2.6 (contador): detección de rollover exacta (ambas condiciones) y fórmula de reemplazo.

## 6. Criterios de aceptación

Cada uno cerrado con evidencia ejecutada y pegada.

### CA-1 — Migración: enums `estado_periodo`/`revision_lectura` + tablas `periodos`/`lecturas`
Migración versionada crea (en una transacción, patrón 001–003) los enums y las tablas con RLS
`FORCE`, las FKs `ON DELETE RESTRICT` hacia `contadores`/`periodos`, el índice único parcial
`uq_periodo_abierto`, el unique de deduplicación de lecturas por `(contador_id, periodo_id)`, y el
unique de `id_cliente_offline`. Verificado contra PostgreSQL real (mismo mecanismo de 002/003) +
`\d periodos` y `\d lecturas`.

### CA-2 — Test de aislamiento de `periodos` y `lecturas`
El acueducto A no lee/escribe periodos ni lecturas del acueducto B (SELECT/INSERT directo e intentos
de referenciar un `periodo_id`/`contador_id` de B). Cubre también: solo un periodo `abierto` por
cliente; solo el `admin_acueducto` crea/cierra periodos y revisa lecturas; el rol `lector` puede
crear/leer lecturas del suyo pero no crear periodos ni marcar revisiones. Archivo
`tests/aislamiento/004_lecturas_consumo_aislamiento.sql` + fixtures `periodos`/`lecturas` que
completan `tests/fixtures/suscriptores.sql` (contadores A1/B1 ya existen; se abren periodos A/B).

### CA-3 — `core/consumo.ts`: rollover, rechazo y anomalías (unitario, `vitest`)
Tests unitarios (ejecutables sin Workers ni base) para:
- Consumo simple y con rollover en distintos dígitos de capacidad (ej. 5 dígitos 99999 y 6 dígitos
  999999), con la condición de rollover justo en el umbral (`lectura_anterior == capacidad ×
  umbral%`), por encima (sí rollover) y por debajo (no rollover).
- Lectura menor sin rollover → devuelve error de rechazo (no vende consumo negativo ni cero).
- Primera lectura de un contador nuevo (`lectura_anterior = lectura_inicial`).
- Consumo con reemplazo de contador a mitad de periodo (fórmula punto 7), con ambos contadores.
- Clasificación de anomalías: consumo alto (con y sin cumplir el piso), bajo, cero, normal.
- **Determinismo** (`ESTRATEGIA-CALIDAD.md` §5.4): mismo insumo produce mismo resultado; nunca
  devuelve consumo negativo ni mayor que `capacidad_maxima`.
Salida de `vitest` en verde, pegada.

### CA-4 — API (Hono): lecturas y periodos
Rutas para: abrir/crear periodo y cerrar periodo; crear una lectura (calcula consumo en
`core/consumo.ts`, respeta `id_cliente_offline` para no duplicar); listar lecturas por periodo, con
filtro de anomalías pendientes; marcar una lectura como revisada. Verificación con peticiones HTTP
reales contra `wrangler dev` cuando el entorno lo permita; si no, `tsc --noEmit` + `eslint` limpios
y "NO VERIFICADO" con los pasos exactos (mismo patrón que 002/003 en este contenedor).

### CA-5 — Bloqueos de integridad verificados en Postgres real
- Insertar una segunda lectura del mismo `(contador_id, periodo_id)` viola el unique → rechazado.
- Insertar una lectura en un `periodo` `cerrado` falla (constraint/trigger a definir en `/plan`) →
  rechazado.
- Insertar con el mismo `id_cliente_offline` dos veces produce una sola fila (idempotencia).
Verificado en el test de aislamiento de CA-2 contra PostgreSQL real.

### CA-6 — Frontend admin: paneles de lecturas y periodos
Pantallas para gestionar el periodo del mes y el registro/revisión de lecturas, protegidas por el
middleware existente. `npm run build`/`npm run lint` limpios; flujo en navegador real
"NO VERIFICADO" si el entorno no lo permite, con los pasos exactos (patrón 003 CA-6).

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Rollover mal detectado generaría consumo negativo o absurdo y facturaría de más a una familia | Todo el cálculo vive y se testea en `core/consumo.ts` con casos límite (umbral exacto, dígitos de capacidad distintos), fórmula única de CLAUDE.md §10 y property checks de determinismo/no-negativo (CA-3) |
| La deduplicación por `(contador_id, periodo_id)` y por `id_cliente_offline` puede fallar y permitir lecturas duplicadas | Constraints únicos en Postgres (no solo validación en la app) + CA-5 los prueba con INSERT directo contra la base real |
| Permitir al `lector` escribir en `lecturas` sin aislarlo del resto vulnera el multi-tenant | RLS `FORCE` + test de aislamiento CA-2 comprueba que el lector de A no ve periodos/lecturas de B y solo lee/escribe lecturas de su cliente; periodos y revisión quedan solo para `admin_acueducto` |
| Definición vaga del "promedio histórico" rompería la clasificación de anomalías y sería inconsistente con 005 | Se fija en `/plan` una definición determinista y documentada del promedio; el campo `promedio_historico` se guarda en cada lectura para trazabilidad |
| Reabrir un periodo cerrado (o no impedirlo) violaría la inmutabilidad | El esquema no permite "reabrir": solo existe `abrir` (crear periodo nuevo) y `cerrar`; CA-2 verifica que un periodo cerrado rechaza lecturas y que no hay acción de reapertura |
| `core/consumo.ts` escrito con dependencias de Hono/Supabase rompería la portabilidad | Regla `CLAUDE.md §5.3`: es lógica pura con tipos de entrada/salida; los tests unitarios corren con `vitest` sin Workers ni base (CA-3) |

## 8. Definición de terminado

- [x] Todos los CA (1–6) con evidencia — CA-1, CA-2 y CA-5 verificados contra **Supabase local real**
  PostgreSQL 17.6 (`supabase db reset --local`), entorno con Docker disponible en esta sesión.
  CA-1/CA-2/CA-5 en el test de aislamiento SQL (T-002), CA-3 con `vitest` (T-003); CA-4 y CA-6 quedan
  **NO VERIFICADO** (validación manual de Mateo, pasos en tasks.md T-004/T-005).
- [x] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios — `npm run build` 11/11,
  incluidas `/app/lecturas` y `/app/lecturas/periodo`; `wrangler deploy --dry-run` 814.66 KiB sin errores
- [x] Tests en verde: `vitest` de `core/consumo.ts` (22 tests, CA-3) — `npm test` 36 tests en verde +
  test de aislamiento SQL (`004_lecturas_consumo_aislamiento.sql` → `LECTURAS-CONSUMO-AISLAMIENTO OK`)
- [x] Test de aislamiento de las tablas nuevas (`periodos`, `lecturas`) — T-002, con regresión de
  001/002/003 en verde sobre el mismo estado final
- [x] `CHANGELOG.md` actualizado en el cierre de la feature — Sesión 011
- [x] Aprobación explícita de Mateo — spec, plan y tasks aprobados antes de cada fase
- [x] Un commit por tarea completada y verificada; sin `git push` (Mateo lo aplica / bundle si aplica)

