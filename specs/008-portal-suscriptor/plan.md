# PLAN — 008: portal-suscriptor

**Spec aprobado:** 2026-09-03 (commit `d015ee0`; ver `specs/008-portal-suscriptor/spec.md`, CA-1..CA-10)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` ni código
hasta esa aprobación.

---

## 0. Punto de partida

Reutilizado SIN tocar (verificado contra la base local):

- **`usuarios_servicio`**: `codigo_suscriptor` (`unique (cliente_id, codigo_suscriptor)`),
  `numero_documento` (sin restricción de unicidad, índice `(cliente_id, numero_documento)`), `estado`
  (`activo`·`suspendido`·`cortado`·`inactivo`) — de 001/003.
- **`clientes.slug`**: `unique`, `check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')` — de 001, se reutiliza tal
  cual para identificar el acueducto en la URL pública del portal (spec §3.1).
- **`contadores`** (`usuario_servicio_id`) y **`lecturas`** (`contador_id`, `periodo_id`,
  `fecha_lectura`, `lectura_anterior`, `lectura_actual`, `consumo_m3`) — de 004. Un suscriptor puede
  tener varios contadores históricos (reemplazo); el historial de consumo los junta todos.
- **`facturas`** (`usuario_servicio_id`, `tipo`, `numero`, `total`, `total_pagado`, `fecha_emision`,
  `fecha_vencimiento`, `estado`) y **`factura_detalles`** — de 005. `pdf_url`/generación con
  `pdf-lib` (`backend/src/lib/factura-pdf.ts`, `generarPdfFactura`) — de 006, reutilizada tal cual (es
  lógica pura: recibe `{factura, detalles, acueducto}`, no un cliente de Supabase).
- **`pagos`**/`pago_aplicaciones` — de 007. La fórmula de saldo a favor (remanente de pagos vigentes
  sin aplicar) se reutiliza igual que en `lib/pagos.ts` (`obtenerPagosDeSuscriptor`), pero reimplementada
  como función SQL porque el acceso ahora es sin `auth.uid()` (ver D-10).
- **Funciones `SECURITY DEFINER` acotadas ya en producción**: `es_admin_plataforma()`,
  `mis_clientes()`, `es_admin_de()` (001), `tarifa_vigente()` (002). Son predicados usados **dentro**
  de políticas RLS (evitan recursión), no funciones invocadas directamente por `anon` para devolver
  filas — 008 extiende el mismo mecanismo (`security definer`) a un uso distinto pero igual de
  acotado: devolver datos ya filtrados a quien primero demuestre las credenciales correctas.
- **`backend/src/lib/auth.ts`**: patrón exacto a espejar para `sesion-suscriptor.ts` (cookie
  `HttpOnly+Secure+SameSite=Lax`, funciones que reciben `Context<{Bindings: Env}>`, nunca lanzan en la
  verificación — devuelven `null`).
- **`backend/src/lib/sesion-suscriptor.ts`**: contrato reservado desde 001 (`SesionSuscriptor`,
  `DURACION_SESION_SUSCRIPTOR_SEG`, `UMBRAL_RENOVACION_SUSCRIPTOR_SEG`) — 008 lo implementa.

**NO existe todavía**: las funciones `SECURITY DEFINER` del portal, la tabla de intentos fallidos, el
campo `SESSION_SECRET` en `Env`/`.dev.vars`, y toda la sección `/portal/*` del frontend.

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260908090000_portal-suscriptor.sql` | crear | Tabla `portal_intentos_login`; funciones `SECURITY DEFINER` del portal (D-10); grants a `anon` |
| `tests/fixtures/portal.sql` | crear | Completa `numero_documento` de A1/A2 (el fixture de 001 no lo trae) para tener credenciales de prueba reales; dos contadores históricos de A1 (para CA-7) |
| `tests/aislamiento/008_portal_aislamiento.sql` | crear | CA-2/CA-9: llamadas directas a las funciones como `anon` con distintas combinaciones de credenciales; regresión 001-007 |
| `backend/src/lib/db.ts` | editar | `Env.SESSION_SECRET: string` |
| `backend/.dev.vars` | editar | `SESSION_SECRET=<valor local generado>` (nunca al repo — ya está en `.gitignore`) |
| `backend/src/lib/sesion-suscriptor.ts` | editar | Implementa `iniciarSesionSuscriptor`/`verificarSesionSuscriptor`/`renovarSesionSuscriptor` (JWT propio con `hono/utils/jwt`, cookie `uc_sesion_suscriptor`) |
| `backend/tests/unit/sesion-suscriptor.test.ts` | crear | Unit del round-trip del JWT (firma→verifica, `tipo` incorrecto, expirado, firma inválida, renovación) sin Workers ni base |
| `backend/src/lib/portal.ts` | crear | Capa fina: llama las funciones `SECURITY DEFINER` (login, facturas, saldo a favor, consumo, factura completa para PDF) |
| `backend/src/lib/suscriptores.ts` | editar | `regenerarCodigoSuscriptor` (admin; UPDATE normal ya permitido por la RLS existente de `usuarios_servicio`, sin RPC nueva) |
| `backend/src/index.ts` | editar | Middleware `requerirSesionSuscriptor`; rutas `POST /portal/:slug/login`, `POST /portal/logout`, `GET /portal/facturas`, `GET /portal/facturas/:id/pdf`, `GET /portal/saldo-favor`, `GET /portal/consumo`; ruta admin `POST /suscriptores/:id/regenerar-codigo` |
| `frontend/middleware.ts` | editar | Matcher nuevo para `/portal/:slug/*`: cookie `uc_sesion_suscriptor` (distinta de `uc_sesion_admin`); `/portal/:slug/login` siempre pasa |
| `frontend/lib/api.ts` | editar | Tipos + funciones del portal (`loginPortal`, `logoutPortal`, `obtenerFacturasPortal`, `obtenerSaldoFavorPortal`, `obtenerConsumoPortal`, `urlPdfFacturaPortal`) + `regenerarCodigoSuscriptor` (admin) |
| `frontend/app/portal/[slug]/login/page.tsx` | crear | Formulario de acceso (numero_documento + codigo_suscriptor) |
| `frontend/app/portal/[slug]/page.tsx` | crear | Factura actual, historial, saldo a favor, historial de consumo, botón salir |
| `frontend/app/app/suscriptores/[id]/page.tsx` | editar | Botón "Regenerar código" (admin) |

## 2. Esquema de base de datos

### Migración

| Archivo | Contenido |
|---|---|
| `20260908090000_portal-suscriptor.sql` | `alter table configuracion` (umbral de fuerza bruta); tabla `portal_intentos_login`; funciones `portal_validar_credenciales`, `portal_facturas_suscriptor`, `portal_factura_completa`, `portal_saldo_favor_suscriptor`, `portal_consumo_suscriptor` (todas `security definer`); `revoke`/`grant execute ... to anon` |

### Umbral de fuerza bruta configurable por acueducto (CA-9)

Mismo patrón que `porcentaje_mora`/`dias_umbral_corte` (columnas de `configuracion`, ajustables por
acueducto, no un valor global fijo):

```sql
alter table configuracion
  add column portal_umbral_intentos_login smallint not null default 8,
  add column portal_bloqueo_minutos       integer  not null default 15;
```

### Tabla de mitigación de fuerza bruta (CA-9)

```sql
create table portal_intentos_login (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  numero_documento  text not null,
  intentos          smallint not null default 0,
  bloqueado_hasta   timestamptz,
  ultimo_intento    timestamptz not null default now(),
  unique (cliente_id, numero_documento)
);

alter table portal_intentos_login enable row level security;
alter table portal_intentos_login force row level security;

-- Sin política de insert/update para ningún rol: solo la escribe la función
-- security definer (corre como su dueño, que tiene BYPASSRLS — mismo mecanismo
-- que ya usan tarifa_vigente()/es_admin_de() sobre tablas con FORCE RLS).
create policy portal_intentos_login_plataforma on portal_intentos_login for select
  using (es_admin_plataforma());
```

`portal_validar_credenciales` lee `portal_umbral_intentos_login`/`portal_bloqueo_minutos` de
`configuracion` **del `cliente_id` recibido** (no un valor global): al llegar al umbral configurado
bloquea nuevos intentos por los minutos configurados. Un intento con credenciales correctas mientras
está bloqueado sigue rechazado (mensaje "demasiados intentos, espera unos minutos" — distinto del
genérico de credenciales, porque no revela nada sobre cuál credencial es correcta). Un acierto
reinicia el contador a 0. Valores por defecto (8 intentos / 15 minutos) iguales para todo acueducto
nuevo, editables después desde `configuracion` igual que `porcentaje_mora`.

### Funciones `SECURITY DEFINER` del portal (D-10)

Regla común a las cinco: reciben `numero_documento`+`codigo_suscriptor` reales (nunca un
`usuario_servicio_id` desnudo), revalidan internamente contra `usuarios_servicio` con
`estado <> 'inactivo'`, y devuelven solo lo que corresponde a esa fila. `GRANT EXECUTE` a `anon`
(la clave que usa el Worker, D-10); `REVOKE ALL FROM PUBLIC` primero.

```sql
-- Login (CA-1) + mitigación de fuerza bruta (CA-9). Devuelve
-- {estado: 'ok', usuario_servicio_id} | {estado: 'invalido'} | {estado: 'inactivo'} | {estado: 'bloqueado', reintentar_en}.
create or replace function portal_validar_credenciales(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns jsonb
language plpgsql security definer set search_path = public as $$ ... $$;

-- CA-4: resumen de todas las facturas del suscriptor (más reciente primero).
-- El Worker toma el primer elemento no anulado como "factura actual".
create or replace function portal_facturas_suscriptor(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns jsonb  -- [{id, numero, tipo, total, total_pagado, fecha_emision, fecha_vencimiento, estado}, ...]
language sql stable security definer set search_path = public as $$ ... $$;

-- CA-5: factura + detalles + datos del acueducto para armar el PDF con
-- generarPdfFactura (006). NULL si la factura no existe o no es de este
-- suscriptor/cliente (el Worker responde 404, nunca sirve el PDF).
create or replace function portal_factura_completa(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text,
  p_factura_id        uuid
) returns jsonb  -- {factura: {...}, detalles: [...], acueducto: {...}} | null
language sql stable security definer set search_path = public as $$ ... $$;

-- CA-6: mismo cálculo que lib/pagos.ts (007) — suma de pagos vigentes del
-- suscriptor menos sus aplicaciones.
create or replace function portal_saldo_favor_suscriptor(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns numeric
language sql stable security definer set search_path = public as $$ ... $$;

-- CA-7: lecturas de TODOS los contadores históricos del suscriptor (join por
-- contadores.usuario_servicio_id, no solo el contador_actual_id), por fecha.
create or replace function portal_consumo_suscriptor(
  p_cliente_id        uuid,
  p_numero_documento  text,
  p_codigo_suscriptor text
) returns jsonb  -- [{fecha_lectura, lectura_anterior, lectura_actual, consumo_m3}, ...]
language sql stable security definer set search_path = public as $$ ... $$;
```

Notas de implementación (a resolver en el cuerpo real durante `/tasks`, ya acotadas aquí):
- Las cuatro funciones de datos (`portal_facturas_suscriptor` en adelante) comparten la misma
  subconsulta de validación: `select id from usuarios_servicio where cliente_id = p_cliente_id and
  numero_documento = p_numero_documento and codigo_suscriptor = p_codigo_suscriptor and estado <>
  'inactivo'` — si no hay fila, devuelven `null`/`'[]'::jsonb` (nunca un error que distinga el motivo,
  CA-1). Un suscriptor que pasa a `inactivo` después del login pierde el acceso en la siguiente
  llamada porque esa condición ya no matchea (CLAUDE.md §10-22d, sin verificación aparte).
- `portal_validar_credenciales` es la única que **escribe** (`portal_intentos_login`); las otras
  cuatro son `stable` (sin side effects), lo que además permite que Postgres las cachee dentro de la
  misma transacción si se llaman más de una vez.

### Regenerar código de suscriptor (CA-8) — sin RPC nueva

`usuarios_servicio_escritura for all using (es_admin_de(cliente_id))` (001) **ya** permite al
`admin_acueducto` hacer `UPDATE` sobre `codigo_suscriptor` — 003 solo lo bloqueaba a nivel de
aplicación (`validarCamposEditables` en `lib/suscriptores.ts`, para que nadie lo cambie sin querer
desde el `PATCH` genérico). 008 agrega una función y ruta **separadas y explícitas** que sí lo tocan,
usando el cliente ya autenticado del admin (`crearClienteSuscriptor`, el mismo patrón de todas las
rutas de `/app`) — sin tabla ni función nuevas. El `unique (cliente_id, codigo_suscriptor)` ya
existente rechaza un código duplicado dentro del mismo acueducto.

## 3. Rutas de la API (Hono)

### Portal (sesión propia, `requerirSesionSuscriptor`)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| `POST` | `/portal/:slug/login` | pública | `{numero_documento, codigo_suscriptor}` → resuelve `cliente_id` por `slug`, llama `portal_validar_credenciales`; `ok` → 200 + cookie `uc_sesion_suscriptor`; `invalido`/`bloqueado` → 401/429 con mensaje genérico o de bloqueo (CA-1/CA-9); `inactivo` → 403 con mensaje explícito (no es un problema de credenciales) |
| `POST` | `/portal/logout` | sesión portal | Revoca la cookie del portal (idempotente, igual que `/auth/logout`) |
| `GET` | `/portal/facturas` | sesión portal | `portal_facturas_suscriptor` → `{facturaActual, historial}` (el Worker separa la primera no anulada del resto, CA-4) |
| `GET` | `/portal/facturas/:id/pdf` | sesión portal | `portal_factura_completa` → si `null`, 404; si no, `generarPdfFactura` (006) + `application/pdf` (CA-5). Reutiliza la misma clave de R2 que la ruta admin (`facturas/{clienteId}/{facturaId}.pdf`) como caché de lectura; **no** actualiza `facturas.pdf_url` (el cliente `anon` no tiene permiso de escritura ahí — ver §5, simplificación deliberada) |
| `GET` | `/portal/saldo-favor` | sesión portal | `portal_saldo_favor_suscriptor` → `{saldoFavor}` (CA-6) |
| `GET` | `/portal/consumo` | sesión portal | `portal_consumo_suscriptor` → `{lecturas}` (CA-7) |

`requerirSesionSuscriptor` (nuevo, espejo de `requerirClienteActivo` pero para el portal):

```ts
type ResultadoSesionSuscriptor =
  | { ctx: { supabase: SupabaseClient; sesion: SesionSuscriptor }; respuesta?: undefined }
  | { ctx: null; respuesta: Response };

async function requerirSesionSuscriptor(c: Context<{ Bindings: Env }>): Promise<ResultadoSesionSuscriptor> {
  const sesion = await verificarSesionSuscriptor(c); // lee/renueva cookie; null si inválida
  if (!sesion) return { ctx: null, respuesta: c.json({ error: 'No autenticado' }, 401) };
  return { ctx: { supabase: crearClienteAnon(c.env), sesion } }; // D-10: SIEMPRE anon
}
```

### Admin (sesión administrativa existente, `requerirClienteActivo`)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| `POST` | `/suscriptores/:id/regenerar-codigo` | admin_acueducto | `{codigo_nuevo}` → `UPDATE usuarios_servicio set codigo_suscriptor = codigo_nuevo` (RLS ya lo permite); 409 si el código ya existe en el cliente (violación del `unique`); no afecta sesiones de portal ya activas (CA-8) |

## 4. Contratos de `sesion-suscriptor.ts`

Extiende el contrato ya fijado — cambio justificado en §5 (D-10 exige reenviar
`numero_documento`+`codigo_suscriptor` en cada llamada a las funciones del portal, no solo en el
login):

```ts
export interface SesionSuscriptor {
  tipo: 'suscriptor';
  usuarioServicioId: string;   // "sub" del JWT
  clienteId: string;           // "cid" del JWT
  numeroDocumento: string;     // "doc" del JWT — NUEVO (D-10)
  codigoSuscriptor: string;    // "cod" del JWT — NUEVO (D-10)
  expiraEn: number;            // "exp" del JWT (epoch s)
}

export const DURACION_SESION_SUSCRIPTOR_SEG = 30 * 24 * 60 * 60;   // ya existía
export const UMBRAL_RENOVACION_SUSCRIPTOR_SEG = 7 * 24 * 60 * 60;  // ya existía

// Firma el JWT (hono/utils/jwt, HS256, SESSION_SECRET) y escribe la cookie
// uc_sesion_suscriptor (HttpOnly+Secure+SameSite=Lax, D-4). No valida
// credenciales — eso ya lo hizo portal_validar_credenciales antes de llamar esto.
export async function iniciarSesionSuscriptor(
  c: Context<{ Bindings: Env }>,
  datos: { usuarioServicioId: string; clienteId: string; numeroDocumento: string; codigoSuscriptor: string },
): Promise<SesionSuscriptor>;

// Lee la cookie, verifica firma + exp + tipo:'suscriptor' (CLAUDE.md §10-22c).
// Nunca lanza: inválida/vencida/ausente → null. Si quedan < UMBRAL_RENOVACION
// segundos, renueva automáticamente (reescribe la cookie) antes de devolver.
export async function verificarSesionSuscriptor(
  c: Context<{ Bindings: Env }>,
): Promise<SesionSuscriptor | null>;

// Uso interno de verificarSesionSuscriptor (y disponible para tests): reescribe
// la cookie con un exp nuevo a partir de una sesión ya vigente.
export async function renovarSesionSuscriptor(
  c: Context<{ Bindings: Env }>,
  sesion: SesionSuscriptor,
): Promise<SesionSuscriptor>;
```

`ErrorSesionSuscriptorPendiente` se elimina (ya no hay nada pendiente).

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| **D-10**: aislamiento con funciones `SECURITY DEFINER` acotadas, invocadas con la clave `anon`; cada una revalida `numero_documento`+`codigo_suscriptor` | `SUPABASE_SERVICE_ROLE_KEY` en las rutas del portal | Prohibido sin excepción por `CLAUDE.md §12`; ver `docs/DECISIONES.md` D-10 |
| El JWT del portal lleva `numeroDocumento`+`codigoSuscriptor` como claims firmados, no solo `usuarioServicioId` | JWT mínimo (solo `sub`/`cid`, como el borrador original de la interfaz) | D-10 exige que **cada** llamada a una función del portal aporte credenciales reales (no solo el login); sin esto, el suscriptor tendría que re-teclearlas en cada página |
| `portal_facturas_suscriptor`/`portal_factura_completa`/`portal_saldo_favor_suscriptor`/`portal_consumo_suscriptor` como 4 funciones separadas (una por recurso) | Una sola función "todo en uno" que devuelva todo el estado del suscriptor | Cada una es más fácil de auditar/testear por separado y solo se ejecuta cuando la página la necesita (p. ej. el PDF no recalcula el consumo) |
| Mitigación de fuerza bruta con una **tabla** (`portal_intentos_login`) + `SECURITY DEFINER` | Cloudflare KV / Durable Objects para contadores | Cero infraestructura nueva (CLAUDE.md §2, "cero infraestructura de pago hasta el primer cliente"); reutiliza el mismo motor (Postgres) y el mismo patrón de seguridad que todo lo demás |
| Umbral de intentos y minutos de bloqueo como **columnas de `configuracion`** (`portal_umbral_intentos_login`, `portal_bloqueo_minutos`) | Hardcodearlos en la función | Mismo patrón ya establecido para constantes ajustables por acueducto (`porcentaje_mora`, `dias_umbral_corte`); un acueducto con más o menos tolerancia al riesgo lo ajusta sin tocar código (decisión de Mateo en el checkpoint de `/plan`) |
| Riesgo residual aceptado: el límite es por `(cliente_id, numero_documento)`, no por IP | Límite adicional por IP/Cloudflare Rate Limiting | Cloudflare Rate Limiting es un producto aparte (con costo); un atacante que prueba muchas cédulas distintas no lo dispara — aceptado para v1, documentado como riesgo abierto (spec §7) |
| El PDF servido por el portal **no actualiza** `facturas.pdf_url` | Una función `SECURITY DEFINER` adicional solo para ese `UPDATE` | El campo es bookkeeping para la vista admin; el R2 sí queda cacheado (mismo key) así que no se regenera dos veces; no vale una función nueva solo para un campo informativo |
| `regenerar_codigo_suscriptor` reutiliza la RLS existente (`crearClienteSuscriptor` del admin) | Una RPC `SECURITY DEFINER`/`INVOKER` nueva, como las de 007 | La política `usuarios_servicio_escritura` ya cubre exactamente este `UPDATE`; una RPC nueva sería redundante |
| JWT firmado con `hono/utils/jwt` (ya viene con `hono`, cero dependencias nuevas) | `jose` u otra librería de JWT | `hono` ya está instalado; su `sign`/`verify` HS256 corre sobre Web Crypto, disponible en Workers, sin instalar nada |
| Slug de acueducto en la URL (`/portal/{slug}/login`) resuelve `cliente_id` antes de validar credenciales | Buscar `(numero_documento, codigo_suscriptor)` sin acotar por cliente | `codigo_suscriptor` es único solo por `cliente_id`; sin el slug la búsqueda es ambigua entre acueductos (spec §3.1) |

## 6. Dependencias nuevas

| Paquete | Versión | Licencia | Por qué | Alternativa descartada |
|---|---|---|---|---|
| (ninguna) | — | — | `hono/utils/jwt` ya viene con `hono` (instalado desde 001); las funciones del portal son SQL puro | `jose` (JWT), Cloudflare KV (rate limit) |

## 7. Límites de Cloudflare Workers a considerar

- Las 5 funciones del portal son `SELECT`/`UPDATE` de una sola fila o un conjunto acotado por
  `usuario_servicio_id` — CPU trivial, sin colas.
- `GET /portal/facturas/:id/pdf` reutiliza exactamente el mismo patrón de 006 (R2 + `pdf-lib`, 1-4ms
  de CPU, memoria muy por debajo de los 128 MB del isolate).
- Bundle: sin dependencias nuevas; `hono/utils/jwt` ya está en el bundle actual de `hono`.

## 8. Estrategia de pruebas

- **Unitarias (`sesion-suscriptor.ts`, `vitest` sin Workers/base):** firmar y verificar un JWT válido
  (round-trip completo con los 4 claims nuevos); rechazar `tipo` distinto de `'suscriptor'`; rechazar
  firma inválida (secreto distinto); rechazar `exp` vencido; renovar cuando quedan `< 7` días y NO
  renovar cuando quedan más.
- **Aislamiento (CA-2, CA-9):** `tests/aislamiento/008_portal_aislamiento.sql`, invocando las
  funciones directamente **como `anon`** (sin `set local role`/`request.jwt.claim.sub` — el portal no
  usa `auth.uid()`, D-2/D-10) con distintas combinaciones: credenciales correctas de A1 devuelven solo
  datos de A1; A1 pidiendo el `factura_id` de A2 (mismo cliente) o de un suscriptor de otro cliente vía
  `portal_factura_completa` → `null`; credenciales de A1 con el `cliente_id` de B → nada; 8 intentos
  fallidos seguidos → el 9.º ya viene `bloqueado` aunque las credenciales del 9.º sean correctas.
  Regresión 001-007 en verde sobre el mismo estado final.
- **Integración (CA-1, CA-3 a CA-8):** contra Supabase local real + `wrangler dev` con curl: login con
  slug+credenciales reales → cookie `uc_sesion_suscriptor`; `GET /portal/facturas` refleja
  `fecha_emision` más reciente como actual; `GET /portal/facturas/:id/pdf` de una factura ajena → 404;
  `GET /portal/saldo-favor` coincide con el mismo suscriptor consultado por `GET
  /suscriptores/:id/pagos` (admin, 007); `GET /portal/consumo` no pierde periodos tras un reemplazo de
  contador (fixture con 2 contadores); `POST /suscriptores/:id/regenerar-codigo` (admin) seguido de un
  login con el código viejo → falla, con el nuevo → funciona, y una sesión de portal abierta antes del
  cambio sigue sirviendo `GET /portal/facturas`.
- **Manual (Mateo):** flujo click-a-click en navegador (`next dev` + `wrangler dev`) — "NO VERIFICADO"
  con pasos exactos si el entorno no permite correr ambos (patrón de 007 T-005).

### Orden de verificación (para `/tasks`)

1. Migración `20260908090000_portal-suscriptor.sql` + `SESSION_SECRET` en `.dev.vars` + fixture
   `portal.sql` + aislamiento 008 (CA-2, CA-9) + regresión 001-007.
2. `sesion-suscriptor.ts` + unit del JWT (sin Workers/base).
3. `lib/portal.ts` + rutas `/portal/*` + verificación curl/wrangler dev (CA-1, CA-3 a CA-7).
4. `regenerar_codigo` (admin): función + ruta + verificación curl (CA-8).
5. Frontend (`api.ts` + login + página del portal + botón de regenerar código) — build/lint (CA-10).
6. Cierre: CHANGELOG + checklist spec §8.
