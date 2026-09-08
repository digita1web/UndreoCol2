# TASKS — 020: proxy-cookies-mismo-origen

**Spec aprobada:** 2026-09-08 (sin decisiones abiertas)
**Plan aprobado:** 2026-09-08 (advertencia de verificabilidad aceptada: este entorno no compila ni
despliega el frontend)

Una tarea = un commit. Sin evidencia no hay commit (`CLAUDE.md §4` y §9). La IA no hace `push` salvo
autorización expresa de Mateo (§9.1). Dado el bloqueo de entorno, casi toda la evidencia real de esta
feature es de Mateo — cada tarea deja explícito qué se verificó aquí y qué queda pendiente.

---

## Notas de entorno y prerrequisitos

- **Bloqueador total en producción hoy:** ni el login administrativo ni el del portal funcionan.
  Prerrequisito de producción — va antes que 013-016, igual que 017 y 018.
- **Este entorno no puede ejecutar `npm ci`/`next build`/`opennextjs-cloudflare build`/`wrangler
  deploy`** para el frontend (bloqueo de `cdn.sheetjs.com`, documentado desde 017 T-006 y repetido en
  018 T-006). **Tampoco `wrangler dev` con Service Bindings** (necesita dos procesos Workers
  corriendo a la vez). La verificación real de esta feature es de Mateo, con una lista exacta en cada
  tarea.
- **Lo que sí es verificable aquí:** sintaxis TOML del `wrangler.toml` editado; lectura cuidadosa del
  TypeScript nuevo contra la documentación oficial de OpenNext/Cloudflare citada en el plan; `grep`
  de consistencia (que nada más quede apuntando a la URL absoluta vieja).
- **Orden de dependencia:** T-001 (binding + tipo) bloquea T-002 (el proxy usa el tipo y el binding).
  T-002 bloquea T-003 (lib/api.ts asume que el proxy ya existe). T-004 cierra.

---

## T-001 — Service Binding + tipo `CloudflareEnv`

**Archivos:** `frontend/wrangler.toml` (editar), `frontend/cloudflare-env.d.ts` (crear)
**Hace:** (plan §2, §3) Agrega `[[services]] binding = "API" service = "undreocol-api"`. Crea el tipo
`CloudflareEnv { API: Fetcher }` — sin `any` (`CLAUDE.md §7`).

**Verificación:**
```bash
python3 -c "import tomllib; tomllib.load(open('frontend/wrangler.toml','rb')); print('TOML válido')"
cat frontend/wrangler.toml   # confirmar el bloque [[services]] tal cual el plan §2
grep -n "Fetcher" frontend/cloudflare-env.d.ts
```
**Resultado esperado:** TOML parseable sin error; el bloque `[[services]]` presente con `binding =
"API"` y `service = "undreocol-api"`; el tipo sin `any`.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**NO VERIFICADO — requiere Mateo:** que `wrangler deploy` (frontend) reconozca el binding sin error
("service undreocol-api not found" solo aparecería si el nombre no coincide exacto con el Worker
real — ya confirmado como `undreocol-api` en `backend/wrangler.toml:1`).
**Commit:** se registra en la Bitácora de cierre (T-004)

---

## T-002 — Route Handler proxy `/api/[...ruta]`

**Archivos:** `frontend/app/api/[...ruta]/route.ts` (crear)
**Hace:** (plan §3) Reenvía cualquier método/ruta bajo `/api/*` al binding `API`, reconstruyendo la
URL sin el prefijo `/api` y conservando método/headers/cuerpo vía `new Request(destino, request)`.
`export const dynamic = 'force-dynamic'` para evitar el error de build conocido de
`getCloudflareContext()` en rutas dinámicas (`opennextjs-cloudflare#652`, citado en plan §0). No lee
ni transforma el cuerpo de la petición ni de la respuesta — pasa streams tal cual (CA-5, PDFs).

**Verificación:**
```bash
cat frontend/app/api/\[...ruta\]/route.ts
grep -n "dynamic = 'force-dynamic'" frontend/app/api/\[...ruta\]/route.ts
grep -n "getCloudflareContext" frontend/app/api/\[...ruta\]/route.ts
# Sin node_modules no hay forma de tsc/build este archivo aquí (ver notas de entorno).
```
**Resultado esperado:** el archivo existe, exporta los 6 métodos (GET/POST/PATCH/PUT/DELETE/OPTIONS),
usa `getCloudflareContext<CloudflareEnv>()` y `env.API.fetch(...)`, no llama `.json()`/`.text()`
sobre la petición ni la respuesta.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**NO VERIFICADO — requiere Mateo (checklist del plan §8, pasos 1-3):**
1. `npm run pages:build && npx wrangler deploy` (frontend) sin error.
2. Login real → Network → la petición sale hacia
   `undreocol-frontend.undreocol.workers.dev/api/auth/login`, no hacia `undreocol-api...`.
3. Application → Cookies → `uc_sesion_admin` aparece bajo el dominio del frontend.
**Commit:** se registra en la Bitácora de cierre (T-004)

---

## T-003 — `lib/api.ts`: rutas relativas en producción

**Archivos:** `frontend/lib/api.ts` (editar), `frontend/.env.example` (editar)
**Hace:** (plan §4) `URL_BASE_API` por defecto pasa de `'http://localhost:8787'` a `'/api'`; sigue
respetando `NEXT_PUBLIC_API_URL` si está definida (desarrollo local no cambia, sigue necesitando
`.env.local` con la URL de `wrangler dev`). `.env.example` documenta que en producción NO se define
esa variable.

**Verificación:**
```bash
grep -n "URL_BASE_API" frontend/lib/api.ts
cat frontend/.env.example
grep -rn "undreocol-api.undreocol.workers.dev" frontend/lib frontend/app frontend/components
```
**Resultado esperado:** `URL_BASE_API` con el nuevo fallback `/api`; `.env.example` actualizado;
**ninguna** referencia a la URL absoluta del backend en `lib/`, `app/` ni `components/` (los únicos
`URL_BASE_API` que quedan con URL absoluta directa son los de los *server components*, a propósito —
plan §5.1 — y se confirma que siguen sin tocarse).
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**NO VERIFICADO — requiere Mateo:**
4. Login lleva a `/plataforma` o `/app/dashboard` (018 CA-2/CA-3).
5. Login del portal del suscriptor funciona de extremo a extremo.
6. Un PDF de factura descarga correctamente (CA-5).
7. `npm run dev` + `wrangler dev` en local: login sigue funcionando igual que antes (CA-4).
**Commit:** se registra en la Bitácora de cierre (T-004)

---

## T-004 — Cierre: documentación y checklist

**Archivos:** `docs/PLAN-PRODUCCION.md` (M-4 corregido — no era una suposición válida, ver spec §0),
`.specify/config.md` (fila 020, prerrequisito de producción), `CHANGELOG.md`, `specs/020-.../spec.md`
(CA-1 a CA-5 con su evidencia o su NO VERIFICADO), este `tasks.md` (bitácora).
**Hace:** Cierra la feature y dobla el aviso a Mateo: hasta que él confirme el checklist de
`/plan §8` completo, el bug de login sigue considerándose ABIERTO en `PLAN-PRODUCCION.md`, no
cerrado — el código está escrito y es lo mejor que se puede verificar sin navegador ni build real,
pero **CLAUDE.md §4 no permite darlo por bueno sin esa confirmación**.
**Verificación:** revisión del diff completo.
**Resultado esperado:** ningún archivo de la lista sin actualizar.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**Commit:** se registra en la Bitácora de cierre (T-004)

---

## Bitácora de cierre

| Tarea | Commit | Estado |
|---|---|---|
| T-001 Service Binding + tipo | — | Pendiente |
| T-002 Route Handler proxy | — | Pendiente |
| T-003 `lib/api.ts` rutas relativas | — | Pendiente |
| T-004 cierre | — | Pendiente |

### Pendiente de Mateo (checklist completo, plan §8) — nada de esta feature se cierra sin esto

1. `npm run pages:build && npx wrangler deploy` (frontend) sin error.
2. Network: la petición de login sale hacia el dominio del frontend, no hacia la API directamente.
3. Application → Cookies: `uc_sesion_admin` bajo el dominio del frontend.
4. El login lleva a `/plataforma` o `/app/dashboard`, no se queda en `/login`.
5. Login del portal del suscriptor funciona de extremo a extremo.
6. Un PDF de factura descarga bien.
7. Desarrollo local (`npm run dev` + `wrangler dev`) sigue funcionando igual que antes.
