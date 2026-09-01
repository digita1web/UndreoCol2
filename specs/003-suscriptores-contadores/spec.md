# SPEC — 003: suscriptores-contadores

**Estado:** Borrador para aprobación
**Depende de:** 002-catalogo-y-tarifas (categoría tarifaria del suscriptor referencia
`categoria_tarifaria`; 001-fundacion (tabla mínima `usuarios_servicio`, RLS))

## 1. Objetivo

Llevar `usuarios_servicio` de la versión mínima de 001 (solo para el test de aislamiento) a un
registro completo de suscriptor, y dar de alta el contador físico asociado a cada uno —
incluyendo el reemplazo de contador a mitad de periodo. Es el prerrequisito de 004-lecturas: no
se puede tomar una lectura sin un suscriptor con un contador activo.

## 2. Por qué ahora

Según el roadmap (`.specify/config.md`), 003 depende de 002 (ya cerrada) y 004-lecturas-y-consumo
depende de 003. `usuarios_servicio` existe desde 001 solo como tabla mínima para el test de
aislamiento (sin `categoria`, sin `contador_actual_id`, sin datos de contacto) — hay que
completarla antes de poder registrar un suscriptor real.

## 3. Alcance

### 3.1 Suscriptor completo (`usuarios_servicio`)
- Amplía la tabla existente de 001 (no la recrea) con las columnas de
  `docs/esquema-propuesto.sql §7`: `tipo_documento`, `numero_documento`, `telefono`, `email`,
  `direccion`, `sector`, `categoria` (`categoria_tarifaria`, de 002), `contador_actual_id`,
  `fecha_vinculacion`, `notas`.
- CRUD desde el panel admin: crear, editar, cambiar estado (`activo`/`suspendido`/`inactivo`;
  `cortado` es de la feature 009-cortes-reconexiones, se deja el valor del enum pero sin flujo
  propio en 003).
- Al crear un suscriptor, la categoría elegida se valida contra la matriz de tarifas de 002
  (`GET /catalogo/matriz-tarifas`): si el acueducto no tiene ningún servicio con tarifa vigente
  para esa categoría, se advierte en la UI pero **no se bloquea la creación** — la regla dura de
  "sin tarifa configurada no se emite factura" es del cierre de facturación (005, CLAUDE.md §10
  punto 9d), no de este formulario.

### 3.2 Contador
- Tabla nueva `contadores` (`docs/esquema-propuesto.sql §7`): serial, marca, capacidad máxima
  (define el techo de rollover), lectura inicial, fecha de instalación, estado
  (`activo`/`danado`/`reemplazado`).
- **Un solo contador activo por suscriptor** — índice único parcial
  (`usuario_servicio_id where estado = 'activo'`).
- Alta del primer contador de un suscriptor nuevo (mismo formulario o inmediatamente después).

### 3.3 Reemplazo de contador a mitad de periodo
- Tabla nueva `reemplazos_contador`: contador anterior, contador nuevo, fecha, lectura final del
  saliente, lectura inicial del entrante, motivo.
- Acción atómica: marca el contador anterior `reemplazado`, crea el contador nuevo como `activo`,
  actualiza `usuarios_servicio.contador_actual_id`, e inserta el registro de reemplazo — todo en
  una función de base de datos (mismo patrón que `crear_tenant_con_admin()`/
  `crear_tarifa_version()`), nunca como varios pasos sueltos desde el Worker.
- 003 solo **registra** el reemplazo. El cálculo de consumo que combina las lecturas de ambos
  contadores (CLAUDE.md §10 punto 7) es de 004-lecturas-y-consumo — aquí no se calcula nada, solo
  se deja la referencia para que 004 la use.

### 3.4 Frontend admin
- `/app/suscriptores`: lista (filtrable por estado), alta.
- `/app/suscriptores/[id]`: detalle, edición, contador activo, historial de reemplazos, acción de
  reemplazar contador.

## 4. Fuera de alcance

- **Lecturas, consumo, rollover** (cálculo) — feature 004. 003 solo dispone los datos que 004
  necesita (`capacidad_maxima`, historial de reemplazos).
- **Periodos de facturación y facturas** — 004/005.
- **Sesión del portal del suscriptor (D-2/D-4), login sin contraseña** — feature 008
  (`portal-suscriptor`), depende de 006, no de 003. El suscriptor de 003 es un registro
  administrativo, no un actor con sesión propia todavía.
- **Escaneo de QR para identificar el contador** — feature 014 (`pwa-lector-qr`).
- **Cortes y reconexión** — feature 009. El estado `cortado` del enum existe desde 001 pero 003 no
  implementa ningún flujo que lo asigne.
- **Regenerar `codigo_suscriptor` desde el panel** (mencionado en
  `ESPECIFICACION-FUNCIONAL.md §2.5` como necesidad del portal) — no tiene sentido antes de que
  exista el portal (008); se deja para esa feature.

## 5. Reglas de negocio que aplican

De `CLAUDE.md §10`:
- **Lecturas y consumo, puntos 1 y 7** (rollover, reemplazo de contador): 003 deja la estructura
  de datos correcta (`capacidad_maxima`, `reemplazos_contador`) para que 004 los use; no
  implementa el cálculo.
- **Permisos, punto 24**: el lector "solo crea/ve lecturas y ejecuta órdenes asignadas a él" — no
  aplica todavía en 003 (no hay lecturas ni órdenes), pero las políticas RLS de `contadores` y
  `reemplazos_contador` siguen el mismo patrón de acceso que `usuarios_servicio` (lectura para
  cualquier miembro del cliente, escritura solo `admin_acueducto`) hasta que 004 lo revise.

De `docs/ESPECIFICACION-FUNCIONAL.md §2.5/§2.6`: atributos del suscriptor y del contador, estados,
"un suscriptor tiene un solo contador activo a la vez".

De `CLAUDE.md §5.4`: `contadores` y `reemplazos_contador` llevan `cliente_id` y RLS `FORCE`; test
de aislamiento en la misma tarea que crea cada tabla.

## 6. Criterios de aceptación

### CA-1 — Migración: `usuarios_servicio` ampliada + `contadores` + `reemplazos_contador`
Migración altera `usuarios_servicio` (agrega columnas, nunca recrea la tabla — preserva los datos
de fixtures existentes) y crea `contadores`/`reemplazos_contador` con RLS `FORCE`, el índice único
parcial de contador activo, y la función `reemplazar_contador()`. Verificado contra Postgres real
(mismo mecanismo de 002: shim de compatibilidad si no hay Docker) + `\d` de las 3 tablas.

### CA-2 — Test de aislamiento
El acueducto A no lee/escribe suscriptores, contadores ni reemplazos del acueducto B. Cubre
explícitamente: un `usuario_servicio_id` de B adivinado en `reemplazar_contador()` falla; el
índice único de contador activo rechaza un segundo contador activo para el mismo suscriptor
incluso intentado por dos vías distintas (INSERT directo bloqueado por RLS/constraint, y
`reemplazar_contador()`).

### CA-3 — API: CRUD de suscriptores (Hono)
`GET/POST /suscriptores`, `GET/PATCH /suscriptores/:id`. Verificado con peticiones HTTP reales
contra `wrangler dev` cuando el entorno lo permita; si no, `tsc --noEmit` + `eslint` limpios y
"NO VERIFICADO" documentado con los pasos exactos (mismo patrón que 002 en este contenedor).

### CA-4 — API: contador y reemplazo (Hono)
`POST /suscriptores/:id/contador` (alta del primer contador), `POST /suscriptores/:id/reemplazar-contador`
(llama `reemplazar_contador()`). Verificación igual que CA-3.

### CA-5 — Un solo contador activo por suscriptor, incluso con reemplazo
Test que intenta forzar dos contadores activos para el mismo suscriptor (por INSERT directo y por
llamar `reemplazar_contador()` dos veces seguidas) y confirma que en ningún caso quedan dos.

### CA-6 — Frontend: paneles de suscriptores
`/app/suscriptores` y `/app/suscriptores/[id]` protegidos por el middleware existente. `npm run
build`/`npm run lint` limpios; flujo en navegador real "NO VERIFICADO" si el entorno no lo permite,
con los pasos exactos.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Alterar `usuarios_servicio` en vez de recrearla puede chocar con datos de los fixtures de 001/002 si algún nombre de columna nuevo colisiona | CA-1 corre contra los fixtures existentes de 001 y confirma que siguen intactos tras la migración |
| `reemplazar_contador()` en varios pasos no atómicos dejaría a un suscriptor sin contador activo momentáneamente, o con dos | Función de base de datos única, mismo patrón `SELECT FOR UPDATE` que 002; CA-5 lo testea explícitamente |
| Bloquear la creación de un suscriptor sin tarifa configurada duplicaría la regla que ya vive en el cierre de facturación (005) y podría desincronizarse de ella | 003 solo advierte en la UI, nunca bloquea — la única fuente de verdad del bloqueo es `tarifa_vigente()` en el cierre (CLAUDE.md §10 punto 9d) |

## 8. Definición de terminado

- [ ] Todos los CA (1–6) con evidencia
- [ ] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios
- [ ] Tests en verde (aislamiento de las 3 tablas)
- [ ] Test de aislamiento de `usuarios_servicio` ampliada, `contadores` y `reemplazos_contador`
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
