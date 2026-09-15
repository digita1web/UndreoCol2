# ESPECIFICACION-FUNCIONAL.md — UndreoCol

**Versión:** 2.0
**Fecha:** 2026-08-31
**Fuente:** especificación entregada por Mateo Castro, fundador, refinada en sesión
conjunta.

Este documento es la fuente de verdad de **qué debe hacer el sistema**.
No describe implementación. Si hay contradicción entre este documento y el
código, el código está mal.

---

## 1. Descripción del producto

UndreoCol es un SaaS colombiano para la gestión integral de acueductos
comunitarios y pequeñas empresas de servicios públicos. Cubre el ciclo completo:
registro de suscriptores, toma de lecturas en campo, facturación por consumo,
recaudo, cortes y reconexiones por mora, RRHH básico e indicadores operativos.

**Modelo de negocio:** suscripción mensual cobrada al acueducto según el número
de suscriptores activos (~$700 COP/suscriptor/mes).

**Fundador:** Mateo Castro — más de 3 años de experiencia en el sector.

**Infraestructura:** Cloudflare (Pages, Workers, R2, Queues) + Supabase
(PostgreSQL, Auth, RLS), sin servidor propio. Ver `ARQUITECTURA.md` y
`docs/DECISIONES.md` D-6.

---

## 2. Modelo de datos y reglas de negocio

### 2.1 Acueducto (cliente de UndreoCol)

Cada acueducto cliente tiene sus datos completamente aislados de otros clientes,
garantizado por Row Level Security de PostgreSQL.

Atributos: nombre, NIT, dirección, municipio, departamento, teléfono, logo,
plan de suscripción, estado de la cuenta (activa / vencida / suspendida /
cancelada).

---

### 2.2 Configuración por acueducto

Cada acueducto tiene sus propios umbrales configurables:

| Parámetro | Descripción | Valor por defecto |
|---|---|---|
| `porcentaje_mora` | % sobre el saldo vencido del suscriptor | 2.0% |
| `dias_vencimiento` | Días desde emisión hasta vencimiento de la factura | 30 |
| `dias_umbral_corte` | Días de cartera vencida que disparan la orden de corte | 60 |
| `valor_reconexion` | Cargo de la factura de reconexión | Configurable |
| `factor_consumo_alto` | % del promedio histórico para marcar consumo alto | 150% |
| `piso_consumo_alto_m3` | Mínimo en m³ para marcar consumo alto | 100 m³ |
| `factor_consumo_bajo` | % del promedio histórico para marcar consumo bajo | 20% |
| `umbral_rollover_pct` | % de capacidad máxima para detectar rollover | 90% |
| `prefijo_factura` | Prefijo del número de factura para ciclo y ajuste | FAC |
| `prefijo_reconexion` | Prefijo del número de factura para reconexión | REC |
| `consecutivo_factura` | Último consecutivo emitido en el año actual | 0 |
| `anio_consecutivo` | Año al que pertenece el consecutivo actual | año actual |

---

### 2.3 Catálogo de servicios

Cada acueducto configura qué servicios cobra. El sistema no asume que todos
cobran los mismos servicios.

Atributos de cada servicio: código (acueducto, alcantarillado, aseo,
reconexión…), nombre, tipo de cálculo, si se incluye en el ciclo mensual.

**Tipos de cálculo:**
- `por_consumo`: genera un cargo fijo + cálculo sobre el consumo en m³
- `fijo`: genera solo el cargo fijo, sin importar el consumo

Un mismo consumo en m³ se factura por todos los servicios activos del acueducto.

---

### 2.4 Tarifas

Cada servicio tiene su propia tarifa, diferenciada por categoría tarifaria y
versionada por fecha de vigencia.

**Categorías tarifarias:** estrato 1, 2, 3, 4, 5, 6 · comercial · industrial ·
oficial.

**Estructura de la tarifa (para servicios `por_consumo`):**

| Campo | Descripción |
|---|---|
| `cargo_fijo` | Cobro fijo mensual, independiente del consumo |
| `limite_basico_m3` | Consumo básico subsidiado — **INCLUSIVO** (D-1) |
| `precio_basico_m3` | Precio por m³ dentro del límite básico |
| `precio_no_basico_m3` | Precio por m³ que excede el límite básico |

**Fórmula de cálculo por servicio (decisión D-1):**

```
consumo_basico_m3    = min(consumo_m3, limite_basico_m3)
consumo_no_basico_m3 = max(0, consumo_m3 − limite_basico_m3)

subtotal = cargo_fijo
         + (consumo_basico_m3 × precio_basico_m3)
         + (consumo_no_basico_m3 × precio_no_basico_m3)
```

El `limite_basico_m3` es **inclusivo**: con límite 22 m³ y consumo 25 m³,
los m³ 1–22 van a precio básico y los m³ 23–25 a precio no básico.

**Ejemplo real de referencia (Soacha, ⚠️ valores aproximados — D-5):**

> Estrato 3, consumo 25 m³ → Acueducto $69.104 + Alcantarillado $63.554 =
> Total $132.658

---

### 2.4.1 Gestión de cambios de tarifa — en tiempo real

**El administrador del acueducto puede modificar sus tarifas en cualquier
momento desde el panel.** El cambio tiene efecto inmediato para los cálculos
futuros. No requiere intervención del dueño del software.

#### Cómo funciona internamente

Una tarifa **nunca se edita**. Cuando el administrador cambia un precio, el
sistema crea un nuevo registro de tarifa con `vigencia_desde = hoy` y cierra
la tarifa anterior poniendo su `vigencia_hasta = ayer`.

```
Antes del cambio:
  Tarifa A — estrato 3 acueducto — vigencia_desde: 2024-01-01 — vigencia_hasta: null

Después de cambiar el precio el 15 de septiembre de 2026:
  Tarifa A — estrato 3 acueducto — vigencia_desde: 2024-01-01 — vigencia_hasta: 2026-09-14
  Tarifa B — estrato 3 acueducto — vigencia_desde: 2026-09-15 — vigencia_hasta: null
```

El sistema **siempre busca la tarifa vigente en la fecha de emisión del
periodo**, no la más reciente.

#### Reglas de integridad de los cambios

| Regla | Por qué |
|---|---|
| Una sola tarifa activa por servicio + categoría en un momento dado | No puede haber dos precios simultáneos |
| La tarifa anterior queda cerrada automáticamente | No se puede eliminar: las facturas históricas la referencian |
| Una tarifa con facturas emitidas **nunca se elimina**, solo se cierra | `factura_detalles.tarifa_id` apunta a la tarifa usada al facturar |

#### Cambio de tarifa dentro de un periodo abierto

Si el administrador cambia la tarifa **durante** un periodo que aún no se ha
cerrado, el cierre usa la tarifa vigente **en la fecha en que se ejecuta el
cierre**, no la que estaba vigente al inicio del periodo.

#### Resumen para el administrador del acueducto

> Puede cambiar los precios cuando quiera. El cambio aplica al siguiente
> cierre de facturación. Las facturas ya enviadas no se tocan.

---

### 2.5 Suscriptor (Usuario de servicio)

Atributos: código de suscriptor (único por acueducto), nombre, tipo y número de
documento, teléfono, email, dirección, sector, categoría tarifaria, contador
actual, estado, fecha de vinculación.

**Estados:** activo · suspendido · cortado · inactivo.

Un suscriptor en estado `cortado` sale del ciclo normal de lecturas y
facturación hasta reconexión.

**Acceso al portal (decisión D-2):**
El suscriptor no tiene cuenta en el sistema de autenticación (Supabase Auth).
El portal valida `numero_documento` + `codigo_suscriptor` en un Worker de
Cloudflare y emite una sesión propia firmada. No necesita contraseña.

La sesión dura **30 días con renovación automática** (D-4). Se guarda en una
cookie HttpOnly + Secure + SameSite=Lax. Si el suscriptor no visita en 30 días,
debe volver a autenticarse. Si pierde su `codigo_suscriptor`, el administrador
del acueducto puede regenerarlo desde el panel.

---

### 2.6 Contador

Atributos: serial, marca, capacidad máxima del display (ej. 99999), lectura
inicial, fecha de instalación, estado.

**Estados:** activo · dañado · reemplazado.

Un suscriptor tiene **un solo contador activo** a la vez.

**Detección de rollover:**
Se produce rollover cuando **ambas** condiciones se cumplen:

```
lectura_actual < lectura_anterior
Y
lectura_anterior > capacidad_maxima × (umbral_rollover_pct / 100)
```

Si se cumple:
```
consumo_m3 = (capacidad_maxima − lectura_anterior) + lectura_actual
```

Si `lectura_actual < lectura_anterior` pero no se cumple la condición de
rollover, es un error de digitación o un contador dañado. Se rechaza la lectura:
no se factura en negativo ni en cero en silencio.

**Reemplazo de contador a mitad de periodo:**
Cuando se cambia el contador físico, se registra la lectura final del saliente y
la lectura inicial del entrante. El consumo del periodo completo es:

```
consumo_total = (lectura_final_saliente − última_lectura_del_saliente)
              + (lectura_actual_entrante − lectura_inicial_entrante)
```

Se genera **una sola factura** que vincula las lecturas de ambos contadores. No
se duplica ni se pierde consumo.

---

### 2.7 Periodo de facturación

Atributos: año, mes, nombre, fechas de inicio/fin/vencimiento, estado
(abierto / cerrado).

**Regla crítica: solo puede haber UN periodo abierto por acueducto a la vez.**
Garantizado por índice único parcial en la base de datos.

Un periodo cerrado es **inmutable**. No se aceptan lecturas ni cambios. Corregir
algo de un periodo cerrado exige una nota de ajuste en el periodo actual.

---

### 2.8 Lectura

Atributos: contador, periodo, fecha, lectura anterior, lectura actual, consumo
calculado, si hubo rollover, estado de revisión, tomada por, foto (opcional),
coordenadas.

**Toma de lectura desde la PWA del lector:** el lector escanea un código QR para
identificar el contador (evita error de digitación del serial), introduce la
lectura, y opcionalmente toma una foto. La app funciona sin conexión y
sincroniza al recuperar señal.

**Consumo:** se calcula automáticamente al guardar, incluyendo rollover.

**Bloqueos:**
- Lectura duplicada del mismo contador en el mismo periodo → rechazada
- Lectura fuera de orden cronológico → rechazada
- Lectura en un periodo cerrado → rechazada

**Detección de anomalías** (marcan para revisión, **nunca bloquean el guardado**):

| Anomalía | Criterio |
|---|---|
| Consumo alto | `> factor_consumo_alto%` del promedio histórico **Y** `> piso_consumo_alto_m3` |
| Consumo bajo | `< factor_consumo_bajo%` del promedio histórico |
| Consumo cero | `consumo_m3 = 0` |

El `piso_consumo_alto_m3` existe porque pasar de 2 a 4 m³ cuadruplica el
promedio sin ser una anomalía real.

Las lecturas tomadas desde el celular son idempotentes: si el dispositivo reenvía
por falla de red, no se duplica la lectura (`id_cliente_offline`).

---

### 2.9 Factura

**Tipos:** ciclo (mensual normal) · reconexión (cargo independiente) · ajuste.

**Una sola factura de tipo `ciclo` por suscriptor y periodo.** Garantizado por
índice único parcial.

**Formato del número de factura (decisión D-3):**
`{prefijo}-{YYYY}-{NNNNN}` — ejemplo: `FAC-2026-00347`, `REC-2026-00003`.
El consecutivo tiene 5 dígitos y **reinicia en 1 cada año**. Ciclo y reconexión
comparten el mismo consecutivo anual pero usan prefijos distintos. La generación
es atómica (transacción con `SELECT FOR UPDATE`) para garantizar unicidad.

**Composición de la factura:**

```
Total = subtotal_servicios + recargo_mora + saldo_anterior
```

Donde:
- `subtotal_servicios` = suma de los subtotales de cada servicio activo del
  acueducto, todos calculados sobre el mismo `consumo_m3`
- `recargo_mora` = `porcentaje_mora %` sobre el saldo vencido del **mismo**
  suscriptor, **excluyendo la factura actual**
- `saldo_anterior` = deuda de periodos anteriores no pagada

El desglose se guarda renglón por renglón (`factura_detalles`) con las
cantidades y valores por bloque, de forma que se pueda auditar el cálculo años
después.

La factura guarda un `snapshot_suscriptor` inmutable con el nombre, dirección,
categoría y código del suscriptor al momento de emitir. Si el suscriptor cambia
de categoría o dirección después, la factura histórica no se altera.

**Estados:** pendiente · pagada · vencida · anulada.

**Una factura emitida es inmutable.** Si está mal, se anula con motivo y
responsable, y se emite la corrección. Un periodo cerrado no se reabre.

**Factura de reconexión:** se genera automáticamente al reconectar a un
suscriptor. Es independiente del ciclo mensual, con el cargo configurable del
acueducto.

---

### 2.9.1 Entrega de la factura (decisión D-8)

**Flujo principal: impresión.** La mayoría de acueductos colombianos entregan la
factura impresa en papel. El administrador ve el listado de facturas del
periodo cerrado en pantalla y las imprime con el navegador, usando una hoja de
estilos diseñada para impresión (formato carta o media carta, logo del
acueducto, desglose completo por servicio). No se genera ningún archivo PDF en
este flujo — es una impresión directa desde la vista web.

**Flujo secundario: correo electrónico.** Para el subconjunto de suscriptores
que tienen email registrado y para acueductos que quieran usar este canal,
el sistema puede enviar la factura por correo electrónico, con el desglose
como PDF adjunto (generado con `pdf-lib`, ver `docs/DECISIONES.md` D-9). Este
envío es opcional, se activa por suscriptor o de forma masiva a petición del
administrador, y **nunca bloquea el cierre del periodo** si falla: queda
registrado como una notificación pendiente que se reintenta.

---

### 2.10 Pago

Un pago puede aplicar a una o varias facturas. Puede quedar un sobrante a favor
del suscriptor que se aplica a la siguiente factura como saldo a favor.

Registrar un pago actualiza el estado de la factura automáticamente.

Un pago no se borra: se **anula** con motivo y responsable.

---

### 2.11 Cortes y reconexiones

**Corte automático:** cuando la cartera vencida del suscriptor supera
`dias_umbral_corte` días, el sistema genera una orden de corte automática.

**Corte manual:** el administrador del acueducto puede generarlo en cualquier
momento con un motivo.

Al ejecutar el corte (desde el celular del lector), el suscriptor pasa a estado
`cortado` y deja de recibir lecturas y facturas del ciclo normal.

**Reconexión:**
- Bloqueada mientras haya deuda vencida sin pagar
- Excepción: se puede forzar con un motivo explícito y un autorizador
  identificado. El rastro queda en la orden. No hay reconexión silenciosa.
- Al reconectar se genera automáticamente una factura de reconexión independiente

---

### 2.12 Notificaciones

**Eventos que generan notificación:** factura generada (solo si se solicitó
envío por correo, ver 2.9.1) · recordatorio de vencimiento · aviso de mora ·
confirmación de pago.

**Regla crítica:** un fallo de envío **nunca** bloquea el flujo principal. La
cola de notificaciones es desacoplada. Un suscriptor sin email no rompe la
facturación — de hecho, la mayoría de suscriptores no requieren correo, porque
reciben su factura impresa.

---

### 2.13 Portal de autoservicio

El suscriptor consulta:
- Su factura actual
- Su historial de consumo
- Descarga del PDF de su factura (generado bajo demanda con `pdf-lib`)

Autenticación: `numero_documento` + `codigo_suscriptor`. Sin contraseña.
Sin cuenta en el sistema de identidad (D-2).

---

### 2.14 App móvil de lecturas (PWA)

Usada por el lector/fontanero en campo. Es una Progressive Web App (Next.js +
Service Worker) instalable desde el navegador en Android, sin necesidad de
Play Store.

**Flujo:**
```
Inicia sesión (Supabase Auth)
       ↓
Ve su ruta asignada
       ↓
Escanea el código QR del contador
       ↓
Contador identificado automáticamente
       ↓
Introduce la lectura
       ↓
Validación matemática (rollover, anomalías) en el dispositivo
       ↓
Foto opcional del contador
       ↓
Guarda (funciona sin conexión)
       ↓
Sincroniza al recuperar señal
```

Funciona **sin señal** (offline-first). Al recuperar conexión, sincroniza las
lecturas tomadas. Idempotente: no duplica (`id_cliente_offline`).

**Estado real de este flujo (Sesión 056):** "Ve su ruta asignada" sigue sin construirse (037,
specs/plan/tasks aprobados, implementación pendiente) — hoy el lector ve todos los suscriptores de
su acueducto. QR (015) y la sugerencia de lectura por foto/OCR (036, mejor esfuerzo v1) están
implementados. **El guardado sin señal e idempotente ya es real** (`specs/038-offline-lecturas-lector/`):
la lectura se guarda en una cola local (IndexedDB) del navegador y se sube sola al recuperar
conexión, reutilizando el `id_cliente_offline` que ya deduplicaba del lado del servidor desde 004
pero que hasta esta sesión ningún flujo del frontend generaba. **Matiz honesto sobre "PWA con
Service Worker" del párrafo de arriba:** 038 decidió, con investigación de comunidad de por medio
(`specs/038-offline-lecturas-lector/spec.md` §2), **no** construir un Service Worker ni Background
Sync API en v1 — la sincronización corre en la página mientras AquaLectura está abierta (al montar
y en cada evento `online` del navegador), lo que cubre el uso real (el fontanero tiene la app
abierta durante su jornada), no una sincronización en segundo plano con la app cerrada. Esa mejora
queda anotada, no descartada, para si hace falta más adelante.

---

### 2.14.1 Identificación de contador por QR (Feature 015) + sugerencia de lectura por OCR (Feature 036)

**Marcada como diferenciador tecnológico principal del producto.** Requiere
máximo rigor de precisión y confiabilidad — ver la regla de confirmación
humana obligatoria más abajo, que no es negociable.

**Dividida en dos specs (decisión de Mateo, Sesión 054):** son dos problemas de riesgo muy
distinto — escanear un QR es determinístico y con librerías maduras; el OCR sobre contadores
mecánicos o sucios no tiene precisión garantizada. **Las dos partes ya están implementadas:**
identificación por QR (`specs/015-identificacion-contador-qr/`) y sugerencia de lectura por OCR
(`specs/036-ocr-lectura-contador/`, **mejor esfuerzo v1**, sin modelo propio entrenado — ver más
abajo). Ambas viven hoy en `NuevaLecturaLector`
(`frontend/components/lector/nueva-lectura-lector.tsx`).

**El flujo objetivo original de abajo tenía un paso incorrecto, corregido durante `/specify` de 036
con evidencia (no solo pospuesto):** QR y OCR **nunca corren sobre el mismo video en vivo, frame a
frame** — Tesseract.js puede tardar hasta ~30 segundos por imagen, inviable sobre un stream a
30-60 cuadros por segundo. Son y quedan dos pasos técnicamente separados dentro del mismo flujo de
"Nueva lectura": QR sobre video en vivo (`EscanerQrContador`, 015), OCR sobre una foto fija ya
capturada vía `<input type="file" capture="environment">` (`SugerirLecturaFoto`, 036) — nunca
simultáneos. El paso 4 de abajo queda corregido en ese sentido.

**Flujo real implementado:**

```
1. Cada contador tiene un QR físico único pegado en el medidor
2. El fontanero (rol Lector) abre "Nueva lectura" en AquaLectura
3. Antes de escanear o fotografiar, se muestra un aviso:
   "Limpiá el visor del contador antes de escanear/fotografiar para mejor precisión"
4. El fontanero identifica el contador (QR, video en vivo) y, en un paso
   aparte dentro del mismo flujo, puede pedir una sugerencia de lectura a
   partir de una foto fija (OCR) — no son simultáneos
5. El número leído por OCR se muestra como SUGERENCIA EDITABLE en el mismo
   campo de lectura de siempre — nunca en un campo aparte de solo lectura
6. Al confirmar, se registra la Lectura normalmente (reutiliza toda la
   lógica ya construida en 004-lecturas-y-consumo — validación de rollover,
   detección de anomalías, bloqueos de duplicado/orden cronológico, etc.)
```

**Regla de negocio — confirmación humana obligatoria (no negociable):**
la precisión del OCR sobre contadores mecánicos o sucios no es 100%
confiable. El número leído por OCR **nunca se guarda automáticamente**: se
muestra como sugerencia editable y el fontanero debe confirmarlo o
corregirlo manualmente antes de que la lectura se registre. Ningún flujo de
esta feature puede saltarse este paso, incluido el modo offline.

**Dependencias — ya satisfechas:**
`004-lecturas-y-consumo` está completa (CHANGELOG Sesión 011): el rol
`lector` ya puede crear y ver lecturas de su propio acueducto por RLS
(`supabase/migrations/20260904090000_lecturas-consumo.sql`). Precisión: la
asignación de rutas/órdenes a un lector específico (CLAUDE.md §10 punto 24,
"ejecuta órdenes asignadas a él") **no existe todavía** como feature propia
— hoy el lector ve las lecturas de todo su acueducto, no solo las de una
ruta asignada. Esto no bloqueó 015 ni 036, que solo necesitaban que el flujo
de captura de una lectura individual ya existiera.

**Tecnología real del QR** (`specs/015-identificacion-contador-qr/`):
`qr-scanner` (MIT) para escanear — usa la API nativa `BarcodeDetector` del navegador cuando está
disponible, con `jsQR` como respaldo — y `qrcode` (MIT) para generar la etiqueta, con
`errorCorrectionLevel: 'H'`.

**Tecnología real del OCR** (`specs/036-ocr-lectura-contador/`): `tesseract.js` 7.0.0 (Apache-2.0),
restringido a dígitos (`tessedit_char_whitelist`), sobre una foto preprocesada a escala de grises
en Canvas nativo — corre entero en el navegador del fontanero, ninguna foto se envía al backend.
**Es "mejor esfuerzo" honesto, no de alta precisión:** la comunidad de Tesseract reporta que sin
entrenar un set de caracteres propio con fotos reales de contadores mecánicos, la precisión de
fábrica es baja — de ahí que la confirmación humana de arriba sea no negociable, no una
protección de más. Entrenar un modelo propio queda **fuera de alcance** hasta que exista
producción real con fotos de contadores para armar ese dataset (`specs/036-ocr-lectura-contador/spec.md`
§2, §4 — fuentes documentadas ahí). Ambas decisiones (QR y OCR) documentadas con fuente en su
spec/plan respectivo (regla de CLAUDE.md §3: ninguna decisión de implementación se inventa).

---

### 2.15 Dashboard de indicadores

| Indicador | Descripción |
|---|---|
| Recaudo del mes actual | Total cobrado en el periodo abierto |
| Cartera vencida | Total de facturas vencidas o pendientes con mora |
| Usuarios en mora | Conteo de suscriptores con deuda vencida |
| Consumo promedio | Del último periodo cerrado |
| Tendencia de recaudo | Últimos 12 meses |
| Suscriptores por estado | Activo / Suspendido / Cortado / Inactivo |

---

### 2.16 RRHH e incapacidades

Módulo independiente. No depende del módulo de facturación.

**Empleado:** nombre, documento, cargo, salario base, EPS, ARL, fondo de
pensiones, fecha de ingreso.

**Incapacidad — tramos legales (Colombia):**

| Días acumulados | Porcentaje | Responsable |
|---|---|---|
| 1–2 | 66.67% | Empleador (no recobrable) |
| 3–90 | 66.67% | EPS |
| 91–180 | 50% | EPS |
| Accidente/enfermedad laboral | 100% desde el día 1 | ARL |
| 181+ | No se calcula automático | Gestión manual |

**Prórrogas:** continúan el conteo acumulado del certificado original. Una
prórroga que arranca en el día 91 del conteo acumulado se liquida al 50%,
no al 66.67%.

---

### 2.17 Exportes contables

Libro de ingresos según estructura PUC colombiana (Decreto 2650/1993).

**Siempre con advertencia visible:** debe ser revisado por un contador público
antes de cualquier uso oficial.

---

## 3. Roles y permisos

### Administrador (dueño del software — UndreoCol)
- Acceso total a todos los acueductos
- Gestiona planes, clientes, estado de cuentas
- Puede crear usuarios con cualquier rol
- **Panel de plataforma (`/plataforma`, feature 018):** da de alta un acueducto
  nuevo (nombre + identificador/slug) junto con su primer administrador
  (nombre + correo). El sistema genera una contraseña temporal que se muestra
  una sola vez, para que el superadmin se la entregue al admin nuevo por un
  canal seguro. El sistema todavía no fuerza un cambio de contraseña en el
  primer login (queda anotado como mejora futura). Es la única vía de alta
  hoy — no hay invitación por correo con autoservicio (mejora futura, feature
  019)

### Administrador de acueducto
- Gestiona su propio acueducto completo: suscriptores, tarifas, facturas, pagos,
  empleados, incapacidades, órdenes
- **Nunca** puede ver otros acueductos
- **Nunca** puede tocar configuración técnica del sistema
- **Nunca** puede otorgarse a sí mismo ni a nadie el rol de administrador de la
  plataforma — bloqueado en la base de datos, no solo en la interfaz
- Puede crear usuarios con rol lector dentro de su acueducto

### Lector / Fontanero
- Solo puede crear y ver lecturas
- Solo puede ver y ejecutar órdenes de corte/reconexión **asignadas a él**
- Usa la PWA desde el celular, con soporte offline

**Protección del acceso administrativo.** Tras 5 intentos fallidos consecutivos contra
el mismo correo, el sistema empieza a rechazar el acceso con una espera que crece:
1, 2, 4, 8, 16, 32 y hasta 60 minutos. Durante la espera no entra nadie, ni siquiera
con la contraseña correcta —si un acierto pudiera saltarse la espera, la protección no
serviría de nada, porque adivinar la contraseña es justamente el objetivo del ataque—.
Pasada la espera, el primer acceso correcto borra el contador. Sin actividad durante 24
horas, el contador también se borra solo, para que fallos sueltos a lo largo de meses no
acaben bloqueando a nadie.

El sistema cuenta los intentos contra correos que **no existen** exactamente igual que
contra los registrados. Es deliberado: si solo se bloquearan los correos reales, el
propio bloqueo revelaría qué cuentas existen.

**Es el equivalente para el administrador de lo que §2.5 describe para el portal del
suscriptor**, y su ausencia fue el hallazgo A-2 de la auditoría de seguridad
pre-producción.

### Suscriptor (portal)
- No tiene cuenta en el sistema de identidad (D-2)
- Accede con `numero_documento` + `codigo_suscriptor`
- Solo ve sus propios datos: factura actual, historial, descarga de PDF
- Nunca ve datos de otros suscriptores

---

## 4. Qué está fuera del sistema

- Facturación electrónica DIAN — bloqueado hasta validación con contador público
- Integración con bancos o pasarelas de pago en línea — fase posterior
- Contabilidad completa — fase posterior
- Multi-idioma
- Generación de PDF como parte del flujo principal de facturación (ver D-8) —
  la impresión directa desde el navegador es el flujo principal