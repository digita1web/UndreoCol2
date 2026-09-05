# PLAN — 010: notificaciones

**Spec aprobado:** 2026-09-05 (spec.md, commits `4a63727` borrador + `e98c566` aprobación)
**Estado:** Aprobado (2026-09-05, commit `8ce13a6`) — pendiente de `/tasks`.

---

## 0. Punto de partida

Reutilizado sin tocar (verificado leyendo el código real, no de memoria):
- De 006: tabla `notificaciones` + `estado_notificacion` (`supabase/migrations/20260906090000_correo-factura.sql`),
  políticas RLS `notificaciones_lectura`/`notificaciones_admin` (ya cubren cualquier `tipo`, no solo
  `factura_generada` — no requieren cambios), la cola `undreocol-facturacion` (producer en
  `wrangler.toml`, consumer en `backend/src/queues/cierre-facturacion.ts`), `backend/src/lib/email.ts`
  (`enviarFacturaPorCorreo`, `computarActualizacionNotificacion`, `MAX_INTENTOS_ENVIO`), el tipo
  `MensajeFacturaCierre`/`Env` de `backend/src/lib/db.ts`.
- De 007: `POST /pagos` → `registrarPago()` (`backend/src/lib/pagos.ts`), devuelve
  `{ pago: Record<string,unknown>, aplicaciones, remanente, facturas }` con `pago.usuario_servicio_id`,
  `pago.valor`, `pago.fecha_pago` ya disponibles en la respuesta de la RPC `registrar_pago`.
- De 009: `POST /suscriptores/:id/corte` / `.../reconexion` → `cortarSuscriptor()`/`reconectarSuscriptor()`
  (`backend/src/lib/cortes.ts`), ambas reciben `usuarioServicioId` directo (el `:id` de la ruta) —
  no hace falta ninguna consulta extra para saber a quién notificar.
- De 001/003: `usuarios_servicio.email`, patrón RLS `es_admin_de()`/`mis_clientes()`.

**Confirmado en el repo real (no asumido):**
- `notificaciones.tipo` es `text not null default 'factura_generada'` **sin `CHECK`** — se puede
  cerrar el catálogo agregando el `CHECK` sin migrar ningún dato (las únicas filas que existen hoy,
  en fixtures/tests, ya usan `factura_generada`).
- `computarActualizacionNotificacion()` (`backend/src/lib/email.ts:29`) ya es pura — no importa Hono,
  Cloudflare ni Supabase — solo vive en `lib/` por dónde nació (006), no por necesidad.
- `backend/wrangler.monitor-db.toml` **no tiene** el binding `[[send_email]]` todavía (se agrega en
  esta feature).
- Próxima fecha de migración libre: la última es `20260912090000_importacion-suscriptores.sql`.

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `supabase/migrations/20260913090000_notificaciones-generales.sql` | crear | `CHECK` del catálogo de 6 tipos en `notificaciones.tipo`; columna `configuracion.dias_aviso_vencimiento` |
| `docs/esquema-propuesto.sql` | editar | Reflejar el `CHECK` y la columna nueva — mantener el documento de referencia veraz (mismo criterio que la corrección ya hecha en `docs/INFRAESTRUCTURA-Y-COSTOS.md §2`) |
| `backend/src/core/notificaciones.ts` | crear | Contenido puro por tipo (`asunto`+`cuerpoHtml`) para los 5 tipos nuevos; `computarActualizacionNotificacion()`/`MAX_INTENTOS_ENVIO` **movidos** desde `lib/email.ts` (son lógica pura, CLAUDE.md §5.3) |
| `backend/src/lib/notificaciones.ts` | crear | `encolarNotificacion()`: inserta la fila en `notificaciones` + encola el mensaje — capa fina reutilizada por 3 rutas y el cron nuevo |
| `backend/src/lib/email.ts` | editar | Se retiran `computarActualizacionNotificacion`/`MAX_INTENTOS_ENVIO` (van a `core/`); se agrega `enviarCorreo()` genérico (adjunto opcional); `enviarFacturaPorCorreo` pasa a ser un envoltorio delgado sobre `enviarCorreo` (mismo contrato externo, sin romper 006) |
| `backend/src/lib/db.ts` | editar | `TipoMensajeFacturaCierre` gana `'enviar_notificacion'`; `MensajeFacturaCierre` gana `destinatario?`, `asunto?`, `cuerpoHtml?` (opcionales, solo para el tipo nuevo) |
| `backend/src/queues/cierre-facturacion.ts` | editar | El `queue()` gana una tercera rama (`enviar_notificacion`); importa `computarActualizacionNotificacion` desde `core/notificaciones` en vez de `lib/email` |
| `backend/src/cron/avisos-vencimiento.ts` | crear | Worker programado diario: recordatorio de vencimiento + aviso de mora, con idempotencia por `(factura_id, tipo)` |
| `backend/wrangler.avisos-vencimiento.toml` | crear | Config del cron nuevo (mismo patrón que `wrangler.monitor-db.toml`); productor hacia `undreocol-facturacion` (sin cola nueva) |
| `backend/src/cron/monitor-db.ts` | editar | `alertaStub()` → envío real vía `lib/email.ts` (`enviarCorreo`), sin pasar por `notificaciones` (spec §3.8) |
| `backend/wrangler.monitor-db.toml` | editar | Agrega `[[send_email]] name = "EMAIL"` (no lo tenía) + var `ALERTA_EMAIL_DESTINO` |
| `backend/src/index.ts` | editar | Engancha `confirmacion_pago` en `POST /pagos`; `corte_ejecutado`/`reconexion_completada` en `POST /suscriptores/:id/corte` y `.../reconexion`; nueva ruta `GET /notificaciones` |
| `frontend/lib/api.ts` | editar | `listarNotificaciones()` + tipos (`Notificacion`, `TipoNotificacion`) |
| `frontend/app/app/notificaciones/page.tsx` | crear | Panel de historial (solo lectura), filtros por tipo/estado |
| `backend/tests/unit/notificaciones.test.ts` | crear | Contenido por tipo (5 casos) + `computarActualizacionNotificacion` (movidos desde `email.test.ts`, sin cambiar su comportamiento) |
| `backend/tests/unit/email.test.ts` | editar | Se retiran los tests movidos; quedan los de `enviarCorreo`/`enviarFacturaPorCorreo` |
| `tests/fixtures/notificaciones-generales.sql` | crear | Facturas por vencer/vencidas, un pago, un corte y una reconexión de un cliente A y de un cliente B (para CA-3/CA-4/CA-5/CA-7) |
| `tests/aislamiento/010_notificaciones_aislamiento.sql` | crear | `GET /notificaciones` aislado por cliente + regresión 001-009/012 |

## 2. Esquema de base de datos

### Migraciones

| Archivo | Contenido |
|---|---|
| `20260913090000_notificaciones-generales.sql` | `ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_valido CHECK (tipo IN (...6 valores...))`; `ALTER TABLE configuracion ADD COLUMN dias_aviso_vencimiento integer NOT NULL DEFAULT 3` |

```sql
-- Catálogo cerrado de tipos (spec §3.1). Sin ALTER TYPE de enum (ver §5,
-- decisión técnica) — un CHECK sobre el `text` que ya existe desde 006.
alter table notificaciones
  add constraint notificaciones_tipo_valido check (
    tipo in (
      'factura_generada',        -- 006, sin cambios
      'recordatorio_vencimiento',
      'aviso_mora',
      'confirmacion_pago',
      'corte_ejecutado',
      'reconexion_completada'
    )
  );

-- Umbral configurable por acueducto para el recordatorio (spec §3.5, default
-- aprobado por Mateo: 3 días).
alter table configuracion
  add column dias_aviso_vencimiento integer not null default 3;

comment on column configuracion.dias_aviso_vencimiento is
  'Días antes de fecha_vencimiento en que se genera el recordatorio (010). '
  'El aviso de mora no usa este campo: se dispara el primer día que la '
  'factura queda vencida, sin configuración adicional.';
```

Sin cambios de RLS: `notificaciones_lectura`/`notificaciones_admin` (006) ya cubren cualquier `tipo`
por ser políticas sobre la fila completa, no sobre columnas específicas.

### Tablas

Ninguna tabla nueva. `notificaciones` y `configuracion` ya existen (006 y 001); esta feature solo
agrega una restricción y una columna.

## 3. Rutas de la API (Hono)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| `GET` | `/notificaciones` | miembro del cliente (RLS ya filtra) | Lista `notificaciones` del cliente activo; filtros opcionales `?tipo=` y `?estado=`, orden por `created_at desc` |

Sin rutas nuevas de escritura: las 5 notificaciones síncronas se generan como **efecto secundario**
dentro de rutas que ya existen (`POST /pagos`, `POST /suscriptores/:id/corte`, `.../reconexion`) — sus
contratos de request/response **no cambian** (decisión técnica, ver §5): un cliente que ya integró
esas rutas no ve ninguna diferencia si la notificación falla o se omite por falta de email.

## 4. Contratos de core/

```ts
// backend/src/core/notificaciones.ts

export type TipoNotificacionNueva =
  | 'recordatorio_vencimiento'
  | 'aviso_mora'
  | 'confirmacion_pago'
  | 'corte_ejecutado'
  | 'reconexion_completada';
// 'factura_generada' NO se incluye aquí: su contenido lo sigue armando
// enviarCorreoDeFactura() en queues/cierre-facturacion.ts (006, sin cambios).

export interface ContenidoNotificacion {
  asunto: string;
  cuerpoHtml: string;
}

export function contenidoRecordatorioVencimiento(datos: {
  nombreAcueducto: string;
  numeroFactura: string;
  fechaVencimiento: string; // YYYY-MM-DD
  total: number;
}): ContenidoNotificacion;

export function contenidoAvisoMora(datos: {
  nombreAcueducto: string;
  numeroFactura: string;
  diasMora: number;
  total: number;
}): ContenidoNotificacion;

export function contenidoConfirmacionPago(datos: {
  nombreAcueducto: string;
  valor: number;
  fechaPago: string;
  facturasAplicadas: string[]; // números de factura abonados
}): ContenidoNotificacion;

export function contenidoCorteEjecutado(datos: {
  nombreAcueducto: string;
  motivo: string;
  fecha: string;
}): ContenidoNotificacion;

export function contenidoReconexionCompletada(datos: {
  nombreAcueducto: string;
  fecha: string;
  facturaReconexionNumero: string | null;
}): ContenidoNotificacion;

// Movidos sin cambios de comportamiento desde lib/email.ts (spec §3.6):
export const MAX_INTENTOS_ENVIO: number;
export function computarActualizacionNotificacion(
  resultado: { ok: boolean; error?: string },
  intentosActuales: number,
): { estado: 'pendiente' | 'enviada' | 'fallida'; intentos: number; ultimo_error?: string; enviada_en?: string };
```

```ts
// backend/src/lib/notificaciones.ts (capa fina: DB + cola, no lógica de negocio)

export async function encolarNotificacion(
  supabase: SupabaseClient,
  cola: Queue<MensajeFacturaCierre> | undefined,
  input: {
    clienteId: string;
    usuarioServicioId: string;
    tipo: TipoNotificacionNueva;
    destinatarioEmail: string | null; // null → no se crea fila (spec §3.4/§3.5, "sin email no rompe nada")
    contenido: ContenidoNotificacion;
  },
): Promise<{ encolado: boolean; notificacionId?: string }>;
```

```ts
// backend/src/lib/email.ts — generalización (spec §3.3)

export interface EnviarCorreoInput {
  destinatario: string;
  remitente: string;
  asunto: string;
  cuerpoHtml: string;
  adjunto?: { content: ArrayBuffer; filename: string; type: string }; // opcional (antes obligatorio)
}
export async function enviarCorreo(env: Pick<Env, 'EMAIL'>, input: EnviarCorreoInput): Promise<ResultadoEnvio>;

// enviarFacturaPorCorreo(env, input) sigue existiendo con la MISMA firma que
// hoy (006) — internamente arma el adjunto y llama a enviarCorreo(). Ningún
// llamador de 006 cambia una línea.
```

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Mover `computarActualizacionNotificacion`/`MAX_INTENTOS_ENVIO` a `core/notificaciones.ts` | Dejarlas en `lib/email.ts` | Es lógica pura sin dependencias de Hono/Cloudflare/Supabase (`CLAUDE.md §5.3`); ahora la usan 6 tipos, no solo el correo de factura — `lib/email.ts` es infraestructura de envío, no debería ser el dueño del cálculo de reintentos |
| Contenido (`asunto`+`cuerpoHtml`) armado en el origen (ruta/cron) y llevado íntegro en el mensaje de la cola | Guardar solo IDs en el mensaje y re-consultar los datos frescos en el consumidor | El origen ya tiene todos los datos recién obtenidos (el pago que acaba de registrar, la factura que acaba de encontrar vencida); repetir la consulta en el consumidor es trabajo redundante — nada cambia entre encolar y consumir en el mismo segundo |
| Reutilizar la cola `undreocol-facturacion` para los 5 disparadores nuevos | Crear una cola `undreocol-notificaciones` separada | Ninguna documentación de referencia (`ARQUITECTURA.md`, `docs/INFRAESTRUCTURA-Y-COSTOS.md`) registra un límite del plan Free de Queues que obligue a separarlas; sumar una cola es infraestructura nueva sin necesidad funcional (criterio de rentabilidad, `CLAUDE.md §2`) |
| Catálogo de tipos con `CHECK` sobre `text` | Migrar `tipo` a un `enum` de Postgres (como `estado_notificacion`) | Agregar un valor a un `enum` (`ALTER TYPE ... ADD VALUE`) no puede ejecutarse dentro de la misma transacción que lo usa en algunas versiones de Postgres, complicando el día que aparezca un séptimo tipo; un `CHECK` se reemplaza con `DROP CONSTRAINT`/`ADD CONSTRAINT` en una migración normal |
| Alerta de `monitor-db.ts` enviada directo (`enviarCorreo`), sin pasar por `notificaciones` | Insertar con un `cliente_id` "de sistema" ficticio | Ya aprobado en spec §3.8: inventar un cliente violaría "`cliente_id` sin excepciones" (`CLAUDE.md §5.4`) sobre una tabla de negocio multi-tenant real |
| `enviarFacturaPorCorreo` se conserva como envoltorio de `enviarCorreo`, no se reescribe | Cambiar directamente su firma y actualizar el único llamador (006) | Menor riesgo de regresión: ni el consumidor de 006 (`enviarCorreoDeFactura`) ni sus tests cambian una línea |
| Notificaciones síncronas (pago/corte/reconexión) no cambian el contrato de respuesta de sus rutas | Agregar `notificacionEncolada: boolean` a la respuesta de `POST /pagos`/`.../corte`/`.../reconexion` | Son rutas ya cerradas (007/009) con contrato estable consumido por el frontend; la notificación es un efecto secundario best-effort (regla 20 extendida), no parte del resultado que le importa al admin que ejecuta la acción |

## 6. Dependencias nuevas

Ninguna. Se reutiliza toda la infraestructura existente: Supabase (Postgres), Cloudflare Queues (cola
ya creada), Cloudflare Email Service (binding ya usado en 006), Cloudflare Cron Triggers (patrón ya
usado en `keepalive`/`monitor-db`/`limpieza`).

## 7. Límites de Cloudflare Workers a considerar

`backend/src/cron/avisos-vencimiento.ts` recorre todos los clientes activos y sus facturas
`pendiente` una vez al día — corre como **Cron Trigger** (hasta 15 min de CPU, `CLAUDE.md §5.5`), no
como una invocación de `fetch` (límite de 30s): el volumen del acueducto piloto (cientos de facturas)
está lejos de ese límite y no requiere Queues para este propio recorrido (a diferencia del cierre de
facturación masivo, que sí procesa por lotes). El **envío** de cada aviso sí sigue yendo por la cola
existente, una notificación por mensaje, igual que el correo de factura de 006.

Sin dependencias nuevas → sin impacto en el tamaño del bundle (`backend/`, límite 10 MB Paid / 3 MB
Free ya vigilado desde 001).

## 8. Estrategia de pruebas

- **Unitarias (`core/`):**
  - `contenido*` (5 funciones): un test por tipo verificando que el asunto y el cuerpo contienen los
    datos correctos (número de factura, monto, fecha, motivo, según el tipo) — `vitest`, sin Workers
    ni base de datos.
  - `computarActualizacionNotificacion`/`MAX_INTENTOS_ENVIO`: los tests existentes de 006 se mueven
    de `email.test.ts` a `notificaciones.test.ts` sin modificarlos — deben seguir en verde tal cual,
    confirmando que el movimiento no cambió comportamiento.
- **Aislamiento (RLS):** `010_notificaciones_aislamiento.sql` — `GET /notificaciones` del cliente A no
  devuelve filas del cliente B (fixture con ambos); regresión completa 001-009/012 sobre el estado
  final del esquema (mismo patrón que el cierre de cada feature anterior).
- **Integración (`curl` real contra `wrangler dev` + Supabase local):**
  - CA-3: `POST /pagos` con el stub de envío forzado a fallar → responde 201 igual, el pago queda en
    la base, la fila de `notificaciones` (`tipo='confirmacion_pago'`) queda `pendiente`/`fallida` con
    `ultimo_error`.
  - CA-4: mismo criterio para `POST /suscriptores/:id/corte` y `.../reconexion` (responden 201 igual
    pese al fallo simulado del envío).
  - CA-5: ejecutar el handler de `avisos-vencimiento.ts` dos veces seguidas contra el mismo fixture →
    consulta SQL directa confirma **una sola** fila por `(factura_id, tipo)`.
  - CA-8: simular nivel `alerta`/`critico` en `monitor-db.ts` (mismo mecanismo de test que
    `nivel-monitoreo.ts` ya usa) → se confirma la llamada a `enviarCorreo` con el destinatario/asunto
    esperados (stub), sin tocar `notificaciones`.
- **Manual (requiere Mateo, NO VERIFICABLE en este entorno):** envío real de cualquiera de los 6 tipos
  a un buzón real — igual que 006, requiere Workers Paid + dominio verificado de la cuenta de
  Cloudflare de Mateo. Pasos exactos en `tasks.md` cuando se escriba.
