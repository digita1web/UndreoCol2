# PLAN-PRODUCCION.md — UndreoCol

**Versión:** 1.0
**Fecha:** 2026-09-04
**Estado:** Vigente

Documento que reúne los pasos y verificaciones necesarios antes de migrar el primer cliente real
a producción. Complementa a `ARQUITECTURA.md`, `docs/DECISIONES.md`, `docs/INFRAESTRUCTURA.md` y
`docs/INFRAESTRUCTURA-Y-COSTOS.md` — no los reemplaza.

---

## Auditoría de seguridad pre-producción

Antes de migrar el primer cliente real a producción, se realizará una auditoría de seguridad
dirigida usando un modelo de IA avanzado (Claude con modelo Opus, o DeepSeek con modelo
Reasoner/Pro — el de mayor capacidad de razonamiento disponible en ese momento), como complemento
a Semgrep (que ya corre automáticamente en cada commit desde esta sesión).

Esta auditoría es necesaria porque Semgrep detecta patrones conocidos de vulnerabilidad pero no
entiende el contexto de negocio específico del sistema. La auditoría por LLM debe revisar
explícitamente:
- Todas las políticas RLS de todas las tablas del esquema completo
- Todas las funciones SECURITY DEFINER (que ninguna filtre datos entre acueductos ni entre
  suscriptores)
- El manejo de sesiones admin y portal (fijación de sesión, robo de cookies, separación correcta
  entre ambas)
- Rate limiting y protección de fuerza bruta en login admin y portal
- Cualquier hallazgo pendiente de Semgrep que requiera juicio humano/contextual para decidir si es
  un falso positivo o un riesgo real

Se realiza una sola vez, al completar el roadmap principal (features 001-014), antes de
producción real — no reemplaza la verificación de seguridad ya hecha feature por feature durante
el desarrollo.

---

## Resultado de la auditoría de seguridad pre-producción

**Fecha:** 2026-09-07 · **Ejecutada por:** Claude (modelo Opus), como estaba previsto arriba.
**Alcance real:** features 001-012 (el roadmap previsto para esta auditoría era 001-014; **013 y 014
no existen todavía** — no hay `specs/013-*` ni `specs/014-*`. Se deja constancia de la desviación:
cuando se implementen 013 y 014 hay que auditar esa superficie nueva, esta auditoría no la cubre).

### Método — evidencia ejecutable, no lectura de código

Todo lo de abajo se verificó contra un PostgreSQL 16 real levantado para la auditoría, con el
entorno de Supabase emulado fielmente: roles `anon`/`authenticated`/`service_role` (este último con
`BYPASSRLS`), esquema `auth` con `auth.uid()` leyendo `request.jwt.claim.sub`, y los *default
privileges* de `public` idénticos a los del bootstrap de Supabase. Sobre esa base se aplicaron las
**13 migraciones desde cero** y los fixtures 001-012.

Barridos ejecutados (no muestreo — todas las tablas y todos los roles):

| Barrido | Cobertura | Resultado |
|---|---|---|
| Lectura cruzada | 18 tablas tenantizadas × {anon, admin A, lector A} | 0 filas de otro tenant, 0 filas para `anon` |
| Escritura cruzada (UPDATE/DELETE) | 36 combinaciones tabla × rol | 0 fugas |
| INSERT cruzado | 18 tablas (copiando una fila real de B) | 0 exitosos |
| Escalada de privilegios | 14 vectores sobre `membresias`/`perfiles`/`clientes`/`planes` | 14 bloqueados |
| Tablas sin `cliente_id` | `planes`, `clientes`, `perfiles`, `_keepalive` | solo `planes` es legible por `anon` (por diseño) |
| Funciones SECURITY DEFINER | las 19 de `public` | todas con `search_path=public`; 9 vectores desde `anon` bloqueados |
| Portal del suscriptor | 12 ataques cruzados + 6 de login | 1 hallazgo BAJO (ver B-2) |
| RPC de negocio con `lector` y cruce de tenant | 9 vectores | 8 bloqueados, **1 fuga → C-1** |
| Secretos | los 804 objetos de **todo** el historial de git, todas las ramas | 0 secretos |

### Hallazgos

#### CRÍTICO — corregidos en esta auditoría

**C-1 · `siguiente_numero_factura()` aceptaba un `cliente_id` desnudo (cruce de tenant real).**
`SECURITY DEFINER` (no pasa por RLS) + `grant execute to authenticated` + cero comprobación sobre
`p_cliente_id`. Cadena de ataque reproducida de punta a punta: `anon` obtiene el `cliente_id` de la
víctima con `portal_cliente_por_slug()` (otorgada a `anon`, el slug es público) → cualquiera se
registra por el `POST /auth/registro` público → invoca la función por PostgREST contra ese
`cliente_id`. En la prueba, el consecutivo del acueducto B pasó de **1 a 4** desde una sesión que no
podía leer ni una fila de `configuracion`.

*Riesgo para el acueducto piloto:* un competidor, un cliente descontento de otro acueducto, o
cualquiera con una cuenta gratis, puede **saltar la numeración de las facturas del piloto**. La
numeración consecutiva sin huecos es exigencia contable colombiana: un salto arbitrario deja los
libros del acueducto sin poder cuadrar y compromete la serie. Ejecutado en bucle, además agota el
consecutivo de 5 dígitos y **bloquea el cierre de facturación** (el `SELECT ... FOR UPDATE` retiene
la fila de `configuracion` de la víctima) — es decir, el acueducto no puede facturar ese mes.

*Corregido* — commit `1800ca9`, migración `20260914090000`. La autorización va **dentro** de la
función (no se revoca a `authenticated`: `reconectar()` la necesita para la factura de reconexión):
`auth.uid() IS NULL` → `service_role` (la cola del cierre), en otro caso `es_admin_de(p_cliente_id)`.
Test nuevo `tests/aislamiento/900` (6 pasos) → `CONSECUTIVO-FACTURA-AISLAMIENTO OK`. Regresión
canónica desde base reconstruida: **13/13 suites en verde**.

#### ALTO

**A-1 · Inyección de HTML en los correos al suscriptor. — corregido.**
Los seis cuerpos de correo se construían interpolando sin escapar. Dos valores son texto libre
escrito por una persona: `nombreAcueducto` (de `POST /onboarding`, solo `.trim()`) y el `motivo` del
corte. *Riesgo:* un enlace de pago falso dentro de un aviso de mora legítimo, enviado desde el
dominio del acueducto — phishing con la confianza del remitente real, contra la población menos
preparada para detectarlo. Confirma como real el hallazgo WARNING de Semgrep que quedó abierto en la
Sesión 019. *Corregido* — commit `71e6d0b`: `escaparHtml()` en `core/`, 8 interpolaciones, 11 tests
nuevos con payload de phishing real. 140 tests en verde.

**A-2 · No había ninguna protección de fuerza bruta en el login administrativo. — RESUELTO (feature 017).**
`POST /auth/login` no tiene rate limiting de ningún tipo: ni en el Worker, ni en `wrangler.toml`, ni
una regla documentada de WAF en `docs/INFRAESTRUCTURA.md`. La única protección de fuerza bruta del
sistema es `portal_intentos_login`, y **solo cubre el portal del suscriptor** — justo la cuenta de
menos valor. Agravante arquitectónico: el Worker hace de intermediario ante Supabase Auth, así que
**todas** las peticiones a GoTrue salen desde IPs de Cloudflare; cualquier límite por IP del lado de
Supabase no puede distinguir al atacante del uso legítimo (o bloquea a todos, o no bloquea a nadie).

*Riesgo para el acueducto piloto:* la cuenta `admin_acueducto` es el control total del acueducto —
tarifas, anulación de facturas, registro completo de suscriptores con cédula y dirección, pagos.
Adivinar esa contraseña no tiene hoy ningún costo para el atacante.

*Cómo se resolvió:* no se improvisó. El arreglo exigía una tabla nueva, su RLS, su test de
aislamiento y cambios en la ruta de login — una feature, y `CLAUDE.md §3` prohíbe escribir código sin
`spec.md` aprobado. Se pasó por las cuatro fases con checkpoint de Mateo en cada una:
`specs/017-rate-limit-login-admin/` (spec → plan → tasks → implement, T-001 a T-007).

**Lo implementado:** tabla `admin_intentos_login` (sin `cliente_id`, excepción aprobada; **sin FK a
`perfiles`**, requisito de CA-4) con RLS `FORCE` y una sola política de lectura para la plataforma;
dos funciones `SECURITY DEFINER` otorgadas solo a `anon`; retardo **progresivo** —5 fallos, luego 1,
2, 4, 8, 16, 32 y techo de 60 minutos— con olvido a las 24 h; `POST /auth/login` consulta antes de
llegar a GoTrue (429 con `reintentar_en`, o 503 si no puede saberlo: **falla cerrado**) y registra
después; purga semanal en `cron/limpieza.ts`, que **cierra de paso el hallazgo M-6**.

**Lo que queda por verificar** (no se puede en el contenedor de la auditoría, requiere Mateo): la
secuencia HTTP real `401 401 401 401 401 429` contra Supabase de verdad, CA-4 a nivel HTTP, y
`npm run build`/`lint` del frontend — este último bloqueado porque el proxy deniega
`cdn.sheetjs.com`, de donde `package.json` toma `xlsx` desde la Sesión 020. Pasos exactos en
`specs/017-rate-limit-login-admin/tasks.md`, T-004 y T-006.

*Diseño que se propuso en su día y que la 017 siguió:*

- Tabla `admin_intentos_login (email citext primary key, intentos smallint, bloqueado_hasta timestamptz, ultimo_intento timestamptz)`, sin `cliente_id` (el login precede a la resolución del tenant), RLS `FORCE` y sin políticas — la escribe solo una función `SECURITY DEFINER`, igual que `portal_intentos_login`.
- Función `admin_registrar_intento_login(p_email)` / `admin_login_bloqueado(p_email)`, otorgadas a `anon` (el Worker llama antes de tener sesión).
- La ruta consulta el bloqueo **antes** de `signInWithPassword` y responde 429 con `reintentar_en`, mismo contrato que ya devuelve el portal.
- Umbral y minutos configurables, pero **globales** (no por acueducto: no se conoce el tenant aún).
- Alternativa más barata a evaluar en el `/plan`: el binding nativo de *Rate Limiting* de Cloudflare Workers, que no toca el esquema. Decisión de Mateo.

#### MEDIO — documentados, sin corregir (decisión de Mateo)

**M-1 · La cola de facturación confía en los IDs del mensaje corriendo con `service_role`. — CORREGIDO (`2907ba6`).**
`emitirFacturaDeMensaje()` y `enviarCorreoDeFactura()` buscan `periodos`, `usuarios_servicio` y
`facturas` **solo por `id`**, sin `.eq('cliente_id', clienteId)`, en un contexto que salta RLS. Hoy
no es explotable: el único productor es el propio Worker y siempre encola `ctx.clienteId` tras
lecturas ya filtradas por RLS. Pero es el mismo patrón de C-1 esperando a una ruta futura: cualquier
bug en un productor nuevo se convierte en fuga entre acueductos con `service_role`. *Corregido:* 12 consultas acotadas con `.eq('cliente_id', clienteId)` y las tres ramas del consumidor
validan que el mensaje traiga `clienteId`. Test nuevo `cierre-facturacion-tenant.test.ts` (5 casos)
con un cliente de Supabase falso cuyo `.eq()` filtra de verdad; quitando solo los filtros el test
pasa a 3 failed | 2 passed, así que mide lo que dice medir.

**M-2 · El `lector` ve todo el negocio del acueducto, no solo lecturas.**
Verificado: el lector de A ve exactamente lo mismo que el admin de A en `facturas` (9), `pagos` (8),
`usuarios_servicio` (6), `tarifas`, `cartera` y `configuracion`. `ESPECIFICACION-FUNCIONAL.md §3`
dice que el lector "solo puede crear y ver lecturas" y "ver y ejecutar órdenes **asignadas a él**".
*No es una fuga entre acueductos* — la escritura sí está bien acotada (no puede insertar pagos,
anular facturas, tocar tarifas ni configuración; verificado). Es sobre-exposición **dentro** del
tenant: el celular Android de un fontanero, perdido o robado en campo, entrega el registro completo
de suscriptores con cédula y dirección, y todo el histórico de facturación y recaudo. Corregirlo
implica políticas RLS nuevas por rol en 6 tablas + la asignación de rutas al lector, que
`ESPECIFICACION-FUNCIONAL.md §2.14.1` reconoce que **no existe como feature todavía**.

**M-3 · `ALLOWED_ORIGIN = "http://localhost:3000"` estaba versionado en `backend/wrangler.toml`. — RESUELTO (`f98850a`).**
Confirmado en la salida real de `wrangler deploy --dry-run`: el binding se despliega con ese valor.
Un `wrangler deploy` desde el repo pisaba el valor de producción del panel de Cloudflare y el
frontend dejaba de poder llamar a la API (CORS). *Resuelto:* `[env.production]` con el origen real
(`https://undreocol-frontend.undreocol.workers.dev`, confirmado por Mateo) y el script
`npm run deploy:produccion`. **Producción se despliega ahora con ese script, no con `npm run deploy`.**
El fix evita dos trampas de Wrangler, ambas verificadas y no supuestas: sin `name` explícito en el
bloque de entorno se habría creado un Worker NUEVO llamado `undreocol-api-production` (comprobado
leyendo el README que genera `--outdir`), y los bindings no se heredan del bloque raíz, así que se
repiten los cuatro. **Al añadir un binding nuevo hay que añadirlo también en `[env.production]`.**

**M-4 · Cookies `SameSite=Lax` con frontend y backend en sitios distintos.**
`uc_sesion_admin` y `uc_sesion_suscriptor` son `SameSite=Lax`, y `frontend/lib/api.ts` llama a la API
desde el navegador con `credentials: 'include'`. Si el frontend y el Worker quedan en dominios
distintos —y `*.pages.dev` y `*.workers.dev` son sitios distintos, ambos están en la Public Suffix
List— el navegador **no envía la cookie** en esas peticiones. Hay que verificar en producción real
cómo está resuelto hoy. **Advertencia importante:** si se resuelve poniendo `SameSite=None`, se
elimina la única defensa CSRF que tiene el sistema (no hay token CSRF en ninguna ruta) y **toda**
petición POST autenticada pasa a ser falsificable desde cualquier sitio. En ese caso hace falta
tokens CSRF antes, no después.

**M-5 · El registro es público y crear acueducto es gratis.**
`POST /auth/registro` es abierto y `crear_tenant_con_admin()` está otorgada a `authenticated`:
cualquiera crea una cuenta y un acueducto. Sin producto de autoservicio todavía, eso es superficie de
abuso gratuita — y en Supabase Free la base tiene 500 MB (`ARQUITECTURA.md §6`). Fue además el
peldaño 2 de la cadena de C-1. Con un solo cliente piloto, lo sensato es cerrar el registro o
ponerle invitación hasta que el autoservicio sea un objetivo real.

**M-6 · `portal_intentos_login` no se purgaba nunca. — RESUELTO (feature 017, T-005).**
`cron/limpieza.ts` declaraba que la purga llegaba con la feature 015. Cada documento distinto probado
contra el login del portal creaba una fila permanente: crecimiento no acotado en una base de 500 MB.
*Resuelto:* la función `purgar_intentos_login()` (migración `20260917090000`) borra de
`portal_intentos_login` **y** de `admin_intentos_login` las filas sin actividad en 30 días y **sin
bloqueo vigente** —nunca un bloqueo activo, que le daría al atacante una forma gratuita de limpiar el
suyo esperando al cron—, y el Worker semanal la invoca. Verificado contra PostgreSQL real en
`tests/aislamiento/901` paso 11. De paso se corrigió el comentario que atribuía la purga a "la
feature 015": el roadmap la numera 016.

#### BAJO — documentados, sin corregir

**B-1 · `planes` es legible por `anon`. — NO SE CORRIGE: es una decisión de producto, no un bug.** (`planes_lectura ... using (true)`). Expone el catálogo
comercial de UndreoCol (nombres de plan y `valor_suscriptor`) a cualquiera. Es la única tabla de las
22 legible sin sesión. **Decisión de Mateo pendiente:** que el catálogo comercial de UndreoCol sea
público es normal en un SaaS, así que esto no se toca por iniciativa propia. Verificado que hoy
**nada lo lee salvo `GET /salud`**, que lo usa como prueba de conectividad — y seguiría funcionando
igual si se restringiera, porque RLS devuelve 0 filas sin error. Si Mateo decide que no debe ser
público, el cambio es de una línea:
`alter policy planes_lectura on planes using (auth.uid() is not null);`
más actualizar el comentario de `/salud`, que hoy dice "planes es lectura pública".

**B-2 · `portal_validar_credenciales` lanzaba una excepción no controlada con `numero_documento` NULL — CORREGIDO (`b365141`).**
(violación de `NOT NULL` en `portal_intentos_login`) en vez de devolver `{"estado":"invalido"}`. No
es alcanzable por el Worker (`POST /portal/:slug/login` exige ambos campos antes de llamar), pero la
función está otorgada a `anon` y la propia migración 008 documenta que "la clave anon es pública".
Devolvía un error de PostgreSQL con nombres de tabla y columna. *Corregido:* NULL, cadena vacía y
espacios en cualquiera de los tres parámetros devuelven `{"estado":"invalido"}`, igual que cualquier
otra credencial incorrecta, sin crear filas basura en `portal_intentos_login`.

**B-3 · `tarifa_vigente()` filtraba un UUID de tarifa entre acueductos. — RESUELTO (`2af5ab3`).** Es `SECURITY DEFINER`,
otorgada a `authenticated`, y su propio comentario dice que "no filtra por cliente_id a propósito".
Verificado: un usuario sin membresía obtiene el `tarifa_id` vigente de otro acueducto. La fila en sí
seguía protegida por RLS (0 filas legibles), y hace falta adivinar un `servicio_id` de 128 bits, así
que no era explotable en la práctica. Se cerró igual por consistencia: es el mismo patrón del
identificador desnudo que causó el CRÍTICO C-1. *Resuelto:* la función comprueba que el servicio
pertenece a un acueducto del llamante. La guarda es de **pertenencia al acueducto, no de rol** — el
lector llega aquí por la simulación de periodo y filtrar por rol habría roto esa ruta. Los tres
caminos legítimos (admin, lector, `service_role` del cierre masivo) se verificaron uno por uno.

**Corrección adicional en el mismo commit, descubierta durante 017 T-001:** las **6 funciones del
portal** (008/008b) conservaban el `EXECUTE` que `authenticated` recibe solo por los *default
privileges* de Supabase — `revoke all … from public` no lo quita. No era explotable (revalidan
credenciales completas), pero era superficie que nadie usa: quien las llama es el Worker con la clave
`anon`. Suite nueva `tests/aislamiento/902`.

**B-4 · `PATCH` faltaba en `allowMethods` del CORS — CORREGIDO (`41d78d4`).**
El middleware de `backend/src/index.ts:95` no lo listaba, y la API registra 4 rutas `PATCH`:
editar servicio, editar suscriptor, **cerrar periodo** y marcar lectura revisada. No es
un agujero de seguridad, es un fallo funcional: el *preflight* del navegador rechazaba esas cuatro
operaciones desde otro origen. Cerrar el periodo es una operación central del mes. *Corregido:*
`PATCH` añadido, y de paso el origen no permitido ya no recibe la cadena entera de `ALLOWED_ORIGIN`
(que con varios orígenes produce una cabecera inválida) sino el primero de la lista. Test nuevo
`cors.test.ts` (9 casos) que ejercita `app.fetch` con preflights reales.

**B-5 · `postcss` con 2 vulnerabilidades (1 alta) por dependencia transitiva de `next`.**
`npm audit` del frontend lo confirma; el arreglo exige `next@16` (cambio mayor). Las cuatro
advertencias requieren CSS controlado por un atacante y aquí PostCSS solo procesa el CSS propio del
proyecto en tiempo de compilación. Sin ruta de explotación en este sistema. `npm audit` del backend:
**0 vulnerabilidades**.

**B-6 · No había cabeceras de seguridad en el frontend. — RESUELTO (`4ab4200`), pendiente de verificar el build.** (`next.config.ts` estaba vacío): sin CSP, sin
`X-Frame-Options`/`frame-ancestors`, sin `Referrer-Policy`. El panel administrativo se podía embeber
en un iframe (clickjacking sobre un panel que anula facturas y cambia tarifas). *Resuelto:* las cinco
cabeceras que no pueden romper una aplicación normal. **Deliberadamente NO se añadió una CSP
completa** —una CSP mal ajustada rompe la aplicación en silencio y aquí no se puede ejecutar
`next build`—; merece su propia tarea con el navegador delante. **Pendiente:** ejecutar
`npm run build` antes de desplegar, y `curl -I` sobre la URL real después.

### Lo que la auditoría confirmó que está bien

No todo fue hallazgos. Verificado con evidencia, no supuesto:

- **Las 22 tablas** tienen RLS `ENABLE` **y** `FORCE`. Sin excepciones.
- **Aislamiento multi-tenant intacto** en lectura, INSERT, UPDATE y DELETE, incluidas las 10 tablas
  que no tienen test de aislamiento propio. Un usuario autenticado sin membresía ve exactamente
  **2 filas** en toda la base: las de `planes`.
- **CLAUDE.md §10 punto 23 se cumple en la base, no en la interfaz**: los 14 intentos de escalada
  fallaron, incluidos auto-otorgarse `administrador`, ascender la propia membresía, auto-invitarse a
  otro tenant y borrar las membresías ajenas.
- **El portal del suscriptor (008) resiste los 12 ataques cruzados**: credenciales válidas contra
  otro tenant, documento de uno con código de otro, `factura_id` de otro suscriptor del mismo
  acueducto, inyección SQL, comodines `LIKE`. Todas las funciones revalidan
  `numero_documento` + `codigo_suscriptor` reales; ninguna acepta un `usuario_servicio_id` desnudo.
- **`SUPABASE_SERVICE_ROLE_KEY` no aparece en ninguna ruta que atienda peticiones de usuario** — solo
  en `cron/` y en el consumidor de la cola, exactamente como manda CLAUDE.md §5.4.
- **Las 19 funciones `SECURITY DEFINER` tienen `search_path=public` fijo** — no hay inyección por
  `search_path` en ninguna.
- **Cero secretos en todo el historial de git** (804 objetos, todas las ramas). Los `.gitignore`
  cubren `.env`, `.env.*` y `.dev.vars`.
- **El fix de hidratación de la Sesión 022 está completo**: los **11** formularios con `<form
  onSubmit>` usan `useHidratado()` y deshabilitan el submit hasta hidratar — incluido el login del
  portal, donde el submit nativo habría mandado documento y código de suscriptor en la query string.
  No hay ningún `<form>` sin esa protección.
- **Semgrep, hallazgo `index.ts:204` (ReDoS): FALSO POSITIVO**, medido en vez de supuesto. En
  `^[a-z0-9]+(-[a-z0-9]+)*$` el grupo interno empieza por `-`, que no pertenece a `[a-z0-9]`, así que
  no hay ambigüedad para el backtracker. 50.000 caracteres del peor caso clásico → **0,288 ms**,
  tiempo lineal. No requiere acción.
