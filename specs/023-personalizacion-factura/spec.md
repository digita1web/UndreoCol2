# SPEC — 023: personalizacion-factura

**Estado:** Borrador para aprobación
**Depende de:** 006-impresion-y-correo-factura, 018-panel-plataforma

## 1. Objetivo

Dar identidad visual propia a cada acueducto en su factura: un color de acento configurable
(reemplaza el azul fijo que hoy usa `backend/src/lib/factura-pdf.ts` para todos), y cerrar de paso
un hueco encontrado al revisar esta feature — la vista de impresión en pantalla
(`/app/facturacion/[facturaId]`, el flujo **principal** según D-8) nunca mostró el encabezado del
acueducto (logo, nombre, NIT, dirección, teléfono) que el spec 006 sí describía. Sin ese
encabezado, un color de acento no tiene mucho a qué aplicarse — se resuelven juntos.

## 2. Por qué ahora

Nace de una pregunta directa de Mateo sobre personalización de la factura, no de un hallazgo de
auditoría ni del roadmap original. Al revisar el alcance real se encontró que 006 quedó
incompleto en un punto (el encabezado del acueducto en la vista imprimible) y que hoy no existe
ninguna pantalla de admin para editar datos del acueducto — `clientes.nombre/nit/logo_url/etc.` se
fijan una sola vez en el alta (018, `crear_acueducto_base`) y no se pueden tocar después. Esta
feature abre esa puerta, acotada al mínimo necesario (solo el color).

## 3. Alcance

### 3.1 Columna nueva: color de acento por acueducto
- `clientes` gana un campo de color de acento (texto, formato hexadecimal `#RRGGBB`), con un valor
  por defecto igual al azul que se usa hoy (`#14408C` — conversión exacta del `rgb(0.08, 0.25,
  0.55)` actual de `factura-pdf.ts`), de forma que ningún acueducto existente cambia de apariencia
  al desplegar esta feature.
- Formato inválido (no hexadecimal, con o sin `#`, longitud incorrecta) se rechaza con un mensaje
  claro — nunca se guarda un valor que rompa la generación del PDF.

### 3.2 Encabezado del acueducto en la vista de impresión (cierra el hueco de 006)
- `/app/facturacion/[facturaId]` (flujo principal, D-8) muestra el mismo encabezado que ya arma el
  PDF: logo (si `logo_url` tiene uno), nombre, NIT, municipio, teléfono, dirección — con el color de
  acento aplicado al nombre del acueducto y al monto TOTAL, igual que en el PDF.
- El resto de la vista (botones, historial de pagos, formulario) no cambia de color — el acento es
  puntual, no un rediseño completo.

### 3.3 Pantalla de configuración del acueducto (nueva, mínima)
- Pantalla nueva en el panel admin, accesible solo para `admin_acueducto`/`administrador` de ESE
  acueducto (el `lector` no la ve ni puede llamarla — CLAUDE.md §10 punto 24).
- Muestra de solo lectura los datos actuales del acueducto (nombre, NIT, dirección, teléfono,
  municipio, logo) para que el admin vea qué va a aparecer en su factura.
- El único campo editable es el color de acento: un selector de color con vista previa en vivo del
  encabezado (mismo layout que la factura) antes de guardar.
- Guardar aplica de inmediato a la vista de impresión (siempre calcula con el color vigente) y a
  **los PDF que se generen de ahí en adelante** — ver 3.4 sobre los ya generados.

### 3.4 PDF ya generado: no se repinta retroactivamente
- El PDF del adjunto de correo se genera una sola vez y se cachea en R2 (006). Si el acueducto
  cambia su color después, las facturas cuyo PDF ya se generó **conservan el color con el que se
  generaron** — coherente con la inmutabilidad de la factura (CLAUDE.md §5.6 y §10 punto 9d: lo que
  el suscriptor ya recibió no cambia solo). Las facturas sin PDF generado todavía usan el color
  vigente al momento de generarlo.
- La vista de impresión en pantalla, en cambio, siempre usa el color **vigente** (se recalcula en
  cada carga) — es la diferencia esperada entre un documento ya enviado y una vista en vivo.

## 4. Fuera de alcance

- Editar nombre, NIT, dirección, teléfono, municipio o logo desde esta pantalla — quedan de solo
  lectura por ahora; subir/cambiar el logo sigue siendo un proceso manual fuera de la aplicación.
  Ampliar la pantalla a edición completa es una feature futura, del mismo modo que 019 quedó aparte
  de 018.
- Más de un color por acueducto (paleta, temas, tipografía) — un único color de acento.
- Fondo de página completo de color — evaluado y descartado en conversación con Mateo: consume
  mucha más tinta en el flujo principal de impresión (D-8) que un acento puntual.
- Editor visual de plantilla (posiciones, layout) — sigue fuera de alcance por D-9, sin cambios.
- Regenerar de oficio los PDF ya cacheados en R2 cuando cambia el color (ver 3.4) — si Mateo pide
  esto más adelante, es una feature aparte (forzar invalidación de caché).

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 punto 13 (cambio de categoría del suscriptor no altera facturas históricas,
  `snapshot_suscriptor`) — mismo principio aplicado aquí al color: una factura ya generada no se
  altera retroactivamente.
- CLAUDE.md §10 punto 23/24 (el `lector` no ve ni gestiona lo que no le corresponde) — la pantalla
  y la ruta de guardar el color son exclusivas de `admin_acueducto`/`administrador`.
- CLAUDE.md §5.4 (RLS `FORCE`, toda tabla nueva o política nueva con su test de aislamiento) — el
  admin de un acueducto no debe poder tocar el color de OTRO acueducto, ni ningún otro campo de
  `clientes` (plan, estado de cuenta, slug) a través de esta misma vía. Esto exige una política RLS
  de `UPDATE` nueva, acotada, y probarla contra ambos límites (otro acueducto, otras columnas).
- D-9 (`docs/DECISIONES.md`) — el color se aplica dentro de la plantilla programática existente de
  `pdf-lib`; no se introduce ningún editor visual ni motor de plantillas nuevo.

## 6. Criterios de aceptación

Cada uno cerrado con evidencia ejecutada y pegada.

### CA-1 — Compatibilidad: acueducto sin color configurado
Un acueducto existente (sin tocar su fila) genera un PDF y una vista de impresión visualmente
idénticos a los de antes de esta feature (mismo azul).

### CA-2 — Cambiar el color se refleja en la vista de impresión
El admin cambia el color en la pantalla de configuración; recargar `/app/facturacion/[facturaId]`
de una factura (nueva o vieja) muestra el nombre del acueducto y el TOTAL con el color nuevo.

### CA-3 — El PDF ya generado no cambia
Una factura cuyo PDF ya se descargó una vez (y quedó cacheado en R2) conserva su color original
después de que el acueducto cambia su color de acento; una factura sin PDF generado usa el color
nuevo la primera vez que se genera.

### CA-4 — Validación de formato
Guardar un valor que no es un color hexadecimal válido se rechaza con un mensaje claro, tanto si se
intenta desde la pantalla (validación de UI) como directo contra la API (validación de servidor —
la de UI nunca es la única línea de defensa).

### CA-5 — Aislamiento entre acueductos (test de aislamiento nuevo)
El admin del acueducto A no puede cambiar el color del acueducto B — ni desde la pantalla (no lo ve
como opción) ni llamando la ruta directo con el `cliente_id` de B. Verificado contra PostgreSQL
real, no solo por RLS "de lectura del código".

### CA-6 — Ningún otro campo de `clientes` queda expuesto por esta vía
Intentar cambiar `plan_id`, `estado_cuenta`, `slug` o `fecha_vencimiento` a través de la misma ruta
de guardar color falla (columna no otorgada o ignorada), incluso siendo admin del propio acueducto.

### CA-7 — El `lector` no tiene acceso
Con sesión de `lector`, la pantalla de configuración no aparece en la navegación y la ruta
responde 403 si se llama directo.

### CA-8 — Encabezado nuevo en la vista de impresión
`/app/facturacion/[facturaId]` de un acueducto con logo y datos completos muestra el mismo
encabezado que ya arma el PDF (logo, nombre, NIT, municipio, teléfono, dirección) — cierra el hueco
de 006.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| RLS de `UPDATE` en `clientes` demasiado amplia expone campos sensibles (plan, estado de cuenta) a un admin de acueducto | Restricción a nivel de columna (no solo de fila), probada explícitamente en CA-6 |
| Color hexadecimal inválido rompe `rgb()` de `pdf-lib` y tumba la generación del PDF | Validación en la API antes de guardar (CA-4); `factura-pdf.ts` nunca confía en un valor sin validar |
| Confusión entre "color de la factura ya enviada" y "color vigente" para el mismo acueducto | Documentado como comportamiento esperado (3.4, CA-3), no un bug a corregir |
| El logo (`logo_url`) de un acueducto sin logo real rompe el encabezado nuevo en la vista de impresión | Reusar exactamente la misma función tolerante a fallos que ya usa el PDF (`cargarLogo`, nunca rompe si la URL falla) |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] Tests en verde (unitarios de `core/`/`lib/` + los nuevos)
- [ ] Test de aislamiento de la política RLS nueva sobre `clientes` (CA-5/CA-6)
- [ ] CHANGELOG.md actualizado
- [ ] Aprobación de Mateo
