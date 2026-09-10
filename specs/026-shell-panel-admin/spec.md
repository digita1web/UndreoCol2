# SPEC — 026: shell-panel-admin

**Estado:** Borrador para aprobación
**Depende de:** 018-panel-plataforma, 021-cerrar-sesion-admin, 023-personalizacion-factura

## 1. Objetivo

Adoptar el sistema visual de `undreocol_ui_propuesta.html` (prototipo de Mateo, 15 pantallas) como
base del panel `/app/*`: tokens de color/tipografía y el shell compartido (barra lateral +
cabecera superior), en vez del header simple actual. **No re-viste ninguna pantalla de contenido
todavía** — es la infraestructura visual sobre la que cada pantalla existente se va a rediseñar
después, una por una, en specs propios.

## 2. Por qué ahora

Mateo trajo un prototipo HTML completo y pidió evaluar si es viable aplicarlo. Se acordó en
conversación: es un rediseño de 15 pantallas, demasiado grande para una sola feature con la
verificación real que exige este proyecto — se secuencia empezando por lo compartido (esta
feature), y cada pantalla de contenido se re-viste después. También se confirmó mantener
AquaLectura (025) como la vista del lector, en vez de la versión más simple del prototipo — a esa
se le aplicará la misma paleta/tipografía más adelante, sin rehacer su estructura.

## 3. Alcance

### 3.1 Tokens de diseño nuevos, agregados a los existentes (no reemplazo)
Los tokens de shadcn/ui actuales (`--background`, `--foreground`, `--border`, `--muted`, etc.) se
conservan — los usa cada componente ya construido. Se agregan los que introduce la propuesta:
`--accent`/`--accent-soft` (mapeado al mismo azul `#2563eb` que ya es el acento real de hoy —
ningún botón existente cambia de color todavía), y los cuatro semánticos con su fondo suave:
`--success`/`--success-soft`, `--warning`/`--warning-soft`, `--danger`/`--danger-soft`,
`--info`/`--info-soft`. Expuestos en `tailwind.config.ts` como utilidades (`bg-success`,
`text-danger`, etc.).

### 3.2 Tipografía: Inter
La propuesta de Mateo elige Inter (Google Fonts) para toda la interfaz — hoy no hay ninguna
tipografía definida (fuente del sistema por defecto). Se agrega vía `next/font/google` (sin
`<link>` externo, evita parpadeo de fuente) y se fija como la fuente base del panel.

### 3.3 Shell compartido: barra lateral + cabecera superior
Reemplaza el header simple de `frontend/app/app/layout.tsx` (que hoy solo tiene "← Inicio"/"Salir",
agregado en esta misma sesión). Barra lateral fija (250px, colapsa a barra superior en pantallas
angostas — mismo *breakpoint* que ya trae el prototipo) con el logo/nombre "UndreoCol", enlaces a
las **9 pantallas reales** que hoy existen (Panel, Facturación, Cartera, Lecturas, Suscriptores,
Catálogo y tarifas, Cortes, Notificaciones, Configuración) resaltando la activa, y el operador +
botón "Salir" al pie. Cabecera superior: indicador en línea/sin conexión + nombre del acueducto.

**Se excluyen del menú, a propósito:** "Portal público" y "Vista lector" del prototipo — en la
demo son pestañas para mostrar todas las pantallas en un clic, pero no son destinos reales dentro
de una sesión autenticada de `admin_acueducto` (el portal es público y sin sesión; la vista del
lector la decide el rol de quien entra, no un enlace que el admin elija). No se agregan enlaces que
no llevan a ningún lado real.

### 3.4 Dos componentes reutilizables nuevos, listos para cuando se re-vista cada pantalla
- `components/ui/badge.tsx`: variantes `success`/`warning`/`danger`/`info`/`gray`, mismo patrón de
  los badges del prototipo (fondo suave + texto del color, texto en negrita, forma de píldora).
- `components/ui/kpi-card.tsx`: ícono + etiqueta + valor + variación, como las 4 tarjetas del
  panel principal del prototipo.
Ninguna pantalla de contenido los usa todavía en esta feature — quedan disponibles para los specs
de re-vestido.

## 4. Fuera de alcance

- Re-vestir el contenido de cualquiera de las 9 pantallas (siguen viéndose como hoy, solo cambia
  el marco alrededor: barra lateral en vez de header simple). Cada una es su propio spec futuro.
- La vista del lector (025/AquaLectura) — se mantiene tal cual; adoptar esta paleta ahí es un
  ajuste menor para un spec futuro, no de esta feature.
- "Portal público" y "Vista lector" como enlaces del menú (§3.3).
- Modo oscuro — el prototipo no lo define; no se improvisa uno.

## 5. Reglas de negocio que aplican

- CLAUDE.md §7: ningún `<form onSubmit>` nuevo en esta feature (es shell y tokens, sin
  formularios) — no aplica `useHidratado()` aquí.
- Ninguna regla de negocio de dominio — es una feature puramente de interfaz, sin tocar cálculos
  ni datos.

## 6. Criterios de aceptación

### CA-1 — El shell nuevo envuelve las 9 pantallas reales
Cada una de las 9 rutas existentes se ve dentro de la barra lateral + cabecera nueva, con la
sección activa resaltada correctamente.

### CA-2 — Ninguna pantalla existente pierde funcionalidad
Con sesión de `admin_acueducto` real, cada una de las 9 pantallas sigue funcionando exactamente
igual que antes (los botones, formularios y datos no cambiaron) — solo cambió el marco alrededor.

### CA-3 — El botón "Salir" y la sesión siguen funcionando
Verificado con sesión real: cerrar sesión desde el shell nuevo funciona igual que con el header
anterior.

### CA-4 — Responsive: la barra lateral colapsa en pantalla angosta
En un viewport angosto (< 760px, mismo *breakpoint* del prototipo), la barra lateral no tapa el
contenido — se comporta como barra superior, igual que ya resuelve el CSS del prototipo.

### CA-5 — Los tokens nuevos no rompen nada existente
`npm run build` sin errores; una revisión visual (`wrangler dev` + `next dev`, sesión real)
confirma que ningún botón/tarjeta actual cambió de color de forma no intencional.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El contenido de las 9 pantallas, pensado para un layout sin barra lateral (`mx-auto max-w-3xl`), se ve descentrado o con espacio de sobra dentro de la nueva área de contenido | Esperado y aceptado a propósito (§4): es un estado de transición hasta que cada pantalla se re-vista en su propio spec — no es un bug de esta feature |
| Cargar Inter cambia la métrica de texto de todo el panel (textos que hoy calzan justo pueden desbordar) | Revisión visual real de las 9 pantallas tras el cambio (CA-5), no solo de la barra lateral |
| Agregar tokens nuevos sin querer pisa un nombre de variable CSS que shadcn ya usa | Los tokens nuevos llevan nombres que hoy no existen en `globals.css` (`--accent`, `--success`, etc.) — verificado antes de escribir la migración de estilos |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npm run lint` limpio
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real de `admin_acueducto`,
      recorriendo las 9 pantallas dentro del shell nuevo
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
