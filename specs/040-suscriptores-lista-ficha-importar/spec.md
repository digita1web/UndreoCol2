# SPEC — 040: suscriptores-lista-ficha-importar

**Estado:** Borrador para aprobación
**Depende de:** 003-suscriptores-contadores, 026-shell-panel-admin, 039-lecturas-vista-admin (mismo
patrón de tabla/`Badge`)

## 1. Objetivo

Re-vestir las tres pantallas de Suscriptores (`/app/suscriptores`, `/app/suscriptores/[id]`,
`/app/suscriptores/importar`) con el sistema visual de 026, y cerrar de paso el hueco real ya
encontrado en este proyecto (Sesión 056, limpieza de Knip): la ficha del suscriptor no tiene forma
de editar sus datos — `actualizarSuscriptor()`/`DatosActualizarSuscriptor` existen en
`frontend/lib/api.ts` desde antes, conectados a `PATCH /suscriptores/:id` (backend real, ya
funciona), pero ningún componente los llama todavía. Séptima pantalla del rediseño (cuenta como 3 de
las 15, más la edición como funcionalidad nueva).

## 2. Por qué ahora

Mateo definió el orden del resto del rediseño (Sesión 056): Suscriptores es la segunda, después de
Lecturas (039). Decisión explícita de Mateo: la edición se construye en el mismo spec que la ficha,
en vez de dos pasadas separadas por la misma pantalla.

## 3. Alcance

### 3.1 Lista (`/app/suscriptores`) — re-vestido + búsqueda nueva (cliente-side)
`page-head` (eyebrow "Suscriptores", conteo real de suscriptores en el subtítulo). Se agrega un
input de búsqueda por nombre o código — filtro **en el cliente** sobre el arreglo ya cargado por
`listarSuscriptores(filtroEstado)`, mismo criterio de "cero endpoints nuevos" que 030/039. Tabla con
columnas Suscriptor (nombre + código), Categoría, Estado (`Badge`), Acción ("Abrir" → ficha). **La
propuesta muestra una columna "Contador"** (serial) — se omite: `Suscriptor` no trae el serial del
contador, solo `contador_actual_id` (un uuid); mostrarlo truncado no sería la etiqueta real que
muestra la propuesta, y no hay ningún endpoint que devuelva serial+suscriptor en una sola llamada
hoy (traerlo exigiría N llamadas extra, una por fila — desproporcionado para una lista). Mismo
criterio que 039 §3.2 omitiendo "Lector OCR": no se agrega una columna con datos que no existen
today. "Nuevo suscriptor" (`SuscriptorForm`, ya usa `Input`/`Label`/`Button`) se mantiene tal cual.

### 3.2 Ficha (`/app/suscriptores/[id]`) — re-vestido de las 5 tarjetas existentes
`Datos`, `Corte y reconexión`, `Historial de cortes y reconexiones`, `Contador`, `Historial de
reemplazos` pasan a los tokens/`Badge` de 026 (estado del suscriptor y de cada evento con `Badge`
del color correspondiente). Sin cambios de flujo: `CorteForm`/`ReconexionForm`/`ContadorForm`/
`ReemplazoContadorForm`/`EtiquetaQrContador` se mantienen exactamente igual, solo el contenedor
cambia. "Regenerar código del portal" sigue con `window.prompt`/`window.confirm` tal cual — cambiar
ese patrón de interacción es una decisión de UX aparte, no de re-vestido visual, fuera de este spec.

### 3.3 Ficha — nueva: editar suscriptor
La tarjeta "Datos" gana un botón "Editar" que alterna a un formulario inline (mismo patrón de
alternancia que ya usa esta misma pantalla con "Ver/Ocultar etiqueta QR", §3.2/hoy) — nunca una
pantalla aparte ni un modal nuevo. Componente nuevo `EditarSuscriptorForm`, mismo patrón que
`SuscriptorForm` (`Input`/`Label`/`Button`, `useHidratado`, CLAUDE.md §7). Campos editables: nombre,
tipo de documento, número de documento, teléfono, email, dirección, sector, categoría, notas.

**Dos campos deliberadamente fuera del formulario, aunque `DatosActualizarSuscriptor` los admite:**
- `codigo_suscriptor` — nunca se acepta en `actualizarSuscriptor()` (comentario real en
  `lib/api.ts:345`, D-2: es la credencial del portal). Ya tiene su propio flujo separado
  ("Regenerar código del portal", §3.2) con su propia confirmación — no se duplica acá.
- `estado` — aunque `DatosActualizarSuscriptor.estado` existe en el tipo, esta pantalla **ya tiene**
  el camino correcto para cambiarlo: `CorteForm`/`ReconexionForm`, que aplican las reglas reales de
  negocio (CLAUDE.md §10 puntos 16-19 — motivo, deuda vencida, autorización de excepción). Exponer
  `estado` en un formulario genérico de "editar datos" abriría un camino para saltarse esas reglas
  (ej. pasar a `cortado` sin motivo ni verificar mora) — se excluye a propósito, no es un olvido.

### 3.4 Ficha — la vista de solo lectura muestra los campos que hoy existen pero no se ven
Hoy la tarjeta "Datos" solo muestra código, documento, dirección, categoría y estado — `telefono`,
`email`, `sector` y `notas` existen en el suscriptor (`003`/importación Excel) pero la pantalla
nunca los mostró. Se agregan a la vista de solo lectura (con "—" cuando son `null`) — no tendría
sentido ofrecer editar un campo que la propia pantalla nunca mostró que existía.

### 3.5 Importar (`/app/suscriptores/importar`) — re-vestido del contenedor
`page-head` con los mismos tokens. El contenido real (`ImportacionMapeo`/`ImportacionResumen`) no se
toca — spec 012 ya lo construyó y funciona; este spec re-viste el `<main>`/`page-head` que lo
envuelve, no el flujo interno de mapeo/validación/confirmación.

## 4. Fuera de alcance

- **Columna "Contador" en la lista** — spec §3.1, no hay dato real disponible sin llamadas extra.
- **Cambiar el patrón de "Regenerar código del portal"** (`window.prompt`/`confirm`) — decisión de
  UX aparte, no de este spec.
- **Editar `codigo_suscriptor` o `estado` desde el formulario nuevo** — spec §3.3, decisión
  deliberada con razón de negocio, no un recorte de alcance sin avisar.
- **Rediseñar `ImportacionMapeo`/`ImportacionResumen` por dentro** — spec §3.5, solo el contenedor.
- **Buscar por teléfono/email/sector** en la lista — la búsqueda de §3.1 es por nombre/código,
  mismo alcance que ya tenía el filtro de estado (no se amplía el criterio de búsqueda sin pedido).

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 puntos 16-19 (corte/reconexión: motivo, deuda vencida, excepción autorizada) — el
  formulario de edición nunca toca `estado`, ver §3.3.
- D-2 (`docs/DECISIONES.md`): `codigo_suscriptor` es la credencial del portal del suscriptor, nunca
  se acepta en un `PATCH` genérico — ya lo garantiza el backend
  (`backend/src/lib/suscriptores.ts`/ruta real), este spec no lo cambia, solo no lo expone en la UI.
- Cambio de categoría del suscriptor (CLAUDE.md §10 punto 13): las facturas históricas usan
  `facturas.snapshot_suscriptor`, no se alteran retroactivamente — sin cambios, ya lo garantiza el
  backend; la edición de categoría desde esta pantalla no reabre ni recalcula facturas viejas.

## 6. Criterios de aceptación

### CA-1 — La lista filtra por estado y por búsqueda de texto sin llamadas nuevas
Escribir en el buscador o cambiar el filtro de estado no genera ninguna petición de red nueva al
tipear (la de estado sí llama al backend, como hoy — solo la búsqueda de texto es 100% cliente).

### CA-2 — El `Badge` de estado usa el color correcto para los 4 valores
`activo`→`success`, `suspendido`→`warning`, `cortado`→`danger`, `inactivo`→`gray`.

### CA-3 — "Editar" muestra un formulario pre-llenado con los datos reales del suscriptor
Con sesión real, tocar "Editar" en la ficha de un suscriptor con datos completos: el formulario
arranca con los valores reales (no vacío), incluyendo los campos que antes no se mostraban.

### CA-4 — Guardar la edición persiste los cambios reales, vía `PATCH /suscriptores/:id`
Cambiar el teléfono y guardar: la vista de solo lectura refleja el valor nuevo, y una segunda carga
de la página (o `GET /suscriptores/:id` directo) confirma que quedó en la base real.

### CA-5 — El formulario de edición nunca expone `codigo_suscriptor` ni `estado`
Ningún campo del formulario nuevo permite cambiar esos dos — verificable por inspección del
componente y de la petición real (`PATCH` nunca manda esas claves).

### CA-6 — Los flujos existentes de la ficha no cambian de comportamiento
`Corte`/`Reconexión`/`Contador`/`Reemplazo`/`Etiqueta QR`/`Regenerar código` funcionan exactamente
igual que antes del re-vestido — mismos mensajes, mismas condiciones de rol.

### CA-7 — Importar sigue funcionando de punta a punta
Cargar un archivo real, mapear columnas, confirmar: mismo resultado que antes del re-vestido del
contenedor.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Exponer `sector`/`notas` en el formulario de edición podría chocar con 037 (sectores del lector), que ya usa `sector` como texto libre para filtrar | Mismo campo, mismo comportamiento de texto libre que ya documentó 037 §4/§7 — esta pantalla no agrega normalización nueva ni valida contra una lista cerrada |
| El formulario de edición podría malinterpretarse como el lugar para cambiar el estado del suscriptor, ya que muestra el estado actual en la vista de solo lectura | El estado se ve pero no tiene campo editable en el formulario — la vista de solo lectura ya deja claro que el cambio de estado vive en la tarjeta "Corte y reconexión", justo debajo |
| La lista completa de suscriptores puede ser grande en un acueducto real y el filtro de texto en el cliente podría sentirse lento | Sin evidencia hoy (`undreocol-producción` en 0 suscriptores) — mismo criterio de proporcionalidad que 030/039 |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` sin hallazgos nuevos — cierra el hallazgo viejo de `actualizarSuscriptor`/
      `DatosActualizarSuscriptor` como exports huérfanos (Sesión 055/056)
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real, confirmando CA-4 contra la
      base real (no solo la respuesta HTTP)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
