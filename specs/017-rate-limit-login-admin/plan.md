# PLAN — 017: rate-limit-login-admin

**Spec aprobado:** 2026-09-07 (decisiones §0.3 mecanismo = tabla en PostgreSQL, §0.4 bloqueo =
retardo progresivo, y con la primera, la excepción de §3.1: tabla sin `cliente_id`).

**Estado de este plan:** EN REVISIÓN. `CLAUDE.md §3` exige checkpoint humano antes de `/tasks`.
**No se escribe código hasta que Mateo apruebe este documento.** Hay una desviación respecto de la
spec que necesita decisión explícita: §5.1.

---

## 0. Punto de partida (verificado leyendo el código y la base reales)

- **`POST /auth/login`** (`backend/src/index.ts`) hoy: normaliza el email con
  `body.email?.trim().toLowerCase() ?? ''`, llama a `iniciarSesion()` y responde `401 Credenciales
  inválidas` en cualquier fallo. **No consulta nada antes de golpear GoTrue.**
- **`portal_intentos_login`** (008), el patrón a calcar, existe con esta forma real:
  `id uuid pk`, `cliente_id uuid not null fk`, `numero_documento text not null`,
  `intentos smallint not null default 0`, `bloqueado_hasta timestamptz`,
  `ultimo_intento timestamptz not null default now()`, `unique (cliente_id, numero_documento)`,
  RLS `FORCE` con **una sola** política: `for select using (es_admin_plataforma())`.
- **`citext` NO está instalada** (sí disponible en el catálogo). Extensiones activas hoy: `pgcrypto`
  y `plpgsql`. → §5.2.
- **Última migración:** `20260915090000_fix-portal-login-documento-nulo.sql`.
- **`cron/limpieza.ts`** solo verifica conexión y registra que no hay nada que purgar.
  **Incoherencia de documentación detectada** (no se corrige aquí, se señala): su comentario dice que
  la purga "llega con la feature 015", pero `.specify/config.md` asigna 015 a `qr-ocr-lector` y 016 a
  `limpieza-automatica`. Es el mismo tipo de desfase que
  `docs/ESPECIFICACION-FUNCIONAL.md §2.14.1`, que llama "Feature 014" al QR/OCR que el roadmap
  numera 015. Conviene una tarea aparte que alinee los tres documentos.

---

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260916090000_rate-limit-login-admin.sql` | crear | Tabla, RLS, las 2 funciones y sus grants |
| `backend/src/lib/auth-intentos.ts` | crear | Capa fina sobre las 2 RPC (espejo de `lib/portal.ts`) |
| `backend/src/index.ts` | editar | `POST /auth/login`: verificar antes, registrar después |
| `backend/src/cron/limpieza.ts` | editar | Purga real de `admin_intentos_login` y `portal_intentos_login` |
| `backend/tests/unit/auth-intentos.test.ts` | crear | Contrato de la capa fina con Supabase falso |
| `tests/aislamiento/901_admin_intentos_login_aislamiento.sql` | crear | RLS, privilegios, retardo y CA-4 |
| `frontend/components/login-form.tsx` | editar | Mostrar el 429 con su `reintentar_en` |
| `specs/017-rate-limit-login-admin/spec.md` | editar | §8: quitar el requisito de `core/` (ver §5.1) |
| `docs/ESPECIFICACION-FUNCIONAL.md` | editar | Párrafo que hoy falta sobre bloqueo del login (spec §0.2) |
| `.specify/config.md` | editar | Fila 017 con la nota "prerrequisito de producción" |
| `docs/PLAN-PRODUCCION.md` | editar | A-2 → resuelto, con el commit |
| `CHANGELOG.md` | editar | Entrada de la sesión |

**Serie 901:** la numeración 900+ queda para suites que no pertenecen a una feature del roadmap
(precedente: `900_auditoria_consecutivo_factura_aislamiento.sql`). 017 no está en el roadmap original,
así que su suite entra en esa serie y no ocupa un número de feature.

---

## 2. Esquema de base de datos

### Migración `20260916090000_rate-limit-login-admin.sql`

```sql
create table admin_intentos_login (
  email            text        primary key,   -- YA normalizado: lower(btrim(email))
  intentos         smallint    not null default 0,
  bloqueado_hasta  timestamptz,
  ultimo_intento   timestamptz not null default now()
);
```

**Por qué cada decisión del DDL:**

- **`email` como clave primaria, `text`, sin `citext`** → §5.2.
- **Sin `cliente_id`** — excepción aprobada (spec §3.1). El login precede a la resolución del tenant.
  Mismo criterio que `_keepalive`: es infraestructura, no una tabla de negocio.
- **Sin `id uuid`** — a diferencia de `portal_intentos_login`, aquí el email ya es una clave natural
  única. Un `id` sintético solo añadiría una columna y un índice que nadie usa.
- **Sin clave foránea a `perfiles` ni a `auth.users`** — **esto es un requisito de CA-4, no un
  descuido.** Se cuentan los intentos contra emails que no existen exactamente igual que contra los
  que sí; una FK haría imposible registrar los primeros y convertiría el 429 en un oráculo de
  enumeración de cuentas.

### Políticas RLS

```sql
alter table admin_intentos_login enable row level security;
alter table admin_intentos_login force row level security;

create policy admin_intentos_login_plataforma on admin_intentos_login for select
  using (es_admin_plataforma());
```

Ninguna política de `insert`/`update`/`delete` para ningún rol: la tabla la escriben **solo** las dos
funciones `security definer`. Idéntico a `portal_intentos_login`. La única política de lectura es
para la plataforma (soporte), no para el acueducto: un `admin_acueducto` no tiene por qué ver los
intentos fallidos de nadie.

### Funciones

**Constantes del retardo (spec §3.6: globales, no por acueducto).** Van como constantes en el cuerpo
de la función, no en una tabla → §5.3.

| Constante | Valor | Qué es |
|---|---|---|
| `UMBRAL` | 5 | Fallos consecutivos antes del primer bloqueo |
| `BASE_MINUTOS` | 1 | Primer retardo |
| `TECHO_MINUTOS` | 60 | Máximo |
| `OLVIDO_HORAS` | 24 | Sin actividad, el contador vuelve a 0 |

Retardo = `min(BASE_MINUTOS * 2^(intentos − UMBRAL), TECHO_MINUTOS)` minutos:

| Fallos consecutivos | 1-4 | 5 | 6 | 7 | 8 | 9 | 10 | 11+ |
|---|---|---|---|---|---|---|---|---|
| Espera | — | 1 min | 2 | 4 | 8 | 16 | 32 | 60 (techo) |

```sql
-- 1) Se llama ANTES de signInWithPassword. Solo lee.
create or replace function admin_login_estado(p_email text) returns jsonb
  language plpgsql security definer set search_path = public;
--    → {"estado":"ok"} | {"estado":"bloqueado","reintentar_en":"<timestamptz>"}

-- 2) Se llama DESPUÉS, con el resultado real del intento. Escribe.
create or replace function admin_login_registrar(p_email text, p_exito boolean) returns void
  language plpgsql security definer set search_path = public;
```

Ambas: `revoke all ... from public;` + `grant execute ... to anon` (el Worker las llama **sin
sesión**, igual que las del portal). Ninguna se otorga a `authenticated`: no hay motivo.

**Reglas internas, en orden:**

1. `p_email` se normaliza otra vez dentro (`lower(btrim(...))`). El Worker ya lo hace; la función no
   se fía → **lección de C-1**: una `security definer` no confía en lo que le llega.
2. `p_email` nulo o vacío → `admin_login_estado` devuelve `{"estado":"ok"}` y
   `admin_login_registrar` no hace nada. No se crea una fila con clave vacía que todos los intentos
   sin email compartirían (sería un `DoS` trivial contra esa clave). Un login sin email falla igual
   por credenciales.
3. `admin_login_registrar` usa `insert ... on conflict (email) do update` para que dos intentos
   simultáneos no se pisen.
4. **Olvido:** si `ultimo_intento < now() - OLVIDO_HORAS`, el contador arranca de 0 antes de sumar.
5. **Éxito** → `intentos = 0`, `bloqueado_hasta = null`.
6. **Fallo** → `intentos + 1`; si alcanza `UMBRAL`, `bloqueado_hasta = now() + retardo`.

**Punto fino de coherencia (spec §0.4):** durante la espera, `admin_login_estado` devuelve
`bloqueado` y la ruta corta **antes** de llamar a GoTrue — así que ni siquiera la contraseña correcta
entra. Si un acierto pudiera saltarse el bloqueo, el bloqueo no protegería de nada: la fuerza bruta
consiste precisamente en acertar. El reinicio por acierto aplica antes del umbral y después de que la
espera expire, nunca durante.

---

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Cambio |
|---|---|---|---|
| POST | `/auth/login` | pública | Verificar antes y registrar después |

```
1. email = body.email?.trim().toLowerCase() ?? ''      (sin cambios)
2. admin_login_estado(email)
     bloqueado → 429 { error: 'Demasiados intentos. Intente más tarde.', reintentar_en }
     error de la RPC → 503 (falla CERRADO, ver §5.4)
3. iniciarSesion(email, password)                       (sin cambios)
4. admin_login_registrar(email, exito)                  (su fallo NO cambia el resultado, §5.4)
5. resto igual: 200 con sesión/perfil/membresías, o 401 'Credenciales inválidas'
```

**El 429 reutiliza el contrato exacto que ya devuelve el portal** (`index.ts`, ruta
`POST /portal/:slug/login`): `{ error, reintentar_en }`. Un solo formato de "demasiados intentos" en
todo el sistema; el frontend puede tratarlos igual.

**Cliente de Supabase:** `crearClienteAnon(c.env)`. No hay sesión todavía, y las funciones están
otorgadas a `anon`. **Nunca `service_role`** (CLAUDE.md §5.4/§12).

---

## 4. Contratos de `backend/src/lib/auth-intentos.ts`

Espejo de `lib/portal.ts`. Sin lógica de negocio: traduce RPC ↔ tipos.

```ts
export interface EstadoLoginAdmin {
  bloqueado: boolean;
  reintentarEn?: string;   // ISO 8601, presente solo si bloqueado
}

// Lanza si la RPC falla: la ruta lo traduce a 503 (falla cerrado, §5.4).
export function estadoLoginAdmin(env: Env, email: string): Promise<EstadoLoginAdmin>;

// NUNCA lanza: registra con console.error y sigue (§5.4).
export function registrarIntentoLoginAdmin(env: Env, email: string, exito: boolean): Promise<void>;
```

`core/` no recibe nada nuevo → §5.1.

---

## 5. Decisiones técnicas

### 5.1 DESVIACIÓN DE LA SPEC — el cálculo del retardo no va a `core/`

**La spec §8 pide** "tests unitarios del cálculo del retardo progresivo en `core/` (es lógica pura,
§5.3)". **Este plan propone no hacerlo, y necesita que Mateo lo apruebe** (`CLAUDE.md §3`: si
aparece algo fuera del spec, se detiene y se reporta).

Razón: el retardo tiene que calcularse **en la misma transacción** que incrementa el contador, o dos
intentos simultáneos calculan sobre el mismo valor. Eso obliga a que viva en SQL. Ponerlo *además*
en `core/` sería tener la misma fórmula en dos sitios — exactamente lo que `CLAUDE.md §5.6` prohíbe
para el redondeo ("se define una vez, se testea, y no se repite en ningún otro lugar"). El principio
de definir-una-vez pesa más aquí que la letra de §8, sobre todo porque **esto no calcula dinero**,
que es el supuesto que motiva §5.3.

La fórmula se testea igual de a fondo, pero desde `tests/aislamiento/901`, ejecutando la función real
contra PostgreSQL y comprobando la tabla de valores de §2. Es evidencia más fuerte que un test
unitario de una copia en TypeScript.

**Si Mateo prefiere la letra de §8**, la alternativa es que SQL guarde solo `intentos` y que el
Worker calcule el bloqueo con una función de `core/`. Cuesta: la aplicación pasa a ser el punto de
control (más débil que la base) y cualquier otro llamante de la RPC se salta la protección. No lo
recomiendo, pero es viable.

### 5.2 `text` normalizado en vez de `citext`

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `email text`, normalizado a `lower(btrim())` en el Worker **y** dentro de la función | `citext` | `citext` no está instalada (verificado) y añadir una extensión al esquema por una sola columna no se justifica. La ruta ya normaliza; la función lo repite por defensa. `text` además evita las sorpresas de comparación de `citext` en índices. |

### 5.3 Constantes en la migración, no tabla de configuración

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `UMBRAL`/`BASE`/`TECHO`/`OLVIDO` como constantes en el cuerpo de la función | Fila en una tabla de sistema | La spec §3.6 admite ambas. Las constantes quedan versionadas en `supabase/migrations/` y auditables en el diff; una tabla añade RLS, purga y una vía de escritura más. Ajustar estos valores es raro (no es una tarifa). **Coste asumido:** cambiarlos exige migración y despliegue. |

### 5.4 Falla CERRADO al verificar, ABIERTO al registrar

`CLAUDE.md §7` obliga a decidir esto explícitamente:

| Momento | Si la RPC falla | Razón |
|---|---|---|
| `admin_login_estado` (antes) | **503**, no se intenta el login | GoTrue y esta tabla son el mismo PostgreSQL: si la tabla no responde, el login iba a fallar igual. Fallar abierto haría que la protección desapareciera justo cuando un atacante puede provocarlo. |
| `admin_login_registrar` (después) | `console.error` y el resultado del login se mantiene | Un fallo al anotar no puede convertir un login correcto en un error para el usuario (mismo criterio que la regla 20 con el correo). Y no abre un hueco real: si registrar falla de forma sostenida, verificar también fallará y la ruta ya devuelve 503. |

### 5.5 Purga dentro de esta feature

`cron/limpieza.ts` borra de `admin_intentos_login` y de `portal_intentos_login` las filas
**sin bloqueo vigente** y con `ultimo_intento` anterior a 30 días. **Nunca** borra una fila con
`bloqueado_hasta > now()`: eso regalaría al atacante una forma de limpiar su propio bloqueo esperando
al cron. Esto **cierra de paso el hallazgo M-6** de la auditoría.

### 5.6 Frontend

`login-form.tsx` ya muestra el `error` que devuelve la API. Se añade que, si la respuesta es 429 con
`reintentar_en`, el mensaje diga cuántos minutos faltan en vez de un texto genérico. `useHidratado()`
ya está en ese formulario (verificado en la auditoría): **no se toca esa parte**.

---

## 6. Dependencias nuevas

Ninguna. Ni npm ni extensiones de PostgreSQL (§5.2).

---

## 7. Límites de Cloudflare Workers

Sin impacto. Se añaden **2 llamadas RPC** por intento de login (una antes, una después), ambas
consultas indexadas por clave primaria sobre una tabla de unos pocos cientos de filas. No toca CPU de
cron ni de cola, no crece el bundle (sin dependencias), y la memoria no se ve afectada. El caso caro
—un login bloqueado— es el **más barato**: corta en la primera RPC y no llega a GoTrue.

---

## 8. Estrategia de pruebas

**Unitarias (`backend/tests/unit/auth-intentos.test.ts`)** — con un cliente de Supabase falso, igual
que `cierre-facturacion-tenant.test.ts`: que `estadoLoginAdmin` traduce bien las tres respuestas,
que **lanza** si la RPC falla (para que la ruta dé 503) y que `registrarIntentoLoginAdmin` **no
lanza** nunca. Ningún test en `core/` → §5.1.

**Aislamiento (`tests/aislamiento/901_...`)**, contra PostgreSQL real:

| Paso | Comprueba | CA |
|---|---|---|
| 1 | RLS `ENABLE` + `FORCE`; `anon` y `authenticated` no leen, insertan, actualizan ni borran la tabla | CA-6 |
| 2 | Las 2 funciones **no** están otorgadas a `public`; sí a `anon` | CA-6 |
| 3 | La tabla completa de retardos de §2 (5→1 min, 6→2, 7→4, 8→8, 9→16, 10→32, 11+→60) | CA-1, CA-3 |
| 4 | Con k<5 fallos, un éxito deja `intentos = 0` | CA-2 |
| 5 | Con bloqueo vigente, `admin_login_estado` devuelve `bloqueado` (y la ruta corta antes de GoTrue) | CA-1 |
| 6 | Manipulando `bloqueado_hasta` al pasado, se puede reintentar; y el bloqueo siguiente es **mayor** | CA-3 |
| 7 | Un email inexistente produce **exactamente** la misma secuencia que uno registrado | **CA-4** |
| 8 | Email nulo/vacío no crea fila | robustez |
| 9 | Tras `OLVIDO_HORAS` sin actividad, el contador arranca de 0 | §2 regla 4 |
| 10 | La purga borra lo caducado y **no** lo bloqueado | CA-7 |

Regresión completa 001-012 + 900 + 901 sobre base reconstruida, método canónico de la Sesión 026.

**Integración**, `curl` real contra `wrangler dev` + Supabase local: bucle de 6 intentos fallidos
mostrando la secuencia de códigos (`401 401 401 401 401 429`), el `reintentar_en` del 429, y las dos
series lado a lado de CA-4 (email registrado vs. inexistente) con cuerpos y códigos pegados.

**Manual (requiere Mateo):** CA-5, que el login legítimo no se degrada — `curl -w '%{time_total}'`
antes y después sobre el mismo entorno; y la comprobación del 429 en el navegador real.

---

## 9. Lo que este plan NO hace

Por si queda duda al aprobarlo: no toca el portal (008) ni su `portal_intentos_login` salvo para
purgarlo; no añade CAPTCHA ni MFA; no limita ninguna otra ruta de la API; no limita por IP (spec
§0.5: el Worker intermedia ante GoTrue y todas las peticiones salen de IPs de Cloudflare); y no cierra
el registro público (hallazgo M-5, decisión de producto aparte).
