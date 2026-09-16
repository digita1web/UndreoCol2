# SPEC — 042: cortes-vista

**Estado:** Borrador para aprobación
**Depende de:** 009-cortes-y-reconexiones, 026-shell-panel-admin, 041-catalogo-tarifas (mismo
patrón de `Badge`)

## 1. Objetivo

Re-vestir `/app/cortes` (candidatos a corte por mora) con el sistema visual de 026. Cuarta de las
pantallas que quedaban (orden definido por Mateo). Puramente visual — sin hueco de funcionalidad
encontrado, mismo caso que 041.

## 2. Por qué ahora

Mateo definió el orden del resto del rediseño (Sesión 056): Cortes es la cuarta, después de
Catálogo (041).

## 3. Alcance

### 3.1 `page-head` + tabla con `Badge` de urgencia
Eyebrow "Cortes y reconexión", h1 "Gestión de cortes", subtítulo con el conteo real de candidatos.
Tabla (Suscriptor, Días de mora, Deuda vencida, Acción) en vez de la lista vertical actual — mismo
patrón que 030/039/040. `Badge` de urgencia por días de mora: **sin un umbral configurable expuesto
en el frontend hoy** (el umbral real vive en `configuracion.dias_mora_corte`, no se trae a esta
pantalla) — se usa `danger` fijo para todos los candidatos de esta lista, porque **estar en esta
lista ya significa que superaron el umbral real** (`listarCandidatosCorte()` filtra server-side,
CLAUDE.md §10 punto 16). No hay una categoría "menos urgente" que mostrar con otro color: todo lo
que aparece acá ya es candidato real.

### 3.2 **La propuesta muestra un botón "Ejecutar corte" en cada fila — no se adopta**
Hoy cada fila es un enlace a la ficha del suscriptor, donde vive `CorteForm` (motivo obligatorio,
CLAUDE.md §10 punto 16-19). Esto fue una **decisión aprobada de la feature 009** (comentario real en
el código: "esta lista NUNCA corta por sí sola — el admin decide y ejecuta el corte desde el detalle
... con motivo obligatorio"). Un botón de un clic en la lista, sin pedir motivo, iría en contra de
esa decisión ya tomada — mismo criterio que 030 no colapsó Simular→Confirmar en un botón. Se
mantiene el enlace a la ficha, con la etiqueta "Ver ficha →" en vez de que toda la fila sea un
`<a>` (mejora de accesibilidad menor: hoy el `<Link>` envuelve la fila entera).

## 4. Fuera de alcance

- **Ejecutar el corte desde esta lista** — spec §3.2, decisión ya tomada en 009, no se revierte acá.
- **Traer o mostrar el umbral configurado** (`configuracion.dias_mora_corte`) — no existe hoy en
  ninguna respuesta que llegue a esta pantalla; traerlo sería una llamada nueva, fuera de "cero
  endpoints nuevos".
- **Candidatos a reconexión** — esta pantalla nunca los mostró (son suscriptores ya `cortado`, se
  gestionan desde su propia ficha); no se agrega una sección nueva.

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 punto 16: corte por umbral de días de mora configurable, o manual — esta pantalla
  solo lista candidatos por umbral, la ejecución (con motivo) sigue en la ficha del suscriptor.
- CLAUDE.md §10 punto 17: al ejecutar el corte el suscriptor sale del ciclo normal — sin cambios,
  esta lista no ejecuta nada.

## 6. Criterios de aceptación

### CA-1 — La tabla muestra los candidatos reales
Con datos reales de `listarCandidatosCorte()`, cada fila coincide (nombre, código, días de mora,
deuda vencida).

### CA-2 — "Ver ficha" lleva a la ficha real del suscriptor candidato
Enlaza a `/app/suscriptores/{usuarioServicioId}` con el `id` correcto de la fila.

### CA-3 — Sin candidatos, se ve un mensaje claro, no una tabla vacía ambigua
Mismo comportamiento de hoy ("Sin candidatos a corte por ahora"), re-vestido.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Mostrar todos los candidatos con `Badge danger` fijo (sin gradiente de urgencia) podría parecer una regresión visual frente a la propuesta, que sí gradúa colores | La propuesta gradúa colores para candidatos vs. no-candidatos en una lista más grande (dashboard); esta pantalla ya filtra solo candidatos reales — no hay "menos urgente" que mostrar distinto sin inventar un umbral que no existe en el frontend |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` sin hallazgos nuevos
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
