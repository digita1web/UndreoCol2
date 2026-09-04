# SPEC — 008: portal-suscriptor

**Estado:** Borrador para aprobación
**Depende de:** 001-fundacion (`clientes.slug` único, `configuracion`); 003-suscriptores-contadores
(`usuarios_servicio.codigo_suscriptor` + `numero_documento`, tabla `contadores`); 004-lecturas-y-consumo
(`periodos`, `lecturas` — historial de consumo); 005-facturacion (`facturas`, `factura_detalles`,
estados, `snapshot_suscriptor`); 006-impresion-y-correo-factura (generación de PDF con `pdf-lib`,
`backend/src/lib/factura-pdf.ts`); 007-pagos-y-cartera (`pagos`, `pago_aplicaciones`, saldo a favor,
regla de `vencida` derivada por fecha). Aplica D-2, D-4 y **D-10** (nueva, aprobada en este checkpoint:
aislamiento del portal con RPCs `SECURITY DEFINER` acotadas, nunca `SUPABASE_SERVICE_ROLE_KEY`) de
`docs/DECISIONES.md`, `docs/ESPECIFICACION-FUNCIONAL.md §2.5/§2.13/§3` (rol Suscriptor),
`docs/INFRAESTRUCTURA.md §10` y `CLAUDE.md §10` puntos 22b-25. **El contrato de la sesión ya está
fijado en código** — `backend/src/lib/sesion-suscriptor.ts` define `SesionSuscriptor` (`tipo`, `usuarioServicioId`,
`clienteId`, `expiraEn`) y las constantes `DURACION_SESION_SUSCRIPTOR_SEG` (30 días) /
`UMBRAL_RENOVACION_SUSCRIPTOR_SEG` (7 días); esta feature implementa esas tres funciones, no puede
cambiar esa interfaz pública sin justificarlo.

## 1. Objetivo

Dar al **suscriptor final** del acueducto (no al administrador) una interfaz pública de autoservicio
donde, autenticándose sin contraseña con `numero_documento` + `codigo_suscriptor` (D-2), pueda ver su
factura actual, su historial de facturas, descargar el PDF de cualquiera de ellas, consultar su saldo
a favor y revisar su historial de consumo — todo limitado de forma estricta a sus propios datos.

## 2. Por qué ahora

005, 006 y 007 ya cerraron el ciclo económico completo del lado del acueducto (emitir → entregar →
cobrar). 008 es el primer punto de contacto del sistema con el suscriptor final: hasta ahora toda la
información pasaba por una llamada telefónica o una visita a la oficina del acueducto. El roadmap
(`.specify/config.md`) ubica 008 después de 006 y antes de 009 (cortes) y 010 (notificaciones); 007
ya dejó listas las consultas de saldo a favor que el portal solo necesita leer (spec 007 §4: "007 solo
expone las consultas que ese portal consumirá").

## 3. Alcance

### 3.1 Identificación del acueducto en la URL pública

`codigo_suscriptor` es único **solo por `cliente_id`** (`unique (cliente_id, codigo_suscriptor)`,
001-fundacion) y `numero_documento` **no tiene ninguna restricción de unicidad** en el esquema (ni
siquiera por cliente). Sin saber a qué acueducto pertenece el suscriptor, el login no puede resolver
de forma confiable una fila única. El portal reutiliza `clientes.slug` (ya existe, único, formato
validado desde 001) como parte de la URL pública de cada acueducto — el acueducto le comparte a sus
suscriptores un enlace propio (p. ej. `.../portal/{slug}`). El login resuelve primero el `cliente_id`
por el slug y **dentro de ese cliente** busca la fila por `codigo_suscriptor` + `numero_documento`.

### 3.2 Autenticación sin contraseña (D-2, D-4)

- Formulario de acceso con dos campos: `numero_documento` y `codigo_suscriptor` (más el `slug` de la
  URL). Sin contraseña, sin registro previo del suscriptor.
- El servidor valida ambos campos **llamando a una función `SECURITY DEFINER` acotada** (D-10) con el
  `cliente_id` resuelto por el slug — nunca con una consulta de tabla completa desde el Worker. Si
  coinciden, emite la sesión propia (`iniciarSesionSuscriptor`, contrato ya fijado) — un JWT firmado
  con `SESSION_SECRET` (nunca un token de Supabase), en cookie `HttpOnly + Secure + SameSite=Lax`,
  duración 30 días, con **renovación automática** si quedan menos de 7 (D-4, ya en las constantes).
- El JWT lleva `tipo: "suscriptor"`; un middleware de Hono verifica ese campo antes de servir
  cualquier ruta del portal (CLAUDE.md §10-22c) y es completamente independiente de la sesión
  administrativa (`uc_sesion_admin`) — ambas pueden coexistir en el mismo navegador sin mezclarse.
- **Cada consulta de datos del portal** (factura actual, historial, saldo a favor, consumo, PDF) pasa
  también por una función `SECURITY DEFINER` acotada propia (D-10), que revalida las credenciales
  reales del suscriptor internamente — el Worker sigue usando la clave `anon` pública, así que la
  seguridad nunca depende de que la llamada venga del Worker: depende de que quien llama aporte
  credenciales válidas en cada invocación. El JWT de sesión existe para que el suscriptor no tenga que
  volver a escribir su cédula y código en cada página, no como la única prueba de identidad ante la
  base de datos.
- El servidor **verifica el estado del suscriptor en cada petición** (CLAUDE.md §10-22d), no solo en
  el login: un suscriptor cuyo estado cambia a `inactivo` después de haber iniciado sesión pierde el
  acceso en la siguiente petición, no solo en el próximo login.
- Mensajes de error **genéricos**: la respuesta no revela si el campo incorrecto fue el
  `numero_documento` o el `codigo_suscriptor` (evita que alguien confirme que una cédula específica
  existe en el sistema).
- Cierre de sesión explícito (botón salir) que revoca la cookie.

### 3.3 Su factura actual

La factura **más reciente** (por `fecha_emision`) del suscriptor, de cualquier tipo (`ciclo`,
`reconexion`, `ajuste`) que no esté anulada: monto total, fecha de vencimiento y estado. El estado
`vencida` se **deriva de la fecha igual que en la cartera de 007** (CA-6 de esa feature: `pendiente` +
`fecha_vencimiento < hoy`) — nunca un cálculo propio y distinto.

### 3.4 Historial de facturas anteriores

Todas las facturas del suscriptor (todos los tipos), ordenadas de más reciente a más antigua, cada
una con número, tipo, total, estado y saldo (`total − total_pagado`). Las anuladas se muestran
marcadas como tales (con transparencia, igual que 007 nunca oculta un pago anulado) — nunca se
excluyen en silencio de la lista.

### 3.5 Descarga del PDF de cualquier factura

Reutiliza la generación de PDF de 006 (`pdf-lib`, `backend/src/lib/factura-pdf.ts`) y el patrón de
"generar si no existe, o servir el ya generado desde R2" de `GET /facturas/:id/pdf`, pero por una
**ruta y autorización propias del portal**: antes de generar o servir, valida que la factura
solicitada pertenezca al suscriptor autenticado (mismo `usuario_servicio_id` de la sesión). Nunca
reutiliza la ruta administrativa tal cual (esa exige sesión de admin).

### 3.6 Saldo a favor

Mismo cálculo ya verificado en 007 (remanente de pagos vigentes del suscriptor sin aplicar a ninguna
factura, regla 14). El portal solo lo **muestra** — aplicarlo a una factura sigue siendo una acción
del panel administrativo (007), fuera de esta feature.

### 3.7 Historial de consumo

Lecturas de **todos los contadores históricos** del suscriptor (no solo el activo — un reemplazo de
contador, CLAUDE.md §10 punto 7, no debe cortar visualmente el historial), ordenadas por periodo:
fecha de lectura, lectura anterior, lectura actual, consumo en m³.

### 3.8 Recuperación del acceso: el admin regenera el código

`specs/003-suscriptores-contadores/plan.md §5` dejó esto explícitamente pendiente para esta feature:
*"si hace falta regenerar `codigo_suscriptor`, es una acción explícita de la feature 008"*. Sin ella,
un suscriptor que pierde su código queda bloqueado del portal **para siempre**, porque D-2 elimina
cualquier flujo de recuperación por contraseña/correo. Por eso 008 agrega una acción puntual y
administrativa (el admin del acueducto, nunca el lector) para asignarle un nuevo `codigo_suscriptor`
a un suscriptor. Regenerar el código **no cierra** una sesión ya activa de ese suscriptor (el JWT no
lleva el código, solo el `usuario_servicio_id`) — solo afecta los próximos inicios de sesión.

## 4. Fuera de alcance

- **Pagos en línea** — no está en el roadmap actual (fuera del sistema, `ESPECIFICACION-FUNCIONAL.md
  §4`).
- **Edición de datos propios** (nombre, dirección, teléfono, email, categoría) — el suscriptor no
  edita nada; cualquier corrección la hace el admin del acueducto desde el panel (003).
- **Aplicar el saldo a favor a una factura** — el portal solo lo muestra (§3.6); aplicarlo sigue
  siendo una acción del panel administrativo de 007.
- **Cualquier otra acción administrativa** más allá de la puntual del §3.8 (regenerar código): el
  suscriptor no ve ni afecta a otros suscriptores, tarifas, órdenes de corte, ni nada del panel.
- **Recuperación de código por correo/SMS automatizada** — D-2 no usa contraseñas ni flujos de
  recuperación por email; la única vía es el admin (§3.8).
- **Notificaciones** (recordatorios, confirmación de pago) — feature 010; el portal no envía nada,
  solo muestra datos ya existentes bajo demanda.
- **App/PWA dedicada del suscriptor** — el portal es una sección web responsiva del mismo Next.js
  (`frontend/`, ver `ARQUITECTURA.md`), no una PWA con soporte offline; eso es la 014 y es exclusiva
  del lector/fontanero.
- **Cortes y reconexiones (2.11)** — feature 009; el portal no ejecuta ni solicita cortes/reconexiones,
  solo puede mostrar que el suscriptor está `cortado` como parte de su estado.
- Multi-idioma.

## 5. Reglas de negocio que aplican

De `docs/ESPECIFICACION-FUNCIONAL.md`:
- §2.5 — El suscriptor no tiene cuenta en el sistema de autenticación; accede con
  `numero_documento` + `codigo_suscriptor` validados en el Worker; sesión propia de 30 días con
  renovación automática, cookie `HttpOnly + Secure + SameSite=Lax`.
- §2.13 — El suscriptor consulta su factura actual, su historial de consumo y descarga el PDF de su
  factura bajo demanda.
- §3 (rol Suscriptor) — No tiene cuenta en el sistema de identidad (D-2); solo ve sus propios datos;
  nunca ve datos de otros suscriptores.
- §4 — Sin pasarelas de pago en línea (fuera del sistema).

De `docs/DECISIONES.md` y `CLAUDE.md`:
- D-2 — Sin `auth.users`, sin contraseña; validación server-side + sesión propia.
- D-4 — Duración 30 días, renovación si quedan menos de 7; cookie `HttpOnly + Secure + SameSite=Lax`;
  el JWT lleva `tipo: "suscriptor"`.
- CLAUDE.md §10-22b a 22e — contrato exacto de la sesión (ver también `INFRAESTRUCTURA.md §10` y
  `backend/src/lib/sesion-suscriptor.ts`, ya fijado en código).
- CLAUDE.md §10 punto 25 — el suscriptor no tiene rol en `membresias`; el aislamiento del portal se
  resuelve del lado del Worker, **no** con `auth.uid()`. Resuelto con **D-10**: funciones `SECURITY
  DEFINER` acotadas invocadas con la clave `anon`, nunca `SUPABASE_SERVICE_ROLE_KEY` (que sigue
  prohibida en rutas de usuario por CLAUDE.md §5.4/§12, sin excepción).
- CLAUDE.md §10 punto 15 (`limite_basico_m3` inclusivo) y las reglas de facturación de 005/007 no
  cambian: el portal solo **lee** valores ya calculados, nunca recalcula nada de dinero.

De 007 (`specs/007-pagos-y-cartera/spec.md`): regla 14 (sobrante a favor) y CA-6 (estado `vencida`
derivado de la fecha, nunca persistido como transición directa).

## 6. Criterios de aceptación

Cada uno cerrado con evidencia ejecutada y pegada (CLAUDE.md §4).

### CA-1 — Login por acueducto + credenciales sin contraseña
Con el `slug` de un acueducto real y `numero_documento` + `codigo_suscriptor` correctos → sesión
iniciada, cookie propia del portal presente. Con cualquiera de los dos campos incorrecto → rechazo
con el **mismo mensaje genérico** (no distingue cuál falló). Con un suscriptor en estado `inactivo` →
rechazo explícito. Con estado `activo`, `suspendido` o `cortado` → acceso permitido (confirmado: un
suscriptor `cortado`/`suspendido` necesita ver su deuda para poder regularizar su situación).

### CA-2 — Aislamiento estricto del portal (D-10)
Un suscriptor autenticado no puede leer, ni manipulando ids en la URL/API, facturas, pagos, lecturas
ni datos de otro suscriptor del mismo acueducto ni de otro acueducto. Ni siquiera invocando las
funciones `SECURITY DEFINER` del portal directamente con la clave `anon` pública (sin pasar por el
Worker) se puede leer el dato de un suscriptor sin aportar también su `numero_documento` +
`codigo_suscriptor` reales — un `usuario_servicio_id` conocido o adivinado, por sí solo, no basta.
Verificado con un test de aislamiento real (mismo patrón que 001-007), esta vez simulando llamadas
directas a las funciones del portal en vez de un rol de Postgres autenticado por Supabase Auth.

### CA-3 — Sesión propia del portal (D-4)
Cookie con `tipo: "suscriptor"`, 30 días de duración, renovación automática si quedan menos de 7.
Coexiste sin interferencia con una sesión administrativa activa en el mismo navegador. Cerrar sesión
revoca la cookie del portal sin afectar una sesión administrativa paralela (y viceversa).

### CA-4 — Factura actual e historial
La factura actual mostrada es la de `fecha_emision` más reciente no anulada, con su estado correcto
(incluida `vencida` derivada de la fecha). El historial lista todas sus facturas, más reciente
primero, con las anuladas visiblemente marcadas.

### CA-5 — Descarga de PDF restringida al propio suscriptor
Descargar el PDF de una factura propia funciona. Intentar descargar el PDF de una factura de **otro**
suscriptor (propio u otro acueducto) usando su id directamente → rechazo (403/404), nunca el archivo.

### CA-6 — Saldo a favor consistente con 007
El valor mostrado coincide exactamente con la misma regla ya verificada en 007 (remanente de pagos
vigentes sin aplicar).

### CA-7 — Historial de consumo sin cortes por reemplazo de contador
Un suscriptor con más de un contador histórico (reemplazo, CLAUDE.md §10 punto 7) ve el consumo de
**todos** sus contadores en una sola línea de tiempo, sin duplicar ni perder periodos.

### CA-8 — Regenerar código de suscriptor (admin)
El admin del acueducto asigna un nuevo `codigo_suscriptor` a un suscriptor. El `lector` no puede
hacerlo (rechazado por RLS, no solo por la interfaz). Una sesión de portal ya activa de ese
suscriptor sigue funcionando después del cambio; un login posterior exige el código nuevo.

### CA-9 — Mitigación de fuerza bruta en un login sin contraseña
Tras un umbral de intentos fallidos consecutivos, el sistema bloquea temporalmente nuevos intentos
(mecanismo exacto a definir en `/plan`). Los mensajes de error nunca revelan cuál de los dos campos
fue el incorrecto (cubierto también por CA-1).

### CA-10 — Panel del portal (frontend)
Páginas de login, factura actual, historial, saldo a favor y consumo, con `build`/`lint`/`tsc`
limpios. El flujo click-a-click puede quedar "NO VERIFICADO — requiere validación manual de Mateo:
[pasos exactos]" si el entorno no permite `next dev` + `wrangler dev` (mismo patrón usado en 007
T-005).

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El aislamiento de datos del portal no puede apoyarse en las políticas RLS existentes: dependen de `auth.uid()` (Supabase Auth), que **no existe** para el suscriptor (D-2) | **Resuelto: D-10.** Funciones `SECURITY DEFINER` acotadas (mismo patrón de `es_admin_de()`/`tarifa_vigente()`), invocadas con la clave `anon`; cada una revalida `numero_documento`+`codigo_suscriptor` internamente y nunca expone acceso de tabla completa. `SUPABASE_SERVICE_ROLE_KEY` nunca se usa en rutas del portal (CLAUDE.md §5.4/§12 se respeta sin excepción) |
| Colisión de credenciales entre acueductos: `codigo_suscriptor` es único solo por `cliente_id` y `numero_documento` no tiene restricción de unicidad en el esquema | **Resuelto (§3.1):** la URL del portal identifica el acueducto por `clientes.slug` antes de buscar la fila |
| Fuerza bruta sobre un login sin contraseña (`codigo_suscriptor` suele ser corto/secuencial) | CA-9: límite de intentos + mensajes genéricos; `/plan` define el mecanismo exacto |
| Descarga de PDF de otro suscriptor por manipulación de la URL (IDOR) | CA-5: cada descarga valida `usuario_servicio_id` contra la sesión verificada antes de generar/servir |
| Un suscriptor `cortado`/`inactivo` con acceso indebido (o al revés, bloqueado sin deber estarlo) | **Resuelto (CA-1):** solo `inactivo` bloquea el login; `activo`/`suspendido`/`cortado` acceden |
| El código regenerado (§3.8) no invalida sesiones activas con el código viejo | Documentado como comportamiento esperado (el JWT no lleva el código); si Mateo prefiere invalidar sesiones activas al regenerar, requiere un mecanismo adicional (lista de revocación) a decidir en `/plan` |

## 8. Definición de terminado

- [x] Todos los CA (1-10) con evidencia real — CA-1/CA-9 contra Supabase local (RPCs, fuerza bruta,
  inactivo) + curl/wrangler dev; CA-2 aislamiento 008; CA-3 a CA-7 con curl (login, facturas,
  PDF/IDOR, saldo, consumo); CA-8 (regenerar código: 200/401/403/409 + sesión previa sin datos por
  D-10); CA-10 (frontend del portal) con build/lint/tsc limpios y **separación de sesiones
  admin/suscriptor verificada con curl**; el flujo click-a-click queda NO VERIFICADO con pasos
  exactos para Mateo.
- [x] El aislamiento del portal se implementa exactamente como fija D-10 (funciones `SECURITY
      DEFINER` acotadas, `anon`, sin `SUPABASE_SERVICE_ROLE_KEY`) — con evidencia real en el cierre
      (grants solo a `anon`; ninguna ruta del portal usa `service_role`).
- [x] Build (frontend, `next build` 12 páginas + Middleware 34.3 kB) y `wrangler deploy --dry-run`
      (backend, 1725.97 KiB/gzip 393.26 KiB) limpios.
- [x] Test de aislamiento del portal en verde, con regresión de 001-007 (008 pasa: `PORTAL-AISLAMIENTO
      OK`; regresión 001-007 OK sobre el mismo estado final tras `supabase db reset --local`).
- [x] `CHANGELOG.md` actualizado en el cierre de la feature (Sesión 015).
- [x] Aprobación explícita de Mateo — spec, plan y tasks aprobados antes de cada fase.
- [x] Un commit por tarea completada y verificada; sin `git push` (Mateo lo aplica / bundle si aplica).
- Commits de la feature 008: `ec7d0b6` (T-001), `dc3fe2a` (T-002), `de7f386` (T-003), `44b078d`
  (T-004), `b2cf83b` (T-005), `ee8a5e2` (T-006), + el de cierre (T-007).
