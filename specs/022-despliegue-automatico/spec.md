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

### CA-1 — Push a `main` con cambios en `backend/` despliega solo
Un commit que toque únicamente `backend/**` dispara el workflow del backend y no el del frontend.
Verificación: real, con un push de prueba (puede ser este mismo commit de cierre) y revisando la
pestaña Actions de GitHub.

### CA-2 — Push a `main` con cambios en `frontend/` despliega solo
Análogo, invertido. Misma verificación.

### CA-3 — El workflow del frontend usa `pages:build`, nunca `build` a secas
Verificación: lectura del YAML, y confirmación de que el despliegue resultante sirve `/login` con
`200` (no 404, el error del incidente de la 021).

### CA-4 — Un `.env.production` colado hace fallar el workflow, explícito
Verificación: se prueba localmente el mismo comando de chequeo contra un archivo de prueba creado a
propósito, confirmando que falla con el mensaje esperado; no se prueba en GitHub Actions real (no se
va a commitear el archivo a propósito).

### CA-5 — El resultado final es indistinguible del último despliegue manual verificado
Login, `/plataforma`, `/app/dashboard` siguen funcionando igual después del primer despliegue
automático. Verificación real, en el navegador de Mateo.

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
- [ ] **CA-1 a CA-5 con evidencia real — PENDIENTE**: falta el primer push que dispare cada workflow
      y que Mateo confirme en la pestaña Actions de GitHub que terminaron en verde. Esta feature no
      se da por "terminada" hasta esa confirmación.
