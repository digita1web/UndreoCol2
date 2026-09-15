# SPEC — 038: offline-lecturas-lector

**Estado:** Borrador para aprobación
**Depende de:** 004-lecturas-y-consumo, 015-identificacion-contador-qr, 025-app-lector-movil,
036-ocr-lectura-contador

## 1. Objetivo

Que el fontanero (rol `lector`) pueda seguir tomando lecturas en AquaLectura sin señal de datos —
la lectura queda guardada en el celular y se sube sola en cuanto vuelve la conexión, sin que el
fontanero tenga que hacer nada extra ni perder el trabajo si cierra la app o pierde señal a mitad
de la jornada.

## 2. Por qué ahora

Gap conocido y documentado desde antes de este spec, nunca resuelto por decisión explícita de
alcance en las features que lo tocaron:
- `specs/015-identificacion-contador-qr/spec.md` (§4, investigado antes de ese spec): *"hoy no
  existe ningún Service Worker ni cola de sincronización real para lecturas — `listarSuscriptores()`
  y `crearLectura()` son llamadas de red directas, sin caché ni cola local (...) construir
  offline-first real de punta a punta es una feature propia, mucho más grande, no incluida acá."*
- `specs/025-app-lector-movil/spec.md` (§7, riesgo aceptado): el indicador "En línea/Sin conexión"
  del shell de AquaLectura es honesto sobre la conectividad del dispositivo, pero no promete
  guardado offline.

Es el hueco más serio para el perfil de usuario real (fontanero de un acueducto rural, señal poco
confiable) — más urgente que 037 (rutas/zonas), que resuelve un problema de escala (varios
lectores) que hoy no existe con cero clientes en producción.

**Investigación de la comunidad (regla CLAUDE.md §3) — sin patrón interno previo en este proyecto
para offline-first, así que se investigó desde cero:**

- **Patrón estándar 2026 para formularios offline-first:** escribir el envío en IndexedDB (con un
  id generado en el cliente, timestamp y contador de reintentos) *antes* de tocar la red, para que
  un POST interrumpido ya esté guardado y no se pierda; el Service Worker reproduce la cola cuando
  vuelve la conexión. [OpenReplay — Offline Form Submission with Background Sync](https://blog.openreplay.com/offline-form-submission-background-sync/).
- **Background Sync API (`SyncManager`) solo la soportan navegadores Chromium** (Chrome, Edge,
  Samsung Internet) — Firefox y Safari/iOS no la implementan, por lo que un fallback con el evento
  `online` del navegador es obligatorio para que funcione en todos los navegadores, no solo en
  Android/Chrome. Background Sync queda como mejora sobre esa base, no como único mecanismo.
- **Deduplicación:** el patrón estándar es mandar un id generado en el cliente como clave de
  idempotencia, para que un reintento que el servidor ya proceso no duplique el registro. **Este
  proyecto ya tiene exactamente esa pieza construida y probada del lado del servidor desde
  004-lecturas-y-consumo:** la columna `lecturas.id_cliente_offline` (`unique`) con deduplicación
  real en `backend/src/lib/lecturas.ts` — hoy sin usar, porque `crearLectura()` del frontend nunca
  generó ni mandó ese campo (confirmado, `specs/015-identificacion-contador-qr/spec.md` §4). Este
  spec no inventa un mecanismo de idempotencia nuevo: activa uno que ya existe y ya está testeado.
- **Next.js (App Router) — dos vías oficiales, ninguna resuelve esto sola:**
  - El hook experimental `useOffline` (`next/offline`, Next.js 16) solo reintenta navegación,
    prefetch y **Server Actions** de Next.js — nunca `fetch()` a una API externa. La API de
    UndreoCol es Hono sobre Workers, llamada con `fetch()` normal desde `lib/api.ts`
    (`credentials: 'include'`, nunca Server Actions, CLAUDE.md §5.2) — `useOffline` no cubre este
    caso. Además Next.js mismo lo marca *"experimental, no recomendado para producción."*
    [Next.js docs — useOffline](https://nextjs.org/docs/app/api-reference/functions/use-offline).
  - Para caché real basada en Service Worker, la [guía oficial de PWA de Next.js](https://nextjs.org/docs/app/guides/progressive-web-apps)
    documenta el registro manual de un Service Worker propio (`navigator.serviceWorker.register`
    dentro de un Client Component) como la vía sin dependencias, y menciona **Serwist** (sucesor
    mantenido de `next-pwa`, que está archivado/sin mantenimiento) como opción si se quiere un
    Service Worker con caché de app-shell completa.
  - **Decisión propuesta para `/plan`:** Service Worker manual, sin Serwist/Workbox — el alcance
    real de este spec es una sola cola de escritura (una lectura), no cachear rutas ni assets de
    toda la app; agregar una librería de precaching completa sería desproporcionado para el
    problema real, mismo criterio que ya usó este proyecto en 036 (Canvas nativo en vez de
    OpenCV.js) y en 015 (`<input capture>` nativo en vez de un `<video>`/`getUserMedia` propio).
    Confirmado en `/plan`: `idb` (ISC) o IndexedDB nativo para la cola, sin dependencia de caché de
    app-shell.

## 3. Alcance

### 3.1 Qué se pone offline — solo lo que el lector realmente necesita en campo
El único flujo que importa es "Nueva lectura" (`NuevaLecturaLector`, el único `POST` real que hace
el rol `lector` — CLAUDE.md §10 punto 24: solo crea/ve lecturas). El resto de AquaLectura
(Inicio, Pendientes, Historial) son solo lectura y no necesitan cola de escritura — si no hay señal,
muestran el último dato cargado o un aviso, sin bloquear "Nueva lectura".

### 3.2 La lista de contadores/suscriptores tiene que estar ya cargada
Igual que hoy: para elegir un contador en el `<select>` (o escanear su QR, 015) hace falta que
`listarSuscriptores()` ya se haya cargado con éxito en esa sesión — mismo límite que ya documentó
015 §4, este spec no lo resuelve ni lo empeora. Si el fontanero abre la app por primera vez en el
día ya sin señal, no hay nada que ofrecerle: eso es una limitación de origen (no hay datos), no un
bug de sincronización.

### 3.3 Guardado local inmediato
Al tocar "Guardar lectura" sin conexión (o si el POST falla por red), la lectura se guarda de
inmediato en una cola local (IndexedDB) con un `id_cliente_offline` generado en el celular — nunca
se pierde el trabajo del fontanero por cerrar la app o quedarse sin batería.

### 3.4 Subida automática al recuperar señal
En cuanto el dispositivo recupera conexión, las lecturas en cola se envían solas, en orden, sin que
el fontanero tenga que reabrir la pantalla ni tocar nada — vía Background Sync API donde el
navegador lo soporte, con reintento por el evento `online` como respaldo universal (§2).

### 3.5 El fontanero ve qué le falta subir
Un indicador visible (ej. junto al de "En línea/Sin conexión" del shell) muestra cuántas lecturas
están guardadas localmente y todavía no confirmadas por el servidor — para que sepa que su trabajo
está a salvo, y para que no confunda esto con la pestaña "Pendientes" que ya existe (esa es de
revisión de anomalías, un concepto distinto).

## 4. Fuera de alcance

- **Offline para cualquier pantalla que no sea "Nueva lectura"** — Inicio/Pendientes/Historial
  siguen siendo de solo lectura contra el servidor; cachear su contenido para verlo sin conexión es
  una feature aparte, si Mateo la pide.
- **Offline para el rol `admin_acueducto`/`administrador`** — esos roles no trabajan en campo sin
  señal; el panel de escritorio no cambia.
- **Resolver conflictos de negocio nuevos.** El `unique (contador_id, periodo_id)` y el resto de
  reglas de `core/consumo.ts` no cambian — si una lectura offline llega tarde y el contador ya tiene
  una lectura de ese periodo (de otro dispositivo, o cargada a mano mientras tanto), el backend la
  rechaza exactamente igual que rechaza hoy un duplicado online (regla de dominio 3, CLAUDE.md §10).
  Este spec solo decide cómo se le avisa al fontanero cuando eso pasa en diferido (§6, CA-5); no
  inventa una regla de reconciliación nueva.
- **Cachear el catálogo completo de la app (app-shell offline / "instalar y usar sin abrir nunca con
  señal").** Fuera de alcance explícito de `/plan` (§2): sin Serwist/Workbox, sin precaching de
  rutas. Si el celular nunca cargó `/app/lecturas` con conexión, no hay app que abrir sin conexión —
  límite conocido, documentado, no se resuelve acá.
- **Notificar al fontanero por push cuando la sincronización falla en background** — Web Push es una
  feature propia (mencionada como posible extensión en la guía de PWA de Next.js); no se construye
  acá sin un pedido explícito.

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 punto 8: *"Reenvío de lectura desde la PWA offline. Idempotente vía
  `id_cliente_offline`. Nunca se duplica."* — regla de negocio ya escrita antes de este spec; este
  spec es lo que finalmente la hace real (hoy el campo existe en el backend pero nada del frontend
  lo usa).
- CLAUDE.md §10 punto 3 (lectura duplicada del mismo contador en el mismo periodo, se bloquea) y
  punto 4 (lectura fuera de orden cronológico, se bloquea): no cambian. Una lectura offline que
  llega tarde y ya no es válida se rechaza con el mismo mecanismo de siempre — ver §4.
- CLAUDE.md §10 punto 24 (el lector solo crea/ve lecturas): delimita el alcance a "Nueva lectura"
  exclusivamente (§3.1).

## 6. Criterios de aceptación

### CA-1 — Guardar una lectura sin conexión no la pierde
Con el dispositivo/navegador en modo sin conexión (DevTools → Network → Offline), completar y
guardar una lectura: no aparece ningún error de red al fontanero, la lectura queda visible como
"pendiente de subir" en la app.

### CA-2 — La lectura en cola se sube sola al recuperar señal
Volviendo a poner el dispositivo en línea (sin recargar la página, sin que el fontanero haga nada
más), la lectura en cola desaparece de "pendiente de subir" y pasa a existir en el servidor
(verificable con `GET /lecturas` contra el backend real).

### CA-3 — Ninguna lectura offline se duplica
Guardar la misma lectura dos veces en cola (ej. el fontanero cierra y reabre la app sin señal antes
de que sincronice) y luego recuperar conexión: el servidor recibe ambos envíos pero registra una
sola fila — verificado consultando `lecturas` directamente en Postgres, no solo la respuesta HTTP.

### CA-4 — Cerrar la app o quedarse sin batería no pierde la cola
Guardar una lectura sin conexión, cerrar la pestaña/app por completo (no solo minimizar) y volver a
abrirla más tarde, todavía sin conexión: la lectura sigue en la cola local, no desapareció.

### CA-5 — Un rechazo real del backend se le explica al fontanero, no se reintenta para siempre
Si una lectura en cola es rechazada por el servidor por una razón de negocio real (duplicado, fuera
de orden, periodo cerrado — no un error de red), sale de la cola de reintento automático y se le
muestra al fontanero con un mensaje que le permite corregirla a mano — nunca queda reintentando en
bucle algo que el servidor ya dijo que no.

### CA-6 — El indicador de pendientes de subir es honesto y distinto del de "Pendientes" (revisión)
Con lecturas en cola local, el contador de "pendiente de subir" muestra el número real y es
visualmente distinto de la pestaña "Pendientes" (anomalías) — confirmado no reusan el mismo
contador ni el mismo texto.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Background Sync API no existe en Safari/iOS/Firefox — un fontanero con esos navegadores no sincroniza en segundo plano | Fallback obligatorio con el evento `online` + reintento al reabrir la app (§2) — funciona en todos los navegadores, Background Sync es solo una mejora sobre esa base |
| El fontanero pierde el celular o desinstala la app con lecturas todavía en cola | Mismo riesgo que existe hoy con papel/libreta física; fuera del control del software — se documenta, no se resuelve con software |
| Guardar en IndexedDB mal implementado podría corromper o perder la cola silenciosamente | CA-4 lo prueba explícitamente cerrando la app; cualquier error de IndexedDB se loguea (`console.error`), nunca se traga en silencio (CLAUDE.md §7) |
| El Service Worker interfiere con el resto de la app (cachea de más, sirve versiones viejas) | Alcance acotado a una sola cola de escritura, sin cachear rutas/assets (§4) — se valida en `/plan` con `Cache-Control: no-cache` en el propio `sw.js`, mismo patrón que documenta la guía oficial de Next.js |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia real (no "debería funcionar")
- [ ] Decisiones de implementación de `/plan` investigadas contra prácticas de la comunidad, fuentes
      documentadas (ya cumplido en este spec para la decisión central)
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` corrido, sin hallazgos nuevos sin revisar
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] Verificación manual real con DevTools en modo offline (CA-1 a CA-4) — este entorno no tiene
      Chromium/Playwright; a confirmar si Mateo puede correrlo o si se necesita otro camino
- [ ] `docs/ESPECIFICACION-FUNCIONAL.md` actualizado (§2.14 y/o nueva referencia desde 015/025/036)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
