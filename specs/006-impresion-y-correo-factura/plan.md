# PLAN — 006: impresion-y-correo-factura

**Spec aprobado:** 2026-09-06 (spec.md commit `78f5e9c`)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` ni código hasta esa aprobación.

---

## 0. Punto de partida

Reutilizado sin tocar:
- De 005: `facturas` (con `pdf_url` reservado), `factura_detalles`, la cola `undreocol-facturacion`
  (producer+consumer en `wrangler.toml`), el consumidor `backend/src/queues/cierre-facturacion.ts`,
  la vista de detalle `/app/facturacion/[facturaId]` y las rutas de facturación en `index.ts`.
- De 001: `clientes` (`logo_url`, `nombre`, `nit`, `direccion`, `telefono`, `municipio`) para la
  personalización por acueducto; funciones de seguridad.
- De 003: `usuarios_servicio.email`.

**APIs de Cloudflare confirmadas con la documentación oficial (2026-09-06):**
- Email Workers: binding `[[ send_email ]] name = "EMAIL"`; método `env.EMAIL.send(message)` con el
  builder estructurado `{ to, from, subject, html?, text?, attachments?: [{ content: ArrayBuffer,
  filename, type }] }`; errores con `code` (`E_SENDER_NOT_VERIFIED`, `E_CONTENT_TOO_LARGE`, etc.).
  **En `wrangler dev` local los adjuntos binarios no se serializan** → el envío real se prueba en
  producción/remoto (cuenta de Mateo), no en local.
- R2: binding `[[r2_buckets]] binding = "FACTURAS_R2" bucket_name = "..."`. En local `wrangler dev`
  simula R2 con persistencia (`.wrangler/state`).

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260906090000_correo-factura.sql` | crear | Tabla `notificaciones` (del esquema propuesto) + RLS `FORCE` + políticas |
| `tests/fixtures/correo-factura.sql` | crear | Fila(s) de notificación y datos del acueducto (logo nulo) para el test |
| `tests/aislamiento/006_correo_factura_aislamiento.sql` | crear | CA-1 (RLS/aislamiento + regresión 001-005) |
| `backend/src/lib/factura-pdf.ts` | crear | Generación del PDF con `pdf-lib` (D-9): factura + detalles + datos del acueducto |
| `backend/src/lib/email.ts` | crear | Envío del correo con adjunto vía Cloudflare Email Workers; detecta ausencia de `env.EMAIL` (dev) y NO bloquea |
| `backend/src/queues/cierre-facturacion.ts` | editar | Ampliar el consumidor: mensaje con `tipo: 'emitir_factura' \| 'enviar_correo_factura'` |
| `backend/src/lib/db.ts` | editar | Binding `EMAIL` + `FACTURAS_R2` en `Env`; extender el tipo de mensaje de la cola |
| `backend/src/lib/facturacion.ts` | editar | Endpoint `GET /facturas/:id/pdf` (sirve/genera el PDF) |
| `backend/src/index.ts` | editar | Rutas: `POST /facturas/:id/enviar-correo`, `POST /facturacion/periodos/:id/enviar-correo`, `GET /facturas/:id/pdf` |
| `backend/wrangler.toml` | editar | `[[r2_buckets]]` + `[[send_email]]` (misma cola, sin cola nueva) |
| `backend/package.json` | editar | Dependencia `pdf-lib` |
| `frontend/app/app/facturacion/[facturaId]/page.tsx` | editar | Botones Imprimir / Enviar por correo + hoja `@media print` |
| `frontend/app/app/facturacion/page.tsx` | editar | Botón "Enviar por correo a los que tienen email" del periodo + aviso sin email |
| `frontend/lib/api.ts` | editar | Funciones `enviarCorreoFactura`, `enviarCorreoPeriodo`, `descargarPdfFactura` |
| `CHANGELOG.md` | editar | Cierre de la feature |

## 2. Esquema de base de datos

### Migraciones

| Archivo | Contenido |
|---|---|
| `20260906090000_correo-factura.sql` | `create type estado_notificacion` (`pendiente`/`enviada`/`fallida`/`cancelada`); tabla `notificaciones` (del esquema propuesto §13): `factura_id` FK nullable `ON DELETE CASCADE`, `usuario_servicio_id` nullable, `tipo` text default `'factura_generada'`, `canal` default `'email'`, `destinatario`, `asunto`, `estado`, `intentos smallint default 0`, `ultimo_error`, `enviada_en`; índices `(cliente_id, estado)` y `(factura_id)`; RLS `FORCE` + políticas (lectura miembros, escritura admin y el worker de correo con service_role) |

### Tabla

```sql
create type estado_notificacion as enum ('pendiente','enviada','fallida','cancelada');

create table notificaciones (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  usuario_servicio_id uuid references usuarios_servicio(id) on delete cascade,
  factura_id          uuid references facturas(id) on delete cascade,  -- evento de factura
  tipo                text not null default 'factura_generada',       -- recordatorio/mora/pago = 010
  canal               text not null default 'email',
  destinatario        text,
  asunto              text,
  estado              estado_notificacion not null default 'pendiente',
  intentos            smallint not null default 0,
  ultimo_error        text,
  enviada_en          timestamptz,
  created_at          timestamptz not null default now()
);
create index on notificaciones (cliente_id, estado);
create index on notificaciones (factura_id);
```

Nota: el consumidor de correo actualiza `notificaciones` (estado/intentos/error) con `service_role`
(BYPASSRLS); las políticas RLS sirven para que el admin lea el estado desde el panel (patrón 001-005).

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| `POST` | `/facturas/:id/enviar-correo` | admin_acueducto | Encola el envío del correo de UNA factura (202); crea la fila `notificaciones` |
| `POST` | `/facturacion/periodos/:id/enviar-correo` | admin_acueducto | Encola el envío de las facturas del periodo cuyos suscriptores tienen email (202; devuelve omitidos por falta de email) |
| `GET` | `/facturas/:id/pdf` | admin o lector | Sirve el PDF (`application/pdf`). Genera+sube a R2 si no existe; si existe, lo lee de R2 |

El envío usa la MISMA cola `undreocol-facturacion` de 005, ampliada: el mensaje pasa a
`{ tipo: 'emitir_factura' | 'enviar_correo_factura', ... }`. El consumidor enruta por `tipo` — no se
añade infraestructura de cola nueva.

## 4. Contratos de `lib/`

### `factura-pdf.ts` (pdf-lib, D-9)
```ts
export interface DatosAcueductoPdf {
  nombre: string; nit: string | null; direccion: string | null;
  telefono: string | null; municipio: string | null; logoUrl: string | null;
}

// Genera el PDF de una factura. Devuelve los bytes listos para subir a R2.
export async function generarPdfFactura(input: {
  factura: FacturaRow;           // de lib/facturacion.ts
  detalles: DetalleFacturaRow[];
  acueducto: DatosAcueductoPdf;
}): Promise<Uint8Array>;
// Encabezado: logo (si logoUrl) + nombre/NIT/dirección del acueducto.
// Datos de la factura: numero, periodo, fechas, suscriptor (snapshot).
// Cuerpo: tabla del desglose por servicio (detalles); recargo mora; saldo; total.
```

### `email.ts` (Cloudflare Email Workers)
```ts
// Envía el correo con el PDF adjunto. Si env.EMAIL no existe (dev local sin
// remote bindings) NO lanza: devuelve { ok:false } para que la regla 20
// ("nunca bloquea") se pueda probar en local.
export interface ResultadoEnvio {
  ok: boolean; error?: string; messageId?: string;
}
export async function enviarFacturaPorCorreo(env: Env, input: {
  destinatario: string; remitente: string; asunto: string;
  pdfBytes: Uint8Array; pdfNombre: string;
}): Promise<ResultadoEnvio>;
// usa env.EMAIL.send({ to, from, subject, html, attachments: [{ content: pdfBytes,
// filename, type: 'application/pdf' }] }); los errores con code se mapean a ResultadoEnvio.
```

### Mensaje de cola (ampliación de lib/db.ts)
```ts
export type TipoMensajeFacturaCierre = 'emitir_factura' | 'enviar_correo_factura';
export interface MensajeFacturaCierre {
  tipo: TipoMensajeFacturaCierre;
  clienteId: string;
  periodoId?: string;          // para 'emitir_factura'
  usuarioServicioId?: string;  // para 'emitir_factura'
  facturaId?: string;          // para 'enviar_correo_factura'
}
```


## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| PDF con `pdf-lib`, plantilla programática en `lib/factura-pdf.ts` | `pdfme`/editor visual/Chromium | D-9 y CLAUDE.md §6/§12: prohibido en Workers; pdf-lib es base de pdfme, puro JS, ~4MB, 1-4ms por PDF |
| El PDF se guarda en R2 y se sirve por `GET /facturas/:id/pdf` | Bucket R2 público con URL directa | No depende de hacer público el bucket (seguridad multi-tenant); la descarga pasa por auth de la app. `facturas.pdf_url` guarda la ruta relativa `/facturas/{id}/pdf` (008 la reutiliza) |
| El envío reutiliza la MISMA cola `undreocol-facturacion` ampliando el mensaje con `tipo` | Segunda cola `correo-factura` | Un Worker solo tiene un handler `queue`; distinguir por `tipo` en el mensaje evita duplicar infraestructura y funciona en local (round-trip de 005 ya verificado) |
| `lib/email.ts` no lanza si `env.EMAIL` no existe (dev): devuelve `{ ok:false }` y se registra en `notificaciones` | Dejar que el envío falle con excepción en dev | Regla 20 ("nunca bloquea"): el flujo se prueba en local sin Workers Paid; el error real se documenta como pendiente de Mateo |
| El consumidor de correo hace: genera PDF → sube a R2 → `env.EMAIL.send` → actualiza `notificaciones` (intentos/estado/error) | Enviar en el request del admin | Desacople (regla 20): el request solo encola y responde 202; un fallo queda en la fila y es visible |
| La tabla `notificaciones` se crea en 006 (evento `factura_generada`) | Esperar a 010 | 006 necesita registrar intentos/errores del envío; 010 generalizará con otros eventos y plantillas |
| Remitente: dominio verificado de UndreoCol (email del acueducto como `from` fijo de la plataforma) | El dominio de cada acueducto como remitente | Verificar dominios por cada acueducto multiplica la configuración; el `from` es de UndreoCol y el `replyTo`/asunto identifican al acueducto |
| La vista `@media print` reutiliza la pantalla de detalle de 005 (CSS oculta navegación) | Ruta imprimible separada | Misma fuente de datos y menos código; el CSS de impresión aísla la factura |

## 6. Dependencias nuevas

| Paquete | Versión | Licencia | Por qué | Alternativa descartada |
|---|---|---|---|---|
| `pdf-lib` | ^1.17.1 | MIT | Generación del PDF adjunto (D-9): puro JS, corre en Workers | `pdfme` (prohibido, D-9); Chromium (servicio de pago, desproporcionado) |

## 7. Límites de Cloudflare Workers a considerar

- El envío por lote va por la cola (una factura por mensaje), nunca en un solo fetch — mismo patrón
  que el cierre de 005.
- `pdf-lib` por PDF: ~1-4ms de CPU y pocos MB de memoria; el bundle del Worker crece ~4MB (se
  confirma con el dry-run; dentro del límite de 10MB Paid y del free dev).
- R2: el objeto se sube una vez por factura y se reutiliza (no se regenera en cada descarga).
- Email: el límite de mensajes del plan es de Workers Paid (3.000/mes incluidos); un fallo por rate
  limit se registra y reintenta (regla 20).

## 8. Estrategia de pruebas

- **Unit (`pdf-lib`, CA-2):** `backend/tests/unit/factura-pdf.test.ts` — `generarPdfFactura` devuelve
  un `Uint8Array` que empieza por `%PDF` y que `pdf-lib` puede reabrir; el texto extraído contiene el
  `numero`, el `total` y el nombre del suscriptor; con y sin logo. Usa una factura real de la base
  (fixture 005) cuando la prueba de integración lo permita.
- **Aislamiento (CA-1):** `006_correo_factura_aislamiento.sql` — A no lee/escribe notificaciones de
  B; solo admin escribe; el lector lee. Regresión 001-005 sobre el mismo estado final.
- **Integración (CA-3/CA-4):** con `wrangler dev` + Supabase local (sin Workers Paid) el envío se
  prueba con el comportamiento de `email.ts` cuando `env.EMAIL` no existe (devuelve `{ok:false}` sin
  lanzar): se verifica que el request del admin responde 202, que la fila en `notificaciones` queda
  `fallida`/`pendiente` con `ultimo_error`, y que el reintento no rompe nada. El envío real queda
  NO VERIFICADO (cuenta Cloudflare de Mateo + dominio verificado + Workers Paid), pasos exactos.
- **PDF por HTTP (CA-2/CA-5):** `GET /facturas/:id/pdf` con la cookie de admin → 200
  `application/pdf` (curl). Render de la vista `@media print` con `next dev` si el entorno lo
  permite.
- **Manual (Mateo):** envío real a Cloudflare y flujo click-a-click.

### Orden de verificación (para /tasks)
1. Migración `notificaciones` + fixture + aislamiento (CA-1).
2. `pdf-lib` + `factura-pdf.ts` + unit (CA-2).
3. `email.ts` + ampliación del consumidor de la cola + rutas de envío + `notificaciones`
   (CA-3/CA-4, con el fallo no bloqueante verificado en local).
4. Endpoint `GET /facturas/:id/pdf` + R2 (CA-2 HTTP).
5. Frontend: `@media print` + botones de envío (CA-5/CA-6).
6. Cierre CHANGELOG.

