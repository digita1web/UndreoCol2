# SPEC — 012: importacion-suscriptores-excel

**Estado:** Borrador para aprobación
**Depende de:** 003-suscriptores-contadores (`usuarios_servicio` completa, `crearSuscriptor()`),
002-catalogo-y-tarifas (`categoria_tarifaria`)

## 1. Objetivo

Permitir que el administrador del acueducto piloto cargue de una sola vez su base actual de
suscriptores (hoy en un Excel de cobro fijo manual, sin contadores) en vez de crearlos uno por uno
a mano desde `/app/suscriptores`.

## 2. Por qué ahora

El acueducto piloto tiene su base real en Excel. Antes de poder facturar, cobrar o hacer cualquier
otra cosa con esos suscriptores, tienen que existir en `usuarios_servicio` (003, ya completa). Sin
esta feature, dar de alta esa base a mano es la única vía — inviable para más de unos pocos
suscriptores. No depende de ninguna feature del roadmap posterior a 003/002.

**Sin ejemplo real del Excel todavía.** Mateo confirma que el archivo real del cliente aún no
existe. Esto no es un detalle menor: obliga a que el mapeo de columnas sea genuinamente
configurable en tiempo de importación (elegido por el admin al subir el archivo), nunca nombres de
columna asumidos en el código.

## 3. Alcance

### 3.1 Carga y mapeo de columnas
- El admin sube un archivo `.xlsx` o `.csv` desde el panel (`/app/suscriptores/importar` o
  similar).
- El sistema detecta las columnas del archivo (por su encabezado) y muestra un formulario donde el
  admin asigna cada columna del archivo a un campo de `usuarios_servicio`: `codigo_suscriptor`,
  `nombre`, `numero_documento`, `direccion`, `categoria` (requeridos — mismos requeridos que
  `crearSuscriptor()` de 003) y `tipo_documento`, `telefono`, `email`, `sector`, `notas`
  (opcionales). Ninguna columna sin asignar para un campo requerido permite continuar.
- El mapeo no se guarda entre importaciones en esta primera versión — se rehace cada vez. (Si
  Mateo quiere guardarlo por acueducto para reimportaciones futuras, es una ampliación menor a
  anotar en `/plan`, no una que cambie el alcance de fondo.)

### 3.2 Traducción de categoría tarifaria
- La columna mapeada a `categoria` trae texto libre del Excel del cliente (ej. "Estrato 3", "3",
  "ESTRATO3", "Comercial"). Se traduce a un valor válido de `categoria_tarifaria` (002:
  `estrato_1`..`estrato_6`, `comercial`, `industrial`, `oficial`) con una tabla de alias razonable
  y sensible a mayúsculas/espacios. Un valor que no se reconoce es un **error de fila**, no se
  adivina ni se deja en blanco silenciosamente.

### 3.3 Validación previa (sin escribir nada todavía)
Antes de importar, cada fila se valida y el admin ve un **resumen**: cuántas filas están listas,
cuántas tienen error y por qué, fila por fila. Errores detectados:
- Campo requerido vacío (`codigo_suscriptor`, `nombre`, `numero_documento`, `direccion`,
  `categoria`).
- `categoria` no reconocida (3.2).
- `codigo_suscriptor` repetido **dentro del archivo**, o ya existente en la base para ese cliente
  (`usuarios_servicio` tiene constraint único real `(cliente_id, codigo_suscriptor)` desde 001 —
  igual se valida antes de intentar escribir, para que el resumen sea útil, no solo un rechazo de
  la base a mitad de importación).
- `numero_documento` repetido **dentro del archivo**. **Precisión importante, verificada contra el
  esquema real:** `numero_documento` **no tiene constraint único** a nivel de base de datos (solo
  un índice no único, `20260902090000_suscriptores-contadores.sql`), así que un duplicado contra la
  base existente no lo rechazaría la base — se valida explícitamente en esta feature, no se confía
  en un error de la base que no va a ocurrir.

### 3.4 Confirmación e importación transaccional
- El admin decide, sobre el resumen de 3.3: cancelar y corregir el archivo, o **importar solo las
  filas válidas** (las que tienen error quedan fuera, reportadas). No hay una tercera opción de
  "importar todo e ignorar los errores" — una fila con error nunca se inserta con datos parciales o
  inventados.
- Las filas válidas elegidas se insertan en **una sola transacción**: si algo falla a mitad de
  camino (una violación de constraint que la prevalidación no anticipó, un error real de base de
  datos), se revierte todo el lote — no quedan suscriptores a medias de ese intento.
- La importación **solo da de alta**. Si `codigo_suscriptor` o `numero_documento` ya existen en la
  base, es un error de esa fila (3.3), nunca una actualización silenciosa de un suscriptor
  existente — evita que un Excel desactualizado sobrescriba datos que el admin ya corrigió a mano
  en el panel.

### 3.5 Reporte final
Al terminar: cuántos suscriptores se importaron, cuántos quedaron fuera por error (con el motivo de
cada uno), y un identificador del intento de importación para poder consultarlo después (3.6).

### 3.6 Historial de importaciones
Registro mínimo por intento: archivo (nombre), admin responsable, fecha, cuántas filas se
intentaron/importaron/fallaron. No guarda el archivo original ni los datos crudos de las filas
fallidas — solo el resumen (evita acumular datos personales de filas que ni siquiera se importaron,
sin necesidad real declarada de conservarlos).

## 4. Fuera de alcance

- **Importación de contadores o lecturas históricas** — el acueducto no tenía contadores antes de
  entrar al sistema; no hay nada que importar de eso todavía. Cuando instale contadores reales, se
  hace con el flujo normal de 003 (alta de contador por suscriptor).
- **Importación de facturas históricas** — fuera de esta feature, y no está prevista en ningún
  punto del roadmap actual.
- **Actualización masiva de suscriptores existentes vía Excel** (reimportar para corregir datos) —
  3.4 explícitamente solo da de alta; una segunda pasada del mismo archivo sobre suscriptores ya
  importados reporta duplicados, no los actualiza. Si hace falta actualización masiva más adelante,
  es una feature distinta con sus propias reglas (qué campos se pueden pisar, con qué
  confirmación).
- **Guardar el mapeo de columnas por acueducto para reutilizarlo** — ver nota en 3.1.
- **Formatos distintos de `.xlsx`/`.csv`** (Google Sheets exportado, `.xls` viejo, etc.) — se
  soportan `.xlsx` y `.csv` únicamente; si Mateo necesita otro formato, se agrega en `/plan` cuando
  se sepa cuál es.

## 5. Reglas de negocio que aplican

No hay un punto dedicado en `CLAUDE.md §10` para importación (es dominio nuevo); aplican las
generales:
- `CLAUDE.md §5.3`: la validación de filas (campos requeridos, traducción de categoría, detección
  de duplicados dentro del archivo) es lógica pura — vive en `core/`, sin Hono/Cloudflare/Supabase,
  con tests unitarios antes de darse por terminada. La detección de duplicados **contra la base**
  (3.3) no es pura por definición (necesita leer `usuarios_servicio`), así que vive en `lib/`, no en
  `core/`.
- `CLAUDE.md §5.4`: multi-tenant — toda fila importada lleva el `cliente_id` del acueducto activo
  de quien importa, nunca uno tomado del archivo. La tabla de historial de 3.6 lleva `cliente_id` y
  RLS `FORCE`, con su test de aislamiento en la misma tarea que la crea.
- `CLAUDE.md §5.5`: importar cientos de filas en una sola invocación de `fetch` de un Worker es
  razonable para el tamaño de un acueducto piloto (CPU 30s por defecto de sobra), pero se define un
  límite explícito de filas por archivo en `/plan` (no "todo lo que quepa"), y un archivo que lo
  supera se rechaza con un mensaje claro antes de procesar nada — nunca un Worker que se cuelga o
  falla a medias por un archivo demasiado grande.
- Advertencia de "categoría sin tarifa configurada" (spec 003 §3.1, mismo patrón): si la categoría
  de una fila válida no tiene ninguna tarifa vigente en el catálogo (002), se informa en el reporte
  final como advertencia, **no bloquea la importación de esa fila** — mismo criterio que la
  creación manual de un suscriptor.

## 6. Criterios de aceptación

### CA-1 — `core/importacion-suscriptores.ts`: validación pura de filas
Función pura que recibe filas ya parseadas (array de objetos, sin importar si vinieron de `.xlsx` o
`.csv` — eso ya se resolvió antes de llegar aquí) + el mapeo de columnas elegido, y devuelve, por
fila: válida o el motivo exacto del error (3.3), sin tocar la base. Cubre en tests unitarios
(`vitest`, sin DB): campo requerido vacío en cada uno de los 5 campos requeridos, categoría no
reconocida, categoría con variantes de mayúsculas/espacios que sí debe reconocer, duplicado de
`codigo_suscriptor` dentro del archivo, duplicado de `numero_documento` dentro del archivo, archivo
sin filas.

### CA-2 — Traducción de categoría con alias
Tabla de alias (3.2) cubierta en tests unitarios: al menos las variantes de estrato (con y sin la
palabra "estrato", con y sin espacio) y las tres categorías no residenciales.

### CA-3 — Detección de duplicados contra la base (lib, no core)
Verificado contra Postgres real que una fila con `numero_documento` o `codigo_suscriptor` ya
existente en `usuarios_servicio` para ese cliente se marca como error, **incluyendo el caso donde
solo `numero_documento` coincide y `codigo_suscriptor` es distinto** (recordatorio de 3.3: no hay
constraint único de base para `numero_documento`, así que si esta validación no se ejecuta, ese
duplicado pasaría sin avisar).

### CA-4 — Migración: tabla de historial de importaciones
`RLS FORCE`, mismo patrón de política que las tablas tenantizadas existentes. Test de aislamiento:
el acueducto A no ve el historial de importaciones de B.

### CA-5 — API: validar y confirmar (Hono)
`POST /suscriptores/importar/validar` (recibe filas + mapeo, corre CA-1 + CA-3, devuelve el
resumen) y `POST /suscriptores/importar/confirmar` (recibe las filas ya validadas a importar,
inserta transaccionalmente, registra el historial, devuelve el reporte de 3.5). Verificado con
peticiones HTTP reales cuando el entorno lo permita; si no, `tsc`/`eslint`/`wrangler deploy
--dry-run` limpios y "NO VERIFICADO" documentado con pasos exactos.

### CA-6 — Atomicidad real del lote
Un intento de importación en el que una fila del lote elegido falla al insertarse (forzado en el
test, no solo teórico) revierte el lote completo — cero suscriptores nuevos de ese intento, no
"todos menos el que falló".

### CA-7 — Frontend: subir, mapear, validar, confirmar, ver reporte
Flujo completo de carga de archivo, mapeo de columnas, resumen de errores, confirmación e historial
de importaciones. `npm run build`/`npm run lint` limpios. Flujo real en navegador (incluyendo el
parseo real de un `.xlsx`/`.csv` de prueba) **NO VERIFICADO** si el entorno no tiene lo necesario
para correr el frontend contra un backend real — con pasos exactos.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El Excel real del cliente todavía no existe: el mapeo de columnas podría no cubrir un caso real que aparezca después | Mapeo configurable por el admin en cada importación (3.1), no nombres de columna fijos en el código; tests de CA-1/CA-2 con variaciones de formato, no solo el caso feliz |
| `numero_documento` sin constraint único en la base: la detección de duplicados contra la base existente depende enteramente de esta feature, no de la base | CA-3 la testea explícitamente contra Postgres real, no se asume que "la base ya lo evita" |
| Confundir "importar" con "actualizar": un Excel desactualizado podría sobrescribir correcciones manuales ya hechas en el panel | 3.4: la importación solo da de alta; un duplicado es siempre error, nunca escritura sobre un suscriptor existente |
| Archivo demasiado grande procesado en una sola invocación de Worker | Límite explícito de filas a definir en `/plan`, rechazo claro antes de procesar si se supera (CLAUDE.md §5.5) |
| Datos personales de filas fallidas quedando innecesariamente en el historial | 3.6: el historial solo guarda el resumen (conteos), no el contenido de las filas |

## 8. Definición de terminado

- [x] CA-1 a CA-6 con evidencia (`tasks.md` T-001 a T-005). CA-7 (frontend, flujo real en
      navegador) parcial: `npm run build`/`npm run lint` limpios, pero el flujo E2E real contra
      Postgres queda **NO VERIFICADO — requiere validación manual de Mateo** (`tasks.md` T-008,
      sin Docker/PostgREST en este contenedor)
- [x] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios
- [x] Tests en verde (`vitest` de `core/importacion-suscriptores.ts` — 15/15; duplicados contra la
      base verificados a nivel de la consulta SQL real, no vía `supabase-js`/PostgREST — ver
      `tasks.md` T-004; test de aislamiento de `importaciones_suscriptores` — 6/6, `tasks.md` T-003)
- [x] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
