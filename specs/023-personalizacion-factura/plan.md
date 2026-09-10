# PLAN — 023: personalizacion-factura

**Spec aprobado:** 2026-09-09

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260920090000_personalizacion-factura.sql` | Nuevo | Columna `clientes.color_acento`, política RLS de `UPDATE` acotada, GRANT de columna, `create or replace` de `portal_factura_completa` |
| `backend/src/core/color.ts` | Nuevo | `esColorHexValido`, `hexARgb01` — puras, sin dependencias externas |
| `backend/src/core/color.test.ts` | Nuevo | Tests unitarios de las dos funciones, casos límite |
| `backend/src/lib/factura-pdf.ts` | Modificado | `DatosAcueductoPdf.colorAcento: string`; `colorAcento` fijo (`rgb(0.08,0.25,0.55)`) se reemplaza por `hexARgb01(acueducto.colorAcento)` |
| `backend/src/lib/factura-pdf.test.ts` | Modificado | Caso nuevo: dos acueductos con colores distintos producen bytes de PDF distintos en el bloque de color |
| `backend/src/lib/portal.ts` | Modificado | `DatosAcueductoPdf` mapeado desde `portal_factura_completa` incluye `colorAcento` |
| `backend/src/index.ts` | Modificado | Nuevas rutas `GET /acueducto`, `PATCH /acueducto/color`; `GET /facturas/:id/pdf` y `GET /portal/facturas/:id/pdf` pasan `color_acento` a `generarPdfFactura` |
| `frontend/lib/api.ts` | Modificado | `obtenerAcueducto()`, `actualizarColorAcentoAcueducto(hex)`, tipo `Acueducto` |
| `frontend/app/app/configuracion/page.tsx` | Nuevo | Pantalla de configuración (solo lectura + color) |
| `frontend/app/app/facturacion/[facturaId]/page.tsx` | Modificado | Encabezado del acueducto (logo, nombre, NIT, municipio, teléfono, dirección) con el color de acento en nombre y TOTAL |
| `frontend/app/app/dashboard/page.tsx` | Modificado | Enlace a `/app/configuracion`, solo si `rol === 'admin_acueducto'` (mismo patrón que el enlace a `/app/lecturas`) |
| `tests/aislamiento/013_personalizacion_factura_aislamiento.sql` | Nuevo | RLS de la columna/política nueva sobre `clientes` |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

## 2. Esquema de base de datos

### Migraciones

| Archivo | Contenido |
|---|---|
| `20260920090000_personalizacion-factura.sql` | Ver DDL abajo |

### Tablas

```sql
alter table clientes
  add column color_acento text not null default '#14408C'
  check (color_acento ~* '^#[0-9a-f]{6}$');

comment on column clientes.color_acento is
  'Color de acento (hex #RRGGBB) usado en el encabezado y el TOTAL de la '
  'factura (PDF e impresión, 023). Default = azul que ya se usaba antes de '
  'esta feature, para que ningún acueducto existente cambie de apariencia.';
```

`#14408C` es la conversión exacta de `rgb(0.08, 0.25, 0.55)`, el color fijo actual de
`factura-pdf.ts` (0.08×255≈20=0x14, 0.25×255≈64=0x40, 0.55×255≈140=0x8C) — CA-1.

### Políticas RLS

`clientes` ya tiene `clientes_lectura` (SELECT, cubre esto — no se toca) y `clientes_plataforma`
(ALL, solo superadmin — no se toca). Se agrega una política de `UPDATE` nueva, acotada:

```sql
create policy clientes_color_acento on clientes
  for update
  using (es_admin_de(id))
  with check (es_admin_de(id));
```

`es_admin_de(id)` (001) ya cubre `admin_acueducto` de ESE cliente y al superadmin — mismo criterio
que el resto de la app (CLAUDE.md §10 punto 23/24: el `lector` nunca entra aquí, ni por RLS ni por
ruta — ver §3).

**Restricción por columna (CA-6), porque `grants-tablas-faltantes` ya le dio a `authenticated`
`UPDATE` de tabla completa sobre `clientes`:**

```sql
revoke update on clientes from authenticated;
grant update (color_acento) on clientes to authenticated;
```

Verificado que ningún código actual depende del `UPDATE` amplio anterior (`grep` de
`.from('clientes')` en `backend/src/`: todos los usos son `.select()`; el alta de acueductos
—`crear_acueducto_base`— es `SECURITY DEFINER` y no necesita el grant de `authenticated` para
insertar). `service_role` no se toca: sigue con `UPDATE` completo de `grants-tablas-faltantes`.

**Función SECURITY DEFINER que también debe ver el color** (para el PDF del portal):

```sql
create or replace function portal_factura_completa(...)
-- ... (cuerpo idéntico al actual, ver pg_proc real) ...
-- dentro del jsonb_build_object de 'acueducto', se agrega:
--   'color_acento', c.color_acento
```

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| GET | `/acueducto` | `requerirClienteActivo`, cualquier rol autenticado del cliente | Datos de solo lectura del acueducto + `color_acento` actual. La usan tanto `/app/configuracion` como `/app/facturacion/[facturaId]` (mismo endpoint, dos consumidores) |
| PATCH | `/acueducto/color` | `requerirClienteActivo` + `ctx.rol === 'admin_acueducto'` → 403 explícito si no (mismo patrón que `GET /dashboard/indicadores`, `index.ts:469`) | Valida el hex con `esColorHexValido` (rechaza con 400 antes de tocar la base — CA-4) y actualiza `color_acento` |

`GET /facturas/:id/pdf` y `GET /portal/facturas/:id/pdf` no son rutas nuevas: solo agregan
`color_acento` a la fila de `clientes`/`portal_factura_completa` que ya leen, y lo pasan a
`generarPdfFactura`.

## 4. Contratos de core/

```ts
// backend/src/core/color.ts

/** #RRGGBB, insensible a mayúsculas. Sin el "#" o con longitud distinta → false. */
export function esColorHexValido(valor: string): boolean;

/**
 * Convierte "#RRGGBB" a los floats 0–1 que espera `rgb()` de pdf-lib.
 * Lanza si `hex` no es válido (el llamante SIEMPRE valida antes con
 * esColorHexValido — nunca se le pasa un valor sin validar, ni desde la ruta
 * ni desde un valor ya guardado en la base con el CHECK constraint).
 */
export function hexARgb01(hex: string): { r: number; g: number; b: number };
```

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `<input type="color">` nativo del navegador para elegir el color | Librería de color picker (react-color, etc.) | Cero dependencias nuevas; el navegador ya valida que el valor sea un hex bien formado antes de que llegue al `onChange` |
| Un solo endpoint `GET /acueducto` para configuración y encabezado de factura | Dos endpoints separados (uno por pantalla) | Mismos datos, mismo criterio de acceso (RLS `clientes_lectura`); duplicar la ruta sería repetir lógica sin necesidad |
| Restricción por columna (`grant update (color_acento)`) en vez de una función `SECURITY DEFINER` que solo actualice ese campo | Función `actualizar_color_acueducto(p_cliente_id, p_color)` | La tabla ya tiene RLS `FORCE` + la política nueva cubre el aislamiento por fila; el problema real era el GRANT de tabla completo de 023's predecesora (`grants-tablas-faltantes`), no la ausencia de una función — restringir la columna es más simple y no agrega una función más a mantener |
| Validación del hex en `core/` (pura) + `CHECK` en la base (dos capas) | Confiar solo en la validación de la ruta | Mismo criterio que el resto del proyecto (revalidar en cada capa, ver `tarifa_vigente`/portal); si algún día algo escribe `clientes.color_acento` sin pasar por esta ruta (script, MCP), el `CHECK` sigue protegiendo a `pdf-lib` de un valor inválido |

## 6. Dependencias nuevas

Ninguna. `<input type="color">` es HTML nativo; la conversión hex→rgb es aritmética simple sin
librería.

## 7. Límites de Cloudflare Workers a considerar

Ninguno relevante: un `SELECT`/`UPDATE` de una fila y una conversión aritmética no acercan a
ningún límite de CPU/memoria/bundle (CLAUDE.md §5.5). No cambia el tamaño del bundle de forma
apreciable (cero dependencias nuevas).

## 8. Estrategia de pruebas

- **Unitarias (`core/`):** `color.test.ts` — hex válido en mayúsculas/minúsculas, sin `#`, longitud
  corta/larga, caracteres fuera de rango; conversión exacta contra el valor por defecto `#14408C`
  (debe dar el mismo `rgb(0.08, 0.25, 0.55)` que hoy usa `factura-pdf.ts`, para no romper CA-1).
- **Unitarias (`lib/`):** `factura-pdf.test.ts` — dos acueductos con `colorAcento` distinto generan
  PDF con bytes distintos (evidencia de que el color sí se usa, no solo que no truena).
- **Aislamiento (RLS):** `tests/aislamiento/013_personalizacion_factura_aislamiento.sql` —
  1) admin de A cambia el color de A → OK; 2) admin de A intenta cambiar el color de B → 0 filas
  afectadas; 3) admin de A intenta, en la misma sentencia SQL simulando el `UPDATE` de la ruta,
  tocar `plan_id`/`estado_cuenta`/`slug` de su propia fila → falla por el GRANT de columna, no solo
  por RLS; 4) `lector` de A intenta `UPDATE` sobre `color_acento` de A → falla (ni siquiera pasa el
  GRANT: `lector` nunca tuvo el `UPDATE` de tabla en primer lugar, verificar que sigue así).
- **Integración (manual con `wrangler dev` + Supabase local, como ya se hizo con el PDF/portal en
  esta misma conversación):** `GET`/`PATCH /acueducto` con sesión de `admin_acueducto` y de
  `lector` (403 en el segundo); `GET /facturas/:id/pdf` y `/portal/facturas/:id/pdf` con un color no
  default, confirmar con `pdfinfo`/inspección de bytes que cambia.
- **Manual (requiere Mateo):** ver el color aplicado en un navegador real, en `/app/configuracion`
  (vista previa en vivo) y en `/app/facturacion/[facturaId]` con `Ctrl+P` (vista de impresión real,
  no solo la pantalla).
