# SPEC — 020: proxy-cookies-mismo-origen

**Estado:** en `/specify` — checkpoint pendiente de aprobación de Mateo.

**Origen:** bug real descubierto al probar 018 en producción, hoy: el login "funciona" (`POST
/auth/login` responde 200, la cookie se guarda) pero nunca lleva a ningún lado — el botón pasa a
"Ingresando…" y vuelve a "Ingresar" sin navegar. Confirmado con evidencia real (pestaña Network del
navegador de Mateo): la petición a `https://undreocol-api.undreocol.workers.dev/auth/login` responde
`200` con un `Set-Cookie` válido y el usuario correcto. El problema no es el backend ni la base de
datos — investigado y confirmado con la comunidad de Cloudflare (ver `docs/PLAN-PRODUCCION.md` para
las fuentes): **`workers.dev` está en la Public Suffix List, así que
`undreocol-frontend.undreocol.workers.dev` y `undreocol-api.undreocol.workers.dev` son dos dominios
completamente distintos para efectos de cookies**, aunque compartan la palabra "undreocol". La cookie
de sesión queda guardada bajo el dominio de la API; cuando el navegador navega al dashboard en el
dominio del frontend, esa página nunca la ve — un navegador no envía la cookie de un dominio a otro,
sin importar `SameSite` ni CORS.

**Corrige una afirmación equivocada de la auditoría original** (hallazgo M-4, `docs/PLAN-PRODUCCION.md`):
asumía que frontend y API compartían dominio registrable. No es así.

**Depende de:** 001-fundacion (`ALLOWED_ORIGIN`, CORS), 017 (login administrativo), 008 (sesión del
portal, `uc_sesion_suscriptor` — el mismo problema afecta al portal del suscriptor, que usa el mismo
mecanismo de `fetch` cliente-a-API). Es **prerrequisito de producción**, igual que 017 y 018: hoy
**ningún login funciona en producción**, ni el administrativo ni el del portal.

**Decisión ya tomada por Mateo (fuera de esta spec):** de las dos formas de arreglarlo — comprar un
dominio propio, o hacer que el navegador solo hable con el Worker del frontend y que este reenvíe
internamente al de la API — se eligió la segunda (**Opción B**, proxy con Service Binding de
Cloudflare, sin costo). Esta spec desarrolla esa opción.

---

## 1. Objetivo

Que el navegador nunca hable directamente con `undreocol-api.undreocol.workers.dev`: todas las
peticiones del cliente van al mismo origen que el frontend (`undreocol-frontend.undreocol.workers.dev`),
que las reenvía internamente al Worker de la API. Así la cookie de sesión queda scopeada al dominio
que el navegador realmente visita, y el login (administrativo y del portal) funciona de extremo a
extremo en producción.

## 2. Por qué ahora

Es un bloqueador total: ni el panel administrativo ni el portal del suscriptor funcionan hoy en
producción — nadie puede iniciar sesión. Sin esto, 018 (panel de plataforma) tampoco sirve de nada
en el mundo real, por más que su código esté correcto y verificado.

## 3. Alcance

### 3.1 Proxy de las peticiones del navegador

Una ruta en el Next.js del frontend que capture **todo** lo que hoy va a `NEXT_PUBLIC_API_URL` desde
el navegador (`/api/*`, todos los métodos) y lo reenvíe al Worker de la API vía **Service Binding**
de Cloudflare (Worker-a-Worker, sin salir a la red pública, sin costo adicional) — no vía un `fetch`
a la URL pública. La respuesta (código, cuerpo, y **especialmente `Set-Cookie`**) se devuelve tal
cual al navegador.

### 3.2 `lib/api.ts` apunta al mismo origen en producción

`URL_BASE_API` deja de ser una URL absoluta cruzada (`https://undreocol-api...`) para las llamadas
del navegador: pasa a ser una ruta relativa al propio origen del frontend. Esto cubre de una vez
**tanto el panel administrativo como el portal del suscriptor** — ambos usan el mismo `peticion()`.

### 3.3 Desarrollo local no cambia

`wrangler dev`/`next dev` en local siguen hablando directo a `http://localhost:8787`: ahí frontend y
backend comparten el mismo host (`localhost`), solo cambia el puerto, y las cookies no distinguen
puerto — el bug de esta spec **no existe en local**, solo en producción. La spec no toca el flujo de
desarrollo local.

### 3.4 Qué NO cambia

Los *server components* que ya hacen su propio `fetch` al backend reenviando la cookie a mano
(`dashboard/page.tsx`, `plataforma/page.tsx`) siguen funcionando igual — su problema nunca fue de qué
dominio viene la cookie del navegador (ellos ya la reenvían manualmente), sino que hoy esa cookie
nunca llega a existir en el dominio del frontend en primer lugar. Con 3.2 resuelto, `cookies()` en
esos componentes empieza a encontrarla. **No se migran a Service Binding en esta spec** — ver §4.

## 4. Fuera de alcance

- **Migrar los `fetch` de los *server components* al Service Binding.** Hoy funcionan (una vez
  resuelto 3.2) con una petición pública normal al backend; cambiarlos es una optimización de
  latencia, no una corrección de bug. Mejora futura, sin número asignado.
- **Comprar un dominio propio (Opción A).** Descartada por Mateo para este arreglo; sigue siendo la
  solución "correcta a largo plazo" si algún día se quiere salir de `workers.dev` del todo.
- **Tocar `ALLOWED_ORIGIN`/CORS del backend.** Con el proxy, el navegador deja de hacer peticiones
  cruzadas — CORS deja de ser relevante para el tráfico del navegador. La configuración de CORS que
  ya existe (M-3) se queda como está, por si algo más llega a llamar la API directo (ej. una futura
  PWA de lecturas, 015).
- **El bug de residuo entre `auth.users` y Postgres** (018 plan §5.1). No relacionado.

## 5. Reglas que aplican

- `CLAUDE.md §4` — evidencia real por CA: login real en el navegador de Mateo, con la cookie
  visible en el origen correcto (DevTools → Application → Cookies).
- `CLAUDE.md §5.2` — el frontend sigue sin importar `@supabase/*`; el proxy solo reenvía HTTP, no
  entiende el contenido de lo que reenvía.
- `CLAUDE.md §9` — un commit por tarea verificada; la IA no hace `push`.

## 6. Criterios de aceptación

### CA-1 — La cookie queda en el dominio del frontend
Tras un login exitoso desde el navegador, DevTools → Application → Cookies muestra `uc_sesion_admin`
bajo `undreocol-frontend.undreocol.workers.dev`, no bajo `undreocol-api...`. Verificación: captura
de pantalla o descripción exacta de Mateo (no verificable desde este entorno, sin navegador).

### CA-2 — El login administrativo lleva al dashboard/plataforma
Iniciar sesión desde `/login` navega correctamente a `/app/dashboard` o `/plataforma` según
corresponda (018 CA-3), sin quedarse en `/login`. Verificación: prueba real de Mateo.

### CA-3 — El login del portal también queda arreglado
El portal del suscriptor (008), que usa el mismo mecanismo, también funciona de extremo a extremo.
Verificación: prueba real de Mateo con un suscriptor de prueba.

### CA-4 — El desarrollo local no se rompe
`npm run dev` (frontend) contra `wrangler dev` (backend) en local sigue funcionando exactamente
igual que antes de esta spec. Verificación: **NO VERIFICABLE en este contenedor** (bloqueo de
`cdn.sheetjs.com` para `npm ci`) — queda como NO VERIFICADO para Mateo, con los pasos exactos.

### CA-5 — Los PDF de factura siguen descargando
`urlPdfFactura`/`urlPdfFacturaPortal` (que hoy generan enlaces directos al backend) siguen
funcionando a través del proxy, incluido el contenido binario. Verificación: descarga real de un PDF
en el navegador, o `curl` contra el Worker desplegado si Mateo lo hace.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El proxy no reenvía bien el cuerpo binario (PDF) o el streaming | CA-5 explícita; se revisa en `/plan` cómo OpenNext maneja `Response` binarios en un Route Handler |
| El Service Binding no está disponible en `wrangler dev` local sin configuración extra | 3.3: el flujo local no cambia, sigue usando la URL directa — el binding es solo para producción |
| Cambiar `URL_BASE_API` rompe algo que dependía de la URL absoluta (ej. un enlace copiado fuera de la app) | Revisar todos los usos de `URL_BASE_API` en `/plan` antes de tocarlo |

## 8. Definición de terminado

- [ ] CA-1 a CA-3 y CA-5 con evidencia real de Mateo (requiere su navegador)
- [ ] CA-4 declarado NO VERIFICADO con pasos exactos, si no se puede verificar aquí
- [ ] `frontend/wrangler.toml` con el Service Binding versionado
- [ ] `npx wrangler deploy --dry-run` del backend sigue OK (sin cambios ahí, pero se reconfirma)
- [ ] `.specify/config.md` con la fila 020, prerrequisito de producción
- [ ] `docs/PLAN-PRODUCCION.md` actualizado: M-4 corregido (era una afirmación equivocada, no un
      hallazgo cerrado)
- [ ] `CHANGELOG.md` actualizado
- [ ] Un commit por tarea verificada; sin `git push` (el comando se le entrega a Mateo)
