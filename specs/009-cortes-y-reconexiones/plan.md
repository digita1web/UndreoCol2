# PLAN — 009: cortes-y-reconexiones

**Spec aprobado:** 2026-09-04 (7 criterios de aceptación; alcance reducido — opción a de spec.md §5 — aprobado explícitamente por Mateo)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` ni código hasta esa aprobación.

---

## 0. Punto de partida

Reutilizado sin tocar (verificado contra el código y el esquema reales, no supuesto):

- `configuracion.dias_umbral_corte` (default 60), `configuracion.valor_reconexion` (default 0),
  `configuracion.prefijo_reconexion` (default `'REC'`), `configuracion.dias_vencimiento` (default
  30) — las cuatro ya existen desde 001.
- `estado_suscriptor` ya incluye `'cortado'` (001).
- `tipo_factura` ya incluye `'reconexion'` (005); `facturas.periodo_id` ya es nullable para
  facturas fuera de ciclo (005, comentario `-- null en reconexion/ajuste fuera de ciclo`).
- `siguiente_numero_factura(p_cliente_id, p_prefijo)` (005): genérica, ya otorgada a
  `authenticated` — se reutiliza con `p_prefijo = configuracion.prefijo_reconexion` sin
  modificarla.
- `backend/src/lib/facturacion.ts:136` y `backend/src/queues/cierre-facturacion.ts:86`: el filtro
  `estado = 'activo'` que saca al `cortado` del ciclo normal **ya está implementado** — 009 no
  toca ninguno de los dos archivos.
- `obtenerCartera()` (007, `backend/src/lib/pagos.ts`): da `vencida` y `diasMoraMax` por
  suscriptor — 009 la llama tal cual para candidatos a corte y para bloquear reconexión.
- `bloquear_factura_inmutable()`/`trg_factura_detalles_recalcula()` (005): el `INSERT` de una
  factura y sus `factura_detalles` siempre está permitido; el trigger recalcula
  `subtotal_servicios`/`total` a partir de la suma de `factura_detalles.subtotal` — la factura de
  reconexión necesita **al menos un renglón** en `factura_detalles` para que el total no quede en
  cero.
- Patrón de RPC `SECURITY INVOKER` + `SELECT FOR UPDATE` + motivo obligatorio de `anular_pago()`
  (007) — se replica para `registrar_corte()`/`reconectar()`.
- Patrón de política RLS estándar (lectura miembros del cliente, escritura `admin_acueducto`) para
  la tabla de historial nueva.

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260911090000_cortes-reconexiones.sql` | crear | Tabla `cortes_reconexiones`, `registrar_corte()`, `reconectar()`, RLS |
| `backend/src/lib/cortes.ts` | crear | Candidatos a corte (vía `obtenerCartera()`), RPCs de corte/reconexión, historial |
| `backend/src/index.ts` | editar | Rutas `/cortes/*` y `/suscriptores/:id/corte` `/suscriptores/:id/reconexion` `/suscriptores/:id/historial-cortes` |
| `tests/fixtures/cortes.sql` | crear | Datos de ejemplo para el test de aislamiento |
| `tests/aislamiento/009_cortes_aislamiento.sql` | crear | CA-2, CA-3 (regresión) |
| `frontend/lib/api.ts` | editar | Funciones de cortes/reconexiones |
| `frontend/app/app/cortes/page.tsx` | crear | Panel de candidatos a corte |
| `frontend/components/corte-form.tsx`, `frontend/components/reconexion-form.tsx` | crear | Acciones desde el detalle del suscriptor |
| `frontend/app/app/suscriptores/[id]/page.tsx` | editar | Botón cortar/reconectar + historial (mismo lugar que contador/reemplazos) |
| `CHANGELOG.md` | editar | Cierre de la feature |

No hay `core/` nuevo (plan.md spec §4 lo confirma): no hay cálculo de dinero propio de esta
feature — el monto de reconexión es un valor de configuración directo, y la deuda vencida ya la
calcula `core/pagos.ts` vía `obtenerCartera()`.

## 2. Esquema de base de datos

### Migración

| Archivo | Contenido |
|---|---|
| `20260911090000_cortes-reconexiones.sql` | Tabla `cortes_reconexiones`; funciones `registrar_corte()` y `reconectar()`; RLS `FORCE` + políticas |

### Tabla

```sql
create type tipo_evento_corte as enum ('corte', 'reconexion');

create table cortes_reconexiones (
  id                          uuid primary key default gen_random_uuid(),
  cliente_id                  uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id         uuid not null references usuarios_servicio(id) on delete restrict,
  tipo                        tipo_evento_corte not null,
  fecha                       date not null default current_date,
  motivo                      text not null,
  responsable                 uuid not null references perfiles(id),
  deuda_vencida_al_reconectar numeric(12,2), -- solo tipo='reconexion' con excepción; null si no aplica
  factura_reconexion_id       uuid references facturas(id), -- solo tipo='reconexion'
  created_at                  timestamptz not null default now()
);

create index on cortes_reconexiones (cliente_id, usuario_servicio_id, fecha desc);
```

`motivo` y `responsable` son `not null` a nivel de esquema, no solo validados en la función — un
registro de corte/reconexión sin motivo o sin responsable es un error de integridad de la tabla,
no solo de la API (mismo criterio de rigor que `facturas.motivo_anulacion`/`anulada_por` en la
anulación, aunque ahí son nullable porque no toda factura se anula; aquí toda fila de esta tabla
**es** un evento de corte o reconexión, así que siempre los necesita).

### Políticas RLS

```sql
create policy cortes_reconexiones_lectura on cortes_reconexiones for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy cortes_reconexiones_escritura on cortes_reconexiones for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
```

Ningún endpoint expone `DELETE` — el historial es permanente, igual criterio que
`reemplazos_contador` (003) y `pago_aplicaciones` (007).

### Funciones

```sql
create or replace function registrar_corte(
  p_usuario_servicio_id uuid,
  p_motivo              text,
  p_perfil              uuid
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_id uuid;
  v_estado     estado_suscriptor;
  v_id         uuid;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo del corte es obligatorio';
  end if;

  select cliente_id, estado into v_cliente_id, v_estado
    from usuarios_servicio where id = p_usuario_servicio_id
    for update;
  if v_cliente_id is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if not es_admin_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;
  if v_estado = 'cortado' then
    raise exception 'El suscriptor ya está cortado';
  end if;

  update usuarios_servicio set estado = 'cortado' where id = p_usuario_servicio_id;

  insert into cortes_reconexiones (cliente_id, usuario_servicio_id, tipo, motivo, responsable)
  values (v_cliente_id, p_usuario_servicio_id, 'corte', btrim(p_motivo), p_perfil)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function reconectar(
  p_usuario_servicio_id  uuid,
  p_deuda_vencida        numeric,   -- calculada por el caller (obtenerCartera(), lib/) para este suscriptor
  p_motivo_excepcion     text,      -- NULL si no hay deuda vencida; obligatorio si p_deuda_vencida > 0
  p_perfil               uuid
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_cliente_id  uuid;
  v_estado      estado_suscriptor;
  v_numero      text;
  v_prefijo     text;
  v_dias_venc   integer;
  v_valor       numeric(12,2);
  v_factura_id  uuid;
  v_evento_id   uuid;
begin
  if p_deuda_vencida > 0 and (p_motivo_excepcion is null or btrim(p_motivo_excepcion) = '') then
    raise exception 'Hay deuda vencida: el motivo de excepción es obligatorio para reconectar';
  end if;

  select cliente_id, estado into v_cliente_id, v_estado
    from usuarios_servicio where id = p_usuario_servicio_id
    for update;
  if v_cliente_id is null then
    raise exception 'Suscriptor % no existe', p_usuario_servicio_id;
  end if;
  if not es_admin_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;
  if v_estado <> 'cortado' then
    raise exception 'El suscriptor no está cortado';
  end if;

  select prefijo_reconexion, dias_vencimiento, valor_reconexion
    into v_prefijo, v_dias_venc, v_valor
    from configuracion where cliente_id = v_cliente_id;

  v_numero := siguiente_numero_factura(v_cliente_id, v_prefijo);

  insert into facturas (cliente_id, usuario_servicio_id, periodo_id, tipo, numero,
                         snapshot_suscriptor, fecha_vencimiento)
  select v_cliente_id, p_usuario_servicio_id, null, 'reconexion', v_numero,
         jsonb_build_object('nombre', u.nombre, 'codigo_suscriptor', u.codigo_suscriptor,
                             'direccion', u.direccion, 'categoria', u.categoria),
         current_date + v_dias_venc
    from usuarios_servicio u where u.id = p_usuario_servicio_id
  returning id into v_factura_id;

  insert into factura_detalles (cliente_id, factura_id, servicio_id, tarifa_id, orden,
                                 descripcion, tipo_calculo, cargo_fijo, subtotal)
  values (v_cliente_id, v_factura_id, null, null, 1,
          'Cargo de reconexión', 'fijo', v_valor, v_valor);
  -- trg_factura_detalles_recalcula (005) recalcula subtotal_servicios/total de la
  -- factura a partir de este renglón — no se asignan a mano aquí (CLAUDE.md §10 punto 12/§5.6).

  update usuarios_servicio set estado = 'activo' where id = p_usuario_servicio_id;

  insert into cortes_reconexiones (cliente_id, usuario_servicio_id, tipo, motivo, responsable,
                                    deuda_vencida_al_reconectar, factura_reconexion_id)
  values (v_cliente_id, p_usuario_servicio_id, 'reconexion',
          coalesce(btrim(p_motivo_excepcion), 'Sin deuda vencida'), p_perfil,
          nullif(p_deuda_vencida, 0), v_factura_id)
  returning id into v_evento_id;

  return v_evento_id;
end;
$$;

revoke execute on function registrar_corte(uuid, text, uuid) from anon, public;
grant  execute on function registrar_corte(uuid, text, uuid) to authenticated;
revoke execute on function reconectar(uuid, numeric, text, uuid) from anon, public;
grant  execute on function reconectar(uuid, numeric, text, uuid) to authenticated;
```

`p_deuda_vencida` la calcula el llamador (`lib/cortes.ts`, con `obtenerCartera()` de 007) y se
pasa a la función — la función **no** vuelve a calcular la cartera dentro de la transacción.
Justificación en §5.

`motivo` de una reconexión sin deuda vencida se guarda como `'Sin deuda vencida'` (no `NULL`,
porque la columna es `not null`) — es informativo, no una excepción real; se distingue de una
excepción real por `deuda_vencida_al_reconectar is not null`.

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| GET | `/cortes/candidatos` | sesión admin | Suscriptores activos con `diasMoraMax >= dias_umbral_corte` (via `obtenerCartera()` + config del cliente) |
| POST | `/suscriptores/:id/corte` | sesión admin, `admin_acueducto` (RLS) | Llama `registrar_corte()` |
| POST | `/suscriptores/:id/reconexion` | sesión admin, `admin_acueducto` (RLS) | Calcula deuda vencida vía `obtenerCartera()`, llama `reconectar()` |
| GET | `/suscriptores/:id/historial-cortes` | sesión admin | Lee `cortes_reconexiones` del suscriptor |

Todas resuelven el cliente activo con `resolverClienteActivo()` (reutilizado, mismo patrón que
002/003/007).

## 4. Contratos de `core/`

Ninguno (§1). El monto de reconexión es un valor de configuración directo (`configuracion.
valor_reconexion`), no un cálculo; la deuda vencida ya la calcula `core/pagos.ts` a través de
`obtenerCartera()` de 007.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `p_deuda_vencida` se calcula en `lib/cortes.ts` (TypeScript) y se pasa a `reconectar()`, la función no la recalcula en SQL | Calcular la cartera vencida dentro de la función SQL | `obtenerCartera()` (007) ya es la única fuente de verdad del cálculo de deuda vencida (paginación, saldo a favor, etc.); reimplementarlo en SQL duplicaría la lógica y podría desincronizarse silenciosamente de la cartera real que ve el admin en `/app/pagos` |
| `reconectar()` es `SECURITY INVOKER` con `SELECT FOR UPDATE` sobre `usuarios_servicio`, igual que `registrar_corte()` | `SECURITY DEFINER` | Mismo criterio que `reemplazar_contador()`/`crear_tarifa_version()`: no necesita saltarse RLS, el llamante ya tiene permiso de escritura por política — se mantiene mínima la superficie de funciones que se saltan RLS |
| `cortes_reconexiones.motivo`/`.responsable` son `NOT NULL` a nivel de esquema | Nullable, validado solo en la función | Cada fila de esta tabla **es** un evento de corte o reconexión — a diferencia de `facturas.motivo_anulacion` (nullable porque no toda factura se anula), aquí no existe un evento válido sin motivo ni responsable; el esquema debe rechazarlo, no solo la función |
| La factura de reconexión lleva un único renglón en `factura_detalles` con `servicio_id`/`tarifa_id` en `NULL` | Crear un "servicio" sintético de reconexión en `servicios` para que el renglón tenga una referencia real | Un servicio de catálogo (002) representa algo que un acueducto factura por consumo/ciclo; la reconexión es un cargo independiente (`tipo_factura.reconexion`, ya modelado así en 005) — inventar un servicio de catálogo solo para tener una FK no nula sería forzar un concepto que no aplica (`docs/esquema-propuesto.sql` ya deja `servicio_id`/`tarifa_id` nullable en `factura_detalles` con comentario "referencia permanente", compatible con este caso) |
| `GET /cortes/candidatos` reutiliza `obtenerCartera()` completa (trae todas las filas con deuda) y filtra en TypeScript por `diasMoraMax >= umbral`, en vez de una consulta SQL nueva | Una función SQL separada solo para candidatos a corte | Mismo patrón que `obtenerCartera({ soloMorosos: true })` ya usa para su propio filtro — para el tamaño de un acueducto piloto (~1000 suscriptores) filtrar en memoria es trivial y evita mantener dos consultas que calculan lo mismo con criterios ligeramente distintos |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

Ninguna ruta procesa lotes. `GET /cortes/candidatos` reutiliza `obtenerCartera()`, ya diseñada
para el tamaño de un acueducto piloto (007). CRUD/RPC de una fila para el resto. Irrelevante para
esta feature.

## 8. Estrategia de pruebas

- **Unitarias (`core/`):** ninguna — no hay `core/` nuevo (§4).
- **Aislamiento (RLS):** `tests/aislamiento/009_cortes_aislamiento.sql`, mismo mecanismo que
  001-008. Cubre explícitamente (CA-2):
  - Acueducto A no lee/escribe `cortes_reconexiones` de B.
  - `registrar_corte()`/`reconectar()` llamadas por admin A sobre un `usuario_servicio_id` de B
    fallan con "no existe" (mismo comportamiento de RLS + `SELECT FOR UPDATE` verificado en 002 y
    003: la fila ajena es invisible antes del chequeo `es_admin_de()`).
  - Rol `lector` no puede llamar ninguna de las dos funciones.
  - `registrar_corte()` sobre un suscriptor ya `cortado` falla explícitamente.
  - `reconectar()` sobre un suscriptor `activo` (no cortado) falla explícitamente.
  - `reconectar()` con `p_deuda_vencida > 0` y sin `p_motivo_excepcion` falla; con motivo, se
    acepta y la factura de reconexión queda creada con el monto correcto.
  - **CA-3 (regresión, no algo que 009 deba volver a implementar):** tras cortar un suscriptor,
    `backend/src/lib/facturacion.ts` y `backend/src/queues/cierre-facturacion.ts` siguen
    excluyéndolo por `estado = 'activo'` — se verifica leyendo esos archivos y confirmando que el
    filtro sigue ahí, no se toca ni se re-testea con un cierre real (eso ya lo cubre la suite de
    005).
- **Integración:** peticiones HTTP reales contra `wrangler dev` para las 4 rutas de §3, mismo
  mecanismo manual que 002/003 — si el entorno de turno no tiene Docker/PostgREST, se declara "NO
  VERIFICADO" con los pasos exactos.
- **Manual (requiere Mateo):** CA-7 (panel de candidatos y acciones en el detalle del suscriptor en
  navegador real) si el entorno no permite `wrangler dev` + `next dev` simultáneos contra una base
  real.
