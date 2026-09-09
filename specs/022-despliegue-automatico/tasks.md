# TASKS — 022: despliegue-automático

**Spec aprobada:** 2026-09-09. **Plan aprobado:** 2026-09-09 (incluidas las 3 capas de robustez del
§0: dry-run, verificación anti-regresión de la Sesión 035, smoke tests post-despliegue).

Una tarea = un commit. El primer push de cada workflow se autoactiva (toca `backend/**` o
`frontend/**`) — su propia ejecución en GitHub Actions ES la verificación real, no hay forma de
simularla útilmente aquí.

---

## T-001 — `deploy-backend.yml`

**Archivos:** `.github/workflows/deploy-backend.yml` (crear)
**Hace:** (plan §2) Push a `main` que toque `backend/**` → checkout, Node 22, `npm ci`, `vitest run`,
`build`, `lint`, `wrangler deploy --dry-run`, `wrangler deploy`, smoke test de `/salud`.

**Verificación:**
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-backend.yml'))" && echo "YAML válido"
```
Real: este commit toca `backend/`... no, este commit SOLO toca el workflow — para que se autoactive
sin esperar a un cambio de código real, el `paths` incluye el propio archivo del workflow (plan §2).
**Resultado esperado:** YAML válido; al publicarse, la pestaña Actions de GitHub muestra el job
completo en verde, terminando en el smoke test de `/salud`.
**Estado:** COMPLETADO (verificación de sintaxis; la ejecución real en Actions queda pendiente de que
Mateo confirme tras el push)
**Evidencia:**
```
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-backend.yml'))"
-> deploy-backend.yml: YAML válido
```
**NO VERIFICADO — requiere Mateo:** confirmar en la pestaña Actions de GitHub que el job corrió
completo en verde tras publicarse.
**Commit:** se registra en la Bitácora de cierre (T-003)

---

## T-002 — `deploy-frontend.yml`

**Archivos:** `.github/workflows/deploy-frontend.yml` (crear)
**Hace:** (plan §3) Push a `main` que toque `frontend/**` → checkout, verificación de
`.env.production` colado, Node 22, `npm ci`, `lint`, `pages:build`, verificación de que
`.open-next/worker.js` existe, verificación anti-regresión de la URL absoluta de la API en el
paquete compilado, `wrangler deploy --dry-run`, `wrangler deploy`, smoke test de `/login`.

**Verificación:**
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-frontend.yml'))" && echo "YAML válido"
```
**Resultado esperado:** YAML válido; al publicarse, el job completo en verde en Actions, terminando
en el smoke test de `/login` sin la URL vieja.
**Estado:** COMPLETADO (verificación de sintaxis; la ejecución real en Actions queda pendiente de que
Mateo confirme tras el push)
**Evidencia:**
```
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-frontend.yml'))"
-> deploy-frontend.yml: YAML válido
```
**NO VERIFICADO — requiere Mateo:** confirmar en la pestaña Actions de GitHub que el job corrió
completo en verde tras publicarse.
**Commit:** se registra en la Bitácora de cierre (T-003)

---

## T-003 — Cierre: documentación

**Archivos:** `.specify/config.md` (fila 022), `CHANGELOG.md`, `specs/022-.../spec.md` (CA-1 a CA-5
con evidencia), este `tasks.md` (bitácora).
**Hace:** Cierra la feature. Este commit, al no tocar `backend/` ni `frontend/`, es en sí mismo la
prueba de CA-1/CA-2 combinada (que ningún workflow se dispara por un cambio que no le corresponde) —
se confirma revisando que la pestaña Actions no muestra una ejecución nueva para este push.
**Verificación:** revisión del diff completo + pestaña Actions de GitHub (sin ejecuciones nuevas).
**Estado:** COMPLETADO
**Evidencia:**
```
.specify/config.md: fila 022 agregada (y corregida la 020 desactualizada,
  y agregada la 021 que había quedado sin fila desde su propia sesión).
CHANGELOG.md: Sesión 036 completa.
spec.md: checklist §8 actualizado, CA-1 a CA-5 marcados explícitamente
  como pendientes de confirmación real de Mateo tras el push.
```
**Commit:** se registra en la Bitácora de cierre (T-003)

---

## Bitácora de cierre

| Tarea | Commit | Estado |
|---|---|---|
| T-001 `deploy-backend.yml` | `5448193` | COMPLETADO |
| T-002 `deploy-frontend.yml` | `1744e44` | COMPLETADO |
| T-003 cierre | este commit | COMPLETADO |

### Pendiente de Mateo

1. Confirmar en la pestaña **Actions** de GitHub que los dos workflows corrieron en verde tras
   publicarse (CA-1 a CA-5).
2. Revisar aparte, fuera de esta feature: por qué `backup-diario.yml` llevaba fallando en silencio
   (sus secretos no existían hasta hoy) — ahora que `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` sí
   existen, ese workflow también debería empezar a funcionar, pero le sigue faltando
   `SUPABASE_DB_URL`.
