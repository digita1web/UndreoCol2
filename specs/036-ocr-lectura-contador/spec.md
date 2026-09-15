# SPEC — 036: ocr-lectura-contador

**Estado:** Aprobado (2026-09-14) — implementado Sesión 056
**Depende de:** 004-lecturas-y-consumo, 025-app-lector-movil, 015-identificacion-contador-qr

**Nota de alcance:** segunda mitad de la Feature 015 del roadmap original ("QR + OCR",
`ESPECIFICACION-FUNCIONAL.md §2.14.1`), dividida en dos specs por decisión de Mateo. La
identificación por QR ya está implementada (`specs/015-identificacion-contador-qr/`). Este spec
cubre solo la sugerencia automática del número de la lectura por OCR.

## 1. Objetivo

Que al tomar una lectura, el fontanero reciba una **sugerencia** del valor numérico del contador a
partir de una foto — editable, nunca automática — en vez de tener que leer y tipear el número a
mano en todos los casos.

## 2. Por qué ahora

- Diferenciador tecnológico principal del roadmap original, marcado "requiere máximo rigor de
  precisión y confiabilidad" — ya venía con una regla de negocio no negociable definida desde la
  especificación funcional original: el número de OCR **nunca se guarda automáticamente**.
- Sus dependencias ya están satisfechas: `004-lecturas-y-consumo` (validación de rollover/anomalías)
  y `015-identificacion-contador-qr` (el flujo de cámara en "Nueva lectura" ya existe y es el punto
  de enganche natural para esta feature).

**Investigación de la comunidad (regla CLAUDE.md §3) que cambia el alcance realista de esta
feature, no solo su implementación:**
- Tesseract.js (Apache-2.0, confirmado licencia y versión real: 7.0.0) **sin entrenamiento propio no
  lee bien contadores mecánicos** — la comunidad reporta que solo se llega a >90% de precisión
  *después de entrenar un set de caracteres propio* con fotos reales del contador; el modelo de
  fábrica está pensado para texto impreso, no para ruedas mecánicas de un medidor.
  [Grupo tesseract-ocr — Meter Reading with tesseract](https://groups.google.com/g/tesseract-ocr/c/GZ81YhjpaI4).
- Entrenar un modelo propio exige un dataset de fotos reales de contadores de UndreoCol que **no
  existe todavía** (`undreocol-produccion` sigue vacía, cero suscriptores, cero fotos) — es un
  proyecto de datos aparte, no algo que quepa en esta feature.
- Decisión de Mateo, con esta investigación de por medio: **v1 es "mejor esfuerzo" honesto**,
  Tesseract.js de fábrica sin modelo propio, restringido a solo dígitos (`tessedit_char_whitelist`,
  parámetro real y documentado de la librería —
  [Tesseract.js API docs](https://github.com/naptha/tesseract.js/blob/master/docs/api.md)). El
  entrenamiento con fotos reales queda para cuando haya producción real con contadores fotografiados
  (fuera de alcance, §4).

**Segunda ronda de investigación (a pedido de Mateo, antes de aprobar) — confirma dos decisiones más:**
- **QR y OCR nunca corren sobre el mismo video en vivo, frame a frame — se descarta, no solo se
  pospone.** Tesseract.js puede tardar hasta ~30 segundos en reconocer texto de una imagen; correrlo
  en cada cuadro de un video en vivo (30-60 veces por segundo) es inviable en cualquier celular real.
  El patrón que sí usa la industria para combinar código de barras + texto en un mismo flujo es
  ejecutar cada reconocedor sobre **una imagen ya capturada**, no sobre el stream en vivo simultáneo
  ([Dynamsoft — Scan Barcodes and OCR Text from Shipping Labels](https://www.dynamsoft.com/codepool/parcel-scan-barcode-ocr-text.html)).
  Confirma y refuerza §4: QR (video en vivo, ya implementado en 015) y OCR (una foto fija, este spec)
  son y deben seguir siendo dos pasos técnicamente separados — no es una limitación a superar después,
  es como se hace bien.
- **Se descarta TensorFlow.js con un modelo de dígitos (estilo MNIST) como alternativa a
  Tesseract.js.** Un clasificador de dígitos aislados por CNN puede superar 98% sobre dígitos
  individuales ya recortados y centrados — pero ese recorte y centrado (segmentar cada dígito de la
  fila de números del contador) es exactamente el problema difícil que ya tiene el OCR de un
  contador, y TensorFlow.js no lo resuelve solo: exigiría escribir o adaptar un paso de segmentación
  de imagen propio antes de clasificar, además de sumar una dependencia nueva — más esfuerzo de
  ingeniería que `tessedit_char_whitelist` de Tesseract.js para el mismo resultado incierto en v1
  "mejor esfuerzo". Se deja anotado por si el entrenamiento propio futuro (fuera de alcance, §4)
  quisiera revisarlo con datos reales de por medio.

## 3. Alcance

### 3.1 Sugerencia de lectura al tomar una foto del contador
En "Nueva lectura" (AquaLectura, ya construida en 025), además del escaneo de QR (015, ya
implementado), un flujo para tomar o usar una foto del visor del contador que corre OCR sobre esa
imagen y **pre-llena** el campo de lectura existente con el valor detectado — el campo sigue siendo
el mismo input numérico editable de siempre, nunca se vuelve de solo lectura.

### 3.2 Aviso de higiene antes de capturar
Antes de tomar la foto, un aviso breve: "Limpiá el visor del contador antes de escanear para mejor
precisión" — ya estaba anotado en la especificación funcional original (`§2.14.1`), se mantiene tal
cual porque sigue siendo la única palanca real de precisión que tiene el fontanero en el momento.

### 3.3 Confirmación humana obligatoria
- **Nunca se guarda automáticamente (regla no negociable, ya establecida antes de este spec).** El
  valor sugerido aparece en el campo editable; el fontanero debe confirmarlo (dejarlo tal cual) o
  corregirlo antes de tocar "Guardar lectura" — el mismo botón y el mismo submit que ya exige 004,
  sin ningún atajo nuevo que lo salte.
- **Sin OCR exitoso, el campo queda vacío** y el fontanero escribe el valor a mano — exactamente el
  comportamiento de hoy, sin ningún bloqueo ni mensaje de error alarmante (una sugerencia que no
  llegó no es un fallo del sistema).

## 4. Fuera de alcance

- **Entrenar un modelo propio de Tesseract con fotos reales de contadores de UndreoCol** — depende
  de tener producción real primero (fotos de contadores reales que fotografiar y etiquetar); spec
  futuro, cuando exista ese dataset.
- **Reconocer QR e identificar el número en la misma captura de video en tiempo real,
  simultáneamente**, tal como lo describía la especificación funcional original. Descartado con
  evidencia (§2, segunda ronda): Tesseract.js puede tardar ~30 segundos por imagen, inviable sobre un
  stream de video en vivo. Corren dos reconocedores en dos pasos: `qr-scanner`/`BarcodeDetector`
  sobre el video en vivo (ya implementado en 015), Tesseract.js sobre una foto fija ya capturada
  (este spec) — el requisito de negocio es que el fontanero identifique el contador Y reciba la
  sugerencia dentro del mismo flujo de tomar una lectura, sin pasos extra injustificados, no que
  ambos reconocedores corran en el mismo instante técnico.
- **Cualquier procesamiento de imagen en el backend/Worker.** Todo el OCR corre en el navegador del
  fontanero (Tesseract.js es client-side) — ninguna foto se sube a ningún servidor para esta feature,
  ni se agrega ningún binding ni ruta nueva de backend.
- **Guardar o mostrar la foto tomada** más allá del momento de la sugerencia — `lecturas.foto_url`
  (ya existe en el esquema desde 004, para la foto opcional de la lectura) es una feature distinta,
  ya cubierta por su propio flujo; este spec no la toca.
- **Reintentar el OCR automáticamente si falla** — un solo intento por foto; si no sirve, el
  fontanero repite la captura a mano o escribe el número directamente, sin ningún mecanismo de
  reintento automático que agregue complejidad sin necesidad clara.

## 5. Reglas de negocio que aplican

- **Confirmación humana obligatoria, no negociable** (ya establecida en `ESPECIFICACION-FUNCIONAL.md
  §2.14.1` antes de este spec): el número leído por OCR nunca se guarda automáticamente, se muestra
  como sugerencia editable y el fontanero debe confirmarlo o corregirlo manualmente antes de que la
  lectura se registre. Ningún flujo de esta feature puede saltarse este paso, incluido el modo
  offline (dentro de las limitaciones ya documentadas en 015 §4: el offline real de AquaLectura sigue
  sin existir).
- Las reglas de negocio de `core/consumo.ts` (rollover, anomalías, bloqueos) no cambian — el OCR solo
  pre-llena el campo de entrada, la validación del valor final sigue siendo exactamente la misma que
  ya existe para un valor tipeado a mano.

## 6. Criterios de aceptación

### CA-1 — Tomar una foto del contador sugiere un valor en el campo de lectura
Con una foto de prueba de un contador (o una imagen de dígitos claros para la prueba automatizada),
el campo de "Lectura actual" queda pre-llenado con un valor numérico, no vacío.

### CA-2 — El valor sugerido es editable y el fontanero puede corregirlo libremente
Cambiar el valor pre-llenado y guardar registra el valor corregido, no el sugerido originalmente.

### CA-3 — Ningún flujo guarda el valor de OCR sin que el fontanero vea el campo editable
No existe ningún camino (botón, atajo, opción) que registre una lectura a partir del OCR sin pasar
por el mismo campo y el mismo botón "Guardar lectura" que ya exige confirmación explícita.

### CA-4 — Un OCR sin resultado no bloquea ni alarma
Con una foto donde el OCR no logra leer ningún dígito (foto de prueba borrosa o sin números), el
campo queda vacío, sin ningún mensaje de error — el fontanero escribe el valor a mano como hoy.

### CA-5 — El aviso de higiene se muestra antes de capturar
"Limpiá el visor del contador antes de escanear" aparece antes de que se abra la cámara para esta
captura.

### CA-6 — Ninguna foto ni dato de la imagen se envía al backend
Verificable por inspección de red (`wrangler dev`/DevTools): cero peticiones HTTP nuevas asociadas a
esta feature — todo el procesamiento de OCR ocurre en el navegador.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Precisión real baja en v1 sobre contadores mecánicos sucios o desgastados (investigado y aceptado, §2) | Es exactamente el motivo de la regla de confirmación humana obligatoria (§5) — no es un defecto a corregir después, es el diseño correcto dado el estado del arte sin modelo propio |
| Tesseract.js corriendo en el navegador puede ser lento o pesado en un celular de gama media | A medir en `/plan` con un dispositivo real; si el tiempo de procesamiento es alto, se muestra un indicador de "leyendo…" — decisión de UX de implementación, no cambia el requisito de negocio |
| El `tessedit_char_whitelist` puede no respetarse igual de estricto según el modo del motor de Tesseract 4/7 (hallazgo de la investigación) | Se valida en `/plan` contra una imagen de prueba real antes de darlo por sentado; si no filtra bien, se filtra el resultado en JavaScript después (descartar cualquier carácter no numérico de la salida) |
| El fontanero podría confiar ciegamente en la sugerencia sin mirarla, pese a que es editable | Mismo riesgo humano que ya acepta cualquier formulario pre-llenado; fuera del control del software — el campo sigue siendo clara y visualmente editable, no se oculta que es una sugerencia |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] Decisiones de implementación investigadas contra prácticas de la comunidad, fuentes
      documentadas (ya cumplido en este spec para la decisión central; cualquier decisión nueva de
      `/plan` repite el mismo criterio)
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` corrido, sin hallazgos nuevos sin revisar
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso — este spec no debería tocar backend, se
      corre igual para confirmar que de verdad no lo tocó
- [ ] Verificación manual con una foto real de un contador (o de prueba) en un navegador real
- [ ] `docs/ESPECIFICACION-FUNCIONAL.md §2.14.1` actualizado: la parte de OCR pasa de "sin empezar" a
      implementada (mejor esfuerzo v1), con nota del entrenamiento propio como mejora futura
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
