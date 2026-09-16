# SPEC — 041: catalogo-tarifas

**Estado:** Aprobado (2026-09-16) — implementado Sesión 056
**Depende de:** 002-catalogo-y-tarifas, 026-shell-panel-admin, 029-autorizacion-tarifas-secretaria,
040-suscriptores-lista-ficha-importar (mismo patrón de tabla/`Badge`)

## 1. Objetivo

Re-vestir `/app/catalogo` (lista de servicios) y `/app/catalogo/[servicioId]` (historial de tarifas
+ autorización de `secretaria`) con el sistema visual de 026. Tercera de las pantallas que quedaban
(orden definido por Mateo, Sesión 056). **Puramente visual esta vez** — a diferencia de 040, no se
encontró ningún hueco de funcionalidad real al revisar estas dos pantallas.

## 2. Por qué ahora

Mateo definió el orden del resto del rediseño (Sesión 056): Catálogo es la tercera, después de
Lecturas (039) y Suscriptores (040).

## 3. Alcance

### 3.1 Lista de servicios (`/app/catalogo`) — sigue de cerca la propuesta
`page-head` (eyebrow "Configuración comercial", igual que la propuesta). Grid de tarjetas por
servicio — nombre, tipo de cálculo ("Por consumo"/"Fijo"), `Badge` de `activo`
(`true`→`success` "Vigente", `false`→`gray` "Inactivo"), botón "Activar"/"Desactivar" (ya existe,
mismo comportamiento) y enlace "Ver historial" a la pantalla de detalle. "Nuevo servicio"
(`ServicioForm`, ya usa `Input`/`Label`/`Button`) se mantiene tal cual.

**Corrección respecto al patrón real, verificada antes de escribir el plan:** esta pantalla hoy usa
el componente `Button` de `components/ui/` (a diferencia de 030/032/039/040, que usan
`<button>`/clases de Tailwind sueltas) — se homologa al patrón real de las pantallas ya re-vestidas
(`<button>` con clases), no se mantiene la inconsistencia previa al rediseño.

### 3.2 Historial de tarifas (`/app/catalogo/[servicioId]`) — sin equivalente en la propuesta, mismos
tokens
La propuesta no tiene una pantalla de detalle de servicio — se aplican los tokens/`Card`/`Badge` de
026 sin una referencia 1:1, mismo caso que la ficha de suscriptor (040 §3.2). Cambio real, no solo
de color: cada fila de tarifa gana un `Badge` — `vigencia_hasta === null` → `success` "Vigente",
con fecha de fin → `gray` "Histórica". Es información real que hoy solo se infiere leyendo la fecha
("vigente" en texto plano); con `Badge` es instantáneo de ver, sin cambiar el dato que muestra.

### 3.3 Autorización de `secretaria` — re-vestido, sin tocar el flujo
Las dos tarjetas condicionales por rol (`admin_acueducto` crea/revoca autorizaciones,
`secretaria` las aplica) pasan a los tokens de 026 — mismos campos, mismas condiciones de rol,
mismo comportamiento. Las autorizaciones vigentes de la categoría seleccionada ganan `Badge` `info`
("Autorización vigente") en vez de la fila sin marcar que muestran hoy.

## 4. Fuera de alcance

- **Cualquier cambio a las reglas de tarifas** (versionado, inmutabilidad, `limite_basico_m3`
  inclusivo) — CLAUDE.md §10 puntos 0-0d, `core/tarifas.ts` no se toca, esto es 100% presentación.
- **Cualquier cambio al flujo de autorización de `secretaria`** (029) — mismas condiciones,
  mismo formulario, solo el contenedor visual cambia.
- **Editar un servicio existente** (nombre, código, tipo de cálculo) — no existe hoy
  (`actualizarServicio()` solo cambia `activo`), no se agrega; mismo criterio de no inventar alcance
  que 040 aplicó con cuidado a lo que sí correspondía agregar.

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 punto 0/0b: las tarifas se versionan, nunca se editan — el historial que muestra
  esta pantalla es exactamente eso, una lista inmutable; el `Badge` de vigente/histórica es
  presentación, no cambia qué fila es cuál.
- CLAUDE.md §10 punto 0d: una tarifa con facturas emitidas nunca se elimina — esta pantalla no tiene
  ningún botón de borrar tarifas, no se agrega uno.

## 6. Criterios de aceptación

### CA-1 — El `Badge` de servicio activo/inactivo es correcto
`activo: true` → `Badge` `success` "Vigente"; `activo: false` → `Badge` `gray` "Inactivo".

### CA-2 — El `Badge` de vigencia de tarifa es correcto
Una tarifa con `vigencia_hasta: null` → `Badge` `success` "Vigente"; con fecha → `Badge` `gray`
"Histórica". Con una tarifa recién creada (cierra la anterior automáticamente, regla 0), la anterior
pasa a "Histórica" sin recargar la página a mano.

### CA-3 — Activar/Desactivar un servicio sigue funcionando igual
Mismo comportamiento, mismo mensaje de error si falla.

### CA-4 — El flujo de autorización de `secretaria` no cambia de comportamiento
Con sesión de `admin_acueducto`: crear y revocar una autorización real, mismo resultado que antes
del re-vestido. Con sesión de `secretaria`: aplicar una tarifa con una autorización vigente, mismo
resultado.

### CA-5 — "Nueva tarifa" (admin directo) sigue funcionando igual
Crear una tarifa real como `admin_acueducto` sin autorización de por medio — mismo comportamiento.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Es la pantalla más sensible del rediseño hasta ahora (dinero, versionado inmutable) — un error de re-vestido que rompa el flujo de creación de tarifas tendría impacto real | Cero cambios a `TarifaForm`, `core/tarifas.ts` ni a las funciones de `lib/api.ts` que ya existen — solo el contenedor visual, verificado con los mismos CA de comportamiento (CA-3/CA-4/CA-5) antes de cerrar |
| El `Badge` "Histórica" podría malinterpretarse como "ya no válida para nada" cuando en realidad `factura_detalles.tarifa_id` sigue referenciándola permanentemente (regla 0d) | La etiqueta dice "Histórica", no "Inválida" ni "Borrada" — coherente con que sigue existiendo y sigue siendo la tarifa real de facturas viejas |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` sin hallazgos nuevos
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de `admin_acueducto` y de
      `secretaria` (CA-4)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
