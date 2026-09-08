# PLAN — 018: panel-plataforma

**Spec aprobado:** 2026-09-08 (decisiones §0.3 = alta directa con contraseña temporal, §0.4 = ruta
`/plataforma`).

**Estado de este plan:** EN REVISIÓN. `CLAUDE.md §3` exige checkpoint humano antes de `/tasks`.
**No se escribe código hasta que Mateo apruebe este documento completo.** La desviación de diseño de
§5.1 (por qué NO es una sola transacción atómica) ya fue **aprobada explícitamente por Mateo
(2026-09-08)**: acepta el riesgo residual de un fallo a mitad del alta, a cambio de no usar
`service_role` en la ruta.

---

## 0. Punto de partida (verificado leyendo el código y el esquema reales)

- **`clientes_plataforma`** (política RLS, `for all using (es_admin_plataforma())`) — el superadmin
  YA puede insertar/actualizar/borrar en `clientes` directamente, sin función nueva.
- **`membresias_plataforma`** (`for all using (es_admin_plataforma())`) — igual para `membresias`.
- **`configuracion_escritura`** (`using (es_admin_de(cliente_id))`, y `es_admin_de` incluye
  `es_admin_plataforma()`) — igual para `configuracion`.
- **`perfiles` NO tiene ninguna política de `insert`** — solo `perfiles_lectura` (select) y
  `perfiles_update_propio` (update, `id = auth.uid()`). Es la única tabla de las cuatro donde el
  superadmin necesita un permiso nuevo. `crear_tenant_con_admin()` (001) evita este problema siendo
  `security definer`, pero ese caso es distinto: ahí el usuario se crea SU PROPIO perfil
  (`auth.uid()`); aquí el superadmin crea el perfil de **otra persona**.
- **`crear_tenant_con_admin(p_nombre_cliente, p_slug, p_email)`** exige `auth.uid() is not null` y
  **que el llamante no tenga ya una membresía activa** (`fundacion-tenancy.sql:295`). El superadmin SÍ
  tiene una membresía activa (la suya, `administrador`) — así que **no puede reutilizar esta función
  tal cual**, ni aunque quisiera: fallaría con `'El usuario ya tiene un acueducto'`.
- **`resolverClienteActivo()`** (`backend/src/lib/tenant.ts`) no filtra `cliente_id IS NULL`
  (confirmado el bug en sesión: produce `activo = {clienteId: null, rol: 'administrador', nombre: ''}`
  cuando esa es la única membresía).
- **`GET /dashboard`** (`index.ts:285-309`) y el helper compartido `requerirClienteActivo`
  (`index.ts:322-334`) son los dos únicos lugares que llaman a `resolverClienteActivo`.
- **No hay `SUPABASE_SERVICE_ROLE_KEY` disponible en ninguna ruta de usuario** (`CLAUDE.md §5.4/§12`,
  absoluto, sin excepciones) → condiciona todo el diseño de cómo se crea el `auth.users` del admin
  nuevo, ver §5.1.
- **`POST /auth/registro`** (`index.ts:129-142`) ya usa `crearClienteAnon(c.env).auth.signUp({email,
  password})` — confirma que crear un usuario de Auth **no** requiere `service_role`; con la clave
  `anon` alcanza. Es el mecanismo que este plan reutiliza para el alta del admin nuevo.
- **Última migración:** `20260918090000_endurecer-privilegios-funciones.sql`.
- **Patrón de ruta protegida por rol** ya existe (`index.ts:1004-1014`, regeneración de código):
  consulta directa a `membresias` + comprobación explícita de rol + 403 con mensaje claro. Se replica
  para `es_admin_plataforma` en vez de `admin_acueducto`.

---

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260919090000_panel-plataforma.sql` | crear | Política `perfiles_alta_plataforma` + 2 funciones `security invoker` |
| `backend/src/lib/tenant.ts` | editar | `resolverClienteActivo`: excluir `cliente_id IS NULL` de `activo`/`lista`; exponer `esAdminPlataforma` |
| `backend/src/lib/plataforma.ts` | crear | Orquesta el alta: `crearAcueductoBase`, `signUpAdminAcueducto`, `asignarAdminAcueducto`, `generarContrasenaTemporal` |
| `backend/src/index.ts` | editar | `GET /dashboard` (agrega `esAdminPlataforma` al 400); nuevas `GET /plataforma` y `POST /plataforma/acueductos` |
| `backend/tests/unit/plataforma.test.ts` | crear | Contrato de `lib/plataforma.ts` con Supabase falso (orden de llamadas, manejo de fallos) |
| `tests/aislamiento/903_panel_plataforma_aislamiento.sql` | crear | RLS de `perfiles_alta_plataforma`, privilegios de las 2 funciones, aislamiento cruzado |
| `frontend/app/app/dashboard/page.tsx` | editar | Si `esAdminPlataforma` → `redirect('/plataforma')` en vez de `/onboarding` |
| `frontend/app/plataforma/page.tsx` | crear | Server component: lista de acueductos + formulario de alta |
| `frontend/components/plataforma-form.tsx` | crear | Client component, `useHidratado()` (CLAUDE.md §7) |
| `specs/018-panel-plataforma/spec.md` | editar | Marcar CA-1 a CA-5 con su evidencia al cerrar |
| `docs/ESPECIFICACION-FUNCIONAL.md` | editar | Párrafo nuevo: panel de plataforma |
| `.specify/config.md` | editar | Fila 018, nota "prerrequisito de producción" |
| `CHANGELOG.md` | editar | Entrada de la sesión |

**Serie 903:** siguiente libre en la numeración 900+ (901 = 017, 902 = privilegios B-3).

---

## 2. Esquema de base de datos

### Migración `20260919090000_panel-plataforma.sql`

```sql
-- 1) Permite al superadmin crear el perfil de OTRA persona (único hueco de RLS
--    que le falta; las otras 3 tablas ya lo permiten, ver §0).
create policy perfiles_alta_plataforma on perfiles for insert
  with check (es_admin_plataforma());

-- 2) clientes + configuracion en una transacción. SECURITY INVOKER (NO
--    definer): el propio RLS de ambas tablas ya autoriza al superadmin: no
--    hace falta bypasear nada (lección de C-1: menos SECURITY DEFINER, no más).
create or replace function crear_acueducto_base(p_nombre_cliente text, p_slug text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_id uuid;
begin
  insert into clientes (nombre, slug) values (p_nombre_cliente, p_slug)
    returning id into v_cliente_id;
  insert into configuracion (cliente_id) values (v_cliente_id);
  return v_cliente_id;
exception when unique_violation then
  raise exception 'El slug ya está en uso';
end $$;

-- 3) perfiles + membresias en una transacción, para un usuario que YA existe
--    en auth.users (creado por signUp() desde el Worker, ver lib/plataforma.ts).
--    SECURITY INVOKER también: perfiles_alta_plataforma + membresias_plataforma
--    ya autorizan esto sin bypasear RLS.
create or replace function asignar_admin_acueducto(
  p_cliente_id uuid, p_usuario_id uuid, p_nombre text, p_email text
) returns void
language plpgsql security invoker set search_path = public as $$
begin
  insert into perfiles (id, nombre, email) values (p_usuario_id, p_nombre, p_email);
  insert into membresias (perfil_id, cliente_id, rol)
    values (p_usuario_id, p_cliente_id, 'admin_acueducto');
end $$;

revoke all on function crear_acueducto_base(text, text) from public, anon;
grant  execute on function crear_acueducto_base(text, text) to authenticated;
revoke all on function asignar_admin_acueducto(uuid, uuid, text, text) from public, anon;
grant  execute on function asignar_admin_acueducto(uuid, uuid, text, text) to authenticated;
```

**Por qué `security invoker` y no `security definer`, a diferencia de `crear_tenant_con_admin`:** ahí
el llamante (usuario recién registrado, sin membresía) NO pasa `clientes_plataforma` — necesita el
bypass. Aquí el llamante YA es `es_admin_plataforma()` y las políticas existentes lo autorizan en las
4 tablas (una vez añadida `perfiles_alta_plataforma`). Usar `invoker` dejando que RLS haga el trabajo
es estrictamente más seguro que `definer`: cero superficie de "identificador desnudo" que auditar
(la lección de C-1 no es "usa definer con cuidado", es "el bypass es el riesgo en sí").
Los `grant`/`revoke` se mantienen por higiene y consistencia con el resto del esquema (B-3), aunque
con `invoker` la protección real ya la da RLS, no el grant.

### RLS

Nada nuevo que activar: las 4 tablas ya tienen `ENABLE`+`FORCE` desde 001. Solo se agrega la política
de `insert` en `perfiles`.

---

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/plataforma` | `es_admin_plataforma` | Lista de `clientes` (nombre, slug, fecha_alta) |
| POST | `/plataforma/acueductos` | `es_admin_plataforma` | Alta: `{nombre, slug, nombreAdmin, correoAdmin}` |
| GET | `/dashboard` | administrativa | **Editada**: agrega `esAdminPlataforma` al `400 Sin acueducto` |

### Helper `requerirAdminPlataforma` (mismo patrón que `requerirClienteActivo`, `index.ts:322-334`)

```ts
async function requerirAdminPlataforma(c): Promise<{ ctx: {...} } | { ctx: null; respuesta: Response }> {
  const sesion = await verificarSesionAdministrativa(c);
  if (!sesion) return { ctx: null, respuesta: c.json({ error: 'No autenticado' }, 401) };
  const accessToken = obtenerAccessToken(c);
  const supabase = crearClienteSuscriptor(c.env, accessToken ?? '');
  const { data: membresia } = await supabase.from('membresias')
    .select('rol').eq('perfil_id', sesion.perfilId).is('cliente_id', null)
    .eq('rol', 'administrador').eq('activo', true).maybeSingle();
  if (!membresia) return { ctx: null, respuesta: c.json({ error: 'No autorizado' }, 403) };
  return { ctx: { supabase, perfilId: sesion.perfilId } };
}
```

### `POST /plataforma/acueductos` — orden de operaciones (§5.1 explica por qué este orden)

```
1. requerirAdminPlataforma(c) → 401/403 si no aplica
2. validar body: nombre, slug (regex ^[a-z0-9]+(-[a-z0-9]+)*$), nombreAdmin, correoAdmin no vacíos
3. crearAcueductoBase(ctx.supabase, nombre, slug)
     slug duplicado → 400 'El slug ya está en uso' (nada se creó, fin limpio)
4. generarContrasenaTemporal()                              (lib/plataforma.ts, ver §4)
5. signUpAdminAcueducto(c.env, correoAdmin, contrasenaTemporal)
     falla (email ya registrado, etc.) → 500 con mensaje que incluye el cliente_id ya creado
     ("el acueducto '<slug>' quedó creado sin administrador; reintente el alta del admin para
     ese acueducto" — ver §5.1, no hay reintento automático en v1)
6. asignarAdminAcueducto(ctx.supabase, clienteId, usuarioId, nombreAdmin, correoAdmin)
     falla → 500, mismo mensaje que en el paso 5 (el auth.users ya existe, igual hay que
     completar perfiles+membresias a mano — operación excepcional, documentada en §5.1)
7. éxito → 201 { clienteId, slug, correoAdmin, contrasenaTemporal }
   (la contraseña se muestra UNA vez en la respuesta; el backend no la guarda en ningún lado)
```

**Cliente de Supabase:** `crearClienteSuscriptor(c.env, accessToken)` — el JWT del superadmin, para
que `es_admin_plataforma()` resuelva vía RLS en los pasos 3 y 6. El paso 5 (`signUp`) usa
`crearClienteAnon`, igual que `/auth/registro` — es una llamada de Auth, no de datos, y **nunca**
`service_role` (CLAUDE.md §12).

---

## 4. Contratos de `backend/src/lib/plataforma.ts`

```ts
export function generarContrasenaTemporal(): string;
// crypto.getRandomValues (Web Crypto, disponible en Workers) → 20 caracteres
// alfanuméricos. Sin dependencia nueva.

export async function crearAcueductoBase(
  supabase: SupabaseClient, nombre: string, slug: string,
): Promise<{ clienteId: string }>;
// RPC crear_acueducto_base. Lanza con el mensaje de la excepción SQL tal cual
// (incluye 'El slug ya está en uso').

export async function signUpAdminAcueducto(
  env: Env, email: string, password: string,
): Promise<{ usuarioId: string }>;
// crearClienteAnon(env).auth.signUp(...). Lanza si GoTrue rechaza.

export async function asignarAdminAcueducto(
  supabase: SupabaseClient, clienteId: string, usuarioId: string, nombre: string, email: string,
): Promise<void>;
// RPC asignar_admin_acueducto. Lanza tal cual.
```

Sin lógica de negocio (dinero, tarifas, etc.) → no va a `core/`, igual que `lib/tenant.ts` y
`lib/auth-intentos.ts`. Es orquestación de dos sistemas (Postgres + GoTrue), inherentemente atada a
Supabase.

### `resolverClienteActivo` — firma nueva

```ts
export async function resolverClienteActivo(
  supabase: SupabaseClient, perfilId: string,
): Promise<{ activo: ClienteActivo | null; lista: ClienteActivo[]; esAdminPlataforma: boolean }>;
```

`esAdminPlataforma = filas.some(f => f.cliente_id === null && f.rol === 'administrador')`.
`lista`/`activo` se calculan solo con `filas.filter(f => f.cliente_id !== null)` — la membresía de
plataforma deja de contarse como "acueducto". Es un campo **aditivo**: `requerirClienteActivo`
(`index.ts:329`) desestructura `{ activo, lista }` y sigue compilando sin tocarlo.

---

## 5. Decisiones técnicas

### 5.1 DECISIÓN APROBADA — no hay una transacción atómica única (aprobado 2026-09-08)

**El problema real:** el admin nuevo vive en dos sistemas distintos — `auth.users` (GoTrue) y
`perfiles`/`membresias` (Postgres, vía PostgREST/RPC). No hay una transacción de base de datos que
abarque los dos: GoTrue no participa en la transacción SQL de Postgres aunque comparta el motor.
Lograr atomicidad real exigiría la API admin de GoTrue (`admin.createUser`, con rollback vía
`admin.deleteUser` si algo falla después) — y **esa API exige `SUPABASE_SERVICE_ROLE_KEY`**, prohibido
sin excepción en una ruta de usuario (`CLAUDE.md §12`, absoluto). Con `signUp()` (clave `anon`) no hay
forma de deshacer la creación del `auth.users` si el paso siguiente falla.

**Este plan elige el orden que minimiza el daño de una falla, no que la elimina:**

1. **Primero `clientes`+`configuracion`** (paso 3): la única forma real de fallar es un slug
   duplicado, y si falla, **no se ha tocado Auth todavía** — error limpio, nada que limpiar.
2. **Después `signUp`** (paso 5): si falla (email ya registrado, contraseña rechazada), queda un
   `clientes` sin admin — **visible en la lista de `/plataforma`**, no un usuario huérfano invisible.
   Se puede distinguir en la UI ("sin administrador asignado") y reintentar manualmente.
3. **Al final `asignar_admin_acueducto`** (paso 6): para cuando se llega aquí, `clientes` y
   `auth.users` ya existen y son válidos; las únicas causas de fallo son un error de base de datos
   genuino (no un conflicto de negocio esperable). Si falla, el `auth.users` ya existe con la
   contraseña temporal que se le entregó a Mateo — recuperable a mano completando `perfiles`+
   `membresias` por SQL una sola vez, no reconstruible por la API en v1.

**Lo que NO se construye en v1** (y por qué es aceptable ahora, no en producción con clientes reales):
un flujo de reintento automático que reconecte un `auth.users` huérfano con un `clientes` sin admin.
Es una operación de bootstrap que hace **una persona (Mateo)**, a mano, para dar de alta acueductos —
no un flujo de autoservicio de usuarios finales. El riesgo real es bajo (el único punto de fallo no
trivial, el paso 5, ya casi no puede fallar tras el pre-chequeo del paso 3) y el costo de construir
reconciliación automática entre dos sistemas sin transacción compartida es alto para un caso de uso
de baja frecuencia. **Se pide aprobación explícita de Mateo para este trade-off**, con la alternativa
documentada abajo si prefiere no aceptarlo.

**Alternativa si Mateo NO acepta este riesgo:** volver a la Opción A de la spec (§0.3, invitación por
correo) — ahí nadie crea `auth.users` hasta que el propio invitado acepta y fija su contraseña, así
que el "crear usuario" y el "crear perfil" ocurren en el mismo instante, para la misma persona, con
su propio JWT — el mismo patrón, sin bypasear nada, que ya usa `crear_tenant_con_admin`. Cuesta la
tabla de invitaciones y la pantalla pública que la Opción B evitaba.

**APROBADO (Mateo, 2026-09-08):** acepta el riesgo residual descrito arriba — es una operación de bajo
volumen que él mismo ejecuta, el único punto de fallo no trivial (`signUp`) casi no puede fallar tras
el prechequeo del slug, y el plan sigue sin `service_role` en la ruta. Se mantiene el diseño de tres
pasos tal como está escrito; no se construye la Opción A.

### 5.2 `resolverClienteActivo` — por qué se toca una función ya probada

Es la función que resuelve el bug real de esta sesión. Se revisan **los dos únicos callers**
(`index.ts:290` y `:329`, confirmado en §0) antes de tocarla: ninguno desestructura `esAdminPlataforma`
hoy, así que añadirlo no rompe nada; el cambio de qué cuenta como `lista`/`activo` sí es un cambio de
comportamiento, y es exactamente el que corrige CA-3.

### 5.3 Por qué `/plataforma` no usa un middleware de Hono nuevo

Se sigue el patrón ya existente (`requerirClienteActivo`, `index.ts:322`): un helper por-ruta, no un
middleware global. Es coherente con cómo ya está escrito el resto del archivo y evita introducir dos
formas distintas de resolver autorización en el mismo Worker.

### 5.4 Contraseña temporal — generación y entrega

`crypto.getRandomValues` (Web Crypto estándar, sin dependencia nueva, disponible en el runtime de
Workers). 20 caracteres de un alfabeto alfanumérico sin ambigüedad visual (sin `0/O/1/l`). Se
devuelve **una sola vez** en el `201` de `POST /plataforma/acueductos`; no se guarda en ninguna tabla
ni se loguea (`console.log` de una contraseña sería una violación directa de `CLAUDE.md §7`).

### 5.5 Frontend

`plataforma-form.tsx` sigue el mismo patrón que `onboarding-form.tsx` (existente): `useHidratado()`,
`disabled={!hidratado || cargando}` (CLAUDE.md §7). `plataforma/page.tsx` sigue el patrón server
component de `dashboard/page.tsx`: lee la cookie, llama al backend, `401` → `/login`.

---

## 6. Dependencias nuevas

Ninguna. `crypto.getRandomValues` es Web Crypto estándar (ya usado indirectamente vía
`gen_random_uuid()` en SQL; en el Worker es una API global del runtime, no un paquete npm).

---

## 7. Límites de Cloudflare Workers

Sin impacto. El alta de un acueducto es una operación manual, de muy baja frecuencia (Mateo dando de
alta clientes, no un flujo de usuario final): 1 `signUp` + 2 RPC por alta. Nada de esto pasa por
Queues ni por un cron.

---

## 8. Estrategia de pruebas

**Unitarias (`backend/tests/unit/plataforma.test.ts`)**, con Supabase falso: que
`crearAcueductoBase`/`asignarAdminAcueducto` propagan el error de la RPC tal cual; que
`generarContrasenaTemporal` produce longitud y alfabeto correctos y no se repite en 1000 llamadas.

**Aislamiento (`tests/aislamiento/903_...`)**, contra PostgreSQL real:

| Paso | Comprueba | CA |
|---|---|---|
| 1 | `perfiles` sigue sin política de `insert` para nadie que no sea `es_admin_plataforma()` | CA-2 |
| 2 | Un `admin_acueducto` (no plataforma) no puede ejecutar `crear_acueducto_base` ni `asignar_admin_acueducto` con efecto (RLS lo bloquea aunque tenga `EXECUTE`) | CA-2 |
| 3 | Un superadmin real crea `clientes`+`configuracion` con `crear_acueducto_base`; slug duplicado falla limpio, sin residuo | CA-1, CA-5 |
| 4 | `asignar_admin_acueducto` crea `perfiles`+`membresias` correctos para un `usuario_id` de prueba | CA-1 |
| 5 | El admin nuevo, con su propia sesión, ve solo su acueducto — no los de otros (aislamiento estándar, igual que las suites 001-012) | CA-4 |
| 6 | Con solo la membresía `administrador`, `resolverClienteActivo` devuelve `lista=[]`, `activo=null`, `esAdminPlataforma=true` | CA-3 |

Regresión completa 001-012 + 900 + 901 + 902 sobre base reconstruida (método canónico Sesión 026).

**Integración**, `curl` real contra `wrangler dev` + Supabase local: alta completa de un acueducto de
principio a fin, con el `curl` de login del admin nuevo usando la contraseña temporal devuelta.

**Manual (requiere Mateo, navegador real):** CA-4 completo en el navegador (no solo `curl`) — login
del admin nuevo y confirmación visual de que ve su propio dashboard con el nombre correcto del
acueducto.

---

## 9. Lo que este plan NO hace

No construye reconciliación automática para el caso raro de §5.1 (falla entre `signUp` y
`asignar_admin_acueducto`). No construye edición, desactivación ni borrado de acueductos (spec §4).
No fuerza cambio de contraseña en el primer login del admin nuevo (spec §4, mejora futura). No toca
`crear_tenant_con_admin` (001) ni el flujo de autoservicio existente. No añade invitación por correo
(Opción A de la spec, descartada en §0.3).
