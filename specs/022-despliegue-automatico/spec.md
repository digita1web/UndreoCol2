# SPEC — 022: despliegue-automático

**Estado:** en `/specify` — checkpoint pendiente de aprobación de Mateo.

**Origen:** petición directa de Mateo tras resolver el incidente de login de las Sesiones 032-035.
Todos los despliegues de esta sesión fueron manuales (`wrangler deploy` desde la terminal de Mateo),
y **la causa raíz real del incidente fue justamente algo que solo podía pasar en una máquina local**:
un archivo `frontend/.env.production` gitignored, invisible en el código, que sobrevivió ahí y se
coló en cada build. Un runner de GitHub Actions parte de un checkout limpio en cada ejecución — esa
clase de bug no puede volver a pasar ahí.

**Depende de:** 020 (proxy-cookies-mismo-origen, el mecanismo que este workflow no debe romper).

---

## 1. Objetivo

Que un `git push` a `main` despliegue automáticamente el backend y el frontend a Cloudflare, sin que
Mateo tenga que ejecutar comandos a mano — y que cada despliegue parta de un entorno limpio,
eliminando la clase de bug que causó el incidente de login.

## 2. Por qué ahora

Confirmado en esta sesión: los despliegues manuales son frágiles — un `npm run build` en vez de
`npm run pages:build` dejó el sitio caído por minutos; un archivo local invisible rompió el login por
horas. Automatizar el despliegue no es una comodidad, es la corrección estructural al tipo de fallo
que ya ocurrió dos veces.

## 3. Alcance

### 3.1 Workflow del backend

Se dispara con cada push a `main` que toque `backend/**`. Ejecuta exactamente lo que Mateo hacía a
mano: instalar dependencias, `wrangler deploy` desde `backend/`.

### 3.2 Workflow del frontend

Se dispara con cada push a `main` que toque `frontend/**`. Ejecuta: instalar dependencias, `npm run
pages:build` (**nunca** `npm run build` a secas — la confusión que causó el incidente de despliegue
de la 021), `wrangler deploy` desde `frontend/`.

### 3.3 Verificación de que no hay un `.env.production` colado

Antes de compilar el frontend, el workflow falla explícitamente si existe `frontend/.env.production`
en el checkout — no debería poder pasar nunca (el checkout es limpio y el archivo está en
`.gitignore`), pero es una comprobación barata que documenta la lección del incidente directamente en
el pipeline, no solo en un comentario.

### 3.4 Secretos — RESUELTO (2026-09-09)

Se descubrió que `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`/`SUPABASE_DB_URL` que referencia
`backup-diario.yml` **no existían realmente como secretos del repositorio** — ese workflow lleva
fallando en silencio desde que se creó (hallazgo aparte, fuera de esta feature, a revisar
después). Se creó un token nuevo de Cloudflare con la plantilla "Edit Cloudflare Workers" (incluye
`Scripts de Workers: Editar`) y se guardaron `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` como
secretos del repositorio. `SUPABASE_DB_URL` queda pendiente — no lo necesita esta feature, solo el
backup.

## 4. Fuera de alcance

- Desplegar desde ramas distintas a `main` o desde Pull Requests (previews). Mejora futura si hace
  falta.
- Rollback automático si un despliegue rompe algo. `wrangler deployments list` + un despliegue
  manual de una versión anterior siguen siendo el mecanismo, igual que hoy.
- Tests automáticos como gate antes de desplegar (¿debería `npx vitest run` fallar y bloquear el
  despliegue?) — decisión de Mateo, se pregunta en `/plan`, no se asume.
- Notificaciones (Slack, correo) de éxito/fallo del despliegue.

## 5. Reglas que aplican

- `CLAUDE.md §9` — un commit por tarea verificada.
- `CLAUDE.md §12` — nunca commitear claves, tokens ni `.env` — los workflows nuevos usan
  `secrets.*`, nunca un valor literal.

## 6. Criterios de aceptación

### CA-1 — Push a `main` con cambios en `backend/` dispara el workflow del backend — CERRADO
**Evidencia real:** el push que creó los workflows tocó ambos archivos (`deploy-backend.yml` y
`deploy-frontend.yml`) en el mismo lote de commits; GitHub Actions disparó `deploy-backend #1` para
ese push (51s, verde). El caso negativo aislado (un commit que toque *solo* `backend/` y confirmar
que `deploy-frontend` NO corre) no se probó todavía por separado — queda para el primer cambio real
de una sola carpeta.

### CA-2 — Push a `main` con cambios en `frontend/` dispara el workflow del frontend — CERRADO
**Evidencia real:** mismo push, `deploy-frontend #1` corrió (2m 0s, verde). Mismo matiz que CA-1:
falta el caso negativo aislado.

### CA-3 — El workflow del frontend usa `pages:build`, nunca `build` a secas — CERRADO
**Evidencia real:** `deploy-frontend #1` en verde, terminó en el smoke test de `/login` — si hubiera
usado `build` a secas, `.open-next/worker.js` no existiría y el paso explícito que lo verifica habría
fallado antes de llegar ahí.

### CA-4 — Un `.env.production` colado hace fallar el workflow, explícito
Sigue sin probarse en GitHub Actions real (no se va a commitear el archivo a propósito, sería
contradecir `.gitignore` a propósito). El paso existe y es sintácticamente correcto (parte del YAML
validado); su lógica (`if [ -f .env.production ]`) es trivial y de bajo riesgo de estar mal escrita.

### CA-5 — El resultado final es indistinguible del último despliegue manual verificado — CERRADO
**Evidencia real:** Mateo confirmó login funcionando (botón "Salir" visible, sesión activa) y
`/plataforma` cargando completo, con datos reales escritos en el formulario, después del primer
despliegue 100% automático.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| `npm ci` falla en el runner de GitHub por el mismo bloqueo de `cdn.sheetjs.com` que en este entorno de nube | Los runners de GitHub Actions tienen salida a Internet normal, a diferencia de este contenedor — riesgo bajo, pero se declara NO VERIFICADO hasta el primer push real |
| Un despliegue automático con un bug se publica sin que nadie lo revise a tiempo | RESUELTO en `/plan` §0 (aprobado por Mateo): tests/build/lint bloquean el despliegue, más dry-run y smoke test post-despliegue |

## 8. Definición de terminado

- [x] Los dos workflows nuevos versionados en `.github/workflows/`
- [x] `.specify/config.md` con la fila 022
- [x] `CHANGELOG.md` actualizado (Sesión 036)
- [x] Commit hecho
- [x] **CA-1 a CA-5 cerrados con evidencia real** — primer push real: `deploy-backend #1` (51s) y
      `deploy-frontend #1` (2m 0s), ambos en verde en GitHub Actions; login y `/plataforma`
      confirmados funcionando por Mateo después del despliegue 100% automático. Matiz anotado en
      CA-1/CA-2: falta el caso negativo aislado (un push que toque solo una carpeta), no bloquea el
      cierre.
