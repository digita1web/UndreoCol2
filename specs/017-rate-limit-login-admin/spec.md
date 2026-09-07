# SPEC — 017: rate-limit-login-admin

**Estado:** **Aprobado (2026-09-07)** — Mateo resolvió las decisiones de §0.3 (mecanismo: tabla en
PostgreSQL) y §0.4 (bloqueo: retardo progresivo), y con la primera queda aprobada la excepción de
§3.1 (tabla sin `cliente_id`). `plan.md` escrito; **pendiente de aprobación de `plan.md` antes de
`/tasks`** (`CLAUDE.md §3`). No se escribe código hasta ese checkpoint.

**Origen:** hallazgo **A-2 (severidad ALTA)** de la auditoría de seguridad pre-producción
(`docs/PLAN-PRODUCCION.md`, CHANGELOG Sesión 027).

**Depende de:** 001-fundacion (`configuracion`, patrón de RLS `FORCE`, funciones `SECURITY DEFINER`);
008-portal-suscriptor (`portal_intentos_login` y `portal_validar_credenciales`, que son el **patrón a
replicar** — esta feature es su equivalente para el login administrativo). Ambas completas.

---

## 0. Contexto, contradicciones señaladas y decisiones a resolver antes de /plan

### 0.1 Numeración de la feature — por qué 017 y no 013

La auditoría propuso esta corrección sin número. El roadmap de `.specify/config.md` ya tiene
**reservados** 013 (`exportes-contables`), 014 (`rrhh-incapacidades`), 015 (`qr-ocr-lector`) y 016
(`limpieza-automatica`), todos en estado Pendiente. Tomar 013 habría pisado una feature planificada,
así que esta toma el siguiente número libre: **017**.

**El número NO indica el orden de ejecución.** Esta feature es un **prerrequisito de producción**: debe
implementarse **antes** de migrar el acueducto piloto, por delante de 013-016. Si Mateo aprueba,
`.specify/config.md` debe reflejarlo en la misma tarea (fila nueva con la nota "prerrequisito de
producción, va antes que 013").

### 0.2 Contradicción con `docs/ESPECIFICACION-FUNCIONAL.md` — no la hay, es un vacío

La EF describe el login administrativo (§3, roles) pero **no dice nada sobre intentos fallidos ni
bloqueo**. El portal sí lo tiene especificado y construido (008, CA-9). No es una contradicción: es
una ausencia. Esta spec la llena y, si se aprueba, la EF debe recibir un párrafo equivalente al de
§2.5 del portal. Se señala aquí porque `CLAUDE.md §8` obliga a decirlo antes, no después.

### 0.3 DECISIÓN RESUELTA — mecanismo: **tabla en PostgreSQL** (aprobado 2026-09-07)

Hay dos formas de implementar esto y **la elección la toma Mateo**, no esta spec. Se documentan las
dos con su costo real:

| | **Opción A — tabla en PostgreSQL** | **Opción B — binding nativo de Cloudflare** |
|---|---|---|
| Mecanismo | Tabla `admin_intentos_login` + función `SECURITY DEFINER`, calcado de `portal_intentos_login` (008) | Binding de *Rate Limiting* de Workers, declarado en `wrangler.toml` |
| Qué cuenta | Intentos fallidos **por email** | Peticiones **por clave** (email, IP, o ambos), en ventana fija |
| Persistencia | Duradera: sobrevive reinicios y es auditable con SQL | Efímera y **por centro de datos**; no es un contador global exacto |
| Coherencia con el proyecto | **Alta**: mismo patrón, mismo lenguaje, mismos tests de aislamiento que 008 | Nueva pieza de infraestructura, fuera del esquema versionado |
| Verificabilidad (`CLAUDE.md §4`) | **Alta**: se prueba con `psql` y con el test de aislamiento, igual que 008 | Baja en local; el comportamiento real solo se observa desplegado |
| Portabilidad (`CLAUDE.md §5.2.4`) | Se va con la base a cualquier runtime | Ata la protección a Cloudflare |
| Costo en Supabase Free | Una fila por email probado; **exige purga** (ver §3.5) | Cero |
| Coste de bloqueo distribuido | Contador exacto (la base es el punto único) | Un atacante repartido entre regiones multiplica el umbral |

**APROBADO: Opción A** (Mateo, 2026-09-07), por coherencia, verificabilidad y portabilidad — los
tres criterios con los que se decidió 008. La Opción B se descarta como sustituto: es efímera, por
centro de datos y no verificable en local, lo que choca con `CLAUDE.md §4`. Queda anotada como
posible **complemento** futuro (filtrar en el borde antes de gastar una invocación de base), con su
propia spec si algún día se quiere.

Al elegir la Opción A queda **también aprobada** la excepción de §3.1: la tabla nueva no lleva
`cliente_id`.

### 0.4 DECISIÓN RESUELTA — qué se cuenta y qué se bloquea: **retardo progresivo** (aprobado 2026-09-07)

El portal cuenta por `(cliente_id, numero_documento)`. El login administrativo **no conoce el
`cliente_id`**: la membresía se resuelve *después* de autenticar. Así que la clave solo puede ser el
email. Eso abre una decisión de negocio real:

- **Bloquear por email** protege la cuenta, pero permite un ataque de **denegación de servicio contra
  una persona concreta**: quien conozca el correo del administrador del acueducto puede dejarlo fuera
  del panel a voluntad, fallando adrede. En un acueducto con **un solo administrador**, eso es
  bloquear la facturación del mes.
- **No bloquear** deja la contraseña expuesta a fuerza bruta sin costo, que es el hallazgo A-2.

**APROBADO (Mateo, 2026-09-07): retardo progresivo, no puerta cerrada.** A partir del umbral, cada
intento responde 429 con un `reintentar_en` que crece (1, 2, 4, 8… minutos hasta un techo), y **un
acierto de contraseña, una vez pasada la espera, reinicia el contador**. Así el atacante paga un
costo que crece exponencialmente mientras el administrador legítimo, que sabe su contraseña, recupera
el acceso en el primer intento correcto tras esperar el retardo vigente.

Se descarta el bloqueo fijo estilo portal (8 intentos → 15 min constantes): con un techo fijo, quien
conozca el correo del administrador lo mantiene fuera del panel indefinidamente fallando adrede cada
15 minutos, a coste cero. El retardo progresivo no elimina ese ataque, pero obliga al atacante a
sostenerlo en el tiempo con espera creciente, y el acierto lo corta de raíz.

Se descarta también la variante con aviso por correo al admin: añade un camino de notificación nuevo
que hay que probar y amplía el alcance. Queda anotada en §4 como posible mejora posterior.

**Nota de coherencia (importante para `/plan`):** durante la espera, **ni siquiera la contraseña
correcta entra** (CA-1). Si un acierto pudiera saltarse el bloqueo, el bloqueo no protegería de nada:
la fuerza bruta consiste precisamente en acertar. El reinicio por acierto (CA-2) aplica *antes* de
alcanzar el umbral y *después* de que expire la espera, nunca durante.

### 0.5 Lo que esta spec NO puede arreglar y hay que saberlo

El Worker actúa de intermediario ante Supabase Auth (GoTrue): **todas** las peticiones de login salen
desde IPs de Cloudflare. Cualquier límite por IP que Supabase aplique del lado de GoTrue no puede
distinguir a un atacante de un usuario legítimo. Esta feature añade el control **antes** de llegar a
GoTrue, que es el único punto donde el sistema puede decidir con información propia. No pretende
sustituir a un WAF ni a la protección del proveedor.

---

## 1. Objetivo

Que adivinar la contraseña de una cuenta administrativa de UndreoCol **cueste tiempo**, en lugar de
ser gratis e ilimitado como hoy.

## 2. Por qué ahora

Verificado en la auditoría (`docs/PLAN-PRODUCCION.md`, A-2): `POST /auth/login` no tiene rate limiting
de ningún tipo — ni en el Worker, ni en `wrangler.toml`, ni como regla documentada de WAF en
`docs/INFRAESTRUCTURA.md`. La única protección de fuerza bruta que existe en todo el sistema
(`portal_intentos_login`, 008) cubre el portal del suscriptor: **la cuenta de menos valor**.

La cuenta `admin_acueducto` es el control total del acueducto: cambiar tarifas, anular facturas, ver
el registro completo de suscriptores con cédula y dirección, y todo el recaudo. El acueducto piloto
entra a producción con esa puerta sin cerradura.

## 3. Alcance

### 3.1 Contador de intentos fallidos del login administrativo

Tabla nueva, calcada de `portal_intentos_login` (008):

- Clave: el **email** normalizado (minúsculas, `trim`) — es lo único conocido antes de autenticar.
- Guarda: intentos consecutivos fallidos, momento hasta el que está bloqueado, último intento.
- **Sin `cliente_id`**: es la excepción documentada a `CLAUDE.md §5.4` ("toda tabla de negocio lleva
  `cliente_id`"). No es una tabla de negocio: es infraestructura de autenticación, anterior a la
  resolución del tenant, igual que `_keepalive` no lleva `cliente_id`. **Esta excepción hay que
  aprobarla explícitamente**, no darla por hecha.
- RLS `ENABLE` + `FORCE` y **sin ninguna política**: nadie la lee ni la escribe directamente. Solo la
  toca la función `SECURITY DEFINER` de §3.2. Mismo mecanismo que `portal_intentos_login`.

### 3.2 Función de registro y consulta del bloqueo

Una función `SECURITY DEFINER` (o dos, se decide en `/plan`) que:

- Dice si un email está bloqueado y hasta cuándo.
- Registra un intento fallido y calcula el nuevo retardo.
- Reinicia el contador ante un acierto.

**Requisito de seguridad no negociable, aprendido de C-1:** la función recibe el email como parámetro
y corre sin RLS. Debe estar otorgada **solo a `anon`** (el Worker la llama sin sesión), con `revoke`
explícito a `public`, y **no puede devolver ninguna información sobre si el email existe** (§3.4).
Toda función `SECURITY DEFINER` nueva lleva `set search_path = public`.

### 3.3 Integración en `POST /auth/login`

1. Normaliza el email.
2. Consulta el bloqueo **antes** de llamar a `signInWithPassword`. Si está bloqueado → **429** con
   `reintentar_en`, sin tocar GoTrue.
3. Si no está bloqueado, autentica como hoy.
4. Fallo → registra el intento. Acierto → reinicia el contador.

El contrato de la respuesta 429 es **el mismo que ya devuelve el portal**
(`{ error, reintentar_en }`, `backend/src/index.ts:1434`): un solo formato de "demasiados intentos" en
todo el sistema.

### 3.4 No revelar si el email existe

El sistema **no debe** comportarse distinto ante un email registrado y uno que no. Hoy `POST
/auth/login` ya devuelve siempre el mismo `401 Credenciales inválidas`, y eso se conserva. La feature
no puede introducir un canal nuevo: si un email inexistente nunca se bloqueara y uno existente sí,
el propio 429 se convierte en un oráculo de enumeración de cuentas. Cómo evitarlo (contar también los
emails inexistentes, aceptando el costo en filas, u otra vía) es **decisión de `/plan`**, pero el
criterio de aceptación CA-4 es innegociable.

### 3.5 Purga

Cada email distinto probado crea una fila permanente. Con la base de 500 MB de Supabase Free
(`ARQUITECTURA.md §6`), un atacante que itere emails hace crecer la tabla sin techo. La purga es
**parte de esta feature**, no de la 016: las filas sin actividad reciente y sin bloqueo vigente se
borran. Se implementa dentro de `cron/limpieza.ts`, que hoy declara explícitamente que no tiene nada
que purgar. Esto **corrige de paso el hallazgo M-6** si se extiende también a `portal_intentos_login`
— decisión de alcance a confirmar en `/plan`.

### 3.6 Configurabilidad

Umbral, retardo base y techo del retardo son configurables, pero **globales** (una fila de sistema o
constantes en la migración), no por acueducto: el tenant es desconocido cuando se aplica el control.
Esto se aparta a propósito del patrón de `configuracion.portal_umbral_intentos_login`, y es
consecuencia directa de §0.4.

## 4. Fuera de alcance

- **Rate limiting general de la API.** Esta feature cubre el login administrativo y nada más.
- **Rate limiting por IP.** Ver §0.5: el Worker no puede distinguir IPs de forma fiable para esto.
- **CAPTCHA, MFA o segundo factor.** Son la respuesta correcta a este riesgo a largo plazo, y merecen
  su propia spec. Aquí no.
- **Cambiar la protección del portal** (`portal_intentos_login`, 008). Se toma como patrón; no se toca
  su lógica. La única excepción posible es extenderle la purga (§3.5), si se aprueba.
- **Cerrar el registro público** (hallazgo M-5). Es una decisión de producto, no de esta feature.
- **Cabeceras de seguridad, CSRF, CORS** (hallazgos M-4, B-4, B-6). Otras tareas.

## 5. Reglas que aplican

- `CLAUDE.md §4` — ningún CA se cierra sin evidencia ejecutada. "Debería bloquear" no vale.
- `CLAUDE.md §5.4` — RLS `FORCE`; la excepción de "sin `cliente_id`" queda justificada y aprobada en
  §3.1, no asumida.
- `CLAUDE.md §7` — sin `any`, sin `console.log`, sin `catch` vacío. Un fallo del contador **no puede
  dejar pasar el login en silencio**: si la función de bloqueo falla, se decide en `/plan` si el login
  falla cerrado (más seguro) o abierto (más disponible). Es una decisión con consecuencias: se
  documenta y se aprueba, no se improvisa.
- `CLAUDE.md §9` — un commit por tarea verificada; la IA no hace `push`.
- **Lección de C-1 (auditoría):** toda función `SECURITY DEFINER` nueva se audita explícitamente
  contra el patrón del "identificador desnudo" antes de darla por terminada.

## 6. Criterios de aceptación

Cada CA se cierra con evidencia real: `curl` contra `wrangler dev` + Supabase local, consulta SQL de
contraste, o test de aislamiento ejecutado.

### CA-1 — El umbral bloquea de verdad
Con el umbral configurado en N, N intentos fallidos consecutivos contra el mismo email hacen que el
intento N+1 devuelva **429** con `reintentar_en`, **incluso si la contraseña de ese intento es
correcta**. Verificación: `curl` real en bucle contra `wrangler dev`, mostrando la secuencia completa
de códigos de estado, más `SELECT` de contraste sobre la tabla.

### CA-2 — El acierto reinicia el contador
Tras k < N fallos, un login correcto devuelve 200 y deja el contador de ese email en 0. Verificación:
`curl` + `SELECT` de contraste.

### CA-3 — El bloqueo expira y el retardo crece
Pasado `reintentar_en`, el mismo email puede volver a intentar. Tras un nuevo bloqueo, el retardo es
mayor que el anterior (§0.4). Verificación: manipulando `bloqueado_hasta` por SQL para no esperar en
tiempo real, y comprobando los dos retardos calculados.

### CA-4 — No se puede enumerar cuentas (innegociable, §3.4)
Un email **registrado** y uno **inexistente** producen exactamente la misma secuencia de códigos de
estado y los mismos cuerpos de respuesta ante la misma secuencia de intentos, incluida la transición
al 429. Verificación: dos series de `curl` idénticas salvo el email, con los cuerpos y códigos
pegados lado a lado. Cualquier diferencia observable falla el CA.

### CA-5 — El login legítimo no se degrada
Un administrador que escribe bien su contraseña a la primera entra igual que hoy, y la latencia
añadida es la de una consulta indexada. Verificación: `curl` con `-w '%{time_total}'` antes y después
del cambio, sobre el mismo entorno.

### CA-6 — Aislamiento y privilegios de la pieza nueva
Test de aislamiento nuevo (serie **900+**, no de feature — ver
`tests/aislamiento/900_auditoria_consecutivo_factura_aislamiento.sql`): la tabla tiene RLS `ENABLE` +
`FORCE`; ni `anon` ni `authenticated` pueden leerla, insertarla, actualizarla ni borrarla
directamente; la función nueva **no está otorgada a `public`**; y —siguiendo la lección de C-1— la
función no permite a un llamante afectar el contador de un email arbitrario de forma que rompa la
cuenta de otra persona más allá de lo que ya permite el propio formulario de login. Regresión de las
suites 001-012 y 900 ejecutada y reportada.

### CA-7 — Purga (§3.5)
El Worker de limpieza borra las filas caducadas y **no** borra las de bloqueo vigente. Verificación:
sembrar filas caducadas y vigentes, ejecutar el `scheduled` en local, y `SELECT` de contraste.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| **DoS dirigido contra el administrador del acueducto** (§0.4) | Retardo progresivo en vez de puerta cerrada; el acierto reinicia. Si aun así preocupa, `/plan` debe evaluar una vía de recuperación fuera de banda antes de aprobar. |
| El 429 se convierte en oráculo de enumeración | CA-4, innegociable. |
| Crecimiento no acotado de la tabla en Supabase Free | §3.5, purga dentro del alcance. |
| Fallo de la función de bloqueo deja pasar el login | Decisión explícita "falla cerrado / falla abierto" en `/plan` (§5). |
| Falsa sensación de seguridad | Esta feature sube el costo del ataque; no es MFA. Queda dicho en §4. |

## 8. Definición de terminado

- [ ] Decisiones §0.3 (mecanismo) y §0.4 (qué se bloquea) **aprobadas explícitamente por Mateo**
- [ ] Excepción de `cliente_id` en la tabla nueva (§3.1) aprobada explícitamente
- [ ] CA-1 a CA-7 con evidencia real ejecutada y pegada
- [ ] Migración versionada en `supabase/migrations/` (nunca cambios a mano en el panel de Supabase)
- [ ] Test de aislamiento nuevo (serie 900+) en verde + regresión 001-012 y 900 ejecutada y reportada
- [ ] `npm run build` (tsc) y `npm run lint` limpios en backend; `npx wrangler deploy --dry-run` OK
- [ ] Tests unitarios del cálculo del retardo progresivo en `core/` (es lógica pura, §5.3)
- [ ] `docs/ESPECIFICACION-FUNCIONAL.md` actualizada con el párrafo que hoy falta (§0.2)
- [ ] `.specify/config.md` con la fila 017 y la nota de "prerrequisito de producción" (§0.1)
- [ ] `docs/PLAN-PRODUCCION.md`: A-2 marcado como resuelto, con el commit
- [ ] `CHANGELOG.md` actualizado
- [ ] Un commit por tarea verificada; sin `git push` (el comando se le entrega a Mateo)
