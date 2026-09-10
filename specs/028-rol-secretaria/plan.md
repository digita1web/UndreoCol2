# PLAN — 028: rol-secretaria

**Spec aprobado:** 2026-09-10
**Corrección de implementación aprobada:** 2026-09-10 — además de RLS, las funciones SECURITY INVOKER que escriben durante el flujo deben aceptar el rol `secretaria` explícitamente.

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260923090000_rol-secretaria.sql` | Nuevo | `rol_usuario` +`secretaria`, `es_staff_de()`, políticas nuevas/ajustadas, trigger de `facturas` actualizado |
| `backend/src/index.ts` | Modificado | Guards explícitos `ctx.rol === 'admin_acueducto'` en anulación de factura/pago y ejecución de corte/reconexión |
| `frontend/components/panel/sidebar-panel.tsx` | Modificado | Oculta "Configuración" cuando `rol === 'secretaria'` |
| `frontend/app/app/pagos/page.tsx`, `.../[suscriptorId]/page.tsx` | Modificado | Mantiene el registro de pagos y oculta "Anular pago" para `secretaria` |
| `frontend/app/app/facturacion/page.tsx` | Modificado | Oculta simulación/emisión masiva para `secretaria`; mantiene consulta y correo |
| `frontend/app/app/facturacion/[facturaId]/page.tsx` | Modificado | Oculta "Anular factura" y "Anular pago" para `secretaria` |
| `frontend/app/app/suscriptores/[id]/page.tsx` | Modificado | Oculta corte/reconexión; mantiene la gestión administrativa del suscriptor y contador |
| `frontend/app/app/lecturas/page.tsx` | Modificado | Oculta "Marcar revisada" para `secretaria`; mantiene lectura y carga manual |
| `tests/aislamiento/015_rol_secretaria_aislamiento.sql` | Nuevo | Toda la matriz de §3.2 del spec, contra PostgreSQL real |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

## 2. Esquema de base de datos

### `rol_usuario` y función helper

```sql
alter type rol_usuario add value 'secretaria';

create or replace function es_staff_de(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin_plataforma()
      or tiene_rol(p_cliente_id, array['admin_acueducto']::rol_usuario[])
      or exists (
        select 1 from membresias
        where perfil_id = auth.uid() and cliente_id = p_cliente_id
          and activo and rol::text = 'secretaria'
      );
$$;
```
La comparación de `rol::text` es deliberada: PostgreSQL no permite usar el nuevo valor de un
enum dentro de una función creada en la misma transacción que hace `ALTER TYPE ... ADD VALUE`.
`es_admin_de()` no se toca — sigue siendo exclusivamente `admin_acueducto` + superadmin.

### Solo lectura ampliada a staff (política SELECT nueva; la escritura existente no cambia)

```sql
create policy facturas_staff_lectura on facturas for select using (es_staff_de(cliente_id));
create policy factura_detalles_staff_lectura on factura_detalles for select using (es_staff_de(cliente_id));
create policy tarifas_staff_lectura on tarifas for select using (es_staff_de(cliente_id));
create policy cortes_reconexiones_staff_lectura on cortes_reconexiones for select using (es_staff_de(cliente_id));
create policy notificaciones_staff_lectura on notificaciones for select using (es_staff_de(cliente_id));
```

### Lectura + escritura ampliada a staff (se amplía la condición de la política de escritura ya existente — nada delicado que reservar solo para `admin_acueducto` dentro de estas tablas)

```sql
alter policy usuarios_servicio_escritura on usuarios_servicio
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));
alter policy importaciones_suscriptores_escritura on importaciones_suscriptores
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));
alter policy reemplazos_contador_escritura on reemplazos_contador
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));
```

### `pagos`/`pago_aplicaciones`: registrar sí, anular no

Investigado (`pg_proc.prosrc`): `registrar_pago()` inserta en `pagos` y `pago_aplicaciones`, y
actualiza `facturas.total_pagado` — es `SECURITY INVOKER`, así que el que llama necesita los tres
permisos. `anular_pago()` actualiza `pagos` (estado) y `facturas` (revierte `total_pagado`), también
`INVOKER`. Se separa `INSERT` de `UPDATE`/`DELETE` en vez de dejar una sola política `ALL`:

```sql
create policy pagos_staff_lectura on pagos for select using (es_staff_de(cliente_id));
create policy pagos_staff_insert on pagos for insert with check (es_staff_de(cliente_id));
-- pagos_admin (existente) se acota de ALL a UPDATE/DELETE — solo admin_acueducto anula
alter policy pagos_admin on pagos for update, delete using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));

create policy pago_aplicaciones_staff_lectura on pago_aplicaciones for select using (es_staff_de(cliente_id));
create policy pago_aplicaciones_staff_insert on pago_aplicaciones for insert with check (es_staff_de(cliente_id));
```
Además, `registrar_pago()` se redefine para usar `es_staff_de(p_cliente_id)` en su guarda interna.
`anular_pago()` conserva `es_admin_de(p_cliente_id)`.

Las funciones `importar_suscriptores()` y `reemplazar_contador()` también se redefinen con
`es_staff_de()`: ambas son SECURITY INVOKER y su guarda interna habría bloqueado a `secretaria`
aunque RLS permitiera el acceso. La política de `contadores` se amplía a staff porque el reemplazo
actualiza el contador anterior, inserta el nuevo y cambia `usuarios_servicio.contador_actual_id`.

### `facturas.total_pagado`: por qué no es un `GRANT` de columna (a diferencia de 023)

`023` restringió `clientes.color_acento` con un `GRANT` de columna porque esa distinción era por
**tabla completa** (el lector no tenía ningún otro motivo para tocar `clientes`). Acá no sirve: un
`GRANT`/`REVOKE` de columna aplica al **rol de Postgres** `authenticated`, que es el mismo para
`admin_acueducto` y `secretaria` — no puede darle a uno más columnas que al otro. La distinción real
("secretaria solo mueve `total_pagado`/`pdf_url`, nunca anula") ya la hace el trigger
`bloquear_factura_inmutable` (verifica qué cambió, no quién lo cambió) — se le agrega la comprobación
de rol **solo** en la rama de anulación, que es la única acción de las que hoy permite que de verdad
requiere ser exclusiva de `admin_acueducto`:

```sql
create policy facturas_staff_actualiza on facturas for update
  using (es_staff_de(cliente_id)) with check (es_staff_de(cliente_id));
-- (el trigger sigue bloqueando cambios a total/numero/etc. para cualquiera, sin cambios)

-- dentro de bloquear_factura_inmutable(), en la rama de anulación:
--   if new.estado = 'anulada' and old.estado <> 'anulada' then
--     if not es_admin_de(new.cliente_id) then
--       raise exception 'Solo el administrador del acueducto puede anular una factura';
--     end if;
--     if new.motivo_anulacion is null or new.motivo_anulacion = '' then ... end if;
--     return new;
--   end if;
```
Con esto: `secretaria` puede registrar un pago (toca `total_pagado`, permitido) y generar/servir el
PDF (toca `pdf_url`, permitido), pero si intenta anular (`estado = 'anulada'`), el trigger la
rechaza por rol antes de llegar siquiera a pedir el motivo.

## 3. Rutas de la API (Hono)

| Ruta | Cambio |
|---|---|
| `POST /facturas/:id/anular` | + guard `ctx.rol === 'admin_acueducto'` → `403` explícito (RLS/trigger ya lo bloquean; esto da un mensaje claro en vez del error crudo de Postgres) |
| `POST /pagos/:id/anular` | + mismo guard, mismo motivo |
| `POST /suscriptores/:id/corte` | + guard `ctx.rol === 'admin_acueducto'` → `403` explícito |
| `POST /suscriptores/:id/reconexion` | + guard `ctx.rol === 'admin_acueducto'` → `403` explícito |
| El resto de rutas ya tocadas (`GET /dashboard/indicadores`, las 4 de facturación por cola de 024, `PATCH /acueducto/color`) | Sin cambios — ya exigen `admin_acueducto` explícito, `secretaria` queda excluida automáticamente |

## 4. Contratos de core/

Ninguno — sin lógica de negocio nueva.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
| Rol nuevo (`secretaria`) + función `es_staff_de()` que incluye a ambos | Reutilizar `admin_acueducto` con una bandera `ve_finanzas boolean` en `membresias` | Un enum de rol es el mismo patrón que ya usa todo el proyecto (`tiene_rol`, `es_admin_de`) — una bandera aparte sería un segundo mecanismo de permisos paralelo al que ya existe |
| Comparar `rol::text` para `secretaria` dentro de la migración | Referenciar `'secretaria'::rol_usuario` inmediatamente después de `ALTER TYPE` | PostgreSQL rechaza el uso del nuevo valor del enum hasta hacer commit; la migración de Supabase es transaccional |
| Cambiar las guardas internas de `registrar_pago`, `importar_suscriptores` y `reemplazar_contador` | Cambiar solo políticas RLS | Las tres funciones son SECURITY INVOKER y sus guardas `es_admin_de()` bloquearían a `secretaria` antes de que RLS pudiera autorizarla |
| El trigger de `facturas` gana la guarda de rol para anular, en vez de un `GRANT` de columna | `GRANT UPDATE (total_pagado)` a `authenticated`, `REVOKE` del resto | Un `GRANT`/`REVOKE` de columna no distingue `admin_acueducto` de `secretaria` (mismo rol de Postgres) — no puede expresar "uno sí, el otro no" para la misma columna. El trigger sí sabe quién llama (`es_admin_de`) |
| `pagos`/`pago_aplicaciones`: `INSERT` para staff, `UPDATE`/`DELETE` solo admin, en políticas separadas | Una sola política `ALL` con una condición compuesta (`es_staff_de` para insert, `es_admin_de` para update) | Postgres no permite condicionar una misma política `ALL` de forma distinta por comando — hay que separarlas, mismo patrón que `lecturas` ya usa (`lecturas_inserta` separada de `lecturas_admin`) |
| Guard de ruta explícito en `/facturas/:id/anular` y `/pagos/:id/anular`, aunque RLS/trigger ya lo bloquean | Confiar solo en el error de Postgres | Mismo criterio que el resto del proyecto: la API nunca deja pasar un error crudo de base de datos como respuesta — se traduce a un `403` con mensaje claro |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

Ninguno relevante.

## 8. Estrategia de pruebas

- **Aislamiento:** `tests/aislamiento/015_rol_secretaria_aislamiento.sql` — contra PostgreSQL real,
  toda la matriz del spec §3.2: `secretaria` de A puede leer/escribir suscriptores, leer
  facturas/tarifas/cortes/notificaciones, registrar un pago (INSERT en `pagos` +
  `pago_aplicaciones` + `UPDATE` de `facturas.total_pagado`, los tres pasos reales, no solo uno) y
  **no** puede anular ese mismo pago, ni una factura, ni ejecutar un corte, ni tocar tarifas o
  `clientes.color_acento`. `admin_acueducto` de A, regresión: sigue pudiendo todo lo de antes,
  incluida la anulación. Aislamiento entre acueductos sin cambios (secretaria de A no ve nada de B).
- **Integración (manual, `wrangler dev` + `next dev` reales):** sesión de `secretaria` real contra
  cada ruta de la matriz; sesión de `admin_acueducto` real como regresión.
- **Manual, requiere Mateo:** aspecto visual final (botones ocultos correctamente) en un navegador
  real.
