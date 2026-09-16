# PLAN — 042: cortes-vista

**Spec aprobado:** 2026-09-16

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/app/app/cortes/page.tsx` | Modificado | `page-head`, tabla con `Badge danger` fijo, enlace "Ver ficha" en vez de fila-enlace completa |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero backend, cero componentes nuevos, cero cambios a `listarCandidatosCorte()`.

## 2-3. Esquema / Rutas de la API

Ninguno nuevo.

## 4. Contratos de `core/`

Ninguno.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `Badge danger` fijo para todas las filas (no un `Record` con múltiples niveles) | Gradiente de colores por días de mora | Spec §3.1: sin el umbral configurado disponible en el frontend, no hay una base real para graduar "más" o "menos" urgente — todo lo que aparece ya superó el umbral real (filtrado server-side) |
| El enlace pasa de "toda la fila es `<a>`" a un enlace "Ver ficha →" al final de la fila, dentro de una `<table>` real | Mantener la fila completa como `<a>` | Mismo patrón de tabla que 030/039/040/041 (columnas + acción al final) — una `<tr>` no puede ser un `<a>` válido semánticamente, a diferencia del `<div>` que usaba la versión anterior |

## 6-7. Dependencias / Límites de Workers

Ninguna. No aplica.

## 8. Estrategia de pruebas

- **Integración manual (`wrangler dev` + `next dev` reales):** con candidatos reales, confirmar que
  la tabla coincide con `listarCandidatosCorte()` (CA-1) y que "Ver ficha" lleva al `id` correcto
  (CA-2).
- **Manual, requiere Mateo:** aspecto visual final (mismo criterio de proporcionalidad que
  039/040/041).
