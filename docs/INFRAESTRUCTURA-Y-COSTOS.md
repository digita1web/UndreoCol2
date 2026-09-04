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

## 2. Backups automáticos sin costo (GitHub Actions) — reemplaza la idea de backup manual

**Decisión de esta sesión:** los backups del primer cliente se resuelven con un workflow de
GitHub Actions programado, sin ningún paso manual periódico. Reutiliza el mismo patrón que ya
se usó en el proyecto anterior de Frappe para este propósito (backup automático vía cron/CI,
sin intervención humana recurrente).

**Estado: PENDIENTE DE IMPLEMENTACIÓN — prioridad ALTA (antes de producción real).** Solo
documentación en esta sesión, ningún archivo de código ni workflow creado todavía.

### Diseño

| Aspecto | Decisión |
|---|---|
| Disparador | `schedule` de GitHub Actions, cron cada 12-24h (a fijar el valor exacto al implementar — 24h es el mínimo razonable para no gastar minutos de Actions sin necesidad; 12h si Mateo quiere una ventana de pérdida de datos más corta) |
| Archivo del workflow | `.github/workflows/backup-supabase.yml` |
| Comando de dump | `supabase db dump` (CLI de Supabase), usando el secreto de GitHub `SUPABASE_DB_URL` |
| Compresión | El archivo de salida se comprime (`gzip`) antes de subirlo |
| Destino de almacenamiento | Dos opciones evaluadas, **decisión final pendiente** (ver nota abajo): (a) un repositorio privado aparte en GitHub, o (b) Cloudflare R2 (tier gratis: 10 GB de almacenamiento, muy por encima de lo que ocupan backups comprimidos de una base de <50 MB) |
| Retención | Rotación automática: se borran los backups de más de 30 días |
| Secreto necesario | `SUPABASE_DB_URL` como secret de GitHub Actions (nunca en el repo) |

### Nota — decisión de almacenamiento aún abierta

Esta sesión dejó dos opciones válidas sin decidir cuál usar, a diferencia de `docs/DECISIONES.md`
D-7 (ver reconciliación abajo), que ya había fijado R2 como destino único:

- **Repo privado aparte:** cero configuración de credenciales de Cloudflare, pero un repositorio
  de GitHub no está pensado para almacenamiento binario recurrente (límite práctico de tamaño de
  repo, sin política de expiración nativa — la rotación de 30 días tendría que hacerla el propio
  workflow borrando commits/archivos viejos).
- **Cloudflare R2:** tier gratis de 10 GB, con reglas de *lifecycle* nativas del bucket para la
  retención de 30 días (sin lógica de borrado dentro del workflow) — es el mecanismo que
  `docs/INFRAESTRUCTURA.md §6` ya documentaba antes de esta sesión.

**Recomendación técnica (no una decisión de Mateo todavía):** R2 sigue siendo la opción más
robusta por la regla de *lifecycle* nativa — evita un paso de borrado manual/scripted dentro del
workflow, que `docs/INFRAESTRUCTURA.md §6` ya había descartado deliberadamente por ser frágil en
CI. Queda para que Mateo confirme antes de implementar.

### Reconciliación con `docs/DECISIONES.md` D-7 y `docs/INFRAESTRUCTURA.md §6` (contradicción a resolver antes de implementar)

`docs/INFRAESTRUCTURA.md §6` ya documentaba, desde antes de esta sesión, un diseño de backup
automático aprobado como decisión **D-7** — **no** es correcto describir la idea de backup
automático como nueva; lo nuevo aquí es un mecanismo distinto para lograrlo. Diferencias
concretas entre el diseño ya aprobado (D-7) y el de esta sesión:

| Aspecto | D-7 (ya documentado) | Esta sesión |
|---|---|---|
| Archivo del workflow | `.github/workflows/backup-diario.yml` | `.github/workflows/backup-supabase.yml` |
| Herramienta de dump | `pg_dump --format=custom --no-owner` dentro de un contenedor `postgres:16-alpine` | CLI `supabase db dump` |
| Conexión | Secreto `SUPABASE_DB_URL` con el **Session Pooler, puerto 6543** (D-7 es explícito: GitHub Actions no soporta IPv6 y la conexión directa 5432 lo requiere) | Secreto `SUPABASE_DB_URL`, puerto no especificado en esta sesión |
| Destino | Cloudflare R2 únicamente, con `wrangler r2 object put` | Repo privado o R2, sin decidir |
| Retención | Regla *lifecycle* del bucket R2 | "Rotación automática" sin mecanismo especificado |

**Esto se reporta explícitamente, no se oculta (CLAUDE.md §8):** antes de implementar, alguien
tiene que decidir cuál diseño es el vigente — no pueden coexistir dos workflows de backup con
nombres y mecanismos distintos apuntando al mismo problema. Mientras no se reconcilien, este
documento y `docs/INFRAESTRUCTURA.md §6` describen dos versiones del mismo pendiente. La
recomendación técnica es conservar el detalle ya aprobado de D-7 que esta sesión no contradice
por una razón técnica concreta (el puerto 6543 del Session Pooler, específicamente necesario
porque GitHub Actions no soporta IPv6) y renombrar/ajustar solo lo que esta sesión sí cambia
deliberadamente (usar `supabase db dump` en vez de `pg_dump` en contenedor, si esa simplificación
es intencional). Cuando se implemente, actualizar `docs/INFRAESTRUCTURA.md §6-7` para que quede
un solo diseño vigente, y marcar D-7 en `docs/DECISIONES.md` como superseded si el mecanismo
cambia de fondo.

**Verificación esperada al implementar (CA a definir en el `/specify` correspondiente):**
`workflow_dispatch` manual disparado, archivo aparece en el destino elegido con el tamaño
correcto, y — siguiendo el protocolo ya documentado en `docs/INFRAESTRUCTURA.md §7` — una
restauración de prueba en un proyecto Supabase de staging confirma que el backup es utilizable
(*"un backup sin restaurar no es un backup"*).

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

**Backups: 100% automáticos, sin intervención manual periódica** una vez implementado el pendiente
de §2 — a diferencia de un backup manual (que dependería de que alguien recuerde ejecutarlo), el
workflow de GitHub Actions corre solo, con la única intervención humana siendo el ritual mensual
de *verificación* de restauración que ya describe `docs/INFRAESTRUCTURA.md §7.3` (que es
deliberadamente manual — confirmar que un backup automático realmente sirve no se puede
automatizar del todo sin restarle valor a la verificación).

---

## 7. Pendientes técnicos de esta sesión — tabla de seguimiento

| # | Pendiente | Prioridad | Amplía / crea | Archivos principales al implementar |
|---|---|---|---|---|
| 1 | Backup automático vía GitHub Actions | **ALTA** — antes de producción real | Nuevo (posible feature 016 o ampliación de 001-fundación, a decidir en `/specify`) | `.github/workflows/backup-supabase.yml`, reconciliar con D-7 (§2 arriba) |
| 2 | Cambiar correo de Cloudflare Email Service a Resend | MEDIA | Amplía Feature 006 (cerrada) | `backend/src/lib/email.ts`, `docs/DECISIONES.md` (D-8/nueva D-11), `ARQUITECTURA.md §6` |
| 3 | Monitoreo de errores con Sentry | MEDIA | Nuevo (transversal, no atado a una feature del roadmap) | `backend/src/index.ts`, Workers de `cron/`, `frontend/app/` (error boundary) |

Ninguno de los tres tiene `spec.md`/`plan.md`/`tasks.md` todavía — siguiendo `CLAUDE.md §3`, no
se escribe código sin pasar primero por `/specify` cuando Mateo decida priorizarlos.
