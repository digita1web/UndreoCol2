# SPEC — 035: panel-maestro-planes-salud

**Estado:** Borrador para aprobación
**Depende de:** 001-fundacion (esquema `clientes`/`planes`/`_keepalive`), 018-panel-plataforma,
010-notificaciones (patrón de cron ya establecido, `monitor-db.ts`)

## 1. Objetivo

Completar los dos módulos del panel maestro (`/plataforma`) que `docs/PLAN-PRODUCCION.md` marca
como "sin empezar": que el superadmin vea y cambie el plan y el estado de cuenta de cada acueducto,
y que vea de un vistazo si la base de datos, el keepalive y el último backup están sanos — sin
tener que entrar al dashboard de Supabase ni a Cloudflare ni a GitHub Actions para saberlo.

## 2. Por qué ahora

- Es el único punto del mapa de módulos de `/plataforma` (documentado desde 033) que sigue sin
  spec. `clientes.plan_id`/`clientes.estado_cuenta` existen en el esquema desde 001-fundación,
  `tamano_base_mb()` y el cron `monitor-db.ts` desde la misma fecha, el backup diario a R2 desde su
  propia feature — todos ya operan, pero nada los muestra visualmente al superadmin.
- Investigación previa a este spec (regla de CLAUDE.md §3, aplicada de nuevo) encontró que la
  solución correcta **no es inventar un mecanismo nuevo**: es reutilizar el patrón que el propio
  proyecto ya usa para exactamente este problema — `_keepalive`, una tabla chica que un cron
  actualiza y que el panel lee vía RLS, en vez de darle a una ruta de usuario acceso a
  `service_role_key`.
- Encontró también un bloqueo real que cambia el diseño: `tamano_base_mb()` tiene
  `revoke execute ... from anon, authenticated` y `grant execute ... to service_role` — **no se
  puede llamar desde ninguna ruta que atienda al superadmin** (CLAUDE.md §12, absoluto). El cron
  `monitor-db.ts` ya la ejecuta a diario con su cliente de `service_role`; este spec le agrega un
  paso más (escribir el resultado en una tabla nueva, spec §3.4) en vez de tocar el permiso de la
  función.
- El backup diario (`.github/workflows/backup-diario.yml`) no escribe nada en Postgres — sube un
  archivo a Cloudflare R2 (`undreocol-backups`). Decisión de Mateo: verlo desde un binding R2 nuevo
  (mismo mecanismo que ya usa `FACTURAS_R2`), no agregando un secreto de GitHub nuevo al Worker.

## 3. Alcance

### 3.1 `/plataforma` muestra el plan y el estado de cuenta de cada acueducto
La lista de acueductos ya existente gana dos columnas: nombre del plan (`planes.nombre`) y estado
de cuenta (`activa`/`vencida`/`suspendida`/`cancelada`). Datos que ya existen en el esquema desde
001, nunca expuestos hasta ahora.

### 3.2 El superadmin puede cambiar el plan y el estado de cuenta de un acueducto
Un control por acueducto para reasignar su `plan_id` (elegir entre los planes existentes) y otro
para cambiar su `estado_cuenta`. La política RLS `clientes_plataforma` (001-fundación) ya autoriza
esta escritura al superadmin — investigado y confirmado antes de este spec, no hace falta ninguna
migración para el permiso en sí.

### 3.3 Sección nueva "Salud del sistema" en `/plataforma`
Tres indicadores, cada uno con su propia fuente de datos y su propia forma de llegar sin
`service_role_key` en la ruta:
- **Tamaño de la base:** último valor medido por el cron `monitor-db.ts` (MB y nivel
  normal/alerta/crítico), con la fecha de esa medición — no un valor en vivo.
- **Keepalive:** `_keepalive.ultimo_ping`, la misma fila que ya mantiene el cron `keepalive.ts`.
- **Último backup:** fecha del objeto más reciente en el bucket R2 `undreocol-backups`.

Los tres indicadores muestran su fecha/hora — "sano" significa "la última medición fue reciente Y
en buen nivel", no "en este preciso instante". Ningún indicador se calcula en vivo dentro de la
petición del superadmin.

### 3.4 `monitor-db.ts` (cron ya existente) gana un paso: escribir su resultado
Después de calcular el tamaño y el nivel (como ya hace hoy), el cron escribe esa medición en una
tabla nueva de una sola fila (mismo patrón que `_keepalive`) — con su cliente de `service_role` ya
existente, sin ningún permiso nuevo. La ruta que atiende al superadmin lee esa tabla con el JWT del
usuario, nunca con `service_role_key` (regla no negociable, ver §5).

### 3.5 Nueva política RLS de lectura sobre `_keepalive`
Hoy `_keepalive` tiene RLS `FORCE` sin ninguna política — nadie que no sea `service_role` puede
leerla, ni siquiera el superadmin. Se agrega una política de `select` acotada a
`es_admin_plataforma()`, igual de restrictiva que la de cualquier otra tabla de plataforma
(`clientes_plataforma`, 001).

## 4. Fuera de alcance

- **Crear o editar el catálogo de planes** (agregar un plan nuevo, cambiar sus tarifas) — hoy hay
  dos planes fijos (`Basico`, `Pro`) sembrados por fixture; esta feature solo permite *asignar* uno
  existente a un acueducto, no gestionar el catálogo. Sin pedido de Mateo para lo segundo.
- **Que `estado_cuenta` tenga algún efecto real en el sistema** (bloquear login, facturación,
  etc.). Ya documentado en el propio código (`avisos-vencimiento.ts`, 010): "ninguna otra parte del
  código lo usa todavía para excluir procesamiento" — sigue así después de este spec. `PLAN-
  PRODUCCION.md` ya lo marca como "relevante recién cuando haya cobro real a acueductos"; cambiar el
  campo desde el panel no le agrega ningún comportamiento nuevo al resto del sistema.
- **Medir el tamaño de la base o el estado del backup en vivo, en cada carga del panel.** Los tres
  indicadores de "Salud del sistema" muestran la última medición del cron correspondiente, con su
  fecha — nunca disparan una medición nueva desde la petición del superadmin.
- **Restaurar un backup desde el panel** — el ritual de restauración ya está documentado a mano
  (`docs/INFRAESTRUCTURA.md §7`); esta feature solo muestra la fecha del más reciente, no ofrece
  ninguna acción sobre él.
- **Alertar o notificar sobre estos tres indicadores desde el panel** — el cron `monitor-db.ts` ya
  manda su propio correo de alerta (010, spec §3.8) cuando corresponde; este spec no duplica esa
  lógica, solo la hace visible.

## 5. Reglas de negocio que aplican

- `SUPABASE_SERVICE_ROLE_KEY` nunca en una ruta que atiende peticiones de usuario (CLAUDE.md §12,
  absoluto) — motivo central del diseño de §3.3/§3.4/§3.5: ninguno de los tres indicadores se lee
  con `service_role`, todos pasan por una tabla que un cron ya privilegiado escribe y una política
  RLS nueva que el superadmin puede leer con su propio JWT.
- Toda tabla nueva lleva su test de aislamiento (CLAUDE.md §5.4) — la tabla nueva de §3.4 es de
  plataforma, no multi-tenant (no lleva `cliente_id`, mismo criterio que `_keepalive`); su test
  verifica que solo `es_admin_plataforma()` puede leerla, ningún otro rol.
- Cambiar `plan_id`/`estado_cuenta` de un acueducto es una acción sobre **otro** tenant — exclusiva
  del superadmin, nunca de `admin_acueducto` (ya lo garantiza `clientes_plataforma`, sin cambios).

## 6. Criterios de aceptación

### CA-1 — `/plataforma` muestra plan y estado de cuenta reales
Con al menos dos acueductos de prueba con planes distintos, la lista los muestra correctamente.

### CA-2 — El superadmin puede cambiar el plan de un acueducto
Reasignar el plan de un acueducto de prueba lo persiste — confirmado leyendo `clientes.plan_id`
directamente después del cambio.

### CA-3 — El superadmin puede cambiar el estado de cuenta de un acueducto
Igual que CA-2, para `estado_cuenta`.

### CA-4 — `admin_acueducto`/`secretaria`/`lector` no pueden cambiar el plan ni el estado de cuenta
de ningún acueducto, ni siquiera el propio
La ruta nueva exige `es_admin_plataforma()`; cualquier otro rol recibe `403` explícito.

### CA-5 — "Salud del sistema" muestra las tres mediciones reales, con su fecha
Tras correr el cron `monitor-db.ts` una vez (local, `wrangler dev --test-scheduled`), el panel
muestra el tamaño de la base, el nivel y la fecha de esa medición — no un placeholder ni un error.

### CA-6 — El keepalive se ve en el panel tras una política RLS nueva
Con la migración aplicada, el superadmin lee `_keepalive.ultimo_ping` a través de la ruta nueva;
antes de la migración (o con otro rol) esa lectura fallaba/devolvía vacío por RLS.

### CA-7 — El backup más reciente se identifica correctamente
Con al menos dos objetos de prueba en un bucket R2 local simulado, el panel muestra la fecha del más
reciente, no del primero ni de uno al azar.

### CA-8 — Ninguna de las tres rutas nuevas usa `service_role_key`
Verificable por `grep` sobre el código de las rutas nuevas.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El superadmin cambia el plan de un acueducto sin darse cuenta de que no tiene ningún efecto real (facturación a UndreoCol) todavía | Documentado explícitamente en §4 como decisión, no como olvido — la UI puede aclarar con un texto breve que el cobro real todavía no está automatizado |
| La medición de "Salud del sistema" puede estar desactualizada si el cron falló el día anterior | Se muestra la fecha de la medición junto al valor — el superadmin ve la antigüedad, no un estado falso de "todo bien" sin contexto de cuándo se supo |
| Listar objetos de un bucket R2 con muchos archivos podría ser lento a futuro | Con la retención de 30 días ya configurada (D-7, lifecycle del bucket) el bucket nunca crece sin límite — no hace falta paginar en esta escala |
| Agregar una política RLS a `_keepalive` amplía ligeramente su superficie de lectura (antes: nadie salvo `service_role`) | Acotada estrictamente a `es_admin_plataforma()`, mismo criterio que ya usa `clientes_plataforma` — no es una relajación real, es el mismo permiso que el superadmin ya tiene sobre el resto de datos de plataforma |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] Migración versionada (tabla nueva + política de `_keepalive`) + test de aislamiento en verde
- [ ] Tests de las rutas nuevas en verde, con la salida pegada
- [ ] Verificación manual con `wrangler dev` real: cron de `monitor-db.ts` corrido a mano, los tres
      indicadores leídos por la ruta nueva con una sesión de superadmin real
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
