# PLAN — 027: panel-principal

**Spec aprobado:** 2026-09-10

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/components/indicadores-dashboard.tsx` | Modificado | Las 4 tarjetas pasan a `KpiCard`; gráfico y "Suscriptores por estado" re-vestidos con los tokens de 026 |
| `frontend/app/app/dashboard/page.tsx` | Modificado | Encabezado con eyebrow + saludo real; el estado "No autorizado" se re-viste |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero archivos de backend — spec §3.1, confirmado: se usan los mismos dos endpoints que ya existen.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna nueva. Reutilizadas: `GET /dashboard`, `GET /dashboard/indicadores`.

## 4. Contratos de core/

Ninguno.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| **Mejora propia:** "Recaudo del mes" muestra una variación real (`↑/↓ N% vs. mes anterior`), calculada en el cliente a partir de los últimos dos elementos de `tendencia` (ya se pide para el gráfico, sin llamada nueva) | Copiar el `↑ 12,4%` fijo de la propuesta como texto decorativo, igual en las 4 tarjetas | La propuesta usa esos porcentajes como relleno de diseño — no hay dato real detrás en ninguna tarjeta salvo "Recaudo del mes", que sí tiene una serie de 12 meses ya disponible. Poner un número que se ve real pero no lo es, en un panel de dinero real de gente real, es peor que no ponerlo (CLAUDE.md, "los datos que maneja son dinero real"). Las otras 3 tarjetas (`carteraVencida`, `carteraPendiente`, `consumoPromedioUltimoPeriodo`) no tienen serie histórica en la respuesta de hoy — no se les inventa una |
| Sin variación cuando el mes anterior fue $0 (acueducto nuevo, sin historial) | Mostrar `+∞%` o dividir por cero | Un porcentaje contra cero no informa nada real; se omite la línea de variación en ese caso, la tarjeta muestra solo el valor |
| "Cartera" se separa en dos `KpiCard` (vencida / por vencer), como en la propuesta | Mantener una sola tarjeta "Cartera" con las dos cifras adentro (como hoy) | Ya lo decidió el spec (§3.3) — cada cifra con su propio color semántico (`danger`/`warning`) se lee más rápido que dos líneas dentro de la misma tarjeta |
| El gráfico de tendencia sigue siendo el mismo CSS puro (D-5), solo cambia `bg-blue-600` por `bg-accent` | Reescribirlo con una librería de gráficos | Ya funciona y es cero-dependencias; no hay razón de negocio para tocar la implementación, solo el color |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — sin cambios de backend.

## 8. Estrategia de pruebas

- **Unitarias/aislamiento:** no aplica.
- **Integración (manual, `wrangler dev` + `next dev` reales):** con sesión de `admin_acueducto`
  real, comparar la respuesta HTTP cruda de `GET /dashboard/indicadores` contra lo que renderiza
  cada `KpiCard` (CA-1); confirmar que la variación de "Recaudo del mes" coincide con el cálculo
  manual de `(actual - anterior) / anterior` sobre los mismos dos valores de `tendencia` que trae
  esa misma respuesta. Con sesión de `lector`, confirmar que "No autorizado" se sigue mostrando sin
  ninguna cifra (CA-4, regresión).
- **Manual, requiere Mateo:** aspecto visual final en un navegador real (sigue sin
  Chromium/Playwright en este entorno).
