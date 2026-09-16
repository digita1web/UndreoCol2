# PLAN — 039: lecturas-vista-admin

**Spec aprobado:** 2026-09-16

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/lecturas/page.tsx` | Modificado | Solo la función `VistaAdmin` — `page-head`, cruce suscriptor↔contador, dos tarjetas rápidas, tabla con `Badge`, formulario re-vestido con `Input`/`Label` |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero archivos de backend — spec §3.1, confirmado: se usan los mismos endpoints que ya existen. Sin
componente nuevo: la tabla, las tarjetas rápidas y el cruce suscriptor↔contador son específicos de
esta pantalla (`VistaLector` no los comparte, tiene su propio `NuevaLecturaLector`/`HistorialLector`)
— extraerlos a un componente aparte sería una abstracción sin un segundo consumidor todavía, mismo
criterio que 030.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna nueva. Reutilizadas: `listarPeriodos()`, `listarSuscriptores()`, `listarLecturas()`,
`crearLectura()`, `revisarLectura()` (`frontend/lib/api.ts`, ya existen, sin cambios).

## 4. Contratos de `core/`

Ninguno. El cruce suscriptor↔contador (§3.1 del spec) es un `find()` sobre arreglos que el backend
ya devolvió completos — no es cálculo de dinero ni de consumo (eso ya pasó en `core/consumo.ts` al
guardar la lectura), es presentación.

### Mapeo de `Badge` por revisión — constante en el propio archivo

```ts
const BADGE_REVISION: Partial<Record<RevisionLectura, { variante: BadgeProps['variante']; etiqueta: string }>> = {
  consumo_bajo: { variante: 'warning', etiqueta: 'Consumo bajo' },
  consumo_alto: { variante: 'warning', etiqueta: 'Consumo alto' },
  consumo_cero: { variante: 'danger', etiqueta: 'Consumo cero' },
  // 'normal' deliberadamente ausente — sin Badge, spec §3.4
};
```

`Partial` porque `normal` no tiene entrada — el `.get()`/acceso indexado devuelve `undefined` y el
JSX simplemente no renderiza ningún `Badge` para esa fila, sin un `if` especial.

### Cruce suscriptor↔contador — función pura en el propio archivo, sin `useMemo`

```ts
function suscriptorDelContador(contadorId: string, suscriptores: Suscriptor[] | null): Suscriptor | null {
  return (suscriptores ?? []).find((s) => s.contador_actual_id === contadorId) ?? null;
}
```

Llamada dentro del `.map()` de la tabla, una vez por fila — mismo criterio de proporcionalidad que
030 §5 con el filtro de búsqueda: el arreglo de suscriptores es chico (`undreocol-producción` sigue
en 0 hoy), memoizar un `find()` sobre un arreglo chico no tiene evidencia de que haga falta.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Las dos tarjetas rápidas del spec (§3.2) son botones de **atajo** sobre la UI que ya existe debajo en la misma página (`onClick` hace `scrollIntoView` a la tarjeta correspondiente +, en el caso de "Anomalías", activa el checkbox `soloAnomalias`) — no abren un modal ni duplican el formulario | Un modal/acordeón separado para "ingreso rápido" | `VistaAdmin` ya muestra el formulario y la tabla siempre visibles (a diferencia de AquaLectura, que es por pestañas) — un atajo que solo desplaza el scroll es la forma más simple de cumplir la intención visual de la propuesta sin duplicar el formulario real |
| Formulario "Nueva lectura" (§3.5) pasa a usar `Input`/`Label` de `components/ui/` | Dejar los `<input>` con clases de Tailwind sueltas, como hoy | `Input`/`Label` ya son el patrón establecido en 11 formularios del proyecto (`suscriptor-form.tsx`, `contador-form.tsx`, `pago-form.tsx`, etc.) — no adoptarlo acá sería la única pantalla re-vestida que no los usa |
| Badge de revisión como `Partial<Record<...>>` con `normal` ausente, no un `switch`/`if` | `if (revision !== 'normal') { ... }` inline en el JSX | Mismo criterio que el mapeo estado→`Badge` de 030 (§5): una sola tabla de verdad para los 3 casos con `Badge`, en vez de una condición repetida donde se use |
| El cruce suscriptor↔contador se resuelve con `contador_actual_id` (el contador vigente hoy), no con el contador real que tenía el suscriptor en el momento histórico de esa lectura | Guardar/mostrar el suscriptor tal como estaba en el momento de la lectura | Mismo límite que ya documentó el spec (§7, riesgo 1): un reemplazo de contador (003 regla 7) puede desactualizar el cruce para lecturas viejas — aceptado y mostrado como "Sin suscriptor" en vez de inventar una relación histórica que esta pantalla no tiene forma de reconstruir sin tocar backend (fuera de alcance, spec §4) |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — sin cambios de backend.

## 8. Estrategia de pruebas

- **Unitarias/aislamiento:** no aplica (sin backend/`core/` nuevo).
- **Integración, verificable con evidencia real esta vez (Playwright + Chromium se puede instalar en
  este entorno, confirmado Sesión 056 — no hace falta dejarlo todo para Mateo):**
  - Con sesión de `admin_acueducto` real (o datos mockeados en una ruta de prueba temporal, mismo
    método que 036/038) y lecturas en los 4 valores de `revision`: cada fila y su `Badge` coinciden
    (CA-1, CA-2, CA-3).
  - Con sesión de `secretaria`: la tabla se ve, "Marcar revisada" no aparece (CA-4).
  - La tarjeta "Anomalías" muestra el conteo real y activar el atajo deja la tabla filtrada
    exactamente igual que el checkbox "Solo anomalías" (CA-5).
  - El formulario "Nueva lectura" re-vestido guarda una lectura real y muestra el mismo error que
    antes ante datos inválidos (CA-6, regresión).
- **Manual, requiere Mateo:** aspecto final en un celular/pantalla angosta real (el entorno puede
  emular viewport angosto con Playwright, pero el vistazo final en un dispositivo real sigue siendo
  de Mateo si lo quiere antes de dar la pantalla por cerrada).
