# SPEC — 011: dashboard-de-indicadores

**Estado:** Aprobado (2026-09-05) — decisiones de §0.2, §0.3 y §0.4 confirmadas por Mateo; pendiente de `/plan`.
**Depende de:** 001-fundacion (`clientes`, `membresias`, `perfiles`, `usuarios_servicio` con el enum
`estado_suscriptor` = `activo/suspendido/cortado/inactivo`, RLS `FORCE` del patrón multi-tenant);
004-lecturas-y-consumo (`periodos` con `estado` `abierto/cerrado` y único abierto por acueducto);
005-facturacion (`facturas` con `consumo_m3`, `tipo`, `total`, `total_pagado`, `periodo_id`,
`estado`, `fecha_vencimiento`); 007-pagos-y-cartera (`pagos` con `fecha_pago`/`anulado` y la
función `obtenerCartera()` que esta feature **reutiliza, no duplica**). Las cinco están completas
(`CHANGELOG.md` Sesiones 007-008, 011, 012, 014). Aplica las reglas de
`docs/ESPECIFICACION-FUNCIONAL.md §2.15` (Dashboard de indicadores).

## 0. Contexto, señalamiento de contradicciones y decisiones a resolver antes de /plan

### 0.1 Estado del roadmap `.specify/config.md`

El roadmap marca la fila 009 como "en /specify" y la 010 como "Pendiente". Ambas están **desactualizadas**:
009 está completa (CHANGELOG Sesión 016, spec de 010 ya lo señala) y 010 está completa (CHANGELOG
Sesión 024; `git log` en `main` en `dce1c49`). La fila de esta feature (`011 | dashboard | 007 |
Pendiente`) sí es correcta. No se corrige el roadmap en este documento porque no es parte del alcance
de esta spec — se deja señalado, igual que hizo 010 en su spec §0.

### 0.2 Definición de "Recaudo del mes actual" — texto de la EF requiere precisión

`docs/ESPECIFICACION-FUNCIONAL.md §2.15` describe el indicador como *"Total cobrado en el periodo
abierto"*. Esa redacción es ambigua frente al modelo real de datos: un pago (`pagos.fecha_pago`) no se
ata a ningún `periodo` de facturación; se ata a una fecha de caja. El periodo `abierto` de 004 es el
ciclo de lecturas en curso, distinto del mes en que llega el dinero.

**Interpretación recomendada (la que fija esta spec, aprobada por Mateo el 2026-09-05):** *recaudo del
mes actual = suma de `pagos.valor` de los pagos vigentes (`anulado = false`) del acueducto cuya
`fecha_pago` cae en el mes calendario en curso*. Es "caja real": dinero recibido en el mes, sin
importar a qué facturas se aplicó. Esta definición es la única que hace coherente el indicador con el
de "Tendencia de recaudo de los últimos 12 meses" (§3.4), que agrupa los mismos pagos por mes de
`fecha_pago`. Cualquier otra lectura (p. ej. atar el recaudo al mes de emisión de las facturas
abonadas) rompería esa coherencia y no tiene columna en el esquema que la soporte sin joins indirectos.
**Decisión aprobada por Mateo (2026-09-05): recaudo del mes = caja real por `fecha_pago`.**

### 0.3 Definición de "Consumo promedio del último periodo cerrado"

La EF no precisa la base de cálculo. El esquema ofrece dos fuentes para un periodo cerrado:
`facturas.consumo_m3` (una fila por suscriptor facturado en el ciclo) o `lecturas.consumo_m3` (una fila
por contador leído, que en un reemplazo a mitad de periodo son dos filas para un mismo suscriptor).

**Interpretación aprobada por Mateo (2026-09-05):** promedio de `facturas.consumo_m3` de las facturas
de tipo `ciclo` **no anuladas** del último periodo cerrado (el de mayor `(anio, mes)` entre los
`estado = 'cerrado'`). Razón: es el consumo **facturado por suscriptor** del periodo (semántica del
indicador "cuánto consume en promedio el usuario") y maneja bien el reemplazo de contador (005 emite
una sola factura con el consumo total). La alternativa (promedio sobre `lecturas`) contaría dos veces
al suscriptor con reemplazo. **Decisión aprobada por Mateo (2026-09-05): consumo promedio sobre
`facturas.consumo_m3`, no sobre `lecturas`.**

### 0.4 Acceso por rol — decisión aprobada: 403 explícito

La página `/app/dashboard` es hoy el destino post-login de cualquier miembro con sesión administrativa
(incluido el rol `lector`, que por RLS solo ve lecturas/órdenes). Los indicadores del §2.15 son del
**administrador del acueducto**.

**Decisión aprobada por Mateo (2026-09-05): acceso solo para `admin_acueducto`, con 403 EXPLÍCITO
para el `lector`** — no basta con "seguir mostrando solo el encabezado". Consecuencias que fija esta
spec:
- El endpoint de indicadores responde **HTTP 403** (no 200 con datos vacíos ni 401) a cualquier
  miembro autenticado cuyo rol en el acueducto activo no sea `admin_acueducto`.
- En la UI, un `lector` que aterrice en `/app/dashboard` ve un estado explícito de **"No autorizado"**
  (nunca los indicadores), con enlace a su espacio (`/app/lecturas`). No hay degradación silenciosa a
  "solo el encabezado".
- El aislamiento por RLS sigue siendo la red de seguridad de fondo: aunque el control de rol fallara,
  las consultas corren con el JWT del usuario y las políticas `FORCE` del esquema; CA-6 lo verifica.

### 0.5 Base local con rastro permanente (sesión 024 de 010)

La base local persistente acumula eventos inmutables de pruebas reales (pagos anulables ya anulados,
facturas de prueba, eventos de `cortes_reconexiones` que no se pueden deshacer). Esto hace que las
suites de aislamiento 005/006/007/010 que hardcodean conteos de filas fallen por **conteo, no por RLS**
(verificación documentada en `CHANGELOG.md` Sesión 024). Riesgo para la verificación de esta feature:
la regresión de aislamiento puede mostrar esos fallos preexistentes. No es una fuga multi-tenant.

---

## 1. Objetivo

Construir el panel de indicadores operativos del administrador del acueducto en `/app/dashboard`, que
resume en una sola pantalla el estado económico y operativo del acueducto: cuánto se recaudó en el mes,
cuánta cartera hay (pendiente y vencida), cuántos usuarios están en mora, cuál es el consumo promedio
del último periodo cerrado, la tendencia de recaudo de los últimos 12 meses y cuántos suscriptores hay
por estado. Todos los datos ya existen en el esquema (007 los produce: pagos, cartera, mora); esta
feature **los lee, agrega y presenta**, sin crear ni alterar ningún dato y sin duplicar la lógica de
cartera de 007.

## 2. Por qué ahora

El roadmap (`.specify/config.md`, fila 011, dependencia 007) ubica el dashboard después de que el ciclo
económico esté cerrado: emitir (005) → entregar (006) → cobrar (007). Las features que generan los
datos que el panel resume ya están completas, y también lo están 009 (cortes/reconexiones, que produce
suscriptores en estado `cortado`, un insumo del conteo por estado) y 010 (notificaciones). Con 011 el
administrador del acueducto piloto deja de operar "a ciegas" y el producto gana su pantalla de
valoración mensual, que además es la página a la que aterriza todo login (`/app/dashboard`). Los specs
de 004, 005 y 007 reservaron explícitamente que sus datos alimentarían esta feature.

## 3. Alcance

### 3.1 Recaudo del mes actual (indicador numérico)
- Total en pesos (COP, enteros) recaudado en el **mes calendario en curso**: suma de `pagos.valor` de
  los pagos vigentes (`anulado = false`) del acueducto con `fecha_pago` dentro del mes actual
  (definición de §0.2, aprobada).
- Los pagos **anulados** nunca cuentan, ni para este indicador ni para la tendencia.
- Sin pagos en el mes → muestra `0` (no un estado vacío).

### 3.2 Cartera pendiente y vencida (indicadores numéricos)
- Dos totales en pesos (COP, enteros): **cartera pendiente** (= `por vencer`, facturas con saldo cuya
  `fecha_vencimiento` no ha pasado) y **cartera vencida** (= facturas con saldo cuya
  `fecha_vencimiento` ya pasó), sumando la columna correspondiente de cada fila que devuelve
  `obtenerCartera()` de 007 para el acueducto.
- **No se recalcula ni se duplica la lógica de 007:** el backend de esta feature llama a
  `obtenerCartera()` (mismo `cliente_id` de la sesión, mismos filtros de siempre: facturas no anuladas
  con saldo vivo y saldo a favor) y agrega sus filas. Cualquier discrepancia con `/cartera` del mismo
  día es un bug de esta feature.
- Si el acueducto no tiene deuda, ambos totales muestran `0`.

### 3.3 Usuarios en mora (indicador numérico)
- Conteo de suscriptores del acueducto con **deuda vencida** (`vencida > 0` en su fila de cartera de
  007), sin importar su estado de servicio: un suscriptor `cortado` conserva su deuda vencida — la
  reconexión queda bloqueada por ella (spec de 009 §3.2, `ESPECIFICACION-FUNCIONAL.md §2.11`) — así que
  un `cortado` con deuda vencida cuenta como usuario en mora; la mora la define la deuda, no el estado
  del servicio.
- Fuente única: el conteo de filas de `obtenerCartera({ soloMorosos: true })` (mismo filtro que ya
  usa `/cartera?soloMorosos=true` en 007). Sin deuda vencida → `0`.

### 3.4 Tendencia de recaudo de los últimos 12 meses (gráfico)
- Gráfico de barras simple y estático que muestra, para cada uno de los **12 meses calendario**
  terminando en el mes actual (inclusive), el total recaudado en pesos, con la misma regla de pagos
  vigentes de §3.1.
- Mes sin pagos vigentes → barra en `0` (se muestra el mes, no se omite).
- Eje X con etiqueta de mes/año legible para un acueducto colombiano (formato de presentación,
  definido en /plan); sin interacción compleja. No requiere librería de gráficos pesada ni
  interactividad de drill-down (ver §4).

### 3.5 Suscriptores por estado (indicador numérico)
- Conteo de `usuarios_servicio` del acueducto agrupado por `estado`, presentando los **cuatro** estados
  del enum (`activo`, `suspendido`, `cortado`, `inactivo`), incluidos los que estén en `0`.
- La suma de los cuatro conteos debe ser igual al total de suscriptores del acueducto.

### 3.6 Presentación y navegación
- La página `/app/dashboard` conserva el encabezado actual (nombre del acueducto, usuario, rol y conteo
  de usuarios de servicio) y agrega el bloque de indicadores: tarjetas numéricas para §3.1-§3.3 y §3.5,
  una tarjeta para el consumo promedio (§3.7) y el gráfico de §3.4.
- El bloque de indicadores se muestra **solo** cuando el rol del miembro en el acueducto activo es
  `admin_acueducto`. Un miembro con otro rol (p. ej. `lector`) recibe del endpoint **HTTP 403** y en la
  página ve el estado explícito "No autorizado" con enlace a `/app/lecturas` (decisión de §0.4,
  aprobada).
- Estado "sin datos" claro cuando corresponde: p. ej. sin ningún periodo cerrado todavía, el consumo
  promedio se muestra como "—" (no como `0`, que sería engañoso).
- Vínculos simples de salida a páginas ya existentes (p. ej. cartera pendiente/vencida y usuarios en
  mora → `/app/pagos`; estados → `/app/suscriptores`). Sin lógica nueva de filtros por URL: son enlaces
  a las páginas tal como existen hoy.

### 3.7 Consumo promedio del último periodo cerrado (indicador numérico)
- Promedio (m³) de `facturas.consumo_m3` de las facturas `tipo = 'ciclo'` **no anuladas** del último
  periodo cerrado del acueducto (mayor `(anio, mes)` entre los `periodos` con `estado = 'cerrado'`;
  definición de §0.3, aprobada).
- Sin ningún periodo cerrado → estado "sin datos" de §3.6.

### 3.8 API e integración
- El backend entrega los indicadores por la API autenticada con el mismo patrón de sesión de siempre
  (`verificarSesionAdministrativa` + acueducto activo del perfil, con `cliente_id` explícito en cada
  consulta y el cliente de Supabase creado con el JWT del usuario — nunca `service_role`).
- Un solo viaje de ida y vuelta razonable para que la página no haga decenas de `fetch`s (definición de
  forma/endpoint en /plan). Los campos del encabezado actual del dashboard se conservan para no romper
  el aterrizaje post-login ni el fix de cookie documentado en `CHANGELOG.md` Sesión 023.
- Todo dato agregado de dinero sale en pesos enteros; el promedio de consumo puede llevar decimales
  (presentación definida en /plan). Ningún cálculo crea dinero nuevo: solo se suman/promedian valores ya
  persistidos por 005/007 (regla de `CLAUDE.md §5.3`: el único lugar donde se calcula dinero es `core/`).

## 4. Fuera de alcance

- **Exportes contables** (libro de ingresos PUC, Decreto 2650/1993): feature **013-exportes-contables**
  del roadmap (`.specify/config.md`), pendiente. El dashboard no genera ni prepara ningún archivo para
  contabilidad.
- **Reportes/PDF del propio dashboard** y hojas de impresión con formato: fuera del roadmap actual (el
  patrón `@media print` del panel ya cubre imprimir una página desde el navegador sin lógica extra).
- **Gráficos interactivos complejos** (zoom, drill-down por barra, comparativas, filtros dinámicos de
  fechas): el gráfico de §3.4 es estático. Cualquier exploración adicional de los datos ya existe como
  página propia (`/app/pagos`, `/app/suscriptores`, `/app/facturacion`).
- **Alertas, umbrales configurables o envío por correo de indicadores**: el subsistema de notificaciones
  es 010 (completa) y no se extiende aquí.
- **Nuevos estados, tablas o columnas en la base**: esta feature es de solo lectura; si la verificación
  real revelara que falta un índice de apoyo, se documenta como hallazgo y la migración se propone a
  Mateo antes de incluirla (no se improvisa esquema en /implement).
- **Indicadores del portal del suscriptor, de la PWA del lector o del panel maestro del rol
  `administrador` de la plataforma** (multi-acueducto): no existen en el roadmap como parte de 011.
- **Cualquier lógica de cartera nueva o duplicada** fuera de `obtenerCartera()` de 007.
- **Actualización en tiempo real / auto-refresh** del panel.

## 5. Reglas de negocio que aplican

- `docs/ESPECIFICACION-FUNCIONAL.md §2.15` — las seis métricas del dashboard y sus definiciones
  (con las precisiones de §0.2 y §0.3 de esta spec).
- `ESPECIFICACION-FUNCIONAL.md §2.7` — un solo periodo `abierto` por acueducto; un periodo `cerrado` es
  inmutable (base del "último periodo cerrado" de §3.7).
- `ESPECIFICACION-FUNCIONAL.md §2.10` y spec de 007 §3.5 — un pago no se borra: se anula con motivo; el
  estado `vencida` de la cartera se **deriva por fecha** en `obtenerCartera()` y esta feature solo la
  agrega. Todo indicador de recaudo excluye pagos `anulado = true`.
- `ESPECIFICACION-FUNCIONAL.md §2.5` y migración 001 — enum `estado_suscriptor` con exactamente
  `activo/suspendido/cortado/inactivo` (el conteo por estado usa esos cuatro valores).
- `CLAUDE.md §5.2` — el frontend nunca importa `@supabase/*`; toda petición pasa por la API de Hono.
- `CLAUDE.md §5.3` — agregar valores persistidos no es "calcular dinero"; no se introduce ninguna
  fórmula nueva de cartera/recaudo fuera de las ya existentes.
- `CLAUDE.md §4` — ningún criterio de aceptación se cierra sin evidencia ejecutada.

## 6. Criterios de aceptación

Cada CA se cierra con evidencia real ejecutada y pegada en la conversación (regla de `CLAUDE.md §4`):
curl real contra `wrangler dev` + Supabase local, consulta SQL de contraste y/o Playwright real contra
`next dev` + `wrangler dev`. NO se acepta "se ve correcto".

### CA-1 — Recaudo del mes actual
Con datos reales sembrados en Supabase local (pagos vigentes dentro del mes en curso con valores
conocidos, un pago **anulado** dentro del mes y un pago vigente de un **mes anterior**), la API
autenticada del acueducto devuelve `recaudoMes` = suma de los pagos vigentes del mes en curso
excluyendo el anulado y el de otro mes. Verificación: curl real + consulta SQL de contraste del mismo
`cliente_id`.

### CA-2 — Cartera pendiente/vencida y usuarios en mora (reutilización de 007)
Los totales `carteraPendiente`, `carteraVencida` y `usuariosEnMora` devueltos por la API coinciden con
la agregación de `GET /cartera` del mismo acueducto en el mismo momento (suma de `porVencer`, suma de
`vencida`, y conteo de filas con `vencida > 0`, equivalente a `/cartera?soloMorosos=true`). Verificación
real: ambas llamadas con curl contra `wrangler dev` sobre el mismo fixture, más contraste SQL
(`Σ(total − total_pagado)` de facturas no anuladas con saldo, clasificadas por `fecha_vencimiento`).

### CA-3 — Consumo promedio del último periodo cerrado
Con dos periodos cerrados con consumos distintos en el fixture, la API devuelve el promedio de
`facturas.consumo_m3` (`tipo = 'ciclo'`, no anuladas) del periodo cerrado de mayor `(anio, mes)`.
Con un acueducto sin periodos cerrados devuelve el estado "sin datos" (p. ej. `null`) que el frontend
muestra como "—". Verificación: curl + SQL de contraste (`round(avg(consumo_m3), …)` sobre el periodo
correcto) y Playwright/curl para el estado vacío.

### CA-4 — Tendencia de recaudo de 12 meses
Con pagos vigentes sembrados en varios meses (incluidos meses del año anterior y un mes sin pagos), la
API devuelve **exactamente 12** buckets mes-año consecutivos terminando en el mes actual, con el mes
sin pagos en `0` y cada valor igual al SQL de contraste agrupado por `fecha_pago`. Los pagos anulados
no aparecen en ningún bucket. Verificación real con curl + SQL.

### CA-5 — Suscriptores por estado
La API devuelve los cuatro estados del enum con sus conteos; la suma coincide con el total de
`usuarios_servicio` del acueducto y cada valor coincide con el SQL `GROUP BY estado` del mismo
`cliente_id`. Estados en `0` se devuelven (no se omiten). Verificación real con curl + SQL.

### CA-6 — Aislamiento multi-tenant (patrón 001-010)
Test de aislamiento nuevo (`011_dashboard_aislamiento.sql`, patrón de las suites 001-010): el admin
del acueducto A (sesión y consultas bajo RLS) ve en los indicadores únicamente datos de A; pagos,
facturas, periodos cerrados y suscriptores del acueducto B **no alteran ningún** indicador de A
(recaudo, cartera, mora, consumo promedio, tendencia, estados). Verificación real contra Supabase
local, más regresión de las suites de aislamiento previas. Si la regresión muestra los fallos de conteo
preexistentes documentados en §0.5, se verifica que no son fuga y se reporta, sin marcar CA-6 como
fallido por eso.

### CA-7 — Panel `/app/dashboard`
La página renderiza el encabezado existente y el bloque de indicadores: tarjetas numéricas, gráfico de
12 barras y estados "sin datos" donde corresponda; los vínculos de salida de §3.6 llevan a las páginas
existentes. Verificación real en navegador (Playwright, Chromium real, contra `wrangler dev` + `next
dev` + Supabase local — no solo build/lint), con un acueducto con datos y uno sin periodos cerrados.
Con el mismo navegador y un usuario `lector` del mismo acueducto se confirma el comportamiento de la
decisión de §0.4: el endpoint de indicadores responde 403 (verificado además por curl) y la página
muestra el estado "No autorizado" sin ningún indicador. Si
el entorno no permite correr ambos, se declara "NO VERIFICADO — requiere validación manual de Mateo:
[pasos exactos]" con los pasos completos en tasks.md (precedente CA-8 de 007).

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Duplicar la lógica de cartera de 007 y que los totales del dashboard difieran de `/cartera` | §3.2 obliga a reutilizar `obtenerCartera()` tal cual; CA-2 contrasta la API del dashboard contra `GET /cartera` y contra SQL en el mismo fixture |
| Interpretación equivocada de "recaudo del mes" o de "consumo promedio" frente al texto de la EF | Decisiones explícitas en §0.2 y §0.3, aprobadas por Mateo en este checkpoint, antes de /plan |
| Límites de "mes actual"/buckets de la tendencia dependientes de zona horaria (DB en UTC vs. operación en Colombia) | Definición de bordes de mes consistente y única en /plan (misma fuente para el mes en curso y los 12 buckets); CA-1/CA-4 usan fechas fijas del fixture, deterministas, y verifican el borde (pago del mes anterior no cuenta) |
| Contar dos veces al suscriptor con reemplazo de contador en el consumo promedio | §3.7 promedia sobre `facturas` de ciclo (una por suscriptor/periodo), no sobre `lecturas`; CA-3 con fixture de dos periodos |
| Agregaciones lentas con muchos suscriptores (patrón actual de 007: fetch + agregación en TS con tope de paginación) | Mismas restricciones y supuestos que 007 (acueducto piloto ~1000 suscriptores); si la verificación real muestra el tope de paginación, se reporta como hallazgo a Mateo, no se improvisa una consulta nueva fuera del patrón en /implement |
| El rol `lector` aterriza en `/app/dashboard` y recibe o no indicadores según su RLS | Decisión de §0.4 aprobada en este checkpoint; el bloque de indicadores se muestra solo a `admin_acueducto` y CA-6 verifica que nada de otro cliente ni de rol sin permiso se filtra |
| Regresión de aislamiento con fallos de conteo preexistentes de la base local (Sesión 024 de 010) | Documentado en §0.5; se distingue "falla de conteo por rastro de pruebas reales" de "fuga de aislamiento"; CA-6 no se cierra con una fuga real |
| Añadir una librería de gráficos pesada sin necesidad | §3.4 exige un gráfico simple y estático; el proyecto hoy no tiene dependencia de gráficos (solo Tailwind + shadcn/ui). Si /plan decide que una barra de 12 meses necesita librería, se elige una ligera (o CSS/SVG puro); la decisión se documenta en /plan con su justificación |
| Los vínculos de salida rompen al navegar a páginas existentes con parámetros que no soportan | §3.6 solo enlaza a páginas tal como existen hoy, sin filtros nuevos por URL; se verifica en CA-7 |

## 8. Definición de terminado

- [ ] Todos los CA (1-7) con evidencia real ejecutada y pegada (curl/SQL/Playwright según corresponda)
- [ ] Build (frontend, `npm run build`) sin errores ni warnings de TypeScript; `npm run lint` limpio en
      frontend y backend; `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] Tests unitarios en verde (los que agregue la feature, si aplica; sin cálculo nuevo en `core/`, el
      alcance es de lectura/agregación)
- [ ] Test de aislamiento nuevo (`011_dashboard_aislamiento.sql`) en verde contra Supabase local, con
      regresión 001-010/012 ejecutada y reportada (incluidos los fallos de conteo preexistentes de §0.5,
      si reaparecen)
- [ ] Sin cambios de esquema (esta feature es de solo lectura); si la verificación revela necesidad de
      un índice de apoyo, se propone la migración a Mateo antes de incluirla
- [ ] `CHANGELOG.md` actualizado al cierre
- [ ] Un commit por tarea completada y verificada; sin `git push` (comando entregado a Mateo al cierre)
- [ ] Aprobación explícita de Mateo (2026-09-05) de: (a) esta spec completa, (b) la decisión de §0.2
      (recaudo = caja por `fecha_pago`), (c) la decisión de §0.3 (consumo promedio sobre facturas de
      ciclo), y (d) la decisión de §0.4 (endpoint de indicadores solo para `admin_acueducto`, con
      403 explícito para el `lector` y estado "No autorizado" en la UI)

