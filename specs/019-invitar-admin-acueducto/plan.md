# PLAN — 019: invitar-admin-acueducto

**Spec aprobado:** 2026-09-13

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `backend/src/lib/auth.ts` | Modificado | Nueva función `enviarEnlaceDefinirContrasena(env, email)` — extrae el cuerpo de `resetPasswordForEmail` + `redirectTo` que hoy vive inline en `POST /auth/recuperar` |
| `backend/src/lib/plataforma.ts` | Modificado | `generarContrasenaTemporal()` → renombrada `generarContrasenaInterna()` (mismo generador criptográfico; cambia solo el nombre y el comentario, porque ya no es "temporal para entregar", es un valor que nadie vuelve a ver) |
| `backend/src/index.ts` | Modificado | `POST /auth/recuperar` pasa a llamar `enviarEnlaceDefinirContrasena`; `POST /plataforma/acueductos` gana el paso 4 (envío de invitación) y cambia su respuesta `201` |
| `frontend/lib/api.ts` | Modificado | `RespuestaAltaAcueducto` pierde `contrasenaTemporal`, gana `invitacionEnviada: boolean` y `avisoCorreo?: string` |
| `frontend/components/plataforma-form.tsx` | Modificado | Bloque de éxito (líneas 77-90 hoy) confirma el envío del correo en vez de mostrar una contraseña; si `invitacionEnviada` es `false`, muestra `avisoCorreo` con indicación de reintentar |
| `supabase/templates/recovery.html` | Modificado | Texto neutro (spec §3.4), sirve para invitación nueva y recuperación real |
| `backend/tests/unit/plataforma-rutas.test.ts` | Modificado | Reemplaza las aserciones sobre `contrasenaTemporal`; agrega el mock de `enviarEnlaceDefinirContrasena` y los casos de CA-4 |
| `backend/tests/unit/auth-recuperar.test.ts` | Nuevo | Cobertura mínima de regresión de `POST /auth/recuperar` tras la extracción (no existía test propio antes de este spec) |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero migraciones — sin tablas ni columnas nuevas (mismo veredicto que 033, spec §5 no toca esquema).

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

- **`POST /plataforma/acueductos`** — misma validación y los 3 pasos existentes (`crearAcueductoBase`
  → `signUpAdminAcueducto` → `asignarAdminAcueducto`), más un **paso 4 nuevo**: llama a
  `enviarEnlaceDefinirContrasena(c.env, correoAdmin)`. La respuesta `201` cambia de forma:
  ```ts
  // Antes: { clienteId, slug, correoAdmin, contrasenaTemporal }
  // Ahora:
  { clienteId: string, slug: string, correoAdmin: string, invitacionEnviada: boolean, avisoCorreo?: string }
  ```
  Si el paso 4 falla, la ruta **no** revierte los pasos 1-3 (regla 20: un fallo de correo nunca
  bloquea el flujo principal) — responde igual `201` con `invitacionEnviada: false` y `avisoCorreo`
  describiendo el error real y la vía de reintento ("Restablecer contraseña" en la lista, 033 §3.2).
  Los pasos 1/2/3 conservan tal cual sus fallos actuales (400/500 con `clienteId`/`usuarioId`
  parciales) — este spec no toca ese comportamiento.
- **`POST /auth/recuperar`** — sin cambio de contrato (mismo body, misma respuesta `{ ok: true }` /
  `400`); su implementación interna pasa a delegar en `enviarEnlaceDefinirContrasena`.
- **`POST /auth/completar-recuperacion`** — sin cambios (034), reutilizada tal cual por el admin
  nuevo para definir su contraseña.

## 4. Contratos de `core/`

Ninguno — no hay cálculo de dinero ni lógica de negocio pura involucrada (mismo veredicto que 033).

### `backend/src/lib/auth.ts` — función nueva

```ts
// Dispara el correo con el enlace para definir contraseña — mismo mecanismo
// para "recuperar" (cuenta existente) y para "invitar" (cuenta recién creada
// por POST /plataforma/acueductos, spec 019 §3.2): la diferencia entre los
// dos casos es solo si había una contraseña usable antes, no el mecanismo.
// Clave `anon`, NUNCA service_role (CLAUDE.md §12) — resetPasswordForEmail no
// la necesita.
export async function enviarEnlaceDefinirContrasena(env: Env, email: string): Promise<void>
```
Lanza `Error(mensaje de Supabase)` si `resetPasswordForEmail` falla; el caller decide qué código
HTTP corresponde (`/auth/recuperar` → 400; `POST /plataforma/acueductos` → 201 con `avisoCorreo`,
spec §3.5).

### `backend/src/lib/plataforma.ts` — función renombrada

```ts
// Antes: generarContrasenaTemporal(). Mismo cuerpo (alfabeto sin caracteres
// ambiguos, crypto.getRandomValues, 20 caracteres) — solo cambia el nombre y
// el comentario: ya no es una contraseña "temporal para entregar", es un
// valor interno que satisface el requisito de signUp() y nadie vuelve a leer
// (spec §3.1). Nunca se devuelve en la respuesta HTTP ni se loguea.
export function generarContrasenaInterna(): string
```

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Reutilizar `resetPasswordForEmail` (clave `anon`) para invitar, vía una función compartida en `lib/auth.ts` | `auth.admin.inviteUserByEmail` (mecanismo nativo de Supabase, pensado para esto) | Exige `service_role_key` desde una ruta que atiende al superadmin — prohibición absoluta, CLAUDE.md §12 (spec §7) |
| La función compartida vive en `lib/auth.ts`, no en `lib/plataforma.ts` | Ponerla en `lib/plataforma.ts` (junto al resto del alta de acueductos) | `lib/auth.ts` ya es donde vive `completarRecuperacion` — es el módulo de flujos de autenticación en general, no específico de plataforma; `/auth/recuperar` (el caller original) no tiene nada que ver con plataforma |
| `generarContrasenaTemporal` se renombra a `generarContrasenaInterna`, mismo cuerpo | Dejar el nombre igual | El nombre "temporal" sugiere que alguien la usa transitoriamente; ahora es un valor que **nadie** vuelve a leer nunca — un nombre que siga diciendo "temporal" confunde al siguiente que lea el código (regla de nombres autoexplicativos) |
| Fallo del envío de invitación (paso 4) responde `201` con `invitacionEnviada: false` en vez de `207`/`500` | Devolver `207 Multi-Status` o `500` | El recurso (acueducto + admin) **sí** se creó completo — un `500` sugeriría al frontend que reintente el alta entera, duplicando el acueducto; `201` con un campo explícito es honesto sobre qué pasó y de qué falló, y el frontend ya tiene la vía de reintento correcta (botón existente de 033, no uno nuevo) |
| Un solo `recovery.html` con texto neutro para los dos casos | Activar `auth.email.template.invite` (plantilla nativa separada) | Esa plantilla solo se dispara con `inviteUserByEmail`, ya descartado arriba por el `service_role_key`; mantener un solo archivo evita divergencia entre dos textos que en la práctica hacen lo mismo |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — una sola invocación de `fetch` normal (el alta ya hace varias llamadas secuenciales a
Supabase; el paso 4 agrega una más, mismo orden de magnitud que 033).

## 8. Estrategia de pruebas

- **Unitarias (`backend/tests/unit/plataforma-rutas.test.ts`, mismo patrón `app.fetch` real que ya
  usa el archivo):**
  - Alta completa con envío de invitación exitoso → `201` con `invitacionEnviada: true`, sin
    `contrasenaTemporal` en la respuesta (CA-1).
  - `enviarEnlaceDefinirContrasena` mockeado para fallar en el paso 4 → sigue `201`,
    `invitacionEnviada: false`, `avisoCorreo` presente, y los pasos 1-3 ya se ejecutaron igual —
    `ordenLlamadas` incluye los 3 pasos previos (CA-4).
  - Orden de llamadas verificado: el paso 4 solo se dispara si los 3 anteriores tuvieron éxito (no
    se envía invitación a un admin que no llegó a crearse).
- **Unitarias nuevas (`backend/tests/unit/auth-recuperar.test.ts`):**
  - `POST /auth/recuperar` con email válido → `200`/`{ ok: true }`, `enviarEnlaceDefinirContrasena`
    invocado con ese email (regresión: mismo contrato que antes de la extracción).
  - Sin email en el body → `400`, sin invocar la función.
- **Integración (manual, `wrangler dev` + `next dev` reales, Inbucket/Mailpit local):**
  - CA-2 completo: alta de un acueducto de prueba → correo real recibido → seguir el enlace →
    `/restablecer-contrasena` → definir contraseña → login exitoso.
  - CA-3: confirmar que no existe ninguna contraseña usable para la cuenta nueva antes de seguir el
    enlace (intentar login con cualquier valor falla).
  - CA-5: leer el texto real del correo en los dos casos (alta nueva y `/auth/recuperar` sobre una
    cuenta existente) — revisión de Mateo.
- **Manual, requiere Mateo:** aspecto visual del bloque de éxito en `plataforma-form.tsx` en un
  navegador real (sigue sin Chromium/Playwright en este entorno); y replicar el texto nuevo de
  `recovery.html` en la plantilla del dashboard de Supabase de producción (config.toml solo gobierna
  local — mismo pendiente ya documentado en `docs/PLAN-PRODUCCION.md` para la plantilla actual).
