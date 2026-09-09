# PLAN — 022: despliegue-automático

**Spec aprobada:** 2026-09-09 (secretos ya creados: `CLOUDFLARE_API_TOKEN` con permiso de Workers,
`CLOUDFLARE_ACCOUNT_ID`).

**Estado de este plan:** EN REVISIÓN. Una decisión que la spec §4 dejó explícitamente abierta se
resuelve aquí, no se asume: **§0** abajo.

---

## 0. Decisión de la spec §4 — tests como gate antes de desplegar: APROBADO (2026-09-09)

Los tests/build/lint bloquean el despliegue si fallan — confirmado por Mateo. Además, pidió
explícitamente el diseño **más robusto posible** para minimizar la clase de error de hoy. Se agregan
tres capas más, cada una atacando un modo de fallo real y distinto de los que ya ocurrieron en esta
sesión:

1. **`wrangler deploy --dry-run` antes del deploy real** (los dos workflows). Detecta problemas de
   configuración (binding roto, `wrangler.toml` inválido) sin gastar un despliegue real ni arriesgar
   dejar el sitio a medias si algo sale mal a mitad de subida.
2. **Verificación post-despliegue automática que repite, en CI, exactamente lo que se hizo a mano hoy
   para encontrar la Sesión 035**: tras desplegar, `curl` contra la URL real de producción y `grep`
   sobre el paquete servido buscando la URL absoluta vieja de la API. Si aparece, el workflow falla —
   así el bug de hoy **no puede volver a llegar a producción sin que el pipeline lo detenga**, sin
   depender de que alguien lo note manualmente.
3. **Smoke test de `/salud`** (backend) y de `/login` (frontend) tras el despliegue: si el Worker
   recién publicado no responde `200`, el workflow termina en rojo — visibilidad inmediata de un
   despliegue roto, en vez de enterarse por un reporte de Mateo horas después.

---

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `.github/workflows/deploy-backend.yml` | crear | Despliega `backend/` a Cloudflare en cada push a `main` que lo toque |
| `.github/workflows/deploy-frontend.yml` | crear | Despliega `frontend/` a Cloudflare en cada push a `main` que lo toque |
| `.specify/config.md` | editar | Fila 022 |
| `CHANGELOG.md` | editar | Entrada de la sesión |

---

## 2. `deploy-backend.yml`

```yaml
name: deploy-backend

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - '.github/workflows/deploy-backend.yml'
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: deploy-backend
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx vitest run
      - run: npm run build
      - run: npm run lint
      - name: Dry-run antes del despliegue real
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler deploy --dry-run
      - name: Desplegar a Cloudflare Workers
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler deploy
      - name: Smoke test — /salud debe responder 200
        run: |
          sleep 5
          codigo=$(curl -s -o /dev/null -w '%{http_code}' https://undreocol-api.undreocol.workers.dev/salud)
          if [ "$codigo" != "200" ]; then
            echo "::error::/salud respondió $codigo tras el despliegue, se esperaba 200"
            exit 1
          fi
```

**Por qué `paths: backend/**`:** un push que solo toque `frontend/` o `docs/` no debe gastar minutos
de CI ni arriesgar un despliegue innecesario del backend (CA-1).

## 3. `deploy-frontend.yml`

```yaml
name: deploy-frontend

on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'
      - '.github/workflows/deploy-frontend.yml'
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: deploy-frontend
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      # Lección de la Sesión 035: un frontend/.env.production local e
      # invisible en git rompió el proxy de cookies por horas. Un checkout
      # de CI nunca debería tenerlo — si aparece, es una señal de que algo
      # se coló y hay que parar antes de desplegar, no seguir de largo.
      - name: Verificar que no exista un .env.production colado
        run: |
          if [ -f .env.production ]; then
            echo "::error::frontend/.env.production existe en el checkout. NEXT_PUBLIC_API_URL no debe definirse en producción (020) — aborta el despliegue. Ver CHANGELOG Sesión 035."
            exit 1
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run lint
      # pages:build, NUNCA build a secas — build a secas dejó el sitio en
      # 404 por minutos en la Sesión 021 (.open-next/worker.js no se genera).
      - run: npm run pages:build
      - name: Confirmar que .open-next/worker.js se generó
        run: test -f .open-next/worker.js
      - name: Confirmar que el paquete compilado NO llama a la API cruzando dominio
        # Repite, en CI, exactamente el `grep` manual que encontró la causa
        # raíz de la Sesión 035 — si vuelve a colarse NEXT_PUBLIC_API_URL
        # apuntando a la URL absoluta, esto detiene el despliegue antes de
        # que llegue a producción.
        run: |
          if grep -rl "undreocol-api.undreocol.workers.dev" .open-next/assets/_next/static/chunks/*.js 2>/dev/null; then
            echo "::error::El paquete compilado llama a la API cruzando dominio — revisar NEXT_PUBLIC_API_URL y que no exista .env.production. Ver CHANGELOG Sesión 035."
            exit 1
          fi
      - name: Dry-run antes del despliegue real
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler deploy --dry-run
      - name: Desplegar a Cloudflare Workers
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler deploy
      - name: Smoke test — /login debe responder 200 y sin la URL vieja
        run: |
          sleep 5
          codigo=$(curl -s -o /tmp/login.html -w '%{http_code}' https://undreocol-frontend.undreocol.workers.dev/login)
          if [ "$codigo" != "200" ]; then
            echo "::error::/login respondió $codigo tras el despliegue, se esperaba 200"
            exit 1
          fi
          if grep -q "undreocol-api.undreocol.workers.dev" /tmp/login.html; then
            echo "::error::/login en producción todavía referencia la URL absoluta de la API"
            exit 1
          fi
```

**Por qué no hay un paso `npm run build` separado:** `npm run pages:build` (`opennextjs-cloudflare
build`) ya ejecuta `next build` internamente — confirmado leyendo su salida real en esta sesión
("> undreocol-frontend@0.1.0 build > next build" aparece dentro de "OpenNext — Building Next.js
app"). Un paso aparte sería el mismo build dos veces.

---

## 4. Decisiones técnicas

### 4.1 Autenticación de `wrangler`

`wrangler` lee `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` del entorno automáticamente — mismo
mecanismo que ya usa `backup-diario.yml` (aunque ese workflow tenía sus secretos sin crear realmente;
corregido de paso al crear estos).

### 4.2 `concurrency` por workflow

Si dos pushes a `main` llegan seguidos (poco probable, pero posible), el segundo despliegue no debe
pisar al primero a mitad de subida. `cancel-in-progress: false`: se deja terminar el que ya está
corriendo y el nuevo espera su turno, en vez de cancelar un despliegue a medias (mismo criterio que
`backup-diario.yml`).

### 4.3 `workflow_dispatch` en los dos

Permite disparar un despliegue manual desde la pestaña Actions de GitHub sin necesitar un commit
vacío, para el caso de "quiero redesplegar esto tal cual está" (p. ej., si Cloudflare tuvo un
problema transitorio).

### 4.4 Qué NO cambia

`backend/wrangler.toml` y `frontend/wrangler.toml` no se tocan — los workflows nuevos ejecutan
exactamente los mismos comandos que Mateo corría a mano.

---

## 5. Dependencias nuevas

Ninguna en el código. `actions/checkout@v4` y `actions/setup-node@v4` son Actions estándar de GitHub,
ya usadas implícitamente por el ecosistema (no requieren secretos nuevos más allá de los dos ya
creados).

---

## 6. Estrategia de pruebas

**Real, con GitHub Actions de verdad** (no hay forma de simular esto localmente de forma útil):

1. Se activa este mismo cierre (T-003, que toca `.specify/config.md` y `CHANGELOG.md`, ninguno bajo
   `backend/` ni `frontend/`) para confirmar que **ningún** workflow de despliegue se dispara con un
   cambio que no les corresponde.
2. Un cambio trivial y real bajo `backend/` (o el propio primer push de este workflow, que si toca
   `backend/**` se autoactiva) para observar el job completo en la pestaña Actions: checkout, tests,
   build, lint, deploy.
3. Mismo criterio para `frontend/`.
4. Verificación final: `/login` en producción sigue respondiendo `200` después del primer despliegue
   automático real (CA-3, CA-5).

**Lo único verificable aquí, sin GitHub Actions real:** que el YAML es sintácticamente válido.

---

## 7. Lo que este plan NO hace

No agrega despliegues de preview por Pull Request. No agrega rollback automático. No toca
`backup-diario.yml` ni `semgrep.yml`. No resuelve por qué `backup-diario.yml` llevaba fallando en
silencio (sus secretos no existían) — se deja anotado para revisar aparte, fuera de esta feature.
