# TASKS — 001 Fundación

**Estado:** PROPUESTO — pendiente de aprobación para ejecutar en `/implement`.
**Dependencia:** `plan.md` aprobado por Mateo el 2026-08-31.
**Regla (CLAUDE.md §3):** si durante la ejecución aparece algo fuera del plan,
se detiene y se reporta. No se improvisa alcance.

---

## 0. Convenciones de ejecución

- **Evidencia (CLAUDE.md §4):** cada tarea termina con la salida real de su
  comando de verificación pegada en la conversación. Nunca "debería funcionar".
- **Orden:** las tareas se ejecutan en orden T-01 → T-24. Las que requieren el
  entorno local (Docker + Supabase CLI) se marcan con 🐳.
- **Entorno necesario:** Node 20+, npm, Docker, Supabase CLI, `psql`.
- **CA-1/CA-2:** los pasos numerados en T-11/T-14/T-19 a T-22 corresponden a la
  interpretación documentada en `plan.md` §6 (supuestos, ver plan §0). Si el
  `spec.md` real llega y difiere, se detiene y se ajusta.
- **Supabase local:** los scripts SQL de fixture/aislamiento se ejecutan contra
  la base local (`postgresql://postgres:postgres@localhost:54322/postgres`) con
  `$DATABASE_URL`, y usan `service_role_key`/`postgres` solo por ser tests
  (justificación escrita en cada script).

---

## 1. Fase 0 — Entorno

### T-01 — Inicializar Supabase local 🐳
- **Archivos:** `supabase/config.toml` (generado, no redactado a mano).
- **Qué hace:** `supabase init` crea la configuración del CLI local y
  `supabase start` levanta la pila (PostgreSQL + Auth + Inbucket) en Docker.
- **Verificación:**
  ```bash
  supabase --version && supabase init && supabase start && supabase status
  ```
- **Evidencia esperada:** salida de `supabase status` con servicios UP y la URL
  `http://localhost:54321`; archivo `supabase/config.toml` presente.

---

## 2. Fase 1 — Scaffolding del proyecto Next.js

### T-02 — `package.json` e instalación
- **Archivos:** `package.json`, `package-lock.json` (generado).
- **Qué hace:** manifiesto con dependencias de la fundación (Next.js 15, React,
  `@supabase/supabase-js`, `@supabase/ssr`, Tailwind, TypeScript estricto,
  ESLint flat, Vitest) y scripts: `dev`, `build`, `start`, `lint` (`eslint .`),
  `test` (`vitest run`), `test:aislamiento`, `db:reset`, `db:push`. Las versiones
  exactas las resuelve `npm install` (majors documentados: next 15); se pega el
  `package-lock.json` resultante.
- **Verificación:**
  ```bash
  npm install && npm ci
  node -e "const p=require('./package.json'); ['dev','build','start','lint','test','test:aislamiento','db:reset','db:push'].forEach(s=>{if(!p.scripts[s])process.exit(1)}); console.log('scripts OK')"
  ```
- **Evidencia esperada:** ambos comandos con exit 0; `node_modules/` y
  `package-lock.json` presentes; salida "scripts OK".

### T-03 — `tsconfig.json`
- **Archivos:** `tsconfig.json`.
- **Qué hace:** TypeScript estricto (`strict: true`), `paths` `@/*` → `./*`,
  configuración acorde a Next 15 (App Router).
- **Verificación:**
  ```bash
  node -e "const t=require('./tsconfig.json'); if(!t.compilerOptions||!t.compilerOptions.strict) process.exit(1); console.log('tsconfig OK')"
  ```
- **Evidencia esperada:** salida "tsconfig OK" (exit 0).

### T-04 — `next.config.js` con `output: 'standalone'`
- **Archivos:** `next.config.js`.
- **Qué hace:** restricción obligatoria del plan §1. Sin plugins ni APIs
  propietarias de Vercel.
- **Verificación:**
  ```bash
  node -e "const c=require('./next.config.js'); if(c.output!=='standalone') process.exit(1); console.log('next.config OK')"
  ```
- **Evidencia esperada:** salida "next.config OK" (exit 0).

### T-05 — `.gitignore` y `.env.example`
- **Archivos:** `.gitignore`, `.env.example`.
- **Qué hace:** `.gitignore` excluye `node_modules/`, `.next/`, `.env*`,
  `coverage/`, dumps. `.env.example` documenta las variables de
  `INFRAESTRUCTURA.md` §5 (sin valores reales).
- **Verificación:**
  ```bash
  test -f .gitignore && test -f .env.example && grep -q "node_modules" .gitignore && grep -q "SESSION_SECRET" .env.example && echo "gitignore/env OK"
  ```
- **Evidencia esperada:** salida "gitignore/env OK" (exit 0).

### T-06 — `eslint.config.mjs`
- **Archivos:** `eslint.config.mjs`.
- **Qué hace:** ESLint flat config basado en `eslint-config-next`.
- **Verificación:**
  ```bash
  node -e "import('./eslint.config.mjs').then(()=>console.log('eslint config OK'))"
  ```
- **Evidencia esperada:** salida "eslint config OK" (exit 0).

### T-07 — `postcss.config.mjs` y `tailwind.config.ts`
- **Archivos:** `postcss.config.mjs`, `tailwind.config.ts`.
- **Qué hace:** PostCSS con Tailwind; `content` apuntando a `app/`,
  `components/`, `lib/`.
- **Verificación:**
  ```bash
  node -e "import('./postcss.config.mjs').then(()=>console.log('postcss OK'))"
  node -e "const fs=require('fs'); const s=fs.readFileSync('tailwind.config.ts','utf8'); if(!s.includes('app/')) process.exit(1); console.log('tailwind OK')"
  ```
- **Evidencia esperada:** salidas "postcss OK" y "tailwind OK" (exit 0).

### T-08 — `vitest.config.ts`
- **Archivos:** `vitest.config.ts`.
- **Qué hace:** config de Vitest para `tests/unit` y `tests/integracion`.
- **Verificación:**
  ```bash
  npx vitest run --passWithNoTests
  ```
- **Evidencia esperada:** salida de Vitest sin errores de configuración (exit 0).

### T-09 — `app/` base (placeholder estático)
- **Archivos:** `app/globals.css`, `app/layout.tsx`, `app/page.tsx`.
- **Qué hace:** página raíz placeholder (título y estado del proyecto) que NO
  importa `@supabase/*`. Es lo mínimo que exige el build.
- **Verificación:**
  ```bash
  npm run build
  ```
- **Evidencia esperada:** build exit 0, sin errores ni warnings de TypeScript
  (primera compilación del scaffold).

---

## 3. Fase 2 — Base de datos y aislamiento (CA-1)

### T-10 — Migración fundacional `20260831150000_fundacion-tenancy.sql` 🐳
- **Archivos:** `supabase/migrations/20260831150000_fundacion-tenancy.sql`.
- **Qué hace:** aplica EXACTAMENTE el esquema de `plan.md` §3: extensiones,
  enums (`rol_usuario` con 3 valores, `estado_cuenta`, `estado_suscriptor`),
  tablas `planes`, `clientes`, `perfiles`, `membresias`, `configuracion`,
  `usuarios_servicio` (mínima, sin `perfil_id`), funciones SECURITY DEFINER,
  trigger `updated_at`, RLS habilitado + `FORCE` en las 6 tablas, y las
  políticas de `plan.md` §3.9.
- **Verificación:** se ejecuta en T-11 (este archivo no se ejecuta suelto).
  Chequeo estructural:
  ```bash
  grep -c "enable row level security" supabase/migrations/*fundacion*.sql
  grep -c "force row level security" supabase/migrations/*fundacion*.sql
  ```
- **Evidencia esperada:** ambos conteos en 6 (6 tablas con enable y con force).

### T-11 — `supabase db reset` aplica la migración 🐳 (CA-1 paso 1)
- **Qué hace:** destruye y recrea la base local desde las migraciones.
- **Verificación:**
  ```bash
  supabase db reset && supabase migration list
  ```
- **Evidencia esperada:** reset sin errores; la migración aparece aplicada en la
  lista.

### T-12 — `tests/fixtures/fundacion.sql` 🐳
- **Archivos:** `tests/fixtures/fundacion.sql`.
- **Qué hace:** datos multi-tenant idempotentes (plan §6.1): 2 clientes (A y B),
  perfiles (plataforma, admin A, lector A, admin B), membresías, configuraciones
  y usuarios_servicio para A y B. Se inserta como `postgres`/service role por
  ser fixture de test (justificación en el propio archivo).
- **Verificación:**
  ```bash
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
  psql "$DATABASE_URL" -tAc "select count(*) from clientes;"
  ```
- **Evidencia esperada:** script sin errores; conteo de clientes = 2.

### T-13 — `tests/aislamiento/001_fundacion_aislamiento.sql` 🐳
- **Archivos:** `tests/aislamiento/001_fundacion_aislamiento.sql`.
- **Qué hace:** automatiza los pasos 2–11 de CA-1 (plan §6.1) usando
  `set local role` + `set local request.jwt.claim.sub` y bloques `do $$` con
  `assert`/`raise exception`. Verifica: 6 tablas y columnas (paso 2), enum de 3
  valores (paso 3), ausencia de `perfil_id` (paso 4), RLS+FORCE (paso 5), anon
  aislado (paso 6), admin A solo ve A (paso 7), admin A no toca B (paso 8),
  admin A no otorga `administrador` (paso 9), plataforma gestiona todo (paso
  10), `planes` lectura pública/escritura plataforma (paso 11).
- **Verificación:** se ejecuta en T-14. Chequeo de que contiene los 3 casos
  negativos críticos:
  ```bash
  grep -c "raise exception" tests/aislamiento/001_fundacion_aislamiento.sql
  ```
- **Evidencia esperada:** conteo ≥ 8 (una excepción por verificación fallida).

### T-14 — Ejecutar aislamiento 🐳 (CA-1 pasos 2–11)
- **Qué hace:** corre el fixture + el script de aislamiento con parada ante
  error.
- **Verificación:**
  ```bash
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/fixtures/fundacion.sql
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/001_fundacion_aislamiento.sql
  ```
- **Evidencia esperada:** exit 0 y la salida "FUNDACION-AISLAMIENTO OK" del
  script. **NO VERIFICADO hasta ejecutarse:** si algún assert falla, la salida
  muestra la excepción y se reporta como bug, no se silencia.

---

## 4. Fase 3 — Capa de servicios (`lib/`) y tests

### T-15 — `lib/db.ts`
- **Archivos:** `lib/db.ts`.
- **Qué hace:** implementa `crearClienteServidor()` según `plan.md` §4.5
  (`@supabase/ssr` + cookies de `next/headers`). Es el único punto de acceso a
  Supabase del servidor.
- **Verificación:**
  ```bash
  npx tsc --noEmit
  ```
- **Evidencia esperada:** exit 0 (tipos correctos en todo el proyecto).

### T-16 — `lib/auth.ts`
- **Archivos:** `lib/auth.ts`.
- **Qué hace:** implementa `plan.md` §4.2–4.4: tipos `SesionAdministrativa` /
  `SesionSuscriptor` / `Sesion`, constantes de D-4, clase
  `ErrorSesionSuscriptorPendiente`, funciones de sesión administrativa
  (`obtenerSesionActiva`, `iniciarSesion`, `cerrarSesion`) y firmas de suscriptor
  que lanzan `ErrorSesionSuscriptorPendiente`.
- **Verificación:**
  ```bash
  npx tsc --noEmit
  ```
- **Evidencia esperada:** exit 0.

### T-17 — `tests/unit/lib/auth.test.ts`
- **Archivos:** `tests/unit/lib/auth.test.ts`.
- **Qué hace:** tests unitarios de `plan.md` §6.3 con `vi.mock` de
  `next/headers` y `@supabase/ssr`: `obtenerSesionActiva()` sin cookie → `null`;
  con sesión → `tipo: 'administrativa'`; `iniciarSesion()` con credenciales
  inválidas → error; `cerrarSesion()` sin sesión → no lanza; las 3 funciones de
  suscriptor → `ErrorSesionSuscriptorPendiente`.
- **Verificación:**
  ```bash
  npx vitest run tests/unit/lib/auth.test.ts
  ```
- **Evidencia esperada:** todos los tests en verde (exit 0), salida pegada.

### T-18 — `tests/integracion/001_fundacion_auth.test.ts` 🐳
- **Archivos:** `tests/integracion/001_fundacion_auth.test.ts`.
- **Qué hace:** integración real con Supabase local (plan §6.3): crea un usuario
  en `auth.users` vía service role (local), inserta su `perfiles`, y verifica
  `iniciarSesion()` → `SesionAdministrativa`. Usa variables de `supabase status
  -o env`.
- **Verificación:**
  ```bash
  supabase start && npx vitest run tests/integracion/001_fundacion_auth.test.ts
  ```
- **Evidencia esperada:** test en verde. Si `supabase` no está arriba o las
  variables faltan, se reporta **NO VERIFICADO — requiere validación manual**,
  nunca se marca aprobado.

---

## 5. Fase 4 — Verificación final de la aplicación (CA-2)

### T-19 — Lint limpio (CA-2 paso 3)
- **Verificación:**
  ```bash
  npm run lint
  ```
- **Evidencia esperada:** exit 0 sin warnings.

### T-20 — Build final sin errores ni warnings de TS (CA-2 paso 2)
- **Verificación:**
  ```bash
  npm run build
  ```
- **Evidencia esperada:** exit 0; sin errores ni warnings de TypeScript; se
  generó `.next/standalone/`.

### T-21 — La app responde en dev y en standalone (CA-2 paso 4)
- **Verificación:**
  ```bash
  npm run dev &
  sleep 5 && curl -s -o /dev/null -w "dev:%{http_code}\n" http://localhost:3000
  # detener dev, luego:
  node .next/standalone/server.js &
  sleep 2 && curl -s -o /dev/null -w "standalone:%{http_code}\n" http://localhost:3000
  ```
- **Evidencia esperada:** `dev:200` y `standalone:200`.

### T-22 — Restricciones de arquitectura (CA-2 paso 5)
- **Verificación:**
  ```bash
  test -f .next/standalone/server.js && echo "standalone presente"
  grep -rn "@supabase/" app/ components/ || echo "OK: sin imports de @supabase/ en app/ ni components/"
  ```
- **Evidencia esperada:** "standalone presente" y "OK: sin imports de
  @supabase/..." (grep vacío).

---

## 6. Fase 5 — Cierre

### T-23 — Actualizar `CHANGELOG.md`
- **Archivos:** `CHANGELOG.md`.
- **Qué hace:** nueva entrada de sesión con lo hecho en `/implement`, los
  hallazgos y los pendientes (formato del archivo existente).
- **Verificación:**
  ```bash
  grep -c "2026-08-31 — Sesión 006" CHANGELOG.md
  ```
- **Evidencia esperada:** conteo ≥ 1 (entrada presente).

### T-24 — Commit (sin push)
- **Qué hace:** commit de todos los archivos de la feature con mensaje
  descriptivo. NO se ejecuta `git push` (prohibido, CLAUDE.md §11); el comando
  de push se entrega a Mateo.
- **Verificación:**
  ```bash
  git status --porcelain
  git add -A && git commit -m "feat(001-fundacion): esquema base multi-tenant, RLS FORCE y contratos de auth"
  git --no-pager log --oneline -1
  git status --porcelain
  ```
- **Evidencia esperada:** commit creado; `git status` limpio tras el commit;
  salida del log con el hash. El comando `git push` se imprime y se entrega a
  Mateo, sin ejecutarse.

---

## 7. No cubierto por estas tareas (requieren decisión de Mateo)

- Mover los documentos de la raíz a `docs/` (plan §0, acción no bloqueante).
- Contrastar CA-1/CA-2 con el `spec.md` real cuando esté disponible.
- Umbrales por defecto reales del negocio y tarifas verificadas (plan §8).
- Migrar este `tasks.md`/`plan.md` a la plantilla oficial cuando exista.


