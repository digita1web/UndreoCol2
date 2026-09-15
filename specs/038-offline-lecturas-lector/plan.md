# PLAN — 038: offline-lecturas-lector

**Spec aprobado:** 2026-09-15

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/lib/use-cola-lecturas-offline.ts` | Nuevo | IndexedDB (cola de lecturas sin subir) + hook `useColaLecturasOffline` — encolar, listar, sincronizar al reconectar |
| `frontend/components/lector/nueva-lectura-lector.tsx` | Modificado | `alGuardar` genera `id_cliente_offline` siempre; ante fallo de red (no de negocio) encola en vez de mostrar error; lista las rechazadas con su motivo |
| `frontend/components/lector/shell-lector.tsx` | Modificado | Nuevo prop `sinSubirCount` — badge junto al indicador "En línea/Sin conexión", visualmente distinto del badge de la pestaña "Pendientes" (CA-6) |
| `frontend/app/app/lecturas/page.tsx` | Modificado | `VistaLector` instancia `useColaLecturasOffline`, la pasa a `ShellLector` y `NuevaLecturaLector` — vive en el padre para que el drenado de la cola siga activo aunque el fontanero cambie de pestaña |

Cero cambios de backend: `POST /lecturas` ya acepta `id_cliente_offline` y ya deduplica
(`backend/src/lib/lecturas.ts`, desde 004) — confirmado leyendo el código real antes de este plan,
no asumido. Cero cambios de esquema Postgres.

## 2. Esquema de base de datos

**Postgres/Supabase:** ninguno — reutiliza `lecturas.id_cliente_offline`, ya existe.

**IndexedDB del navegador (nuevo, cliente):**

```
Base: "undreocol-lecturas-offline", versión 1
Tabla (object store): "cola", keyPath: "id_cliente_offline"

Cada registro:
  id_cliente_offline: string   (crypto.randomUUID(), generado al guardar)
  contador_id: string
  periodo_id: string
  fecha_lectura: string
  lectura_actual: number
  guardadaEn: string           (ISO, para ordenar la cola FIFO)
  estado: 'pendiente' | 'rechazada'
  errorRechazo?: string        (solo si estado === 'rechazada')
```

Sin índices adicionales — el orden FIFO se resuelve ordenando por `guardadaEn` en JavaScript
después de `getAll()`, no con un índice de IndexedDB (la cola esperada es de unas pocas lecturas
por corte de señal, no miles de filas).

## 3. Rutas de la API (Hono)

Ninguna — ni nueva ni modificada. `POST /lecturas` (existente) es el único endpoint que toca esta
feature, sin cambios.

## 4. Contrato del módulo nuevo — `frontend/lib/use-cola-lecturas-offline.ts`

```ts
export interface LecturaEnCola {
  id_cliente_offline: string;
  contador_id: string;
  periodo_id: string;
  fecha_lectura: string;
  lectura_actual: number;
  guardadaEn: string;
  estado: 'pendiente' | 'rechazada';
  errorRechazo?: string;
}

// Hook de un solo uso, instanciado en VistaLector (app/app/lecturas/page.tsx) — vive mientras
// dure la sesión de AquaLectura, no depende de qué pestaña esté activa.
export function useColaLecturasOffline(alSincronizarUna: () => void): {
  rechazadas: LecturaEnCola[];
  sinSubirCount: number;
  encolar: (datos: DatosCrearLectura) => Promise<void>;
  descartar: (idClienteOffline: string) => Promise<void>;
}
```

- **Al montar y en cada evento `online` del navegador**, el hook drena la cola: por cada
  `pendiente` (ordenadas por `guardadaEn`), llama a `crearLectura(item)` (ya existe en `lib/api.ts`,
  ya manda `id_cliente_offline`).
  - Éxito → la quita de IndexedDB, llama a `alSincronizarUna()` (para que `VistaLector` recargue
    las lecturas del periodo, mismo callback que ya usa `onCreada`).
  - `ErrorPeticion` (rechazo real del backend — CA-5) → la marca `rechazada` con el mensaje, sigue
    con la siguiente de la cola (un rechazo de negocio no bloquea a las demás).
  - Cualquier otro error (falla de red real — el `fetch` de `peticion()` lanza antes de llegar a
    convertir la respuesta en `ErrorPeticion`, ver `lib/api.ts:69-85`) → corta el drenado ahí mismo,
    deja el resto en `pendiente` para el próximo intento — evita recorrer toda la cola fallando una
    por una cuando ya se sabe que no hay señal.
- **`encolar(datos)`**: genera `id_cliente_offline` con `crypto.randomUUID()` (API nativa, requiere
  contexto seguro — ya lo exige la cámara de 036/015), guarda el registro con `estado: 'pendiente'`.
  Si la propia escritura a IndexedDB falla (ej. cuota agotada, modo privado que la bloquea), no se
  traga el error (CLAUDE.md §7): se relanza para que `nueva-lectura-lector.tsx` lo muestre como el
  error real que es, en vez de simular un guardado offline que no ocurrió.
- **`descartar(id)`**: borra una `rechazada` de la cola — el fontanero ya la volvió a escribir a
  mano o decidió que no aplica.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `id_cliente_offline` se genera **siempre** al guardar (falle o no la red), no solo en la rama offline | Generarlo solo al encolar | Con una sola rama de código el envío ya es idempotente ante cualquier ambigüedad (ej. el POST sí llegó pero la respuesta se perdió) — más simple que mantener dos caminos, y el campo ya existe en el contrato de `crearLectura` sin usarlo hasta ahora |
| Sin Service Worker ni Background Sync API en v1 — el drenado corre en el hilo de la página (`useEffect` + evento `online` + al montar) | Service Worker con `sync` event (investigado en `/specify`, spec §2) | Background Sync solo la soportan navegadores Chromium (spec §2, fuente citada) — el fallback universal (evento `online` + reintento al reabrir la app) ya cumple los CA del spec (§6) sin necesitar un Service Worker. Agregar uno solo para la mejora marginal de sincronizar con la pestaña cerrada exige lifecycle propio, duplicar la lógica de drenado en JS plano (un SW no comparte el bundle TypeScript de la página sin herramientas de build extra) y no se puede probar en este entorno (sin Chromium/Playwright) — desproporcionado para el caso real: el fontanero tiene la app abierta durante su jornada de lecturas. Queda anotado como mejora futura (`/specify` de un spec propio si hace falta), no descartado para siempre. |
| IndexedDB nativo con un wrapper propio de ~60 líneas, sin la librería `idb` | `idb` (ISC, wrapper con promesas de Jake Archibald/Google Chrome team) | Una sola tabla, cuatro operaciones (agregar/listar/actualizar/borrar) — la API nativa envuelta a mano es directa y evita sumar una dependencia para un uso tan acotado, mismo criterio que ya usó este proyecto en 036 (Canvas nativo en vez de OpenCV.js) y 015 (`<input capture>` nativo en vez de `getUserMedia` propio) |
| El drenado de la cola corre a nivel de `VistaLector` (`app/app/lecturas/page.tsx`), no dentro de `NuevaLecturaLector` | Vivir dentro de `NuevaLecturaLector` | `NuevaLecturaLector` se desmonta al cambiar de pestaña (`{pestana === 'nueva' && <NuevaLecturaLector .../>}`, código real de la página) — si el hook viviera ahí, una reconexión mientras el fontanero está en "Historial" no dispararía la subida hasta que volviera a "Nueva". `VistaLector` es el único componente que vive durante toda la sesión de AquaLectura. |
| Loop de sincronización se corta en el primer fallo de red, no reintenta las demás lecturas de la cola en el mismo ciclo | Intentar las N lecturas igual, aunque la primera falle por red | Si ya falló por red, las siguientes van a fallar igual — recorrerlas todas solo agrega intentos de fetch inútiles contra una conexión que ya se sabe caída; se reintenta el ciclo completo en el próximo evento `online` o el próximo montaje |

## 6. Dependencias nuevas

Ninguna. `crypto.randomUUID()` e `IndexedDB` son APIs nativas del navegador, ya dentro del baseline
que exige este proyecto (contexto seguro/HTTPS, ya requerido por la cámara de 015/036).

## 7. Límites de Cloudflare Workers a considerar

No aplica — toda la cola y el reintento ocurren en el navegador del fontanero. El backend recibe
exactamente el mismo `POST /lecturas` que ya recibe hoy, uno por vez, cuando hay señal.

## 8. Estrategia de pruebas

`frontend/` sigue sin framework de tests unitarios (mismo estado que 015/025/035/036) — no se
agrega uno nuevo solo para esta feature (decisión de alcance, no de ligereza: sumar Vitest al
frontend es una decisión de infraestructura propia, no algo para introducir como efecto secundario
de esta feature; si Mateo lo quiere, es su propia conversación).

- **Build/lint/knip:** `npm run build`, `npm run lint`, `npm run knip` limpios en `frontend/`.
- **Backend intacto:** `npm test`/`build`/`lint`/`wrangler deploy --dry-run` en verde en `backend/`,
  para confirmar que de verdad no se tocó (§1).
- **Verificación manual real, con DevTools (Network → Offline), en un navegador real — CA-1 a CA-4:**
  guardar una lectura sin conexión, confirmar que no tira error y queda en la cola; volver a poner
  el dispositivo en línea sin recargar y confirmar que se sube sola; cerrar y reabrir la pestaña sin
  conexión y confirmar que la cola sigue ahí; forzar un rechazo real (ej. guardar dos veces el mismo
  contador/periodo) y confirmar que sale de la cola con un mensaje, no reintenta para siempre.
  **Este entorno no tiene Chromium/Playwright — requiere que Mateo la corra, igual que quedó
  pendiente en 036.**
- **CA-3 (deduplicación) verificable también contra Postgres real:** tras sincronizar, `select
  count(*) from lecturas where id_cliente_offline = '...'` debe devolver 1, no 2 — esto si se puede
  correr desde este entorno contra la base de desarrollo, sin depender de un navegador.
- **Clasificación de errores (network vs `ErrorPeticion`), verificable sin navegador:** con un
  script de Node suelto (no un archivo de test permanente — mismo criterio de alcance que el resto
  de esta sección) que importe la lógica de clasificación y confirme que un `ErrorPeticion` marca
  `rechazada` y cualquier otro error corta el ciclo, contra los dos casos reales que puede lanzar
  `peticion()` (`lib/api.ts:69-85`).
