# SPEC — 044: configuracion-acueducto-vista

**Estado:** Borrador para aprobación
**Depende de:** 023-personalizacion-factura, 026-shell-panel-admin

## 1. Objetivo

Re-vestir `/app/configuracion` con el sistema visual de 026. Última de las 15 pantallas originales
del rediseño (orden definido por Mateo). Confirmado que **no estaba re-vestida todavía** (usaba
`text-2xl font-semibold` y sin `page-head`, a diferencia de las pantallas ya hechas) — quedaba
pendiente de auditar, ya está auditada: falta.

## 2. Por qué ahora

Mateo definió el orden del resto del rediseño (Sesión 056): Configuración es la sexta y última de
las 15 pantallas originales, después de Notificaciones (043).

## 3. Alcance

### 3.1 `page-head` + `grid` de 2 columnas — sigue de cerca la propuesta
La propuesta (`id="configuracion"`) usa exactamente el layout que esta pantalla ya tiene
funcionalmente: una tarjeta de formulario a la izquierda, una vista previa en vivo a la derecha
(`settings-preview`, `grid-template-columns: .9fr 1.1fr`). Se adopta ese grid tal cual — es la
pantalla con la correspondencia más directa a la propuesta de todo el rediseño, junto con el
Catálogo (041).

### 3.2 Datos del acueducto — sin cambios de contenido
La tarjeta de solo lectura (nombre, NIT, municipio, teléfono, dirección) se mantiene igual, con los
tokens de 026.

### 3.3 Color de acento — sin cambios de comportamiento
El selector de color, el guardado, la vista previa en vivo del encabezado/TOTAL de factura — igual
que hoy. Solo cambia el contenedor visual.

## 4. Fuera de alcance

- **Editar nombre/NIT/municipio/teléfono/dirección** — la propia pantalla ya dice "para cambiarlos,
  contacte a soporte"; no es un hueco de este rediseño, es una decisión de producto ya tomada
  (023) que este spec no revisa.
- **Cualquier cambio a `actualizarColorAcentoAcueducto()`** o a la lógica de vista previa.

## 5. Reglas de negocio que aplican

- Ninguna regla de dominio nueva — pantalla de configuración de marca, sin dinero ni datos de
  suscriptores de por medio.

## 6. Criterios de aceptación

### CA-1 — Los datos del acueducto se muestran correctamente
Nombre, NIT, municipio, teléfono, dirección — mismos valores que hoy, con "—" cuando son `null`.

### CA-2 — Guardar un color nuevo sigue funcionando igual
Mismo comportamiento, mismo mensaje de error si el rol no es `admin_acueducto` (403) o el color es
inválido.

### CA-3 — La vista previa en vivo sigue reflejando el color elegido
Cambiar el color actualiza la vista previa sin guardar todavía (comportamiento ya existente).

## 7. Riesgos

Ninguno relevante — pantalla chica, sin dinero ni datos sensibles, sin cambios de comportamiento.

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` sin hallazgos nuevos
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
