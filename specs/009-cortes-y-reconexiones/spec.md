# SPEC — 009: cortes-y-reconexiones

**Estado:** Aprobado (2026-09-04) — alcance reducido (opción a de §5), pendiente de `/plan`
**Depende de:** 007-pagos-y-cartera (cartera vencida, `obtenerCartera()`); reutiliza infraestructura
de 001-fundación (`configuracion.dias_umbral_corte`/`valor_reconexion`/`prefijo_reconexion`,
`estado_suscriptor.cortado`) y 005-facturación (`siguiente_numero_factura()`, `tipo_factura.reconexion`)

## 1. Objetivo

Dar al administrador del acueducto la capacidad de cortar el servicio a un suscriptor moroso —
manual o guiado por un umbral de días de mora configurable— y de reconectarlo, generando
automáticamente el cargo de reconexión como una factura. Cierra el ciclo de cobranza que empieza
en 007-pagos-y-cartera (identificar la mora) y termina aquí (actuar sobre ella).

## 2. Por qué ahora

Según el roadmap (`.specify/config.md`), 009 depende de 007 (ya completa, CHANGELOG Sesión 014) y
reutiliza directamente su cálculo de cartera vencida. Antes de construir 010-notificaciones (que
necesitará poder avisar de un corte) y 011-dashboard (que probablemente mostrará suscriptores
cortados como indicador), hace falta que el estado `cortado` sea algo que el sistema pueda producir
y revertir de forma controlada, no solo un valor de enum sin uso.

**Verificación pedida por Mateo — ya resuelta con código real, no con este spec:** el bloqueo de
suscriptores `cortado` fuera del ciclo normal de facturación **ya está implementado** desde
005-facturación:
- `backend/src/lib/facturacion.ts:136` — la simulación del cierre solo trae suscriptores con
  `estado = 'activo'`.
- `backend/src/queues/cierre-facturacion.ts:86` — el consumidor real del cierre hace el mismo
  filtro, con el comentario `-- el cortado NO se factura; 009`.

009 no necesita tocar ese código. Solo necesita construir la vía **controlada** para que un
suscriptor efectivamente llegue a `estado = 'cortado'` (y de vuelta a `activo`), con su historial.

## 3. Alcance

### 3.1 Corte
- Acción que transiciona a un suscriptor de `activo` a `cortado`, con motivo y fecha, dejando
  registrado quién lo hizo (`responsable`).
- **Candidatos a corte por umbral:** un listado que muestra los suscriptores cuya deuda vencida
  supera `configuracion.dias_umbral_corte` días (reutilizando `diasMoraMax` de `obtenerCartera()`,
  007).
- **Quién ejecuta el corte y desde dónde — decisión de alcance aprobada por Mateo (2026-09-04, ver
  §5):** el corte es una acción de `admin_acueducto` desde el panel web (opción a de §5), no la
  "orden de corte" ejecutada por el rol `lector` desde su celular que describe
  `docs/ESPECIFICACION-FUNCIONAL.md §2.11`. Esa segunda vía (opción b) queda como feature futura,
  no se implementa en 009 — el volumen actual del acueducto piloto no la justifica todavía.
- Un suscriptor ya `cortado` no puede volver a cortarse (la acción es idempotente por rechazo
  explícito, no por éxito silencioso).

### 3.2 Reconexión
- Acción administrativa que transiciona a un suscriptor de `cortado` a `activo`.
- **Bloqueada si el suscriptor tiene deuda vencida** (misma fuente que candidatos a corte:
  `obtenerCartera()`), salvo que el admin la fuerce con una **excepción explícita**: motivo
  obligatorio y queda registrado como autorizador (mismo patrón que `anular_pago()` de 007 — motivo
  vacío o ausente rechaza la operación, no la acepta con un motivo genérico).
- Al reconectar, se genera automáticamente una **factura de tipo `reconexion`** (`tipo_factura` ya
  admite ese valor desde 005): número `REC-{YYYY}-{NNNNN}` vía `siguiente_numero_factura()`
  reutilizada tal cual, monto = `configuracion.valor_reconexion`, sin `periodo_id` (el esquema ya
  soporta `periodo_id null` para facturas fuera de ciclo).
- Un suscriptor ya `activo` no puede "reconectarse" (mismo criterio de rechazo explícito que 3.1).

### 3.3 Historial
- Tabla de cortes y reconexiones por suscriptor: tipo de evento, fecha, motivo, responsable, y si
  fue una reconexión con excepción (deuda vencida al momento de reconectar, si aplica).
- Visible en el detalle del suscriptor (mismo lugar que el historial de reemplazos de contador de
  003).

### 3.4 Frontend admin
- Panel de candidatos a corte (con la deuda vencida y días de mora de cada uno) y acción de corte
  manual.
- En el detalle del suscriptor: botón de cortar (si está activo) o reconectar (si está cortado, con
  aviso de deuda vencida y la opción de excepción), más el historial de 3.3.

## 4. Fuera de alcance

- **Notificar al suscriptor del corte o la reconexión** (SMS, correo, portal) — feature
  010-notificaciones.
- **Ejecución física del corte** (cerrar la válvula en campo) — es un proceso operativo del
  acueducto, fuera del sistema. 009 solo refleja el estado administrativo.
- **Corte automático desatendido** (un Cron Worker que corte sin intervención humana) — decisión 1
  de §5, aprobada: el corte siempre pasa por confirmación humana.
- **Un sistema genérico de "órdenes" asignadas a un `lector` específico, ejecutadas desde su
  celular** (lo que describe `docs/ESPECIFICACION-FUNCIONAL.md §2.11` y menciona CLAUDE.md §10
  punto 24) — no existe todavía ninguna infraestructura de código para esto (verificado: no hay
  tabla ni concepto de "orden" en `backend/src/` ni en las migraciones, solo el comentario
  preparatorio de 001 `'lector' -- Fontanero. Lecturas y órdenes asignadas, desde celular`).
  **Decisión 2 de §5, aprobada:** queda documentado como feature futura, no se implementa en 009 —
  el volumen actual del acueducto piloto no lo justifica todavía.
- **Reglas de corte distintas por tipo de suscriptor** (comercial vs. residencial, etc.) — no está
  en la especificación funcional (`docs/ESPECIFICACION-FUNCIONAL.md §2.11`); si hace falta, es una
  ampliación futura de `configuracion`.

## 5. Reglas de negocio que aplican

De `CLAUDE.md §10`:
- **16.** Corte automático por umbral de días de mora configurable, o manual.
- **17.** Al ejecutar el corte el suscriptor pasa a `cortado` y sale del ciclo normal de lecturas y
  facturación — **la parte de facturación ya está construida** (§2 de este spec); la parte de
  lecturas se revisa en el `/plan` (probablemente 004-lecturas-y-consumo también necesite un filtro
  por `estado`, a confirmar contra su código real, no asumido aquí).
- **18.** Reconexión bloqueada con deuda vencida, salvo excepción explícita que exige motivo y
  autorizador.
- **19.** La reconexión genera factura independiente (`tipo = 'reconexion'`).

**Decisión 1 — corte "automático" es sugerido, no desatendido (aprobada por Mateo 2026-09-04):**
la instrucción original decía "manual, o con umbral configurable de días vencidos", que admitía dos
lecturas: corte 100% automático (un Cron Worker que corta sin que nadie lo confirme) o un umbral
que el sistema usa para **sugerir** candidatos que un humano confirma. Se aprobó la segunda
lectura: cortar el servicio de una familia real sin que ningún humano lo confirme es un riesgo
mayor que el beneficio de automatizarlo del todo (CLAUDE.md §1: "los datos que maneja son dinero
real de gente real"), y además evita un Worker de Cron nuevo (costo/complejidad adicional no
justificada todavía, CLAUDE.md §2). El corte y la reconexión son siempre una acción de
`admin_acueducto` con confirmación humana explícita, nunca ejecutada sin revisión.

**Decisión 2 — quién ejecuta el corte (aprobada por Mateo 2026-09-04, opción a):** hallazgo al leer
`docs/ESPECIFICACION-FUNCIONAL.md §2.11` (ya existente, no anticipado en la instrucción original de
esta feature): ese documento describe algo más específico que "un admin corta desde el panel" —
dice literalmente que el sistema genera una **"orden de corte"** automática al superar el umbral, y
que "al ejecutar el corte (**desde el celular del lector**)" el suscriptor pasa a `cortado`. Eso
conecta con CLAUDE.md §10 punto 24 ("el lector... ejecuta órdenes asignadas a él"). Se verificó el
código real: **no existe ninguna tabla ni concepto de "orden" todavía**, solo un comentario
preparatorio en el enum de 001. Se presentaron dos opciones:
  - **(a) Alcance reducido — APROBADA, es lo que construye esta spec:** el corte y la reconexión
    son acciones de `admin_acueducto` desde el panel web — el sistema sugiere candidatos por
    umbral, el admin decide y ejecuta. No hay "orden" como entidad separada ni ejecución desde el
    celular del lector. Cumple el requisito central: nadie corta el servicio sin que un humano lo
    confirme, con motivo y responsable.
  - **(b) Alcance completo según §2.11 — diferida, no se implementa ahora:** agregar el concepto de
    "orden de corte" (generada por umbral, asignable a un lector), una vista para que el lector la
    vea y la ejecute desde su celular, y RLS que le permita solo actuar sobre sus órdenes
    asignadas. Queda documentada como feature futura (candidata a un número de roadmap propio
    cuando se necesite) — el volumen actual del acueducto piloto no la justifica todavía; se
    reconsidera si el número de suscriptores/lectores crece al punto de que la revisión manual de
    candidatos desde el panel deje de ser práctica.

De `CLAUDE.md §5.4`: `cortes_reconexiones` lleva `cliente_id` y RLS `FORCE`; test de aislamiento en
la misma tarea que la crea.

## 6. Criterios de aceptación

### CA-1 — Migración: tabla `cortes_reconexiones`, `registrar_corte()`, `reconectar()`
Tabla de historial (tipo, fecha, motivo, responsable, deuda_vencida_al_reconectar) con RLS `FORCE`.
Dos funciones `SECURITY INVOKER` con `SELECT FOR UPDATE` sobre `usuarios_servicio` (mismo patrón
que `reemplazar_contador()` de 003): `registrar_corte()` exige motivo, rechaza si ya está cortado;
`reconectar()` exige motivo si hay deuda vencida y se fuerza con excepción, rechaza si ya está
activo, y llama `siguiente_numero_factura()` + inserta la factura de reconexión en la misma
transacción. Verificado contra Postgres real (mismo mecanismo de 002/003: shim de compatibilidad
si el entorno no tiene Docker).

### CA-2 — Test de aislamiento
El acueducto A no puede cortar ni reconectar suscriptores de B. Rol `lector` no puede ejecutar
ninguna de las dos acciones. Un suscriptor ya cortado no se puede volver a cortar; uno ya activo no
se puede "reconectar" — ambos con mensaje de error explícito, no éxito silencioso.

### CA-3 — Regresión: el cortado sigue fuera del ciclo de facturación
Test (o verificación explícita) de que `facturacion.ts`/`cierre-facturacion.ts` siguen filtrando
por `estado = 'activo'` después de esta feature — no se toca ese código, pero se confirma que sigue
así, no se asume.

### CA-4 — API: candidatos a corte + acciones (Hono)
`GET /cortes/candidatos` (deuda vencida ≥ umbral, reutilizando `obtenerCartera()`),
`POST /suscriptores/:id/corte`, `POST /suscriptores/:id/reconexion`,
`GET /suscriptores/:id/historial-cortes`. Verificado con peticiones HTTP reales cuando el entorno
lo permita; si no, `tsc`/`eslint`/`wrangler deploy --dry-run` limpios y "NO VERIFICADO" documentado
con pasos exactos (mismo patrón que 002).

### CA-5 — Reconexión genera la factura correcta
La factura resultante tiene `tipo = 'reconexion'`, número con `prefijo_reconexion`, monto =
`configuracion.valor_reconexion` del cliente, `periodo_id` nulo, y queda vinculada al suscriptor.
Verificado insertando y consultando directamente, no solo revisando el código.

### CA-6 — Reconexión bloqueada sin excepción, permitida con excepción completa
Con deuda vencida y sin motivo de excepción: rechazada. Con deuda vencida y motivo de excepción:
aceptada, y el historial (CA-1) queda con `deuda_vencida_al_reconectar` > 0. Sin deuda vencida: no
requiere motivo.

### CA-7 — Frontend: panel de candidatos y acciones en el detalle
`npm run build`/`npm run lint` limpios. Panel de candidatos a corte, botones de cortar/reconectar
en el detalle del suscriptor con el historial visible. Flujo en navegador real "NO VERIFICADO" si
el entorno no lo permite, con pasos exactos.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Cortar a un suscriptor por error (o por un umbral mal configurado) sin que quede claro quién lo hizo | `responsable` y `motivo` son obligatorios en `registrar_corte()`, nunca opcionales; el historial (CA-1) es permanente |
| Reconectar sin darse cuenta de que hay deuda vencida | El bloqueo es el comportamiento por defecto; la excepción exige motivo explícito, no una casilla que se marca sin fricción |
| El filtro de "activo" en lecturas (004) no existe o es distinto al de facturación, dejando a un suscriptor cortado seguir generando lecturas | Se verifica contra el código real de 004 en `/plan`, no se asume que ya está resuelto igual que en facturación |
| Duplicar la lógica de "deuda vencida" en vez de reutilizar `obtenerCartera()` de 007, desincronizándose de la cartera real | 009 llama la misma función, no reimplementa el cálculo |

## 8. Definición de terminado

- [x] Todos los CA (1–7) con evidencia — CA-1 a CA-6 verificados contra PostgreSQL 16 nativo + shim
  (sin Docker/PostgREST en este contenedor); CA-7 (flujo en navegador) queda
  **NO VERIFICADO — requiere validación manual de Mateo** (tasks.md T-006, pasos exactos)
- [x] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios — `npm run build` 14/14
  páginas (incluidas `/app/cortes` y `/app/suscriptores/[id]` ampliada); `wrangler deploy --dry-run`
  sin errores; `vitest run` 105/105 sin regresión
- [x] Test de aislamiento de `cortes_reconexiones` en verde, con regresión de 001-008 — reconstruida
  la base desde cero y corridos los 9 tests de aislamiento (001 a 009) en una sola pasada limpia,
  los 9 en verde (ver CHANGELOG Sesión 016 sobre el hallazgo de una falla espuria por estado
  acumulado en corridas previas, no una regresión real)
- [x] CA-3 (regresión del bloqueo de facturación) verificado explícitamente, no asumido —
  `grep` confirma el filtro `estado = 'activo'` intacto en `facturacion.ts`/`cierre-facturacion.ts`
- [x] `CHANGELOG.md` actualizado
- [x] Aprobación de Mateo — spec (con sus 2 decisiones de alcance), plan y tasks aprobados
  explícitamente antes de cada fase
