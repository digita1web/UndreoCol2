# PLAN — 034: completar-recuperacion

**Spec aprobado:** 2026-09-12

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `backend/src/lib/db.ts` | Modificado | `crearClienteAnon()` fija `flowType: 'implicit'` |
| `backend/src/lib/auth.ts` | Modificado | `completarRecuperacion()` — valida el token de recuperación, cambia la contraseña y escribe la cookie de sesión (mismo patrón que `iniciarSesion()`) |
| `backend/src/index.ts` | Modificado | Nueva ruta `POST /auth/completar-recuperacion` |
| `backend/tests/unit/completar-recuperacion.test.ts` | Nuevo | Cubre CA-1 a CA-3 con `app.fetch` real |
| `frontend/lib/api.ts` | Modificado | Nueva función `completarRecuperacion()` |
| `frontend/app/restablecer-contrasena/page.tsx` | Nuevo | Lee el fragmento de la URL, formulario de contraseña nueva |
| `supabase/config.toml` | Modificado | `[auth.email.template.recovery]` apuntando al archivo nuevo |
| `supabase/templates/recovery.html` | Nuevo | Plantilla del correo en español |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero migraciones.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

- `POST /auth/completar-recuperacion` — **nueva**, pública (sin cookie de sesión administrativa
  previa: el token de recuperación de la URL es la prueba de identidad). Body
  `{ accessToken: string; refreshToken: string; passwordNueva: string }`. Responde
  `{ sesion, perfil, membresias }` (mismo contrato de respuesta que `POST /auth/login`, para que el
  frontend pueda redirigir igual que tras un login exitoso) o `400`/`401` según el error.

## 4. Contratos de `core/`

Ninguno.

### `backend/src/lib/auth.ts` — función nueva

```ts
// Completa la recuperación de contraseña: valida el token de recuperación
// (setSession), cambia la contraseña (updateUser) y deja a la persona
// logueada (misma cookie que iniciarSesion()). El token de recuperación de
// la URL es la prueba de identidad — no hace falta sesión administrativa
// previa. Nunca service_role.
export async function completarRecuperacion(
  c: Context<{ Bindings: Env }>,
  accessToken: string,
  refreshToken: string,
  passwordNueva: string,
): Promise<ResultadoInicioSesion> // lanza Error si el token es inválido/venció o si updateUser falla
```

Internamente: `crearClienteAnon(c.env)` → `auth.setSession({ access_token: accessToken,
refresh_token: refreshToken })` (si falla, `throw new Error('Enlace de recuperación inválido o
vencido')`) → `auth.updateUser({ password: passwordNueva })` (si falla, relanza el mensaje real de
Supabase Auth) → `escribirCookie()` (función privada ya existente en este archivo, reutilizar tal
cual) con la sesión resultante → devuelve `{ sesion, accessToken }` igual que `iniciarSesion()`.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `flowType: 'implicit'` explícito en `crearClienteAnon()`, no en `crearClienteSuscriptor()` | Fijarlo en los dos clientes | Solo `crearClienteAnon()` se usa para `resetPasswordForEmail`/`signUp` (los métodos que generan un enlace de redirección); `crearClienteSuscriptor()` nunca genera uno |
| `completarRecuperacion()` vive en `lib/auth.ts`, junto a `iniciarSesion()`/`cerrarSesion()` | Escribirla inline en `index.ts` | Reutiliza `escribirCookie()` (privada del módulo) sin exportarla; mismo criterio que ya organiza este archivo |
| La respuesta de `POST /auth/completar-recuperacion` es `{ sesion, perfil, membresias }`, igual que `POST /auth/login` | Devolver solo `{ ok: true }` | El frontend necesita saber a dónde redirigir (mismo criterio que usa el login hoy: `/app/dashboard` o `/plataforma` según `esAdminPlataforma`) — reutilizar el contrato evita inventar un segundo formato |
| La plantilla de correo usa `{{ .ConfirmationURL }}` (la variable estándar de Supabase Auth para el enlace principal en todas sus plantillas) | Armar la URL a mano con `{{ .SiteURL }}`/`{{ .RedirectTo }}` | Es la variable documentada y ya trae el token embebido correctamente armado — menos superficie de error que concatenarla a mano |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica.

## 8. Estrategia de pruebas

- **Unitarias (`backend/tests/unit/completar-recuperacion.test.ts`, mismo patrón que
  `cambiar-contrasena.test.ts` — mockear `crearClienteAnon` con `setSession`/`updateUser`):**
  - Token inválido (`setSession` devuelve error) → `401`, `updateUser` nunca se llama.
  - Contraseña de menos de 8 caracteres → `400`, sin llamar a Supabase Auth.
  - Flujo completo válido → `200`, cuerpo con `sesion`/`perfil`/`membresias`, y se escribió la
    cookie (verificable por el header `Set-Cookie` de la respuesta real de `app.fetch`).
- **Integración (manual, `wrangler dev` + `next dev` + Mailpit reales, de punta a punta):**
  - `POST /auth/recuperar` con un email real → confirmar en Mailpit que el correo llega en español
    (CA-4) → copiar el enlace real del correo → abrirlo (o pegar el fragmento en
    `/restablecer-contrasena` manualmente si Mailpit no permite "abrir" directo) → definir
    contraseña nueva → confirmar que quedó logueado sin volver a iniciar sesión (CA-1).
  - Visitar `/restablecer-contrasena` sin fragmento → mensaje de error, no pantalla en blanco
    (CA-2).
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (sigue sin
  Chromium/Playwright en este entorno) y, en algún momento, la plantilla de producción desde el
  dashboard de Supabase (fuera de alcance de este spec, §4).
