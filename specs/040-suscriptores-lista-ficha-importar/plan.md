# PLAN — 040: suscriptores-lista-ficha-importar

**Spec aprobado:** 2026-09-16

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/suscriptores/page.tsx` | Modificado | `page-head`, búsqueda cliente-side, tabla con `Badge` de estado |
| `frontend/app/app/suscriptores/[id]/page.tsx` | Modificado | `page-head`, `Badge` en estado/historial, botón "Editar" que alterna a `EditarSuscriptorForm`, vista de solo lectura completa (§3.4) |
| `frontend/app/app/suscriptores/importar/page.tsx` | Modificado | Solo `page-head` del contenedor — `ImportacionMapeo`/`ImportacionResumen` sin tocar |
| `frontend/components/editar-suscriptor-form.tsx` | Nuevo | Formulario de edición — mismo patrón que `suscriptor-form.tsx` |
| `frontend/components/suscriptor-form.tsx` | Modificado | Se exporta la constante `CATEGORIAS` (hoy local, sin `export`) para reutilizarla en `editar-suscriptor-form.tsx` — una sola línea, sin cambiar su comportamiento |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero archivos de backend — `PATCH /suscriptores/:id` ya existe y ya funciona
(`backend/src/lib/suscriptores.ts:145-158`, `backend/src/index.ts:1011-1031`), confirmado leyendo el
código real antes de este plan. Cero cambios de esquema.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna nueva. `PATCH /suscriptores/:id` ya existe — acepta exactamente `nombre, estado,
tipo_documento, numero_documento, telefono, email, direccion, sector, categoria, notas`
(`validarCamposEditables` solo bloquea `codigo_suscriptor`, confirmado contra el código real). El
frontend nunca manda `estado` desde el formulario nuevo (spec §3.3) — el backend lo permitiría, mismo
criterio que ya documentó el spec.

## 4. Contratos de `core/`

Ninguno.

### `frontend/components/editar-suscriptor-form.tsx` — contrato

```ts
interface EditarSuscriptorFormProps {
  suscriptor: Suscriptor;      // valores iniciales — el form arranca pre-llenado, CA-3
  onActualizado: (suscriptor: Suscriptor) => void;
  onCancelar: () => void;
}
export function EditarSuscriptorForm(props: EditarSuscriptorFormProps): JSX.Element
```

Mismo patrón que `suscriptor-form.tsx`: `<form onSubmit>`, `Input`/`Label`/`Button`,
`useHidratado()` + `disabled={!hidratado || cargando}` (CLAUDE.md §7, obligatorio por ser un
`<form onSubmit>` nuevo). Un campo por cada uno de los 9 editables (spec §3.3); `categoria` es
`<select>` con la misma constante `CATEGORIAS` que ya usa `suscriptor-form.tsx` (se exporta esa
constante desde ahí en vez de duplicarla). Llama a `actualizarSuscriptor(suscriptor.id, datos)` —
solo manda los campos que cambiaron respecto al valor inicial (evita un `PATCH` con 9 claves cuando
el admin tocó una sola), y nunca incluye `codigo_suscriptor` ni `estado` (no hay campo para
ninguno de los dos, CA-5).

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| El `PATCH` solo manda los campos que cambiaron (diff contra el `suscriptor` inicial), no los 9 siempre | Mandar siempre los 9 campos del formulario | Evita sobrescribir con el mismo valor por accidente si dos administradores editan casi al mismo tiempo (sin optimistic locking en esta tabla) — mandar menos es estrictamente más seguro, sin costo extra |
| "Editar" alterna entre vista de solo lectura y formulario en la misma tarjeta "Datos" (mismo patrón que "Ver/Ocultar etiqueta QR" ya usa esta pantalla) | Modal aparte, o navegar a `/app/suscriptores/[id]/editar` | Consistencia con el patrón de alternancia que la propia ficha ya usa hoy — no introduce un segundo patrón de interacción en la misma pantalla |
| `categoria` reutiliza la constante `CATEGORIAS` exportada desde `suscriptor-form.tsx`, no duplicada | Redefinir la lista en `editar-suscriptor-form.tsx` | Una sola fuente de verdad para las 9 categorías tarifarias — evita que las dos listas diverjan si se agrega una categoría nueva |
| `Badge` de `estado` (suscriptor y eventos de corte/reconexión) como constante `Record`, mismo criterio que 030/039 | `switch`/`if` inline | Consistencia con el patrón ya establecido en las pantallas anteriores del rediseño |
| Búsqueda de la lista (§3.1) sin `useMemo`, mismo criterio que 030/032/039 | `useMemo` | Arreglo chico, sin evidencia de que haga falta (`undreocol-producción` en 0 hoy) |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — sin cambios de backend.

## 8. Estrategia de pruebas

- **Unitarias/aislamiento:** no aplica (sin backend/`core/` nuevo).
- **CA-5 verificable por tipos + inspección, sin ejecutar nada:** `EditarSuscriptorFormProps` y el
  cuerpo del componente no declaran ningún estado ni input para `codigo_suscriptor`/`estado` — no
  hay forma de que el `PATCH` los incluya porque no existen en el estado del formulario.
- **Integración manual (`wrangler dev` + `next dev` reales), con evidencia real:**
  - CA-4: cambiar el teléfono de un suscriptor real, guardar, recargar la página y confirmar contra
    `GET /suscriptores/:id` (o consulta SQL directa) que el valor nuevo persistió.
  - CA-3: abrir "Editar" en un suscriptor con `telefono`/`email`/`sector`/`notas` cargados y
    confirmar que el formulario arranca con esos valores, no vacío.
  - CA-6: ejecutar un corte/reconexión real antes y después del re-vestido, mismo resultado.
  - CA-7: importar un archivo Excel real de punta a punta.
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (mismo criterio de
  proporcionalidad que 039 — riesgo bajo, re-vestido + un formulario CRUD simple ya cubierto por
  tipos/build).
