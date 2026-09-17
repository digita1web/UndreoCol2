# INFRAESTRUCTURA.md — UndreoCol

**Versión:** 3.0 — Arquitectura Cloudflare + Supabase, sin VPS
**Fecha:** 2026-08-31
**Estado:** Vigente. Reemplaza toda versión anterior de este documento.

---

## 1. Principio rector

> Cero infraestructura de pago hasta el primer cliente. El primer gasto es
> mínimo. Ningún componente de pago se activa sin un disparador medible.

Ver `ARQUITECTURA.md §2` y `§6` para la tabla completa de disparadores de costo.

---

## 2. Cuentas y servicios a crear

| Servicio | Para qué | Plan de inicio |
|---|---|---|
| Cloudflare | DNS, Pages, Workers, R2, Queues, Cron, Email Service | Free |
| Supabase | PostgreSQL, Auth, RLS | Free |
| GitHub | Repositorio, GitHub Actions (backup) | Free |
| Sentry | Observabilidad de errores | Free |
| UptimeRobot | Verificación de disponibilidad | Free |

Ninguno requiere tarjeta de crédito para el nivel gratuito, excepto Cloudflare al
activar Workers Paid (solo en el momento del primer cliente).

---

## 3. Entornos

### 3.1 Desarrollo local — costo $0

```bash
supabase start
cd backend && npx wrangler dev
cd frontend && npm run dev
```

Todo el desarrollo ocurre sin tocar ningún servicio de pago.

### 3.2 Staging — costo $0

Un segundo proyecto de Cloudflare Pages + Workers, apuntando a un segundo proyecto
de Supabase Free.

**Regla absoluta:** ningún cierre de prueba se ejecuta contra la base de producción.

### 3.3 Producción — costo desde $0, sube a $5 con el primer cliente

Mismo stack que staging, en el proyecto principal de Cloudflare y Supabase.

### 3.4 Configuración de Supabase Auth para producción (Site URL, Redirect URLs, SMTP)

**Hallazgo real de producción, Sesión 057:** el proyecto de Supabase se crea con `Site URL =
http://localhost:3000` y la lista de `Redirect URLs` vacía por defecto. Ningún enlace de correo de
Auth (invitación de admin, restablecer contraseña — `enviarEnlaceDefinirContrasena()`,
`backend/src/lib/auth.ts`) funciona en producción hasta corregir esto — Supabase **ignora en
silencio** el `redirectTo` que manda el código si la URL no está en la lista permitida, y usa
siempre el Site URL (localhost) como respaldo. El código no puede arreglar esto: es configuración
del proyecto de Supabase, fuera del repositorio.

**Al crear o recrear el proyecto de producción, antes de que cualquier invitación funcione:**

1. Supabase Dashboard → **Authentication → URL Configuration**:
   - **Site URL:** la URL real del frontend en producción (hoy `https://undreocol-frontend.undreocol.workers.dev`).
   - **Redirect URLs:** agregar `https://undreocol-frontend.undreocol.workers.dev/**` (el `/**`
     cubre cualquier ruta de ese dominio, no solo `/restablecer-contrasena`).
2. Supabase Dashboard → **Authentication → Emails → SMTP Settings**: el envío de correo que trae
   Supabase por defecto limita a **2 correos por hora** (pensado para pruebas, no producción) — hay
   que conectar un proveedor SMTP real (Resend, con dominio propio verificado) antes de dar de alta
   ningún acueducto real. Ver CHANGELOG Sesión 057 para el detalle completo de la configuración
   usada (subdominio dedicado para aislar reputación, DMARC en `p=none` al empezar).
3. Las plantillas de correo (**Authentication → Email Templates**) vienen en inglés por defecto —
   se editan a mano ahí, no hay selector de idioma.

**Nota aparte, sin resolver todavía:** `ALLOWED_ORIGIN` en `backend/wrangler.toml` tiene un bloque
`[vars]` (desarrollo, con `localhost` primero) y uno `[env.production.vars]` (solo el origen real) —
pero `.github/workflows/deploy-backend.yml`/`deploy-frontend.yml` corren `wrangler deploy` **sin**
`--env production`, así que siempre se despliega el bloque de desarrollo. `enviarEnlaceDefinirContrasena()`
se corrigió para tolerar esto (prefiere el primer origen que no sea localhost), pero el pipeline de
CI sigue sin usar el entorno de producción — cualquier otro código nuevo que asuma
`ALLOWED_ORIGIN.split(',')[0]` va a pisar el mismo bug. Corregir el pipeline de CI queda pendiente,
fuera de alcance de este hallazgo puntual (cambiar el entorno de despliegue completo afecta otros
bindings sin auditar).

---

## 4. Estructura del repositorio

```
undreocol/
├── frontend/
├── backend/
│   ├── src/
│   │   ├── index.ts
│   │   ├── cron/
│   │   │   ├── keepalive.ts
│   │   │   ├── monitor-db.ts
│   │   │   └── limpieza.ts
│   │   └── core/
│   └── wrangler.toml
├── supabase/
│   └── migrations/
└── .github/
    └── workflows/
        └── backup-diario.yml
```

Estructura completa y detallada (todas las carpetas y archivos reales) en
`CLAUDE.md §5.1`.

---

## 5. Mantener Supabase Free vivo — Worker de keepalive

**Problema que resuelve:** los proyectos gratuitos de Supabase se pausan tras 7 días
sin actividad de base de datos.

**Solución:** un Cloudflare Worker (`undreocol-keepalive`) con Cron Trigger diario
que ejecuta un `UPDATE` real sobre una tabla de soporte en Supabase. No es un
truco — es tráfico legítimo de escritura, el tipo de actividad que el mecanismo
de pausa de Supabase está diseñado para detectar.

### Tabla de soporte (`supabase/migrations/20260831150000_fundacion-tenancy.sql`)

```sql
create table if not exists _keepalive (
  id           smallint primary key default 1,
  ultimo_ping  timestamptz not null default now(),
  constraint chk_singleton check (id = 1)
);

insert into _keepalive (id, ultimo_ping) values (1, now())
  on conflict (id) do nothing;

alter table _keepalive enable row level security;
alter table _keepalive force row level security;
-- Sin políticas: ni anon ni authenticated pueden tocarla.
-- Solo service_role (bypasa RLS por diseño) — el Worker de keepalive.
```

### Worker (`backend/src/cron/keepalive.ts`, `backend/wrangler.keepalive.toml`)

Cron diario `0 5 * * *` (05:00 UTC). Usa el cliente de servicio
(`crearClienteServicio(env)`, `backend/src/lib/db.ts`) — **nunca** una llamada
REST manual — con `SUPABASE_SERVICE_ROLE_KEY` como secreto del Worker (nunca en
código ni en `.env` versionado; en local vive en `backend/.dev.vars`, gitignored).

Actualiza `_keepalive.ultimo_ping = now()` filtrando por `id = 1`. Si el `update`
falla (`error` de Supabase) **o afecta 0 filas** (la fila singleton no existe),
el Worker **lanza una excepción** — la falla queda visible en los logs de
Cloudflare en vez de fallar en silencio (mitiga el riesgo de que el proyecto se
pause sin que nadie se entere).

**Verificación local (evidencia real, T-007):**
```
npx wrangler dev --test-scheduled -c wrangler.keepalive.toml --port 8788
curl 'http://localhost:8788/__scheduled?cron=0+5+*+*+*' → "Ran scheduled event" HTTP=200
_keepalive.ultimo_ping ANTES: 2026-09-01 03:34:25+00
_keepalive.ultimo_ping DESPUÉS: 2026-09-01 04:37:36+00
Log: "keepalive: ping registrado a las 2026-09-01T04:37:36.651+00:00"
```

**Despliegue real** (`wrangler deploy -c wrangler.keepalive.toml` + el secreto
`SUPABASE_SERVICE_ROLE_KEY` vía `wrangler secret put`) requiere las credenciales
de Cloudflare de Mateo — **NO VERIFICADO** hasta entonces (`tasks.md` T-007).

**Verificación de que funciona en producción:** revisar en el panel de Supabase
que `ultimo_ping` se actualiza cada día, y que el proyecto nunca muestra el
estado "Paused".

---

## 6. Backup diario — GitHub Actions + Cloudflare R2

**Problema que resuelve:** Supabase Free no incluye backups automáticos.

**Estado real (corregido 2026-09-04 — esta sección estaba desactualizada,
escrita el 2026-08-31, un día antes de que T-013 se completara):**
`.github/workflows/backup-diario.yml` **existe y está implementado**
(commit `87afd9e`, `specs/001-fundacion/tasks.md` T-013, estado "Completado
2026-09-01"). Lo que sigue **no** es una intención pendiente — es el
workflow real, con sintaxis YAML verificada. Lo único que sigue
**NO VERIFICADO** es su **ejecución real en producción**: este entorno
nunca tuvo los secretos de GitHub (`SUPABASE_DB_URL`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) ni el bucket R2 real, así
que nadie ha confirmado todavía que un `workflow_dispatch` real sube un
backup a R2 con éxito — ver los pasos exactos en `tasks.md` T-013.

### Diseño aprobado (D-7)

- **Programación:** `schedule` diario + `workflow_dispatch` (para poder disparar
  el backup manualmente y verificar CA-10).
- **Conexión a Supabase:** secreto `SUPABASE_DB_URL` con la cadena del
  **Session Pooler**, puerto **6543** (modo transaction) — **nunca** el puerto
  directo `5432`. GitHub Actions no soporta IPv6 y la conexión directa de
  Supabase lo requiere; el Session Pooler es IPv4-compatible.
- **Dump:** en un contenedor `postgres:16-alpine`, `pg_dump --format=custom
  --no-owner`, comprimido con `gzip`. Nombre:
  `undreocol-backup-<fecha-UTC>-<sha>.sql.gz`.
- **Subida a R2:** `wrangler r2 object put undreocol-backups/<archivo>
  --file=<archivo>`, usando `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN` —
  sin dependencia de herramientas de terceros ni de credenciales estilo AWS.
- **Retención de 30 días:** regla ***lifecycle*** del bucket `undreocol-backups`
  en R2 (configuración del proveedor), **no** un paso de borrado manual dentro
  del workflow — se descartó deliberadamente esa alternativa por ser un paso
  frágil en CI.

### Secretos de GitHub necesarios (nunca en el repo)

| Secreto | De dónde sale |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Settings → Database → Connection string, **Session Pooler, puerto 6543** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → panel de la cuenta |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → API Tokens, con permiso de escritura sobre el bucket `undreocol-backups` |

**Evidencia de CA-10:** `wrangler r2 object list undreocol-backups` mostrando el
archivo subido y su tamaño, tras ejecutar `workflow_dispatch` — pendiente hasta
que Mateo configure los secretos y el bucket con su regla *lifecycle* (`tasks.md`
T-013).

---

## 7. Restauración de backup — protocolo obligatorio

**Regla:** un backup sin restaurar no es un backup.

### 7.1 Restauración de emergencia

Descargar el backup más reciente de R2 (`wrangler r2 object get`, según D-7 —
comando exacto se fija al implementar T-013), luego restaurar en un proyecto de
Supabase (staging o uno nuevo) con:

```bash
pg_restore --no-owner --clean --if-exists -d "$DATABASE_URL" backup-<fecha>.dump
```

(flags consistentes con el dump acordado en `plan.md D-7`: `pg_dump --format=custom
--no-owner`).

### 7.2 Verificación tras restaurar

1. Contar filas de las tablas principales y comparar contra lo esperado.
2. Confirmar que las políticas RLS y `FORCE ROW LEVEL SECURITY` siguen activas en
   las 6 tablas de la fundación (`tests/aislamiento/001_fundacion_aislamiento.sql`
   sirve como script de verificación).
3. Levantar la aplicación de staging contra la base restaurada y hacer login.

### 7.3 Ritual mensual

El primer lunes de cada mes: tomar el backup más reciente, restaurarlo en
staging, ejecutar la verificación de §7.2, registrar el resultado en
`CHANGELOG.md`. Si la restauración falla, es prioridad inmediata.

**Estado:** protocolo documentado, ejecutable en cuanto Mateo complete la
configuración de secretos/bucket de §6 (el workflow de backup ya existe
desde el 2026-09-01 — lo pendiente es la verificación en producción, no el
código).

---

## 8. Monitoreo del tamaño de la base de datos

**Problema que resuelve:** saber con anticipación cuándo la base se acerca al
límite de 500 MB del plan Free de Supabase.

**Umbrales** (`backend/src/cron/nivel-monitoreo.ts`): `< 300 MB` → `ok`; `≥ 300 MB`
→ `atencion`; `≥ 400 MB` → `alerta`; `≥ 480 MB` → `critico`. Porcentaje calculado
siempre sobre 500 MB.

### Función SQL (`supabase/migrations/20260831150000_fundacion-tenancy.sql`, §11)

```sql
create or replace function tamano_base_mb()
returns numeric
language sql stable security definer set search_path = public as $$
  select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2);
$$;

revoke execute on function tamano_base_mb from anon, authenticated;
grant  execute on function tamano_base_mb to service_role;
```

Solo `service_role` puede ejecutarla — ni `anon` ni `authenticated` (verificado en
`tests/aislamiento/001_fundacion_aislamiento.sql` PASO 13).

### Worker (`backend/src/cron/monitor-db.ts`, `backend/wrangler.monitor-db.toml`)

Cron diario `30 5 * * *` (05:30 UTC). Usa `crearClienteServicio(env)` y
`supabase.rpc('tamano_base_mb')`; la lógica de umbrales vive separada en
`nivel-monitoreo.ts` (función pura `calcularNivel()`, testeada con `vitest` sin
Workers ni red) porque el punto de entrada de un Worker solo puede tener
`export default`.

Si `tamano_base_mb()` falla o devuelve un valor inválido, el Worker lanza
excepción (visible en logs de Cloudflare). Con nivel `alerta` o `critico`,
dispara `alertaStub()`:

```typescript
function alertaStub(resultado: ResultadoMonitoreo): void {
  // TODO(feature 010): enviar el correo de alerta vía Cloudflare Email Service.
  console.error(`monitor-db: ALERTA ${resultado.nivel} — ${resultado.porcentaje}% del límite de 500 MB`);
}
```

**El envío real de la alerta es un stub** — el cálculo, el log y el disparo de la
función están verificados (CA-9); el correo se integra en la feature 010.

**Verificación local (evidencia real, T-008):**
```
npx vitest run → 6 tests passed (100→ok/20%, 300→atencion, 400→alerta, 480→critico, ...)
wrangler dev --test-scheduled -c wrangler.monitor-db.toml --port 8789
curl '.../__scheduled?cron=30+5+*+*+*' → "Ran scheduled event" HTTP=200
Log: "monitor-db: base de 11.31 MB (2.26% del límite de 500 MB) — nivel ok"
```

**Despliegue real** requiere las credenciales de Cloudflare de Mateo — **NO
VERIFICADO** hasta entonces.

---

## 9. Limpieza automática de tablas de sistema

**Estado real: solo la base.** `backend/src/cron/limpieza.ts` (Worker
`undreocol-limpieza`, cron semanal `0 6 * * 0`, domingos 06:00 UTC) hoy
únicamente:

1. Verifica la conexión leyendo `_keepalive.ultimo_ping`.
2. Registra `"limpieza: sin tablas que purgar (la purga llega con la feature 015)"`.

Si la verificación de conexión falla, lanza excepción.

**No existe todavía** ninguna tabla de sesiones, auditoría, trabajos o
notificaciones que purgar — esas tablas y sus reglas de retención llegan con la
**feature 015** (`docs/ESTRATEGIA-CALIDAD.md §6`). Este documento no describe
reglas de purga en funcionamiento porque no las hay; cuando la feature 015 las
implemente, esta sección se actualiza.

---

## 10. Sesión del portal del suscriptor (D-2, D-4)

**Estado real: contrato reservado, sin implementar.** `backend/src/lib/
sesion-suscriptor.ts` fija la interfaz y las constantes que usará la **feature
008**, pero las tres funciones lanzan `ErrorSesionSuscriptorPendiente` sin
excepción — hoy no hay firma de JWT, ni cookie, ni verificación real.

Lo que sí está decidido y fijado en código (no se puede cambiar sin tocar la
interfaz pública de la feature 008):

```typescript
export interface SesionSuscriptor {
  tipo: 'suscriptor';
  usuarioServicioId: string; // "sub" del JWT
  clienteId: string;         // "cid" del JWT
  expiraEn: number;          // "exp" del JWT (epoch s)
}

export const DURACION_SESION_SUSCRIPTOR_SEG = 30 * 24 * 60 * 60;   // 30 días
export const UMBRAL_RENOVACION_SUSCRIPTOR_SEG = 7 * 24 * 60 * 60;  // renovar si quedan < 7 días
```

Principios ya decididos (D-2, D-4, CLAUDE.md §10-22b a 22e), pendientes de
implementación en la feature 008:

- Es un **JWT propio firmado con `SESSION_SECRET`** en el Worker — **nunca** un
  token de Supabase Auth.
- El JWT lleva `tipo: "suscriptor"`; un middleware de Hono debe verificar este
  campo antes de servir cualquier ruta del portal.
- Cookie `HttpOnly + Secure + SameSite=Lax`, duración 30 días, renovación si
  quedan menos de 7.
- El suscriptor **no** es un usuario del sistema de identidad: no tiene cuenta
  en `auth.users` ni rol en `membresias` (D-2). El aislamiento del portal se
  resuelve del lado del Worker, no con `auth.uid()`.
- `SESSION_SECRET` nunca va al frontend ni al repositorio; rotarla invalida
  todas las sesiones activas del portal.

---

## 11. Cierre de facturación en Cloudflare Queues

**No implementado — fuera de alcance de la feature 001-fundación.**
`plan.md §9` lo lista explícitamente como fuera de alcance junto con la PWA del
lector (014). Corresponde al bloque de features de facturación del roadmap
(`plan.md §9`: "Servicios, tarifas, contadores, lecturas, periodos, facturas,
pagos" — features 002 a 007).

**Intención aprobada** (`ARQUITECTURA.md`, `CLAUDE.md §5.5`), para cuando se
implemente:

- Nunca se procesa un cierre de facturación masivo en una sola invocación de
  Worker (límite de CPU/tiempo de un `fetch`).
- El flujo es: Cron dispara → encola una factura por mensaje en Cloudflare
  Queues → un consumidor (`backend/src/queues/`, todavía no existe) procesa en
  batches.
- `backend/src/queues/` está reservado en la estructura del repositorio
  (`CLAUDE.md §5.1`) pero no se crea hasta que la feature correspondiente lo
  necesite.

---

## 12. Ruta de salida — portabilidad

- **Salir de Supabase:** es PostgreSQL estándar; `pg_dump`/`pg_restore` a
  cualquier proveedor. El único trabajo adicional es reemplazar Supabase Auth
  por otra solución para la **sesión administrativa** — la sesión del
  suscriptor (D-2) ya está diseñada para ser independiente de Supabase Auth
  (JWT propio, ver §10), aunque su implementación esté pendiente de la feature
  008.
- **Salir de Cloudflare Workers:** Hono.js corre en cualquier runtime
  compatible con Fetch API (Node, Deno, Bun) con cambios mínimos de adaptador.
- **Salir de Cloudflare Pages:** Next.js se despliega en cualquier plataforma
  compatible (Vercel, un VPS con Docker) sin cambios de código, siempre que se
  respete la regla de portabilidad de `CLAUDE.md §5.2` (nada en `frontend/app/`
  o `frontend/components/` importa `@supabase/*` directamente).

Ningún componente crítico del negocio depende de una API propietaria
irremplazable.
