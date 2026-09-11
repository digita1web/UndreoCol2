# PLAN — 029: autorización temporal de tarifas para `secretaria`

**Spec aprobado:** 2026-09-10

## Archivos

| Archivo | Acción |
|---|---|
| `supabase/migrations/20260924090000_autorizacion-tarifas-secretaria.sql` | Nuevo: autorizaciones, bitácora, RLS y RPC de uso único |
| `backend/src/index.ts` | Modificar: endpoints de crear/listar/revocar autorizaciones y tarifa autorizada |
| `backend/src/lib/catalogo.ts` | Modificar: acceso a autorizaciones y RPC autorizada |
| `frontend/lib/api.ts` | Modificar: contratos y llamadas nuevas |
| `frontend/components/tarifa-form.tsx` | Modificar: soporte para autorización |
| `frontend/app/app/catalogo/[servicioId]/page.tsx` | Modificar: gestión admin y uso secretaria |
| `tests/aislamiento/016_autorizacion_tarifas_aislamiento.sql` | Nuevo: matriz de aislamiento y uso único |
| `CHANGELOG.md` | Modificar |

## Seguridad

No se concede `INSERT`/`UPDATE` general sobre `tarifas` a `secretaria`. La única
puerta es `usar_autorizacion_tarifa()`, `SECURITY DEFINER`, con `search_path`
fijo, bloqueo `FOR UPDATE` de la autorización, comprobación de rol/cliente/
servicio/categoría/expiración/revocación/uso previo y escritura de la bitácora
en la misma transacción.

La autorización se consume antes de devolver éxito. Si falla cualquier escritura,
la transacción revierte también el consumo y la bitácora.

## Mejora adicional

Autorización de un solo uso + bitácora inmutable. Esto evita que una aprobación
temporal se convierta accidentalmente en permiso permanente y permite auditar
quién autorizó, quién ejecutó, qué valores aplicó y cuándo.

## Verificación

- reset local desde cero;
- fixtures 001-002;
- `tests/aislamiento/016_autorizacion_tarifas_aislamiento.sql`;
- tests backend, frontend, lint, build y Wrangler dry-run.