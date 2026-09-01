# SPEC — 002: catalogo-y-tarifas

**Estado:** Borrador para aprobación
**Depende de:** 001-fundacion (multi-tenant, RLS, sesión admin, backend Hono base)

## 1. Objetivo

Dar a cada acueducto su catálogo propio de servicios facturables (acueducto,
alcantarillado, aseo…) y las tarifas versionadas por categoría con las que se
calcula el subtotal de cada servicio sobre un consumo en m³. Esta feature es
el cimiento sobre el que se apoya todo el ciclo de facturación (005): sin
catálogo ni tarifas no hay nada que facturar.

## 2. Por qué ahora

001-fundación dejó la base multi-tenant, RLS y la sesión administrativa
funcionando. Según el roadmap (`.specify/config.md`), 003-suscriptores y
004-lecturas dependen de 002, y 005-facturación depende de ambas. El
catálogo de servicios y las tarifas son la primera pieza de dominio real
(no de infraestructura) del sistema — hay que resolverla antes de poder
dar de alta un suscriptor con una categoría tarifaria válida.

## 3. Alcance

### 3.1 Catálogo de servicios (admin)
- El administrador de un acueducto crea, edita y activa/desactiva servicios
  propios: código (único por acueducto), nombre, tipo de cálculo
  (`por_consumo` | `fijo`), si se incluye en el ciclo mensual
  (`facturable_en_ciclo`), orden de aparición en la factura.
- Un servicio no se elimina físicamente una vez usado por una tarifa —
  desactivar (`activo = false`) es la única baja posible desde 002. La
  eliminación física sin tarifas asociadas sí se permite.
- Listado y detalle de servicios, filtrado por acueducto vía RLS.

### 3.2 Tarifas versionadas por vigencia (admin)
- El administrador crea una tarifa para un servicio + categoría tarifaria
  (estrato 1–6, comercial, industrial, oficial) con `cargo_fijo`,
  `limite_basico_m3`, `precio_basico_m3`, `precio_no_basico_m3`.
- Crear una tarifa nueva para un servicio+categoría que ya tiene una vigente
  **cierra automáticamente la anterior** (`vigencia_hasta = hoy - 1`) y abre
  la nueva con `vigencia_desde = hoy`, en una sola transacción. Nunca hay
  edición de una fila de tarifa existente.
- Consulta de la tarifa vigente de un servicio+categoría en una fecha dada
  (usa `tarifa_vigente()` de `docs/esquema-propuesto.sql`).
- Historial completo de tarifas de un servicio+categoría (todas las
  versiones, vigentes y cerradas).
- Endpoint que devuelve, para un acueducto, la matriz completa
  servicio × categoría con su tarifa vigente (o "sin tarifa configurada" si
  no existe) — es lo que usará 003 para validar que un suscriptor nuevo
  tiene categoría facturable.

### 3.3 Cálculo puro del subtotal por servicio (`core/tarifas.ts`)
- Función pura que recibe una tarifa y un `consumo_m3` y devuelve el
  subtotal, aplicando la fórmula de D-1 (básico/no básico, límite
  inclusivo) para `por_consumo`, y solo `cargo_fijo` para `fijo`.
- Sin dependencias de Hono, Cloudflare ni Supabase (regla `CLAUDE.md §5.3`).
- Cubre los casos límite de `CLAUDE.md §10` en tests unitarios: consumo
  exactamente igual al límite básico, uno menos, uno más; consumo cero;
  tarifa `fijo` ignora `consumo_m3`.

### 3.4 Frontend admin: panel de catálogo y tarifas
- Página protegida (sesión admin) bajo `/app/catalogo`: lista de servicios,
  alta de servicio nuevo, activar/desactivar.
- Página o sección para ver el historial de tarifas de un servicio y crear
  una tarifa nueva por categoría (formulario que deja claro que esto cierra
  la vigente y abre una nueva, nunca la edita).

## 4. Fuera de alcance

- **Suscriptores y contadores** (categoría tarifaria del suscriptor,
  asignación de contador) — feature 003.
- **Lecturas y consumo real** — feature 004.
- **Cierre de facturación, `factura_detalles.tarifa_id`, recargo por mora** —
  feature 005. 002 solo deja lista la tarifa y su función de cálculo puro;
  no arma facturas.
- **Tarifas reales verificadas de ningún acueducto concreto.** D-5 sigue
  pendiente de que Mateo entregue las tarifas reales contra la resolución
  tarifaria vigente. 002 usa valores de ejemplo para tests y para el dataset
  de desarrollo; no bloquea esta feature, pero `docs/CASOS-DORADOS.md`
  definitivo sigue pendiente de D-5.
- **Reconexión como servicio no facturable en ciclo** — el atributo
  `facturable_en_ciclo` queda modelado en 002, pero el flujo de reconexión
  en sí (factura tipo `reconexion`) es de la feature 009-cortes-reconexiones.

## 5. Reglas de negocio que aplican

De `CLAUDE.md §10 — Tarifas`:
- **0.** Las tarifas se versionan, nunca se editan (índice único
  `(servicio_id, categoria, vigencia_desde)`).
- **0b.** Una sola tarifa activa por servicio + categoría en cada momento.
- **0c.** La tarifa a usar en el cierre es la vigente en la fecha de
  ejecución del cierre (relevante para 005, pero `tarifa_vigente()` se
  construye aquí con ese contrato).
- **0d.** Una tarifa con facturas emitidas nunca se elimina, solo se cierra
  (`factura_detalles.tarifa_id` es referencia permanente — la tabla y la FK
  se crean en 002 aunque `factura_detalles` la puebla 005).
- **15.** `limite_basico_m3` es **inclusivo** (D-1). Se testea el límite
  exacto, uno menos y uno más.

De `docs/DECISIONES.md`:
- **D-1** — fórmula básico/no básico, límite inclusivo.
- **D-5** — tarifas de referencia son provisionales; no se presentan como
  definitivas en ningún dato de ejemplo o seed.

De `CLAUDE.md §5.4 — Multi-tenant y RLS`: `servicios` y `tarifas` llevan
`cliente_id` y RLS con `FORCE`; toda tabla nueva trae su test de
aislamiento en la misma tarea.

## 6. Criterios de aceptación

Cada uno cerrado con evidencia ejecutada y pegada.

### CA-1 — Migración de `servicios` y `tarifas`
Migración en `supabase/migrations/` crea ambas tablas (según
`docs/esquema-propuesto.sql §6`), el enum `categoria_tarifaria`, el enum
`tipo_calculo`, la función `tarifa_vigente()`, RLS `FORCE` en ambas tablas,
y el índice único `(servicio_id, categoria, vigencia_desde)`. Verificación:
`supabase db reset` limpio + `\d servicios`, `\d tarifas` mostrando RLS
activo.

### CA-2 — Test de aislamiento multi-tenant
Test de integración: el acueducto A no puede leer ni escribir servicios o
tarifas del acueducto B, ni siquiera con IDs adivinados directamente en la
query. Corrido con el JWT de un usuario de A intentando acceder a datos de
B. Salida del test pegada, en verde.

### CA-3 — API: catálogo de servicios (Hono)
`GET /catalogo/servicios`, `POST /catalogo/servicios`,
`PATCH /catalogo/servicios/:id` (activar/desactivar, editar atributos no
versionados). Protegidos por sesión admin. Verificado con peticiones HTTP
reales contra `wrangler dev` (código de estado y cuerpo pegados), no
"debería funcionar".

### CA-4 — API: tarifas versionadas (Hono)
`POST /catalogo/tarifas` crea una tarifa nueva y cierra la anterior en la
misma transacción (verificar con una petición real: crear tarifa A, luego
tarifa B para el mismo servicio+categoría, y confirmar que A queda con
`vigencia_hasta` cerrada). `GET /catalogo/tarifas?servicio_id=&categoria=`
devuelve el historial completo. `GET /catalogo/matriz-tarifas` devuelve la
matriz servicio × categoría con la vigente de cada una.

### CA-5 — `core/tarifas.ts`: cálculo puro con casos límite
Tests unitarios (`vitest`, sin Workers ni base de datos) para: consumo
exactamente igual al límite básico, límite − 1, límite + 1, consumo 0,
tarifa `fijo` (ignora `consumo_m3`). Salida de `vitest run` en verde,
pegada.

### CA-6 — No hay dos tarifas activas simultáneas
Test que intenta insertar una segunda tarifa vigente para el mismo
servicio+categoría sin `vigencia_hasta` en la primera, y confirma que la
capa de aplicación lo impide (vía la misma transacción de CA-4) o que la
restricción de base de datos lo rechaza. Salida pegada.

### CA-7 — Frontend: panel de catálogo y tarifas
`/app/catalogo` protegido por middleware de sesión admin (igual patrón que
001). Permite: crear un servicio, verlo en la lista, crear una tarifa
nueva para un servicio+categoría y ver que aparece como vigente mientras la
anterior (si existía) pasa a histórica. Verificado con `npm run build` sin
errores/warnings y, si el entorno lo permite, una corrida manual contra
`wrangler dev` — si no es posible en este contenedor, se declara
"NO VERIFICADO — requiere validación manual de Mateo" con los pasos
exactos.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| `tarifa_vigente()` es `security definer` — un bug podría filtrar tarifas entre acueductos pese a RLS | CA-2 testea aislamiento explícitamente contra la función, no solo contra las tablas |
| Sin tarifas reales (D-5), los datos de ejemplo podrían filtrarse como si fueran definitivos a `docs/CASOS-DORADOS.md` | Todo dato de ejemplo se marca explícitamente como provisional en el código/fixtures; no se toca `docs/CASOS-DORADOS.md` en esta feature |
| Cerrar la tarifa anterior y crear la nueva en dos pasos no atómicos dejaría una ventana sin tarifa vigente | CA-4 y CA-6 exigen que sea una sola transacción (`SELECT ... FOR UPDATE` sobre la tarifa vigente antes de cerrarla, igual patrón que el consecutivo de factura en 001/005) |
| Activar/desactivar un servicio con tarifas históricas podría romper la referencia de facturas futuras (005) | 002 no permite eliminar servicios con tarifas asociadas, solo desactivar; se testea en CA-1/CA-3 |

## 8. Definición de terminado

- [ ] Todos los CA (1–7) con evidencia
- [ ] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios
- [ ] Tests en verde (`vitest` de `core/tarifas.ts`, tests de integración de aislamiento)
- [ ] Test de aislamiento de `servicios` y `tarifas` (CA-2)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
