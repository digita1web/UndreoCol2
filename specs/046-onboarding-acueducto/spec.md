# SPEC — 046: onboarding-acueducto

**Estado:** Borrador para aprobación
**Depende de:** 002-catalogo-y-tarifas, 003-suscriptores-contadores, 012-importacion-suscriptores-excel,
011-dashboard, 018-panel-plataforma

## 1. Objetivo

Que un `admin_acueducto` que entra por primera vez a un acueducto recién creado — sin catálogo, sin
tarifas, sin un solo suscriptor — tenga una ruta guiada y clara para cargar lo mínimo necesario y
empezar a usar el sistema de verdad, en vez de caer a un panel vacío sin indicación de qué hacer.

## 2. Por qué ahora

Hallazgo real, Sesión 057: Mateo dio de alta el primer acueducto piloto real ("Idroredes del Sur")
desde `/plataforma`, invitó a su admin (Jaider) y probó el flujo de punta a punta. El acueducto
queda completamente vacío tras el alta — sin `servicios`, sin `tarifas`, sin `usuarios_servicio` —
y hoy no hay nada en la interfaz que le diga al admin nuevo por dónde empezar. Investigado contra
la comunidad (CLAUDE.md §3, sin patrón interno previo de "primer uso"): el consenso en onboarding
de SaaS B2B es priorizar el "time to value" del admin — un asistente corto, en los primeros
minutos del primer login, que pida lo mínimo indispensable para que el producto sirva — por encima
de mejoras de navegación sobre un panel que ya funciona (la propuesta de navegación móvil de esta
misma sesión queda en cola, después de esto).

**Aclaración importante para no confundir con algo que ya existe:** la ruta `/onboarding` actual
(`frontend/app/onboarding/page.tsx`) **no es esto**. Esa pantalla es un caso de error — una cuenta
sin ninguna membresía activa en ningún acueducto (alta desde `/plataforma` que falló a mitad de
camino) — y solo explica el estado y ofrece salir (comentario en el propio archivo, decisión M-5
de Mateo). Este spec es para un `admin_acueducto` **con membresía real y válida**, cuyo acueducto
simplemente todavía no tiene datos cargados. Son dos situaciones distintas; esta feature no toca
`/onboarding`.

## 3. Alcance

### 3.1 Detectar que el acueducto está "vacío"
Un acueducto sin ningún `usuarios_servicio` cargado (y, según decida `/plan`, también sin
`servicios`) se considera recién creado / sin configurar. La condición exacta y de dónde se lee
(reusar datos que el dashboard ya pide, sin una llamada nueva si es posible) se define en `/plan`.

### 3.2 Checklist guiado, no un asistente de pantallas nuevas
En vez de construir un wizard con rutas y pasos propios, el checklist vive en el propio panel
(`/app/dashboard`) cuando el acueducto está vacío, con enlaces directos a las pantallas que **ya
existen y ya funcionan**:
1. **Catálogo y tarifas** → enlaza a `/app/catalogo` (crear al menos un servicio con su tarifa
   vigente — sin esto no se puede facturar nada, CLAUDE.md §10 punto 9d).
2. **Suscriptores** → enlaza a `/app/suscriptores` (alta manual) y a
   `/app/suscriptores/importar` (carga masiva por Excel, 012) — el admin elige cuál usa.
3. **Lector** (opcional, no bloquea) → enlaza a `/app/lectores`, para cuando el acueducto tenga
   trabajo de campo.
Cada paso muestra si ya está hecho (según los datos reales del acueducto, nunca un flag aparte que
se pueda desincronizar) o pendiente. Ningún paso es obligatorio para poder seguir usando el panel —
el admin puede ignorar el checklist y navegar libre en cualquier momento (CLAUDE.md, no forzar
flujos rígidos).

### 3.3 Bienvenida la primera vez
La primera vez que el checklist se muestra (acueducto recién creado), un saludo breve con el
nombre del acueducto — sin inventar copy largo ni un tour de producto; texto corto, directo.

### 3.4 El checklist desaparece solo, pero se puede volver a ver
En cuanto el acueducto deja de estar "vacío" (ya tiene al menos un suscriptor, por ejemplo), el
panel vuelve a mostrar el dashboard normal con indicadores — sin un botón de "cerrar onboarding"
ni un estado que haya que limpiar a mano. Aun así, el admin puede volver a verlo cuando quiera:
un enlace chico y permanente ("Ver guía de inicio" o similar, el texto/ubicación exacta se define
en `/plan`) lo vuelve a mostrar — por ejemplo, para revisarlo con alguien nuevo del equipo, o para
recordar los pasos si nunca los completó del todo. No es un asistente que se "gasta" una sola vez.

## 4. Fuera de alcance

- **Tocar `/onboarding`** (pantalla de error de cuenta sin membresía, ver §2) — es un caso
  totalmente distinto, no se toca.
- **Un wizard con pasos/rutas propias, barra de progreso, "atrás/siguiente"** — se descarta a
  propósito; el checklist enlaza a las pantallas reales que ya existen (§3.2), no las duplica.
- **Emails de onboarding, recordatorios por correo días después, nudges automáticos** — la
  investigación de la comunidad los menciona como parte de un programa de activación completo,
  pero son una feature de comunicación aparte (se apoyaría en Resend, ya configurado hoy) — no
  entra en el alcance de esto.
- **Crear servicios/tarifas de ejemplo o datos de prueba automáticos** — el admin carga sus datos
  reales; no se inventan datos de relleno en la base de un cliente real.
- **Cambiar `crearAcueductoBase()`, `POST /plataforma/acueductos` ni ninguna lógica del alta** —
  esta feature es puramente de la experiencia posterior al alta, del lado del admin_acueducto.

## 5. Reglas de negocio que aplican

Ninguna regla de dominio nueva. El checklist solo verifica datos existentes (servicios,
suscriptores) y enlaza a pantallas que ya cumplen todas sus propias reglas (CLAUDE.md §10
completo, sin cambios).

## 6. Criterios de aceptación

### CA-1 — El checklist aparece cuando el acueducto está vacío
Un `admin_acueducto` de un acueducto sin ningún suscriptor ve el checklist en `/app/dashboard` en
vez de (o antes que) los indicadores vacíos.

### CA-2 — Cada paso refleja el estado real
"Catálogo y tarifas" se marca hecho solo si existe al menos un servicio con tarifa vigente;
"Suscriptores" solo si existe al menos un `usuarios_servicio`. Nunca un estado inventado o
independiente de los datos reales.

### CA-3 — Los enlaces llevan a las pantallas reales, sin duplicar nada
Cada paso del checklist navega a la pantalla real correspondiente (`/app/catalogo`,
`/app/suscriptores`, `/app/suscriptores/importar`, `/app/lectores`) — ningún formulario nuevo
duplicado dentro del checklist.

### CA-4 — El checklist desaparece solo al completarse lo mínimo
En cuanto el acueducto tiene al menos un suscriptor, `/app/dashboard` vuelve a mostrar el panel
normal (indicadores) sin ninguna acción manual del admin para "cerrarlo".

### CA-4b — Se puede volver a ver el checklist a propósito
Aunque el acueducto ya tenga datos (CA-4 ya lo ocultó), el admin tiene una forma explícita y
permanente de volver a abrirlo — no queda inaccesible después de la primera vez.

### CA-5 — Roles sin indicadores no ven este checklist
`secretaria` y `lector` no ven la variante de indicadores de `admin_acueducto` (spec 011 §0.4, sin
cambios) — este checklist tampoco les aparece; es una experiencia exclusiva de quien puede
configurar el acueducto.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Confundir esto con la pantalla `/onboarding` existente (incidente de cuenta sin membresía) | Documentado explícitamente en §2; esta feature no toca esa ruta ni su lógica |
| Que el checklist se sienta como un formulario más que hay que llenar (fricción) | §3.2: nunca bloquea el uso del panel; el admin puede navegar libre en cualquier momento, no es obligatorio completarlo para seguir |
| Que el estado "hecho/pendiente" del checklist se desincronice de la realidad | §3.2/CA-2: siempre se deriva de datos reales (conteos), nunca de un flag propio que guardar y mantener sincronizado |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] Decisiones de implementación investigadas contra prácticas de la comunidad cuando no haya un
      patrón ya establecido en este proyecto (CLAUDE.md §3) — ya arrancado en este spec (§2), se
      completa en `/plan` para las decisiones técnicas puntuales que falten
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend, si aplica) exitoso
- [ ] `npm run lint` limpio en los proyectos que se toquen
- [ ] `npm run knip` sin hallazgos nuevos
- [ ] Verificación manual con `wrangler dev` + `next dev`, sesión real (o contra producción real,
      con el acueducto piloto, como se viene haciendo el resto de la sesión)
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
