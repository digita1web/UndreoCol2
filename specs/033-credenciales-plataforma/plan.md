# PLAN — 033: credenciales-plataforma

**Spec aprobado:** 2026-09-12

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `backend/src/index.ts` | Modificado | `GET /plataforma` incluye el email del `admin_acueducto` de cada acueducto; nueva ruta `POST /auth/cambiar-contrasena` |
| `backend/src/lib/plataforma.ts` | Modificado | `obtenerAdminsDeAcueductos()` — busca el `admin_acueducto` activo de una lista de `cliente_id` |
| `frontend/lib/api.ts` | Modificado | `Acueducto` (plataforma) gana `adminEmail: string \| null`; nuevas funciones `restablecerContrasenaAcueducto()` (llama a `/auth/recuperar`) y `cambiarContrasena()` |
| `frontend/components/cambiar-contrasena-form.tsx` | Nuevo | Formulario reutilizable (spec §3.4): nueva contraseña + confirmación, llama a `cambiarContrasena()` |
| `frontend/app/plataforma/page.tsx` | Modificado | Muestra el email del admin por acueducto, botón "Restablecer contraseña", sección "Cambiar mi contraseña" |
| `backend/tests/unit/cambiar-contrasena.test.ts` | Nuevo | Cubre CA-3, CA-4, CA-6 con `app.fetch` real (mismo patrón que `auth-login-limite.test.ts`) |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero migraciones — sin tablas ni columnas nuevas.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

- `GET /plataforma` — sin cambio de firma, respuesta ampliada (`adminEmail` por acueducto).
- `POST /auth/cambiar-contrasena` — **nueva**. Requiere sesión administrativa activa (cualquier
  rol). Body `{ passwordNueva: string }`. Responde `{ ok: true }` o `400` con el mínimo de 8
  caracteres sin llegar a Supabase Auth, o el error real de `updateUser` si Supabase lo rechaza
  (ej. "New password should be different from the old password").
- `POST /auth/recuperar` — sin cambios, se reutiliza tal cual.

## 4. Contratos de `core/`

Ninguno — no hay cálculo de dinero ni lógica de negocio pura involucrada.

### `backend/src/lib/plataforma.ts` — función nueva

```ts
// SECURITY INVOKER: `supabase` es el cliente del superadmin — RLS decide qué
// perfiles/membresías puede leer, igual que crearAcueductoBase/asignarAdminAcueducto.
export async function obtenerAdminsDeAcueductos(
  supabase: SupabaseClient,
  clienteIds: string[],
): Promise<Record<string, string | null>> // cliente_id -> email del admin_acueducto activo (o null)
```

Dos consultas explícitas (`membresias` filtradas por `cliente_id in (...)`, `rol = 'admin_acueducto'`,
`activo = true`, luego `perfiles` por los `perfil_id` resultantes) en vez de un embed de PostgREST
— más fácil de verificar y de leer que anidar el filtro de rol dentro de un `.select()` con
relaciones.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Dos consultas explícitas (`membresias` → `perfiles`) en vez de un `.select()` con relación anidada de PostgREST | `clientes.select('*, membresias(perfiles(email))')` con filtro embebido | El filtro de rol/activo dentro de una relación anidada de PostgREST es frágil y menos legible; dos consultas explícitas son más fáciles de verificar contra RLS real |
| `POST /auth/cambiar-contrasena` no valida rol, solo sesión activa | Restringirla a `administrador` (superadmin) | Spec §3.4: es una acción sobre uno mismo, no sobre otro usuario — el mismo criterio ya usado en el resto del sistema (nadie necesita ser admin para editar su propio perfil) |
| El aviso de correo (spec §3.5) se envía con `enviarCorreo()` ya existente, sin adjunto, cuerpo HTML simple sin interpolar texto libre de terceros (solo el email de la propia sesión y la fecha, ambos de confianza) | Reusar `escaparHtml()` como en 010 | `escaparHtml()` protege contra texto libre que escribe una persona (`nombreAcueducto`, `motivo`); acá no hay ningún campo así — se omite porque no aplica, no por descuido |
| El fallo de envío del aviso se registra con `console.error`, sin tabla de reintento | Reusar la tabla `notificaciones` (010) | Esa tabla es para comunicaciones al **suscriptor**, con su propio ciclo de reintento; este es un aviso de sesión administrativa propia, de menor severidad — agregar una fila ahí mezclaría dos dominios distintos sin necesidad |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — una sola invocación de `fetch` normal, sin lote ni proceso masivo.

## 8. Estrategia de pruebas

- **Unitarias (`backend/tests/unit/cambiar-contrasena.test.ts`, `app.fetch` real, mismo patrón que
  `auth-login-limite.test.ts`):**
  - Sin sesión → `401`.
  - Contraseña de menos de 8 caracteres → `400`, sin llamar a Supabase Auth (verificable con un
    mock que falla el test si se invoca).
  - Contraseña válida → `200`, `updateUser` invocado con el `accessToken` de la sesión (nunca
    `service_role_key` — test que falla si el mock de cliente usado es el de `service_role`).
  - `enviarCorreo()` mockeado para fallar → la respuesta sigue siendo `200` (CA-6).
- **Integración (manual, `wrangler dev` + `next dev` reales):**
  - `GET /plataforma` con al menos 2 acueductos reales: el email de cada uno coincide con el
    `admin_acueducto` correcto (CA-1).
  - Clic en "Restablecer contraseña" de un acueducto de prueba: confirmar en Mailpit (local) o en
    los logs que `POST /auth/recuperar` se disparó con el email correcto (CA-2).
  - Cambiar la contraseña del superadmin de prueba, cerrar sesión, iniciar sesión con la nueva
    (CA-3); repetir con una de menos de 8 caracteres y confirmar el error antes de tocar Supabase
    Auth (CA-4).
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (sigue sin
  Chromium/Playwright en este entorno).
