# SPEC — 018: panel-plataforma

**Estado:** **IMPLEMENTADA (2026-09-08)** — spec, plan y tasks aprobados por Mateo; T-001 a T-006
completados con evidencia real (ver `tasks.md`). CA-4 queda con evidencia parcial: el extremo GoTrue
+ navegador real es NO VERIFICADO — requiere Mateo (§6).

**Origen:** petición directa de Mateo en sesión ("vamos a crear el superAdmin para yo crear las
credencial de lo acuaductos"), más dos hallazgos técnicos encontrados al intentar cumplirla:

1. **No existe ninguna pantalla para esto.** Se buscó en todo `frontend/` (rutas, componentes) y no
   hay ningún panel de plataforma. Lo único que existe es `crear_tenant_con_admin()`
   (`20260831150000_fundacion-tenancy.sql:280`), pensada para que **un usuario se cree su propio**
   acueducto (`auth.uid()` = el nuevo admin), no para que la plataforma cree acueductos para terceros.
   El propio comentario de esa función ya lo anticipaba: *"el multi-tenant por usuario lo gestiona el
   panel maestro de la plataforma, feature posterior"* — esa es esta feature.
2. **Bug real en `backend/src/lib/tenant.ts` (`resolverClienteActivo`).** La consulta a `membresias`
   no excluye las filas con `cliente_id NULL` (el rol `administrador`, plataforma). Un superadmin con
   solo esa membresía obtiene `lista.length === 1`, así que el código lo trata como "un acueducto
   activo" con `clienteId: null` en vez de mandarlo a un panel de plataforma. Hoy no hay panel al que
   mandarlo, así que cae en un `/app/dashboard` vacío y sin nombre — no un error, algo confuso.

**Depende de:** 001-fundacion (`clientes`, `perfiles`, `membresias`, `es_admin_plataforma()`,
`crear_tenant_con_admin()` como patrón a diferenciar, política `clientes_plataforma`). Completa.

---

## 0. Contexto y decisiones a resolver antes de `/plan`

### 0.1 Numeración — por qué 018 y no 013

Igual que 017: `.specify/config.md` ya reserva 013-016 para features del roadmap original en estado
Pendiente. Esta toma el siguiente número libre, **018**, y es también un
**prerrequisito de producción**: sin ella no hay forma de dar de alta el acueducto piloto salvo por
SQL manual. Si se aprueba, `.specify/config.md` recibe la fila con la misma nota que 017.

### 0.2 El superadmin ya existe en producción

Ya se creó (con la cuenta `admin-prueba@undreocol.app`, verificado por consulta directa a la base
real): fila en `perfiles` + fila en `membresias` con `rol = 'administrador'`, `cliente_id = NULL`.
Esta spec no vuelve a tocar eso — construye el panel para que esa cuenta sirva de algo.

### 0.3 DECISIÓN PENDIENTE — cómo nace la cuenta del admin del acueducto nuevo

El superadmin va a crear acueductos que no son suyos: el `admin_acueducto` resultante es **otra
persona**, con su propio correo. Dos formas de resolverlo:

| | **Opción A — invitación por correo** | **Opción B — alta directa con contraseña temporal** |
|---|---|---|
| Flujo | El superadmin captura nombre del acueducto + correo del admin. Se crea `clientes` + un registro de invitación pendiente (sin `perfiles`/`membresias` todavía) y se envía un correo con enlace de activación. El invitado fija su propia contraseña al aceptar; ahí se crean `perfiles`+`membresias`. | El superadmin captura nombre del acueducto + correo + una contraseña temporal generada. Se crean `auth.users` (vía `admin.createUser` con `service_role`), `perfiles`, `membresias` y `configuracion` en el mismo paso. El admin nuevo debe cambiar la contraseña en su primer login. |
| Piezas nuevas | Tabla de invitaciones + pantalla de aceptación pública + plantilla de correo | Ninguna tabla nueva; reutiliza Cloudflare Email Service solo para avisar (D-9), no como paso obligatorio del flujo |
| Qué pasa si el correo falla | El acueducto queda a medias (sin admin activo) hasta que el superadmin reenvíe la invitación | El acueducto queda operativo igual (regla CLAUDE.md §10.20: un fallo de envío nunca bloquea lo demás); el correo es solo conveniencia |
| Superficie de ataque | Menor: nadie más que el propio invitado fija su contraseña | El superadmin ve/genera la contraseña temporal una vez; tiene que viajar por un canal seguro hasta el admin nuevo |
| Verificable en este entorno (`CLAUDE.md §4`) | Necesita probar el envío y la aceptación con navegador — parcialmente `NO VERIFICADO` aquí | Se prueba entero con `curl`/SQL, igual que 017 |
| Coherencia con lo ya construido | Pieza nueva sin precedente en el repo | Sigue el mismo patrón que ya se usó a mano esta sesión para bootstrapear el superadmin |

**APROBADO: Opción B — alta directa con contraseña temporal** (Mateo, 2026-09-08), por ser verificable
end-to-end en este entorno y no introducir una tabla ni un flujo público nuevos para un caso de uso
que, al inicio, tiene un solo operador (Mateo) dando de alta un puñado de acueductos. Opción A queda
anotada en §4 como mejora natural para cuando haya varias personas en el equipo de UndreoCol creando
acueductos, o se quiera sacar a Mateo del camino crítico de cada alta.

### 0.4 DECISIÓN RESUELTA — dónde vive el panel y quién entra: **`/plataforma`** (aprobado 2026-09-08)

**APROBADO (Mateo, 2026-09-08): ruta `/plataforma`**, protegida en el Worker por
`es_admin_plataforma()` — igual que las políticas RLS ya existentes, no una comprobación nueva. Un
usuario con membresía(s) de acueducto pero sin el rol `administrador` recibe 403 si intenta entrar.

**Pendiente de resolver en `/plan`, no bloquea la aprobación de esta spec:** el caso de un superadmin
que ADEMÁS fuera admin de un acueducto específico (doble membresía) — con un solo superadmin hoy
(Mateo, sin membresía de acueducto) esto no ocurre en la práctica; `/plan` deja documentado qué pasa
si llegara a darse, sin necesidad de construirlo ahora.

---

## 1. Objetivo

Que Mateo pueda dar de alta un acueducto nuevo — y las credenciales de su primer administrador — sin
tocar SQL a mano, desde una pantalla protegida por su rol de superadmin.

## 2. Por qué ahora

Es el siguiente paso obligatorio para migrar el primer acueducto piloto a producción: hoy la única
vía es una consulta SQL manual (lo que se hizo esta sesión como excepción puntual, con autorización
explícita, para bootstrapear el superadmin). Eso no escala ni queda auditado como una acción de
producto.

## 3. Alcance

### 3.1 Corrección de `resolverClienteActivo` (bug de §0.-, hallazgo de esta sesión)

Excluir de la resolución de "acueducto activo" las membresías con `cliente_id IS NULL` (rol
`administrador`). Un superadmin puro nunca debe caer en `/app/dashboard`.

### 3.2 Función `crear_acueducto_con_admin()` (nombre a definir en `/plan`)

`SECURITY DEFINER`, otorgada solo a `authenticated`, con guarda `es_admin_plataforma()` explícita en
el cuerpo (lección de C-1: nunca confiar en el otorgamiento de privilegios solo). Recibe nombre del
acueducto, slug, correo del admin nuevo y (si se aprueba la Opción B de §0.3) la contraseña temporal
ya hasheada por GoTrue — o el `usuarioId` si el `auth.users` se crea antes desde el Worker con
`service_role` (a definir en `/plan`, es una decisión de implementación). Crea `clientes` + `perfiles`
+ `membresias(admin_acueducto)` + `configuracion` en una sola transacción, igual que
`crear_tenant_con_admin()`, del que se diferencia únicamente en quién autoriza la operación (el
superadmin, no el propio nuevo admin).

### 3.3 Pantalla `/plataforma`

Lista de acueductos existentes (nombre, slug, fecha de alta) + formulario de alta. Protegida en el
Worker, no solo en la interfaz (`CLAUDE.md §10.23` aplica por analogía: la comprobación de rol vive
del lado del servidor).

### 3.4 Entrega de la credencial inicial al admin nuevo

Si se aprueba Opción B (§0.3): la pantalla muestra la contraseña temporal generada **una sola vez**,
para que Mateo la transmita por su cuenta. No se guarda en ningún lado en texto plano más allá de ese
momento (GoTrue la hashea al crearla).

## 4. Fuera de alcance

- **Invitación por correo con aceptación pública** (Opción A de §0.3) — mejora futura, spec propia.
- **Gestión de acueductos existentes** (editar, desactivar, transferir dueño, borrar). Solo alta.
- **Métricas globales de plataforma** (cuántos acueductos, uso agregado). Es 011-dashboard u otra
  feature, no esta.
- **Múltiples superadmins con distintos niveles de permiso.** Hoy es un rol binario
  (`administrador`/no), tal como ya está en el esquema desde 001.
- **Forzar cambio de contraseña en el primer login del admin nuevo.** Deseable, pero es una feature de
  autenticación aparte (aplicaría igual a cualquier alta manual); se anota como mejora futura.

## 5. Reglas que aplican

- `CLAUDE.md §4` — evidencia real por CA, nada de "debería funcionar".
- `CLAUDE.md §5.4` — multi-tenant y RLS `FORCE`; `clientes` y `configuracion` ya las tienen desde 001,
  esta feature no crea tablas nuevas salvo que `/plan` decida lo contrario.
- **Lección de C-1** — la función `SECURITY DEFINER` nueva se audita contra el patrón del
  "identificador desnudo" antes de darla por terminada; la guarda `es_admin_plataforma()` va en el
  cuerpo de la función, no solo en el `grant`.
- `CLAUDE.md §7` — todo `<form onSubmit>` nuevo usa `useHidratado()` (`disabled={!hidratado ||
  cargando}`).
- `CLAUDE.md §9` — un commit por tarea verificada; la IA no hace `push`.

## 6. Criterios de aceptación

**Nota de cierre:** CA-1 se reformuló al aprobar el plan (§5.1): no hay una transacción atómica
única de punta a punta (no la hay entre Postgres y GoTrue sin `service_role`, prohibido en esta ruta
por `CLAUDE.md §12`). Lo que sí se garantiza y se verificó: cada uno de los 3 pasos es atómico en sí
mismo, y un fallo en el primero no deja residuo.

### CA-1 — Alta sin residuo ante el fallo más probable (slug duplicado) — CERRADO
`crear_acueducto_base` crea `clientes`+`configuracion` en una transacción; un slug duplicado falla
limpio, sin tocar Auth ni dejar fila alguna. `asignar_admin_acueducto` crea `perfiles`+`membresias`
en otra transacción, para un usuario que ya existe en `auth.users`. **Evidencia:**
`tests/aislamiento/903` PASO 3 (slug duplicado, conteo de `clientes` antes/después idéntico) y PASO 4
(las 2 filas se crean correctas) — commit `53251bd`/`a3c5d9c`. Extremo a extremo con `curl` real
contra un Worker desplegado: **NO VERIFICADO — requiere Mateo** (tasks.md T-005).

### CA-2 — Solo el superadmin entra — CERRADO
Un usuario autenticado sin `rol = 'administrador'` que pida `/plataforma` o
`POST /plataforma/acueductos` recibe 403. **Evidencia:** `tests/aislamiento/903` PASO 1/PASO 2 (RLS,
contra PostgreSQL real) y `backend/tests/unit/plataforma-rutas.test.ts` (12 tests, `app.fetch` real
con las dependencias sustituidas, incluida la prueba de que el test SIRVE: se quita la comprobación
de rol y caen los 2 casos de 403) — commits `a3c5d9c`/`e9a0314`. `curl` con dos sesiones reales
contra Supabase real: **NO VERIFICADO — requiere Mateo**.

### CA-3 — El bug de esta sesión queda cerrado — CERRADO
Con solo la membresía `administrador`, `resolverClienteActivo` ya no la cuenta como "acueducto
activo" (`lista=[]`, `activo=null`, `esAdminPlataforma=true`), y `GET /dashboard` expone ese campo
para que el frontend redirija a `/plataforma` en vez de `/onboarding`. **Evidencia:**
`backend/tests/unit/tenant.test.ts` (6 tests, incluido el caso de doble membresía — superadmin que
ADEMÁS administra un acueducto — y la prueba de que el test SIRVE: se revierte el filtro y caen
exactamente 2 casos) y `tests/aislamiento/903` PASO 6 (forma de datos real en PostgreSQL) — commits
`06bb455`/`a3c5d9c`. Login real en el navegador viendo la redirección: **NO VERIFICADO — requiere
Mateo**.

### CA-4 — El admin nuevo puede entrar con lo que se le entregó
Con la credencial temporal generada en el alta, el admin nuevo del acueducto inicia sesión y llega a
su `/app/dashboard` con los datos correctos de su acueducto (no el de otro). **Evidencia parcial:**
`tests/aislamiento/903` PASO 5 (el admin nuevo, con su propia sesión de PostgreSQL, ve exactamente su
acueducto y ningún otro) — commit `a3c5d9c`. El extremo GoTrue real (login HTTP con la contraseña
temporal) queda **NO VERIFICADO — requiere Mateo** (tasks.md T-005/T-006): no hay credenciales de
Supabase real ni navegador en este entorno para cerrarlo del todo.

### CA-5 — Slug único se respeta — CERRADO
Dos altas con el mismo slug: la segunda falla con el mensaje `'El slug ya está en uso'`, la primera
no se ve afectada. **Evidencia:** `tests/aislamiento/903` PASO 3 y
`backend/tests/unit/plataforma.test.ts`/`plataforma-rutas.test.ts` (mensaje propagado tal cual hasta
el `400` de la ruta) — commits `53251bd`/`a3c5d9c`/`db7d24a`/`e9a0314`.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| La función nueva repite el patrón de C-1 (identificador desnudo, sin revalidar quién llama) | Guarda `es_admin_plataforma()` explícita en el cuerpo, no solo en el `grant`. CA-2. |
| Contraseña temporal viaja por un canal inseguro (WhatsApp, etc.) | Fuera del control del sistema; se documenta como responsabilidad operativa de Mateo, no se resuelve en código. |
| El bug de `resolverClienteActivo` se corrige pero rompe algo que dependía del comportamiento actual | Se revisan todos los callers de `resolverClienteActivo` antes de tocarlo (hoy son `/dashboard` y el helper de contexto compartido, `index.ts:318-333`); regresión completa de tests. |

## 8. Definición de terminado

- [x] Decisión §0.3 (invitación vs. alta directa) aprobada explícitamente por Mateo
- [x] Decisión §0.4 (ruta y navegación) aprobada explícitamente por Mateo
- [x] CA-1, CA-2, CA-3, CA-5 con evidencia real ejecutada y pegada. CA-4 con evidencia parcial (el
      aislamiento en PostgreSQL real sí; el extremo GoTrue+navegador real, NO VERIFICADO — Mateo)
- [x] Migración versionada en `supabase/migrations/` (`20260919090000_panel-plataforma.sql`)
- [x] Test de aislamiento nuevo (serie 900+) — `tests/aislamiento/903`
- [x] `npm run build` (tsc) y `npm run lint` limpios en backend; `npx wrangler deploy --dry-run` OK.
      Frontend: **NO VERIFICADO — requiere Mateo** (bloqueo de `cdn.sheetjs.com`, mismo que 017 T-006)
- [x] `.specify/config.md` con la fila 018 y la nota de prerrequisito de producción (y fila 019
      reservada para la invitación por correo descartada en §0.3)
- [x] `docs/ESPECIFICACION-FUNCIONAL.md` actualizada
- [x] `CHANGELOG.md` actualizado (Sesión 031)
- [x] Un commit por tarea verificada; sin `git push` (el comando se le entrega a Mateo)
