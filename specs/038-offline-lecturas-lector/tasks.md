# TASKS — 038: offline-lecturas-lector

**Plan aprobado:** 2026-09-15

Una tarea = un commit. Sin evidencia no hay commit.

**Quién ejecuta:** Claude, directamente (autorización expresa de Mateo, no pasa por Luna — mismo
acuerdo que 036).

---

## T-001 — Cola offline: módulo IndexedDB + hook

**Archivos:** `frontend/lib/use-cola-lecturas-offline.ts` (nuevo)

**Hace:** Implementa el contrato completo de `plan.md` §4: wrapper de IndexedDB (`abrir`,
`agregar`, `listar`, `actualizar`, `quitar` sobre la tabla `cola`) y el hook
`useColaLecturasOffline(alSincronizarUna)` — drena la cola al montar y en cada evento `online`,
distingue `ErrorPeticion` (marca `rechazada`, sigue con la siguiente) de un fallo de red real (corta
el ciclo, deja el resto `pendiente`).

**Verificación:**
```
cd frontend && npm run build && npm run lint && npm run knip
```
Más un script de Node suelto (no un archivo de test permanente, plan.md §8) que ejercite
`clasificarError()` — o la función interna equivalente — contra un `ErrorPeticion` simulado y
contra un `TypeError` simulado, confirmando que cada uno toma la rama que dice el plan.

**Resultado esperado:** build/lint/knip limpios; el script de clasificación imprime que ambos casos
toman la rama correcta.

**Estado:** Pendiente

---

## T-002 — Cablear la cola en AquaLectura

**Archivos:** `frontend/components/lector/nueva-lectura-lector.tsx`,
`frontend/components/lector/shell-lector.tsx`, `frontend/app/app/lecturas/page.tsx`

**Hace:**
- `VistaLector` (`page.tsx`) instancia `useColaLecturasOffline(recargarLecturasAbiertas)`, pasa
  `sinSubirCount` a `ShellLector` y `{ rechazadas, encolar, descartar }` a `NuevaLecturaLector`.
- `NuevaLecturaLector.alGuardar` genera `id_cliente_offline` con `crypto.randomUUID()` siempre;
  ante `ErrorPeticion` muestra el error como hoy; ante cualquier otro fallo, llama a `encolar(...)`
  y muestra "Lectura guardada. Se subirá sola cuando haya señal." Lista las `rechazadas` con su
  `errorRechazo` y un botón "Descartar".
- `ShellLector` recibe `sinSubirCount?: number` y lo muestra como badge junto al indicador "En
  línea/Sin conexión" — visualmente distinto del badge existente de la pestaña "Pendientes"
  (`pendientesCount`, CA-6: no reusar el mismo contador ni texto).

**No toca:** `EscanerQrContador`, `SugerirLecturaFoto`, `crearLectura`, la validación existente del
formulario, ni ninguna ruta de backend.

**Verificación:**
```
cd frontend && npm run build && npm run lint && npm run knip
cd ../backend && npm test && npm run build && npm run lint && npx wrangler deploy --dry-run
```
Backend se corre igual para confirmar que de verdad no se tocó (plan.md §1).

**Resultado esperado:** todo en verde, sin hallazgos nuevos de Knip, backend intacto (mismos 235
tests).

**Estado:** Pendiente

---

## T-003 — Cierre: verificación real, especificación funcional, CHANGELOG

**Archivos:** `docs/ESPECIFICACION-FUNCIONAL.md`, `CHANGELOG.md`

**Verificación real, además de T-001/T-002:**
1. `grep` confirmando que el único endpoint nuevo llamado es `POST /lecturas` (ya existente) —
   cero rutas nuevas de backend (spec §4).
2. **CA-3 (deduplicación) contra Postgres real, sin depender de un navegador:** si este entorno
   tiene acceso a una base de desarrollo, `select count(*) from lecturas where id_cliente_offline =
   '...'` tras simular dos envíos con el mismo id debe devolver 1.
3. **NO VERIFICADO — requiere Mateo, con DevTools reales (Network → Offline):** CA-1 (guardar sin
   conexión no la pierde), CA-2 (sube sola al reconectar, sin recargar), CA-4 (sobrevive a cerrar y
   reabrir la app sin conexión), CA-5 en vivo (un rechazo real —ej. duplicado— sale de la cola con
   mensaje, no reintenta en bucle), CA-6 visual (el badge se ve y es distinto del de "Pendientes").
   Este entorno no tiene cámara/Chromium/Playwright — mismo límite que 036.

**Estado:** PENDIENTE — sin empezar todavía.
