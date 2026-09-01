# DECISIONES.md — Registro de decisiones del proyecto

Cada decisión tiene: contexto, opciones evaluadas, decisión tomada y razón.
Las decisiones con código **D-N** están referenciadas en otros documentos.

---

## D-1 — `limite_basico_m3` es INCLUSIVO
**Fecha:** 2026-08-31 | **Tomada por:** Mateo Castro

Con límite 22 m³ y consumo 25 m³: los primeros 22 m³ van a precio básico, solo el
excedente (3 m³) va a precio no básico. Ver `ESPECIFICACION-FUNCIONAL.md §2.4`.

---

## D-2 — Suscriptores NO van en `auth.users`
**Fecha:** 2026-08-31 | **Tomada por:** Mateo Castro

El portal del suscriptor no usa Supabase Auth. Valida `numero_documento` +
`codigo_suscriptor` en el servidor (Cloudflare Worker) y emite una sesión propia
firmada con `SESSION_SECRET`. Ver `ESPECIFICACION-FUNCIONAL.md §2.5` e
`INFRAESTRUCTURA.md §10`.

**Justificación económica reforzada (2026-08-31):** con miles de suscriptores por
acueducto, crear una cuenta de identidad por cada uno infla innecesariamente el
sistema de autenticación sin aportar valor — el login no usa contraseña.

---

## D-3 — Formato del número de factura
**Fecha:** 2026-08-31 | **Tomada por:** recomendación técnica aceptada

Formato: `{prefijo}-{YYYY}-{NNNNN}`, consecutivo anual de 5 dígitos que reinicia
cada 1 de enero. Ciclo y reconexión comparten el consecutivo pero usan prefijos
distintos (`FAC` / `REC`). Detalle completo en `ESPECIFICACION-FUNCIONAL.md §2.9`
y `CLAUDE.md §9`.

---

## D-4 — Sesión del portal del suscriptor
**Fecha:** 2026-08-31 | **Tomada por:** recomendación técnica aceptada

Duración: 30 días con renovación automática si quedan menos de 7 días de vida.
Cookie `HttpOnly + Secure + SameSite=Lax`. El JWT lleva `tipo: "suscriptor"` para
distinguirlo de la sesión administrativa. Detalle completo en
`ESPECIFICACION-FUNCIONAL.md §2.5` y `CLAUDE.md §9`.

---

## D-5 — Tarifas de referencia (pendiente de verificación real)
**Fecha:** 2026-08-31 | **Estado:** ⚠️ Provisional

Se usaron tarifas aproximadas de Soacha para construir los primeros casos de
prueba. **Pendiente:** Mateo debe entregar las tarifas reales verificadas contra
la resolución tarifaria vigente antes de construir `docs/CASOS-DORADOS.md`
definitivo.

---

## D-6 — Arquitectura sin VPS: Cloudflare + Supabase
**Fecha:** 2026-08-31 | **Tomada por:** Mateo Castro, con análisis técnico

### Contexto
UndreoCol es una aplicación liviana (CRUD con cálculos aritméticos, sin IA, sin
procesamiento pesado de imágenes o video). Se evaluó si esa característica
justifica un servidor propio (VPS) o una arquitectura completamente gestionada.

### Opciones evaluadas

| Opción | Costo inicial | Esfuerzo operativo | Descartada por |
|---|---|---|---|
| VPS (Hetzner) | ~$5-10/mes desde el día 1 | Alto: SO, SSL, backups, updates | Pago sin ingresos aún; investigado a fondo pero fricción de pago desde Colombia |
| VPS (Hostinger) | ~$5/mes desde el día 1 | Alto: igual que arriba | Pago sin ingresos; sigue exigiendo administración de servidor |
| VPS (LightNode Bogotá) | ~$7.71/mes desde el día 1 | Alto | Hardware antiguo, empresa en Hong Kong (ambigüedad legal Ley 1581), soporte solo en inglés |
| Cloudflare Workers + Cloudflare D1 | $0 → $5/mes | Bajo | D1 es SQLite, no PostgreSQL — insuficiente para el modelo de datos multi-tenant complejo del sistema |
| **Cloudflare Workers + Supabase PostgreSQL** | **$0 → $5/mes** | **Bajo** | **Elegida** |

### Decisión

Arquitectura sin servidor propio:

```
Frontend  → Next.js → Cloudflare Pages
API       → Hono.js → Cloudflare Workers
Datos     → Supabase PostgreSQL + RLS
Archivos  → Cloudflare R2
Procesos  → Cloudflare Queues
```

### Razón

1. **Costo $0 hasta el primer cliente.** El tiempo entre iniciar el desarrollo y
   cerrar el primer cliente puede ser de 6 a 18 meses. Un VPS costaría ese tiempo
   sin generar ingresos.
2. **Cero administración de servidor.** Sin sistema operativo que actualizar, sin
   certificados que renovar manualmente, sin vigilancia de uptime propia.
3. **Escala sin reconstruir.** El mismo código corre con 1 acueducto o con 500 —
   Cloudflare escala automáticamente.
4. **PostgreSQL real, no un motor limitado.** Se mantiene el modelo relacional
   completo con RLS nativo para el aislamiento multi-tenant, en vez de forzar el
   sistema a la simplicidad de D1 (SQLite).
5. **Portabilidad conservada.** PostgreSQL estándar y Hono.js sobre Fetch API
   significan que ninguna pieza crítica depende de una API irremplazable. Ver
   `INFRAESTRUCTURA.md §12`.

---

## D-7 — Supabase Free explotado al máximo antes de pagar Pro
**Fecha:** 2026-08-31 | **Tomada por:** Mateo Castro

### Contexto
Supabase Pro cuesta $25/mes. Con un solo cliente pequeño-mediano, ese costo puede
representar una fracción significativa del ingreso mensual. Se evaluó si es
necesario pagarlo desde el inicio de producción o si el plan Free, reforzado con
configuración propia, puede sostener la operación real durante un periodo largo.

### El problema del plan Free y su solución

| Limitación del Free | Mitigación aplicada |
|---|---|
| Pausa tras 7 días de inactividad | Worker de keepalive con ping diario real (`INFRAESTRUCTURA.md §5`) |
| Sin backups automáticos | Backup diario propio vía GitHub Actions + R2 (`INFRAESTRUCTURA.md §6`) |
| Límite de 500 MB | Monitoreo proactivo con alertas en 300/400/480 MB (`INFRAESTRUCTURA.md §8`) |

### Proyección de crecimiento

Con el modelo de datos de UndreoCol (sin fotos por defecto — ver D-8), un
acueducto de ~1.000 suscriptores genera aproximadamente 30-50 MB de datos por año
de operación completa (lecturas, facturas, pagos, auditoría). A ese ritmo, **el
límite de 500 MB no se alcanza en varios años de operación con un solo cliente de
ese tamaño.**

### Decisión

Operar en Supabase Free desde el primer cliente, con las tres mitigaciones
implementadas desde la Fase 1 del roadmap, no como una mejora futura. Subir a
Supabase Pro solo cuando se cumpla el disparador documentado en
`ARQUITECTURA.md §6` (base de datos > 400 MB, o necesidad real de backup
gestionado con SLA — por ejemplo, al incorporar clientes institucionales que lo
exijan contractualmente).

### Riesgo aceptado y su límite

Sin Supabase Pro no hay SLA de disponibilidad garantizado por contrato. Este
riesgo se acepta explícitamente para la etapa de 1 cliente, y se reevalúa en
cuanto se firme un segundo cliente o el primero pida garantías contractuales de
disponibilidad.

---

## D-8 — Entrega de factura: impresión como flujo principal, correo como secundario
**Fecha:** 2026-08-31 | **Tomada por:** Mateo Castro

### Contexto
El diseño original asumía generación de PDF (`pdfme`) como parte central del
cierre de facturación. Mateo señaló que, en la práctica del sector, la mayoría de
acueductos entregan la factura **impresa en papel**, no por correo electrónico.

### Decisión

1. **Flujo principal: impresión desde el navegador.** El admin ve el listado de
   facturas del periodo en pantalla y las imprime con una hoja de estilos
   `@media print`, sin generación de PDF ni librería adicional. Costo: $0.
2. **Flujo secundario: correo electrónico**, para suscriptores con email
   registrado que lo soliciten o para acueductos con ese hábito. Usa Cloudflare
   Email Service (D-9 documenta el método de generación del PDF adjunto).

### Impacto en la arquitectura

- Se elimina `pdfme` del flujo crítico del cierre de facturación.
- El cierre de facturación en `Cloudflare Queues` calcula y registra cada
  factura, pero **no genera PDF por defecto** — solo cuando el correo se
  solicita explícitamente.
- Esto reduce el consumo de CPU en Workers durante el cierre masivo, ya que la
  generación de PDF (aunque liviana) se evita en el caso común.

---

## D-9 — Generación de PDF para correo: `pdf-lib`, no `pdfme`
**Fecha:** 2026-08-31 | **Tomada por:** recomendación técnica, en consecuencia de D-8

### Contexto
Con D-8, el PDF pasa de ser el artefacto principal a un adjunto opcional de
correo. Se evaluó si mantener `pdfme` (editor visual de plantillas) sigue
siendo la mejor opción para este caso de uso reducido, dentro de las
restricciones de Cloudflare Workers (128 MB de memoria, límite de CPU por
invocación).

### Opciones evaluadas

| Opción | Resultado |
|---|---|
| `pdfme` completo (con su editor) | Bundle más pesado; el editor visual no aporta valor si el PDF ya no es el artefacto central |
| **`pdf-lib`** | Base de `pdfme`, puro JavaScript, sin dependencias nativas, corre en Workers con 1-4ms de CPU y bundle de ~4MB |
| Cloudflare Browser Rendering (Chromium) | Fidelidad total de CSS, pero es un servicio aparte con costo por minuto — desproporcionado para un adjunto ocasional |

### Decisión

Usar `pdf-lib` directamente para el PDF adjunto de correo, sin la capa de editor
visual de `pdfme`. La plantilla de factura se define programáticamente
(posiciones de texto, tablas del desglose) en `backend/src/lib/factura-pdf.ts`.

### Razón

- Corre dentro de los límites de memoria y CPU de Cloudflare Workers sin
  necesidad de un servicio externo de renderizado.
- Es la opción de menor huella y menor costo para un flujo de uso ocasional
  (D-8), evitando pagar por un servicio de renderizado de navegador que se
  usaría con poca frecuencia.
- Si en el futuro se necesita una plantilla visual editable por el
  administrador del acueducto (personalización de logo, colores), se puede
  reincorporar `pdfme` como mejora, sin bloquear el lanzamiento inicial.