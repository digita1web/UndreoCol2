# SPEC — 034: completar-recuperacion

**Estado:** Borrador para aprobación
**Depende de:** 033-credenciales-plataforma

## 1. Objetivo

Completar el flujo de "olvidé mi contraseña": hoy `POST /auth/recuperar` (`resetPasswordForEmail`)
envía un correo real, pero el enlace no lleva a ninguna página funcional — cae a la raíz del sitio
sin que nada procese el token. Se agrega la página que falta y la ruta de backend que la completa,
y se traduce la plantilla del correo (hoy en inglés, la de Supabase por defecto).

## 2. Por qué ahora

Encontrado al verificar 033 en el navegador: el botón "Restablecer contraseña" manda el correo,
pero el flujo termina ahí. Investigación previa (comunidad + docs de Supabase) antes de este spec:
confirmó que el flujo **PKCE** (el más nuevo/recomendado en general) no sirve para este caso —
requiere que el mismo navegador que pidió la recuperación tenga guardado un "verificador" cuando se
hace clic en el enlace, y acá quien pide (el superadmin, o el propio usuario desde "olvidé mi
contraseña") y quien hace clic (en su correo, en su propio navegador) casi nunca son la misma
sesión de navegador. El flujo **implícito** (token embebido directo en el enlace, sin depender de
nada guardado antes) es el que funciona con este caso de uso — se fija explícitamente para no
depender del valor por defecto de la librería.

## 3. Alcance

### 3.1 Flujo implícito explícito, no el valor por defecto de la librería
`crearClienteAnon()` (`backend/src/lib/db.ts`) agrega `flowType: 'implicit'` a las opciones de
`auth`. Sin esto, un cambio futuro del valor por defecto de `@supabase/supabase-js` rompería este
flujo en silencio.

### 3.2 Página nueva: recibe el enlace del correo
`frontend/app/restablecer-contrasena/page.tsx` (componente cliente — necesita leer
`window.location.hash`, no disponible en el servidor). El enlace de Supabase Auth en modo
implícito llega con el patrón `#access_token=...&refresh_token=...&type=recovery` en el fragmento
de la URL (nunca se manda al servidor, por diseño de la web — se lee solo en el navegador). Si el
fragmento no trae los dos tokens: mensaje de "enlace inválido o vencido" con link a `/login`. Si los
trae: formulario de contraseña nueva + confirmación (mismo patrón que `CambiarContrasenaForm`, 033).

### 3.3 Ruta nueva: completa la recuperación y deja logueado
`POST /auth/completar-recuperacion` — pública (no exige la cookie de sesión administrativa: el
usuario todavía no está "logueado" en la app, el token de recuperación de la URL es la prueba de
identidad). Body `{ accessToken, refreshToken, passwordNueva }`. Internamente: `crearClienteAnon()`
+ `auth.setSession({ access_token, refresh_token })` (valida que el token de recuperación sea real
y no haya vencido) + `auth.updateUser({ password })`. Si todo sale bien, **deja a la persona
logueada** en la app (mismo criterio que un login exitoso): escribe la cookie `uc_sesion_admin` con
la sesión resultante, mismo mecanismo que ya usa `iniciarSesion()` — así no tiene que loguearse de
nuevo con la contraseña que acaba de definir.

### 3.4 Plantilla del correo en español
`supabase/config.toml`, sección `[auth.email.template.recovery]` (hoy no existe, usa la de Supabase
por defecto, en inglés). Asunto y cuerpo en español, con el enlace real
(`{{ .SiteURL }}{{ .RedirectTo }}` según la sintaxis de plantillas de Supabase — a confirmar el
nombre exacto de la variable contra la documentación al implementar).

## 4. Fuera de alcance

- **La plantilla de producción** — `config.toml` solo gobierna el stack local; en producción esa
  plantilla se configura desde el dashboard de Supabase Auth (Authentication → Email Templates),
  un clic de Mateo, no código. Se deja anotado, no es parte de esta tarea.
- **El aviso nativo de Supabase `[auth.email.notification.password_changed]`** — existe en
  `config.toml` (comentado, nunca activado) y haría lo mismo que el correo propio que ya envía
  `POST /auth/cambiar-contrasena` (033) — activarlo hoy duplicaría el aviso. Se deja documentado
  como hallazgo, no se activa.
- **Reenviar el correo de recuperación si expira** — Supabase Auth ya permite pedirlo de nuevo
  llamando otra vez a `/auth/recuperar`; no hace falta una función aparte.

## 5. Reglas de negocio que aplican

- `SUPABASE_SERVICE_ROLE_KEY` nunca en esta ruta (CLAUDE.md §12) — `crearClienteAnon()` alcanza,
  igual que en 033.
- La contraseña nueva exige mínimo 8 caracteres, mismo criterio que `/auth/cambiar-contrasena`.

## 6. Criterios de aceptación

### CA-1 — El enlace real del correo completa el restablecimiento
De punta a punta: `POST /auth/recuperar` con un email real → abrir el enlace del correo (Mailpit en
local) → definir contraseña nueva en `/restablecer-contrasena` → la cuenta queda con esa contraseña
y la persona queda logueada en la app, sin tener que volver a iniciar sesión.

### CA-2 — Enlace sin tokens (o inválido) muestra el error, no una pantalla en blanco ni un 500
Visitar `/restablecer-contrasena` sin fragmento de URL, o con un token ya usado/vencido, muestra un
mensaje explícito.

### CA-3 — Contraseña nueva de menos de 8 caracteres se rechaza con error claro
Mismo criterio que 033, sin llegar a llamar a Supabase Auth si no cumple el mínimo.

### CA-4 — El correo de recuperación sale en español
Verificado en Mailpit (local): asunto y cuerpo en español, con el enlace real y funcional.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un cambio futuro del valor por defecto de `@supabase/supabase-js` podría volver a romper este flujo si se depende de él en vez de fijarlo | `flowType: 'implicit'` explícito (§3.1) |
| El token de recuperación viaja en el fragmento de la URL (`#...`), visible en el historial del navegador de quien lo usa | Es el mecanismo estándar de Supabase Auth para este flujo (nunca se manda al servidor por diseño de la web); de un solo uso y vencimiento corto, gestionado por GoTrue, no por este código |
| Dejar a la persona logueada automáticamente tras restablecer (§3.3) es una acción sensible sin verificación adicional | El token de recuperación en sí ya es la prueba de identidad (solo llegó a quien tiene acceso al correo registrado) — mismo nivel de confianza que un login con contraseña |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] Verificación manual de punta a punta con `wrangler dev` + `next dev` + Mailpit reales (CA-1)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
