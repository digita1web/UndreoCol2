# PLAN — 043: notificaciones-vista

**Spec aprobado:** 2026-09-16

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/notificaciones/page.tsx` | Modificado | `page-head`, filtros reubicados, `Badge` de estado en vez de texto con color condicional |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero backend, cero componentes nuevos, cero cambios a `listarNotificaciones()`.

## 2-3. Esquema / Rutas de la API

Ninguno nuevo.

## 4. Contratos de `core/`

Ninguno.

### `Badge` de estado — constante en el propio archivo

```ts
const BADGE_ESTADO: Record<EstadoNotificacion, { variante: 'success' | 'warning' | 'danger' | 'gray'; etiqueta: string }> = {
  enviada: { variante: 'success', etiqueta: 'Enviada' },
  fallida: { variante: 'danger', etiqueta: 'Fallida' },
  pendiente: { variante: 'warning', etiqueta: 'Pendiente' },
  cancelada: { variante: 'gray', etiqueta: 'Cancelada' },
};
```

Reemplaza `ETIQUETAS_ESTADO` (solo texto) — mismo set de 4 claves, ahora con la variante de `Badge`
incluida en el mismo lugar.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Se mantiene el layout de lista (spec §3.2), con `Badge` reemplazando el `<span>` de color condicional | Forzar una `<table>` como 039-042 | Documentado en el spec — más detalle por fila del que una tabla limpia puede mostrar sin una vista de "Detalle" nueva |
| `BADGE_ESTADO` sustituye a `ETIQUETAS_ESTADO` (no coexisten) | Mantener `ETIQUETAS_ESTADO` aparte y consultar las dos constantes | Una sola fuente de verdad por estado — la etiqueta de texto ya está incluida en `BADGE_ESTADO`, mantener las dos sería duplicar el mismo mapeo |

## 6-7. Dependencias / Límites de Workers

Ninguna. No aplica.

## 8. Estrategia de pruebas

- **CA-1 verificable por tipos:** `BADGE_ESTADO` es `Record<EstadoNotificacion, ...>` completo —
  `npm run build` ya prueba que cubre los 4 valores reales.
- **Integración manual (`wrangler dev` + `next dev` reales):** CA-2 (cambiar los filtros sigue
  llamando a `listarNotificaciones` igual), CA-3 (ninguna información se perdió).
- **Manual, requiere Mateo:** aspecto visual final (mismo criterio de proporcionalidad que las
  pantallas anteriores del rediseño).
