# PLAN — 015: identificacion-contador-qr

**Spec aprobado:** 2026-09-13

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/components/etiqueta-qr-contador.tsx` | Nuevo | Renderiza el QR de un contador (`qrcode`, nivel H) + su `serial` en texto; botón "Imprimir" |
| `frontend/app/app/suscriptores/[id]/page.tsx` | Modificado | Botón "Ver etiqueta QR" en la tarjeta "Contador"; monta `EtiquetaQrContador` |
| `frontend/components/lector/escaner-qr-contador.tsx` | Nuevo | Abre la cámara con `qr-scanner` (nativo `BarcodeDetector` con fallback a `jsQR` incluido en la librería), decodifica, entrega el texto crudo al padre |
| `frontend/components/lector/nueva-lectura-lector.tsx` | Modificado | Botón "Escanear QR"; matchea el texto decodificado contra `suscriptores` (prop ya recibida) por `contador_actual_id`; aviso si no matchea (CA-4) |
| `frontend/next.config.ts` | Modificado | Segundo bloque de `headers()`, matcher `/app/lecturas` exacto, solo `Permissions-Policy` con cámara permitida — el resto de headers de seguridad sigue viniendo del bloque global (§5) |
| `frontend/app/globals.css` | Modificado | Reglas de impresión de la etiqueta dentro del bloque `@media print` ya existente (mismo bloque que usan las facturas, 006/023) |
| `docs/ESPECIFICACION-FUNCIONAL.md` | Modificado | `§2.14.1`: encabezado "Feature 014" → "Feature 015"; nota de que se dividió en dos specs (spec §2) |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero migraciones, cero rutas de backend nuevas — confirmado en `/specify` que el matching ocurre
contra datos que el frontend ya tiene cargados (spec §3.3); `package.json` de `frontend/` gana las
dos dependencias de §6.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna — ni nueva ni modificada. Confirmado contra el código real de `contadores_lectura` (RLS) y
de `nueva-lectura-lector.tsx`: el `lector` ya recibe la lista completa de `suscriptores` de su
acueducto (con `contador_actual_id`) en la carga de página; el QR solo necesita resolverse contra
esos datos ya en memoria, sin ninguna consulta nueva.

## 4. Contratos de `core/`

Ninguno — no hay cálculo de dinero ni lógica de negocio pura involucrada; identificar un contador no
es una regla de facturación/consumo (eso sigue en `core/consumo.ts`, sin tocar).

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `qr-scanner` (nimiq, MIT) para escanear — ya implementa "`BarcodeDetector` nativo primero, `jsQR` como respaldo" internamente | Escribir la lógica de detección nativa + fallback a mano sobre `jsQR` directo | Spec §3.3 exige ese criterio (investigación de la comunidad); usar una librería que ya lo resuelve evita 100+ líneas propias de manejo de `getUserMedia`/`requestAnimationFrame`/limpieza de streams — código que ya existe, probado, con la licencia correcta |
| `qrcode` (soldair, MIT) para generar la etiqueta, con `errorCorrectionLevel: 'H'` | Generar el QR a mano (matriz + máscara + Reed-Solomon) o usar una librería sin esa opción configurable | Es el estándar de facto del ecosistema Node/browser para esto; expone directamente el nivel de corrección de errores que pide spec §3.1, sin envolver nada propio |
| Segundo bloque de `headers()` en `next.config.ts`, matcher `/app/lecturas` exacto, solo con la clave `Permissions-Policy` | Cambiar el `Permissions-Policy` global (todas las rutas) | Documentación oficial de Next.js + discusión de la comunidad: cuando dos bloques matchean la misma ruta, la última que fija una clave determinada gana **solo esa clave** — las otras cuatro cabeceras de seguridad (`X-Frame-Options`, CSP, etc.) siguen viniendo del bloque global sin repetirlas. Verificar con un `next build` real + inspección de headers antes de cerrar la tarea (no asumir) — [Next.js docs — headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers), [GitHub Discussion #17991](https://github.com/vercel/next.js/discussions/17991) |
| El QR se pinta y se imprime en la misma página (`/app/suscriptores/[id]`), con `print:hidden` en lo que no debe imprimirse | Una ruta aparte solo para la etiqueta (ej. `/app/suscriptores/[id]/etiqueta`) | Mismo patrón ya usado por la factura (`facturacion/[facturaId]/page.tsx:135,258`, `globals.css` `@media print`) — reusar el patrón existente en vez de inventar uno nuevo para esta feature |
| El escáner vive en un componente aparte (`escaner-qr-contador.tsx`), no inline en `nueva-lectura-lector.tsx` | Meter `getUserMedia`/`qr-scanner` directo en el formulario existente | Aísla el ciclo de vida de la cámara (abrir/cerrar el stream, limpieza en `useEffect`) del formulario de guardar la lectura — más fácil de verificar cada pieza por separado |

## 6. Dependencias nuevas

| Paquete | Versión | Licencia (confirmada contra el registro de npm) | Uso |
|---|---|---|---|
| `qrcode` | `^1.5.4` | MIT | Generar el QR de la etiqueta (§3.1) |
| `qr-scanner` | `^1.4.2` | MIT | Escanear desde la cámara (§3.3) — trae su propio fallback a `jsQR`, no se agrega `jsQR` aparte |

Ambas cumplen CLAUDE.md §2 (MIT/Apache-2.0/BSD/ISC). Verificar en `/implement` el tamaño real que
agregan al bundle de `frontend/` (Cloudflare Pages vía `@opennextjs/cloudflare` — no es el límite de
3MB/10MB del Worker de `backend/`, pero igual se revisa `npm run build` para confirmar que no
infla el `First Load JS` de forma notoria).

## 7. Límites de Cloudflare Workers a considerar

No aplica al backend (`backend/src/index.ts` no se toca). El frontend corre sobre
`@opennextjs/cloudflare` (Worker también, `frontend/wrangler.toml`) — la cámara y la decodificación
del QR ocurren enteramente en el navegador del lector, nunca en el Worker; no hay CPU ni memoria de
Cloudflare involucrada en esta feature.

## 8. Estrategia de pruebas

`frontend/` no tiene framework de tests unitarios configurado (solo `build`/`lint`, mismo estado que
030-034) — la verificación de esta feature es manual, contra un navegador real, más estricta que de
costumbre porque toca una API del navegador (cámara) que no se puede simular con mocks útiles:

- **Build/lint:** `npm run build` y `npm run lint` limpios en `frontend/` (CA implícito en la
  Definición de terminado).
- **Manual — generación e impresión de la etiqueta (CA-1, CA-2):** con un contador de prueba real,
  "Ver etiqueta QR" muestra un QR que un lector de QR de celular decodifica correctamente al `id` real
  del contador (verificable escaneándolo con la cámara de cualquier teléfono, fuera de la app);
  `Ctrl+P` imprime solo la etiqueta, sin el resto de la ficha del suscriptor.
- **Manual — escaneo real (CA-3, CA-4, CA-6):** con una cámara real (celular Android o webcam en modo
  responsivo del navegador, `wrangler dev`/`next dev` local): escanear la etiqueta de un contador de
  prueba preselecciona ese contador; escanear un QR arbitrario (no un contador del acueducto) muestra
  el aviso de "no corresponde" sin romper la pantalla; el `<select>` manual sigue registrando una
  lectura real, sin ninguna regresión sobre 025.
- **Manual — cabeceras (CA-5):** `curl -I` real contra `/app/lecturas` y contra otra ruta cualquiera
  del panel (ej. `/app/facturacion`) tras el build, confirmando que solo `/app/lecturas` permite
  cámara y que las otras cuatro cabeceras de seguridad siguen presentes en ambas — no asumir el
  comportamiento de "última clave gana" de Next.js (§5) sin verlo en la respuesta real.
- **Manual, requiere Mateo:** aspecto visual final en un celular Android real (cámara, tamaño de la
  etiqueta al imprimir en una impresora real) — este entorno no tiene Chromium/Playwright ni una
  cámara física.
