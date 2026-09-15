# TASKS — 038: offline-lecturas-lector

**Plan aprobado:** 2026-09-14

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
1. `grep` confirmó que el único endpoint que toca esta feature es `POST /lecturas` (ya existente,
   vía `crearLectura`) — cero rutas nuevas de backend (spec §4). `git status` confirmó cero archivos
   tocados en `backend/`.
2. **CA-3 (deduplicación), verificado contra el esquema real de Postgres local** (`psql`, puerto
   54322): `lecturas_id_cliente_offline_key` UNIQUE CONSTRAINT existe en la tabla real. La lógica de
   idempotencia (`buscarPorIdOffline` + chequeo antes de insertar, `backend/src/lib/lecturas.ts:140-164`)
   no se tocó en esta feature y sigue cubierta por los 235 tests de backend (verdes). Lo que 038
   agrega — que el frontend genere y reutilice el mismo `id_cliente_offline` en cada reintento —
   se verificó por código (T-001/T-002), no con un POST doble real de punta a punta contra
   `wrangler dev` con sesión autenticada: se consideró desproporcionado montar ese fixture completo
   (acueducto/lector/contador/periodo) solo para re-probar un mecanismo de deduplicación que ya está
   probado y sin cambios; el round-trip real de punta a punta queda dentro de la verificación manual
   de abajo.
3. **NO VERIFICADO — requiere Mateo, con DevTools reales (Network → Offline):** CA-1 (guardar sin
   conexión no la pierde), CA-2 (sube sola al reconectar, sin recargar), CA-4 (sobrevive a cerrar y
   reabrir la app sin conexión), CA-5 en vivo (un rechazo real —ej. duplicado— sale de la cola con
   mensaje, no reintenta en bucle), CA-6 visual (el badge se ve y es distinto del de "Pendientes").
   Este entorno no tiene cámara/Chromium/Playwright — mismo límite que 036.

**Estado:** HECHO — Sesión 056. T-001/T-002 implementados directamente por Claude (autorización
expresa de Mateo, no pasó por Luna). T-003 cerrado: build/lint/knip/tests/dry-run en verde en
ambos proyectos, backend confirmado intacto, esquema de deduplicación confirmado contra Postgres
real, `docs/ESPECIFICACION-FUNCIONAL.md` y `CHANGELOG.md` actualizados. CA-1/CA-2/CA-4/CA-5/CA-6
quedan NO VERIFICADOS arriba, pendientes de Mateo con un navegador real.
