# PLAN — 002: catalogo-y-tarifas

**Spec aprobado:** 2026-09-01 (7 criterios de aceptación, ver `spec.md`)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` ni código hasta esa aprobación.

---

## 0. Punto de partida

`supabase/migrations/20260831150000_fundacion-tenancy.sql` ya trae, de la
fundación, lo que 002 reutiliza sin tocar:

- Tipos `rol_usuario` (3 valores), `estado_cuenta`, `estado_suscriptor`.
- Tabla `usuarios_servicio` — **versión mínima de 001, sin `categoria`, sin
  `contador_id`**, solo para el test de aislamiento de la fundación. 002 no
  la modifica; la amplía la feature 003 (fuera de este alcance).
- Funciones `SECURITY DEFINER`: `es_admin_plataforma()`, `mis_clientes()`,
  `tiene_rol(cliente_id, roles[])`, `es_admin_de(cliente_id)`. 002 las
  reutiliza tal cual para las políticas RLS de `servicios` y `tarifas` — no
  se crean funciones de seguridad nuevas.
- Patrón de política estándar (`configuracion_lectura` /
  `configuracion_escritura`, `usuarios_servicio_lectura` /
  `_escritura`): lectura para miembros del cliente o plataforma, escritura
  restringida a `es_admin_de(cliente_id)`. 002 replica exactamente este
  patrón para `servicios` y `tarifas`.
- Backend: un único `Hono` en `backend/src/index.ts`, `crearClienteSuscriptor(env, accessToken)` para toda ruta que atiende usuario, `verificarSesionAdministrativa(c)` como guardia de sesión.
- Frontend: `middleware.ts` protege `/app/*` por presencia de cookie;
  `lib/api.ts` es el único punto de contacto con el backend (nunca
  `@supabase/*` directo).

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260901120000_catalogo-y-tarifas.sql` | crear | Enums `categoria_tarifaria`/`tipo_calculo`, tablas `servicios`/`tarifas`, función `tarifa_vigente()`, trigger `updated_at` en `servicios`, RLS `FORCE` + políticas |
| `backend/src/core/tarifas.ts` | crear | Cálculo puro del subtotal por servicio (D-1) |
| `backend/tests/unit/tarifas.test.ts` | crear | Casos límite de CA-5 |
| `backend/src/lib/catalogo.ts` | crear | Funciones de acceso a datos para las rutas de catálogo (listar/crear servicio, crear tarifa con cierre atómico, matriz de tarifas) — capa fina sobre Supabase, no lógica de negocio |
| `backend/src/index.ts` | editar | Añade las rutas `GET/POST/PATCH /catalogo/servicios`, `POST/GET /catalogo/tarifas`, `GET /catalogo/matriz-tarifas` |
| `tests/fixtures/catalogo.sql` | crear | Dos acueductos, servicios y tarifas de ejemplo (marcadas explícitamente como provisionales, D-5) para el test de aislamiento |
| `tests/aislamiento/002_catalogo_aislamiento.sql` | crear | CA-2, CA-6 |
| `frontend/app/app/catalogo/page.tsx` | crear | Lista de servicios + alta + activar/desactivar |
| `frontend/app/app/catalogo/[servicioId]/page.tsx` | crear | Historial de tarifas del servicio + formulario de tarifa nueva por categoría |
| `frontend/lib/api.ts` | editar | Funciones `listarServicios`, `crearServicio`, `actualizarServicio`, `listarTarifas`, `crearTarifa`, `matrizTarifas` |
| `CHANGELOG.md` | editar | Cierre de la feature |

## 2. Esquema de base de datos

### Migraciones

| Archivo | Contenido |
|---|---|
| `20260901120000_catalogo-y-tarifas.sql` | Enums `categoria_tarifaria` (`estrato_1`..`estrato_6`, `comercial`, `industrial`, `oficial`) y `tipo_calculo` (`por_consumo`, `fijo`); tablas `servicios`, `tarifas` (DDL de `docs/esquema-propuesto.sql §6`, sin cambios); función `tarifa_vigente(servicio_id, categoria, fecha)`; función `crear_tarifa_version(servicio_id, categoria, cargo_fijo, limite_basico_m3, precio_basico_m3, precio_no_basico_m3)` — nueva, no está en `docs/esquema-propuesto.sql`, necesaria para CA-4/CA-6 (ver §5); trigger `updated_at` en `servicios` (reutiliza `trigger_updated_at()` de 001, `tarifas` no lleva `updated_at`: una fila de tarifa nunca se actualiza); `alter table ... force row level security` + políticas en ambas tablas |

### Tablas

DDL exactamente como `docs/esquema-propuesto.sql` líneas 179–247 (`servicios`,
`tarifas`, `tarifa_vigente()`), con dos adiciones sobre esa referencia:

```sql
alter table servicios add column updated_at timestamptz not null default now();
-- (docs/esquema-propuesto.sql no la trae; se necesita para CLAUDE.md §7 —
-- consistencia con el resto de tablas tenantizadas editables — y el trigger
-- ya existente trigger_updated_at() de 001 la requiere.)
```

```sql
create or replace function crear_tarifa_version(
  p_servicio_id         uuid,
  p_categoria           categoria_tarifaria,
  p_cargo_fijo          numeric,
  p_limite_basico_m3    numeric,
  p_precio_basico_m3    numeric,
  p_precio_no_basico_m3 numeric
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_tarifa_anterior_id uuid;
  v_nueva_id uuid;
begin
  select cliente_id into v_cliente_id from servicios where id = p_servicio_id;
  if v_cliente_id is null then
    raise exception 'Servicio % no existe', p_servicio_id;
  end if;
  if not es_admin_de(v_cliente_id) then
    raise exception 'No autorizado';
  end if;

  -- SELECT FOR UPDATE sobre la tarifa vigente: mismo patrón que el
  -- consecutivo de factura (CLAUDE.md §10, punto 9b) para que dos
  -- peticiones concurrentes de cambio de precio no dejen dos tarifas
  -- activas (CA-6).
  select id into v_tarifa_anterior_id
    from tarifas
    where servicio_id = p_servicio_id and categoria = p_categoria
      and vigencia_hasta is null
    for update;

  if v_tarifa_anterior_id is not null then
    update tarifas set vigencia_hasta = current_date - 1
      where id = v_tarifa_anterior_id;
  end if;

  insert into tarifas (cliente_id, servicio_id, categoria, vigencia_desde,
                        cargo_fijo, limite_basico_m3, precio_basico_m3,
                        precio_no_basico_m3)
  values (v_cliente_id, p_servicio_id, p_categoria, current_date,
          p_cargo_fijo, p_limite_basico_m3, p_precio_basico_m3,
          p_precio_no_basico_m3)
  returning id into v_nueva_id;

  return v_nueva_id;
end;
$$;

revoke execute on function crear_tarifa_version(uuid, categoria_tarifaria, numeric, numeric, numeric, numeric) from anon, public;
grant  execute on function crear_tarifa_version(uuid, categoria_tarifaria, numeric, numeric, numeric, numeric) to authenticated;
```

`security invoker` (no `security definer`, a diferencia de `tarifa_vigente()`):
corre con los permisos del usuario autenticado, así que además de la
autorización explícita con `es_admin_de()` dentro de la función, las
políticas RLS de `servicios`/`tarifas` también aplican — doble barrera,
igual criterio que `crear_tenant_con_admin()` en 001 salvo que aquella sí
necesita `security definer` para poder insertar en `membresias` antes de
que exista la membresía que la propia política de RLS exigiría (caso que
aquí no se da: el usuario ya es `admin_acueducto` del cliente antes de
llamar esta función).

`vigencia_desde is not null and vigencia_hasta is null` identifica la
tarifa vigente sin usar `tarifa_vigente(..., current_date)` dentro de la
función — evita depender de la zona horaria en el cálculo de "hoy" de dos
formas distintas dentro de la misma transacción.

### Políticas RLS

Mismo patrón que `configuracion`/`usuarios_servicio` en 001:

```sql
create policy servicios_lectura on servicios for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy servicios_escritura on servicios for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy tarifas_lectura on tarifas for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy tarifas_escritura on tarifas for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
```

`tarifas_escritura` cubre el `insert`/`update` que hace
`crear_tarifa_version()` (por ser `security invoker`, corre como el usuario
llamante y las políticas aplican). No se expone ningún `DELETE` de tarifas
desde la API — ninguna política ni ruta lo permite (CLAUDE.md §10, punto 0d).

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| GET | `/catalogo/servicios` | sesión admin | Lista servicios del acueducto activo |
| POST | `/catalogo/servicios` | sesión admin, `admin_acueducto` (RLS) | Crea un servicio |
| PATCH | `/catalogo/servicios/:id` | sesión admin, `admin_acueducto` (RLS) | Edita nombre/orden/`facturable_en_ciclo`/`activo` (nunca `codigo` ni `tipo_calculo` tras creación — ver §5) |
| GET | `/catalogo/tarifas?servicio_id=&categoria=` | sesión admin | Historial completo de tarifas de un servicio+categoría |
| POST | `/catalogo/tarifas` | sesión admin, `admin_acueducto` (RLS + función) | Llama `crear_tarifa_version()` — cierra la vigente y crea la nueva |
| GET | `/catalogo/matriz-tarifas` | sesión admin | Servicio × categoría con la tarifa vigente de cada combinación (o null) |

Todas resuelven el cliente activo con `resolverClienteActivo()` (ya existe
en `backend/src/lib/tenant.ts`, reutilizado tal cual) y devuelven 400 si el
usuario no tiene acueducto activo — mismo patrón que `GET /dashboard`.

## 4. Contratos de core/

```ts
// backend/src/core/tarifas.ts
export type TipoCalculo = 'por_consumo' | 'fijo';

export interface Tarifa {
  cargoFijo: number;
  limiteBasicoM3: number;
  precioBasicoM3: number;
  precioNoBasicoM3: number;
}

// Fórmula D-1. limiteBasicoM3 es INCLUSIVO.
// tipoCalculo 'fijo' ignora consumoM3 y devuelve solo cargoFijo.
export function calcularSubtotalServicio(
  tipoCalculo: TipoCalculo,
  tarifa: Tarifa,
  consumoM3: number,
): number;
```

Sin dependencias de Hono/Cloudflare/Supabase (CLAUDE.md §5.3). Redondeo a
la unidad de peso colombiano (CLAUDE.md §5.6) se aplica **una sola vez**,
al final, dentro de esta función — no en cada término ni en el llamador.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `crear_tarifa_version()` como función `plpgsql` en la migración (no una transacción armada a mano en `backend/src/lib/catalogo.ts`) | Hacer el `SELECT ... FOR UPDATE` + `UPDATE` + `INSERT` desde el Worker con el cliente de Supabase | PostgREST/Supabase-js no expone transacciones multi-statement desde el cliente; sin una función de base de datos, la ventana entre cerrar la anterior y crear la nueva no sería atómica (CA-6) — mismo motivo que `crear_tenant_con_admin()` en 001 |
| `crear_tarifa_version()` es `security invoker`, no `security definer` | `security definer` como `tarifa_vigente()` | No necesita saltarse RLS para leer/escribir — el usuario ya tiene permiso de escritura en `tarifas` por política; usar `invoker` mantiene la superficie de funciones "que se saltan RLS" al mínimo (regla implícita de CLAUDE.md §5.4: RLS es la autorización, no una capa decorativa) |
| `PATCH /catalogo/servicios/:id` no permite cambiar `codigo` ni `tipo_calculo` tras la creación | Permitir edición completa | Una tarifa referencia el servicio por FK; cambiar `tipo_calculo` de `por_consumo` a `fijo` con tarifas históricas ya creadas dejaría columnas de esas tarifas (`limite_basico_m3`, etc.) sin sentido retroactivamente. Se resuelve dando de baja el servicio y creando uno nuevo si el acueducto realmente cambia el tipo de un servicio |
| Eliminación física de un servicio solo si no tiene tarifas asociadas; si las tiene, solo `activo = false` | Prohibir siempre el DELETE físico | El spec (§3.1) permite borrar un servicio creado por error antes de tener tarifas; una vez tiene tarifas, la FK `tarifas.servicio_id references servicios(id) on delete cascade` haría un borrado en cascada silencioso — inaceptable (CLAUDE.md §10, punto 0d aplicado también al servicio, no solo a la tarifa). La ruta `PATCH` nunca expone DELETE; si en el futuro se necesita, es una tarea aparte con su propio CA |
| Datos de ejemplo de `tests/fixtures/catalogo.sql` explícitamente comentados como "NO son las tarifas reales de ningún acueducto (D-5, pendiente)" | Usar los valores de Soacha de `docs/esquema-propuesto.sql`/ESPECIFICACION-FUNCIONAL.md §2.4 tal cual, sin advertencia | D-5 dice que esos valores son aproximados y no verificados; repetirlos sin la advertencia en un fixture de test es exactamente el tipo de dato que podría filtrarse como "definitivo" a `docs/CASOS-DORADOS.md` más adelante |

## 6. Dependencias nuevas

Ninguna. Todo lo que usa 002 (Hono, `@supabase/supabase-js`, `vitest`,
Next.js, Tailwind, shadcn/ui) ya está instalado desde 001.

## 7. Límites de Cloudflare Workers a considerar

Ninguna ruta de 002 procesa lotes ni archivos: todas son CRUD de una fila o
un listado acotado a un acueducto (decenas de servicios/tarifas como
máximo). CPU e invocación fetch estándar (30s) sobran de sobra —
irrelevante para esta feature, no hay Queue ni Cron nuevo.

## 8. Estrategia de pruebas

- **Unitarias (`core/`):** `backend/tests/unit/tarifas.test.ts` con
  `vitest run` — casos de CA-5: límite exacto, límite−1, límite+1, consumo
  0, `tipo_calculo = 'fijo'` (ignora `consumo_m3`), redondeo a la unidad.
- **Aislamiento (RLS):** `tests/aislamiento/002_catalogo_aislamiento.sql`,
  mismo mecanismo que 001 (`set local role`, `set local
  request.jwt.claim.sub`, rollback por escenario). Cubre explícitamente
  (CA-2):
  - Acueducto A no lee servicios/tarifas de B por `SELECT` directo.
  - Acueducto A no lee la tarifa vigente de B llamando `tarifa_vigente()`
    con un `servicio_id` de B adivinado directamente (la función es
    `security definer`: el test verifica que igual devuelve NULL o error
    para un llamante sin membresía en B, no que "la tabla está protegida").
  - `admin_acueducto` de A no puede llamar `crear_tarifa_version()` sobre
    un `servicio_id` de B (la función debe fallar con "No autorizado").
  - Rol `lector` no puede escribir en `servicios` ni `tarifas` (solo
    lectura).
  - CA-6: dos llamadas concurrentes a `crear_tarifa_version()` para el
    mismo servicio+categoría (simuladas con dos transacciones que se
    intercalan alrededor del `FOR UPDATE`) terminan en una sola tarifa
    vigente, nunca dos.
- **Integración:** peticiones HTTP reales contra `wrangler dev` para las 6
  rutas de §3 (CA-3, CA-4), con el `access_token` de un usuario de prueba
  con membresía `admin_acueducto` — mismo mecanismo manual que documentó
  001 en `tasks.md` T-011/T-012 (este contenedor no tiene el CLI de
  `supabase`, así que la corrida contra base real depende de que Mateo la
  ejecute si no se puede levantar `wrangler dev` con `supabase start`
  local).
- **Manual (requiere Mateo):** CA-7 (panel `/app/catalogo` en navegador
  real) si el contenedor no permite levantar `wrangler dev` + `next dev`
  simultáneos contra una base real — se declara "NO VERIFICADO" con los
  pasos exactos, igual que T-012 de 001.
