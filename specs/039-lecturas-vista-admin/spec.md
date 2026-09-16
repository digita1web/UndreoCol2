# SPEC — 039: lecturas-vista-admin

**Estado:** Aprobado (2026-09-16) — implementado Sesión 056
**Depende de:** 004-lecturas-y-consumo, 026-shell-panel-admin, 030-facturacion-lista (mismo patrón de
tabla/`Badge`)

## 1. Objetivo

Re-vestir `/app/lecturas` para `admin_acueducto`/`secretaria` (`VistaAdmin`, en
`frontend/app/app/lecturas/page.tsx`) con el sistema visual de 026 — `Badge`, `Card`, tokens de
color — siguiendo `specs/026-shell-panel-admin/propuesta-referencia.html` (`id="lecturas"`). Sexta
pantalla del rediseño. **No toca `VistaLector`/AquaLectura** (025 ya tiene su propia identidad
visual, confirmado explícitamente en su momento que no se reemplaza por el prototipo).

## 2. Por qué ahora

Mateo definió el orden del resto del rediseño (Sesión 056): Lecturas es la primera de las que
quedan, después de marco compartido (026), Panel principal (027) y las tres pantallas de dinero
(030/031/032).

## 3. Alcance

### 3.1 Re-vestido, cero endpoints nuevos
Todo sale de `listarPeriodos()`, `listarSuscriptores()` y `listarLecturas()` (ya existen, sin
cambios). El único dato "nuevo" en pantalla — el nombre del suscriptor dueño de cada lectura — se
resuelve **cruzando en el cliente** `lecturas[].contador_id` contra
`suscriptores[].contador_actual_id` (ambos arreglos ya se cargan hoy); sin llamada nueva al backend,
mismo criterio que 030 §3.1.

### 3.2 La propuesta tiene 3 tarjetas rápidas ("Lector OCR", "Ingreso manual", "Anomalías") — solo
dos aplican a este rol
El OCR de 036 es una capacidad de la cámara del celular, construida exclusivamente para AquaLectura
(el `admin_acueducto` trabaja desde escritorio, sin flujo de cámara). Se adopta la intención visual
(tarjetas de acceso rápido), no la tarjeta "Lector OCR", que no tiene ninguna funcionalidad real
detrás para este rol — agregarla sería un botón que no hace nada. Quedan dos: "Ingreso manual" (baja
a la tarjeta de carga existente) y "Anomalías" (con el conteo real de `revision !== 'normal' &&
!revisada`, filtra la tabla de abajo).

### 3.3 Encabezado con selector de periodo (`page-head` de 026)
Eyebrow "Lecturas", `<h1>Lecturas del periodo</h1>`, subtítulo con el periodo activo. El selector de
periodo y el checkbox "Solo anomalías" que ya existen se reubican en el encabezado, mismo criterio
visual que 030 con el selector de periodo de facturación. El enlace "Gestionar periodo" (página
propia, `/app/lecturas/periodo`) se mantiene tal cual, sin re-vestir en este spec — pantalla propia,
spec futuro si hace falta.

### 3.4 Tabla con `Badge` de revisión
Columnas: Suscriptor (nombre + código, cruzado como en §3.1 — "Sin suscriptor" si no hay
coincidencia, nunca un espacio vacío ambiguo), Contador (serial truncado, como hoy), Lectura
(anterior → actual + rollover si aplica), Consumo, Revisión. Mapeo de `revision` (tipo real
`RevisionLectura`, `backend/src/lib/dashboard.ts`/`frontend/lib/api.ts`) a `Badge`:
- `normal` → sin `Badge` (nada que señalar, mismo criterio que 030 con el resumen de urgencia: no
  hay ruido visual cuando no hace falta).
- `consumo_bajo` → `warning`.
- `consumo_alto` → `warning`.
- `consumo_cero` → `danger` (la señal más fuerte de las tres). Investigado contra prácticas de la
  industria de servicios públicos (CLAUDE.md §3): consumo cero en un predio activo se trata como una
  señal de mayor severidad que consumo alto/bajo — puede indicar contador atascado/roto, un bypass
  (agua consumida sin medir) o uso no autorizado, mientras que alto/bajo son variaciones dentro de lo
  esperable que solo ameritan revisión.
  [Keyrus — Automating Public Utility Meter Anomaly Detection](https://keyrus.com/us/en/playbook/automating-public-utility-meter-anomaly-detection-in-north-america).

Botón "Marcar revisada" **sin cambios de permiso** — sigue exigiendo `admin_acueducto` exactamente
como hoy (`secretaria` ve la tabla pero no revisa, mismo criterio no tocado en este spec, igual que
030 no le dio a `secretaria` el permiso de simular/emitir factura).

### 3.5 Tarjeta "Nueva lectura" re-vestida
El formulario manual que ya existe (selector de contador, fecha, lectura, botón) pasa a `Card` +
`Input`/`select` del sistema de 026 — mismo comportamiento, mismos mensajes de error.

## 4. Fuera de alcance

- **`/app/lecturas/periodo`** (gestión de periodos) — pantalla propia, spec futuro.
- **AquaLectura / `VistaLector`** — tiene su propia identidad desde 025, no se toca.
- **OCR/escaneo para el admin** — no existe como capacidad real para este rol (036 es solo de
  AquaLectura); no se agrega.
- **Cambiar el criterio de qué cuenta como anomalía** — `core/consumo.ts` no se toca, esto es
  re-vestido de lo que ya calcula el backend.
- **Paginación de la tabla** — mismo criterio que 030 §4: sin evidencia de que haga falta con
  `undreocol-produccion` todavía en 0 suscriptores.

## 5. Reglas de negocio que aplican

- `RevisionLectura` tiene exactamente 4 valores (`normal`/`consumo_alto`/`consumo_bajo`/
  `consumo_cero`) — verificar contra el tipo real antes de mapear a `Badge`, no inventar un quinto.
- CLAUDE.md §10 punto 5/6: consumo alto/bajo **marca para revisión, no bloquea el guardado** — la
  pantalla sigue mostrando y permitiendo cargar lecturas en cualquier estado de revisión, el
  `Badge` es solo informativo.
- El `lector` nunca llega a esta vista (la página ya bifurca por rol antes de renderizar
  `VistaAdmin`) — sin cambios de esa bifurcación.

## 6. Criterios de aceptación

### CA-1 — La tabla muestra las lecturas reales del periodo seleccionado
Con sesión de `admin_acueducto` real y un periodo con lecturas, cada fila coincide con lo que
devuelve `listarLecturas({ periodoId })`.

### CA-2 — El nombre del suscriptor aparece cruzado correctamente
Cada fila muestra el nombre real del suscriptor dueño del contador de esa lectura, no el UUID
truncado que muestra hoy.

### CA-3 — El `Badge` de revisión usa el color correcto para los 4 valores
`normal` sin badge, `consumo_bajo`/`consumo_alto` → `warning`, `consumo_cero` → `danger`.

### CA-4 — "Marcar revisada" sigue exigiendo `admin_acueducto`
Con sesión de `secretaria`, la tabla se ve pero el botón no aparece — mismo comportamiento de hoy.

### CA-5 — La tarjeta "Anomalías" filtra la tabla al conteo real
El número en la tarjeta coincide con `lecturas.filter(revision !== 'normal' && !revisada).length`;
tocarla activa el mismo filtro que ya existe (checkbox "Solo anomalías").

### CA-6 — El formulario "Nueva lectura" sigue funcionando igual
Mismo comportamiento, mismos mensajes de error/éxito, solo re-vestido.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El cruce cliente-side de suscriptor↔contador podría no encontrar coincidencia si `contador_actual_id` quedó desactualizado (ej. tras un reemplazo de contador, 003 regla 7) | Se muestra "Sin suscriptor" en vez de romper la fila o mostrar un nombre incorrecto — documentado, no bloqueante (CA-2) |
| Quitar la tarjeta "Lector OCR" de la propuesta podría leerse como un recorte de alcance no avisado | Se documenta explícitamente en §3.2 con la razón real (no existe esa capacidad para este rol) |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` sin hallazgos nuevos
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de `admin_acueducto` y de
      `secretaria` (CA-4)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
