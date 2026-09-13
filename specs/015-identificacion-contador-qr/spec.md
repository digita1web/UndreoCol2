# SPEC — 015: identificacion-contador-qr

**Estado:** Borrador para aprobación
**Depende de:** 004-lecturas-y-consumo, 003-suscriptores-contadores, 025-app-lector-movil

**Nota de alcance (decisión de Mateo):** la Feature 015 del roadmap
(`ESPECIFICACION-FUNCIONAL.md §2.14.1`, "Identificación por QR + lectura automática por OCR") se
divide en dos specs porque son dos problemas de riesgo muy distinto: escanear un QR es
determinístico y con librerías maduras; el OCR sobre contadores mecánicos o sucios no tiene
precisión garantizada. Este spec cubre **solo** la identificación por QR — reemplaza el `<select>`
manual de "Nueva lectura" por un escaneo de cámara. La sugerencia automática del número por OCR
sobre esa misma captura queda para un spec posterior, con su propio número de feature; nada de este
spec depende de que el OCR exista.

## 1. Objetivo

Que el fontanero (rol `lector`) identifique el contador de un suscriptor apuntando la cámara del
celular a una etiqueta QR pegada en el medidor, en vez de tener que buscarlo en una lista
desplegable — y que el `admin_acueducto`/`secretaria` tengan de dónde sacar esa etiqueta para
pegarla en el medidor real, porque hoy no existe ninguna.

## 2. Por qué ahora

- Es el diferenciador tecnológico principal del roadmap original
  (`ESPECIFICACION-FUNCIONAL.md §2.14.1`: *"Marcada como diferenciador tecnológico principal del
  producto"*), y sus dependencias ya están satisfechas: `004-lecturas-y-consumo` está completa
  (rollover, anomalías, bloqueos) y `025-app-lector-movil` (AquaLectura) ya tiene un lugar natural
  donde enganchar el escaneo — la pestaña "Nueva lectura".
- **Investigación previa a este spec encontró dos huecos reales que cambian el alcance frente a lo
  que describe la especificación funcional:**
  1. El flujo "Escanea QR → Contador identificado automáticamente" de `§2.14` **nunca se
     construyó** — el "Nueva lectura" real de hoy (`nueva-lectura-lector.tsx`) identifica el
     contador con un `<select>` de la lista de suscriptores del acueducto, nunca con cámara. `025`
     dejó explícito el ícono de cámara "para cuando 015 se implemente de verdad" (spec 025 §4).
  2. **No existe ninguna forma de generar o imprimir una etiqueta QR de un contador.** Sin eso, no
     hay nada físico que pegar en el medidor ni que el lector pueda escanear — por eso entra en el
     alcance de este spec (§3.1), no solo el lado del escaneo.
- `ESPECIFICACION-FUNCIONAL.md §2.14.1` titula esta sección *"Feature 014"* dos veces, pero
  `025-app-lector-movil` y `docs/PLAN-PRODUCCION.md` la refieren como *"Feature 015"* en todos los
  demás lugares — inconsistencia de numeración entre los propios documentos. Este spec usa **015**
  (el número que ya usan la mayoría de las referencias existentes) y corrige el encabezado de
  `§2.14.1` a "Feature 015" como parte de este mismo trabajo, sin abrir un spec aparte por una
  corrección de una palabra.

## 3. Alcance

### 3.1 Generar y ver la etiqueta QR de un contador
En la ficha del suscriptor (`/app/suscriptores/[id]`, tarjeta "Contador" que ya muestra
serial/capacidad/fecha de instalación), un botón nuevo "Ver etiqueta QR" abre una vista que
renderiza el código QR de ese contador, con su `serial` como texto legible al lado (para el caso en
que alguien necesite identificarlo a simple vista, sin escanear). El QR codifica el `id` del
contador (UUID ya existente, único globalmente — no el `serial`, que solo es único dentro de un
mismo acueducto y podría repetirse entre acueductos distintos con la misma marca de contador).

### 3.2 Imprimir la etiqueta — mismo patrón que las facturas (D-8)
La vista de la etiqueta se imprime con `Ctrl+P` y una hoja de estilos `@media print` pensada para
una etiqueta física pequeña (tamaño y disposición a definir en `/plan`) — **el mismo criterio ya
establecido para la entrega de facturas** (CLAUDE.md §6, D-8: flujo principal es impresión desde
pantalla, sin generar ningún PDF ni usar ninguna librería para esto). Cero infraestructura nueva.

### 3.3 Escanear el QR desde "Nueva lectura" (rol `lector`)
En `nueva-lectura-lector.tsx`, junto al `<select>` actual, un botón "Escanear QR" abre la cámara del
celular. Al detectar un QR válido, busca su contenido (el `id` del contador) **entre los datos ya
cargados en esa sesión** (`suscriptores`, la misma prop que ya recibe el componente — sin pedir nada
nuevo al backend) y, si lo encuentra, preselecciona ese contador exactamente como si se hubiera
elegido del `<select>` — el fontanero sigue viendo a quién le está tomando la lectura antes de
guardar, no se salta esa confirmación visual.

### 3.4 El `<select>` manual nunca se elimina
Cámara con mala luz, lente sucia, QR dañado/despegado, o un celular sin cámara utilizable: el
`<select>` sigue ahí, siempre disponible, como hoy. El escaneo es un atajo más rápido, no un
reemplazo obligatorio — ninguna lectura puede quedar bloqueada porque el escaneo falló.

### 3.5 Permiso de cámara del navegador
`frontend/next.config.ts` hoy manda `Permissions-Policy: camera=()` en **todas** las rutas
(hallazgo B-6 de la auditoría pre-producción) — bloquea la cámara incluso donde este spec la
necesita. Se ajusta esa cabecera para permitir cámara en la ruta de la app del lector, sin
abrirla en el resto del panel (portal del suscriptor, facturación, etc. no la necesitan).

## 4. Fuera de alcance

- **OCR de la lectura del contador** — spec posterior, número propio, cuando este spec esté cerrado
  y Mateo decida seguir (ver nota de alcance arriba).
- **Uso real, offline, del escaneo.** Investigación previa a este spec encontró que **hoy no existe
  ningún Service Worker ni cola de sincronización real** para lecturas — `listarSuscriptores()` y
  `crearLectura()` son llamadas de red directas, sin caché ni cola local; `id_cliente_offline` existe
  como campo opcional en el tipo del payload pero nada lo genera ni lo envía todavía. El escaneo de
  este spec depende de que `suscriptores` ya se haya cargado en esa sesión — mismo requisito que ya
  tiene hoy el `<select>` manual. No es una regresión de este spec ni tampoco lo resuelve: construir
  offline-first real de punta a punta es una feature propia, mucho más grande, no incluida acá.
- **Reimpresión automática de la etiqueta al reemplazar un contador.** Un reemplazo de contador
  (regla de dominio 7, CLAUDE.md §10) crea una fila nueva en `contadores` con un `id` distinto — la
  etiqueta vieja pegada en el medidor físico queda apuntando al contador reemplazado. Reimprimir y
  volver a pegar la etiqueta es un paso manual más del mismo procedimiento físico de cambiar el
  medidor (ya es manual hoy); no se construye ninguna alerta ni recordatorio automático.
- **Asignación de rutas/zonas al lector** — feature distinta del roadmap, sigue sin especificar.
- **Generar QR en lote / imprimir varias etiquetas a la vez** — no pedido; se genera una por una,
  desde la ficha de cada contador.
- **Cambiar qué codifica el QR una vez emitido** — el `id` de un contador no cambia nunca durante su
  vida útil (spec §3.1); si se necesitara reemitir por daño físico de la etiqueta, es la misma
  pantalla de "Ver etiqueta QR" de siempre, sin ningún estado ni bandera nueva que trackear.

## 5. Reglas de negocio que aplican

- El QR codifica el `id` del contador, no el `serial` — evita cualquier ambigüedad entre acueductos
  distintos (regla nueva de este spec, justificada en §3.1).
- El fontanero (`lector`) solo ve/escanea contadores de su propio acueducto — ya lo garantiza hoy la
  RLS de `contadores` (`contadores_lectura`, `cliente_id in (select mis_clientes())`); este spec no
  cambia RLS ni agrega ninguna consulta nueva al backend.
- Ninguna lectura se registra automáticamente por el solo hecho de escanear un QR — escanear
  identifica el contador, exactamente igual que elegirlo del `<select>`; ingresar y confirmar el
  valor de la lectura sigue siendo un paso separado y explícito (mismo criterio que la regla de
  confirmación humana de la sección de OCR, aunque este spec no toca OCR — aplica igual acá: nunca
  autocompletar una acción de negocio solo porque un sensor leyó algo).

## 6. Criterios de aceptación

### CA-1 — La ficha de un contador muestra su etiqueta QR
Desde `/app/suscriptores/[id]`, con un contador instalado, "Ver etiqueta QR" muestra un QR válido
(verificable escaneándolo con cualquier lector de QR estándar) junto al `serial` en texto.

### CA-2 — La etiqueta se imprime con el mismo criterio que una factura
`Ctrl+P` sobre la vista de la etiqueta produce una hoja imprimible legible, sin generar ningún PDF
ni abrir ninguna ventana de descarga.

### CA-3 — Escanear el QR de un contador real preselecciona ese contador
Con la cámara del celular (o la webcam en modo responsivo, para pruebas): escanear la etiqueta de un
contador de prueba dentro de "Nueva lectura" deja preseleccionado exactamente ese contador — mismo
resultado final que elegirlo del `<select>`.

### CA-4 — Escanear un QR que no corresponde a ningún contador del acueducto no rompe nada
Muestra un aviso claro ("Este código no corresponde a ningún contador de tu acueducto") y deja el
`<select>` disponible para seguir manualmente — nunca una pantalla en blanco ni un error sin
explicación.

### CA-5 — El resto del panel sigue sin acceso a cámara
Ninguna otra ruta del panel administrativo ni del portal del suscriptor pide permiso de cámara —
verificable con las cabeceras `Permissions-Policy` reales de cada ruta.

### CA-6 — El `<select>` manual sigue funcionando exactamente igual que hoy
Sin tocar la cámara, registrar una lectura eligiendo el contador de la lista produce el mismo
resultado que antes de este spec — regresión cero sobre 025.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Permiso de cámara denegado por el usuario o el navegador | El `<select>` manual sigue siempre disponible (§3.4) — el escaneo nunca es la única vía |
| Etiqueta QR dañada, sucia o mal impresa, ilegible para la cámara | Mismo caso que "permiso denegado" — cae al `<select>` manual; no se agrega ningún reintento especial más allá del que ya ofrece la librería de escaneo (a elegir en `/plan`) |
| Confundir el escaneo con una lectura automática de la cifra del contador | Es exactamente el malentendido que motivó separar QR de OCR en dos specs (nota de alcance) — este spec identifica el contador, nunca lee ni sugiere ningún número; se refuerza en la UI con el texto del botón ("Escanear QR del contador", no "Escanear lectura") |
| Reemplazo de contador deja una etiqueta física apuntando al `id` viejo | Documentado como fuera de alcance (§4) — mismo tipo de paso manual que ya exige hoy cambiar el medidor físico |
| Alguien imprime la etiqueta de un contador y la pega en el medidor equivocado (error humano, no del sistema) | Fuera del control del software; el `serial` en texto junto al QR (§3.1) ayuda a verificar visualmente antes de pegar |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso — aunque este spec no debería tocar backend,
      se corre igual para confirmar que de verdad no lo tocó
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] Verificación manual con cámara real (celular o webcam), no solo con datos de prueba fijos
- [ ] `docs/ESPECIFICACION-FUNCIONAL.md §2.14.1`: encabezado corregido de "Feature 014" a
      "Feature 015" (ver nota de alcance), y anotado que se dividió en dos specs
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
