# SPEC — 033: credenciales-plataforma

**Estado:** Borrador para aprobación
**Depende de:** 018-panel-plataforma

## 1. Objetivo

Darle al superadmin (`administrador`, el único rol con control total del sistema — hoy una sola
cuenta) control real de credenciales desde `/plataforma`: ver qué administrador (representante
legal) tiene cada acueducto, poder restablecerle la contraseña, y poder cambiar la suya propia.
Hoy el panel solo lista acueductos y los da de alta — no hay ninguna gestión de credenciales
después de esa alta inicial.

## 2. Por qué ahora

Mateo lo pidió explícitamente para su propio panel: "gestiona credenciales, cambia su propia
contraseña, recupera contraseña de paneles que se asignen." Confirmado en la misma conversación:
el recaudo total de cada acueducto lo ve únicamente `admin_acueducto` (el representante legal de
esa empresa) — eso ya funciona hoy (`GET /dashboard/indicadores`, 403 explícito a cualquier otro
rol) y no lo toca este spec; se deja registrado acá porque fue parte de la misma conversación de
alcance.

## 3. Alcance

### 3.1 El panel muestra quién administra cada acueducto
`GET /plataforma` se amplía para incluir el email (y nombre) del `admin_acueducto` de cada
acueducto listado — hoy solo devuelve `id, nombre, slug, fecha_alta`. Sin esto, "restablecer
contraseña" no tiene a quién apuntarle desde la UI.

### 3.2 Restablecer contraseña de un acueducto — sin ruta nueva, reutiliza `/auth/recuperar`
`POST /auth/recuperar` (`resetPasswordForEmail`) ya existe, con clave `anon`, y hoy no lo llama
ningún frontend — quedó huérfano desde que se implementó (mismo patrón que tenía `/auth/registro`
antes de M-5). Se agrega un botón "Restablecer contraseña" por acueducto en `/plataforma` que lo
invoca con el email de su admin — el correo de recuperación llega al admin del acueducto, que
sigue el enlace y define su propia contraseña nueva. **Cero rutas de backend nuevas para esto.**

### 3.3 Cambiar la contraseña propia del superadmin — ruta nueva, sin `service_role`
Nueva ruta `POST /auth/cambiar-contrasena`: recibe `{ passwordNueva }`, exige sesión administrativa
activa (cualquier rol — ver §3.4), y llama a
`crearClienteSuscriptor(env, accessToken).auth.updateUser({ password: passwordNueva })` — el mismo
patrón de cliente-con-JWT-del-usuario que usa el resto del backend, nunca `service_role_key`
(CLAUDE.md §12, prohibición absoluta). Mínimo 8 caracteres, mismo criterio que ya exigía
`/auth/registro`. Se agrega un formulario "Cambiar mi contraseña" en `/plataforma`.

### 3.4 La ruta de cambiar contraseña no está limitada al superadmin
`POST /auth/cambiar-contrasena` solo exige sesión administrativa válida — no chequea rol, porque
"cambiar MI PROPIA contraseña" no es una acción sobre otro usuario (a diferencia de restablecer la
de un acueducto, que si necesita ser superadmin, §3.2). El componente de UI se escribe como
reutilizable (`CambiarContrasenaForm`), aunque en esta feature solo se cablea en `/plataforma` —
ver §4.

### 3.5 Robustez (investigación de la comunidad): aviso por correo al cambiar la contraseña
Estándar de seguridad establecido (no propio de este proyecto): cuando la contraseña de una cuenta
cambia, su dueño recibe un aviso — así, si el cambio no lo hizo él, se entera de inmediato en vez de
quedar bloqueado en silencio. Tras un `POST /auth/cambiar-contrasena` exitoso, se envía un correo al
email de la propia sesión (`sesion.email`, ya disponible — no hace falta pedirlo) usando
`enviarCorreo()` (`lib/email.ts`, ya existe, sin adjunto) avisando que la contraseña cambió, con
fecha/hora. **El envío nunca bloquea ni revierte el cambio** (CLAUDE.md §10 punto 20, regla ya
establecida para todo el sistema: un fallo de correo nunca bloquea el flujo principal) — si el
correo falla, la contraseña ya cambió igual y la respuesta al usuario es de éxito; el fallo solo
queda en el log del Worker (`console.error`), sin tabla de reintento nueva (no es una notificación
al suscriptor, es un aviso de sesión propia, menor severidad que las 6 de 010).

## 4. Fuera de alcance

- **Usar `CambiarContrasenaForm` en otras pantallas** (ej. `/app/configuracion`, para que
  `admin_acueducto`/`secretaria`/`lector` cambien la suya) — el componente queda listo para
  reutilizarse, pero cablearlo en otro panel es su propia tarea futura, no esta.
- **Crear o gestionar otras cuentas `administrador`** — hoy hay una sola, Mateo no pidió agregar
  más.
- **Exigir la contraseña actual para cambiarla** — Supabase Auth no lo requiere por diseño (una
  sesión válida ya es la prueba de identidad); se documenta como decisión, no como olvido (§7).

## 5. Reglas de negocio que aplican

- `SUPABASE_SERVICE_ROLE_KEY` nunca se usa en una ruta que atiende peticiones de usuario (CLAUDE.md
  §12, absoluta) — ni `/auth/recuperar` (ya existe, `anon`) ni `/auth/cambiar-contrasena` (nuevo,
  JWT del propio usuario) la necesitan.
- El correo de recuperación no debe revelar si un email existe o no en el sistema — ya lo garantiza
  `resetPasswordForEmail` de Supabase Auth (siempre responde igual, exista o no la cuenta).

## 6. Criterios de aceptación

### CA-1 — El panel muestra el email del admin de cada acueducto
`GET /plataforma` devuelve, para cada acueducto, el email de su `admin_acueducto` activo.

### CA-2 — "Restablecer contraseña" envía el correo real
Al hacer clic, se dispara `POST /auth/recuperar` con el email correcto del admin de ese acueducto
específico (no el del superadmin ni el de otro acueducto), y la UI confirma el envío.

### CA-3 — El superadmin cambia su propia contraseña y puede loguearse con la nueva
Flujo completo: cambiar contraseña en `/plataforma` → cerrar sesión → iniciar sesión con la
contraseña nueva → éxito. La vieja deja de funcionar.

### CA-4 — Contraseña nueva de menos de 8 caracteres se rechaza con error claro
Sin llegar a llamar a Supabase Auth si no cumple el mínimo (validación temprana, mismo criterio que
tenía `/auth/registro`).

### CA-5 — `admin_acueducto`/`secretaria`/`lector` no pueden restablecer la contraseña de un
acueducto ajeno, pero sí podrían cambiar la propia si tuvieran acceso al formulario
El guard de superadmin (`requerirAdminPlataforma`) sigue protegiendo todo `/plataforma` — estos
roles ni siquiera llegan a ver el botón de restablecer. `/auth/cambiar-contrasena` en sí no
distingue rol (por diseño, §3.4) pero hoy solo es alcanzable desde `/plataforma`, gateada por rol
en el frontend.

### CA-6 — Cambiar la contraseña dispara el aviso por correo, y su fallo no bloquea el cambio
Con `env.EMAIL` simulando un fallo (o en local, donde no existe): la contraseña cambia igual,
`POST /auth/cambiar-contrasena` responde éxito, y el fallo de envío queda solo en el log del
Worker — nunca en la respuesta al usuario ni revirtiendo el cambio.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| No exigir la contraseña actual para cambiarla es un poco menos estricto que pedirla | Es el comportamiento estándar de Supabase Auth (`updateUser`); pedirla agregaría una ruta de verificación extra sin que Supabase la soporte nativamente — se documenta como decisión consciente, no un descuido |
| `/auth/recuperar` es público (`anon`) desde antes de este spec — cualquiera pudo dispararlo para cualquier email, con o sin este botón | No es un cambio de superficie de este spec (ya existía); el botón es solo conveniencia de UI para el superadmin, no una apertura nueva |
| Ampliar `GET /plataforma` con el email del admin expone un dato personal más en una respuesta ya gateada a superadmin | El endpoint ya está detrás de `requerirAdminPlataforma`; el email de contacto del admin de un acueducto es exactamente el dato que el superadmin necesita para poder restablecerle la contraseña |
| El aviso de correo (§3.5) requiere `env.EMAIL`, que no existe en `wrangler dev` local (mismo límite que 006/010) | Ya documentado y aceptado en todo el sistema (regla 20); se verifica el camino de éxito con un mock/stub en el test unitario, no contra Cloudflare real en local |

### Pendiente fuera de este spec, mismo tema (decisión de Mateo, un clic)
"Leaked password protection" de Supabase Auth (HaveIBeenPwned) sigue sin activar — hallazgo ya
documentado en `docs/PLAN-PRODUCCION.md` desde la auditoría original. No es código de este spec,
pero es el complemento natural: activarlo hace que **tanto** `/auth/cambiar-contrasena` como el
`resetPasswordForEmail` de `/auth/recuperar` rechacen contraseñas filtradas conocidas, sin escribir
una línea más. Un clic en el dashboard de Supabase Auth, cuando Mateo lo decida.

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] Tests de la tarea en verde, con la salida pegada (ruta nueva `/auth/cambiar-contrasena`)
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de superadmin: cambio de
      contraseña de punta a punta (CA-3) y restablecimiento real de un acueducto de prueba (CA-2)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
