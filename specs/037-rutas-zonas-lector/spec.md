# SPEC — 037: rutas-zonas-lector

**Estado:** Borrador para aprobación
**Depende de:** 003-suscriptores-contadores (columna `sector`), 024-permisos-lector,
025-app-lector-movil

## 1. Objetivo

Que un `admin_acueducto` pueda asignarle a cada `lector` uno o más sectores del acueducto, y que ese
`lector` solo vea y trabaje con los suscriptores (y sus lecturas) de los sectores que tiene
asignados — en vez de ver todo el acueducto completo, como ocurre hoy.

## 2. Por qué ahora

- Cierra el hueco que `CLAUDE.md §10 punto 24` ya documenta como regla del dominio ("el lector solo
  crea/ve lecturas y ejecuta órdenes asignadas a él") pero que ningún spec implementó todavía —
  `024-permisos-lector` acotó qué **columnas** puede ver el lector, nunca qué **filas**.
  `025-app-lector-movil` dejó la "Zona actual" del mockup de Figma fuera a propósito, señalando
  explícitamente que la asignación de rutas "no existe como feature todavía".
- **Investigación previa a este spec (regla CLAUDE.md §3) que define el diseño, no la inventa:** la
  tabla `usuarios_servicio` ya tiene una columna `sector` (texto libre, desde
  `20260902090000_suscriptores-contadores.sql`, feature 003) — hoy se puede cargar al crear un
  suscriptor y hasta por la importación de Excel (`20260912090000_importacion-suscriptores.sql`,
  feature 012), pero nada lo usa para filtrar ni asignar nada. Es el mismo concepto que ya mostraba
  el mockup de Figma de AquaLectura ("Zona actual: Sector Centro") — decisión de Mateo: se reutiliza
  ese campo en vez de construir un concepto de "ruta" nuevo y paralelo.

**Segunda ronda de investigación (a pedido de Mateo, antes de aprobar):** una tabla de asignación
técnico↔territorio filtrando por RLS/permisos, sin geolocalización ni ruteo, **es el patrón
establecido de la industria** para exactamente este problema — no una simplificación propia. Zoho
FSM lo llama "Territory-based Permission" (un técnico solo ve clientes/órdenes de su territorio
asignado) y Salesforce Field Service usa el mismo concepto de "Service Territories". Confirma que
diseñar esto como una tabla de asignación chica + filtro en RLS, sin construir un sistema de rutas
geográficas, es la vía correcta y no una versión reducida de algo mejor.
[Zoho FSM — Territory-based Permission](https://help.zoho.com/portal/en/kb/fsm/set-up-workforce/articles/territory-based-permission),
[Salesforce — Service Territory Guidelines](https://help.salesforce.com/s/articleView?id=service.fs_territory_guidelines.htm).

## 3. Alcance

### 3.1 El admin asigna uno o más sectores a un lector
Un lector puede tener cero o varios sectores asignados. Cero sectores asignados significa "ve todo
el acueducto" (comportamiento actual, retrocompatible — ningún lector existente pierde acceso el día
que se despliegue esta feature hasta que un admin le asigne sectores explícitamente).

### 3.2 El lector con sectores asignados solo ve esos sectores
- **Suscriptores:** la lista que ya usa AquaLectura ("Nueva lectura", el `<select>` de suscriptores)
  se filtra a los sectores asignados.
- **Lecturas:** "Pendientes" e "Historial" (025) muestran solo lecturas de suscriptores de esos
  sectores.
- El filtrado se hace en el **backend** (RLS o el filtro de la consulta), no en el frontend — un
  lector con sectores asignados nunca debe poder ver datos de otro sector inspeccionando la
  respuesta de la API a mano.

### 3.3 AquaLectura muestra el sector asignado
La pestaña "Inicio" (025) gana el dato de sector(es) asignado(s) — el "Zona actual" del mockup
original de Figma, ahora con datos reales en vez de quedar fuera de alcance.

### 3.4 Un suscriptor sin `sector` asignado
Un suscriptor con `sector` en `null` (el caso de hoy, para todos los ya existentes) no aparece para
ningún lector que tenga sectores asignados — solo lo ven los lectores sin ninguna restricción (§3.1)
o el `admin_acueducto`. Se documenta como consecuencia esperada, no como bug: un acueducto que active
esta feature necesita, para aprovecharla, ir asignando el campo `sector` a sus suscriptores (ya
sea a mano o por la importación de Excel que ya lo soporta).

## 4. Fuera de alcance

- **Rutas geográficas con orden de paradas, mapas, o navegación** — decisión de Mateo (§2): se
  reutiliza `sector` como etiqueta de agrupación, no se construye un sistema de ruteo con
  coordenadas ni con un orden de visita sugerido.
- **Gestión del catálogo de sectores** (crear/renombrar/borrar sectores como entidad propia) —
  `sector` sigue siendo texto libre en `usuarios_servicio`, igual que hoy; esta feature no agrega una
  tabla `sectores` ni una pantalla para administrarlos como catálogo. Si dos suscriptores escriben el
  sector de forma distinta ("Centro" vs. "centro"), es la misma limitación que ya existe hoy al
  cargar ese campo — no se agrega normalización nueva.
- **Migrar los datos de `sector` existentes** — los suscriptores que ya tienen un valor cargado
  siguen tal cual; no se renombra ni se completa nada retroactivamente.
- **Asignar sectores a `secretaria` o a `admin_acueducto`** — la restricción de esta feature es
  exclusiva del rol `lector` (mismo alcance que 024); los demás roles siguen viendo todo el
  acueducto, sin cambios.
- **Notificar a un lector cuando se le asigna o quita un sector** — sin correo ni aviso automático;
  el cambio se ve la próxima vez que el lector abre AquaLectura.

## 5. Reglas de negocio que aplican

- `CLAUDE.md §10 punto 24`: "El lector solo crea/ve lecturas y ejecuta órdenes asignadas a él" — esta
  feature es la primera implementación real de la mitad "asignadas a él" de esa regla (la mitad de
  columnas ya la cerró 024).
- Toda tabla nueva (la asignación lector↔sector) lleva `cliente_id`, RLS con `FORCE`, y su test de
  aislamiento (CLAUDE.md §5.4) — sin excepciones, aunque la tabla sea chica.
- El filtrado por sector es aditivo a las reglas de aislamiento multi-tenant ya existentes (RLS por
  `cliente_id`), nunca las reemplaza — un lector nunca ve otro acueducto, con o sin sectores
  asignados, exactamente igual que hoy.

## 6. Criterios de aceptación

### CA-1 — Un admin puede asignar uno o más sectores a un lector
Verificable desde el panel del `admin_acueducto` (pantalla exacta a definir en `/plan`).

### CA-2 — Un lector con sectores asignados solo ve suscriptores de esos sectores
Con datos de prueba de al menos dos sectores distintos, un lector asignado a uno de ellos no ve, en
ningún listado de AquaLectura, suscriptores del otro sector — verificado contra la API real, no solo
la UI.

### CA-3 — Un lector sin ningún sector asignado sigue viendo todo el acueducto
Regresión explícita: el comportamiento de hoy no cambia para un lector sin asignación — cero
sectores asignados no significa "no ve nada".

### CA-4 — Un lector no puede ver datos de otro sector manipulando la petición a la API a mano
El filtrado real está en el backend/RLS, no solo en lo que renderiza el frontend — un `curl` directo
con la sesión del lector, pidiendo de más, no devuelve datos fuera de sus sectores asignados.

### CA-5 — Un suscriptor sin `sector` asignado no aparece para un lector con sectores asignados
Consecuencia esperada de §3.4, verificada explícitamente (no asumida).

### CA-6 — `admin_acueducto` y `secretaria` no pierden ninguna visibilidad
Sin cambios para esos roles — ven todos los suscriptores del acueducto, con o sin `sector`, igual que
hoy.

### CA-7 — AquaLectura muestra el sector asignado del lector en "Inicio"
Con un lector de prueba con sectores asignados, la pestaña "Inicio" los muestra; sin ninguno
asignado, indica claramente "todos los sectores" (o equivalente), nunca un espacio vacío ambiguo.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| `sector` es texto libre — inconsistencias de captura ("Centro"/"centro"/"CENTRO") rompen el filtrado exacto | Documentado como fuera de alcance (§4) — es una limitación preexistente del campo, no algo que esta feature empeora; normalizar (mayúsculas, trim) es una mejora de datos independiente si hace falta después |
| Migrar un acueducto real a esta feature exige cargar `sector` en todos sus suscriptores primero | Retrocompatible por diseño (§3.1): sin ninguna asignación, todo sigue funcionando exactamente igual que hoy — la adopción es opcional y gradual |
| Un lector con múltiples sectores asignados podría necesitar una UI más elaborada que una sola etiqueta | Alcance de "Inicio" (§3.3) se acota a mostrar la lista de sectores asignados como texto — cualquier UI más rica (selector para cambiar de sector activo, etc.) queda fuera si no se pide explícitamente |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] Decisiones de implementación investigadas contra prácticas de la comunidad cuando no haya un
      patrón ya establecido en este proyecto (CLAUDE.md §3 y su excepción de proporcionalidad)
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] `npm run knip` corrido en ambos proyectos, sin hallazgos nuevos sin revisar
- [ ] Migración versionada (tabla de asignación lector↔sector) + test de aislamiento en verde
- [ ] Tests de las rutas nuevas en verde, con la salida pegada
- [ ] Verificación manual con `wrangler dev` real: dos lectores de prueba, sectores distintos,
      confirmando CA-2/CA-3/CA-4 contra la API real
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
