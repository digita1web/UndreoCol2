# PLAN — 024: permisos-lector

**Spec aprobado:** 2026-09-10

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260921090000_permisos-lector.sql` | Nuevo | Elimina las 10 políticas `_lectura` sobre-amplias; crea `usuarios_servicio_lector()` |
| `backend/src/lib/suscriptores.ts` | Modificado | `listarSuscriptores()` acepta `soloLector: boolean`; usa la RPC nueva en vez de la tabla completa cuando es `true` |
| `backend/src/index.ts` | Modificado | `GET /suscriptores` pasa `ctx.rol === 'lector'`; guard `ctx.rol === 'admin_acueducto'` en las 4 rutas de facturación por cola (§3.4 del spec) |
| `tests/aislamiento/014_permisos_lector_aislamiento.sql` | Nuevo | Las 10 tablas bloqueadas + la RPC acotada + que `admin_acueducto` no pierde nada |
| `docs/PLAN-PRODUCCION.md` | Modificado | M-2 y M-2b marcados resueltos con evidencia |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

## 2. Esquema de base de datos

### Por qué NO hacen falta 10 políticas nuevas
Las 10 tablas de §3.1 del spec ya tienen una política `ALL` (`_admin`/`_escritura`) con
`es_admin_de(cliente_id)` — que YA excluye al `lector` (`es_admin_de` = `es_admin_plataforma() OR
tiene_rol(cliente_id, ['admin_acueducto'])`). La única razón por la que el `lector` puede leerlas
hoy es una política `_lectura` (`SELECT`) **separada y más amplia** (`cliente_id IN
mis_clientes()`, sin filtrar por rol) que se solapa con la de arriba. Eliminando esa política
`_lectura`, `admin_acueducto`/`administrador` no pierden nada (la `ALL` los sigue cubriendo) y el
`lector` pierde el único camino que lo dejaba pasar. Diez `DROP POLICY`, cero políticas nuevas en
estas 10 tablas — más simple y con menos superficie para introducir un error que una política
nueva mal escrita.

```sql
drop policy facturas_lectura on facturas;
drop policy factura_detalles_lectura on factura_detalles;
drop policy pagos_lectura on pagos;
drop policy pago_aplicaciones_lectura on pago_aplicaciones;
drop policy tarifas_lectura on tarifas;
drop policy configuracion_lectura on configuracion;
drop policy cortes_reconexiones_lectura on cortes_reconexiones;
drop policy notificaciones_lectura on notificaciones;
drop policy importaciones_suscriptores_lectura on importaciones_suscriptores;
drop policy reemplazos_contador_lectura on reemplazos_contador;
```

### `usuarios_servicio`: sí necesita una política nueva + una función
Mismo razonamiento: se elimina `usuarios_servicio_lectura` (`admin_acueducto` sigue cubierto por
`usuarios_servicio_escritura`, `ALL`). Pero el `lector` SÍ necesita algo — no una política RLS
nueva sobre la tabla (expondría todas las columnas otra vez), sino una función `SECURITY DEFINER`
que solo devuelve las 5 columnas seguras, mismo patrón que 008/010 (revalida `cliente_id` contra
quien llama, nunca confía en un parámetro desnudo):

```sql
drop policy usuarios_servicio_lectura on usuarios_servicio;

create or replace function usuarios_servicio_lector(p_cliente_id uuid, p_estado text default null)
returns table (id uuid, codigo_suscriptor text, nombre text, contador_actual_id uuid, estado estado_suscriptor)
language sql stable security definer set search_path = public as $$
  select u.id, u.codigo_suscriptor, u.nombre, u.contador_actual_id, u.estado
  from usuarios_servicio u
  where u.cliente_id = p_cliente_id
    and (es_admin_plataforma() or p_cliente_id in (select mis_clientes()))
    and (p_estado is null or u.estado::text = p_estado)
  order by u.nombre;
$$;

grant execute on function usuarios_servicio_lector(uuid, text) to authenticated;
revoke execute on function usuarios_servicio_lector(uuid, text) from anon, public;
```

La guarda es de **pertenencia al acueducto** (`mis_clientes()`), no de rol — igual que
`tarifa_vigente()` (B-3): cualquier miembro activo de ese cliente puede llamarla, pero solo expone
5 columnas sin PII, así que no hace falta ser más estricto. En la práctica solo la usa `lector`
(`admin_acueducto` sigue con la tabla completa vía RLS).

## 3. Rutas de la API (Hono)

| Método | Ruta | Cambio |
|---|---|---|
| GET | `/suscriptores` | Pasa `ctx.rol === 'lector'` a `listarSuscriptores()`; sin cambio de firma HTTP |
| POST | `/facturacion/periodos/:id/simular` | + guard `ctx.rol === 'admin_acueducto'` → `403` si no |
| POST | `/facturacion/periodos/:id/emitir` | + mismo guard — cierra M-2b |
| POST | `/facturacion/periodos/:id/enviar-correo` | + mismo guard |
| POST | `/facturas/:id/enviar-correo` | + mismo guard |

`GET /suscriptores/:id` **no lleva guard nuevo**: al eliminarse `usuarios_servicio_lectura`, un
`lector` que la llame recibe `404` de forma natural (la fila queda invisible por RLS) — es el
resultado correcto (no tiene por qué ver el perfil completo de un suscriptor), no un caso a
manejar aparte.

## 4. Contratos de core/

Ninguno — esta feature es RLS + una función SQL + un `if` de rol en 4 rutas. No hay lógica de
negocio nueva en `core/`.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `DROP` de la política `_lectura` sobre-amplia en vez de reescribirla con una condición de rol | Reescribir cada política para agregar `AND tiene_rol(...)` | La política `_admin`/`_escritura` (`ALL`) ya cubre exactamente lo que `admin_acueducto` necesita — reescribir la de lectura sería duplicar esa misma condición en dos lugares en vez de uno |
| Función `SECURITY DEFINER` para `usuarios_servicio` en vez de una vista | Una `VIEW` con las 5 columnas + su propia política RLS | Mismo patrón ya establecido en el proyecto (008 portal, B-3 `tarifa_vigente`) — una función nueva no exige decidir política RLS de una vista nueva ni preocuparse por cómo Postgres evalúa RLS a través de una vista |
| Guard de rol en las 4 rutas de facturación por cola, no solo confiar en que RLS de `tarifas` las degrade | — | RLS ya bloquea 2 de las 4 en la práctica (los `enviar-correo`, vía `notificaciones`), pero en silencio (`202`, `encoladas: 0`); las otras 2 (`simular`, `emitir`) no tienen ninguna capa que las bloquee hoy. Un guard explícito da el mismo `403` claro en las 4, y cierra `emitir` de raíz |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

Ninguno relevante — `DROP POLICY`, una función SQL de una sola consulta, y 4 `if` de rol no
acercan a ningún límite de CPU/memoria/bundle.

## 8. Estrategia de pruebas

- **Aislamiento (RLS):** `tests/aislamiento/014_permisos_lector_aislamiento.sql` — contra
  PostgreSQL real: (1) `lector` de A → 0 filas en las 10 tablas; (2) `admin_acueducto` de A → sin
  cambios (regresión, mismos conteos que antes); (3) `usuarios_servicio_lector()` desde `lector` de
  A devuelve las filas de A con solo las 5 columnas, y 0 filas para B; (4) llamada directa a la
  tabla `usuarios_servicio` desde `lector` → 0 filas (la función es la única vía).
- **Integración (manual, `wrangler dev` + `next dev` reales, mismo método que 023):** `GET
  /suscriptores` con `lector` → solo 5 campos, sin PII; las 4 rutas de facturación con `lector` →
  `403`; con `admin_acueducto` → sin cambios; `/app/lecturas` con sesión de lector real → el
  desplegable se arma igual que antes.
- **Manual (requiere Mateo):** confirmar en un navegador real que `/app/lecturas` sigue
  funcionando para un usuario con rol `lector` (este entorno sigue sin Chromium/Playwright).
