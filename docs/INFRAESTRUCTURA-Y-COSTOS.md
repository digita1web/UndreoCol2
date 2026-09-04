# INFRAESTRUCTURA-Y-COSTOS.md — UndreoCol

**Versión:** 1.0
**Fecha:** 2026-09-04
**Estado:** Vigente — registra las decisiones de una sesión de investigación de costos e
infraestructura. **Documento de planificación, no de implementación**: ninguna de las
tareas marcadas "Pendiente" tiene código todavía; cada una remite a la feature o al archivo
donde se implementará.

Este documento complementa, no reemplaza, a `ARQUITECTURA.md §6-7` (umbrales y resumen de
costo por etapa) y a `docs/INFRAESTRUCTURA.md` (configuración operativa). Donde esta sesión
cambia una decisión ya registrada en esos documentos, se señala explícitamente en la sección
correspondiente — quedan sin actualizar hasta que el pendiente técnico se implemente, para no
declarar "hecho" algo que sigue siendo solo una decisión.

---

## 1. Supabase (PostgreSQL + Auth) — plan gratis suficiente

**Decisión:** el plan Free de Supabase alcanza sin ampliación para el primer cliente.

| Límite del plan Free | Proyección para el acueducto piloto | Margen |
|---|---|---|
| 500 MB de base de datos | 500-600 suscriptores. Con el modelo de datos de UndreoCol (sin fotos por defecto, ver `docs/ESPECIFICACION-FUNCIONAL.md`), `ARQUITECTURA.md §6` ya proyecta ~30-50 MB/año de crecimiento para 1.000 suscriptores | Muy por debajo — años de margen antes de acercarse al límite |
| 50.000 usuarios activos/mes (MAU) de Supabase Auth | Solo los administradores del acueducto usan Supabase Auth (D-2: el suscriptor **no** es un usuario de `auth.users`, tiene su propio JWT — ver `CLAUDE.md §10` punto 25) — un puñado de cuentas admin, no 500-600 | Sin comparación posible, el límite es para otro tipo de uso |

No hace falta ninguna acción para el primer cliente. `docs/INFRAESTRUCTURA.md §8` ya tiene el
monitoreo de tamaño de base (`monitor-db.ts`, umbrales en 300/400/480 MB) para detectar con
anticipación cuándo esto deje de ser cierto.

### Riesgo de pausa por inactividad — YA RESUELTO

Los proyectos Free de Supabase se pausan tras 7 días sin actividad de base de datos. Este
riesgo **ya tiene mitigación implementada**, no es un pendiente de esta sesión:
`backend/src/cron/keepalive.ts` (Worker `undreocol-keepalive`, documentado en
`docs/INFRAESTRUCTURA.md §5`).

**Verificado en esta sesión que el mecanismo sigue en pie** (no se tocó código, solo se
confirmó que la configuración no se rompió en sesiones posteriores a su implementación):

```
backend/wrangler.keepalive.toml: [triggers] crons = ["0 5 * * *"] — cron diario intacto.
npx wrangler deploy --dry-run -c wrangler.keepalive.toml → Total Upload 706.28 KiB / gzip
  137.22 KiB, exit 0 — el Worker sigue empaquetando sin errores.
```

Esto confirma que el *código* del keepalive sigue siendo válido y desplegable. **No** confirma
que el cron esté corriendo en producción — eso depende de que Mateo lo haya desplegado
(`wrangler deploy -c wrangler.keepalive.toml` + secreto `SUPABASE_SERVICE_ROLE_KEY`), que sigue
siendo NO VERIFICADO en este contenedor por lo ya documentado en `docs/INFRAESTRUCTURA.md §5`
("requiere las credenciales de Cloudflare de Mateo"). La verificación real de que está vivo en
producción es la misma que ya describe ese documento: revisar en el panel de Supabase que
`ultimo_ping` avanza cada día y que el proyecto nunca muestra "Paused".

---

## 2. Backups automáticos sin costo (GitHub Actions)

> **CORRECCIÓN (2026-09-04, misma sesión que agregó §5-7 de este documento):** la primera versión
> de esta sección, escrita más temprano en la sesión de investigación de costos, afirmaba que el
> backup automático era un pendiente sin implementar y proponía un workflow nuevo
> (`backup-supabase.yml`) sin haber verificado primero si algo así ya existía en el repositorio.
> **Eso era incorrecto.** El workflow ya existe, desde antes de esa sesión:
> `.github/workflows/backup-diario.yml`, implementado el 2026-09-01 como parte del cierre de la
> feature 001-fundación (commit `87afd9e`, `specs/001-fundacion/tasks.md` T-013, decisión **D-7**
> de `docs/DECISIONES.md`). El error se detectó y se corrige aquí en la misma sesión de trabajo de
> Semgrep/auditoría, antes de que Mateo llegara a leer la versión incorrecta como definitiva
> (CLAUDE.md §8: un error de documentación se reporta y corrige en cuanto se detecta, no se deja
> pasar). Se conserva un resumen del diseño real abajo — no se documenta un diseño alternativo.

### Estado real

**Implementado, pendiente de verificación en producción — no es un pendiente de código.**
`docs/INFRAESTRUCTURA.md §6-7` tiene el detalle completo; resumen aquí para no duplicarlo:

| Aspecto | Diseño real (ya implementado) |
|---|---|
| Archivo del workflow | `.github/workflows/backup-diario.yml` |
| Disparador | `schedule` diario (06:00 UTC) + `workflow_dispatch` (disparo manual) |
| Herramienta de dump | `pg_dump --format=custom --no-owner`, en un contenedor `postgres:16-alpine` (sin instalar nada en el runner) |
| Conexión | Secreto `SUPABASE_DB_URL` — **Session Pooler, puerto 6543** (GitHub Actions no soporta IPv6, que la conexión directa 5432 de Supabase requiere) |
| Compresión | `gzip` |
| Destino | Cloudflare R2 (`wrangler r2 object put`, sin dependencia estilo AWS) |
| Retención | Regla *lifecycle* de 30 días del bucket R2 (config. del proveedor, no un paso de borrado en el workflow — D-7 descartó eso deliberadamente por frágil en CI) |
| Secretos necesarios | `SUPABASE_DB_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (GitHub → Settings → Secrets, nunca en el repo) |

**Lo único NO VERIFICADO** es la ejecución real: este y los contenedores de sesiones anteriores
nunca tuvieron los secretos de GitHub ni el bucket R2 real, así que nadie ha confirmado todavía
que un `workflow_dispatch` real sube un backup a R2 con éxito. Pasos exactos para Mateo, ya
documentados en `specs/001-fundacion/tasks.md` T-013:

```bash
# 1. Configurar en GitHub → Settings → Secrets and variables → Actions:
#    SUPABASE_DB_URL (Session Pooler, puerto 6543), CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
# 2. Crear el bucket R2 `undreocol-backups` con una regla lifecycle de expiración a 30 días.
# 3. Disparar manualmente: GitHub → Actions → backup-diario → Run workflow.
# 4. Verificar:
npx wrangler r2 object list undreocol-backups
#    → debe mostrar undreocol-backup-<fecha>-<sha>.sql.gz con su tamaño.
# 5. Restauración de prueba en staging, siguiendo docs/INFRAESTRUCTURA.md §7
#    ("un backup sin restaurar no es un backup").
```

Esto ya es 100% automático una vez verificado — no hace falta ningún cambio de código ni una
nueva decisión de diseño. **Prioridad de esta tarea: verificar, no implementar.**

---

## 3. Cloudflare Workers — tier gratis suficiente

**Decisión:** sin costo para el primer cliente. Confirma lo ya proyectado en `ARQUITECTURA.md §6`:
el gasto de Workers Paid (USD $5/mes) solo se activa con el primer cliente pagando — no antes,
y el tier gratis de Workers cubre desarrollo, demos y el arranque real con el acueducto piloto.

Sin cambios frente a lo ya documentado — se confirma la proyección, no se introduce información
nueva.

---

## 4. Correo — cambio de decisión: Resend en vez de Cloudflare Email Service

**Decisión de esta sesión:** usar **Resend** (plan gratis: 3.000 correos/mes, límite de 100/día)
en vez de Cloudflare Email Service para el envío del correo de factura (D-8 flujo secundario).

**Estado: PENDIENTE TÉCNICO, prioridad MEDIA** — amplía la **Feature 006 ya cerrada**
(`impresion-y-correo-factura`, completa según `CHANGELOG.md` Sesión 013). No se toca código en
esta sesión.

### Por qué el cambio

`docs/DECISIONES.md` D-8 fija el correo como flujo secundario usando Cloudflare Email Service, y
`ARQUITECTURA.md §6` proyecta ese envío como "USD $0 adicional hasta 3.000 correos/mes, **incluido
en Workers Paid**" — es decir, la arquitectura vigente **asume que Workers Paid ya está activo**
para poder usar el correo. Eso ata la disponibilidad del flujo de correo (secundario, pero real)
a un gasto que en principio solo se activa con el primer cliente pagando (`ARQUITECTURA.md §6`).
Resend en su plan gratis no depende de Workers Paid: el correo queda disponible desde antes de
ese disparador, sin gasto adicional en ningún punto del roadmap hasta los 3.000/mes.

### Impacto en código y documentación (a resolver cuando se implemente, no ahora)

- `backend/src/lib/email.ts` (Feature 006): hoy usa el binding nativo de Cloudflare
  (`env.EMAIL.send(message)`, ver el comentario de cabecera del archivo). Cambiar a Resend
  implica reemplazar ese binding por una llamada HTTP a la API de Resend (`fetch` a
  `api.resend.com`, con un API key como secreto del Worker) — no un binding nativo de Cloudflare
  Workers, así que también cambia cómo se simula en `wrangler dev` local (hoy `env.EMAIL` no
  existe en local y la capa devuelve `{ ok:false }` sin lanzar; con Resend, local sí podría hacer
  la llamada HTTP real contra la API si Mateo quiere probarlo antes de producción).
- `docs/DECISIONES.md` D-8 dice explícitamente "Usa Cloudflare Email Service" — requiere una
  decisión D-11 (o una nota de superseded sobre D-8) cuando esto se implemente, para no dejar el
  registro de decisiones contradiciendo el código.
- `ARQUITECTURA.md §6` (tabla de disparadores de costo) tiene la fila "Cloudflare Email Service |
  Incluido en Workers Paid" — deja de ser el mecanismo real una vez implementado este cambio, hay
  que actualizarla para reflejar Resend (con su propio límite de 3.000/mes y 100/día, no ligado a
  Workers Paid).
- El límite de **100 correos/día** de Resend es un dato nuevo que ninguno de los documentos
  existentes contempla — con el volumen de un acueducto piloto (500-600 suscriptores, correo como
  flujo secundario/opcional) no debería alcanzarse, pero si en el futuro un cierre de facturación
  masivo dispara muchos envíos el mismo día, este límite (no el mensual) sería el primero en
  golpear. Vale la pena que la implementación futura lo tenga en cuenta explícitamente (cola con
  reintentos ya existe, CLAUDE.md §10 punto 20 — un 429 de Resend por límite diario debería caer
  en el mismo mecanismo de reintento que cualquier otro fallo de envío).

**Nota de precisión:** los límites de plan gratis de un proveedor externo (3.000/mes, 100/día)
son los que se investigaron en esta sesión — se recomienda reconfirmarlos en el sitio de Resend
al momento de implementar, ya que los proveedores externos cambian sus tiers sin aviso (CLAUDE.md
§8: no se inventa ni se asume vigente indefinidamente una condición de un tercero).

---

## 5. Monitoreo de errores — Sentry

**Decisión:** Sentry (plan gratis: 5.000 errores/mes) para backend (Workers) y frontend
(Next.js).

**Estado: PENDIENTE TÉCNICO, prioridad MEDIA.** Sin código todavía. Esto **confirma** una
intención que ya existía antes de esta sesión —
`docs/ESTRATEGIA-CALIDAD.md` (línea 223) y `docs/INFRAESTRUCTURA.md §2` ya listaban Sentry como
cuenta a crear en plan Free — pero no estaba implementado ni tenía sus límites de plan
documentados explícitamente en ningún lado hasta ahora.

No hay ninguna instrumentación de Sentry en el código todavía (`grep -ri sentry` en el repo solo
encuentra las dos menciones de intención ya citadas, ninguna en `backend/src/` ni `frontend/`).

Al implementar: instrumentar `backend/src/index.ts` (y los Workers de `cron/`, que hoy solo
loguean con `console.error`, visible en logs de Cloudflare pero no agregado/alertable) y el
`error.tsx`/boundary de Next.js en `frontend/`. Sin disparador de costo previsto dentro del
volumen del acueducto piloto — 5.000 errores/mes es un volumen que solo se alcanzaría con un bug
sistemático sin resolver, no con operación normal.

**Nota de precisión:** mismo criterio que Resend — el límite de 5.000 errores/mes es el
investigado en esta sesión para el plan gratis vigente de Sentry; reconfirmar en sentry.io al
implementar.

---

## 6. Resumen de costo total — primer cliente

| Componente | Costo/mes |
|---|---|
| Supabase (Free) | $0 |
| Cloudflare Workers (Free) | $0 |
| Cloudflare Pages (Free) | $0 |
| GitHub Actions (backup automático, uso muy por debajo del tier gratis para un cron de 1-2 corridas/día) | $0 |
| Almacenamiento de backups (repo privado, o R2 Free hasta 10 GB) | $0 |
| Resend (correo, hasta 3.000/mes · 100/día) | $0 |
| Sentry (monitoreo de errores, hasta 5.000/mes) | $0 |
| **Total** | **USD $0/mes** |

Esto reemplaza el costo de "$5/mes desde el día 1" que asumía Cloudflare Email Service atado a
Workers Paid (§4) — con Resend, el primer gasto real sigue siendo exclusivamente el disparador ya
documentado en `ARQUITECTURA.md §6` (Workers Paid, **solo** con el primer cliente pagando), no
antes.

**Backups: ya son 100% automáticos por código** (`backup-diario.yml`, §2) — a diferencia de un
backup manual (que dependería de que alguien recuerde ejecutarlo), el workflow corre solo. Lo
pendiente es solo la verificación en producción (secretos + bucket + `workflow_dispatch` de
prueba), más el ritual mensual de *verificación de restauración* que ya describe
`docs/INFRAESTRUCTURA.md §7.3` (deliberadamente manual — confirmar que un backup realmente sirve
no se puede automatizar del todo sin restarle valor a la verificación).

---

## 7. Pendientes técnicos de esta sesión — tabla de seguimiento

| # | Pendiente | Prioridad | Amplía / crea | Archivos principales |
|---|---|---|---|---|
| 1 | Verificar en producción el backup ya implementado (§2) — configurar secretos, bucket R2, disparar `workflow_dispatch`, confirmar con `wrangler r2 object list`, hacer una restauración de prueba | **ALTA** — antes de producción real | Verificación, no código nuevo — `.github/workflows/backup-diario.yml` ya existe | Ninguno de código; `specs/001-fundacion/tasks.md` T-013 tiene los pasos exactos |
| 2 | Cambiar correo de Cloudflare Email Service a Resend | MEDIA | Amplía Feature 006 (cerrada) | `backend/src/lib/email.ts`, `docs/DECISIONES.md` (D-8/nueva D-11), `ARQUITECTURA.md §6` |
| 3 | Monitoreo de errores con Sentry | MEDIA | Nuevo (transversal, no atado a una feature del roadmap) | `backend/src/index.ts`, Workers de `cron/`, `frontend/app/` (error boundary) |

Los pendientes 2 y 3 no tienen `spec.md`/`plan.md`/`tasks.md` todavía — siguiendo `CLAUDE.md §3`,
no se escribe código sin pasar primero por `/specify` cuando Mateo decida priorizarlos. El
pendiente 1 no necesita `/specify` — es verificación operativa de código ya escrito, no una
feature nueva.
