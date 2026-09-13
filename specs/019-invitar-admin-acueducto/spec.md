# SPEC — 019: invitar-admin-acueducto

**Estado:** Borrador para aprobación
**Depende de:** 018-panel-plataforma, 033-credenciales-plataforma, 034-completar-recuperacion

## 1. Objetivo

Reemplazar la contraseña temporal que hoy genera `POST /plataforma/acueductos` por una invitación
real por correo: el admin nuevo de un acueducto recibe un enlace para definir su propia contraseña,
en vez de que el superadmin la vea en pantalla una sola vez y tenga que entregársela a mano por un
canal aparte.

## 2. Por qué ahora

- `docs/ESPECIFICACION-FUNCIONAL.md §3` ya documenta esto como la mejora pendiente de 018: *"no hay
  invitación por correo con autoservicio (mejora futura, feature 019)"*.
- Riesgo operativo real hoy: la contraseña de 20 caracteres se genera con
  `generarContrasenaTemporal()` y se muestra una sola vez en `plataforma-form.tsx:77-90` — el
  superadmin tiene que copiarla y pasarla "por un canal seguro". Es manual, propenso a error de
  transcripción, y la especificación funcional anota además que el sistema **no fuerza cambiarla en
  el primer login** — con el diseño de este spec ese segundo problema se resuelve solo, como efecto
  colateral: la cuenta nueva no tiene ninguna contraseña usable hasta que el admin sigue el enlace.
- 033 y 034 ya construyeron y verificaron de punta a punta (Sesiones 051-052) exactamente el
  mecanismo que hace falta acá — `resetPasswordForEmail` + `/restablecer-contrasena`. Cero
  infraestructura nueva; se reutiliza lo ya probado contra `wrangler dev` real.

## 3. Alcance

### 3.1 `POST /plataforma/acueductos` deja de generar y devolver una contraseña
`signUpAdminAcueducto` (`backend/src/lib/plataforma.ts:57`) sigue creando la cuenta en
`auth.users` — `signUp` exige un valor de contraseña — pero con un valor aleatorio interno que
**nunca se devuelve al cliente ni se loguea**: nadie lo necesita, porque el admin nuevo la va a
reemplazar por el enlace de invitación antes de poder iniciar sesión con ella.

### 3.2 Alta = signUp + el mismo envío que ya usa `/auth/recuperar`
Inmediatamente después de `asignarAdminAcueducto` (paso 3 ya existente en `POST
/plataforma/acueductos`, `backend/src/index.ts:479`), la ruta dispara el mismo
`resetPasswordForEmail(correoAdmin, { redirectTo: '.../restablecer-contrasena' })` que hoy vive en
`POST /auth/recuperar` (`backend/src/index.ts:220-237`). Se extrae a una función compartida (nombre
y ubicación exacta se deciden en `/plan`) para que ambas rutas llamen la misma implementación — no
se duplica el bloque.
La respuesta `201` deja de incluir `contrasenaTemporal`; confirma en su lugar que el correo de
invitación se envió (o, si falló, lo dice explícito — ver §3.5).

### 3.3 Frontend: `plataforma-form.tsx` ya no muestra una contraseña
El bloque de éxito (líneas 77-90) deja de renderizar el `<code>` con la contraseña; en su lugar
confirma "Se envió una invitación a `{correoAdmin}` para que defina su contraseña." Mismo
componente, mismo formulario — no se agrega ninguna pantalla nueva.

### 3.4 `supabase/templates/recovery.html` se reescribe en términos neutros
El texto actual — *"Recibimos una solicitud para restablecer la contraseña de tu cuenta..."* — no
tiene sentido para un admin que nunca tuvo contraseña. Se reescribe a algo que sirva, sin mentir, en
los dos casos (invitación nueva y recuperación real de una cuenta existente): por ejemplo, *"Definí
tu contraseña de UndreoCol"* + enlace + *"Si no esperabas este correo, podés ignorarlo con
tranquilidad."* Un solo archivo, el mismo de siempre — no se crea `auth.email.template.invite` (ver
§7, por qué se descarta esa vía nativa).

### 3.5 Fallo de envío al momento del alta: mismo camino de reintento que ya existe, sin código nuevo
Si el correo de invitación falla al crear el acueducto (red, límite de envíos de Supabase, etc.), el
acueducto y el admin ya quedaron creados igual (regla 20, CLAUDE.md §10 — un fallo de correo nunca
bloquea el flujo principal). El superadmin puede reintentar con el botón "Restablecer contraseña"
que 033 ya puso por acueducto en `/plataforma` (`§3.2` de ese spec) — es la **misma llamada exacta**
contra el mismo email. Se documenta este comportamiento para que quede explícito como criterio de
aceptación (§6, CA-4); no se escribe ningún mecanismo de reintento nuevo.

## 4. Fuera de alcance

- **`auth.admin.inviteUserByEmail`** (el mecanismo nativo de Supabase para invitar) — exige
  `service_role_key` desde una ruta que atiende al superadmin. Prohibición absoluta, CLAUDE.md §12.
  Descartado explícitamente; ver alternativas en §7.
- **Una pantalla de "primer login" distinta a la de recuperación** — `/restablecer-contrasena` (034)
  ya alcanza tal cual está; no se crea una ruta ni un componente nuevo para distinguir "invitación"
  de "recuperación" en la experiencia del admin nuevo.
- **Expirar o revocar la invitación si el admin nunca la usa** — mismo comportamiento que ya trae
  `resetPasswordForEmail` (el enlace expira solo, por configuración de Supabase Auth); no se agrega
  gestión propia de invitaciones pendientes.
- **Reenvío automático** (ej. recordatorio a los N días si no la usó) — no está pedido, no está en
  la especificación funcional.
- **Invitar a roles distintos de `admin_acueducto`** (secretaria, lector) — ese alta es hoy
  responsabilidad del propio `admin_acueducto` dentro de su acueducto, no de este spec ni del panel
  de plataforma.

## 5. Reglas de negocio que aplican

- `SUPABASE_SERVICE_ROLE_KEY` nunca en una ruta de API que atiende peticiones de usuario (CLAUDE.md
  §12) — motivo central de este spec; ver §7.
- Un fallo de envío de correo nunca bloquea el flujo principal (regla 20, CLAUDE.md §10) — el alta
  del acueducto y su admin no se revierte si el correo de invitación falla.
- El correo no debe revelar si una cuenta ya existía o no — mismo comportamiento que
  `resetPasswordForEmail` ya garantiza hoy (033 §5), sin cambios.

## 6. Criterios de aceptación

### CA-1 — Dar de alta un acueducto ya no expone ninguna contraseña
Ni la respuesta de `POST /plataforma/acueductos` ni la UI de `/plataforma` muestran, en ningún
momento, una contraseña para la cuenta nueva.

### CA-2 — El admin nuevo puede iniciar sesión siguiendo el enlace de invitación
Flujo de punta a punta con el correo real (Inbucket/Mailpit en local): dar de alta un acueducto de
prueba → el admin recibe el correo → sigue el enlace a `/restablecer-contrasena` → define su
contraseña → inicia sesión con ella → éxito.

### CA-3 — Antes de seguir el enlace, la cuenta nueva no tiene ninguna contraseña utilizable
Ni el superadmin ni nadie más puede iniciar sesión como el admin nuevo antes de que este complete el
flujo del enlace.

### CA-4 — Si el envío de la invitación falla, el alta no se pierde y hay una vía de reintento real
Con el envío de correo forzado a fallar (mismo patrón de prueba que usa 010/033): el acueducto y el
admin quedan creados, la respuesta al superadmin lo indica con claridad, y el botón "Restablecer
contraseña" de `/plataforma` (033) reintenta el envío con éxito para ese mismo correo.

### CA-5 — El texto del correo tiene sentido en los dos casos que dispara
Revisión de Mateo sobre el correo real recibido tanto al invitar un admin nuevo como al recuperar una
contraseña existente — ningún texto que "no tenga sentido" en alguno de los dos casos.

## 7. Riesgos y alternativas descartadas

| Riesgo / alternativa | Resolución |
|---|---|
| `auth.admin.inviteUserByEmail` (mecanismo nativo de Supabase, pensado exactamente para esto) | Requiere `service_role_key` desde una ruta que atiende al superadmin — prohibición absoluta, CLAUDE.md §12. Descartado; se reutiliza `resetPasswordForEmail` (clave `anon`) en su lugar, mismo patrón ya verificado en 033/034. |
| Reusar `recovery.html` para dos casos (invitación nueva + recuperación real) mezcla la semántica de "recuperar" con la de "definir por primera vez" | Se acepta: es exactamente el mismo mecanismo técnico — un enlace para definir contraseña —, la única diferencia es si la cuenta tenía antes una contraseña usable. Reescribir el texto en términos neutros (§3.4) cubre ambos casos sin plantilla nueva ni tocar `auth.email.template.invite` (que exigiría el flujo nativo ya descartado). |
| Alguien intercepta el enlace de invitación antes que el admin nuevo | Mismo riesgo que ya acepta 033/034 para recuperación de contraseña real — no es una superficie nueva de este spec. |
| El admin nuevo nunca revisa su correo o lo marca como spam | Mismo riesgo aceptado en 010 (notificaciones); la mitigación (reenvío manual vía "Restablecer contraseña") ya queda cubierta como CA-4. |
| La contraseña aleatoria interna de `signUp` (§3.1) queda en algún log | Se genera con el mismo generador criptográfico que ya usa `generarContrasenaTemporal()` (o se reutiliza tal cual, a decidir en `/plan`) y nunca se incluye en ningún `console.log`/`console.error` ni en la respuesta HTTP — mismo criterio que CLAUDE.md §7 exige para cualquier secreto. |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] Tests de la ruta modificada en verde, con la salida pegada
- [ ] Verificación manual con `wrangler dev` + `next dev`, correo real contra Inbucket/Mailpit local:
      alta de un acueducto de prueba de punta a punta, siguiendo el enlace real del correo hasta
      loguearse con la contraseña definida (CA-2)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
