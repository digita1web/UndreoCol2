# SPEC — 027: panel-principal

**Estado:** Borrador para aprobación
**Depende de:** 011-dashboard, 026-shell-panel-admin

## 1. Objetivo

Re-vestir `/app/dashboard` (Panel principal) con el sistema visual de 026, siguiendo
`specs/026-shell-panel-admin/propuesta-referencia.html`: tarjetas KPI, saludo con el nombre real
del usuario, y el mismo gráfico de tendencia que ya existe, con la paleta nueva. Es la primera
pantalla de contenido que se re-viste, tras el marco compartido de 026.

## 2. Por qué ahora

Mateo lo eligió como la pantalla piloto tras aprobar 026. Antes de este spec se aclaró un punto de
alcance importante: la propuesta visual muestra cifras de recaudo/cartera que hoy ve
`admin_acueducto` completo — Mateo describió una futura distinción `administrador` (ve balances)
vs. `secretaria` (solo lo administrativo, sin balances) **que todavía no existe como rol**
(`rol_usuario` hoy solo tiene `administrador`, `admin_acueducto`, `lector` — verificado contra la
base real). Se acordó explícitamente: esta feature re-viste el dashboard **tal como es hoy**, sin
introducir el rol nuevo — ese split es su propia feature futura, del mismo tamaño que 024.

## 3. Alcance

### 3.1 Solo re-vestido — cero datos nuevos
Usa exactamente lo que ya devuelve `GET /dashboard` y `GET /dashboard/indicadores` (`recaudoMes`,
`carteraPendiente`, `carteraVencida`, `usuariosEnMora`, `consumoPromedioUltimoPeriodo`,
`tendencia`, `suscriptoresPorEstado`). Ninguna ruta de backend cambia.

### 3.2 Encabezado con saludo real
Reemplaza el `<h1>{nombre del acueducto}</h1>` actual por el patrón de la propuesta: eyebrow
"RESUMEN", saludo según la hora real (`Buenos días`/`Buenas tardes`/`Buenas noches` +
`datos.perfil.nombre`), y una frase con el nombre del acueducto debajo — mismos datos que ya llegan
hoy, solo reorganizados.

### 3.3 Las 4 tarjetas KPI, con `KpiCard` (026)
- Recaudo del mes → `recaudoMes`.
- Cartera vencida → `carteraVencida`, variación en rojo (`danger`) porque es lo urgente — enlaza a
  `/app/pagos`, igual que hoy.
- Por vencer → `carteraPendiente` (hoy vive junto a "vencida" en una sola tarjeta "Cartera"; la
  propuesta las separa en dos tarjetas — se adopta esa separación, es más clara).
- Consumo promedio → `consumoPromedioUltimoPeriodo` (con el `—` que ya maneja hoy cuando es null).
`usuariosEnMora` no desaparece: se muestra como la línea de variación de la tarjeta "Cartera
vencida" (p. ej. "38 suscriptores en mora"), en vez de su propia quinta tarjeta — la propuesta no
tiene una tarjeta aparte para esto tampoco.

### 3.4 Gráfico de tendencia y suscriptores por estado: se conservan, re-vestidos
El gráfico de barras de 12 meses (ya es CSS puro, D-5, sin librería) y la sección "Suscriptores
por estado" (activo/suspendido/cortado/inactivo, con enlace a `/app/suscriptores`) siguen
existiendo — la propuesta no los tiene, pero son funcionalidad real de 011 que no se elimina. Se
les aplican los tokens/tarjetas nuevos para que no desentonen visualmente con las tarjetas KPI.

### 3.5 "No autorizado" (lector), re-vestido sin cambiar el mensaje
El estado que ve el `lector` (mensaje + enlace a `/app/lecturas`) se mantiene igual en contenido —
CLAUDE.md exige que sea un estado explícito, no una degradación silenciosa — solo se re-viste
visualmente.

## 4. Fuera de alcance

- **El rol `secretaria`** y cualquier ocultamiento de las tarjetas financieras por rol — es la
  feature futura descrita en §2, no esta.
- **"Atención prioritaria"** (anomalías de lectura, facturas por enviar, candidatos a corte) de la
  propuesta — requiere contar datos que `GET /dashboard/indicadores` no calcula hoy (backend
  nuevo). Se documenta como propuesta de una feature futura, no se improvisa aquí.
- **Botón "Exportar"** de la propuesta — no existe ninguna función de exportación en el sistema.
  No se agrega un botón que no hace nada.
- Cambiar el radio de esquina/sombra global de `Card` (la propuesta usa 14px; hoy es 8px,
  `--radius` de shadcn) — es un token compartido por **todas** las pantallas, no solo esta; tocarlo
  aquí cambiaría el aspecto de pantallas que todavía no se re-vistieron. Queda para cuando se defina
  como parte del sistema compartido (026 ya cerrado) o se decida re-visitar ese token a propósito.

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 (spec 011 §0.4): los indicadores financieros son exclusivos de `admin_acueducto`;
  el `lector` nunca los ve, ni siquiera degradados — se mantiene sin cambios.

## 6. Criterios de aceptación

### CA-1 — Las 4 cifras reales aparecen correctas
Con sesión de `admin_acueducto` real, las 4 tarjetas KPI muestran los mismos valores que hoy
devuelve `GET /dashboard/indicadores` (verificado comparando la respuesta HTTP contra lo
renderizado).

### CA-2 — El saludo usa el nombre real y la hora real
`Buenos días/tardes/noches, {nombre real del perfil}` — no un valor de ejemplo fijo.

### CA-3 — Cartera vencida y por vencer siguen enlazando a `/app/pagos`
Mismo comportamiento de navegación que hoy.

### CA-4 — El lector sigue viendo "No autorizado", sin las cifras
Con sesión de `lector` real, `/app/dashboard` no muestra ninguna tarjeta KPI — mismo criterio que
hoy, solo re-vestido.

### CA-5 — El gráfico de tendencia y suscriptores por estado no se rompieron
Ambos bloques siguen mostrando datos reales y funcionando (el enlace por estado sigue llevando a
`/app/suscriptores`).

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Separar "Cartera" en dos tarjetas KPI (vencida/por vencer) sea confuso sin el contexto que daba tenerlas juntas | Cada tarjeta lleva su etiqueta clara y el mismo enlace a `/app/pagos`; se verifica visualmente con datos reales del fixture antes de cerrar |
| El saludo por hora del día (`Buenos días` etc.) se calcula con la hora del navegador del usuario, no la del servidor | Correcto a propósito — el saludo debe reflejar la hora de quien lo lee, no la del Worker |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de `admin_acueducto` y de
      `lector` (regresión del estado "No autorizado")
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
