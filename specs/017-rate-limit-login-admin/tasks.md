# TASKS — 017: rate-limit-login-admin

**Spec aprobado:** 2026-09-07 (spec.md en commit `3e3fdf9`; decisiones §0.3 y §0.4 resueltas)
**Plan aprobado:** 2026-09-07 (plan.md en commit `3e3fdf9`, incluida la desviación de §5.1 y la
política de fallo de §5.4)

Una tarea = un commit. Sin evidencia no hay commit (`CLAUDE.md §4` y §9). La IA no hace `push`
salvo autorización expresa de Mateo (§9.1).

**Los hashes van en la Bitácora de cierre (T-007), no en cada tarea.** Escribir el hash del propio
commit dentro de ese commit es circular: cada `--amend` para corregirlo lo cambia otra vez. Es la
misma convención que usó 011 (`dce1c49`, "referencia de commit T-011 en tasks.md").

---

## Notas de entorno y prerrequisitos

- **Origen:** hallazgo **A-2 (ALTO)** de la auditoría pre-producción (`docs/PLAN-PRODUCCION.md`).
  Es **prerrequisito de producción**: va antes que 013-016 pese a su número (spec §0.1).
- **Base de datos local:** este entorno no tiene Docker ni la CLI de Supabase, pero **sí PostgreSQL
  16 nativo**. La auditoría dejó el procedimiento verificado y reutilizable: cluster propio + roles
  `anon`/`authenticated`/`service_role` (este con `BYPASSRLS`) + esquema `auth` con `auth.uid()`
  leyendo `request.jwt.claim.sub` + los *default privileges* de Supabase. Las 14 migraciones aplican
  limpias de cero y las 13 suites de aislamiento pasan en verde sobre él.
- **`wrangler dev` + Supabase real NO son viables aquí** (no hay credenciales). Todo lo que dependa
  de HTTP real contra GoTrue queda como **NO VERIFICADO — requiere validación manual de Mateo**, con
  los pasos exactos. No se marca como completo (`CLAUDE.md §4`).
- **Regresión obligatoria** en toda tarea que toque `backend/src/`: `npx vitest run` **completo**
  (154 tests hoy), más `npm run build` (tsc), `npm run lint` y
  `npx wrangler deploy --dry-run -c wrangler.toml`. En toda tarea que toque el esquema: las 15
  migraciones desde cero + las suites de aislamiento 001-012, 900 y 901, método canónico de la
  Sesión 026 (001-010/012/900/901 sobre los fixtures 001-012; `dashboard.sql` y la 011 al final).
- **IDs de los fixtures:** cliente A `a0000000-…-0001` (admin `…a1`, lector `…a2`), cliente B
  `b0000000-…-0002` (admin `…b1`), plataforma `c0000000-…-0001`.
- **Regla heredada de C-1**, aplicable a T-001: toda función `security definer` nueva se audita
  contra el patrón del "identificador desnudo" antes de darla por terminada.
- **Orden de dependencia:** T-001 (esquema) bloquea T-002 (aislamiento) y T-003 (capa fina).
  T-003 bloquea T-004 (ruta). T-005 (purga) es independiente pero necesita la tabla de T-001.
  T-006 (frontend) necesita el 429 de T-004. T-007 cierra.

---

## T-001 — Migración: tabla, RLS y las dos funciones

**Archivos:** `supabase/migrations/20260916090000_rate-limit-login-admin.sql` (crear)
**Hace:** (plan §2) Tabla `admin_intentos_login` (`email text` primary key ya normalizado,
`intentos smallint`, `bloqueado_hasta timestamptz`, `ultimo_intento timestamptz`), **sin
`cliente_id`** (excepción aprobada, spec §3.1) y **sin FK a `perfiles`** (requisito de CA-4). RLS
`ENABLE` + `FORCE` con una única política: `for select using (es_admin_plataforma())`.
Funciones `admin_login_estado(text)` y `admin_login_registrar(text, boolean)`, ambas
`security definer set search_path = public`, con `revoke all ... from public` y
`grant execute ... to anon` (nunca a `authenticated`). Constantes: umbral 5, base 1 min, techo
60 min, olvido 24 h. Normalización defensiva `lower(btrim())` dentro de la función; email nulo o
vacío no crea fila.

**Verificación:**
```bash
# base limpia + las 15 migraciones desde cero
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260916090000_rate-limit-login-admin.sql
# forma real de la tabla, RLS y privilegios
psql "$DATABASE_URL" -c "\d admin_intentos_login"
psql "$DATABASE_URL" -c "select relrowsecurity, relforcerowsecurity from pg_class where relname='admin_intentos_login';"
psql "$DATABASE_URL" -c "select proname, prosecdef, proconfig, has_function_privilege('public', oid, 'EXECUTE') as publico
                           from pg_proc where proname like 'admin_login_%';"
```
**Resultado esperado:** migración EXIT=0; `relrowsecurity` y `relforcerowsecurity` ambos `t`; una
sola política y de `select`; las dos funciones con `prosecdef = t`, `search_path=public` y
`publico = f`; sin columna `cliente_id` y sin FK.
**Estado:** COMPLETADO
**Evidencia:**
```
Las 15 migraciones desde cero: 15/15 EXIT=0

        proname        | sec_def |       config       | publico | anon | authenticated | service_role
-----------------------+---------+--------------------+---------+------+---------------+--------------
 admin_login_estado    | t       | search_path=public | f       | t    | f             | t
 admin_login_registrar | t       | search_path=public | f       | t    | f             | t

 rls | force        columnas: email, intentos, bloqueado_hasta, ultimo_intento
-----+-------       claves foráneas: 0
 t   | t            políticas: 1 (todas SELECT: true)

Retardo progresivo, valores reales medidos contra la función:
  fallo | intentos | espera        fallo | intentos | espera
    1   |    1     |   —             7   |    7     |  4 min
    2   |    2     |   —             8   |    8     |  8 min
    3   |    3     |   —             9   |    9     | 16 min
    4   |    4     |   —            10   |   10     | 32 min
    5   |    5     | 1 min          11   |   11     | 60 min (techo)
    6   |    6     | 2 min
  estado con bloqueo vigente: {"estado":"bloqueado","reintentar_en":"2026-09-07T10:40:28+00:00"}
  tras acierto (espera vencida): intentos=0, bloqueado=NULL, estado={"estado":"ok"}
  normalización: 'ADMIN-A@Test.Local ' y 'admin-a@test.local' -> 1 sola fila

Regresión de aislamiento sobre la base con las 15 migraciones: 13/13 en verde,
cero en rojo (001-010, 012 y 900 sobre fixtures 001-012; 011 tras dashboard.sql).
```
**Fallo real detectado y corregido durante la verificación:** la primera versión solo hacía
`revoke ... from public` y `has_function_privilege('authenticated', …)` devolvía **`true`**. Los
*default privileges* de Supabase (`grant all on functions to postgres, anon, authenticated,
service_role`) otorgan toda función nueva a `authenticated`, y revocar de `public` **no** lo quita.
Se añadió `revoke ... from public, authenticated`. **Observación para una tarea posterior, fuera del
alcance de 017:** las 6 funciones del portal (008/008b) arrastran el mismo EXECUTE heredado por
`authenticated` por la misma razón; no es explotable (revalidan credenciales completas y no aceptan
un id desnudo), pero conviene alinearlas.
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-002 — Suite de aislamiento `901` (los 10 pasos del plan §8)

**Archivos:** `tests/aislamiento/901_admin_intentos_login_aislamiento.sql` (crear)
**Hace:** Los 10 pasos de la tabla del plan §8: RLS y privilegios (CA-6); **la tabla completa de
retardos** 5→1 min, 6→2, 7→4, 8→8, 9→16, 10→32, 11+→60 (CA-1, CA-3); reinicio por éxito con k<5
(CA-2); bloqueo vigente devuelve `bloqueado` (CA-1); tras mover `bloqueado_hasta` al pasado se puede
reintentar y el bloqueo siguiente es **mayor** (CA-3); **CA-4**: un email inexistente produce
exactamente la misma secuencia que uno registrado; email nulo/vacío no crea fila; olvido a las 24 h.
Serie 900+ porque 017 no está en el roadmap original (plan §1).
**Desviación de alcance respecto del plan §8:** su paso 10 (la purga, CA-7) NO entra en esta suite.
La purga se implementa en TypeScript (`cron/limpieza.ts`, T-005) y repetir aquí su predicado de
borrado probaría una copia del predicado, no el código que se despliega. CA-7 se verifica en T-005
contra el código real con contraste SQL. Por eso la suite tiene 10 pasos, pero el décimo es CA-4 (el
innegociable) en vez de la purga.

**Verificación:**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/901_admin_intentos_login_aislamiento.sql
# regresión canónica completa desde base reconstruida
for f in 001..012 900 901; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/aislamiento/$f*.sql; done
```
**Resultado esperado:** `ADMIN-INTENTOS-LOGIN-AISLAMIENTO OK`; regresión **14/14 suites en verde**,
cero en rojo.
**Estado:** COMPLETADO
**Evidencia:**
```
901_admin_intentos_login_aislamiento.sql  ->  ADMIN-INTENTOS-LOGIN-AISLAMIENTO OK

Prueba de que la suite SIRVE (se rompe algo a propósito y se comprueba que cae
el paso correcto — un test que pasa en ambos casos no prueba nada):

  A) grant execute ... to authenticated      -> PASO 2 FALLÓ: admin_login_estado(text)
                                                es ejecutable por authenticated
  B) política de escritura en la tabla       -> PASO 1 FALLÓ: hay 1 política(s) de escritura
  C) retardo fijo de 15 min en vez del       -> PASO 4 FALLÓ: tras 5 fallo(s) la espera es
     progresivo                                 15 min (se esperaba 1)
  D) fuga de CA-4 quirúrgica: 1 minuto más   -> PASO 10 FALLÓ (CA-4) en el intento 5:
     de espera si el email existe en             registrado(intentos=5, espera=2, estado=bloqueado)
     `perfiles`                                  vs inexistente(intentos=5, espera=1, ...)
  restaurada la función real                 -> ADMIN-INTENTOS-LOGIN-AISLAMIENTO OK

  (El primer intento de sabotear CA-4 fue demasiado tosco —quitaba también el
  bloqueo— y caía antes, en PASO 5. Se rehízo quirúrgico para demostrar que
  PASO 10 es quien detecta la fuga: basta 1 minuto de diferencia observable.)

Regresión canónica desde base reconstruida (15 migraciones desde cero + fixtures
001-012; dashboard.sql y la 011 al final): 14/14 suites en verde, cero en rojo.
```
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-003 — `lib/auth-intentos.ts` y sus tests unitarios

**Archivos:** `backend/src/lib/auth-intentos.ts` (crear),
`backend/tests/unit/auth-intentos.test.ts` (crear)
**Hace:** (plan §4) Capa fina sobre las 2 RPC, espejo de `lib/portal.ts`, siempre con
`crearClienteAnon` — **nunca `service_role`** (`CLAUDE.md §5.4/§12`). `estadoLoginAdmin()` **lanza**
si la RPC falla (la ruta lo traduce a 503, plan §5.4); `registrarIntentoLoginAdmin()` **nunca lanza**
(registra con `console.error` y sigue).

**Verificación:**
```bash
cd backend
npx vitest run tests/unit/auth-intentos.test.ts   # traduce las 3 respuestas; lanza / no lanza
npx vitest run                                    # suite completa
npm run build && npm run lint
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** tests nuevos en verde con un Supabase falso (patrón de
`cierre-facturacion-tenant.test.ts`); suite completa en verde; tsc, lint y dry-run EXIT=0.
**Prueba de que los tests sirven:** se comprueba que **fallan** si se invierte el comportamiento de
lanzar/no lanzar. Un test que pasa en ambos casos no prueba nada (método de la auditoría).
**Estado:** COMPLETADO
**Evidencia:**
```
npx vitest run tests/unit/auth-intentos.test.ts -> 11 passed

Prueba de que los tests SIRVEN — se invierte la política de fallo del plan §5.4
y caen exactamente los tests que la vigilan:

  A) estadoLoginAdmin FALLA ABIERTO (devuelve "no bloqueado" en vez de lanzar)
     × error de la RPC -> LANZA (la ruta responde 503, no intenta el login)
     × respuesta con estado desconocido -> LANZA, no se asume "no bloqueado"
     × respuesta vacía -> LANZA
     Tests  3 failed | 8 passed

  B) registrarIntentoLoginAdmin FALLA CERRADO (relanza el error)
     × error de la RPC -> NO lanza (un login correcto no puede fallar por esto)
     × la RPC lanza -> NO lanza hacia fuera, pero lo registra
     Tests  2 failed | 9 passed

  restaurado -> Tests  11 passed

Suite completa: 165 passed (14 archivos)
npm run build (tsc)   EXIT=0
npm run lint (eslint) EXIT=0
npx wrangler deploy --dry-run -c wrangler.toml  EXIT=0
```
**Decisión tomada durante la implementación (dentro de la política del plan §5.4, no una desviación):**
una respuesta con `estado` desconocido o vacía se trata igual que un error de la RPC — **lanza**. Es
la misma clase de fallo: no se pudo determinar si el email está bloqueado, así que no se deja pasar
el login a ciegas.
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-004 — Integrar en `POST /auth/login`

**Archivos:** `backend/src/index.ts` (editar)
**Hace:** (plan §3) Verificar antes de `iniciarSesion` (bloqueado → **429** con el contrato exacto
del portal `{ error, reintentar_en }`; error de la RPC → **503**, falla cerrado) y registrar después
con el resultado real. El 401 genérico de credenciales inválidas **no cambia**: sigue sin revelar si
el email existe.

**Verificación:**
```bash
cd backend
npx vitest run && npm run build && npm run lint
npx wrangler deploy --dry-run -c wrangler.toml
```
**Resultado esperado:** todo EXIT=0, 154+ tests en verde.
**Estado:** COMPLETADO (cableado verificado; el end-to-end contra GoTrue real sigue pendiente)
**Evidencia:**
```
Se AMPLIÓ el alcance de la verificación respecto del plan §8, que daba esta tarea por
"no verificable aquí". Sí se puede ejercitar el `app.fetch` REAL sustituyendo las dos
dependencias (el límite y GoTrue), y eso cubre justo lo que T-004 añade:

  tests/unit/auth-login-limite.test.ts (nuevo, 6 casos) -> 6 passed
    · email bloqueado      -> 429 con reintentar_en, y ordenLlamadas == ['estado']
                              (no se llega a GoTrue: el caso caro es el más barato)
    · no se puede consultar -> 503 y ordenLlamadas == ['estado'] (falla cerrado)
    · credenciales malas   -> 401 y se registra { exito: false }
    · credenciales buenas  -> 200 y se registra { exito: true }
    · '  ADMIN@Test.Local  ' se registra como 'admin@test.local'
    · el 401 es idéntico para un email registrado y uno inexistente (CA-4)

Prueba de que los tests SIRVEN: quitando de la ruta la consulta del límite
(volviendo al estado anterior a 017) -> 4 failed | 2 passed; restaurado -> 6 passed.

Suite completa: 171 passed (15 archivos)
npm run build (tsc) EXIT=0 · npm run lint EXIT=0 · wrangler dry-run EXIT=0
```
**NO VERIFICADO — requiere validación manual de Mateo:** con `wrangler dev` + Supabase real,
```bash
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:8787/auth/login \
    -H 'Content-Type: application/json' -d '{"email":"admin-a@test.local","password":"mala"}'
done; echo
```
debe imprimir `401 401 401 401 401 429`, y la sexta respuesta traer `reintentar_en`.
**CA-4 a nivel HTTP:** repetir la misma serie con un email inexistente y pegar ambas salidas lado a
lado — códigos y cuerpos **idénticos**.
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-005 — Purga real en `cron/limpieza.ts` (cierra M-6)

**Archivos:** `backend/src/cron/limpieza.ts` (editar)
**Hace:** (plan §5.5) Borra de `admin_intentos_login` y de `portal_intentos_login` las filas **sin
bloqueo vigente** con `ultimo_intento` anterior a 30 días. **Nunca** borra una fila con
`bloqueado_hasta > now()`: eso le regalaría al atacante una forma de limpiar su propio bloqueo
esperando al cron. Cierra el hallazgo **M-6** de la auditoría. Se corrige de paso el comentario que
atribuye la purga a "la feature 015" (el roadmap la asigna a 016).

**Verificación:**
```bash
# sembrar filas caducadas y vigentes, ejecutar la purga y contrastar
psql "$DATABASE_URL" -c "<siembra>"
cd backend && npx vitest run && npm run build && npm run lint
```
**Resultado esperado:** desaparecen las caducadas, **sobreviven** las bloqueadas y las recientes;
contraste SQL pegado antes y después. CA-7.
**Estado:** COMPLETADO
**Evidencia:**
```
16/16 migraciones desde cero (la 20260917090000 es nueva, ver la desviación de abajo)
tests/unit/limpieza.test.ts nuevo, 5 casos -> 5 passed
tests/aislamiento/901 paso 11 (purga, CA-7) -> ADMIN-INTENTOS-LOGIN-AISLAMIENTO OK
  · 2 filas caducadas de admin_intentos_login y 1 de portal_intentos_login borradas
  · el bloqueo VIGENTE sobrevive en las DOS tablas
  · la fila con actividad reciente sobrevive
  · purgar_intentos_login(0), (null) y (-99) no tocan una fila de hace 1 hora
  · privilegios: public/anon/authenticated sin EXECUTE, service_role sí

Prueba de que los tests SIRVEN: quitando del cron la llamada a la purga
-> 3 failed | 2 passed; restaurado -> 5 passed.

Regresión: 14 suites de aislamiento, 0 en rojo
Suite completa: 176 passed (16 archivos)
tsc EXIT=0 · eslint EXIT=0 · dry-run (principal y limpieza) EXIT=0
```
**Error MÍO detectado por el propio test:** la primera versión del paso 11 daba por hecho que
`purgar_intentos_login(0)` no tocaría una fila de hace 2 días. Falso: la guarda eleva un `p_dias`
absurdo a **1 día**, así que una fila de 2 días entra legítimamente. La expectativa estaba mal, no la
función; se corrigió el test para comprobar lo que la guarda sí garantiza (que no se lleva lo de las
últimas horas).
**DESVIACIÓN DEL PLAN, señalada:** el plan §1 solo listaba `cron/limpieza.ts` para esta tarea. Se
añadió la migración `20260917090000_purga-intentos-login.sql` con la función `purgar_intentos_login()`
porque el predicado de borrado en SQL es **verificable contra PostgreSQL real con filas de verdad**
(paso 11 de la 901), mientras que el mismo predicado como cadena de PostgREST en TypeScript solo se
podría comprobar contra un cliente falso — probando una copia en vez del que se ejecuta. `CLAUDE.md
§4` pesa más que la lista de archivos. Efecto colateral bueno: con la purga en SQL, el paso 10 que el
plan §8 quería (y que T-002 dejó fuera) vuelve a estar cubierto.
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-006 — Frontend: mensaje del 429

**Archivos:** `frontend/components/login-form.tsx` (editar)
**Hace:** (plan §5.6) Si la respuesta es 429 con `reintentar_en`, mostrar cuántos minutos faltan en
vez del texto genérico. **No se toca `useHidratado()`**, que ya está correctamente aplicado en este
formulario (verificado en la auditoría: los 11 formularios lo usan).

**Verificación:**
```bash
cd frontend && npm run build && npm run lint
grep -n "hidratado" components/login-form.tsx   # sigue presente e intacto
```
**Resultado esperado:** build y lint EXIT=0; `disabled={!hidratado || cargando}` intacto.
**NO VERIFICABLE aquí (requiere Mateo):** ver el mensaje real en el navegador tras 6 intentos.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## T-007 — Cierre: documentación y checklist

**Archivos:** `specs/017-rate-limit-login-admin/spec.md` (§8: quitar el requisito de `core/` según
la desviación aprobada del plan §5.1), `docs/ESPECIFICACION-FUNCIONAL.md` (párrafo sobre bloqueo del
login que hoy falta, spec §0.2), `.specify/config.md` (fila 017 con la nota "prerrequisito de
producción, va antes que 013"), `docs/PLAN-PRODUCCION.md` (**A-2 → resuelto** con el commit; **M-6 →
resuelto** por T-005), `CHANGELOG.md`, este `tasks.md` (bitácora).
**Hace:** Cierra la feature y deja `PLAN-PRODUCCION.md` reflejando que el último hallazgo ALTO
abierto de la auditoría queda cerrado.
**Verificación:** revisión del diff completo + checklist de `CLAUDE.md §11` punto por punto.
**Resultado esperado:** ningún punto de §11 sin marcar o sin justificar por qué no aplica.
**Estado:** Pendiente
**Evidencia:**
```
<salida real>
```
**Commit:** se registra en la Bitácora de cierre (T-007)

---

## Bitácora de cierre

<se rellena al completar cada tarea: hash, evidencia resumida y desviaciones>
