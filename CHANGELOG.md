# CHANGELOG — UndreoCol

Formato: una entrada por sesión de trabajo. Lo más reciente arriba.

## [Sin publicar]

### 2026-09-09 — Sesión 035: causa raíz real del bucle de login — `.env.production` local

**Qué es:** tras la Sesión 033 (login funcionando, confirmado por Mateo en su navegador), el login
volvió a fallar para Mateo en producción — "carga y devuelve al login". Horas de diagnóstico
descartando, uno por uno, con evidencia real: el botón de salir (021, revertido temporalmente y
confirmado que el fallo persistía sin él); caché regional de Cloudflare (`?v=1` no cambió nada);
antivirus (Mateo confirmó que no tiene ninguno); Service Worker (no existe en el proyecto); límite de
intentos de login (verificado en la base real, `intentos: 0`); despliegue desactualizado (`wrangler
deployments list` mostraba siempre el último build como el activo); un commit inventado por otra IA
consultada en paralelo (no existía en el historial real del repo, y su conclusión —falta de CI/CD—
tampoco aplicaba, porque el despliegue manual sí estaba al día).

**Causa real, encontrada revisando la configuración de cookies de Brave con Mateo** (Configuración →
Privacidad y seguridad → Configuración de escudos y sitio → Contenido → Bloquear cookies: "se
bloquean cookies de terceros", el valor por defecto en navegadores modernos). Eso hizo sospechar que
el navegador estaba llamando a la API cruzando de dominio — lo que llevó a revisar si `lib/api.ts`
realmente estaba usando la ruta relativa `/api` en el paquete compilado. Encontrado:
`frontend/.env.production` **existía en el disco de la máquina de Mateo**, con

```
NEXT_PUBLIC_API_URL=https://undreocol-api.undreocol.workers.dev
```

Ese archivo está en `.gitignore` (`frontend/.gitignore:6`), así que **nunca apareció en ninguna
revisión de código ni en `git log`** — invisible por diseño, pero real en el filesystem. Next.js lo
carga automáticamente en todo `next build`/`pages:build`, sin aviso, y esa variable sobrescribe
exactamente el mecanismo del proxy de la feature 020: con ella definida, el navegador volvía a
llamar directo a `undreocol-api.undreocol.workers.dev` (cruzando de dominio) en vez de `/api/...`
— la cookie de sesión quedaba de tercero, y Brave (con su bloqueo de cookies de terceros activado por
defecto) la descartaba. Coincide con la toda la evidencia observada: fallaba en todos los navegadores
y en el teléfono (todos con bloqueo de terceros por defecto hoy), nunca se veía la petición de login
llegar al servidor **por el proxy** (sí llegaba, pero a la ruta vieja, cruzando de dominio — que
nunca se estuvo mirando en `wrangler tail`, filtrado sin querer por buscar solo `/api/auth/login`).

**Por qué mis pruebas con `curl` nunca lo detectaron:** probaban la ruta `/api/auth/login` del proxy
directamente, a mano — eso demostraba que el proxy en sí funcionaba, pero nunca verificaba qué URL
llamaba realmente el paquete de JavaScript que se le entrega al navegador. Lección: verificar el
código fuente y el comportamiento del servidor no sustituye inspeccionar el artefacto compilado real
cuando hay una variable de entorno de por medio.

**Corrección:** se borró `frontend/.env.production`. Verificado contra el paquete desplegado real
(no solo local): `grep` sobre el chunk JS de `/login` servido en producción — cero referencias a la
URL absoluta de la API. `.env.example` actualizado con una advertencia explícita para que esto no
vuelva a pasar.

**Además, en el camino:** se mejoró la visibilidad de errores en `login-form.tsx` (caja roja grande
con `e.name` y `e.message`, en vez de una línea pequeña) — queda como mejora permanente aunque no
haya sido la causa de este incidente, para que el próximo error real sea imposible de no ver sin
DevTools.

### 2026-09-09 — Sesión 034: botón de cerrar sesión (021) + auditoría de hallazgos abiertos

**Qué es:** al ver el panel de plataforma recién funcionando, Mateo notó que no hay forma de salir.
Investigado antes de escribir código: `logout()` y `POST /auth/logout` ya existían y funcionaban,
solo que ningún componente los llamaba — confirmado con `grep`, cero resultados. El portal del
suscriptor **no tenía este problema**: `logoutPortal()` ya estaba conectado a un botón real en
`app/portal/[slug]/page.tsx`, no se tocó.

**Implementado por SDD completo** (`specs/021-cerrar-sesion-admin/`), spec→plan→tasks→implement con
checkpoints aprobados:
- `frontend/components/boton-salir.tsx` (nuevo): cliente, llama `logout()`, siempre termina en
  `/login` aunque la petición al servidor falle.
- `frontend/app/app/layout.tsx`: un solo lugar para las 8 páginas de `/app/*` (dashboard, catálogo,
  cortes, facturación, lecturas, notificaciones, pagos, suscriptores).
- `frontend/app/plataforma/page.tsx`: mismo componente, misma cookie (`uc_sesion_admin`).

**Incidente durante la implementación, corregido de inmediato:** el primer despliegue de prueba se
hizo con `npm run build` (que en este repo es solo `next build`, para chequeo de tipos) en vez de
`npm run pages:build` (el build real de OpenNext/Cloudflare que genera `.open-next/worker.js`). El
Worker quedó desincronizado de los assets nuevos y **el sitio completo respondió 404, incluido el
login, por unos minutos**. Se reportó de inmediato y se corrigió redesplegando con el comando
correcto — confirmado restaurado antes de seguir. Se documenta sin ocultar el error (CLAUDE.md §8).

**Verificado con evidencia real contra producción** (`curl`, sesión real): botón presente en
`/app/suscriptores` y `/plataforma`; flujo completo de salida confirmado —
`POST /api/auth/logout` → `200`, petición posterior a un área protegida → `307` → `/login`.

**Además, auditoría completa de lo pendiente** (a pedido de Mateo, "no quiero errores"), ahora
posible ejecutar de verdad en este entorno (acceso real a la máquina de Mateo, sin el bloqueo de
`cdn.sheetjs.com` de las sesiones anteriores):
- `npm run build`/`npm run lint` del frontend: limpios, verificado real por primera vez.
- Backend: 206 tests en verde, `wrangler deploy --dry-run` OK.
- B-6 (cabeceras de seguridad): confirmado con `curl -I` real contra producción — ya no queda
  "pendiente de verificar build".
- Advisor de seguridad de Supabase: sin hallazgos nuevos.
- **Sigue genuinamente abierto**, sin cambios esta sesión: M-2 (necesita su propia feature), M-5 y
  B-1 (decisiones de producto), B-5 (exige subir a `next@16`), "leaked password protection" de
  Supabase Auth (un toggle nunca activado). Ninguno es un bug activo — son alcance mayor o
  decisiones que le corresponden a Mateo.

### 2026-09-08/09 — Sesión 033: login funcionando de extremo a extremo en producción real

**Qué es:** cierre real del incidente de la Sesión 032. Mateo desplegó el frontend con el código de
020 y el login seguía sin funcionar — dos rondas más de errores reales, cada una diagnosticada con
evidencia (no supuesta) y corregida:

1. **`getCloudflareContext()` devuelve una `Promise`** en la versión instalada de
   `@opennextjs/cloudflare` (1.20.5) — la guía general de OpenNext lo documenta como síncrono. Error
   real de `next build` de Mateo: `Property 'env' does not exist on type 'Promise<...>'`. Fix: agregar
   `await`.
2. **El genérico de `getCloudflareContext()` no es el tipo del `env`** — es `CfProperties`
   (propiedades de `request.cf`), confirmado leyendo la firma real instalada
   (`node_modules/@opennextjs/cloudflare/dist/api/cloudflare-context.d.ts`, vía Mateo). El tipo de
   `env` se toma solo, de la interfaz global `CloudflareEnv`. Fix: quitar el genérico incorrecto.
3. **Bug real distinto, encontrado con `wrangler tail`:** `dashboard/page.tsx` y `plataforma/page.tsx`
   (Server Components) tenían su propio respaldo hardcodeado a `http://localhost:8787` para cuando
   `NEXT_PUBLIC_API_URL` no está definida — que es justo lo que pasa en producción a propósito desde
   020 T-003. `lib/url-base-api-servidor.ts` (nuevo): resuelve la URL por el host de la propia
   petición entrante en vez de asumir una fija.

**El cambio de sesión que más costó diagnosticar:** después de corregir los tres puntos de arriba, el
login seguía dando `500` ("No se pudo consultar usuarios_servicio"). Causa real, no relacionada con
020: **el backend (`undreocol-api`) no se había vuelto a desplegar desde antes de que existiera la
feature 018** — el código en el repositorio ya tenía el fix de `resolverClienteActivo` (018 T-004),
pero el Worker en producción seguía corriendo la versión vieja, que sí contaba la membresía de
plataforma como "acueducto activo". Encontrado comparando el código local contra el comportamiento
real observado, no adivinado.

**Cambio de entorno a mitad de la sesión:** esta conversación pasó de un contenedor en la nube (sin
salida a `cdn.sheetjs.com` ni a `api.cloudflare.com`, así que nunca pudo compilar/desplegar el
frontend) a ejecutarse directamente en la máquina de Mateo, con `wrangler` ya autenticado — desde ahí
se pudo desplegar el backend directamente y correr `curl`/`wrangler tail` reales contra producción,
en vez de depender de que Mateo copiara y pegara cada resultado.

**Verificación real, contra producción, con `curl` (no en el navegador todavía en ese momento):**
```
POST https://undreocol-frontend.undreocol.workers.dev/api/auth/login
  -> 200, Set-Cookie uc_sesion_admin bajo undreocol-frontend.undreocol.workers.dev (dominio correcto)
GET  https://undreocol-frontend.undreocol.workers.dev/app/dashboard  (con la cookie)
  -> 307 -> /plataforma
GET  https://undreocol-frontend.undreocol.workers.dev/plataforma  (con la cookie)
  -> 200, "Panel de plataforma" en el cuerpo
```
Confirmado también por Mateo en su navegador real, con captura de pantalla: el panel carga completo,
formulario de alta y lista de acueductos incluidos.

**Cierra:** M-4 (`docs/PLAN-PRODUCCION.md`, ahora RESUELTO de verdad, no "probablemente"); el
bloqueador total de login que arrastraba la Sesión 032; deja al backend y al frontend desplegados con
el código real de `main` (se hizo cherry-pick del último fix de 020 a `main`, que no había llegado ahí
por el momento en que se abrió el PR de fusión).

**Nota operativa para Mateo:** la contraseña de prueba de `mateo2026@gmail.com` quedó escrita en la
conversación durante el diagnóstico — cámbiala.

### 2026-09-08 — Sesión 032: feature 020, proxy-cookies-mismo-origen (login roto en producción)

**Qué es:** con 018 desplegado y la migración aplicada, Mateo probó el login real en producción y no
funcionaba — el botón pasaba a "Ingresando…" y volvía a "Ingresar" sin navegar a ningún lado.
Diagnosticado con evidencia real (pestaña Network del navegador de Mateo, no adivinado): `POST
/auth/login` respondía **200** con un `Set-Cookie` válido para el usuario correcto — el backend, la
base de datos y el login en sí funcionaban perfecto. El problema estaba en la arquitectura de
despliegue: `undreocol-frontend.undreocol.workers.dev` y `undreocol-api.undreocol.workers.dev` son
**dominios distintos** para efectos de cookies (`workers.dev` está en la Public Suffix List — cada
Worker de la cuenta es su propio sitio, no comparten `undreocol.workers.dev` como se asumió antes).
La cookie de sesión quedaba guardada bajo el dominio de la API; el frontend nunca la veía.

**Corrige una afirmación equivocada de la Sesión 029** (tabla de hallazgos abiertos): decía que M-4
"probablemente ya no aplica" porque frontend y API "comparten el dominio registrable
`undreocol.workers.dev`". Era falso — investigado con la comunidad de Cloudflare (ver
`specs/020-proxy-cookies-mismo-origen/spec.md` para las fuentes citadas) y confirmado con la
evidencia real de Mateo.

**Decisión de Mateo:** de dos formas de arreglarlo — comprar un dominio propio, o hacer que el
navegador solo hable con el Worker del frontend y que este reenvíe internamente a la API — eligió la
segunda (proxy con Service Binding de Cloudflare, sin costo). Se implementó como feature completa por
SDD (`spec.md` → `plan.md` → `tasks.md` → `/implement`, checkpoints aprobados en cada fase).

**Implementado (T-001 a T-004):**

- **T-001** — `frontend/wrangler.toml`: Service Binding `API` → Worker `undreocol-api`.
  `frontend/cloudflare-env.d.ts`: tipo `CloudflareEnv { API: Fetcher }`.
- **T-002** — `frontend/app/api/[...ruta]/route.ts`: proxy transparente, reenvía cualquier
  método/ruta bajo `/api/*` al binding, sin leer ni transformar el cuerpo (streaming binario intacto
  para los PDFs).
- **T-003** — `frontend/lib/api.ts`: `URL_BASE_API` pasa a `/api` por defecto en vez de la URL
  absoluta del backend; desarrollo local no cambia (sigue usando `NEXT_PUBLIC_API_URL` en
  `.env.local`).
- **T-004** — este cierre: `docs/PLAN-PRODUCCION.md` (M-4 corregido, marcado "en corrección, no
  cerrado"), `.specify/config.md` (fila 020), `CHANGELOG.md`.

**Verificado aquí (sin poder compilar ni desplegar el frontend — mismo bloqueo de `cdn.sheetjs.com`
de siempre):** sintaxis TOML válida del `wrangler.toml` editado; el Route Handler exporta los 6
métodos, usa `getCloudflareContext<CloudflareEnv>()` y `env.API.fetch()`, sin `any`; `grep` confirma
que ninguna referencia a la URL absoluta del backend quedó fuera de los *server components* (que no
se tocan a propósito, ya reenvían la cookie a mano y no tienen este bug).

**NO VERIFICADO — requiere Mateo, checklist completo antes de cerrar M-4 y esta feature:**
1. `npm run pages:build && npx wrangler deploy` (frontend) sin error.
2. Network: la petición de login sale hacia el dominio del frontend, no hacia la API directo.
3. Application → Cookies: `uc_sesion_admin` bajo el dominio del frontend.
4. El login lleva a `/plataforma` o `/app/dashboard`.
5. Login del portal del suscriptor funciona de extremo a extremo.
6. Un PDF de factura descarga bien.
7. Desarrollo local sigue funcionando igual que antes.

### 2026-09-08 — Sesión 031: feature 018, panel de plataforma

**Qué es:** Mateo pidió crear un superadmin para poder dar de alta las credenciales de los
acueductos. Al intentarlo se encontraron dos huecos reales: no existe ninguna pantalla para eso en
`frontend/` (solo `crear_tenant_con_admin`, 001, pensada para que un usuario cree SU PROPIO
acueducto), y `resolverClienteActivo()` no excluía la membresía `administrador` (`cliente_id NULL`)
de "acueducto activo" — un superadmin puro caía en un `/app/dashboard` vacío. Se abrió la feature
018 por SDD completo (`/specify` → `/plan` → `/tasks` → `/implement`, checkpoints aprobados por
Mateo en cada fase, incluida la decisión §5.1: sin transacción atómica única entre `auth.users` y
Postgres — el riesgo residual de un fallo a mitad del alta se acepta explícitamente a cambio de no
usar `service_role` en la ruta, CLAUDE.md §12).

**Bootstrap previo, por SQL manual (antes de que existiera el panel):** con autorización explícita
de Mateo, se creó su propio superadmin en producción real (`undreocol-produccion`,
`dutudjchhhmqadjowibj`) — `perfiles` + `membresias(rol='administrador', cliente_id=NULL)` para la
cuenta `admin-prueba@undreocol.app`, verificada previamente contra `auth.users` (correo confirmado,
`last_sign_in_at` real).

**Implementado (T-001 a T-006), cada tarea con su propio commit y evidencia real:**

- **T-001** — migración `20260919090000_panel-plataforma.sql`: política `perfiles_alta_plataforma`
  (el único permiso que le faltaba al superadmin en las 4 tablas del alta) y dos funciones
  `crear_acueducto_base`/`asignar_admin_acueducto`, **`security invoker`, no `definer`** — con la
  política nueva, RLS ya autoriza todo lo que tocan, así que no hay bypass que auditar (lección de
  C-1 llevada un paso más allá).
- **T-002** — suite de aislamiento `903`: 6 pasos contra PostgreSQL real. Regresión completa desde
  cero: 18/18 migraciones, 16/16 suites en verde.
- **T-003** — `backend/src/lib/plataforma.ts`: `generarContrasenaTemporal`, `crearAcueductoBase`,
  `signUpAdminAcueducto` (`crearClienteAnon`, nunca `service_role`), `asignarAdminAcueducto`.
- **T-004** — fix de `resolverClienteActivo` (el bug real): excluye `cliente_id IS NULL` de
  `lista`/`activo`, expone `esAdminPlataforma`.
- **T-005** — `GET /plataforma`, `POST /plataforma/acueductos` (orden de 3 pasos que minimiza el
  daño de un fallo a mitad de camino, plan §5.1), `GET /dashboard` con `esAdminPlataforma` en el 400.
- **T-006** — frontend: `/plataforma` (lista + alta), `dashboard/page.tsx` redirige ahí en vez de a
  `/onboarding` cuando corresponde, `plataforma-form.tsx` con `useHidratado()` (CLAUDE.md §7) y
  muestra la contraseña temporal una sola vez.

**Verificado (backend, real):** 206 tests unitarios en verde (19 archivos, 24 nuevos), `tsc`/`eslint`
limpios, `wrangler deploy --dry-run` EXIT=0, 16 suites de aislamiento en verde contra PostgreSQL 16
nativo. Cada tarea incluye la prueba de que sus tests SIRVEN (se rompe algo a propósito, cae el caso
correcto, se restaura).

**NO VERIFICADO — requiere Mateo:** `npm run build`/`npm run lint` del frontend (mismo bloqueo de
`cdn.sheetjs.com` que 017); alta real de un acueducto contra el Worker desplegado + Supabase real;
login del admin nuevo con la contraseña temporal, en navegador real; aplicar la migración
`20260919090000_panel-plataforma.sql` a producción (pendiente de autorización expresa).

**Fuera de alcance, a propósito:** invitación por correo (Opción A de la spec §0.3) queda para una
feature 019 futura — decisión explícita de Mateo, para no bloquear el alta ya funcional con un
flujo más grande.

**Actualización — migración aplicada a producción real, con autorización expresa de Mateo en el
momento:** `20260919090000_panel-plataforma.sql` aplicada a `undreocol-produccion`
(`dutudjchhhmqadjowibj`) vía MCP. Verificado contra la base real antes/después:

```
Antes: perfiles con 2 políticas (lectura, update_propio); las 2 funciones no existían.
Después:
  perfiles: 3 políticas (perfiles_alta_plataforma=INSERT, perfiles_lectura=SELECT,
            perfiles_update_propio=UPDATE)
  crear_acueducto_base / asignar_admin_acueducto: prosecdef=false (invoker),
    publico=false, anon=false, authenticated=true
```

Advisor de seguridad tras aplicar: sin hallazgos nuevos — ninguna de las 2 funciones aparece en los
lints de `SECURITY DEFINER` ejecutable (correcto: son `invoker`). Los hallazgos que sí aparecen son
preexistentes, ya conocidos de sesiones anteriores (funciones internas/triggers y el toggle de
"leaked password protection", sin relación con esta migración).

**Sigue pendiente:** desplegar el backend (el Worker en producción no tiene todavía el código de
esta feature ni el fix de CORS/M-3) y la prueba funcional real de extremo a extremo (alta de un
acueducto + login del admin nuevo) — ninguna de las dos se hizo, quedan para cuando el deploy esté
hecho.

### 2026-09-08 — Sesión 030: las 6 migraciones de seguridad, aplicadas a producción real

**Qué es:** el conector MCP de Supabase quedó disponible en esta sesión. Mateo confirmó su
conexión y, tras señalar que el fix del hallazgo CRÍTICO C-1 seguía sin aplicar en la base real,
autorizó expresamente aplicar todas las migraciones pendientes.

**Proyecto identificado:** `undreocol-produccion` (`dutudjchhhmqadjowibj`), `ACTIVE_HEALTHY`,
`sa-east-1`, creado 2026-09-06. `clientes` vacío (0 filas) y `auth.users` con 1 usuario: preproducción
real, sin acueductos todavía.

**Diagnóstico antes de tocar nada.** `list_migrations` del proyecto vino vacío — sin historial de
Supabase, aunque el esquema sí existía (aplicado por otra vía, sin tracking). Se verificó función por
función, contra el código fuente real (`pg_proc.prosrc`) y los privilegios reales
(`has_function_privilege`), qué estaba aplicado y qué no:

```
Base (001-013, 22 tablas, RLS FORCE en las 22)  -> APLICADO
C-1  siguiente_numero_factura (guarda de autorización)  -> NO aplicado
B-2  portal_validar_credenciales (guarda de NULL/vacío)  -> NO aplicado
017  admin_intentos_login / admin_login_estado / admin_login_registrar  -> NO existían
017  purgar_intentos_login  -> NO existía
B-3  tarifa_vigente (guarda de pertenencia al acueducto)  -> NO aplicado
B-3  6 funciones del portal sin EXECUTE heredado por authenticated  -> NO aplicado
```

**Se aplicaron las 6 migraciones pendientes, en orden, vía `apply_migration` (MCP), con
verificación inmediata después de cada una:**

1. `20260914090000_fix-autorizacion-siguiente-numero-factura` (**C-1, CRÍTICO**)
2. `20260915090000_fix-portal-login-documento-nulo` (B-2)
3. `20260916090000_rate-limit-login-admin` (017 T-001 — tabla + `admin_login_estado`/`admin_login_registrar`)
4. `20260917090000_purga-intentos-login` (017 T-005 — cierra M-6)
5. `20260918090000_endurecer-privilegios-funciones` (B-3 + observación de 017 T-001)

**Verificado tras cada aplicación, contra la base real, no supuesto:**

```
siguiente_numero_factura contiene la guarda "No autorizado"           -> true
portal_validar_credenciales contiene la guarda de NULL/vacío          -> true
tarifa_vigente contiene la guarda "No autorizado"                     -> true
admin_intentos_login existe, con RLS FORCE                            -> true
purgar_intentos_login existe                                          -> true

Privilegios finales (has_function_privilege, los 11 puntos críticos):
  admin_login_estado/registrar       anon=t  authenticated=f   (correcto)
  6 funciones del portal             anon=t  authenticated=f   (correcto, antes t)
  purgar_intentos_login              anon=f  authenticated=f   (solo service_role)
  siguiente_numero_factura           anon=f  authenticated=t   (correcto, guarda interna)
  tarifa_vigente                     anon=f  authenticated=t   (correcto, guarda interna)
```

**Advisor de seguridad de Supabase, antes y después:** las 6 funciones del portal desaparecieron de
`authenticated_security_definer_function_executable`; `admin_login_*` aparecen únicamente en la lista
de `anon` (intencional, documentado en el propio hallazgo). Sin hallazgos nuevos de severidad
relevante. **Hallazgo nuevo de bajo impacto, fuera del alcance de las migraciones:** protección de
contraseñas filtradas (HaveIBeenPwned) desactivada en Supabase Auth — es un ajuste de un clic en el
dashboard, no de esquema; queda pendiente para Mateo.

**No se reprodujo el exploit completo de C-1 contra producción** (a diferencia de la Sesión 027 en
local): la tabla `clientes` está vacía, así que no hay ningún acueducto ni consecutivo real que
mutar, y no se crean datos de prueba en la base de un cliente sin que se pida explícitamente. La
evidencia de código fuente y privilegios, verificada tras cada aplicación, se consideró suficiente:
es el mismo texto que superó la explotación completa en el entorno local de la Sesión 027.

**Estado de la auditoría tras esta sesión: los 11 hallazgos corregidos en el repositorio (C-1, A-1,
A-2, M-1, M-3, M-6, B-2, B-3, B-4, B-6) están ahora también aplicados en la base de producción real.**
Siguen pendientes en el repositorio, sin cambios: M-2 (feature propia), M-4 (confirmar en DevTools),
M-5 y B-1 (decisiones de producto de Mateo), B-5 (requiere `next@16`).

**Pendiente para Mateo, no de código:**
1. Activar la protección de contraseñas filtradas en el dashboard de Supabase Auth.
2. Desplegar el Worker (`npm run deploy:produccion`, commit `f98850a`) para que la ruta
   `POST /auth/login` empiece a usar `admin_login_estado`/`admin_login_registrar` — las funciones ya
   existen en la base, pero el código del Worker que las invoca solo se publica al desplegar.
3. Configurar el cron `undreocol-limpieza` para que invoque `purgar_intentos_login` (ya lo hace el
   código de `cron/limpieza.ts`, commit `7760d66` — falta el despliegue).

---


### 2026-09-07 — Sesión 029: cierre de hallazgos abiertos de la auditoría (M-3, B-3, B-6 + T-001)

Continuación directa de la auditoría (Sesión 027) y de la feature 017 (Sesión 028). Se corrigen los
hallazgos que **se podían corregir con verificación real**, y se dice explícitamente cuáles no y por
qué — que es la parte que importa.

**Corregidos**

- **M-3 (`f98850a`) — `ALLOWED_ORIGIN` de producción.** `wrangler.toml` solo tenía
  `http://localhost:3000`, así que un `wrangler deploy` desde el repositorio pisaba el valor real y
  rompía el CORS del panel. Mateo confirmó el origen:
  `https://undreocol-frontend.undreocol.workers.dev`. Se añade `[env.production]` y el script
  `npm run deploy:produccion`.
  **Dos trampas de Wrangler que el bloque evita, ambas verificadas, no supuestas:**
  1. En un entorno con nombre, Wrangler llama al Worker `<nombre>-<entorno>`. Sin el override se
     habría creado un Worker **NUEVO**. Comprobado quitando el override a propósito y leyendo el
     README que el propio wrangler genera en `--outdir`:
     `SIN override → worker "undreocol-api-production"` · `CON override → worker "undreocol-api"`.
  2. Los bindings **no se heredan** del bloque raíz: sin repetirlos, producción se quedaría sin cola,
     sin R2 y sin correo. Se repiten los cuatro y el dry-run los lista todos.
  **AVISO:** producción se despliega ahora con `npm run deploy:produccion`, **no** con
  `npm run deploy`. Al añadir un binding nuevo hay que añadirlo **también** en `[env.production]`.

- **B-3 + observación de 017 T-001 (`2af5ab3`) — privilegios de funciones `SECURITY DEFINER`.**
  Dos correcciones del mismo patrón, en una migración:
  - Las **6 funciones del portal** conservaban el `EXECUTE` que `authenticated` recibe solo por los
    *default privileges* de Supabase; `revoke all … from public` no lo quita. No era explotable
    —revalidan credenciales completas y no aceptan un id desnudo— pero era superficie que nadie usa:
    quien las llama es el Worker con la clave `anon`.
  - **`tarifa_vigente()`** filtraba el `tarifa_id` de otro acueducto. Severidad real BAJA (solo un
    UUID; la fila sigue protegida por RLS y hay que adivinar un `servicio_id` de 128 bits), pero es
    el mismo patrón del identificador desnudo que causó el **CRÍTICO C-1**. La guarda es de
    **pertenencia al acueducto, no de rol**: el lector llega ahí por la simulación de periodo y
    filtrar por rol habría roto esa ruta sin ganar nada.
  Suite nueva `tests/aislamiento/902` (6 pasos).

- **B-6 (`4ab4200`) — cabeceras de seguridad.** El panel se servía sin ninguna: se podía embeber en
  un iframe ajeno (clickjacking sobre un panel que anula facturas y cambia tarifas). Se aplican las
  cinco que **no pueden romper** una aplicación normal. **Deliberadamente NO se añadió una CSP
  completa**: una CSP mal ajustada rompe la aplicación en silencio y aquí no se puede ejecutar
  `next build`. Merece su propia tarea con el navegador delante.

**NO corregidos, y la razón de cada uno — ninguno se deja en silencio**

| Hallazgo | Por qué no se toca |
|---|---|
| **M-2** el `lector` ve todo el negocio | Exige rediseñar RLS por rol en 6 tablas **y** la asignación de rutas al lector, que `ESPECIFICACION-FUNCIONAL §2.14.1` reconoce que no existe. Es una **feature**: `CLAUDE.md §3` prohíbe escribir código sin `spec.md` aprobado |
| **M-4** cookies `SameSite=Lax` | **Probablemente ya no aplica.** Con la URL real que dio Mateo, frontend y API comparten el dominio registrable `undreocol.workers.dev`, así que son *same-site* y las cookies `Lax` sí viajan. Falta que lo confirme en DevTools para cerrarlo |
| **M-5** registro público | Decisión de **producto**, no de seguridad |
| **B-1** `planes` legible por `anon` | Decisión de **producto**: que el catálogo comercial de un SaaS sea público es normal. Verificado que hoy nada lo lee salvo `GET /salud`, que seguiría funcionando si se restringiera. El parche de una línea queda escrito en `PLAN-PRODUCCION.md` por si Mateo decide lo contrario |
| **B-5** `postcss` | Exige `next@16` (cambio mayor) y aquí ni siquiera se pueden instalar las dependencias del frontend. Sin ruta de explotación en este sistema: PostCSS solo procesa el CSS propio en tiempo de compilación |

**Método: cada test se probó rompiendo lo que vigila**

```
902  devolver el EXECUTE a authenticated        -> PASO 1 FALLÓ
     revertir tarifa_vigente al estado sin guarda -> PASO 3 FALLÓ
     restaurado                                  -> PRIVILEGIOS-FUNCIONES-AISLAMIENTO OK
M-3  quitar el override `name` de [env.production] -> worker "undreocol-api-production"
```

**Verificado (evidencia real)**

```
17/17 migraciones aplican limpias desde cero
Aislamiento: 14 suites, 0 en rojo · nueva 902 -> PRIVILEGIOS-FUNCIONES-AISLAMIENTO OK
Caminos legítimos de tarifa_vigente, uno por uno:
  admin de A -> tarifa de A · LECTOR de A -> tarifa de A (simulación de periodo intacta)
  service_role -> tarifa de B (cierre masivo intacto) · plataforma -> tarifa de B (soporte)
  servicio inexistente -> NULL sin lanzar (no es un oráculo de existencia)
Portal con anon: los 12 ataques cruzados siguen bloqueados
Backend: npx vitest run -> 176 passed (16 archivos) · tsc EXIT=0 · eslint EXIT=0
Backend: wrangler deploy --dry-run --env production -> EXIT=0, los 4 bindings y el origen real
Frontend: tsc --strict sobre next.config.ts -> EXIT=0; headers() ejecutada de verdad -> 5 cabeceras
```

**NO VERIFICADO — requiere validación manual de Mateo**

1. **`npm run build` y `npm run lint` del frontend.** No es un descuido: **no se pueden ejecutar en
   este contenedor**. `package.json` toma `xlsx` de `https://cdn.sheetjs.com/…` (Sesión 020) y el
   proxy responde **403** a ese host, así que `npm ci` aborta sin dejar `node_modules`.
   **Ejecutar el build ANTES de desplegar** el cambio de `next.config.ts`.
2. **Las 5 cabeceras en la respuesta real:** `curl -I https://undreocol-frontend.undreocol.workers.dev/login`.
3. **El consumidor de la cola en `[env.production]`:** wrangler no lista consumidores en el dry-run,
   solo se puede afirmar que la configuración parsea. Confirmar tras el primer despliegue que el
   cierre de facturación sigue consumiendo mensajes.
4. **M-4 en DevTools:** que `uc_sesion_admin` se guarda y viaja entre el frontend y la API.

**Recordatorio que sigue siendo lo más urgente:** nada de esto está aplicado en la base de
producción. Mergear a `main` no ejecuta migraciones. **El fix del CRÍTICO C-1 puede seguir sin
aplicar.** Orden obligatorio: migraciones primero, despliegue después — al revés, el login devuelve
503 porque el Worker llamaría a funciones que aún no existen.

**Estado de la auditoría:** 11 de 15 hallazgos cerrados (C-1, A-1, A-2, M-1, M-3, M-6, B-2, B-3, B-4,
B-6, y la observación de 017 T-001). Quedan 4 abiertos y ninguno es un defecto pendiente de arreglo:
M-2 necesita su propia feature, M-4 espera una comprobación en el navegador, y M-5 y B-1 son
decisiones de producto de Mateo.

---


### 2026-09-07 — Sesión 028: feature 017 rate-limit-login-admin (cierra A-2 y M-6)

**Qué es:** la implementación completa del hallazgo **A-2 (ALTO)** de la auditoría de la Sesión 027
—`POST /auth/login` sin ninguna protección de fuerza bruta—, pasando por las cuatro fases del SDD con
checkpoint de Mateo en cada una. Cierra de paso el hallazgo **M-6**.

**Decisiones que resolvió Mateo antes de escribir código**
- **§0.3 mecanismo → tabla en PostgreSQL.** Se descartó el binding de Rate Limiting de Cloudflare
  como sustituto: efímero, por centro de datos y no verificable en local, lo que choca con §4. Queda
  anotado como posible complemento futuro.
- **§0.4 bloqueo → retardo progresivo, no puerta fija.** Con un techo constante, quien conozca el
  correo del administrador lo mantiene fuera del panel indefinidamente fallando cada X minutos, a
  coste cero — y con un solo admin eso es bloquearle la facturación del mes.
- Con la primera quedó aprobada la **excepción a §5.4**: la tabla no lleva `cliente_id`, porque el
  login precede a la resolución del tenant (mismo criterio que `_keepalive`).

**Implementado (T-001 a T-007)**
- **T-001** — `admin_intentos_login` + 2 funciones `SECURITY DEFINER` otorgadas solo a `anon`.
  Retardo: umbral 5, luego 1, 2, 4, 8, 16, 32 y techo de 60 min; olvido a las 24 h. **Sin FK a
  `perfiles`**, que es requisito de CA-4 y no un descuido: se cuentan los emails inexistentes igual
  que los registrados, o el 429 se convierte en un oráculo para enumerar cuentas.
- **T-002** — Suite `901`, 11 pasos contra PostgreSQL real.
- **T-003** — `lib/auth-intentos.ts`, siempre con `crearClienteAnon`, nunca `service_role`.
- **T-004** — Integración en la ruta: 429 con el contrato del portal, 503 si no se puede saber
  (**falla cerrado**), 401 genérico sin cambios.
- **T-005** — `purgar_intentos_login()` y purga semanal. **Cierra M-6.** Nunca borra un bloqueo
  vigente: sería una forma gratuita de que el atacante limpie el suyo esperando al cron.
- **T-006** — El 429 muestra los minutos que faltan en vez del mensaje genérico.
- **T-007** — Este cierre: `spec §8`, `ESPECIFICACION-FUNCIONAL` (§3 tenía un vacío, ahora describe
  el bloqueo), roadmap con la fila 017 marcada como prerrequisito de producción, y `PLAN-PRODUCCION`
  con A-2 y M-6 resueltos.

**Método: cada test se probó rompiendo lo que vigila.** Un test que pasa en ambos casos no prueba
nada. En las seis tareas:
```
T-002  grant a authenticated -> PASO 2 · política de escritura -> PASO 1
       retardo fijo -> PASO 4 · fuga de CA-4 de 1 minuto -> PASO 10
T-003  invertir la política de fallo -> 3 failed | 2 failed según el sentido
T-004  quitar la consulta del límite de la ruta -> 4 failed | 2 passed
T-005  quitar la llamada a la purga del cron   -> 3 failed | 2 passed
```

**Dos errores propios que la verificación destapó (se reportan, CLAUDE.md §8)**
1. **T-001:** la primera versión solo hacía `revoke ... from public` y `authenticated` **seguía
   teniendo EXECUTE**: los *default privileges* de Supabase otorgan toda función nueva a ese rol y
   revocar de `public` no lo quita. **Consecuencia más allá de la 017:** las 6 funciones del portal
   (008/008b) arrastran el mismo EXECUTE heredado. No es explotable —revalidan credenciales completas
   y no aceptan un id desnudo— pero conviene alinearlas en una tarea aparte.
2. **T-005:** el paso 11 daba por hecho que `purgar_intentos_login(0)` no tocaría una fila de hace 2
   días. Falso: la guarda eleva un `p_dias` absurdo a 1 día, así que esa fila entra legítimamente. La
   expectativa estaba mal, no la función.

**Dos desviaciones señaladas y aprobadas**
- **plan §5.1:** el cálculo del retardo **no** va a `core/`. Debe ser atómico con el incremento del
  contador, así que vive en SQL; duplicarlo sería la misma fórmula en dos sitios (§5.6). Se testea
  contra PostgreSQL real, que es evidencia más fuerte que un test de una copia en TypeScript.
- **T-005:** se añadió una migración que el plan §1 no listaba, por la misma razón: el predicado de
  borrado en SQL es verificable con filas de verdad.

**Verificado (evidencia real)**
```
16/16 migraciones aplican limpias desde cero
Aislamiento: 14 suites, 0 en rojo (001-010, 012, 900, 901; 011 tras dashboard.sql)
Backend: npx vitest run -> 176 passed (16 archivos) · tsc EXIT=0 · eslint EXIT=0
Backend: wrangler deploy --dry-run (principal y limpieza) -> EXIT=0
Frontend: tsc --strict sobre lib/api.ts -> EXIT=0; minutosParaReintentar ejecutada
          de verdad (código compilado del archivo real): 9 casos en verde
Regla §7: 11 de 11 formularios conservan useHidratado
```

**NO VERIFICADO — requiere validación manual de Mateo**
1. **Secuencia HTTP real del bloqueo** (T-004): con `wrangler dev` + Supabase real,
   `for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code} " -X POST .../auth/login -H 'Content-Type: application/json' -d '{"email":"admin-a@test.local","password":"mala"}'; done`
   debe imprimir `401 401 401 401 401 429`, con `reintentar_en` en la sexta.
2. **CA-4 a nivel HTTP** (T-004): la misma serie con un email inexistente; códigos y cuerpos
   idénticos, pegados lado a lado.
3. **`npm run build` y `npm run lint` del frontend** (T-006). **No es un descuido:** no se pueden
   ejecutar en este contenedor. `package.json` toma `xlsx` de `https://cdn.sheetjs.com/...` (Sesión
   020, para evitar las vulnerabilidades sin parche del paquete de npm) y el proxy responde **403
   Forbidden** a ese host, así que `npm ci` aborta sin dejar `node_modules`.
4. **Comprobación visual** (T-006): tras 5 fallos, el sexto intento debe mostrar "Demasiados
   intentos. Vuelva a intentar en N minuto(s)".

**Estado de la auditoría tras esta sesión:** de los 15 hallazgos, resueltos C-1, A-1, **A-2**, M-1,
**M-6**, B-2 y B-4. Siguen abiertos M-2, M-3, M-4, M-5, B-1, B-3, B-5 y B-6, documentados con su
riesgo en `docs/PLAN-PRODUCCION.md`.

---


### 2026-09-07 — Sesión 027: auditoría de seguridad pre-producción (docs/PLAN-PRODUCCION.md)

**Qué es:** la auditoría única por LLM planificada en la Sesión 019, ejecutada antes de migrar el
primer cliente real. Cubre los 8 puntos del encargo: RLS de las 22 tablas, funciones SECURITY
DEFINER, sesiones admin y portal, rate limiting, validación de entradas, GRANTS, secretos y los
hallazgos pendientes de Semgrep.

**Contradicciones señaladas antes de decidir (CLAUDE.md §8)**
1. `PLAN-PRODUCCION.md` dice que la auditoría se hace "al completar el roadmap 001-014". **013 y 014
   no existen** (`specs/` llega hasta 012). Se auditó 001-012 y queda constancia de que la superficie
   de 013/014 no está cubierta.
2. El encargo pide "aplica el fix si es crítico o alto"; **CLAUDE.md §3 prohíbe escribir código sin
   `spec.md` aprobado**. Resuelto así: los fixes *correctivos* sobre código existente se aplican
   (C-1, A-1); el que exige un **subsistema nuevo** (A-2, tabla de intentos de login admin) NO se
   improvisa — se documenta con el diseño listo para `/specify`. Es decisión de Mateo.
3. El encargo dice que ya se encontró y corrigió "un problema real de GRANTS en producción" y pide
   confirmar que la migración de fix quedó completa. **Esa migración no existe en el repositorio**:
   no hay un solo `grant`/`revoke` de TABLA en las 13 migraciones, ni un commit que lo mencione, en
   los 72 del historial. Todos los privilegios de tabla vienen de los *default privileges* de
   Supabase. Si el arreglo se hizo a mano desde el panel web, **CLAUDE.md §5.2.3 exige escribir la
   migración equivalente** — está sin escribir. Lo que sí se verificó: las 22 tablas quedan con
   `ALL` para `anon`/`authenticated`/`service_role`, y lo único que las protege es RLS, que se probó
   tabla por tabla y aguanta.

**Método — evidencia ejecutable, no lectura de código (CLAUDE.md §4)**
No había Docker ni Supabase CLI en este entorno, pero sí PostgreSQL 16. Se levantó un cluster real y
se emuló el entorno de Supabase con fidelidad (roles `anon`/`authenticated`/`service_role` con
`BYPASSRLS`, `auth.uid()` sobre `request.jwt.claim.sub`, y los *default privileges* de `public`
idénticos a los del bootstrap de Supabase), se aplicaron las **13 migraciones desde cero** y los
fixtures 001-012, y se atacó la base.

**Hallazgos: 1 crítico, 2 altos, 6 medios, 6 bajos.** Detalle completo, riesgo de negocio y evidencia
en `docs/PLAN-PRODUCCION.md`.

- **C-1 (CRÍTICO, corregido — `1800ca9`)** — `siguiente_numero_factura()` es SECURITY DEFINER, está
  otorgada a `authenticated` y **no comprobaba nada sobre `p_cliente_id`**: un `cliente_id` desnudo
  en una función que no pasa por RLS. Cadena reproducida de punta a punta: `anon` saca el
  `cliente_id` de la víctima con `portal_cliente_por_slug()` (el slug es público) → cualquiera se
  registra por el `POST /auth/registro` abierto → muta el consecutivo de facturas de otro acueducto.
  **El consecutivo del acueducto B pasó de 1 a 4** desde una sesión que no podía leer ni una fila de
  `configuracion`. Riesgo: saltos en la numeración consecutiva que exige la contabilidad colombiana,
  y bloqueo del cierre de facturación por el `SELECT ... FOR UPDATE` sobre la fila de la víctima.
  Fix: la autorización va **dentro** de la función (no se revoca a `authenticated` porque
  `reconectar()` la necesita) — `auth.uid() IS NULL` → service_role, si no `es_admin_de()`.
- **A-1 (ALTO, corregido — `71e6d0b`)** — inyección de HTML en los seis cuerpos de correo al
  suscriptor. `nombreAcueducto` y el `motivo` del corte son texto libre de una persona. Un enlace de
  pago falso dentro de un aviso de mora legítimo, firmado con el dominio del acueducto. Confirma como
  **real** el hallazgo WARNING de Semgrep que quedó abierto en la Sesión 019.
- **A-2 (ALTO, PENDIENTE)** — cero protección de fuerza bruta en `POST /auth/login`. La única que
  existe (`portal_intentos_login`) cubre solo el portal, la cuenta de **menos** valor. Agravante: el
  Worker intermedia ante GoTrue, así que todo llega desde IPs de Cloudflare y ningún límite por IP
  del lado de Supabase puede distinguir al atacante. Diseño de fix listo para `/specify`.
- **Semgrep `index.ts:204` (ReDoS): FALSO POSITIVO**, medido y no supuesto. El grupo interno de
  `^[a-z0-9]+(-[a-z0-9]+)*$` empieza por `-`, que no está en `[a-z0-9]`: no hay ambigüedad para el
  backtracker. 50.000 caracteres del peor caso → **0,288 ms**, lineal.

**Lo que se confirmó que está bien (con evidencia, no supuesto)**
- Las **22 tablas** con RLS `ENABLE` + `FORCE`. Aislamiento multi-tenant intacto en lectura, INSERT,
  UPDATE y DELETE — **también en las 10 tablas sin test de aislamiento propio**. Un usuario
  autenticado sin membresía ve **2 filas en toda la base**: las de `planes`.
- CLAUDE.md §10 punto 23 se cumple **en la base**: los 14 vectores de escalada fallaron.
- El portal (008) resistió los 12 ataques cruzados: credenciales válidas contra otro tenant,
  documento de uno con código de otro, `factura_id` ajeno del mismo acueducto, inyección SQL,
  comodines `LIKE`. Ninguna función acepta un `usuario_servicio_id` desnudo.
- `SUPABASE_SERVICE_ROLE_KEY` no aparece en ninguna ruta de usuario — solo `cron/` y la cola (§5.4).
- Las 19 funciones SECURITY DEFINER tienen `search_path=public` fijo.
- **Cero secretos en todo el historial de git** (804 objetos, todas las ramas).
- **El fix de hidratación de la Sesión 022 está completo**: los 11 formularios con `<form onSubmit>`
  deshabilitan el submit hasta hidratar, incluido el login del portal (donde el submit nativo habría
  puesto documento y código de suscriptor en la query string). No queda ningún `<form>` sin cubrir.

**Verificado (evidencia real)**
```
Migraciones:  13/13 aplican limpias desde cero sobre PostgreSQL 16
Aislamiento:  13/13 suites en verde (001-010, 012 y 900 sobre fixtures 001-012;
              011 tras dashboard.sql) — método canónico de la Sesión 026
Exploit C-1:  ANTES consecutivo de B 1 -> 4 · DESPUÉS ERROR 42501, consecutivo intacto
Backend:      npx vitest run -> 140 passed (11 nuevos) · tsc EXIT=0 · eslint EXIT=0
Backend:      npx wrangler deploy --dry-run -c wrangler.toml -> EXIT=0
npm audit:    backend 0 vulnerabilidades · frontend 2 (postcss, build-time, ver B-5)
```

**NO VERIFICADO — requiere validación manual de Mateo**
1. **Rate limiting real en producción (A-2).** No se pudo probar contra el despliegue real (este
   entorno no tiene credenciales de Supabase ni de Cloudflare). Lo verificado es del código: no hay
   ningún rate limiting. Pasos: `for i in $(seq 1 50); do curl -s -o /dev/null -w "%{http_code} " -X POST https://<worker>.workers.dev/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@real","password":"malo"}'; done` — si salen 50 respuestas `401` sin ningún `429`, A-2 está confirmado en producción.
2. **Cookies entre sitios (M-4).** Abrir el frontend de producción en Chrome, iniciar sesión y
   comprobar en DevTools → Application → Cookies que `uc_sesion_admin` se guarda, y en Network que
   viaja en la siguiente petición a la API. Si no viaja, el despliegue depende de que ambos estén en
   el mismo sitio; **si se arregla con `SameSite=None` hacen falta tokens CSRF primero**.
3. **`ALLOWED_ORIGIN` en producción (M-3).** Confirmar en el panel de Cloudflare qué valor tiene hoy
   el Worker desplegado, y no volver a hacer `wrangler deploy` desde el repo hasta moverlo a
   `[env.production]`: el `--dry-run` de esta sesión muestra que se desplegaría `http://localhost:3000`.
4. **La migración de GRANTS que falta (contradicción 3).** Mateo debe confirmar si se tocaron
   privilegios a mano desde el panel de Supabase; si es así, hay que escribir la migración
   equivalente y compararla contra la base real (`\dp` sobre las 22 tablas).

**Continuación de la misma sesión — A-2 especificado y correcciones ejecutables aplicadas**

Tras entregar el informe, Mateo pidió especificar A-2 y aplicar las correcciones que se pudieran
ejecutar. Resultado:

- **`specs/017-rate-limit-login-admin/spec.md`** (`a9cb2bd`) — fase `/specify` de A-2, **EN REVISIÓN**.
  No se escribe código: `CLAUDE.md §3` exige checkpoint humano entre `/specify` y `/plan`, y la spec
  deja dos decisiones abiertas que son de Mateo — §0.3 el mecanismo (tabla en PostgreSQL, recomendada,
  vs. binding de Rate Limiting de Cloudflare) y §0.4 qué se bloquea (bloquear por email es la única
  clave posible, pero abre un **DoS dirigido contra el administrador del acueducto**; se propone
  retardo progresivo en vez de puerta cerrada). Pide además aprobación explícita para la excepción de
  "toda tabla lleva `cliente_id`" (§5.4), porque es infraestructura de autenticación anterior a la
  resolución del tenant, como `_keepalive`. **Numeración 017 y no 013**: el roadmap de
  `.specify/config.md` ya reserva 013 (exportes-contables), 014 (rrhh-incapacidades), 015 (qr-ocr) y
  016 (limpieza). El número no marca el orden — la spec dice que es prerrequisito de producción.
- **`b43c67d`** — corrección de un error propio: la suite del fix C-1 se había llamado
  `013_consecutivo_factura_aislamiento.sql` y ese número pertenece a `exportes-contables`. Pasa a
  `900_auditoria_consecutivo_factura_aislamiento.sql`; la serie 900+ queda para suites de seguridad
  transversales, fuera de la numeración de features.
- **B-4 corregido (`41d78d4`)** — `PATCH` faltaba en `allowMethods` del CORS y la API tiene 4 rutas
  PATCH, entre ellas **cerrar periodo**. De paso, el origen no permitido ya no recibe la cadena entera
  de `ALLOWED_ORIGIN` (con varios orígenes es una cabecera inválida) sino el primero de la lista.
- **M-1 corregido (`2907ba6`)** — 12 consultas del consumidor de la cola acotadas por `cliente_id`.
  Ahí `service_role` salta RLS, así que el `cliente_id` del mensaje era la única frontera y no se
  usaba. Las 3 ramas validan además que el mensaje lo traiga.
- **B-2 corregido (`b365141`)** — `portal_validar_credenciales` con documento NULL reventaba con una
  violación de NOT NULL cuyo DETAIL filtraba nombres de tabla y columnas; ahora devuelve
  `{"estado":"invalido"}` como cualquier otra credencial incorrecta, sin crear filas basura.

**Método de verificación de los fixes de código:** además de tests/tsc/lint/dry-run, de cada test
nuevo se comprobó que **falla sin el fix** — un test que pasa en ambos casos no prueba nada.
```
CORS  : revirtiendo solo allowMethods -> 2 failed | 7 passed · con el fix -> 9 passed
Cola  : quitando solo los .eq('cliente_id') -> 3 failed | 2 passed · con el fix -> 5 passed
Backend: npx vitest run -> 154 passed (13 archivos) · tsc EXIT=0 · eslint EXIT=0 · dry-run EXIT=0
Base   : 14 migraciones limpias desde cero · 13/13 suites de aislamiento en verde
B-2    : ANTES error NOT NULL con DETAIL · DESPUES los 5 casos degenerados -> "invalido"
Portal : los 12 ataques cruzados de la auditoria, re-ejecutados -> los 12 siguen bloqueados
```

**Sigue PENDIENTE:** A-2 (a la espera de aprobar la spec 017), M-2, M-3, M-4, M-5, M-6, B-1, B-3,
B-5 y B-6. Los 4 puntos NO VERIFICADOS de abajo siguen igual.

**Cierre de la contradicción de git (CLAUDE.md §9 / §12)**

Durante toda la sesión, el hook `Stop` del entorno remoto reclamó publicar en cada turno, y CLAUDE.md
§9 lo prohibía "sin excepciones". Se señaló tres veces y no se publicó. Al final Mateo autorizó el
push expresamente, se ejecutó, y quedó a la vista el problema de fondo: una regla escrita como
absoluta que en la práctica se levantaba cada vez que Mateo pedía publicar no protege nada — deja el
documento diciendo una cosa y el trabajo haciendo otra.

Mateo eligió la opción de **autorización acotada** (frente a autorización permanente o dejarlo igual):

- **`.claude/hooks/session-start.sh` + `.claude/settings.json`** (`f7a3565`, en la rama; `805979d`
  en `main`) — hook `SessionStart` versionado que, en cada sesión remota, añade al hook `Stop` una
  guarda para omitir el aviso de commits sin publicar en ramas `claude/*`. Solo esa comprobación:
  cambios sin commitear, archivos sin seguir y firmas no verificables siguen avisando. Va versionado
  porque `~/.claude/` es local al contenedor y se reprovisiona en cada sesión.
- **CLAUDE.md §9.1 nueva** — la regla por defecto no cambia (la IA commitea, Mateo publica). §9.1
  define la única vía de excepción: autorización expresa de Mateo en la conversación, y sobre todo
  qué NO cuenta como autorización — un hook, un check de CI o un aviso del entorno **nunca** lo son;
  tampoco el silencio, ni una autorización de otra tarea o de otra sesión, ni deducirla del contexto.
  Cuando la hay: se publica solo lo autorizado, `main` exige nombrarla explícitamente, la
  verificación de §4/§11 debe estar hecha antes, y se reporta después qué fue a cada rama.
  `git push --force`, reescribir historial publicado y tocar `frappe-legacy` siguen sin excepción.
- Se documenta también la convención de ramas `claude/<descripcion>` para el trabajo de sesión que no
  corresponde a una feature del roadmap, y que la IA no abre PR salvo petición explícita.

**Publicado en esta sesión** (con autorización expresa, la primera del proyecto): `main` ->
`805979d`, únicamente el commit del hook mediante cherry-pick; y la rama
`claude/security-audit-production-9oez9y` completa. **La auditoría NO se mergeó a `main`**: sus
correcciones y la spec 017 siguen pendientes de la revisión de Mateo.

Commits de la sesión: `1800ca9` (C-1), `71e6d0b` (A-1), commit de documentación, `b43c67d`
(renombrado), `a9cb2bd` (spec 017), `41d78d4` (B-4), `2907ba6` (M-1), `b365141` (B-2), `f7a3565`
(hook SessionStart) + el commit de §9.1.

---


### 2026-09-06 — Sesión 026: reset de la base local + regresión limpia (cierra el pendiente de la Sesión 024)

**Por qué:** desde la Sesión 024, la base local persistente acumuló rastro de pruebas reales
(pagos/facturas de prueba, eventos inmutables de `cortes_reconexiones`, y luego las filas DASH del
fixture de 011) que rompía por **conteo** —no por RLS— las suites de aislamiento 001/003/004 (nuevas,
por el rastro 011) y 005/006/007/008/010 (preexistentes). Mateo autorizó el reset para limpiarlo.

**Ejecutado (evidencia real, sin cambios de código):**
- `supabase db reset --local` → EXIT=0, las **12 migraciones** aplican limpias de cero
  (fundacion-tenancy … notificaciones-generales), sin `seed.sql`.
- Fixtures aplicados en orden canónico (uno por feature, EXIT=0 todos): `fundacion`, `catalogo`,
  `suscriptores`, `lecturas`, `facturacion`, `correo-factura`, `pagos`, `portal`, `cortes`,
  `importacion` (012) y `dashboard` (011).
- Regresión de aislamiento sobre la base limpia — **todas en verde**, sin ruido de conteos:

```
001 FUNDACION-AISLAMIENTO OK · 002 CATALOGO-AISLAMIENTO OK · 003 SUSCRIPTORES-AISLAMIENTO OK
004 LECTURAS-CONSUMO-AISLAMIENTO OK · 005 FACTURACION-AISLAMIENTO OK · 006 CORREO-FACTURA-AISLAMIENTO OK
007 PAGOS-AISLAMIENTO OK · 008 PORTAL-AISLAMIENTO OK · 009 CORTES-AISLAMIENTO OK
010 NOTIFICACIONES-GENERALES-AISLAMIENTO OK · 011 DASHBOARD-AISLAMIENTO OK · 012 IMPORTACION-AISLAMIENTO OK
```
  (Método canónico: cada suite corre en el punto en que está diseñada — 001-010 y 012 sobre los
  fixtures base 001-012 sin `dashboard.sql`; `dashboard.sql` (011) se aplica al final y la suite 011
  corre sobre ella. Las suites de conteo previas no se re-corren después de `dashboard.sql` porque
  ese fixture agrega deliberadamente filas DASH que alteran sus conteos — es la misma razón por la que
  el rastro rompía los conteos antes del reset.)
- Usuarios de login recreados con id canónico y contraseña `mateo-admin-123`:
  `admin-a@test.local` (id `…a1`) y `lector-a@test.local` (id `…a2`). Verificado con login real:
  `POST /auth/login` 200 para ambos; `GET /dashboard/indicadores` → admin 200 con indicadores y
  lector 403 con el error exacto.

**Estado:** el pendiente arrastrado desde la Sesión 024 (regresión formal con base reseteada) queda
cerrado. La base local vuelve a ser un entorno predecible para las próximas features.

---

### 2026-09-06 — Sesión 025: 011-dashboard-de-indicadores completa (T-001 a T-006)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/011-dashboard/`). Tres decisiones de alcance aprobadas por
  Mateo antes de escribir código: recaudo del mes = caja por `fecha_pago` (no por periodo de
  facturación), consumo promedio sobre `facturas.consumo_m3` de ciclo (no `lecturas`, evita doble
  conteo por reemplazo de contador) y endpoint de indicadores **solo `admin_acueducto` con 403
  explícito** para el `lector` (estado "No autorizado" en la UI, no degradación silenciosa).
- **T-001** — `backend/src/lib/dashboard.ts` (read-model de solo lectura + helpers puros
  `hoyUtc`/`limitesConsultaTendencia`/`armarEjeTendencia`/`armarTendencia`/`resumirCartera`) y sus
  unit tests. Reutiliza `obtenerCartera()` de 007 tal cual (nunca duplica la lógica de cartera).
  Reloj UTC compartido con 007 (D-1). Verificado: `npx vitest run` 129 passed (13 nuevas); `tsc` y
  `eslint` EXIT=0.
- **T-002** — Ruta `GET /dashboard/indicadores` + `ctx.rol` en `requerirClienteActivo()` (campo
  aditivo). Verificado con curl real contra `wrangler dev` + Supabase local: sin cookie 401, admin de
  A 200 con el payload completo (12 buckets, 4 estados), lector de A **403** con el error exacto;
  suite 129 passed, tsc/lint/dry-run EXIT=0.
- **T-003** — Fixture `tests/fixtures/dashboard.sql` (pagos con fechas relativas a `current_date` —
  D-6 — y periodos cerrados 2099 para el consumo promedio sin colisiones) + integración CA-1…CA-6
  con contraste SQL: recaudoMes 352000, cartera 178600/290000, morosos 2, consumo promedio 30.0
  (la factura anulada de 100 queda excluida), estados 3/1/1/1, tendencia de 12 meses con cero-fill;
  pago de B (700000), anulado (9999999) y fuera-del-eje (999999) excluidos de A; lector 403.
  **NO VERIFICADO:** el chequeo HTTP de admin de B (login del auth user inyectado por SQL falla en
  GoTrue local con "Database error querying schema") — CA-6 queda formalmente cubierto por el test
  de aislamiento de T-004 y por el contraste SQL de A; pasos para Mateo al final.
- **T-004** — `tests/aislamiento/011_dashboard_aislamiento.sql` → `DASHBOARD-AISLAMIENTO OK`:
  admin de A ve solo los marcadores DASH de A (pagos/facturas/periodos/suscriptores) y nada de B;
  admin de B ve solo lo suyo; promedio 2099-02 = 30 con la sesión de A; lector de A lee pero no
  inserta. **Regresión 001-012:** 002/009/011/012 OK; 001/003/004 ahora fallan por **conteo** (rastro
  DASH en la base local persistente — 6 suscriptores vs 2, 3 periodos vs 1 — no es fuga de RLS,
  todos los pasos de aislamiento cruzado anteriores al conteo pasan); 005/006/007/010 siguen fallando
  por conteo preexistente (Sesión 024) y 008 por su hallazgo preexistente.
- **T-005** — Frontend: componente presentacional `DashboardIndicadores` (tarjetas, gráfico de 12
  barras en CSS puro — D-5, sin dependencia —, conteos por estado y vínculos a `/app/pagos` y
  `/app/suscriptores`) y página `/app/dashboard` que solo llama al endpoint si el rol es
  `admin_acueducto`; el `lector` ve el estado "No autorizado" con enlace a `/app/lecturas`.
  Verificado: `npm run build` y `npm run lint` EXIT=0 y **render real de servidor** con curl a
  `next dev` + `wrangler dev` (admin: KPIs con "30 m³" y gráfico; lector: "No autorizado" sin
  KPIs). **NO VERIFICADO (requiere validación manual de Mateo):** click-a-click con Playwright —
  el paquete no está en este entorno (solo el Chromium cacheado); pasos exactos al final.
- **T-006** — Cierre: este CHANGELOG, checklist del spec §8 y bitácora en `tasks.md`.

**Verificado (evidencia real, no supuesta)**
```
Backend: npx vitest run → 129 passed; npm run build (tsc) EXIT=0; npm run lint EXIT=0
Backend: npx wrangler deploy --dry-run -c wrangler.toml → EXIT=0
Frontend: npm run build → EXIT=0 (19 rutas, dashboard dinámica); npm run lint EXIT=0
Aislamiento: DASHBOARD-AISLAMIENTO OK contra Supabase local real (Docker)
Integración: curl CA-1..CA-6 con contraste SQL 1:1 (valores del fixture DASH)
```

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
1. **Playwright CA-7**: con `wrangler dev` (backend) y `next dev` (frontend) corriendo, en Chromium
   real iniciar sesión con `admin-a@test.local`/`clave-segura` → `/app/dashboard` debe mostrar las
   tarjetas (recaudo del mes, cartera, morosos, consumo "30 m³"), el gráfico de 12 barras y los
   enlaces a `/app/pagos` y `/app/suscriptores`; con `lector-a@test.local`/`clave-segura` debe
   mostrar "No autorizado" sin ningún indicador. (Nota: las contraseñas de `admin-a` y `lector-a`
   en la base local se reasentaron a `clave-segura` vía la API admin de GoTrue para poder ejecutar
   los curl — cambio solo de entorno local, no commiteado.)
2. **HTTP de admin de B** (CA-6 a nivel HTTP): login de un admin del acueducto B para ver sus
   indicadores; el bootstrap de un auth user con el id del perfil `b1` choca con GoTrue local
   ("Database error querying schema"). Cobertura equivalente ya verificada: endpoint de A ==
   contraste SQL filtrado a A (los pagos de B no entran) + test de aislamiento SQL de T-004.
3. **Regresión formal con base reseteada**: los fallos de conteo 001/003/004 (nuevos, por el rastro
   DASH) y 005/006/007/008/010 (preexistentes) se limpian con `supabase db reset --local` +
   reaplicar las 12 migraciones + fixtures 001-012 en orden (decisión pendiente de Mateo desde la
   Sesión 024).

Commits de la feature: `e7d6c19` (T-001), `307174c` (T-002), `277318d` (T-003), `c4439e4` (T-004),
`f51f115` (T-005) + el commit de cierre (T-006).

---

### 2026-09-05 — Sesión 024: 010-notificaciones completa (T-001 a T-010)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/010-notificaciones/`), reconstruida desde cero porque el
  trabajo previo se perdió en un contenedor remoto anterior. Decisión señalada y aprobada por
  Mateo antes de escribir código: el canal sigue siendo Cloudflare Email Service — migrar a Resend
  (`docs/INFRAESTRUCTURA-Y-COSTOS.md §4`) queda como tarea separada con su propio `/specify`, no
  parte de esta feature (D-8 vigente, no hay D-11 todavía).
- **T-001** — Migración `20260913090000_notificaciones-generales.sql`: catálogo cerrado de los 6
  tipos con un `CHECK` (no un `enum`, para poder agregar un séptimo tipo sin migrar datos) y
  `configuracion.dias_aviso_vencimiento` (default 3, aprobado por Mateo). Verificado contra
  Supabase local real; de paso se detectó que esta base nunca había recibido las migraciones 009/012
  (se aplicaron, sin tocarlas, para poder correr una regresión real).
- **T-002** — Sin fixture nuevo (alcance corregido en /implement: el aislamiento general de
  `notificaciones` ya lo cubre 006, duplicarlo no sumaba nada). Test nuevo enfocado en lo que 010
  agrega: los 6 tipos son insertables, un tipo inválido sigue rechazado, `dias_aviso_vencimiento`
  aplicó a los clientes ya existentes.
- **T-003** — `core/notificaciones.ts`: 5 funciones puras de contenido por tipo +
  `computarActualizacionNotificacion()`/`MAX_INTENTOS_ENVIO` movidas desde `lib/email.ts` (006) sin
  cambiar su lógica.
- **T-004** — `lib/email.ts` generaliza `enviarCorreo()` (adjunto opcional);
  `enviarFacturaPorCorreo` (006) queda como envoltorio, mismo contrato de siempre. `lib/notificaciones.ts`
  nuevo: `encolarNotificacion()`.
- **T-005** — Tercera rama del consumidor de la cola (`enviar_notificacion`), reutilizando
  `undreocol-facturacion` (sin cola nueva).
- **T-006** — Enganches best-effort en `POST /pagos` (007), `POST /suscriptores/:id/corte` y
  `.../reconexion` (009): ninguna de las tres rutas cambia su contrato de respuesta. `GET
  /notificaciones` nueva. Verificado de punta a punta con `curl` real: pago/corte/reconexión reales
  contra `wrangler dev` + Supabase local, con el contenido real de los 3 correos confirmado
  (incluyendo el número real de la factura de reconexión resuelto de la base).
- **T-007** — Worker `undreocol-avisos-vencimiento` (cron diario, recordatorio + mora, idempotencia
  por `(factura_id, tipo)`). **Bug real encontrado y corregido durante la verificación** (no
  "debería funcionar"): `encolarNotificacion()` (T-004) nunca guardaba `factura_id`, así que la
  idempotencia nunca podía funcionar — confirmado insertando 2 facturas de prueba y disparando el
  cron dos veces (4 filas antes del fix, 1 fila por `(factura_id, tipo)` después).
- **T-008** — Alerta real de `monitor-db.ts`: envía correo a `ALERTA_EMAIL_DESTINO` (placeholder,
  Mateo debe poner el buzón real) sin pasar por `notificaciones` (esa tabla exige `cliente_id` sin
  excepción; la alerta es de plataforma, no de un cliente). `construirAlertaMonitoreo()` se movió a
  `nivel-monitoreo.ts` para no romper la regla existente de "`monitor-db.ts` solo exporta el
  default".
- **T-009** — Panel `/app/notificaciones` (solo lectura, filtros por tipo/estado). Verificado en
  Chromium real con Playwright, no solo build/lint.
- **T-010** — Verificación end-to-end: los 6 tipos de notificación confirmados juntos en el panel
  real por primera vez (recordatorio/mora del cron + los 4 síncronos). Deliberadamente NO se repitió
  pago/corte/reconexión por clic en los formularios — ya probados de punta a punta en T-006, y cada
  repetición deja otro evento permanente e imborrable en `cortes_reconexiones`.

**Hallazgo colateral importante (no es un bug de 010, hay que saberlo antes de tocar esta base
local otra vez):** las pruebas de integración reales de T-006/T-007/T-010 (pago, corte, reconexión,
más varias facturas de prueba) dejaron rastro permanente en la base de Supabase local persistente
de este entorno. Lo anulable (pago, facturas) se anuló vía los endpoints propios de la app; los
eventos de `cortes_reconexiones` son inmutables por diseño explícito (sin `DELETE` expuesto, mismo
comentario de la migración de 009) y no se pueden deshacer. Esto rompe las asunciones de conteo fijo
de filas que `005_facturacion_aislamiento.sql`, `006_correo_factura_aislamiento.sql`,
`007_pagos_aislamiento.sql` (preexistentes) y el propio `010_notificaciones_aislamiento.sql`
hardcodean — **verificado que NO es una fuga de aislamiento** (RLS sigue correcto, `cliente_id`
siempre del cliente dueño de la prueba). Al cierre de esta sesión, la regresión completa da:
```
001 OK · 002 OK · 003 OK · 004 OK · 005 FALLÓ (conteo) · 006 FALLÓ (conteo) · 007 FALLÓ (conteo) ·
008 FALLÓ (hallazgo preexistente, no de 010 — ver Sesión 016 y esta sesión) · 009 OK ·
010 FALLÓ (conteo) · 012 OK
```
Un `supabase db reset --local` real (reaplicando las 12 migraciones + todos los fixtures)
restauraría el estado limpio, pero es una decisión de Mateo: también borraría el usuario
`admin-a@test.local` de Supabase Auth usado en toda esta conversación para pruebas manuales.

**Verificado (evidencia real, no supuesta)**
```
Backend: npx tsc --noEmit / npx eslint . → EXIT=0 ambos
Backend: npx wrangler deploy --dry-run -c wrangler.toml → 1747.70 KiB / gzip 397.34 KiB
Backend: npx wrangler deploy --dry-run -c wrangler.avisos-vencimiento.toml → 711.00 KiB / gzip 138.42 KiB
Backend: npx wrangler deploy --dry-run -c wrangler.monitor-db.toml → 708.43 KiB / gzip 137.91 KiB
Backend: npx vitest run → 10 test files, 116 tests OK
Frontend: npm run build → 19 rutas incluida /app/notificaciones, sin errores/warnings
Frontend: npm run lint → limpio
```

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- Envío real a un buzón real de cualquiera de los 6 tipos: requiere Workers Paid + dominio
  verificado de la cuenta de Cloudflare de Mateo (igual límite que 006).
- `ALERTA_EMAIL_DESTINO` es un placeholder (`alertas@undreocol.app`) — Mateo debe reemplazarlo por
  el buzón real de monitoreo antes de producción.
- Decisión sobre el hallazgo colateral: si Mateo quiere un `supabase db reset --local` para limpiar
  esta base local, o prefiere dejarla así y que 005/006/007/010 se re-verifiquen en un entorno
  fresco la próxima vez.

Commits: `9b60964`…`3ad5f6f` (T-001), `fc017c3`…`744697f` (T-003), `51e0081`…`8411895` (T-004),
`3323b1a`…`df7c256` (T-005), `c641c65`…`9fadaeb` (T-006), `5cc8f44`…`63961f4` (T-007),
`9869eba`…`3b4aa91` (T-008), `352f604`…`6e167fe` (T-009), `69cd559` (T-010).

### 2026-09-05 — Sesión 023: fix login admin — cookie mal codificada al reenviarla desde el server component del dashboard

Con el fix de la Sesión 022 aplicado, el login dejó de hacer el submit nativo, pero apareció
un tercer síntoma en el mismo flujo (reportado con evidencia real de DevTools): `POST
/auth/login` respondía 200 y la cookie `uc_sesion_admin` sí quedaba guardada en el navegador,
pero tras el `router.push('/app/dashboard')` el usuario terminaba de vuelta en `/login`
visualmente, sin ningún error visible en la UI.

**Causa raíz (confirmada con curl, no supuesta):** `frontend/app/app/dashboard/page.tsx` es un
server component que reenvía la cookie de sesión al backend a mano (un `fetch` de servidor no
adjunta automáticamente las cookies del navegador):

```ts
headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${cookieSesion.value}` }
```

`backend/src/lib/auth.ts` escribe la cookie con `hono/cookie` `setCookie`, que la codifica con
`encodeURIComponent` porque el valor es un JSON (`{"at":…,"rt":…,"exp":…}`) y `{`, `"`, `:` no
son válidos en un cookie-value crudo. Pero `cookies().get(name).value` de `next/headers` **ya
devuelve el valor decodificado** — `next/dist/compiled/@edge-runtime/cookies` llama
`decodeURIComponent` internamente al leerlo. El código de `dashboard/page.tsx` reenviaba ese
valor ya decodificado como si fuera el crudo, produciendo un header `Cookie` inválido
(caracteres `{ } " : ,` sin escapar). El backend no podía volver a decodificarlo,
`verificarSesionAdministrativa` fallaba, `/dashboard` respondía 401, y la página hacía
`redirect('/login')` — el rebote silencioso observado.

Verificado el mecanismo exacto con curl, aislando cada paso:
```text
$ # 1. login real, capturar el Set-Cookie crudo (percent-encoded) tal como lo ve el navegador
$ curl -s -i -X POST http://localhost:8787/auth/login -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" -d '{"email":"admin-a@test.local","password":"mateo-admin-123"}'
Set-Cookie: uc_sesion_admin=%7B%22at%22%3A%22eyJhbGci...  (percent-encoded)

$ # 2. reenviar el valor CRUDO (lo que hace un fetch de navegador, o el fix correcto) → 200
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/dashboard \
    -H "Cookie: uc_sesion_admin=%7B%22at%22..."
200

$ # 3. reenviar el valor ya DECODIFICADO tal cual lo entrega next/headers (el bug) → 401
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/dashboard \
    -H 'Cookie: uc_sesion_admin={"at":"eyJhbGci...'
401
```

**Fix (una línea, un solo archivo):** `frontend/app/app/dashboard/page.tsx` — volver a codificar
el valor antes de reenviarlo, restaurando el round-trip `encodeURIComponent` (backend) ↔
`decodeURIComponent` (backend al leerlo) que `next/headers` rompe en el medio:

```ts
headers: { Cookie: `${NOMBRE_COOKIE_SESION}=${encodeURIComponent(cookieSesion.value)}` },
```

Único archivo afectado: se revisaron todos los usos de `cookies()` en `frontend/app/` (`grep -rln
"cookies()" app/`) — solo dos: `app/page.tsx` (solo verifica presencia con `.has()`, no reenvía
el valor, no afectado) y `app/app/dashboard/page.tsx` (el corregido).

**Verificado de verdad, extremo a extremo, con Playwright contra `wrangler dev` + `next dev`
reales (Chromium real, no simulado, instalado ad hoc en un directorio aislado — no se agregó
Playwright como dependencia del proyecto):**
```text
Antes del fix — rastro de red completo tras submit exitoso:
  POST http://localhost:8787/auth/login → 200
  GET  http://localhost:3000/app/dashboard?_rsc=... [next-url=/login] → 200
  GET  http://localhost:3000/login?_rsc=...          [next-url=/app/dashboard] → 200  (rebote)
  URL final: http://localhost:3000/login   ← bug confirmado

Después del fix — mismo flujo, mismas credenciales:
  POST http://localhost:8787/auth/login → 200
  GET  http://localhost:3000/app/dashboard?_rsc=... → 200
  GET  http://localhost:3000/app/dashboard?_rsc=... → 200  (sin rebote a /login)
  URL final: http://localhost:3000/app/dashboard

  Contenido real renderizado (fetched del backend, no mock):
    h1: "Acueducto A"
    dl: Usuario=Admin A · Rol=admin_acueducto · Usuarios de servicio=2
```

```text
$ npm run build   (frontend)
   ✓ Generating static pages (15/15)
   Route (app) ... ƒ /app/dashboard  131 B  103 kB   ← build limpio, sin errores/warnings TS

$ npm run lint    (frontend)
> eslint .
(sin salida = sin errores ni warnings)
```

Nota de proceso: la hipótesis inicial de esta sesión (cookie cross-origin entre `localhost:3000`
y `localhost:8787` por ser puertos distintos) se descartó con evidencia — las cookies HTTP no
distinguen por puerto, solo por host (`localhost` en ambos). El navegador sí enviaba la cookie a
ambos orígenes; el problema estaba enteramente en cómo el server component la volvía a serializar
para el `fetch` de servidor.

**Pendiente de validación manual de Mateo (no verificable en este entorno):** confirmar el mismo
flujo en un navegador real (no headless) para descartar cualquier interacción con extensiones del
navegador, y repetir el login end-to-end una segunda vez tras cerrar sesión, para confirmar que
el fix es estable en logins sucesivos.

### 2026-09-04 — Sesión 022: fix login — submit nativo durante la hidratación de React

Causa raíz (diagnosticada por Mateo con Playwright): carrera de hidratación de React. Si el
usuario envía el formulario de login antes de que React termine de hidratar el HTML SSR y
adjunte el `onSubmit`, el navegador ejecuta el submit nativo de HTML (GET con los campos como
query string en la URL), ignorando el `preventDefault()` porque el listener de React aún no
existe. Se reproducía de forma consistente con CPU/red throttled y clic inmediato tras
`domcontentloaded`.

**Fix:**
- Nuevo `frontend/lib/use-hidratado.ts`: hook `useHidratado()` que retorna `false` hasta que el
  componente monta en el cliente (`useEffect` + `useState`) y `true` después — patrón estándar.
- Aplicado a los **11 `<form onSubmit>`** del proyecto (login admin, login portal,
  onboarding, suscriptor, contador, reemplazo de contador, pago, servicio, tarifa, corte,
  reconexión): el botón de submit queda `disabled` hasta que el hook retorne `true`
  (`disabled={!hidratado || cargando}`), eliminando la ventana de carrera.
- Regla permanente documentada en CLAUDE.md §7: todo formulario nuevo/existente debe usar el hook.

**Verificado:**
```text
npm run build → BUILD_EXIT=0 (Next 15.5.25 · 15/15 páginas)
npm run lint  → LINT_EXIT=0
grep useHidratado → presente en los 11 formularios
grep disabled={cargando} (sin hidratado) → solo la del botón type="button" (Cancelar)
                                            de importacion-resumen.tsx, que es correcto
```

**NO VERIFICADO — requiere validación manual de Mateo (Playwright):** en este contenedor no hay
Playwright (`npx playwright` y `@playwright` ausentes). Pasos exactos:
1. Con `next dev` + Playwright, abrir `/login`, aplicar CPU/red throttled y hacer clic en
   "Ingresar" inmediatamente tras `domcontentloaded`. En la URL se verá el GET con la query
   string (bug) ANTES del fix; tras el fix no se reproduce.
2. Confirmar que en el HTML SSR el botón de submit aparece `disabled` hasta la hidratación.

### 2026-09-04 — Sesión 021: fix login admin — cookie `uc_sesion_admin` con `Secure` solo sobre HTTPS

Causa raíz del bug "login de administrador da 401 en el navegador aunque funciona por curl"
(confirmada por Mateo con evidencia de DevTools): la cookie `uc_sesion_admin` se escribía
SIEMPRE con `Secure`, también en desarrollo local (HTTP). Los navegadores descartan una cookie
`Secure` recibida por una conexión no-HTTPS → `POST /auth/login` respondía 200 con `Set-Cookie`,
pero la cookie nunca se guardaba y la siguiente petición autenticada iba sin cookie → 401 y
redirect silencioso al login.

**Fix (localizado y acotado):** `backend/src/lib/auth.ts` — el atributo `Secure` ya no es fijo;
se decide por el protocolo real del request (`new URL(c.req.url).protocol === 'https:'`). El edge
de Cloudflare (producción y previews) atiende todo por HTTPS → allí la cookie sigue siendo
`Secure`; en dev local (`wrangler dev`, http://localhost:8787) se omite `Secure` → el navegador
la guarda.

**Verificado de verdad (evidencia curl real, no asumida):**
- `wrangler dev` (HTTP local) contra Supabase local: `POST /auth/login` → 200, `Set-Cookie:
  uc_sesion_admin=…; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax` (SIN `Secure`) → `GET
  /auth/sesion` con esa cookie → **200** (antes: 401 por cookie descartada en el navegador).
- `wrangler dev --local-protocol https`: mismo login → `Set-Cookie: … HttpOnly; Secure;
  SameSite=Lax` (CON `Secure`) → `GET /auth/sesion` → **200**.
- `npm run build` (tsc) EXIT=0 · `npm run lint` EXIT=0 · `vitest` 9 archivos / 105 tests en
  verde · `wrangler deploy --dry-run` EXIT=0.
- Usuario de prueba creado en Supabase local para la verificación: `fix-cookie-dev@test.local`.
- Limitación de entorno anotada: el flujo SSR vía `next dev` no se pudo validar con curl — el
  middleware de Next no procesa cookies de peticiones curl directas en este entorno (ni con
  cookie trivial); la verificación navegador real queda para Mateo (mismo repro que confirmó el
  bug, ahora debe entrar sin loop).

**Hallazgo relacionado, FUERA del alcance de este fix (decisión de Mateo pendiente):**
`backend/src/lib/sesion-suscriptor.ts` (cookie del portal `uc_sesion_suscriptor`) tiene el mismo
patrón `secure: true` fijo y sufriría el mismo bug en dev por navegador. Extenderle el mismo
criterio condicional toca CLAUDE.md §10-22b (que exige literalmente `Secure` para esa cookie) —
señalado aquí para que Mateo decida; sin aprobación explícita no se toca.

### 2026-09-04 — Sesión 020: fix de seguridad — xlsx migrado a SheetJS 0.20.3 (CDN oficial)

Cierre del pendiente de la Sesión 017 (Feature 012). `xlsx@0.18.5` — la única versión que el
registro de npm distribuye, con 2 vulnerabilidades altas sin parche allí
(GHSA-4r6h-8v6p-xvw6 Prototype Pollution y GHSA-5pgg-2g8v-p4x9 ReDoS) — se reemplaza por
**0.20.3**, la versión parcheada que SheetJS distribuye solo desde su CDN oficial
(`cdn.sheetjs.com`; el registro de npm está desactualizado por diseño, verificado contra
docs.sheetjs.com).

Ejecutado por Mateo en su bench (este contenedor no alcanza `cdn.sheetjs.com`, lista blanca de
red — ya evidenciado en la Sesión 017). Cambio de una línea en `frontend/package.json`
(`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`) + `npm install` con lockfile
regenerado. La API que usa `frontend/components/importacion-mapeo.tsx`
(`XLSX.read` / `XLSX.utils.sheet_to_json`) es estable entre 0.18.5 y 0.20.3 → **cero cambios de
código** más allá de la dependencia.

**Verificado en este repo (evidencia pegada, CLAUDE.md §4):**
```text
npm audit    → ya NO lista GHSA-4r6h-8v6p-xvw6 ni GHSA-5pgg-2g8v-p4x9
npm run lint → LINT_EXIT=0
npm run build→ BUILD_EXIT=0 (Next 15.5.25 · 15/15 páginas · /app/suscriptores/importar 124 kB)
git diff     → solo frontend/package.json (1 línea) y frontend/package-lock.json
```

**Hallazgo NUEVO y SEPARADO tras el fix — `postcss` (dependencia transitiva de `next`), NO
relacionado con la Feature 012. Pendiente de severidad a evaluar en una sesión futura dedicada
a actualizar Next.js con cuidado; no se toca en esta sesión (commit aparte a propósito).**

El mismo `npm audit` que confirma el fix de xlsx reporta **2 vulnerabilidades (1 moderate + 1
high)** en `postcss`, la copia ANIDADA que fija `next@15.5.25`
(`node_modules/next/node_modules/postcss@8.4.31`). El `postcss@8.5.26` del root
(autoprefixer/tailwind) NO cubre esa copia anidada, por eso `next` figura como dependencia
vulnerable:
- `GHSA-qx2v-qp2m-jg93` (XSS por `</style>` sin escapar en el stringify de CSS) — moderate
- `GHSA-6g55-p6wh-862q` (lectura de archivos / divulgación vía `sourceMappingURL`) — high
- `GHSA-fxqj-rqcc-2cmp` (fix incompleto del anterior cuando `from` no está definido) — moderate
- `GHSA-r28c-9q8g-f849` (path traversal → divulgación de archivos `.map`) — high

`npm audit fix --force` la resolvería instalando `next@16.3.4` (cambio de versión mayor,
breaking) — **NO se ejecutó**, está fuera del alcance de esta tarea. Contexto para la sesión
futura: la copia afectada la usa Next para procesar CSS del propio proyecto en build-time (no
procesa CSS de usuarios finales), así que el impacto práctico en runtime se evalúa allí — no se
asume cero ni se descarta.

### 2026-09-04 — Sesión 019: Semgrep automatizado + plan de auditoría final por LLM

Dos entregables: (1) implementación real de Semgrep en CI, (2) documentación del plan de auditoría
de seguridad pre-producción. Incluye además la corrección de un error de la Sesión 018 (ver nota
en esa entrada, abajo).

**T-1 — `.github/workflows/semgrep.yml` (implementación real)**
Corre en cada `push` y `pull_request` a cualquier rama (sin filtro `branches`). Dos pasos:
1. Reporte completo con `p/security-audit` + `p/typescript` + `p/react` + `p/secrets`, todas las
   severidades, subido a GitHub Code Scanning vía SARIF (`github/codeql-action/upload-sarif@v3`) —
   no bloqueante (`continue-on-error: true`).
2. Gate real: el mismo ruleset filtrado a `--severity ERROR` con `--error`, sin
   `continue-on-error` — falla el job (y por lo tanto el check de CI) si hay al menos un hallazgo
   de severidad ERROR.

Ruleset elegido tras investigar: Semgrep no publica un pack específico de Cloudflare Workers;
`p/security-audit` (el pedido explícitamente) combinado con `p/typescript` (todo el proyecto),
`p/react` (frontend/, Next.js usa React — no hay pack "Next.js" propio) y `p/secrets` (relevante
por CLAUDE.md §12, que prohíbe absolutamente commitear claves/tokens) es la combinación más
apropiada para este stack.

**Verificado de verdad, no asumido:** este contenedor no puede alcanzar `semgrep.dev` (proxy de
red restringido). Se instaló Semgrep 1.176.0 en un venv aislado y se clonó
`github.com/semgrep/semgrep-rules` (la fuente abierta de la que salen los packs del registro) para
correr el equivalente exacto de `p/typescript` + `p/react` + `p/security-audit` (subconjunto
javascript/lang/security) + `p/secrets` contra el código real de `backend/src/` y `frontend/`:
**2 hallazgos reales, ambos severidad WARNING, 0 ERROR** — `backend/src/index.ts:204` (regex de
slug con posible ReDoS) y `backend/src/queues/cierre-facturacion.ts:298` (HTML sin escapar en un
template string del correo de factura, XSS potencial si `acueducto.nombre` contuviera markup).
Ninguno de los dos bloquea el workflow (ninguno es ERROR) — quedan como hallazgos visibles en
Code Scanning para revisión, no forzados a corregirse en esta sesión (fuera de alcance: la tarea
pedida era activar Semgrep, no corregir hallazgos).

**Hallazgo real sobre el propio Semgrep, verificado con un caso construido a propósito:** el CLI
open-source de Semgrep (`semgrep scan`, sin conexión a Semgrp Cloud Platform) **sale con código 0
sin importar cuántos hallazgos tenga**, incluso con un hallazgo ERROR real forzado deliberadamente
(`child_process.exec` con input de función, un caso clásico de inyección de comandos) — la
etiqueta "❰❰ Blocking ❱❱" que se ve en pantalla es solo visual, no afecta el exit code. Hace falta
el flag `--error` (exit 1 si hay hallazgos) combinado con `--severity ERROR` (para que solo cuenten
los ERROR) — verificado con el mismo caso construido: exit 1 con el hallazgo ERROR presente, exit
0 cuando el único hallazgo real del proyecto era WARNING. Sin este detalle, el workflow habría
"funcionado" (reportado) pero nunca habría bloqueado nada — exactamente el tipo de "debería
funcionar" que CLAUDE.md §4 prohíbe aceptar sin evidencia real.

**NO VERIFICADO — requiere acción de Mateo:** un archivo de workflow en rojo no bloquea un merge
por sí solo. GitHub solo lo hace si la rama tiene "Require status checks to pass before merging"
activado (Settings → Branches) con el check `semgrep` seleccionado — es una configuración del
repositorio que Mateo tiene que activar una vez, no algo que este workflow pueda activar por sí
mismo. Documentado explícitamente en el propio archivo del workflow.

**T-2 — `docs/PLAN-PRODUCCION.md` (nuevo)**
Sección "Auditoría de seguridad pre-producción" con el texto exacto que dio Mateo: auditoría única
por LLM de mayor capacidad de razonamiento disponible (Claude Opus o DeepSeek Reasoner/Pro), al
completar el roadmap 001-014, revisando RLS/SECURITY DEFINER/sesiones/rate limiting/hallazgos
pendientes de Semgrep — complementa, no reemplaza, la verificación feature por feature ya hecha.

### 2026-09-04 — Sesión 018: planificación de costos e infraestructura (documentación, sin código)

> **Corrección posterior (Sesión 019, mismo día):** el punto 2 de abajo describía el backup
> automático como "PENDIENTE DE IMPLEMENTACIÓN" sin haber verificado primero si ya existía en el
> repositorio. Era incorrecto — `.github/workflows/backup-diario.yml` ya estaba implementado
> desde el 2026-09-01 (feature 001, commit `87afd9e`). Corregido en la Sesión 019, ver abajo.

Sesión de solo documentación (Mateo lo pidió explícito: "Solo documentación, no implementación de
código todavía"). Registra las decisiones de una sesión de investigación de costos, en
`docs/INFRAESTRUCTURA-Y-COSTOS.md` (documento nuevo).

**Decisiones documentadas**
1. **Supabase Free alcanza para el primer cliente** (500-600 suscriptores, muy por debajo de los
   límites de 500 MB de DB / 50.000 MAU de Auth — este último ni aplica de fondo porque el
   suscriptor no es un usuario de `auth.users`, D-2). El riesgo de pausa por inactividad a 7 días
   ya estaba resuelto (`keepalive.ts`, `docs/INFRAESTRUCTURA.md §5`) — se verificó en esta sesión
   que la configuración del cron (`wrangler.keepalive.toml`) y el empaquetado del Worker
   (`wrangler deploy --dry-run`) siguen intactos, sin tocar código.
2. **Backups automáticos sin costo vía GitHub Actions** (`supabase db dump` + `SUPABASE_DB_URL`
   como secret + subida a repo privado o Cloudflare R2 Free + retención de 30 días), reemplazando
   la idea de backup manual. **Prioridad ALTA, pendiente de implementación.** Se detectó y reportó
   una contradicción con el diseño ya aprobado como decisión D-7 (`docs/INFRAESTRUCTURA.md §6`,
   que usa `pg_dump` en contenedor + R2 exclusivamente + nombre de workflow distinto) — ambos
   diseños resuelven el mismo problema con mecanismos distintos; hay que reconciliarlos antes de
   implementar, no se implementó ninguno de los dos en esta sesión.
3. **Cloudflare Workers Free confirmado suficiente**, sin cambios sobre lo ya proyectado en
   `ARQUITECTURA.md §6`.
4. **Cambio de decisión de correo:** Resend (3.000/mes, 100/día, gratis) en vez de Cloudflare
   Email Service — evita que el flujo de correo (D-8, secundario) dependa de que Workers Paid ya
   esté activo, como asume hoy `ARQUITECTURA.md §6`. **Prioridad MEDIA**, amplía la Feature 006 ya
   cerrada (`backend/src/lib/email.ts`); requiere además actualizar D-8 en `docs/DECISIONES.md`
   cuando se implemente, para no dejar el registro de decisiones contradiciendo el código.
5. **Monitoreo de errores con Sentry** (5.000 errores/mes gratis, backend + frontend). **Prioridad
   MEDIA** — confirma una intención que ya existía en `docs/ESTRATEGIA-CALIDAD.md` y
   `docs/INFRAESTRUCTURA.md §2` pero sin implementar ni límites documentados hasta ahora.
6. **Costo total del primer cliente: USD $0/mes**, con backups 100% automáticos (sin
   intervención manual periódica, salvo el ritual mensual de verificación de restauración que
   `docs/INFRAESTRUCTURA.md §7.3` ya definía como deliberadamente manual).

**Pendientes técnicos abiertos** (tabla completa en `docs/INFRAESTRUCTURA-Y-COSTOS.md §7`):
backup automático (ALTA), migración de correo a Resend (MEDIA), instrumentación de Sentry
(MEDIA). Ninguno tiene `spec.md` todavía — no se escribe código sin pasar por `/specify`
(CLAUDE.md §3).

### 2026-09-04 — Sesión 017: 012-importacion-suscriptores-excel completa (T-002 a T-009)

Continuación desde el checkpoint pendiente (T-001, parser/validador puro, ya estaba completo e
implementado con autorización explícita de Mateo antes de este checkpoint). Esta sesión hizo las
fases que tocan Supabase real: migración, duplicados contra la base, rutas HTTP, frontend.

**Hecho**
- **T-002** — Migración `20260912090000_importacion-suscriptores.sql`: tabla
  `importaciones_suscriptores` (historial, `errores jsonb` solo `{fila, motivo}`, nunca el
  contenido de la fila) + `importar_suscriptores()` (`SECURITY INVOKER`, sin `SELECT FOR UPDATE`
  — cada suscriptor nuevo es una fila independiente sin contención — `INSERT` en lote vía
  `jsonb_to_recordset`, atómico por ser una sola función `plpgsql`). RLS `FORCE` + políticas
  estándar. Probado funcionalmente contra Postgres real: inserción de lote válido con conteos
  correctos, y atomicidad real (CA-6) forzando una violación del constraint único
  `(cliente_id, codigo_suscriptor)` — el lote completo se revierte, cero suscriptores nuevos.
- **T-003** — Fixture no-op (mismo criterio que 009: los lotes de prueba se arman inline con jsonb
  dentro de cada transacción) + test de aislamiento (6 pasos): cross-tenant en `importar_suscriptores()`
  y en el historial, rol `lector` rechazado, atomicidad del lote re-verificada en la suite formal.
  Regresión completa: se reconstruyó `undreocol_test` desde cero (shim + 11 migraciones + 10
  fixtures en orden de dependencia real + 10 suites de aislamiento 001-009/012) en una sola pasada
  limpia — las 10 en verde, confirmando que el fallo de `008_portal_aislamiento.sql` visto en una
  corrida anterior (mismo hallazgo que en el cierre de la Sesión 016) era estado acumulado de la
  base de datos de larga duración, no una regresión de 012.
- **T-004** — `lib/importacion-suscriptores.ts`: `detectarDuplicadosContraBase()` (CA-3 —
  `numero_documento` no tiene constraint único en la base, es la única barrera real para ese caso,
  verificado explícitamente con el caso "solo `numero_documento` coincide"), `categoriasSinTarifa()`
  (advertencia informativa no bloqueante, mismo patrón que `lib/facturacion.ts`) y
  `confirmarImportacion()` (RPC `importar_suscriptores()`).
- **T-005** — Rutas `POST /suscriptores/importar/validar` y `POST /suscriptores/importar/confirmar`,
  con un límite explícito de 2000 filas por archivo (CLAUDE.md §5.5) rechazado antes de procesar.
- **T-006** — `lib/api.ts` ampliado: `validarImportacion()`/`confirmarImportacion()`.
- **T-007** — Panel `/app/suscriptores/importar`: carga de `.xlsx`/`.csv` parseado en el navegador
  con `xlsx`/SheetJS (nunca llega el archivo crudo al Worker), mapeo de columnas configurable
  (ningún nombre de columna asumido en el código, spec §3.1), resumen de errores, confirmación que
  solo importa las filas válidas, reporte final con la advertencia de categorías sin tarifa.
- **T-009** — Cierre: checklist de `spec.md §8` y esta entrada.

**Hallazgo de seguridad en una dependencia nueva (se reporta explícito, CLAUDE.md §8)**
`xlsx@0.18.5`, la única versión instalable desde el registro de npm en este contenedor, tiene 2
vulnerabilidades altas confirmadas por `npm audit` **sin parche disponible en npm**: Prototype
Pollution (`GHSA-4r6h-8v6p-xvw6`) y ReDoS (`GHSA-5pgg-2g8v-p4x9`). SheetJS solo distribuye
versiones parcheadas desde su propio CDN (`cdn.sheetjs.com`), bloqueado por la lista blanca de red
de este contenedor — se intentó instalar y falló con `CONNECT 403`. El parseo ocurre enteramente
en el navegador del admin sobre un archivo que él mismo elige subir (no toca el Worker ni la base
de otros acueductos), pero es una dependencia nueva con CVEs reales sin parchear. **Acción
pendiente de Mateo antes de producción:** desde su bench con acceso normal a internet, cambiar
`"xlsx": "^0.18.5"` en `frontend/package.json` por la URL del tarball parcheado de SheetJS y correr
`npm install` de nuevo (un cambio de una línea, la API usada es estable entre versiones) — pasos
exactos en `specs/012-importacion-suscriptores-excel/tasks.md` T-007.

**Brecha de alcance detectada (se reporta, no se oculta)**
`tasks.md` T-008 menciona "ver el historial de importaciones" como parte del flujo E2E, pero
`plan.md` §3 (aprobado) solo definió las rutas `validar`/`confirmar` — nunca se planeó una ruta ni
pantalla para LISTAR `importaciones_suscriptores`. No se improvisó esa ruta fuera de plan (CLAUDE.md
§3). Si Mateo quiere verlo desde el panel, es una tarea adicional a definir explícitamente.

**Desviación de entorno (igual que 002/003/009, CLAUDE.md §8)**
Sin Docker en este contenedor. Verificación de esquema/RLS/RPC contra PostgreSQL 16 nativo con el
shim de compatibilidad ya usado en sesiones previas.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- CA-3/CA-5 con `curl` real contra `wrangler dev` + PostgREST real (sin Docker en este contenedor,
  la lib de duplicados se verificó a nivel de la consulta SQL equivalente, no vía `supabase-js`).
- CA-7: flujo completo en navegador con un archivo de prueba real. Pasos exactos en `tasks.md`
  T-008.
- Cambiar la fuente de instalación de `xlsx` a la versión parcheada de SheetJS antes de producción
  (ver hallazgo de seguridad arriba).

### 2026-09-04 — Sesión 016: 009-cortes-y-reconexiones completa (T-001 a T-007)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/009-cortes-y-reconexiones/`): alcance reducido (opción a)
  aprobado explícitamente por Mateo — el corte y la reconexión son acciones de `admin_acueducto`
  desde el panel, con confirmación humana siempre explícita (nunca corte desatendido). La "orden de
  corte ejecutada por el lector desde su celular" que describe
  `docs/ESPECIFICACION-FUNCIONAL.md §2.11` (opción b) queda documentada como feature futura — el
  volumen actual del acueducto piloto no la justifica todavía.
- **T-001** — Migración `20260911090000_cortes-reconexiones.sql`: tabla `cortes_reconexiones`
  (`motivo`/`responsable` `NOT NULL` a nivel de esquema), `registrar_corte()` y `reconectar()`
  (`SECURITY INVOKER`, `SELECT FOR UPDATE`, mismo patrón que `anular_pago()` de 007).
  `reconectar()` reutiliza `siguiente_numero_factura()` (005) sin modificarla e inserta la factura
  de reconexión con un renglón en `factura_detalles` (`servicio_id`/`tarifa_id` `NULL`), dejando que
  el trigger de 005 calcule el total.
- **T-002** — Fixture no-op documentado (agregar una factura vencida al fixture compartido rompería
  el conteo de filas que 005/007 ya asumen) + test de aislamiento (7 pasos): cross-tenant, rol
  lector, rechazo de doble corte, rechazo de reconexión sobre activo, bloqueo de reconexión con
  deuda vencida sin motivo de excepción, factura de reconexión con monto/tipo/prefijo/periodo_id
  correctos. Regresión CA-3 confirmada por `grep`: el filtro `estado = 'activo'` de
  `facturacion.ts`/`cierre-facturacion.ts` sigue intacto.
- **T-003** — `lib/cortes.ts` (candidatos por umbral reutilizando `obtenerCartera()` de 007, RPCs
  de corte/reconexión, historial) + 4 rutas Hono.
- **T-004/T-005** — `lib/api.ts` ampliado + panel `/app/cortes` (candidatos, nunca ejecuta nada por
  sí solo) + tarjetas de corte/reconexión e historial en el detalle del suscriptor.
  `ReconexionForm` consulta la deuda vencida antes de intentar reconectar, para pedir el motivo de
  excepción en el propio formulario.
- **T-007** — Cierre: checklist de `spec.md §8` y esta entrada.

**Desviación de entorno (igual que 002/003, CLAUDE.md §8)**
Este contenedor no tiene Docker funcional. Verificación de esquema/RLS/funciones contra
PostgreSQL 16 nativo con el shim de compatibilidad ya usado en sesiones previas (el trabajo de
004-008 sí se hizo con Supabase local real en Docker, según su propio `tasks.md` — este contenedor
específico no lo tiene disponible).

**Hallazgo durante el cierre:** la primera corrida de la regresión completa 001-009 mostró
`008_portal_aislamiento.sql` fallando en su PASO 3 ("A1 bloqueado devolvió ok"). Investigado antes
de reportarlo: no era una regresión de 009 — era estado acumulado de correr los tests de
aislamiento repetidamente sobre la misma base a lo largo de la sesión (el fixture de intentos de
login no es idempotente para corridas repetidas sin reset). Reconstruida la base desde cero
(`drop`/`create database`, 10 migraciones, 9 fixtures) y corridos los 9 tests de aislamiento en una
sola pasada limpia: los 9 en verde, incluido 008.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- CA-3/CA-4 de tasks.md (T-003): `curl` real contra `wrangler dev` — sin PostgREST en este
  contenedor no hay endpoint REST real detrás de `@supabase/supabase-js`.
- CA-7 (T-006): flujo completo en navegador. Pasos exactos en `tasks.md` T-006.
- Repetir `supabase db reset` en un entorno con Docker para la verificación oficial completa de
  T-001/T-002 (incluye PostgREST/GoTrue, que el shim de este contenedor no cubre).

### 2026-09-03 — Sesión 015: 008-portal-suscriptor completa (T-001 a T-007)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/008-portal-suscriptor/`): CA-1 a CA-10 y **D-10** nueva en
  `docs/DECISIONES.md` (el aislamiento del portal se hace con funciones `SECURITY DEFINER` acotadas
  invocadas con la clave `anon`; `SUPABASE_SERVICE_ROLE_KEY` nunca se usa en rutas del portal —
  CLAUDE.md §12 sin excepción).
- **T-001** — Migración `20260908090000_portal-suscriptor.sql`: columnas de `configuracion`
  (`portal_umbral_intentos_login` 8 / `portal_bloqueo_minutos` 15), tabla `portal_intentos_login`
  (fuerza bruta por `(cliente_id, numero_documento)`; RLS FORCE con única política de lectura para
  la plataforma; la escriben solo las funciones security definer) y las 5 funciones del portal
  (`portal_validar_credenciales`, `portal_facturas_suscriptor`, `portal_factura_completa`,
  `portal_saldo_favor_suscriptor`, `portal_consumo_suscriptor`) — cada una revalida
  `numero_documento`+`codigo_suscriptor` dentro del `cliente_id` recibido. Smoke con rol `anon`:
  login ok/invalido/bloqueado tras 8 fallos/inactivo (sin contar como intento fallido) y datos sin
  fixtures → vacíos.
- **T-002** — Fixture `portal.sql` (dos filas de `portal_intentos_login`: A1 bloqueo vigente, A2
  bloqueo vencido) + aislamiento `008_portal_aislamiento.sql` (CA-2/CA-9). Regla aprendida en 005/007
  aplicada: el fixture NO agrega contadores/lecturas de A1 (romperían los conteos de los aislamientos
  003/004) — el histórico de dos contadores de CA-7 se crea en el aislamiento con ROLLBACK
  (cerrando temporalmente el periodo actual para respetar `uq_periodo_abierto`). `PORTAL-AISLAMIENTO
  OK` + regresión 001-007 en verde.
- **T-003** — `sesion-suscriptor.ts` implementado (JWT propio HS256 con `hono/jwt`, cookie
  `uc_sesion_suscriptor` HttpOnly+Secure+SameSite=Lax, 30 días, renovación < 7 días; `SesionSuscriptor`
  lleva `numeroDocumento`+`codigoSuscriptor` por D-10). 10 unit tests; `npm test` 90 en verde.
  Nota: hono 4 exporta `sign`/`verify` desde `hono/jwt` (no `hono/utils/jwt`). `SESSION_SECRET` en
  `.dev.vars` (gitignored).
- **T-004** — `lib/portal.ts` (todas las llamadas con `crearClienteAnon`, D-10) + rutas
  `POST /portal/:slug/login` (401 genérico / 403 inactivo / 429 bloqueado), `POST /portal/logout`,
  `GET /portal/facturas`, `GET /portal/facturas/:id/pdf` (404 si no es del suscriptor — **IDOR
  bloqueado**), `GET /portal/saldo-favor`, `GET /portal/consumo`. **Desviación de implementación
  documentada**: el login resuelve el slug con la función `SECURITY DEFINER`
  `portal_cliente_por_slug` (migración nueva `20260909090000_portal-slug.sql`) porque `anon` no puede
  leer `clientes` (RLS). **Ataques IDOR verificados con curl** (sesiones reales de A1/A2/B1): PDF de
  factura ajena y de otro acueducto → 404 sin bytes; listados aislados; fuerza bruta → 429; logout →
  401.
- **T-005** — Regenerar código (CA-8): `POST /suscriptores/:id/regenerar-codigo` (admin → 200,
  lector → 403 por membresía + RLS, código duplicado → 409). Login con el código viejo → 401; con el
  nuevo → 200. Hallazgo con evidencia: por D-10, una sesión previa no recibe 401 pero deja de ver
  datos (las funciones revalidan el código) — la regeneración invalida de facto la sesión anterior.
- **T-006** — Frontend del portal (CA-10): `middleware.ts` separa por área con cookies DISTINTAS
  (`uc_sesion_admin` para `/app/*`, `uc_sesion_suscriptor` para `/portal/:slug/*` salvo el login);
  páginas `/portal/[slug]/login` y `/portal/[slug]`; botón de regenerar código en el detalle del
  suscriptor. `next build` 12 páginas OK. **Separación de sesiones verificada con curl**: un admin
  con su cookie NO ve el portal (307 al login del portal) y un suscriptor NO ve el panel `/app`
  (307 a `/login`); con ambas cookies cada área responde con la suya.
- **T-007** — Cierre: checklist `spec.md §8`, CHANGELOG y regresión completa desde cero
  (`supabase db reset --local`, 9 migraciones, fixtures 001-008, aislamientos 001-008 en verde).

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- CA-10: flujo click-a-click en navegador (`next dev` + `wrangler dev`) con los pasos exactos
  documentados en tasks.md T-006 (la API y la separación de sesiones ya quedaron verificadas con curl).

### 2026-09-03 — Sesión 014: 007-pagos-y-cartera completa (T-001 a T-006)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/007-pagos-y-cartera/`): CA-1 a CA-8, RPCs atómicas con
  remanente y reversión recalculada, sin colas (cada pago es una transacción por request).
- **T-001** — Migración `20260907090000_pagos.sql`: enum `metodo_pago`, tablas `pagos` y
  `pago_aplicaciones` (checks de integridad: valor > 0, suma de aplicaciones ≤ valor del pago, nunca
  se abona más del saldo vivo de una factura, no se aplica a facturas anuladas ni de otro
  suscriptor) + trigger `trg_pago_aplicacion_valida` + RLS `FORCE` + RPCs `SECURITY INVOKER`
  `registrar_pago`/`anular_pago` (`SELECT FOR UPDATE`, distribución más antigua primero, remanente,
  reversión recalculada desde los pagos vigentes). Desviación documentada: la distribución de la
  aplicación la calcula `core/pagos.ts` (CLAUDE §5.3) y se pasa a la RPC como jsonb ya calculado, en
  vez de distribuirse en SQL.
- **T-002** — Fixtures `pagos.sql` (abono parcial de 10.000 + pago a favor de 2.000 sobre la factura
  de 005, sin crear facturas nuevas) y test de aislamiento 007 (RLS + RPCs rechazando al `lector`,
  facturas de otro cliente, facturas anuladas y anulación sin motivo) con regresión 001-006 en verde.
- **T-003** — `core/pagos.ts`: `redondearPeso` (regla única del peso), `distribuirPago` (más antigua
  primero, remanente) y `calcularEstadoTrasPago`. 15 unit tests (`npm test` 80 en verde).
- **T-004** — `lib/pagos.ts` + rutas Hono (`POST /pagos`, `POST /pagos/:id/anular`, `GET /cartera`,
  `GET /facturas/:id/pagos`, `GET /suscriptores/:id/pagos`). Verificado con curl real contra
  `wrangler dev` + Supabase local: pago total/parcial, remanente a favor, anulación con reversión
  recalculada (no resetea a cero: recalcula desde el pago vigente restante), cartera con `vencida`
  derivada por fecha e historiales por factura y por suscriptor.
- **T-005** — Frontend: `api.ts` ampliado + páginas `/app/pagos` (cartera con registrar pago) y
  `/app/pagos/[suscriptorId]` (historial); detalle de factura con bloque de pagos aplicados,
  registrar pago y anular pago con motivo. `build`/`lint`/`tsc` limpios.
- **T-006** — Cierre: `supabase db reset --local` + fixtures 001-007 de cero + los 7 tests de
  aislamiento en verde, checklist de `spec.md §8` + esta entrada.

**Hallazgo real corregido durante la verificación (CA-4)**
`obtenerCartera` (`lib/pagos.ts`) excluía por completo del reporte a cualquier suscriptor sin
facturas con saldo vivo, **aunque tuviera saldo a favor** — un sobrepago dejaba un remanente que no
aparecía en ningún lado de `/cartera`, contradiciendo el texto exacto de CA-4 ("aparece en la cartera
como saldo a favor") y la spec §3.5. Corregido: la fila se incluye si hay deuda viva **o** saldo a
favor > 0; `solo_morosos` sigue exigiendo deuda vencida.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- CA-8: flujo click-a-click en navegador real (registrar pago, ver el sobrante, anular con motivo).
  Este entorno no tiene Chromium/Playwright; se verificó que las 3 rutas nuevas/editadas renderizan
  sin error por SSR con la cookie de sesión real, pero no la interacción de cliente. Pasos exactos en
  `specs/007-pagos-y-cartera/tasks.md` T-005.

### 2026-09-06 — Sesión 013: 006-impresion-y-correo-factura completa (T-001 a T-006)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/006-impresion-y-correo-factura/`).
- **T-001** — Migración `20260906090000_correo-factura.sql`: tabla `notificaciones` con trazabilidad
  del envío (`intentos`, `ultimo_error`, `enviada_en`) + RLS aislada (admin/lector del cliente).
  Fixtures `correo-factura.sql` (email a A1 + notificación enviada) y test de aislamiento 006
  (es_admin_de en notificaciones). 6 tests de aislamiento en verde sobre el mismo estado final.
  Decisión de arquitectura: **no se crea cola nueva** — se amplía el mensaje de la cola
  `undreocol-facturacion` (005) con `tipo: 'emitir_factura' | 'enviar_correo_factura'`.
- **T-002** — `pdf-lib` ^1.17.1 + `src/lib/factura-pdf.ts` (genera el PDF de la factura con renglones,
  datos del acueducto y totales; logo opcional). Se respetó D-9: **sin pdfme ni Chromium** (el chat
  inicial los pidió, pero contradicen la especificación aprobada). 4 unit tests → `npm test` 59 en
  verde (el test decodifica los streams hex de pdf-lib para verificar el contenido del PDF).
- **T-003** — `src/lib/email.ts` (`env.EMAIL.send` con adjunto en `ArrayBuffer`; sin `env.EMAIL`
  devuelve `{ok:false}` sin lanzar, regla 20) + bindings `EMAIL`/`FACTURAS_R2` + consumidor ampliado
  (enruta por `tipo`; para el correo: genera PDF → sube a R2 → envía → actualiza notificaciones con
  `intentos+1`/`ultimo_error`) + rutas `POST /facturas/:id/enviar-correo` y
  `POST /facturacion/periodos/:id/enviar-correo` (202, uno por factura con email; sin email se
  entregan impresas, D-8). **Round-trip local REAL verificado** (202 → log del consumidor → fila en
  notificaciones actualizada). La decisión de estado (pendiente/fallida + `ultimo_error`) se extrajo
  a `computarActualizacionNotificacion()` y quedó cubierta por unit tests (fallo trazable con
  `intentos+1` y error; fallida tras 3 reintentos). `npm test` 65 en verde.
- **T-004** — `GET /facturas/:id/pdf`: lee R2 (`facturas/{clienteId}/{facturaId}.pdf`) o genera y
  sube, actualiza `facturas.pdf_url`, responde `200 application/pdf` (inline). **Hallazgo real
  corregido**: `trg_factura_inmutable` (005) bloqueaba el UPDATE de `pdf_url` → se reescribió la
  función para permitir el cambio exclusivo de `pdf_url`/`total_pagado`/`estado` (metadata de 006 y
  avances de 007) manteniendo el bloqueo de valores económicos y el recálculo del cierre (round-trip
  REAL del cierre re-verificado: factura con total 38.600). Se descartó `pg_trigger_depth()` (dentro
  del propio trigger siempre es ≥ 1) y se documentó que las GUCs locales no se propagan entre roles.
- **T-005** — Frontend: `api.ts` (`enviarCorreoFactura`, `enviarCorreoPeriodo`, `urlPdfFactura`);
  detalle de factura con botones **Ver PDF** / **Imprimir** (`window.print`) / **Enviar por correo**;
  listado del periodo con **Enviar correos del periodo**; `@media print` (la impresión deja solo la
  factura, sin acciones). `next build` 12/12 sin errores.
- **T-006** — Cierre: checklist de `spec.md §8` + esta entrada de CHANGELOG.

**Hallazgo de entorno (send_email en local)**
En `wrangler dev` el binding `[[send_email]]` se materializa como **mock de miniflare** que "envía"
con éxito (la fila queda `enviada`). Por eso el caso de fallo (que exige trazar `intentos`/
`ultimo_error`) no se puede reproducir por la API en local; quedó verificado con unit tests de
`computarActualizacionNotificacion()` y de `email.ts`. Además Node 20 sin WebSocket no puede
instanciar supabase-js (realtime) fuera de workerd, así que la verificación end-to-end de las rutas
es vía curl contra wrangler dev.

**Pendiente (NO VERIFICADO — requiere la cuenta de Cloudflare de Mateo)**
- Envío real de correo: Workers Paid + dominio verificado (`EMAIL` se ignora/falla en local).
- R2 real: bucket `undreocol-facturas` en producción (en local el PDF se genera/sirve y `pdf_url` se
  persiste, pero la simulación de R2 no persiste entre arranques sin `--persist-to`).
- CA-6: flujo click-a-click en navegador (`next dev` + `wrangler dev`).

### 2026-09-05 — Sesión 012: 005-facturacion completa (T-001 a T-007)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/005-facturacion/`): commit `b5d3e50`, `f08ae42`, `58a1a91`.
- **T-001** — Migración `20260905090000_facturacion.sql`: enums `tipo_factura`/`estado_factura`,
  tablas `facturas` (unique `(cliente_id, numero)`, `uq_factura_ciclo`, `chk_total_pagado <= total`),
  `factura_detalles` (referencia permanente `tarifa_id`/`servicio_id`) y `factura_lecturas`; RLS
  `FORCE`. **Dos hallazgos reales corregidos**: (1) el trigger inicial bloqueaba el INSERT de un
  periodo cerrado, lo que habría impedido la emisión del cierre (004 cierra el periodo y 005 factura
  sobre él) → se reemplazó por `trg_factura_inmutable` (INSERT permitido; UPDATE solo anulación con
  motivo o `total_pagado` de 007; DELETE bloqueado; recálculo interno de `total` = suma de detalles
  permitido vía GUC `app.recalculo_interno`). (2) el recálculo de `factura_detalles` chocaba con el
  trigger de inmutabilidad → se marcó la transacción con GUC.
- **T-002** — Fixtures `facturacion.sql` + `005_facturacion_aislamiento.sql` (8 pasos). **Hallazgo de
  regresión**: el fixture cerraba el periodo A y rompía el test de 004 (que asume el periodo A
  abierto); corregido: los fixtures de features posteriores no mutan el estado que los tests previos
  asumen. 5 tests de aislamiento (001-005) en verde sobre el mismo estado final.
- **T-003** — `core/facturacion.ts` (lógica pura, reusa `core/tarifas.ts` D-1): `armarRenglones`,
  `calcularRecargoMora`, `componerTotal`, `componerNumeroFactura` (D-3), `clasificarAnomaliasFacturacion`.
  19 unit tests → `npm test` 55 en verde.
- **T-004** — `lib/facturacion.ts` (capa fina) + rutas `POST /facturacion/periodos/:id/simular`,
  `GET /facturacion/periodos/:id/facturas`, `GET /facturas/:id`, `POST /facturas/:id/anular`.
  **Simulación real verificada con curl** (wrangler dev + Supabase local): resumen con
  facturación total 38.600 (D-1 básico/no básico) y anomalías de A2 (sin tarifa 9d, sin lectura);
  no insertó nada. Anulación real verificada (sin motivo → 400, con motivo → 200).
  Corrección de alcance: no se implementó `GET /facturacion/simulaciones/:periodoId` — la simulación
  no persiste (spec §3.3); el gate de la emisión es de UI + defensa en backend.
- **T-005** — Consumidor `src/queues/cierre-facturacion.ts` + ruta `POST .../emitir` + binding
  `FACTURACION_COLA` (producer+consumer en el mismo worker). **Round-trip local REAL de Cloudflare
  Queues verificado**: `POST /emitir` → 202 (1 encolada), log del consumidor "factura FAC-2026-00001
  emitida", factura con total 38.600 + 1 detalle, consecutivo atómico en 1, re-emisión → 409.
  Corrección de arquitectura: se usó un solo worker (fetch+queue) en vez del
  `wrangler.facturacion.toml` separado. Se añadió la RPC `siguiente_numero_factura()` (SELECT FOR
  UPDATE, puntos 9b/9c).
- **T-006** — Frontend: `api.ts` ampliado + paneles `/app/facturacion` (simular → resumen/anomalías →
  confirmar emisión → listado) y `/app/facturacion/[facturaId]` (datos + desglose + anular).
  `npm run build` 12/12 y lint en verde.
- **T-007** — Cierre: checklist de `spec.md §8`, CHANGELOG y los 5 tests de aislamiento re-corridos.

**Hallazgo de entorno (importante para toda esta sesión)**
`http_proxy`/`https_proxy` están seteados sin `NO_PROXY`, así que las llamadas a `127.0.0.1` pasaban
por el proxy y devolvían **502** (a Supabase local y a Kong). Solución: `curl --noproxy '*'` y
`wrangler dev` lanzado con `env -u http_proxy ...`. También se detectó que tras `supabase db reset`
Kong podía quedar sin inicializar: `supabase stop && supabase start` lo resolvió.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- Despliegue real a Cloudflare: crear la cola `undreocol-facturacion` en la cuenta, conectar
  producer/consumer y correr el cierre con cron real en la nube (el round-trip local ya está
  verificado).
- CA-6: flujo click-a-click en navegador (`next dev` + `wrangler dev`) — la API de simulación/emisión/
  anulación ya fue verificada por curl y el build/lint confirman el render.

### 2026-09-04 — Sesión 011: 004-lecturas-y-consumo completa (T-001 a T-006)

**Hecho**
- **Spec/plan/tasks aprobados** (`specs/004-lecturas-y-consumo/`): commit `b5236ec`, `61d94fe`,
  `30123e1`.
- **T-001** — Migración `20260904090000_lecturas-consumo.sql`: enums `estado_periodo` y
  `revision_lectura`; tabla `periodos` (unique `(cliente_id, anio, mes)` + índice parcial
  `uq_periodo_abierto`: un solo periodo abierto por cliente); tabla `lecturas` con FKs `ON DELETE
  RESTRICT`, unique `(contador_id, periodo_id)`, unique `id_cliente_offline`, `chk_consumo >= 0` y
  el índice parcial de la cola de anomalías. Función+trigger `bloquear_lectura_periodo_cerrado()`
  (`SECURITY DEFINER`, solo lee `estado`). RLS `FORCE` en ambas tablas: el lector lee periodos y
  puede insertar/leer lecturas de su cliente, pero gestionar periodos y marcar revisiones es solo
  `admin_acueducto`. Verificado contra **Supabase local real** (`supabase db reset --local`,
  PostgreSQL 17.6) — entorno con Docker disponible por primera vez en 004 (vs shim de 002/003).
- **T-002** — Fixtures `tests/fixtures/lecturas.sql` (periodo abierto por cliente; A con lectura,
  B sin lecturas) y `tests/aislamiento/004_lecturas_consumo_aislamiento.sql` (9 pasos). **Dos
  hallazgos reales**: (1) RLS es **silencioso** para UPDATE/DELETE — el lector que intenta marcar
  `revisada` no lanza excepción, simplemente afecta 0 filas; el test verifica `row_count = 0`.
  (2) `ON CONFLICT (id_cliente_offline)` no bastaba porque la misma fila también violaba
  `(contador_id, periodo_id)`; el PASO 9 ahora prueba la idempotencia de reenvío sobre el cliente
  B (verifica 1 sola fila). Regresión 001/002/003 en verde.
- **T-003** — `core/consumo.ts` (lógica pura, CLAUDE.md §5.3): `calcularConsumoPeriodo` (rollover y
  rechazo puntos 1-2), `calcularConsumoConReemplazo` (punto 7) y `clasificarAnomalia` (puntos
  5-6), con m³ a 2 decimales. 22 unit tests `vitest` (umbral exacto/por encima/por debajo, dígitos
  5 y 6, tramos de reemplazo, anomalías alto/bajo/cero, y propiedad no negativo/<= capacidad +
  determinismo). `npm test` → 36 tests en verde.
- **T-004** — `lib/lecturas.ts` (capa fina; `lectura_anterior` SIEMPRE resuelta por el backend, nunca
  del cliente; idempotencia por `id_cliente_offline`) y las rutas `POST/GET /periodos`,
  `PATCH /periodos/:id/cerrar`, `GET/POST /lecturas`, `PATCH /lecturas/:id/revisar`. Se amplió
  `requerirClienteActivo` para exponer `perfilId` (autor de cierre/lectura/revisión). `tsc`, `eslint`
  y `wrangler deploy --dry-run` en verde (814.66 KiB / gzip 160.91 KiB).
- **T-005** — Frontend: `lib/api.ts` ampliado con funciones de periodos/lecturas y los paneles
  `/app/lecturas` (consulta por periodo, cola de anomalías, alta manual) y `/app/lecturas/periodo`
  (crear/cerrar el periodo del mes), protegidos por el middleware existente. `npm run build` (11/11)
  y `npm run lint` en verde.
- **T-006** — Cierre: checklist de `spec.md §8`, CHANGELOG y re-corrida de los 4 tests de
  aislamiento sobre el estado final.

**Entorno (cambio respecto a 002/003)**
Este contenedor ahora DISPONE de Docker con Supabase local completo (CLI 2.116.0, PostgreSQL 17.6,
esquemas auth/storage/realtime, `auth.uid()` nativo). La verificación de esquema/RLS/funciones se
hizo contra Supabase local real (`supabase db reset --local`), más fiel que el shim de 002/003.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
Ninguno tras la re-validación posterior: **CA-4** y **CA-6** se re-validaron contra `wrangler dev` +
`next dev` + Supabase local real (ver evidencia en `tasks.md` T-004/T-005 y la actualización de
esta entrada). CA-4: flujo curl end-to-end en verde (login → periodo/lecturas/revisar/cerrar + los
bloqueos por unique/periodo cerrado reales). CA-6: `/app/lecturas` y `/app/lecturas/periodo` se
sirven con sesión (HTTP 200) y el middleware redirige a `/login` sin sesión (307). La interacción
de clic en navegador sigue disponible como verificación manual opcional.

### 2026-09-02 — Sesión 010: 003-suscriptores-contadores completa (T-001 a T-009)

**Hecho**
- **T-001** — Migración `20260902090000_suscriptores-contadores.sql`: `ALTER TABLE
  usuarios_servicio` con 10 columnas nuevas **NULLABLE** (la tabla ya tenía filas de fixtures de
  001/002; un `NOT NULL` directo habría roto el reset — requerido real exigido en la capa de
  aplicación para suscriptores nuevos). Enum `estado_contador`, tablas `contadores` (índice único
  parcial de contador activo) y `reemplazos_contador` (FKs de contador `ON DELETE RESTRICT`).
  Función `reemplazar_contador()` (`SECURITY INVOKER`, `SELECT FOR UPDATE` sobre
  `usuarios_servicio`, no sobre `contadores` — es la fila que decide cuál es "el activo"). RLS
  `FORCE` + políticas reutilizando `es_admin_de()`/`mis_clientes()`/`es_admin_plataforma()` de
  001, sin funciones de seguridad nuevas. Verificado explícitamente que la migración no pierde
  las 3 filas existentes de `usuarios_servicio`.
- **T-002** — Fixtures y test de aislamiento (7 pasos) cubriendo CA-2 y CA-5. **Hallazgo real**: el
  `SELECT ... FOR UPDATE` de `reemplazar_contador()` aplica la política RLS de **escritura** de
  `usuarios_servicio`, no la de lectura — confirmado directamente comparando un `SELECT` plano
  contra el mismo `SELECT ... FOR UPDATE` para un lector del mismo acueducto (0 filas). El chequeo
  `es_admin_de()` explícito dentro de la función queda como defensa adicional, no como ruta
  principal, para ese caso — documentado en la migración y en el test.
- **T-003/T-004** — Backend: `lib/suscriptores.ts` y las rutas `GET/POST /suscriptores`,
  `GET/PATCH /suscriptores/:id` (contador activo + historial de reemplazos en el detalle),
  `POST /suscriptores/:id/contador`, `POST /suscriptores/:id/reemplazar-contador`. Corrección de
  alcance sobre el plan: se quitó una ruta `GET /suscriptores/:id/contadores` que no estaba en
  `plan.md §3` (el detalle ya cubre lo que pide el spec).
- **T-005 a T-007** — Frontend: `lib/api.ts` ampliado, panel `/app/suscriptores` (lista con filtro
  por estado, alta) y `/app/suscriptores/[id]` (datos, contador activo/alta/reemplazo, historial
  de reemplazos, advertencia — nunca bloqueo — si la categoría no tiene tarifa vigente configurada
  en el catálogo de 002).
- **T-009** — Cierre: checklist de `spec.md §8` y esta entrada.

**Desviación de entorno (igual que la sesión de 002, CLAUDE.md §8)**
Este contenedor sigue sin Docker funcional ni PostgREST. Verificación de esquema/RLS/funciones
contra PostgreSQL 16 nativo con el mismo shim de compatibilidad de la sesión anterior.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- **CA-3/CA-4** (T-003/T-004): correr los `curl` reales de `tasks.md` contra `wrangler dev` +
  Supabase local real — sin PostgREST en este contenedor no hay endpoint REST real detrás de
  `@supabase/supabase-js`, aunque `tsc`, `eslint` y `wrangler deploy --dry-run` están en verde.
- **CA-6** (T-008): flujo completo en navegador. Pasos exactos en `tasks.md` T-008.
- Repetir `supabase db reset` en un entorno con Docker para la verificación oficial completa de
  T-001 (incluye PostgREST/GoTrue).

### 2026-09-01 — Sesión 009: 002-catalogo-y-tarifas completa (T-001 a T-010)

**Hecho**
- **T-001** — Migración `20260901120000_catalogo-y-tarifas.sql`: enums `categoria_tarifaria`/
  `tipo_calculo`, tablas `servicios`/`tarifas` (DDL de `docs/esquema-propuesto.sql §6` + columna
  `updated_at` en `servicios`), `tarifa_vigente()` (`SECURITY DEFINER`) y `crear_tarifa_version()`
  nueva (`SECURITY INVOKER`, `SELECT FOR UPDATE`, cierra la tarifa vigente y crea la nueva en una
  sola transacción). RLS `FORCE` + políticas reutilizando `es_admin_de()`/`mis_clientes()`/
  `es_admin_plataforma()` de 001, sin funciones de seguridad nuevas. `servicios`/`tarifas` usan
  `ON DELETE RESTRICT` (no `CASCADE` como la referencia): un servicio con tarifas nunca se borra
  en cascada silenciosamente.
- **T-002** — Fixtures (`tests/fixtures/catalogo.sql`, valores explícitamente marcados como no
  reales — D-5 sigue pendiente) y test de aislamiento (`002_catalogo_aislamiento.sql`, 6 pasos)
  cubriendo CA-2 (incluida `crear_tarifa_version()` contra un `servicio_id` de otro acueducto) y
  CA-6 (una sola tarifa vigente tras cambios sucesivos). **El propio test encontró un bug real**
  en `crear_tarifa_version()` de T-001: dos cambios de precio el mismo día violaban
  `chk_vigencia` al cerrar una tarifa cuya `vigencia_desde` ya era hoy con `vigencia_hasta = hoy-1`.
  Corregido: si la tarifa anterior nació hoy mismo se elimina en vez de cerrarse (nunca estuvo
  vigente un día completo, y no puede tener facturas — esa tabla no existe todavía).
- **T-003** — `core/tarifas.ts`: `calcularSubtotalServicio()` (fórmula D-1, límite inclusivo,
  redondeo a la unidad una sola vez). 8 tests unitarios en verde (límite exacto, límite±1,
  consumo 0, `tipo_calculo = 'fijo'`, redondeo).
- **T-004/T-005** — Backend: `lib/catalogo.ts` (capa de acceso a datos) y las rutas
  `GET/POST /catalogo/servicios`, `PATCH /catalogo/servicios/:id` (rechaza explícitamente cambios
  a `codigo`/`tipo_calculo`), `GET/POST /catalogo/tarifas`, `GET /catalogo/matriz-tarifas`.
- **T-006 a T-008** — Frontend: `lib/api.ts` ampliado (mismo wrapper `peticion<T>()`, sin
  `@supabase/*`), panel `/app/catalogo` (lista, alta, activar/desactivar) y
  `/app/catalogo/[servicioId]` (historial de tarifas por categoría + alta de tarifa nueva, con
  nota explícita de que esto cierra la vigente y nunca la edita).
- **T-010** — Cierre: checklist de `spec.md §8` y esta entrada.

**Desviación de entorno señalada en cada tarea afectada (CLAUDE.md §8)**
Este contenedor no tiene Docker funcional (el daemon no arranca — restricción del sandbox), así
que no hay CLI de `supabase` ni forma de correr `supabase start`/`supabase db reset` ni
PostgREST. La verificación de esquema, RLS y funciones (T-001, T-002) se hizo contra PostgreSQL 16
nativo instalado en el contenedor, con un shim de compatibilidad (`auth.uid()` vía GUC, roles
`anon`/`authenticated`/`service_role`) que la propia migración de 001 ya documentaba como opción
self-hosted — real evidencia contra un motor Postgres real, pero no el stack completo de Supabase.

**Pendiente (NO VERIFICADO — requiere validación manual de Mateo)**
- **CA-3/CA-4** (T-004/T-005): correr los `curl` reales de `tasks.md` contra `wrangler dev` +
  Supabase local real — este contenedor no tiene PostgREST, así que no hay endpoint REST real
  detrás de `@supabase/supabase-js` para probar las rutas end-to-end, aunque `tsc`, `eslint` y
  `wrangler deploy --dry-run` están en verde.
- **CA-7** (T-009): flujo completo en navegador (`wrangler dev` + `next dev` simultáneos contra
  una base real). Pasos exactos en `tasks.md` T-009.
- Repetir `supabase db reset` en un entorno con Docker para la verificación oficial completa de
  T-001 (incluye PostgREST/GoTrue, que el shim de este contenedor no cubre).

### 2026-09-01 — Sesión 008: T-010 (frontend base) y T-014 (restaura INFRAESTRUCTURA.md)

**Hecho**
- **T-010** — Frontend Next.js 15 + `@opennextjs/cloudflare` verificado de punta a punta
  (`npm ci`, `npm run lint`, `npm run build`, `npm run pages:build`, todo en verde). Se
  encontraron y corrigieron 4 problemas reales durante la verificación, ninguno anticipado en
  `plan.md`: faltaba `open-next.config.ts` (se agregó sin caché incremental en R2, decisión de
  Mateo); faltaba `frontend/wrangler.toml` (formato `.toml`, mismo `compatibility_date` que
  `backend/`); recursión infinita en el script `build` de `package.json` (`opennextjs-cloudflare
  build` se autoinvocaba vía `npm run build`); `eslint.config.mjs` con import roto y, tras
  corregirlo, incompatibilidad real entre el eslintrc clásico que exporta `eslint-config-next` y
  flat config — resuelta con `FlatCompat`. `plan.md §1.2` actualizado con los dos archivos que
  faltaban en el plan original.
- **T-014** — `docs/INFRAESTRUCTURA.md` reconstruido por completo (379 líneas, 12 secciones),
  reemplazando la copia corrupta de `ARQUITECTURA.md` que llevaba desde la sesión 007. El
  contenido de reemplazo llegó de un borrador de Mateo redactado antes de que existiera el código
  real de T-002 a T-009; **cada sección se verificó contra el código/config real y contra
  `plan.md`/`docs/DECISIONES.md` antes de escribirse, y donde hubo contradicción ganó el código o
  el plan aprobado, nunca el borrador.** Discrepancias encontradas y corregidas: cron del
  keepalive (`0 5 * * *` real, no `0 9 * * *`) y su mecanismo (`@supabase/supabase-js`, no `fetch`
  REST manual); backup diario — `.github/workflows/backup-diario.yml` no existe todavía (T-013
  pendiente), y el borrador usaba puerto `5432` y una GitHub Action de terceros en vez del puerto
  `6543` y `wrangler r2 object put` que exige D-7, además de un paso de purga manual en CI que D-7
  descarta explícitamente a favor de la regla *lifecycle* de R2; y, el hallazgo más importante, la
  sesión del suscriptor (§10) — el borrador asumía un mecanismo ya implementado, pero
  `sesion-suscriptor.ts` es solo el contrato reservado de la feature 008 (todas sus funciones
  lanzan `ErrorSesionSuscriptorPendiente`), documentado como tal, sin inventar un mecanismo de
  firma que no existe en el código.
- **Corrección posterior (misma sesión):** al aplicar los commits en la máquina de Mateo, el
  commit de T-014 se saltó por conflicto (`git am --skip`) y el reemplazo manual de
  `docs/INFRAESTRUCTURA.md`/`CHANGELOG.md` terminó publicando en `main` el **borrador original sin
  corregir** (con los mismos errores ya documentados arriba: cron `0 9 * * *`, puerto `5432`,
  `SUPABASE_SESSION_POOLER_URL`, la GitHub Action de terceros). Detectado por `grep` contra el
  contenido real tras sincronizar con `origin/main` para empezar T-011; corregido reescribiendo
  ambos archivos con el contenido verificado.

- **T-011** — Login, middleware y `lib/api.ts` (CA-4, CA-5). `frontend/middleware.ts` protege
  `/app/*` verificando solo la presencia de la cookie `uc_sesion_admin` (D-2 del plan); la
  validación real queda para el server component. `grep -rn "@supabase" frontend/app/
  frontend/components/` y `grep -rn "SERVICE_ROLE" frontend/` → cero resultados en ambos.
- **T-012** — Onboarding y dashboard protegido. `frontend/app/app/dashboard/page.tsx` es un
  server component que reenvía la cookie a mano vía `next/headers` (un fetch de servidor no
  hereda cookies del navegador, a diferencia del wrapper cliente `lib/api.ts`). Redirige a
  `/onboarding` sin acueducto y a `/login` con sesión inválida.
- **Corrección — `frontend/app/page.tsx`** seguía con el placeholder de T-010 a pesar de que
  `plan.md §1.2` ya especificaba que debía redirigir a `/login`. Corregido: redirige a
  `/app/dashboard` si hay cookie de sesión, o a `/login` si no la hay.
- **T-013** — Workflow `.github/workflows/backup-diario.yml` (CA-10) según D-7: Session Pooler
  puerto 6543 (`SUPABASE_DB_URL`), `pg_dump --format=custom --no-owner` vía imagen
  `postgres:16-alpine`, subida con `wrangler r2 object put` (sin GitHub Action de terceros),
  retención de 30 días por regla *lifecycle* del bucket (sin purga manual en CI). Solo se
  verificó la sintaxis YAML — la ejecución real requiere secretos de GitHub que no existen en
  este entorno.
- **Segunda corrección de `docs/INFRAESTRUCTURA.md`/`CHANGELOG.md` en `main`:** al aplicar un
  patch posterior, `origin/main` volvió a mostrar señales de haberse reconciliado manualmente en
  algún punto de la sesión; se resincronizó la rama local contra `origin/main` en cada entrega de
  patch para evitar duplicar commits ya aplicados con hashes distintos.
- **Decisión de alcance (Mateo):** no se construye una página `/registro` en el frontend para
  esta feature. El registro del primer admin de cada acueducto se hace vía `curl` directo contra
  `POST /auth/registro` (Mateo da de alta manualmente); el flujo de navegador para CA-11 empieza
  en `/login` con un usuario ya registrado así. Queda anotada como mejora futura, no como tarea
  de 001-fundación.

**Pendiente (bloqueadores externos, no de código)**
- **CA-10** (backup real a R2): requiere que Mateo configure `SUPABASE_DB_URL`,
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` como secretos de GitHub y cree el bucket
  `undreocol-backups` con su regla *lifecycle*; luego disparar `workflow_dispatch` y verificar con
  `wrangler r2 object list undreocol-backups`.
- **CA-11** (flujo manual completo en navegador): requiere a Mateo — este contenedor no tiene el
  CLI de `supabase` instalado, así que no se puede levantar `wrangler dev` contra una base real.
  Pasos exactos documentados en `tasks.md` T-012 y T-015.
- Despliegue real de los 4 Workers de `backend/` (`wrangler deploy`, sin `--dry-run`) — requiere
  las credenciales de Cloudflare de Mateo.

### 2026-08-31 — Sesión 007: Arquitectura definitiva sin servidor propio
**Hecho**
- Reescritos `ARQUITECTURA.md`, `docs/INFRAESTRUCTURA.md`, `CLAUDE.md`,
  `docs/ESPECIFICACION-FUNCIONAL.md`, `docs/ESTRATEGIA-CALIDAD.md` y
  `specs/001-fundacion/spec.md` con la arquitectura definitiva
- Documentadas las decisiones D-6, D-7, D-8, D-9 en `docs/DECISIONES.md`
  función `tamano_base_mb()`
- Actualizado el roadmap en `.specify/config.md` con las features 006
  (renombrada a impresión-y-correo), 014 (PWA con QR) y 015 (limpieza
  automática completa)

**Decisiones**
- **D-6:** arquitectura sin VPS — Next.js/Cloudflare Pages + Hono.js/Cloudflare
  Workers + Supabase PostgreSQL. Se descartaron VPS en Hetzner, Hostinger y
  LightNode tras investigación exhaustiva de comunidad, costos y fricción de
  pago desde Colombia.
- **D-7:** Supabase Free se explota al máximo con tres controles propios
  (keepalive diario, backup diario a R2 vía GitHub Actions, monitoreo de
  tamaño con alertas en 300/400/480 MB) en vez de pagar Supabase Pro desde el
  inicio. Proyección: con 1 cliente de ~1.000 suscriptores, el límite de
  500 MB no se alcanza en varios años.
- **D-8:** la entrega de factura tiene como flujo principal la impresión
  directa desde el navegador (`@media print`), no la generación de PDF. El
  correo con PDF adjunto es un flujo secundario y opcional.
- **D-9:** el PDF (solo para el flujo de correo) se genera con `pdf-lib`, no
  con `pdfme` completo ni con Chromium/Puppeteer — corre dentro de los límites
  de memoria y CPU de Cloudflare Workers.
- El escaneo de código QR se incorpora a la PWA del lector para identificar el
  contador sin error de digitación (nueva feature 014 en el roadmap).

**Pendientes**
- Tarifas reales verificadas (D-5) — bloqueante para el dataset dorado
  definitivo
- Aprobación de `specs/001-fundacion/spec.md` actualizado por Mateo
- Redactar `specs/001-fundacion/plan.md`
