# SPEC — 010: notificaciones

**Estado:** Borrador para aprobación
**Depende de:** 006-impresion-y-correo-factura (crea la tabla `notificaciones`, `backend/src/lib/email.ts`
y `computarActualizacionNotificacion()` — 010 los generaliza, no los duplica); 007-pagos-y-cartera
(fuente del evento `confirmacion_pago`, diferido explícitamente aquí en su spec §4); 009-cortes-y-
reconexiones (fuente de `corte_ejecutado`/`reconexion_completada`, diferido explícitamente aquí en su
spec §4). Las tres están completas (`CHANGELOG.md` Sesiones 013, 014 y 016).

> Nota de estado del roadmap: `.specify/config.md` todavía marca 009 como "en /specify — spec.md en
> revisión". Es información desactualizada — `git log` y `CHANGELOG.md` Sesión 016 confirman que 009
> está completa (T-001 a T-007, commits `8680b11`…`a7362a0`). Se señala aquí porque 010 depende
> directamente de que 009 esté cerrada; no se corrige el roadmap en este documento porque no es parte
> del alcance de esta spec.

---

## 0. Contexto de la sesión anterior (contenedor perdido) y una decisión que hay que resolver antes de continuar

Esta spec se reconstruye desde cero porque el trabajo previo se perdió. Antes de escribir el alcance,
hay una contradicción real entre documentos que **CLAUDE.md obliga a señalar antes de decidir por mi
cuenta** (CLAUDE.md, encabezado: "si algo aquí contradice una instrucción del chat, este archivo
manda y hay que señalar la contradicción antes de continuar").

**La contradicción:** el pedido de esta tarea dice "Canal: email vía Resend". Pero:
- `CLAUDE.md §2` (tabla de stack, "sin excepciones"): `Correo | Cloudflare Email Service`.
- `docs/DECISIONES.md` **D-8** (vigente, no marcada como superada): fija Cloudflare Email Service
  para el correo de factura.
- `docs/INFRAESTRUCTURA-Y-COSTOS.md §4` sí registra una decisión real de cambiar a Resend — pero la
  marca explícitamente **"PENDIENTE TÉCNICO, prioridad MEDIA... no se toca código en esta sesión"**,
  y su propia tabla de pendientes (§7, ítem 2) dice: *"no tiene spec.md/plan.md/tasks.md todavía —
  siguiendo CLAUDE.md §3, no se escribe código sin pasar primero por /specify cuando Mateo decida
  priorizarlo"*. Ese mismo documento anticipa que hará falta una decisión **D-11** (o marcar D-8 como
  superada) el día que esto se implemente — y no existe todavía (`docs/DECISIONES.md` llega hasta
  D-10).

Es decir: el propio documento que introduce Resend dice, en su propio texto, que migrar a Resend
necesita su **propio `/specify`**, separado, cuando Mateo lo priorice. Implementar el canal de 010
directamente sobre Resend violaría esa instrucción y dejaría `CLAUDE.md`/D-8 contradiciendo el código
— exactamente lo que `CLAUDE.md §5.2` y el principio de "un solo lugar de verdad" buscan evitar.

### Mi recomendación (la decisión que el pedido pide señalar)

**Migrar a Resend es tarea separada, no parte de 010.** Justificación:

1. **Ya está decidido así por escrito, en el propio documento que propone el cambio.** No es una
   opinión mía: `docs/INFRAESTRUCTURA-Y-COSTOS.md §7` ya lo clasifica como pendiente independiente
   con su propio `/specify` futuro.
2. **Acoplar 010 a Resend sin actualizar D-8/CLAUDE.md primero deja el repositorio en un estado
   inconsistente** (código en Resend, decisión vigente documentada diciendo Cloudflare Email
   Service) — exactamente el escenario que `docs/INFRAESTRUCTURA-Y-COSTOS.md §4` describe como "a
   resolver cuando se implemente, no ahora".
3. **010 es "el subsistema general de notificaciones del cual otras features se apoyan"** (marco de
   negocio de esta tarea). Su valor no depende de qué proveedor de correo hay debajo — depende de que
   exista un tipo de evento, un registro con reintentos, y un panel. Construir 010 sobre la capa de
   envío **ya existente** (`backend/src/lib/email.ts`, ampliada de "solo factura con PDF" a "asunto +
   cuerpo HTML genérico") hace que el día que se apruebe el `/specify` de Resend, ese cambio sea
   **interno a esa sola capa** — 010 no se vuelve a tocar. Acoplar 010 a un proveedor específico ahora
   sería repetir el trabajo dos veces.
4. **El único motivo real para adelantar Resend es económico** (Cloudflare Email Service asume Workers
   Paid activo, según `ARQUITECTURA.md §6` citado en el propio doc de costos) — pero UndreoCol sigue
   sin cliente pagando y sin Workers Paid activo todavía (`CLAUDE.md §2`, "cero infraestructura de
   pago hasta el primer cliente"). Mientras tanto, **en `wrangler dev` local ninguno de los dos canales
   envía correo real** (`env.EMAIL` no existe en local, tal como ya documenta `lib/email.ts`) — así que
   no adelantar Resend no bloquea verificar 010 en este entorno; solo pospone el envío real, que de
   todas formas ya está "NO VERIFICADO — requiere la cuenta de Mateo" en 006 y seguiría igual aquí.

**Qué construye 010 entonces (canal):** sigue usando el mecanismo vigente y ratificado —
Cloudflare Email Service, vía la misma capa de `lib/email.ts` que 006 ya construyó y verificó —
generalizada para aceptar cualquier asunto/cuerpo, no solo el de una factura con PDF adjunto. Si
Mateo prioriza el cambio a Resend después, es un `/specify` propio que reemplaza el interior de esa
capa sin tocar el resto de 010.

**Esto queda pendiente de aprobación explícita de Mateo en el checkpoint de esta spec** — si Mateo
prefiere adelantar Resend dentro de 010 pese a lo anterior, es su decisión y se documenta aquí antes
de pasar a `/plan`.

---

## 1. Objetivo

Construir el subsistema **general y centralizado** de notificaciones por correo que la
`ESPECIFICACION-FUNCIONAL.md §2.12` describe y que 006, 007 y 009 diseñaron para apoyarse en él
en vez de reinventarlo cada uno: un catálogo cerrado de tipos de evento, un mecanismo único de envío
con reintentos y trazabilidad, dos disparadores nuevos por evento de negocio síncrono (pago, corte,
reconexión) y dos disparadores nuevos por condición de tiempo (vencimiento próximo, mora), un panel
de historial para el administrador, y la primera alerta operativa real (no un stub) para el equipo de
UndreoCol cuando algo crítico de infraestructura falla.

## 2. Por qué ahora

`.specify/config.md` ubica 010 después de 006 y antes de 011 (dashboard). 006, 007 y 009 ya están
completas y las tres dejaron trabajo explícitamente diferido aquí:
- 006 (`spec.md §4`): "Subsistema general de notificaciones... feature 010."
- 007 (`spec.md §4`): "Notificación de confirmación de pago... subsistema de notificaciones,
  feature 010. 007 no crea filas en `notificaciones`."
- 009 (`spec.md §4`): "Notificar al suscriptor del corte o la reconexión... feature 010-notificaciones."

La tabla `notificaciones` y `computarActualizacionNotificacion()` ya existen (006) y fueron diseñadas
explícitamente anticipando esta feature (comentario en la migración: *"recordatorio/mora/pago = 010"*).
Siguen sin usarse los tipos de evento más allá de `factura_generada`. Siguen sin existir avisos por
tiempo (vencimiento, mora) porque ninguna feature anterior tenía un disparador temporal — 010 es la
primera que necesita un Worker programado para generar notificaciones (no solo reaccionar a una
acción del admin).

## 3. Alcance

### 3.1 Catálogo cerrado de tipos de notificación

Los seis tipos que existen en el dominio (`ESPECIFICACION-FUNCIONAL.md §2.12` + los eventos de corte
y reconexión que 009 declaró como notificables):

| Tipo | Disparador | Ya existe el evento origen en |
|---|---|---|
| `factura_generada` | Admin solicita envío de una factura (individual o por lote de periodo) | 006 (ya implementado, sin cambios de comportamiento) |
| `recordatorio_vencimiento` | Factura pendiente próxima a vencer (condición de tiempo) | Nuevo en 010 |
| `aviso_mora` | Factura recién detectada vencida sin pagar (condición de tiempo) | Nuevo en 010 |
| `confirmacion_pago` | Pago registrado con éxito (`POST /pagos`) | 007 (evento ya existe; 010 agrega el enganche) |
| `corte_ejecutado` | Corte ejecutado (`POST /suscriptores/:id/corte`) | 009 (evento ya existe; 010 agrega el enganche) |
| `reconexion_completada` | Reconexión ejecutada (`POST /suscriptores/:id/reconexion`) | 009 (evento ya existe; 010 agrega el enganche) |

El campo `tipo` de `notificaciones` ya es texto libre (sin `CHECK` today) — 010 cierra el catálogo
formalmente para que un valor mal escrito no pase inadvertido.

### 3.2 Contenido de cada tipo (asunto + cuerpo)

Cada tipo tiene un asunto y un cuerpo de correo fijos por código (mismo criterio que 006 con el correo
de factura: sin plantillas editables por UI, sin motor de templates — un string HTML simple
parametrizado con los datos del evento). Sin adjuntos salvo `factura_generada` (PDF, ya construido en
006) y, opcionalmente, `reconexion_completada` (puede referenciar la factura de reconexión que 009 ya
genera automáticamente, reusando `factura-pdf.ts` de 006 si el suscriptor la solicita — el envío del
PDF de reconexión sigue siendo opt-in como cualquier otro correo de factura, no automático).

### 3.3 Canal: Cloudflare Email Service (ver §0 — decisión de esta spec)

Generalización de `backend/src/lib/email.ts`: hoy solo expone `enviarFacturaPorCorreo` (asunto fijo +
adjunto PDF obligatorio). 010 necesita enviar correos sin adjunto (recordatorio, mora, confirmación de
pago, corte) — la función de envío se generaliza a aceptar adjuntos opcionales, sin cambiar el binding
(`env.EMAIL.send`) ni el comportamiento ya verificado en dev local (sin `env.EMAIL` → `{ok:false}` sin
lanzar, regla 20).

### 3.4 Disparadores síncronos (pago, corte, reconexión)

Mismo patrón que 006 (`POST /facturas/:id/enviar-correo`): al completarse con éxito la acción de
negocio, si el suscriptor tiene email registrado, se crea una fila en `notificaciones` (`pendiente`) y
se encola el envío — el envío nunca ocurre en el mismo request. Si el suscriptor no tiene email, no se
crea fila (mismo criterio que 006: "un suscriptor sin email no rompe nada") y la acción de negocio
responde igual de exitosa.

- **`confirmacion_pago`**: enganchado en `POST /pagos` (007), después de que el pago y sus
  aplicaciones se confirman.
- **`corte_ejecutado`**: enganchado en `POST /suscriptores/:id/corte` (009).
- **`reconexion_completada`**: enganchado en `POST /suscriptores/:id/reconexion` (009).

Regla explícita: un fallo al crear la notificación o al encolarla **nunca** revierte ni hace fallar el
pago/corte/reconexión ya confirmado — la acción de negocio es la fuente de verdad; la notificación es
un efecto secundario best-effort (mismo principio de la regla 20, extendido más allá del correo de
factura).

### 3.5 Disparadores por tiempo (recordatorio de vencimiento, aviso de mora) — Worker programado nuevo

Primera vez que una notificación no nace de una acción de un admin sino de una condición de tiempo.
Un Worker con cron diario (mismo patrón que `keepalive.ts`/`monitor-db.ts`, `INFRAESTRUCTURA.md §5/§8`)
revisa, para cada cliente activo:

- **Recordatorio de vencimiento:** facturas `pendiente` cuya `fecha_vencimiento` cae dentro de
  `configuracion.dias_aviso_vencimiento` días desde hoy (campo nuevo propuesto, default sugerido: 3
  días — **a confirmar por Mateo en el checkpoint**, no hay un valor "correcto" universal).
- **Aviso de mora:** facturas que **hoy** cumplen por primera vez `pendiente` + `fecha_vencimiento <
  hoy` (el mismo criterio de "vencida" que ya deriva 007 en `obtenerCartera()`, sin persistir un
  estado nuevo).

**Regla de idempotencia (nueva, propuesta para `CLAUDE.md §10`):** cada combinación
`(factura_id, tipo)` genera **como máximo una** notificación — antes de crear la fila, el Worker
verifica que no exista ya una `notificaciones` con ese `factura_id` y ese `tipo`. Sin esto, correr el
cron dos veces el mismo día (o un reintento del propio cron) duplicaría avisos. Esto es
deliberadamente conservador (un solo aviso por factura, no un recordatorio repetido cada día) — si
Mateo prefiere reavisos periódicos de mora, es una variación a discutir en `/plan`, no un cambio de
alcance de esta spec.

Mismo criterio de "sin email no rompe nada": una factura sin email en el suscriptor simplemente no
genera fila.

### 3.6 Reintentos con límite (reutiliza 006)

`computarActualizacionNotificacion()` ya es genérica (no depende de facturas ni de PDFs: recibe
`{ok, error}` + `intentosActuales`, devuelve el nuevo estado) — 010 la reutiliza sin cambios de
comportamiento para los seis tipos. Aplica a todos: 3 intentos antes de `fallida`
(`MAX_INTENTOS_ENVIO`), con `ultimo_error` trazable en cada fila.

### 3.7 Panel admin: historial de notificaciones

Vista nueva (`/app/notificaciones` o similar — el nombre exacto de ruta es decisión de `/plan`) con el
listado de `notificaciones` del cliente activo: tipo, canal, destinatario, estado, intentos, último
error, fecha. Filtrable por tipo y estado. Usa la política RLS `notificaciones_lectura` ya creada en
006 (miembros del cliente o admin de plataforma) — sin cambios de RLS necesarios para lectura.
Solo lectura (ver §4 — reintento manual queda fuera de alcance).

### 3.8 Alerta operativa real (`monitor-db.ts`) — decisión de diseño a validar

`backend/src/cron/monitor-db.ts` tiene un `alertaStub()` con un `TODO(feature 010)` explícito: hoy
solo hace `console.error`. El requisito pide que dispare un correo real cuando el nivel sea `alerta`/
`critico`.

**Decisión de diseño que hay que señalar (no es una acción de un `cliente_id`):** `notificaciones` es
una tabla de negocio multi-tenant — `cliente_id not null` **sin excepciones** (`CLAUDE.md §5.4`). Una
alerta de "la base de datos de la plataforma se está llenando" no pertenece a ningún acueducto
cliente: es un aviso operativo para el equipo de UndreoCol (Mateo), no para un `admin_acueducto`. Meter
esta alerta en `notificaciones` obligaría a inventarle un `cliente_id` que no le corresponde (violando
la regla "sin excepciones") o a debilitar esa regla justo para este caso.

**Recomendación:** `monitor-db.ts` envía el correo directamente con la capa de envío generalizada de
§3.3 (`env.EMAIL.send`, sin pasar por la tabla `notificaciones`), a una dirección fija de
configuración/secreto del Worker (p. ej. `ALERTA_EMAIL_DESTINO`, nueva variable — a definir en
`/plan`). No se registra en `notificaciones` porque no es un evento de un cliente; el propio log de
Cloudflare (`console.error`, que ya existe) sigue siendo el registro operativo, igual que hoy. Sin
reintento con límite tipo `computarActualizacionNotificacion` — el cron corre a diario, así que un
fallo de envío de hoy se reintenta naturalmente mañana si la condición persiste (no hace falta
mecanismo de reintento adicional).

**Esto también queda pendiente de aprobación de Mateo en el checkpoint** — si prefiere forzar esta
alerta a convivir en `notificaciones` con algún `cliente_id` especial (p. ej. un cliente "sistema"),
es una alternativa a discutir, pero no es la recomendada.

## 4. Fuera de alcance

- **Notificaciones push o in-app en tiempo real** — explícitamente fuera de alcance (pedido de esta
  tarea).
- **SMS / WhatsApp** — ningún documento vigente (`ESPECIFICACION-FUNCIONAL.md §2.12`,
  `CLAUDE.md §10`) define un canal más allá de correo; 009 mencionó "SMS, correo, portal" como ideas al
  diferir la notificación de corte, pero esta spec solo construye correo, como pide el requisito 3 de
  la tarea.
- **Migración del canal a Resend** — ver §0. Tarea separada, con su propio `/specify`, cuando Mateo la
  priorice.
- **Reintento manual desde el panel** de una notificación `fallida` — el panel (§3.7) es de solo
  lectura. Si Mateo lo quiere, es una ampliación menor a considerar en `/plan` o una iteración futura;
  no se incluye para mantener acotado el alcance mínimo pedido.
- **Preferencias de notificación** (que un suscriptor o admin puedan desactivar un tipo de aviso) — no
  está en la especificación funcional; no se inventa aquí.
- **Purga/retención de filas antiguas de `notificaciones`** — es el Worker de limpieza automática
  (`INFRAESTRUCTURA.md §9`, roadmap `016-limpieza-automatica`; el comentario actual en
  `backend/src/cron/limpieza.ts` referencia "feature 015" para el mismo trabajo — inconsistencia menor
  de numeración preexistente entre el código y `.specify/config.md`, no es parte de esta spec).
  010 solo crea filas; no las borra.
- **Plantillas editables por el administrador** (asunto/cuerpo por acueducto) — mismo criterio que 006
  con el PDF (D-9): sin editor visual, contenido fijo por código.
- **Reenvío periódico de un mismo aviso** (p. ej. recordar la mora cada semana) — ver regla de
  idempotencia en §3.5; un solo aviso por `(factura_id, tipo)`.
- **Cualquier evento de notificación no listado en el requisito 2** (bienvenida, cambio de contraseña,
  etc.) — no mencionados en ningún documento de referencia.

## 5. Reglas de negocio que aplican

De `CLAUDE.md §10` (Notificaciones y entrega de factura):
- **20.** Un fallo de envío de correo **nunca** bloquea la facturación ni el cierre del periodo —
  extendido aquí (§3.4) a que tampoco bloquea el pago, el corte ni la reconexión.
- **20b.** La impresión es el flujo principal; no se genera PDF durante el cierre masivo salvo
  solicitud explícita — sin cambios, 010 no toca la impresión.

De `ESPECIFICACION-FUNCIONAL.md §2.12`: los cuatro eventos base (factura generada, recordatorio de
vencimiento, aviso de mora, confirmación de pago) — más los dos de 009 (corte, reconexión) que su
propia spec asignó a esta feature. "Un suscriptor sin email no rompe la facturación" — extendido aquí
a que tampoco rompe el pago, el corte ni la reconexión.

De `docs/DECISIONES.md` **D-8**: Cloudflare Email Service es el canal vigente (ver §0 sobre por qué
010 no adelanta el cambio a Resend de `docs/INFRAESTRUCTURA-Y-COSTOS.md §4`).

Reglas **nuevas propuestas** por esta feature (a incorporar en `CLAUDE.md §10` cuando se apruebe esta
spec, con la numeración que corresponda):
- Cada `(factura_id, tipo)` genera como máximo una notificación (idempotencia de los avisos por
  tiempo, §3.5).
- Una notificación fallida o pendiente **nunca** revierte ni bloquea la acción de negocio que la
  originó (pago/corte/reconexión ya confirmados quedan confirmados aunque el aviso falle).
- `cliente_id` sigue siendo obligatorio en `notificaciones` sin excepción (`CLAUDE.md §5.4`); una
  alerta operativa de plataforma (§3.8) por definición no puede vivir en esa tabla y se envía por otra
  vía.

De `CLAUDE.md §5.5` (límites de Workers): el Worker de recordatorio/mora es un Cron (hasta 15 min de
CPU, `CLAUDE.md §5.5`), no un fetch — puede recorrer todos los clientes activos sin el límite de 30s
de una invocación HTTP.

## 6. Criterios de aceptación

Cada uno cerrado con evidencia ejecutada y pegada.

### CA-1 — Catálogo cerrado de tipos, sin romper `factura_generada`
Migración agrega la validación del catálogo de 6 tipos (mecanismo exacto es decisión de `/plan`: `CHECK`
o tabla de referencia). Verificado con `supabase db reset --local` + regresión del test de aislamiento
006 existente (`006_correo_factura_aislamiento.sql` sigue en verde) + un insert de prueba con un tipo
inválido que la base rechaza.

### CA-2 — Contenido correcto por tipo (función pura testeable)
Una función por tipo (o una función parametrizada por tipo) que arma `{asunto, cuerpoHtml}` a partir de
los datos del evento (factura/pago/corte/reconexión), sin dependencias de Hono/Supabase — mismo
criterio de `core/` (`CLAUDE.md §5.3`). Tests unitarios (`vitest`) verifican que cada uno de los 6
tipos produce un asunto y cuerpo con los datos correctos (número de factura, monto, fecha, etc.).

### CA-3 — `confirmacion_pago`: integración con 007 sin bloquear el pago
`POST /pagos` sigue respondiendo con éxito y con la misma forma de respuesta aunque el envío de la
notificación falle (stub de envío forzado a fallar). Se verifica con curl real contra `wrangler dev` +
Supabase local: el pago queda registrado en la base pese al fallo simulado del envío, y la fila de
`notificaciones` correspondiente queda `pendiente`/`fallida` con `ultimo_error`.

### CA-4 — `corte_ejecutado` / `reconexion_completada`: integración con 009 sin bloquear
Mismo criterio que CA-3 aplicado a `POST /suscriptores/:id/corte` y `POST /suscriptores/:id/reconexion`
— ambas acciones quedan confirmadas en la base pese a un fallo simulado de envío.

### CA-5 — Recordatorio de vencimiento y aviso de mora: el Worker programado no duplica
Con datos de prueba (facturas con `fecha_vencimiento` dentro del umbral y facturas ya vencidas),
ejecutar el Worker dos veces seguidas produce **una sola** fila por `(factura_id, tipo)` — verificado
con una consulta SQL real contra Supabase local tras dos invocaciones consecutivas del handler.

### CA-6 — Reintentos con límite (reutilización de 006)
`computarActualizacionNotificacion()` se reutiliza sin duplicarse para los 6 tipos — verificado
revisando que solo existe una implementación (`grep`) y que los tests de 006 (`email.ts`) siguen en
verde sin modificación de esa función.

### CA-7 — Panel admin: historial visible y aislado por cliente
`/app/notificaciones` (o la ruta que fije `/plan`) lista las notificaciones del cliente activo,
filtrable por tipo/estado. Test de aislamiento nuevo (`010_notificaciones_aislamiento.sql`, patrón
001-009): el admin del cliente A no ve notificaciones del cliente B. `npm run build`/`lint` limpios.

### CA-8 — Alerta operativa real de `monitor-db.ts`
Con un nivel `alerta`/`critico` simulado (mismo mecanismo de test que ya usa
`nivel-monitoreo.ts`), el Worker llama a la capa de envío real (verificado con el mismo stub de envío
de CA-3/CA-4: se confirma la llamada con el destinatario y contenido esperado). El envío real a un buzón
de Mateo queda, igual que en 006, **NO VERIFICADO — requiere Workers Paid + dominio verificado de la
cuenta de Cloudflare de Mateo**, con pasos exactos.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El Worker de recordatorio/mora duplica avisos si el cron se dispara dos veces (reintento de Cloudflare, redeploy a mitad de corrida) | Regla de idempotencia `(factura_id, tipo)` verificada en CA-5 antes de insertar |
| Acoplar 010 a Resend ahora deja `CLAUDE.md`/D-8 contradiciendo el código | Decisión explícita en §0: 010 usa Cloudflare Email Service; Resend queda como `/specify` separado |
| La alerta de `monitor-db.ts` intenta usar `notificaciones` y rompe la regla "`cliente_id` sin excepciones" | Decisión de diseño en §3.8: la alerta se envía directo, sin pasar por la tabla |
| Un fallo al encolar la notificación de pago/corte/reconexión revierte o bloquea esa acción de negocio | CA-3/CA-4 verifican con un fallo de envío forzado que la acción de negocio queda confirmada igual |
| El contenido de cada tipo queda hardcodeado y difícil de mantener si crecen los tipos | Una función pura por tipo, testeada (CA-2) — mismo patrón ya usado en 006 para el correo de factura |
| Sin Workers Paid/dominio verificado no se puede probar ningún envío real (igual que 006) | Se documenta como NO VERIFICADO con pasos exactos, igual que CA-3 de 006 |

## 8. Definición de terminado

- [ ] Todos los CA (1-8) con evidencia real ejecutada y pegada
- [ ] Build (frontend, `npm run build`) y `npx wrangler deploy --dry-run` (backend) limpios
- [ ] Tests unitarios en verde (contenido por tipo, reutilización de `computarActualizacionNotificacion`)
- [ ] Test de aislamiento nuevo (`010_notificaciones_aislamiento.sql`) en verde, con regresión 001-009
- [ ] `CHANGELOG.md` actualizado al cierre
- [ ] Aprobación explícita de Mateo de: (a) esta spec completa, (b) la decisión de §0 (Resend fuera de
  alcance), (c) la decisión de §3.8 (alerta de `monitor-db.ts` fuera de la tabla `notificaciones`), y
  (d) el valor default de `configuracion.dias_aviso_vencimiento` (§3.5)
- [ ] Un commit por tarea completada y verificada; sin `git push`
