# PLAN — 044: configuracion-acueducto-vista

**Spec aprobado:** 2026-09-16

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/configuracion/page.tsx` | Modificado | `page-head` (eyebrow/h1/p), grid de 2 columnas (`.9fr 1.1fr`), vista previa movida a tarjeta propia en la columna derecha |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero backend, cero componentes nuevos, cero cambios a `obtenerAcueducto()` ni `actualizarColorAcentoAcueducto()`.

## 2-3. Esquema / Rutas de la API

Ninguno nuevo.

## 4. Contratos de `core/`

Ninguno.

## 5. Decisiones técnicas

Ninguna de estas es una decisión de negocio (spec §5: "sin dinero ni datos de suscriptores de por
medio") pero sí son decisiones de implementación reales — se investigaron contra la comunidad
(o contra el propio código, cuando ya hay convención) antes de fijarlas, siguiendo CLAUDE.md §3.

| Decisión | Alternativa descartada | Razón | Fuente |
|---|---|---|---|
| Grid de 2 columnas `lg:grid-cols-[0.9fr_1.1fr]` (1 columna en mobile/tablet, mobile-first) | Container queries (`@`), o columnas fijas (`grid-cols-2`) | Ningún otro screen del proyecto usa un split form+preview todavía (sin precedente interno) — se investigó la comunidad: `grid-cols-[<value>]` es el mecanismo documentado de Tailwind para un `grid-template-columns` puntual que no amerita entrar al tema; el enfoque recomendado para 2026 sigue siendo mobile-first con breakpoints de viewport para layouts de página completa — las container queries se recomiendan cuando la grilla vive dentro de un widget reusable (sidebar, panel arrastrable), no es el caso acá | [Tailwind — grid-template-columns](https://tailwindcss.com/docs/grid-template-columns), [Tailwind CSS Grid Template Columns: Practical Patterns for 2026](https://thelinuxcode.com/tailwind-css-grid-template-columns-practical-patterns-for-2026-layouts/) |
| La vista previa (nombre coloreado, NIT, swatch, hex, fila TOTAL) se extrae de la tarjeta "Color de acento" a una tarjeta propia en la columna derecha — patrón "Split Pane" / "Live Preview", reusando el mismo estado (`acueducto`, `color`) sin ninguna llamada nueva | Dejar la vista previa dentro de la tarjeta de color, en columna única como hoy | Es un patrón de UX reconocido y nombrado (no una invención de esta sesión) para pantallas de configuración con vista previa en vivo — separar edición y preview en paneles lado a lado es justo lo que la comunidad de diseño recomienda para este caso exacto | [ui-patterns.com — Live Preview pattern](https://ui-patterns.com/patterns/LivePreview), [Untitled UI — Settings page examples](https://www.untitledui.com/components/settings-pages), [Eleken — Settings Page UI Design Guide](https://www.eleken.co/blog-posts/settings-page-ui) |
| El formulario y el botón "Guardar" se mantienen dentro de la tarjeta "Color de acento" (columna izquierda) | Mover el botón "Guardar cambios" al `page-head`, como en la propuesta | **Sin investigación externa — ya hay convención interna inequívoca (excepción de proporcionalidad, CLAUDE.md §3):** los 11 formularios existentes del proyecto (`corte-form.tsx`, `contador-form.tsx`, `editar-suscriptor-form.tsx`, `cambiar-contrasena-form.tsx`, `plataforma-form.tsx`, `pago-form.tsx`, `reconexion-form.tsx`, `login-form.tsx`, `tarifa-form.tsx`, `reemplazo-contador-form.tsx`, `servicio-form.tsx`) colocan su `<Button type="submit">` dentro del propio `<form>`, nunca en un contenedor de página separado — seguir ese patrón es la fuente, no hace falta salir a buscar más | Grep directo sobre `frontend/components/*.tsx` (11/11 formularios) |
| Swatch de color y código hex en la vista previa se derivan directo del estado `color` ya existente (`style={{ background: color }}`, `color.toUpperCase()`) | Agregar estado nuevo para el swatch/hex | Son parte visual de "vista previa" en la propuesta; no requieren dato ni llamada adicional — el mismo `color` que ya maneja el `<input type="color">` alcanza | Sin investigación — decisión trivial derivada del propio estado existente, no hay "cómo" que investigar |

## 6-7. Dependencias / Límites de Workers

Ninguna. No aplica.

## 8. Estrategia de pruebas

- **CA-1 verificable por tipos + manual:** `Acueducto` (interfaz existente) ya obliga a manejar
  `nit`/`telefono`/`municipio`/`direccion` como `string | null` — el build ya prueba que el `?? '—'`
  cubre los `null`; confirmación visual con `wrangler dev` + `next dev`, sesión real.
- **Integración manual (`wrangler dev` + `next dev` reales):** CA-2 (guardar un color sigue
  llamando a `actualizarColorAcentoAcueducto` igual, mismo mensaje si el rol no es
  `admin_acueducto` o el color es inválido — sin cambios de código en esa función, solo regresión),
  CA-3 (cambiar el selector actualiza nombre/swatch/hex/TOTAL de la vista previa antes de guardar).
- **Manual, requiere Mateo:** aspecto visual final del grid de 2 columnas (mismo criterio de
  proporcionalidad que 039-043 — sin Playwright para esta pantalla, riesgo de negocio nulo).
