# SPEC — 043: notificaciones-vista

**Estado:** Borrador para aprobación
**Depende de:** 010-notificaciones, 026-shell-panel-admin, 042-cortes-vista (mismo patrón de
`Badge`)

## 1. Objetivo

Re-vestir `/app/notificaciones` con el sistema visual de 026. Quinta de las pantallas que quedaban
(orden definido por Mateo). Puramente visual, sin hueco de funcionalidad — mismo caso que 041/042.

## 2. Por qué ahora

Mateo definió el orden del resto del rediseño (Sesión 056): Notificaciones es la quinta, después de
Cortes (042).

## 3. Alcance

### 3.1 `page-head` + filtros + `Badge` de estado
Eyebrow "Comunicaciones", h1 "Notificaciones". Filtros de tipo/estado (ya existen) reubicados en el
encabezado. `Badge` de `EstadoNotificacion` en vez del texto con color condicional que ya usa hoy
(`fallida`→rojo, `enviada`→verde, el resto sin color): `enviada`→`success`, `fallida`→`danger`,
`pendiente`→`warning`, `cancelada`→`gray`.

### 3.2 **Se mantiene como lista, no tabla** — a diferencia de 039/040/041/042
La propuesta (`id="notificaciones"`) muestra una tabla de 4 columnas (Destinatario, Tipo, Fecha,
Entrega) con un botón "Detalle". Esta pantalla ya muestra, en cada fila, más información de la que
cabe en una tabla legible (destinatario, canal, fecha, asunto, cantidad de intentos, fecha de envío
real, y el error completo si falló) — condensarla a una tabla con un botón "Detalle" exigiría
construir una vista de detalle que hoy no existe, para datos que ya se muestran sin necesidad de
un clic más. Se mantiene el formato de lista expandida, mismo criterio que 041 con el historial de
tarifas (spec 041 §3.2/plan 041 §5): no hay precedente de la propuesta que encaje mejor que lo que
ya existe.

## 4. Fuera de alcance

- **Una pantalla o modal de "Detalle" por notificación** — no existe hoy, y no hace falta: toda la
  información ya se muestra inline (spec §3.2).
- **Reintentar el envío de una notificación fallida desde esta pantalla** — no existe hoy
  (`encolarNotificacion`/reintentos son del backend, CLAUDE.md §10 punto 20); no se agrega un botón
  de acción que no tiene backend detrás.

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 punto 20: un fallo de envío de correo nunca bloquea la facturación — esta pantalla
  es de solo lectura del historial, no cambia ese comportamiento.

## 6. Criterios de aceptación

### CA-1 — El `Badge` de estado usa el color correcto para los 4 valores
`enviada`→`success`, `fallida`→`danger`, `pendiente`→`warning`, `cancelada`→`gray`.

### CA-2 — Los filtros de tipo/estado siguen funcionando igual
Mismo comportamiento (llaman a `listarNotificaciones` con los mismos parámetros), solo reubicados
visualmente.

### CA-3 — Toda la información que se mostraba antes se sigue mostrando
Destinatario, canal, fecha, asunto, intentos, fecha de envío real y último error (cuando existe) —
nada se pierde en el re-vestido.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| No seguir la tabla de la propuesta al pie de la letra podría leerse como un recorte | Documentado con la razón real (spec §3.2): esta pantalla ya expone más detalle por fila del que una tabla puede mostrar sin agregar una vista de detalle que hoy no existe |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] `npm run knip` sin hallazgos nuevos
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
