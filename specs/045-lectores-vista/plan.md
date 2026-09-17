# PLAN — 045: lectores-vista

**Spec aprobado:** 2026-09-16

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/lectores/page.tsx` | Modificado | `page-head` (eyebrow/h1/p) en vez del `<h1>` suelto actual; tokens de `Card` ya usados en el resto del panel |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |
| `docs/PLAN-PRODUCCION.md` | Modificado | Cierra el pendiente "`/app/lectores` sin re-vestir" que quedó anotado al cerrar 044 |

Cero backend, cero componentes nuevos, cero cambios a `asignarSectorLector()`,
`quitarSectorLector()`, `listarLectoresConSectores()` ni `listarSectoresDisponibles()`.

## 2-3. Esquema / Rutas de la API

Ninguno nuevo.

## 4. Contratos de `core/`

Ninguno.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Se reusa el patrón de `page-head` (eyebrow + `h1` + `p`) tal cual lo usan 039-044 | Layout de la propuesta de referencia | Spec §3.2: esta pantalla no existe en `propuesta-referencia.html` — no hay nada de la maqueta que seguir. El patrón de `page-head` ya es una convención interna establecida en 5 pantallas previas: se reusa tal cual (excepción de proporcionalidad, CLAUDE.md §3), sin investigación externa nueva |
| Layout de una `Card` por lector con checkboxes de sector se mantiene sin cambios estructurales (ya resuelto en spec §3.3) | Convertir a una matriz/tabla lector×sector | Decisión ya tomada y aprobada a nivel de spec, no de plan: §3.3 fija "sin cambios de comportamiento" para evitar reabrir una decisión de UI que 037 no puso en duda |

## 6-7. Dependencias / Límites de Workers

Ninguna. No aplica.

## 8. Estrategia de pruebas

- **CA-1/CA-3 verificables por build + manual:** sin datos ni estados nuevos, el build ya prueba que
  los tipos existentes (`LectorConSectores`, `string[]`) siguen intactos; confirmación visual con
  `wrangler dev` + `next dev`, sesión real.
- **Integración manual (`wrangler dev` + `next dev` reales):** CA-2 (marcar/desmarcar sigue llamando
  a `asignarSectorLector`/`quitarSectorLector` igual, recarga la lista, mismo mensaje de error).
- **CA-4:** regresión simple — confirmar que un operador sin rol `admin_acueducto` sigue sin ver
  "Lectores" en la barra lateral (código de `sidebar-panel.tsx` no se toca, no hay riesgo real, se
  confirma de todos modos por ser parte del CA).
- **Manual, requiere Mateo:** aspecto visual final (mismo criterio de proporcionalidad que 039-044).
