# SPEC — 045: lectores-vista

**Estado:** Borrador para aprobación
**Depende de:** 037-rutas-zonas-lector, 026-shell-panel-admin

## 1. Objetivo

Re-vestir `/app/lectores` con el sistema visual de 026. Pantalla nueva que Mateo agregó a la lista
de pendientes del rediseño (Sesión 056) — no formaba parte de las 15 pantallas originales porque no
existía todavía cuando se definió esa lista: la creó la propia feature 037.

## 2. Por qué ahora

Con las 15 pantallas originales del rediseño ya completas (Sesión 057, feature 044,
`docs/PLAN-PRODUCCION.md`), esta es la última pantalla pendiente antes de correr `security-review`
sobre toda la sesión — orden ya definido por Mateo.

## 3. Alcance

### 3.1 `page-head` — reemplaza el `<h1>` suelto actual
Hoy la pantalla usa `<h1 className="text-2xl font-semibold">Lectores</h1>` sin `eyebrow` ni
estructura de `page-head` — el mismo patrón que tenían 039-044 antes de re-vestirse. Se reemplaza
por el patrón ya establecido: `eyebrow` + `h1` (`text-[28px] font-bold tracking-tight`) + `p`
descriptivo, igual que en 041/042.

### 3.2 Sin correspondencia directa en la propuesta — se documenta, no se inventa
`specs/026-shell-panel-admin/propuesta-referencia.html` **no tiene esta pantalla.** Su sección
`id="lector"` ("Vista del lector") es el mockup de la experiencia móvil del rol lector (AquaLectura,
feature 025), no esta pantalla administrativa de asignar sectores. No hay layout de la propuesta que
seguir "tal cual" como en 041/044 — se aplican los tokens y componentes ya establecidos (`Card`,
`page-head`, paleta de 026) sin forzar una correspondencia que no existe.

### 3.3 Tarjeta por lector con checkboxes de sector — sin cambios de comportamiento
Se mantiene el layout de una `Card` por lector, con el nombre/correo como título y un checkbox por
sector disponible. Solo cambia el contenedor visual (tokens de 026 ya usados en el resto del panel).

### 3.4 Mensajes de estado — mismo contenido, tokens de 026
El aviso de "todavía no hay ningún suscriptor con sector cargado" y los errores de asignación se
mantienen igual en contenido, con los estilos de texto ya usados en el resto de pantallas
re-vestidas (`text-sm text-muted-foreground` / `text-sm text-red-600`).

## 4. Fuera de alcance

- Cualquier cambio a `asignarSectorLector()`, `quitarSectorLector()`, `listarLectoresConSectores()`
  o `listarSectoresDisponibles()`.
- Selector de "sector activo" o cualquier UI de asignación más rica — ya declarado fuera de alcance
  en el propio spec de 037 (§7), no se reabre acá.
- Normalización del texto libre de `sector` (mayúsculas/espacios) — limitación preexistente,
  documentada como fuera de alcance en 037 (§7), no algo que este spec revisa.
- El guard de rol que oculta "Lectores" del menú para quien no sea `admin_acueducto`
  (`sidebar-panel.tsx`) — ya implementado, no se toca.

## 5. Reglas de negocio que aplican

Ninguna regla de dominio nueva — pantalla de asignación operativa (lector↔sector), sin dinero ni
datos de facturación de por medio.

## 6. Criterios de aceptación

### CA-1 — La lista de lectores y sus sectores asignados se ve igual que hoy
Mismos datos (`listarLectoresConSectores()`), con los tokens de 026.

### CA-2 — Marcar/desmarcar un sector sigue funcionando igual
Mismo comportamiento: llama a `asignarSectorLector`/`quitarSectorLector`, recarga la lista, mismo
mensaje si falla.

### CA-3 — El aviso de "sin sectores disponibles" se sigue mostrando cuando corresponde
Cuando `listarSectoresDisponibles()` devuelve una lista vacía, igual que hoy.

### CA-4 — El guard de rol de la barra lateral no cambia
Un operador que no sea `admin_acueducto` sigue sin ver "Lectores" en el menú — comportamiento ya
existente en `sidebar-panel.tsx`, esta pantalla no lo toca.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Sin una sección de la propuesta que replicar, existe el riesgo de inventar un layout nuevo en vez de reusar el lenguaje visual ya establecido | Documentado en §3.2 — se aplican los mismos tokens/componentes (`Card`, `page-head`) que ya usan 039-044, ninguno nuevo |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] Decisiones de implementación investigadas contra prácticas de la comunidad cuando no haya un
      patrón ya establecido en este proyecto (CLAUDE.md §3 y su excepción de proporcionalidad)
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` sin hallazgos nuevos
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
