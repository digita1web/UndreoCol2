# PLAN — 030: facturacion-lista

**Spec aprobado:** 2026-09-12

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/facturacion/page.tsx` | Modificado | `page-head` con selector/Simular/Confirmar reubicados, resumen de urgencia (§3.5b), filtros de búsqueda/estado, tabla con `Badge`, estado "No autorizado" para `lector` |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero archivos de backend — spec §3.1, confirmado: se usan los mismos endpoints que ya existen. Sin
componente nuevo: la tabla y los filtros son específicos de esta pantalla (el detalle de factura,
030 fuera de alcance, no los reutiliza) — extraerlos a un componente aparte sería una abstracción
sin un segundo consumidor todavía.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna nueva. Reutilizadas: `GET /facturacion/periodos`, `GET /facturacion/periodos/:id/facturas`,
`POST /facturacion/periodos/:id/simular`, `POST /facturacion/periodos/:id/emitir`,
`POST /facturacion/periodos/:id/enviar-correo`, `GET /dashboard` (vía `obtenerContextoUsuario()`,
ya se usa hoy para `rol`).

## 4. Contratos de core/

Ninguno. El resumen de urgencia (§3.5b) es una suma de valores que el backend ya calculó y devolvió
(`total`, `total_pagado` de cada factura) — agregarlos en el cliente para mostrarlos no es "calcular
dinero" en el sentido de CLAUDE.md §5.3 (eso ya pasó en `core/facturacion.ts` al emitir), es
aritmética de presentación sobre cifras ya autoritativas. No aplica un test de `core/` porque no hay
código nuevo ahí.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| El estado "No autorizado" del `lector` reutiliza el markup/tono exacto de `frontend/app/app/dashboard/page.tsx:150-158` (misma tarjeta, mismo enlace a `/app/lecturas`), solo cambia el texto a "Las facturas del acueducto son visibles solo para quien administra la facturación" | Redactar un mensaje nuevo | Consistencia visual y de tono entre pantallas — el usuario ya vio este patrón en el Panel principal |
| Filtro de búsqueda/estado con `useState` + `.filter()` sobre el arreglo `facturas` ya cargado, sin `useMemo` explícito (el arreglo por periodo es chico — 0 suscriptores hoy, sin evidencia de que haga falta memoizar) | `useMemo`/librería de tablas (ej. TanStack Table) | Cero dependencias nuevas para un filtro simple; cuando el volumen real lo justifique, es un cambio interno sin tocar el contrato con el usuario |
| Mapeo estado→`Badge` como constante `Record<EstadoFactura, { variante: BadgeProps['variante']; etiqueta: string }>` en el propio archivo | Función `switch` inline repetida en cada uso | Un solo lugar para los 4 casos, ya usados dos veces (tabla + resumen de urgencia si hiciera falta ahí) |
| El resumen de urgencia (§3.5b) sale solo si `facturas` tiene al menos una `vencida` — no se muestra en $0 ni "0 facturas vencidas" | Mostrarlo siempre, con "0 facturas vencidas" cuando no hay | Una franja de alerta que dice "todo bien" no es una alerta — ruido visual sin valor cuando no hay urgencia que señalar |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — sin cambios de backend.

## 8. Estrategia de pruebas

- **Unitarias/aislamiento:** no aplica (sin backend/`core/` nuevo).
- **Integración (manual, `wrangler dev` + `next dev` reales):**
  - Con sesión de `admin_acueducto` real y un periodo con facturas en los 4 estados (fixture o
    datos reales): comparar cada fila y su `Badge` contra la respuesta cruda de
    `GET /facturacion/periodos/:id/facturas` (CA-1, CA-2).
  - Tipear en el buscador y cambiar el filtro de estado sin ver ninguna petición de red nueva en
    las herramientas de desarrollador (CA-3).
  - Simular → Confirmar emisión de punta a punta, mismo resultado que antes del re-vestido (CA-4,
    regresión).
  - Con al menos una factura `vencida` con `total_pagado > 0`: el resumen de urgencia muestra el
    saldo (`total - total_pagado`), no el `total` (CA-7).
  - Con sesión de `lector` real: `/app/facturacion` muestra "No autorizado" sin listar nada (CA-5,
    y confirma que cierra la degradación silenciosa descrita en spec §3.6).
  - Botón "Ver" de una fila cualquiera lleva a `/app/facturacion/{id}` con el `id` correcto (CA-6).
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (sigue sin
  Chromium/Playwright en este entorno).
