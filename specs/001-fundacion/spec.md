# SPEC — 001: Fundación

**Estado:** Borrador para aprobación de Mateo
**Depende de:** ninguna
**Prerrequisito de lectura:** `CLAUDE.md`, `ARQUITECTURA.md`, `docs/DECISIONES.md`,
`docs/esquema-propuesto.sql`, `docs/INFRAESTRUCTURA.md`

---

## 1. Objetivo

Levantar la base sobre la que se construye todo el sistema: proyecto Next.js en
Cloudflare Pages, API en Hono.js sobre Cloudflare Workers, base de datos con
multi-tenancy real y verificado en Supabase, autenticación de usuarios
administrativos, y los tres Workers de mantenimiento (keepalive, monitoreo,
backup) que sostienen el plan Free de Supabase (D-7).

Al terminar esta feature **no hay funcionalidad de acueducto**. Hay una
cimentación probada, incluyendo los controles operativos que reemplazan a un
servidor administrado.

## 2. Por qué va primero

Todo lo demás depende de que el aislamiento entre acueductos sea correcto, y de
que la infraestructura sin servidor propio (D-6) esté sostenida desde el día 1
— no es una mejora que se agregue después, porque sin ella el plan Free de
Supabase se pausa en la primera semana sin actividad continua.

La separación de roles es una regla de negocio, no una decoración: el admin de
un acueducto **nunca** debe poder escalar a dueño de la plataforma. Eso se
establece aquí y se hereda en todas las features siguientes.

---

## 3. Decisiones ya tomadas que esta feature debe respetar

Todas documentadas con su contexto completo en `docs/DECISIONES.md`.

### D-2 — Los suscriptores NO se registran en `auth.users`
No hay funcionalidad de suscriptor en esta feature, pero la interfaz de
autenticación (`backend/src/lib/auth.ts` y `sesion-suscriptor.ts`) debe
diseñarse desde el inicio contemplando **dos tipos de sesión**: administrativa
(Supabase Auth) y de suscriptor (JWT propio). Esta feature implementa solo la
primera.

### D-6 — Arquitectura sin VPS
El backend es Hono.js desplegado en Cloudflare Workers, nunca un servidor
Node.js tradicional. El frontend es Next.js desplegado en Cloudflare Pages.

### D-7 — Supabase Free explotado al máximo
Esta feature implementa los tres Workers de mantenimiento (keepalive, monitoreo
de tamaño, y la base para limpieza) como parte de la fundación, no como
mejora posterior.

---

## 4. Alcance

### 4.1 Proyecto backend (Hono.js + Cloudflare Workers)
- Proyecto Hono.js inicializado en `backend/`, TypeScript estricto
- `wrangler.toml` configurado con el binding de variables de entorno
- Estructura de carpetas según `CLAUDE.md §5.1`
- Middleware de CORS configurado para aceptar únicamente el dominio del
  frontend
- Ruta de salud (`GET /salud`) que verifica conectividad con Supabase

### 4.2 Proyecto frontend (Next.js + Cloudflare Pages)
- Next.js 15 con App Router y TypeScript en modo estricto
- Tailwind CSS + shadcn/ui inicializado, solo los componentes que se usen
- Todas las llamadas a datos pasan por la API de Hono — **ningún componente
  importa `@supabase/*` directamente** (`CLAUDE.md §5.2`)
- `.env.example` documentado; `.env` en `.gitignore`

### 4.3 Base de datos
Proyecto Supabase creado (Free), CLI configurado, migraciones versionadas en
`supabase/migrations/`.

**Tablas de esta feature, y solo estas:**

| Tabla | Para qué |
|---|---|
| `planes` | Catálogo de planes de suscripción |
| `clientes` | Cada acueducto. `clientes.id` es el tenant_id |
| `perfiles` | Usuario administrativo de la aplicación |
| `membresias` | Vínculo perfil ↔ cliente ↔ rol |
| `configuracion` | Umbrales configurables por acueducto |
| `_keepalive` | Tabla de soporte para el Worker de keepalive (D-7) |

Más el enum `rol_usuario` (sin `suscriptor`, ver D-2), `estado_cuenta`, las
funciones de seguridad (`es_admin_plataforma()`, `mis_clientes()`,
`tiene_rol()`, `es_admin_de()`), y la función `tamano_base_mb()` para el
monitoreo.

RLS habilitada **con `FORCE`** en las tablas de negocio (`_keepalive` es una
tabla técnica sin `cliente_id`, accesible solo con `service_role_key`).

Se añade una tabla de prueba temporal, `usuarios_servicio`, con sus campos
mínimos, **exclusivamente** para poder verificar el aislamiento con datos
reales. Su definición completa y su CRUD son de la feature 003.

### 4.4 Autenticación administrativa
- Registro y login con email + contraseña vía Supabase Auth, consumido a
  través de rutas de la API de Hono (nunca directo desde el frontend)
- Recuperación de contraseña
- Cierre de sesión
- **Toda** la interacción de auth pasa por `backend/src/lib/auth.ts`

### 4.5 Onboarding
- Al registrarse, el usuario crea su acueducto: nombre + slug
- Se crea `cliente`, `perfil`, `membresia` con rol `admin_acueducto`, y la fila
  de `configuracion` con los valores por defecto, **en una sola transacción**
  (función `crear_tenant_con_admin()` en PostgreSQL)
- El slug se valida: único, minúsculas, sin espacios ni caracteres especiales

### 4.6 Sesión y acueducto activo
- `backend/src/lib/tenant.ts` resuelve el acueducto activo del usuario
- Un solo acueducto → se selecciona automáticamente
- Varios acueductos → se pide elegir (caso previsto: soporte de UndreoCol)

### 4.7 Rutas protegidas
- Middleware de Next.js que protege todo bajo `/app/*`
- Sin sesión → `/login`
- Con sesión pero sin acueducto → `/onboarding`
- `/app/dashboard`: página mínima con el nombre del acueducto, el nombre y rol
  del usuario, y el conteo de `usuarios_servicio` del acueducto

### 4.8 Workers de mantenimiento (D-7)
Implementados y desplegados, con evidencia de ejecución real:

- **`backend/src/cron/keepalive.ts`** — según `INFRAESTRUCTURA.md §5`
- **`backend/src/cron/monitor-db.ts`** — según `INFRAESTRUCTURA.md §8`, con la
  función SQL `tamano_base_mb()`. El envío de alerta puede quedar como
  función stub en esta feature (el Cloudflare Email Service se integra en
  una feature posterior) — pero el cálculo del umbral y el log del resultado
  deben funcionar y estar verificados.

### 4.9 Backup automático (D-7)
- `.github/workflows/backup-diario.yml` según `INFRAESTRUCTURA.md §6`
- Ejecutado manualmente al menos una vez (`workflow_dispatch`) con evidencia
  del archivo resultante subido a R2

---

## 5. Fuera de alcance

Explícitamente **no** se construye aquí:

- Servicios, tarifas, contadores, lecturas, periodos, facturas, pagos
- Órdenes de corte y reconexión
- Impresión ni envío de factura por correo
- Portal de autoservicio del suscriptor y su sesión propia (D-2 se diseña la
  interfaz, no se implementa el flujo completo — eso es la feature 008)
- App móvil de lecturas (PWA)
- Cloudflare Queues y el cierre de facturación
- RRHH, dashboard de indicadores, exportes contables
- Invitación de lectores y administradores adicionales al acueducto (feature 003)
- Panel maestro de gestión de clientes para el dueño de la plataforma
- Worker de limpieza semanal completo (la estructura de carpeta se crea, la
  lógica de purga es de una feature posterior, cuando existan las tablas a
  limpiar)
- Diseño visual elaborado — limpio y funcional es suficiente

---

## 6. Reglas de negocio que aplican

De `CLAUDE.md §10`:

- **Caso 23** — El admin del acueducto **nunca** puede otorgar el rol
  `administrador`. Se bloquea en RLS. Criterio de aceptación bloqueante (CA-2).

De `docs/DECISIONES.md`:

- **D-6, D-7** — la arquitectura completa de esta feature existe para sostener
  estas dos decisiones desde el primer día.

---

## 7. Criterios de aceptación

Cada uno se cierra con **evidencia ejecutada y pegada**. Sin evidencia, la
feature no está terminada.

### CA-1 — Aislamiento entre acueductos (bloqueante)
Prueba automatizada, ejecutada con **SQL directo contra Supabase**, no a través
de la API de Hono.

1. Crea el acueducto A con el usuario `admin_a@test.com`
2. Crea el acueducto B con el usuario `admin_b@test.com`
3. Inserta 3 `usuarios_servicio` en A y 2 en B
4. Autenticado como A: `select * from usuarios_servicio` devuelve **exactamente 3**
5. Autenticado como B: devuelve **exactamente 2**
6. Como A, leer un registro de B **por su id exacto**: 0 filas
7. Como A, `insert` con `cliente_id` de B: **falla**
8. Como A, `update` de un registro de B: **0 filas afectadas**
9. Como A, `delete` de un registro de B: **0 filas afectadas**
10. Como A, leer el `cliente` B por su id: 0 filas
11. Como A, leer las `membresias` de B: 0 filas

**La feature no se aprueba si cualquiera de los 11 pasos falla.**

### CA-2 — Imposibilidad de escalar privilegios (bloqueante)
Prueba automatizada con SQL directo:

1. Como `admin_acueducto` de A, insertar en `membresias` una fila con
   `rol = 'administrador'` para sí mismo: **falla**
2. Como `admin_acueducto` de A, insertar `rol = 'administrador'` para otro
   perfil: **falla**
3. Como `admin_acueducto` de A, hacer `update` de su propia membresía cambiando
   el rol a `administrador`: **falla o 0 filas**
4. Como `admin_acueducto` de A, insertar una membresía con `cliente_id` de B:
   **falla**
5. Como `admin_acueducto` de A, hacer `update` de `clientes.plan_id` o
   `clientes.estado_cuenta` de su propio acueducto: **no surte efecto**

### CA-3 — Migraciones reproducibles
Desde una base vacía, `supabase db reset` levanta el esquema completo sin
intervención manual. Evidencia: salida del comando.

### CA-4 — Aislamiento de dependencias en el frontend
```bash
grep -rn "@supabase" frontend/app/ frontend/components/
```
Devuelve **cero resultados**. Evidencia: salida del comando.

### CA-5 — Ausencia de `service_role_key` en el frontend
```bash
grep -rn "SERVICE_ROLE" frontend/
```
Devuelve **cero resultados**. Evidencia: salida del comando.

### CA-6 — Build y despliegue en seco
`npm run build` (frontend) sin errores ni warnings de TypeScript. En `backend/`,
`npx wrangler deploy --dry-run` exitoso. Evidencia: salida de ambos comandos.

### CA-7 — Onboarding transaccional
Si la creación falla a mitad (por ejemplo, slug duplicado), no queda ningún
registro huérfano en `clientes`, `membresias` ni `configuracion`. Evidencia:
prueba ejecutada + conteo de filas antes y después.

### CA-8 — Worker de keepalive funcional
Ejecución manual del Worker (`wrangler dev` + trigger simulado, o
`workflow_dispatch` equivalente) que actualiza `_keepalive.ultimo_ping`.
Evidencia: consulta a la tabla mostrando el timestamp actualizado.

### CA-9 — Worker de monitoreo de base de datos funcional
Ejecución manual que llama a `tamano_base_mb()` y calcula correctamente el
porcentaje frente al límite de 500 MB. Evidencia: salida del cálculo con la
base de datos actual (debe estar muy por debajo del umbral en esta etapa).

### CA-10 — Backup ejecutado al menos una vez
Ejecución manual (`workflow_dispatch`) del workflow de backup. Evidencia:
listado del bucket de R2 mostrando el archivo subido, con su tamaño.

### CA-11 — Flujo manual completo
Verificado por Mateo en navegador, documentado paso a paso:
registro → onboarding → dashboard → logout → login → dashboard.

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Recursión infinita en políticas RLS al consultar `membresias` desde una política | Funciones `SECURITY DEFINER`, ya previstas en el esquema |
| RLS que "parece" funcionar porque la API filtra por `cliente_id` en el código | CA-1 y CA-2 prueban con SQL directo, nunca a través de Hono |
| Fuga de `service_role_key` al frontend | CA-5 lo verifica explícitamente por comando |
| El Worker de keepalive falla silenciosamente y el proyecto se pausa igual | El Worker lanza excepción si el ping falla (`INFRAESTRUCTURA.md §5`), visible en los logs de Cloudflare |
| Conexión de GitHub Actions a Supabase falla por usar el puerto directo en vez del pooler | `INFRAESTRUCTURA.md §6` especifica explícitamente el uso del Session Pooler |

---

## 9. Definición de terminado

- [ ] Los 11 criterios de aceptación con evidencia pegada
- [ ] Migraciones versionadas y commiteadas
- [ ] `.env.example` documentado en `frontend/` y `backend/`, `.env` en
      `.gitignore`
- [ ] `CHANGELOG.md` actualizado
- [ ] Un commit por tarea verificada; comando de push entregado a Mateo
- [ ] **Aprobación explícita de Mateo antes de pasar a `/plan`**

---

## 10. Prompt para Claude Code

```
Lee CLAUDE.md, ARQUITECTURA.md, docs/DECISIONES.md, docs/INFRAESTRUCTURA.md,
.specify/config.md y specs/001-fundacion/spec.md.

El spec está aprobado. Produce specs/001-fundacion/plan.md siguiendo la
plantilla en specs/plantillas/plan.md.

Presta atención especial a:
- La arquitectura es Next.js (Cloudflare Pages) + Hono.js (Cloudflare Workers)
  + Supabase, SIN servidor propio (D-6). No propongas un backend Node.js
  tradicional.
- D-2 elimina 'suscriptor' del enum rol_usuario. El diseño de
  backend/src/lib/auth.ts debe admitir dos tipos de sesión, aunque esta
  feature implemente solo la administrativa.
- D-7 requiere los Workers de keepalive y monitoreo funcionando desde esta
  feature, no como mejora futura.
- CA-1 y CA-2 son bloqueantes y se prueban con SQL directo, no vía la API.

No escribas código todavía. Detente al terminar plan.md y espera aprobación.
```
