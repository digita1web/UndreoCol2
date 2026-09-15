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
3. **CA-1, CA-2, CA-4, CA-5, CA-6 — verificados con Playwright + Chromium real (instalado en este
   entorno específicamente para esto), contra `npm run dev` real y un mock mínimo de `POST
   /lecturas`** (no contra `wrangler dev`/Postgres — decisión deliberada, ver nota de fidelidad
   abajo). Metodología: dos rutas temporales (`app/test-038-temporal/`, `app/test-036-temporal/`)
   renderizando los componentes reales de producción sin cambios, **nunca commiteadas, borradas
   antes de cerrar la tarea** (`git status` limpio lo confirma). Conectividad simulada bloqueando
   solo el origen del backend vía `page.route()` + disparo manual del evento `online`/`offline`
   (no `context.setOffline()`, que bloquea también los recursos de la propia app — más estricto
   que la señal real de un celular, spec §4: el app-shell offline nunca fue una promesa de esta
   feature). Las 9 aserciones de 038 (CA-1×2, CA-6, CA-4, CA-2, CA-5×4) pasaron todas. Detalle,
   script y log completo en `CHANGELOG.md` de esta sesión.
   **Nota de fidelidad:** esto prueba la lógica real (IndexedDB, el hook, la clasificación de
   errores, el drenado) contra un mock del backend, no contra el backend real de UndreoCol — sigue
   sin ser la prueba con un celular Android real y señal real que pedía el spec (§8), pero es
   evidencia bastante más fuerte que "no verificado".
4. **Bug real encontrado durante esta verificación (no en producción, en el arnés de prueba):**
   la primera versión de la página de prueba pasaba un callback sin memoizar a
   `useColaLecturasOffline()`, lo que confirmó que el hook depende de que el caller estabilice su
   callback (igual que cualquier hook de React) — `VistaLector` real ya lo hace bien
   (`recargarLecturasAbiertas` con `useCallback([periodoAbierto])`), así que esto no afectaba el
   código de producción, pero quedó documentado como una dependencia real del contrato del hook.

**Estado:** HECHO — Sesión 056. T-001/T-002 implementados directamente por Claude (autorización
expresa de Mateo, no pasó por Luna). T-003 cerrado con verificación real de navegador (Playwright)
para CA-1/CA-2/CA-4/CA-5/CA-6, además de build/lint/knip/tests/dry-run en verde en ambos proyectos.
Solo queda pendiente la prueba con un celular Android real y señal real (spec §8) — no algo que
este entorno pueda simular con evidencia honesta.
