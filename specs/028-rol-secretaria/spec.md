# SPEC — 028: rol-secretaria

**Estado:** Borrador para aprobación
**Depende de:** 001-fundacion, 024-permisos-lector, 026-shell-panel-admin

## 1. Objetivo

Agregar un rol nuevo dentro del acueducto, `secretaria`: hace el trabajo administrativo del día
a día (suscriptores, lecturas, facturas, atender pagos en el mostrador) pero **no ve el panel
financiero agregado** (recaudo del mes, tendencia, cartera total) ni ejecuta las acciones más
consecuentes (anular factura/pago, cerrar facturación, ejecutar corte/reconexión, cambiar el color
de marca) — esas quedan exclusivas de `admin_acueducto`. Mismo ejercicio que 024 (M-2), pero
definiendo un rol nuevo en vez de acotar uno existente.

## 2. Por qué ahora

Mateo lo describió al revisar el rediseño del Panel principal (027): quiere separar, dentro del
mismo acueducto, a quien ve los balances (`admin_acueducto`, sin cambios) de quien hace el trabajo
administrativo sin ver esas cifras (`secretaria`, rol nuevo). Se acotó el alcance en conversación
antes de este spec (ver §3.3/§3.4): sí puede atender pagos individuales en el mostrador; no ejecuta
cortes ni reconexiones, solo los ve.

## 3. Alcance

### 3.1 Rol nuevo
`rol_usuario` gana el valor `secretaria`. `admin_acueducto` no cambia en nada — sigue viendo y
pudiendo hacer exactamente lo que hace hoy. `secretaria` es un rol **separado**, no una versión
acotada de `admin_acueducto`.

### 3.2 Matriz de acceso — qué ve y hace cada uno

| Pantalla / acción | `admin_acueducto` | `secretaria` |
|---|---|---|
| Panel principal (recaudo, cartera total, tendencia) | Ve todo (sin cambios) | **No** — mismo trato que hoy tiene el lector: no ve los indicadores |
| Suscriptores (listar, crear, editar, importar) | Sí | **Sí** — trabajo administrativo central |
| Lecturas (ver, cargar manual) | Sí | **Sí**, solo lectura de la lista/anomalías — "marcar revisada" sigue exclusivo de `admin_acueducto` (sin cambios en esa acción) |
| Facturación — ver/imprimir/enviar por correo una factura | Sí | **Sí** — es la tarea de mostrador ("deme mi factura") |
| Facturación — generar el cierre (simular/emitir masivo) | Sí (ya exclusivo desde M-2b/024) | **No** — sigue exclusivo de `admin_acueducto`, sin cambios |
| Facturación — anular una factura | Sí | **No** |
| Cartera / Pagos — ver quién debe qué, registrar un pago puntual | Sí | **Sí** — decidido con Mateo: es la tarea de mostrador más común |
| Pagos — anular un pago | Sí | **No** |
| Catálogo y tarifas — ver precios vigentes | Sí | **Sí**, solo lectura (para informarle un precio a un suscriptor) |
| Catálogo y tarifas — crear/versionar una tarifa | Sí | **No** |
| Cortes — ver candidatos a corte / historial | Sí | **Sí**, solo lectura — decidido con Mateo |
| Cortes — ejecutar corte o reconexión | Sí | **No** — decidido con Mateo |
| Notificaciones — ver historial de envíos | Sí | **Sí**, solo lectura |
| Configuración del acueducto (datos + color de marca) | Sí | **No** — ni ver ni editar; queda fuera del menú |

### 3.3 Interfaz
`secretaria` usa el mismo shell de escritorio (026, `SidebarPanel`/`TopbarPanel`) que
`admin_acueducto` — trabaja desde la oficina, no en campo (a diferencia del `lector`, que tiene su
propio shell móvil, AquaLectura, 025, sin cambios). La barra lateral oculta "Configuración" para
`secretaria` (§3.2). Dentro de cada pantalla compartida, los botones de acción exclusivos de
`admin_acueducto` (Anular, Ejecutar corte, Reconectar, Generar facturación) no se muestran para
`secretaria` — mismo criterio ya usado en 024/025 (ocultar lo que la API igual va a rechazar).

### 3.4 Fuera de alcance, acotado con Mateo antes de este spec
- Un Panel principal alternativo para `secretaria` (sin las cifras financieras, pero con algo
  distinto en su lugar) — por ahora ve el mismo trato que el lector: sin indicadores, sin panel de
  reemplazo. Si hace falta un "inicio" propio para `secretaria`, es una mejora futura.
- Ejecutar cortes/reconexiones — decidido explícitamente que no.
- Editar tarifas o la configuración del acueducto — sigue exclusivo de `admin_acueducto`.

## 4. Reglas de negocio que aplican

- Mismo criterio de CLAUDE.md §10 punto 23/24 usado para `lector`: un rol nuevo se acota por RLS en
  la base, no solo ocultando botones en la interfaz — la API tiene que rechazar la acción igual si
  se llama directo.
- CLAUDE.md §5.4: toda política nueva, con su test de aislamiento.

## 5. Criterios de aceptación

### CA-1 — `secretaria` no ve los indicadores financieros
Con sesión de `secretaria`, `GET /dashboard/indicadores` responde `403` (mismo criterio que hoy
para `lector`); `/app/dashboard` muestra el mismo estado que ve el lector hoy.

### CA-2 — `secretaria` gestiona suscriptores igual que `admin_acueducto`
Puede listar, crear, editar e importar suscriptores — verificado contra PostgreSQL real.

### CA-3 — `secretaria` registra un pago pero no lo anula
`POST /pagos` funciona con sesión de `secretaria`; `POST /pagos/:id/anular` responde `403`.

### CA-4 — `secretaria` ve candidatos a corte pero no ejecuta
`GET /cortes/candidatos` funciona; `POST /suscriptores/:id/corte` y
`POST /suscriptores/:id/reconexion` responden `403`.

### CA-5 — `secretaria` no anula facturas ni cierra el periodo
`POST /facturas/:id/anular` responde `403`; las 4 rutas de facturación por cola (M-2b, ya
exclusivas de `admin_acueducto`) siguen respondiendo `403` sin cambios.

### CA-6 — `secretaria` no toca tarifas ni configuración
Crear una tarifa nueva y `PATCH /acueducto/color` responden `403`.

### CA-7 — `admin_acueducto` no pierde nada
Regresión completa: con sesión de `admin_acueducto`, todo lo de la matriz (§3.2) sigue funcionando
exactamente igual que antes de esta feature.

### CA-8 — Aislamiento entre acueductos, sin cambios
`secretaria` de A no ve ni toca nada del acueducto B, en ninguna de las tablas tocadas.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Separar el permiso de "registrar pago" del de "anular pago" en la misma tabla (`pagos`) sin romper la función que ya existe (`registrarPago`/`anularPago`) | Se investiga en `/plan` exactamente cómo escribe cada función (INSERT directo vs. RPC) antes de tocar la política RLS, mismo rigor que 024 |
| Ocultar botones en el frontend sin bloquear la ruta real deja la puerta abierta a alguien que llame la API directo | Cada acción exclusiva de `admin_acueducto` se verifica también contra la API real con sesión de `secretaria`, no solo visualmente (CA-1 a CA-6) |
| `secretaria` sin Panel principal propio puede sentirse una regresión de experiencia, no solo de permisos | Documentado como fuera de alcance a propósito (§3.4); queda anotado para una mejora futura si Mateo lo pide |

## 7. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] Tests en verde
- [ ] Migración versionada + test de aislamiento nuevo
- [ ] `docs/PLAN-PRODUCCION.md` actualizado (esta feature cierra el pendiente de "rol secretaria")
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
