# SPEC — 025: app-lector-movil

**Estado:** Borrador para aprobación
**Depende de:** 004-lecturas-y-consumo, 024-permisos-lector

## 1. Objetivo

Rediseñar `/app/lecturas` para el rol `lector` con una identidad visual propia ("AquaLectura",
propuesta de Mateo) pensada para el celular del fontanero en campo, en vez del mismo layout de
escritorio que comparte hoy con el `admin_acueducto`. Es un rediseño de **interfaz**, no de
funcionalidad: todo lo que se muestra ya existe (crear lectura, ver anomalías, consultar
periodos) — se reorganiza en una navegación de pestañas apta para pantalla angosta.

## 2. Por qué ahora

Mateo trajo un mockup de Figma ("AquaLectura": encabezado azul con logo de gota, navegación
lateral, tarjetas "Consulta por período" y "Nueva lectura") y pidió que la app del lector se vea
así en su celular. Se acotó el alcance en conversación antes de este spec (ver §4): el mockup
mezclaba, en la misma pantalla, cosas que ya existen con dos features que el roadmap ya identificó
como más grandes y las dejó fuera a propósito.

## 3. Alcance

### 3.1 Cuándo se ve distinto
`/app/lecturas` sigue siendo la misma ruta. Al cargar, pide el rol actual (`GET /dashboard`, ya
existe) y decide: si `rol === 'lector'`, renderiza el shell nuevo (§3.2); si es
`admin_acueducto`/`administrador`, se queda exactamente como está hoy (sin cambios visuales para
el admin — el admin usa esta pantalla para revisar anomalías del acueducto completo, no para
tomar lecturas en campo).

### 3.2 Shell móvil "AquaLectura" (solo para `lector`)
- Encabezado: logo de gota + "AquaLectura", indicador "En línea"/"Sin conexión" (`navigator.onLine`
  — la app ya se sirve como PWA, D-8/lecturas offline-first; el indicador es honesto sobre la
  conectividad real del dispositivo).
- Navegación inferior de 4 pestañas (layout de celular, no la barra lateral del mockup — ver
  decisión técnica en plan.md): **Inicio**, **Nueva lectura**, **Pendientes**, **Historial**.
- **Inicio:** saludo, nombre del acueducto (`GET /acueducto`, ya existe — reemplaza la "Zona
  actual" del mockup, que exigía asignación de rutas fuera de alcance), conteo de lecturas
  tomadas hoy y de pendientes de revisión (ambos calculados de datos que ya se piden).
- **Nueva lectura:** el formulario que ya existe (elegir contador/suscriptor, fecha, lectura),
  con el mismo botón de acción que hoy — visualmente destacado (verde, como en el mockup), sin
  esconder el ingreso manual detrás de un flujo de escaneo que no existe todavía.
- **Pendientes:** lecturas con `revision != 'normal'` del periodo abierto — el lector **ve** la
  anomalía (mismo dato que ya expone `GET /lecturas?solo_revision=true`) pero **no** el botón
  "Marcar revisada": verificado que `PATCH /lecturas/:id/revisar` exige `admin_acueducto` por RLS
  (`lecturas_admin`) — mostrarle el botón al lector sería ofrecer una acción que va a fallar.
- **Historial:** lista de periodos (`GET /periodos`, ya existe) con su estado; al elegir uno,
  las lecturas de ese periodo (misma llamada que "Pendientes", sin el filtro de anomalías).

## 4. Fuera de alcance (acotado en conversación con Mateo antes de este spec)

- **Escaneo de código/OCR de contador ("Lector OCR" del mockup).** Es la Feature 015 del roadmap,
  marcada "diferenciador tecnológico principal, requiere máximo rigor de precisión y
  confiabilidad" — confirmación humana obligatoria del número leído, nunca automática. El botón
  "Nueva lectura" de esta feature lleva directo al formulario manual que ya existe; el ícono de
  cámara queda para cuando 015 se implemente de verdad, con su propio spec.
- **Zona/ruta asignada al lector ("Zona actual: Sector Centro" del mockup).** Es exactamente lo
  que `ESPECIFICACION-FUNCIONAL.md §2.14.1` reconoce que no existe como feature, y que 024 dejó
  fuera a propósito. El lector sigue viendo todos los suscriptores/lecturas de su acueducto, sin
  filtrar por una zona que hoy no se le asigna a nadie.
- **Pantalla "Reportes"** del mockup — no hay ninguna función de reportes especificada; no se
  construye una pantalla vacía. Si Mateo la quiere, es su propio spec.
- **Pantalla "Configuración"** en la navegación del lector — `/app/configuracion` (023) es del
  `admin_acueducto` (cambia el color de marca del acueducto); no tiene sentido en la navegación
  del lector y no se agrega ahí.
- **Barra de navegación lateral fija del mockup.** Pensada para pantalla ancha; en un celular real
  (360-420px) no entra. Se reemplaza por una barra inferior de pestañas, patrón estándar de app
  móvil (decisión técnica, ver plan.md).

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 punto 24: el lector solo crea/ve lecturas — "Pendientes" es de solo lectura para
  ese rol, la acción de revisar sigue siendo exclusiva de `admin_acueducto` (ya lo garantiza RLS,
  esta feature solo evita mostrar un botón que fallaría).
- Ningún cambio de esquema, de RLS ni de rutas del backend — es una reorganización de lo que el
  frontend ya pide y ya podía pedir.

## 6. Criterios de aceptación

### CA-1 — El admin no ve ningún cambio
Con sesión de `admin_acueducto`, `/app/lecturas` se ve y funciona exactamente igual que hoy.

### CA-2 — El lector ve el shell nuevo
Con sesión de `lector`, `/app/lecturas` muestra el encabezado "AquaLectura" y la navegación
inferior de 4 pestañas, sin la barra lateral del mockup.

### CA-3 — Cada pestaña usa datos reales, no de ejemplo
Inicio, Nueva lectura, Pendientes e Historial muestran datos reales del acueducto de prueba
(fixture), verificado contra `wrangler dev` + `next dev` con sesión de lector real — nunca
placeholders fijos.

### CA-4 — Pendientes es de solo lectura para el lector
La lista de anomalías se ve, pero no aparece el botón "Marcar revisada" en la vista del lector.

### CA-5 — Crear una lectura sigue funcionando igual
Desde "Nueva lectura" del shell nuevo, el lector puede registrar una lectura real — mismo
resultado en la base que el formulario actual (no se duplicó ni se rompió la lógica existente).

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Pedir el rol (`GET /dashboard`) agrega una espera antes de mostrar cualquier pantalla | Se muestra un estado de carga breve; es una sola llamada adicional, ya usada en `/app/dashboard` |
| Duplicar lógica entre el shell nuevo y la vista de admin existente | Ambas llaman las mismas funciones de `lib/api.ts` (`crearLectura`, `listarLecturas`, etc.) — solo cambia el layout/composición, no la obtención de datos |
| El indicador "En línea/Sin conexión" sugiere soporte offline real que hoy no existe (la PWA offline-first de §2.14 sigue sin Service Worker) | El indicador refleja `navigator.onLine` honestamente (conectividad del dispositivo) — no se promete guardado offline que no está construido; si Mateo lo interpreta como tal, se aclara antes de construirlo |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de `lector` y de
      `admin_acueducto` (regresión)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
