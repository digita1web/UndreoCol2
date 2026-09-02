# PLAN — 003: suscriptores-contadores

**Spec aprobado:** 2026-09-01 (6 criterios de aceptación, ver `spec.md`)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` ni código hasta esa aprobación.

---

## 0. Punto de partida

De `supabase/migrations/20260831150000_fundacion-tenancy.sql` (001), reutilizado sin tocar:

- `usuarios_servicio` **ya existe** con: `id`, `cliente_id`, `codigo_suscriptor`, `nombre`, `estado`
  (`estado_suscriptor`), `created_at`, `updated_at`, único `(cliente_id, codigo_suscriptor)`, y ya
  tiene su trigger `trg_usuarios_servicio_updated` — 003 no lo vuelve a crear.
- Funciones `SECURITY DEFINER`: `es_admin_de(cliente_id)`, `mis_clientes()`, `es_admin_plataforma()`.
- Políticas ya existentes `usuarios_servicio_lectura`/`usuarios_servicio_escritura` — se mantienen
  tal cual (mismo patrón lectura=miembro, escritura=admin_acueducto); no se tocan al alterar la
  tabla, PostgreSQL no las invalida por agregar columnas.
- Función `set_updated_at()` (llamada `set_updated_at`, no `trigger_updated_at` — corrección que
  ya quedó documentada en 002 T-001).

De `supabase/migrations/20260901120000_catalogo-y-tarifas.sql` (002), reutilizado sin tocar:

- Enum `categoria_tarifaria` — la columna nueva `usuarios_servicio.categoria` lo referencia
  directamente.
- Patrón de función con `SELECT ... FOR UPDATE` + `SECURITY INVOKER` + `es_admin_de()` explícito
  de `crear_tarifa_version()` — se replica para `reemplazar_contador()`.

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260902090000_suscriptores-contadores.sql` | crear | `ALTER TABLE usuarios_servicio` (nuevas columnas), enum `estado_contador`, tablas `contadores`/`reemplazos_contador`, función `reemplazar_contador()`, RLS + políticas |
| `backend/src/lib/suscriptores.ts` | crear | Acceso a datos: CRUD suscriptores, alta de contador, reemplazo |
| `backend/src/index.ts` | editar | Rutas `/suscriptores*` |
| `tests/fixtures/suscriptores.sql` | crear | Datos de ejemplo para el test de aislamiento (reutiliza clientes/servicios/tarifas de fixtures previos) |
| `tests/aislamiento/003_suscriptores_aislamiento.sql` | crear | CA-2, CA-5 |
| `frontend/app/app/suscriptores/page.tsx` | crear | Lista + alta |
| `frontend/app/app/suscriptores/[id]/page.tsx` | crear | Detalle, edición, contador, reemplazo |
| `frontend/lib/api.ts` | editar | Funciones de suscriptores/contadores |
| `CHANGELOG.md` | editar | Cierre de la feature |

## 2. Esquema de base de datos

### Migraciones

| Archivo | Contenido |
|---|---|
| `20260902090000_suscriptores-contadores.sql` | `alter table usuarios_servicio add column ...` (8 columnas nuevas); enum `estado_contador`; tabla `contadores` con índice único parcial de contador activo y `updated_at`+trigger; `alter table usuarios_servicio add constraint fk_contador_actual`; tabla `reemplazos_contador`; función `reemplazar_contador()`; RLS `FORCE` + políticas en `contadores`/`reemplazos_contador` (mismo patrón lectura/escritura que `usuarios_servicio`) |

### Tablas

```sql
alter table usuarios_servicio
  add column tipo_documento     text,
  add column numero_documento   text,
  add column telefono           text,
  add column email              text,
  add column direccion          text,
  add column sector             text,
  add column categoria          categoria_tarifaria,
  add column contador_actual_id uuid,
  add column fecha_vinculacion  date not null default current_date,
  add column notas              text;

create index on usuarios_servicio (cliente_id, numero_documento);
```

`numero_documento`, `direccion` y `categoria` son `NOT NULL` en `docs/esquema-propuesto.sql`, pero
la tabla **ya tiene filas** (fixtures de 001/002, potencialmente datos reales si Mateo dio de alta
algo desde el panel). Un `ALTER ... ADD COLUMN ... NOT NULL` sin `DEFAULT` falla contra filas
existentes. Se agregan **nullable** aquí y la restricción real de "requerido" se aplica en la capa
de aplicación (`lib/suscriptores.ts`) para las filas nuevas — decisión técnica, ver §5.

```sql
create type estado_contador as enum ('activo','danado','reemplazado');

create table contadores (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid not null references usuarios_servicio(id) on delete restrict,
  serial              text not null,
  marca               text,
  capacidad_maxima    numeric(12,2) not null,
  lectura_inicial     numeric(12,2) not null default 0,
  fecha_instalacion   date not null,
  estado              estado_contador not null default 'activo',
  observaciones       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (cliente_id, serial),
  constraint chk_capacidad check (capacidad_maxima > 0)
);

create unique index uq_contador_activo
  on contadores (usuario_servicio_id) where estado = 'activo';
create index on contadores (cliente_id, usuario_servicio_id);

create trigger trg_contadores_updated before update on contadores
  for each row execute function set_updated_at();

alter table usuarios_servicio
  add constraint fk_contador_actual
  foreign key (contador_actual_id) references contadores(id) on delete set null;

create table reemplazos_contador (
  id                     uuid primary key default gen_random_uuid(),
  cliente_id             uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id    uuid not null references usuarios_servicio(id) on delete restrict,
  contador_anterior_id   uuid not null references contadores(id) on delete restrict,
  contador_nuevo_id      uuid not null references contadores(id) on delete restrict,
  fecha_reemplazo        date not null default current_date,
  lectura_final_anterior numeric(12,2) not null,
  lectura_inicial_nuevo  numeric(12,2) not null default 0,
  motivo                 text,
  registrado_por         uuid references perfiles(id),
  created_at             timestamptz not null default now(),
  constraint chk_distintos check (contador_anterior_id <> contador_nuevo_id)
);

create index on reemplazos_contador (cliente_id, usuario_servicio_id, fecha_reemplazo);
```

`on delete restrict` en `contador_anterior_id`/`contador_nuevo_id` (igual que la referencia):
un contador con historial de reemplazo nunca se borra físicamente.

```sql
create or replace function reemplazar_contador(
  p_usuario_servicio_id    uuid,
  p_serial_nuevo           text,
  p_marca_nuevo            text,
  p_capacidad_maxima_nuevo numeric,
  p_lectura_final_anterior numeric,
  p_lectura_inicial_nuevo  numeric,
  p_motivo                 text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_contador_anterior_id uuid;
  v_contador_nuevo_id uuid;
  v_reemplazo_id uuid;
begin
  select cliente_id, contador_actual_id into v_cliente_id, v_contador_anterior_id
    from usuarios_servicio where id = p_usuario_servicio_id
    for update;

  if v_cliente_id is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if not es_admin_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;
  if v_contador_anterior_id is null then
    raise exception 'El suscriptor no tiene contador activo para reemplazar';
  end if;

  update contadores set estado = 'reemplazado' where id = v_contador_anterior_id;

  insert into contadores (cliente_id, usuario_servicio_id, serial, marca,
                           capacidad_maxima, lectura_inicial, fecha_instalacion, estado)
  values (v_cliente_id, p_usuario_servicio_id, p_serial_nuevo, p_marca_nuevo,
          p_capacidad_maxima_nuevo, p_lectura_inicial_nuevo, current_date, 'activo')
  returning id into v_contador_nuevo_id;

  update usuarios_servicio set contador_actual_id = v_contador_nuevo_id
    where id = p_usuario_servicio_id;

  insert into reemplazos_contador (cliente_id, usuario_servicio_id, contador_anterior_id,
                                    contador_nuevo_id, lectura_final_anterior,
                                    lectura_inicial_nuevo, motivo)
  values (v_cliente_id, p_usuario_servicio_id, v_contador_anterior_id, v_contador_nuevo_id,
          p_lectura_final_anterior, p_lectura_inicial_nuevo, p_motivo)
  returning id into v_reemplazo_id;

  return v_reemplazo_id;
end;
$$;

revoke execute on function reemplazar_contador(uuid, text, text, numeric, numeric, numeric, text) from anon, public;
grant  execute on function reemplazar_contador(uuid, text, text, numeric, numeric, numeric, text) to authenticated;
```

`SELECT ... FOR UPDATE` sobre `usuarios_servicio` (no sobre `contadores`): el punto de
serialización correcto es el suscriptor, porque es su fila la que decide cuál es "el contador
activo" en un momento dado — dos reemplazos concurrentes del mismo suscriptor deben esperarse
entre sí, igual razón que bloqueó la fila de configuración para el consecutivo de factura en 001.
El índice único parcial `uq_contador_activo` es la segunda barrera: aunque la lógica de arriba
tuviera un hueco, la base de datos igual rechazaría dos contadores `activo` para el mismo
suscriptor.

### Políticas RLS

```sql
create policy contadores_lectura on contadores for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy contadores_escritura on contadores for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy reemplazos_contador_lectura on reemplazos_contador for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy reemplazos_contador_escritura on reemplazos_contador for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
```

`usuarios_servicio_lectura`/`_escritura` de 001 no cambian: ya cubren la tabla ampliada porque
filtran por `cliente_id`, no por columna.

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| GET | `/suscriptores` | sesión admin | Lista suscriptores del acueducto activo (filtro `?estado=`) |
| POST | `/suscriptores` | sesión admin, `admin_acueducto` (RLS) | Crea un suscriptor (sin contador) |
| GET | `/suscriptores/:id` | sesión admin | Detalle + contador activo + historial de reemplazos |
| PATCH | `/suscriptores/:id` | sesión admin, `admin_acueducto` (RLS) | Edita datos (nunca `codigo_suscriptor`, ver §5) |
| POST | `/suscriptores/:id/contador` | sesión admin, `admin_acueducto` (RLS) | Alta del primer contador (falla si ya tiene uno activo) |
| POST | `/suscriptores/:id/reemplazar-contador` | sesión admin, `admin_acueducto` (RLS + función) | Llama `reemplazar_contador()` |

Todas resuelven el cliente activo con `resolverClienteActivo()` (reutilizado de `lib/tenant.ts`,
mismo patrón que 002).

## 4. Contratos de core/

Ninguno. 003 no calcula dinero ni consumo — es CRUD puro sobre datos de suscriptor/contador. El
cálculo que usará `capacidad_maxima` y `reemplazos_contador` (rollover, consumo combinado) es de
`core/consumo.ts` en 004, fuera de este alcance (spec.md §4).

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `numero_documento`/`direccion`/`categoria` se agregan `NULLABLE` en la migración; la app exige que estén presentes al crear un suscriptor nuevo | `NOT NULL` directo como en `docs/esquema-propuesto.sql` | La tabla ya tiene filas (fixtures de 001/002); un `ALTER ... NOT NULL` sin backfill falla. Forzar un valor de relleno (`''`) sería peor: dejaría suscriptores con datos falsos que parecen reales |
| Alta del contador es un endpoint separado (`POST /suscriptores/:id/contador`), no parte de `POST /suscriptores` | Un único formulario/endpoint que cree suscriptor+contador juntos | Un suscriptor puede existir sin contador todavía (migración de datos históricos, alta administrativa previa a la instalación física); forzar el contador en el mismo paso complica el caso común de "doy de alta el suscriptor hoy, el contador se instala la próxima semana" |
| `reemplazar_contador()` es `SECURITY INVOKER` con `SELECT FOR UPDATE` sobre `usuarios_servicio`, no sobre `contadores` | Bloquear la fila del contador anterior | El contador anterior no tiene una fila que represente "cuál es el activo": esa información vive en `usuarios_servicio.contador_actual_id`. Bloquear ahí es lo que realmente serializa dos reemplazos concurrentes del mismo suscriptor |
| `PATCH /suscriptores/:id` nunca acepta `codigo_suscriptor` | Permitir cambiarlo | Es la credencial del futuro portal (D-2) junto con `numero_documento`; cambiarlo silenciosamente invalidaría el acceso del suscriptor sin aviso. Si hace falta regenerarlo, es una acción explícita de la feature 008, fuera de 003 |
| `contador_anterior_id`/`contador_nuevo_id` en `reemplazos_contador` son `ON DELETE RESTRICT` | `CASCADE` | Un contador con historial de reemplazo nunca se borra físicamente — mismo criterio que las tarifas con facturas emitidas (CLAUDE.md §10 punto 0d), aplicado aquí a la integridad del historial de contadores |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

Ninguna ruta procesa lotes; CRUD de una fila o listados acotados a un acueducto. Irrelevante para
esta feature.

## 8. Estrategia de pruebas

- **Unitarias (`core/`):** ninguna — no hay `core/` nuevo en esta feature (§4).
- **Aislamiento (RLS):** `tests/aislamiento/003_suscriptores_aislamiento.sql`, mismo mecanismo que
  001/002. Cubre explícitamente:
  - Acueducto A no lee/escribe suscriptores, contadores ni reemplazos de B por `SELECT`/`INSERT`
    directo.
  - `reemplazar_contador()` llamado por admin A sobre un `usuario_servicio_id` de B falla con
    "no existe" (mismo comportamiento verificado en 002 T-002 PASO 4: RLS hace la fila invisible
    antes de que la función pueda leer su `cliente_id`).
  - Dos llamadas sucesivas a `reemplazar_contador()` para el mismo suscriptor dejan exactamente un
    contador `activo` (CA-5), y un intento de `INSERT` directo de un segundo contador `activo`
    para el mismo suscriptor viola `uq_contador_activo`.
  - Rol `lector` no puede escribir en ninguna de las 3 tablas.
- **Integración:** peticiones HTTP reales contra `wrangler dev` para las 6 rutas de §3, mismo
  mecanismo manual que 002 (curl con cookie de sesión de un `admin_acueducto` de prueba) — si el
  contenedor de turno no tiene Docker/PostgREST (como este), se declara explícitamente "NO
  VERIFICADO" con los pasos exactos, igual que 002 T-004/T-005.
- **Manual (requiere Mateo):** CA-6 (paneles en navegador real) si el entorno no permite
  `wrangler dev` + `next dev` simultáneos contra una base real.
