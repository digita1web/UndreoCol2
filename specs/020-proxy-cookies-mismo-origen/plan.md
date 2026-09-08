# PLAN — 020: proxy-cookies-mismo-origen

**Spec aprobada:** 2026-09-08. Sin decisiones abiertas (la Opción B ya la eligió Mateo fuera de la
spec).

**Estado de este plan:** EN REVISIÓN. `CLAUDE.md §3` exige checkpoint humano antes de `/tasks`.

**Advertencia de verificabilidad, léela antes de aprobar:** este entorno no puede ejecutar `next
build`, `opennextjs-cloudflare build`, `wrangler dev` con bindings, ni desplegar. Todo lo que toque
el Service Binding real solo se puede probar con evidencia parcial aquí (lectura del código, patrones
documentados de Cloudflare/OpenNext) y necesita **validación real de Mateo en su navegador** antes de
darse por cerrado. Se sigue el mismo criterio que 017/018: nada se marca completo sin evidencia; lo
no verificable aquí se declara así, explícito.

---

## 0. Punto de partida (verificado leyendo el código real)

- **`frontend/wrangler.toml`** hoy: `name = "undreocol-frontend"`, `main = ".open-next/worker.js"`,
  `compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]`, un bloque `[assets]`.
  Sin `[[services]]`.
- **`frontend/lib/api.ts:5`**: `const URL_BASE_API = process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:8787';` — usada por `peticion()` (todas las llamadas del navegador) y por
  `urlPdfFactura`/`urlPdfFacturaPortal` (enlaces `<a href>` directos al backend).
- **No existe `frontend/.env.production`** ni ninguna referencia a `NEXT_PUBLIC_API_URL` en la
  documentación: hoy, quien construye el frontend para producción tiene que fijar esa variable a
  mano antes de `opennextjs-cloudflare build` (confirmado indirectamente: el login real de Mateo
  llegó a `https://undreocol-api.undreocol.workers.dev`, la URL absoluta). Se documenta este vacío,
  no se resuelve aparte: con este plan, la variable deja de necesitarse para producción.
- **`frontend/app/app/dashboard/page.tsx` y `frontend/app/plataforma/page.tsx`** (*server
  components*) usan su **propio** `URL_BASE_API` local (no importan `lib/api.ts`) y reenvían la
  cookie a mano — confirmado que no se tocan (spec §3.4).
- **`@opennextjs/cloudflare` expone `getCloudflareContext()`**, que da acceso a `env` (los bindings
  del Worker) desde cualquier Route Handler. Patrón documentado:
  `const { env } = getCloudflareContext();` — fuente: `https://opennext.js.org/cloudflare/bindings`.
- **Un *issue* conocido del propio adaptador** (`opennextjs-cloudflare#652`): llamar
  `getCloudflareContext()` en una ruta dinámica puede fallar **en build** si la ruta no está marcada
  explícitamente como dinámica. Mitigación: `export const dynamic = 'force-dynamic'` en el Route
  Handler nuevo (T-002).
- **No existe `frontend/cloudflare-env.d.ts`** ni ningún tipo para los bindings del Worker — se crea
  en T-001.

---

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/wrangler.toml` | editar | Añade el Service Binding `API` → Worker `undreocol-api` |
| `frontend/cloudflare-env.d.ts` | crear | Tipo `CloudflareEnv` con el binding `API: Fetcher`, sin `any` (CLAUDE.md §7) |
| `frontend/app/api/[...ruta]/route.ts` | crear | Proxy: reenvía todo `/api/*` al binding, todos los métodos |
| `frontend/lib/api.ts` | editar | `URL_BASE_API`: `''` en producción (rutas relativas `/api/...`), sin cambiar el valor de desarrollo local |
| `docs/PLAN-PRODUCCION.md` | editar | M-4 corregido: no era "probablemente ya no aplica", el dominio SÍ es distinto — ver spec §0 |
| `.specify/config.md` | editar | Fila 020, prerrequisito de producción |
| `CHANGELOG.md` | editar | Entrada de la sesión |

---

## 2. El Service Binding

```toml
# frontend/wrangler.toml — se agrega al final
[[services]]
binding = "API"
service = "undreocol-api"
```

**Por qué Service Binding y no una URL pública interna:** es Worker-a-Worker, dentro de la red de
Cloudflare, sin salir a Internet — más rápido que un `fetch` público y, sobre todo, **es la pieza que
resuelve el bug**: la respuesta se devuelve como parte de la respuesta HTTP normal del Worker del
frontend, así que el navegador nunca ve un origen distinto y el `Set-Cookie` queda scopeado al
dominio que el navegador visita.

**No requiere nada del lado de `undreocol-api`** — un Service Binding solo necesita que el Worker de
destino exista con ese nombre exacto en la misma cuenta de Cloudflare (ya existe). No es una ruta
nueva, no es un cambio de CORS, no es un secreto que rotar.

---

## 3. El proxy — `frontend/app/api/[...ruta]/route.ts`

```ts
import { getCloudflareContext } from '@opennextjs/cloudflare';

// Necesario: getCloudflareContext() en una ruta dinámica sin esto puede
// fallar en build (opennextjs-cloudflare#652).
export const dynamic = 'force-dynamic';

async function reenviar(request: Request): Promise<Response> {
  const { env } = getCloudflareContext<CloudflareEnv>();
  const entrante = new URL(request.url);
  const destino = new URL(
    entrante.pathname.replace(/^\/api/, '') + entrante.search,
    'https://undreocol-api.undreocol.workers.dev', // host ignorado por el binding; solo referencia
  );
  // Se reconstruye con la MISMA petición como init: conserva método, headers
  // (incluida Cookie/Origin) y cuerpo — patrón estándar de proxy en Workers.
  const peticion = new Request(destino, request);
  return env.API.fetch(peticion);
}

export {
  reenviar as GET,
  reenviar as POST,
  reenviar as PATCH,
  reenviar as PUT,
  reenviar as DELETE,
  reenviar as OPTIONS,
};
```

**Por qué `[...ruta]` (catch-all) y no rutas explícitas por endpoint:** el backend tiene más de 50
rutas (`/auth/*`, `/dashboard`, `/plataforma/*`, `/catalogo/*`, `/suscriptores/*`, `/facturas/*`,
`/portal/*`, etc.) y sigue creciendo. Un proxy transparente evita mantener una lista duplicada aquí
cada vez que el backend agrega una ruta — coherente con la spec §3.1 ("no entiende el contenido de
lo que reenvía").

**Streaming/binario (CA-5, PDFs):** `env.API.fetch()` devuelve un objeto `Response` estándar de
Workers; se retorna tal cual, sin leerlo (`.json()`/`.text()`) ni reconstruirlo — el cuerpo (incluido
binario) pasa como stream sin que el proxy lo toque. Es la misma razón por la que no se hace
`await request.json()` del lado de la petición entrante: forzaría a bufferizar y podría romper el
reenvío en cuerpos grandes.

**`cloudflare-env.d.ts`:**
```ts
interface CloudflareEnv {
  API: Fetcher;
}
```
`Fetcher` es un tipo global de `@cloudflare/workers-types` (ya es dependencia transitiva de
`wrangler`). Sin `any` (CLAUDE.md §7).

---

## 4. `lib/api.ts`

```ts
// Antes:
// const URL_BASE_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

// Después:
const URL_BASE_API = process.env.NEXT_PUBLIC_API_URL ?? '/api';
```

**Por qué el valor por defecto cambia de `localhost:8787` a `/api`, y no se agrega una variable
nueva:** hoy, si `NEXT_PUBLIC_API_URL` no está definida, `peticion()` ya apunta a `localhost:8787` —
eso solo tiene sentido en desarrollo local, así que **desarrollo local sigue necesitando definir la
variable explícitamente** (en `.env.local`, como ya se documenta en `.env.example`) para seguir
hablando directo al backend en `:8787`. En producción, **no se define la variable en absoluto** — el
valor por defecto pasa a ser la ruta relativa `/api`, que el proxy nuevo intercepta. Esto es
justamente lo que corrige el vacío señalado en §0: hoy nadie documentaba qué poner en producción;
ahora la respuesta es "nada, se deja sin definir".

**`.env.example`** se actualiza para explicar esto (T-004).

**No se toca** `urlPdfFactura`/`urlPdfFacturaPortal`: ya usan `URL_BASE_API`, así que en producción
sus enlaces pasan a ser relativos (`/api/facturas/.../pdf`) automáticamente — el proxy los atiende
igual que cualquier otra ruta (CA-5).

---

## 5. Decisiones técnicas

### 5.1 Por qué no se tocan los *server components*

`dashboard/page.tsx` y `plataforma/page.tsx` ya reenvían la cookie a mano contra la URL pública del
backend (`process.env.NEXT_PUBLIC_API_URL`, definida ahí con su propio fallback a
`http://localhost:8787`). Ese mecanismo **no tiene el bug de esta spec** — nunca dependió de que el
navegador viera la cookie en el dominio correcto, porque el propio código del servidor ya la
reenvía explícitamente. Con el fix de `lib/api.ts`, la cookie SÍ va a existir en el dominio del
frontend (que es lo que `cookies()` necesita), así que estos componentes empiezan a funcionar sin que
haya que tocarlos. Migrarlos también al Service Binding es una optimización de latencia legítima,
pero fuera de esta spec (§4) — cambiarlos sin necesidad aumenta el riesgo de esta tarea urgente sin
resolver el bug que la motiva.

### 5.2 Por qué el desarrollo local no usa el binding

`wrangler dev` puede simular Service Bindings entre dos procesos locales, pero exige levantar los dos
Workers a la vez con configuración cruzada — más superficie para que algo salga mal en un cambio que
ya es urgente. Como el bug **no existe en local** (mismo host `localhost`, cookies no distinguen
puerto), no hay nada que arreglar ahí: se deja el mecanismo actual (`NEXT_PUBLIC_API_URL` en
`.env.local`) intacto.

### 5.3 Riesgo aceptado: falta de verificación real de build/deploy en este entorno

No se puede ejecutar `opennextjs-cloudflare build` aquí (mismo bloqueo de `cdn.sheetjs.com` de
siempre) ni desplegar. El código se escribe siguiendo el patrón documentado oficial de OpenNext para
bindings y el patrón estándar de Cloudflare Workers para proxys (`new Request(url, request)`), pero
**la primera confirmación real de que compila y funciona es el build/deploy de Mateo**. Cada tarea de
`/implement` que dependa de esto queda marcada NO VERIFICADO con los pasos exactos.

---

## 6. Dependencias nuevas

Ninguna. `getCloudflareContext` ya viene con `@opennextjs/cloudflare` (dependencia existente).
`Fetcher` es un tipo, no una dependencia de runtime.

---

## 7. Límites de Cloudflare Workers

Sin impacto nuevo. Un Service Binding no cuenta como una subrequest HTTP pública (no consume el
límite de subrequests de la misma forma que un `fetch` a una URL externa) y no tiene costo en el plan
gratuito.

---

## 8. Estrategia de pruebas

**Nada de esto se puede probar de extremo a extremo en este contenedor** (sin `wrangler dev` con
bindings, sin deploy). La verificación real es 100% de Mateo, con una lista corta y exacta:

1. `npm run pages:build && npx wrangler deploy` (frontend) — debe compilar y desplegar sin error.
2. Login real en el navegador → DevTools → Network → la petición a `/auth/login` debe salir hacia
   `undreocol-frontend.undreocol.workers.dev/api/auth/login` (no a `undreocol-api...`), con `200` y
   `Set-Cookie`.
3. DevTools → Application → Cookies → `uc_sesion_admin` debe aparecer bajo
   `undreocol-frontend.undreocol.workers.dev`.
4. El login debe llevar a `/plataforma` o `/app/dashboard` (018 CA-2/CA-3).
5. Login del portal del suscriptor, mismo criterio (CA-3 de esta spec).
6. Descargar un PDF de factura real (CA-5).
7. `npm run dev` (frontend) + `wrangler dev` (backend) en local: login sigue funcionando igual que
   antes (CA-4).

Lo único verificable aquí: que el TypeScript nuevo no tenga errores obvios de sintaxis/tipos leídos a
mano, y que `frontend/wrangler.toml` sea TOML válido tras el cambio (`toml` parseable con una
herramienta simple, sin depender de `npm`).

---

## 9. Lo que este plan NO hace

No compra un dominio propio. No toca `ALLOWED_ORIGIN`/CORS del backend. No migra los *server
components* al binding. No cambia nada del flujo de desarrollo local. No toca 018 ni ninguna otra
feature — es una corrección de infraestructura de despliegue, aislada.
