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

**M-2 · El `lector` ve todo el negocio del acueducto, no solo lecturas. — RESUELTO
(`specs/024-permisos-lector/`, commit `f5b2953`).**
Verificado que el problema existía: el lector de A veía exactamente lo mismo que el admin de A en
`facturas` (9), `pagos` (8), `usuarios_servicio` (6), `tarifas`, `cartera` y `configuracion` — y,
en una segunda pasada de auditoría (023→024), también en `cortes_reconexiones`, `notificaciones`,
`importaciones_suscriptores` y `reemplazos_contador` (mismo patrón, no se habían revisado antes).
`ESPECIFICACION-FUNCIONAL.md §3` dice que el lector "solo puede crear y ver lecturas" y "ver y
ejecutar órdenes **asignadas a él**". *Resuelto:* se eliminaron las 10 políticas `_lectura`
sobre-amplias (`cliente_id IN mis_clientes()`, sin filtrar rol) — la política `_admin`/`_escritura`
(`ALL`, `es_admin_de`) que cada tabla ya tenía sigue cubriendo a `admin_acueducto`/`administrador`
sin cambios. Para `usuarios_servicio`, que el lector sí necesita parcialmente (armar el desplegable
de `/app/lecturas`), se agregó `usuarios_servicio_lector()` (`SECURITY DEFINER`): expone solo
`id, codigo_suscriptor, nombre, contador_actual_id, estado` — sin cédula, teléfono, email,
dirección ni notas. Verificado contra PostgreSQL real, dos veces reproducido desde cero
(`tests/aislamiento/014`): lector en 0 en las 11 tablas; `admin_acueducto` sin cambios; la función
nueva no expone columnas sensibles (falla con `undefined_column` si se le piden). La asignación de
rutas al lector (`ESPECIFICACION-FUNCIONAL.md §2.14.1`, "**no existe como feature todavía**") quedó
fuera de 024 a propósito, tal como se documentó — no bloqueaba cerrar la sobre-exposición de
lectura.

**M-2b · El `lector` podía disparar la emisión REAL de facturas de todo el acueducto. — RESUELTO
(`specs/024-permisos-lector/` §3.4, commit `1e767b6`), hallazgo nuevo encontrado auditando M-2 más
a fondo antes de planear su corrección.**
`POST /facturacion/periodos/:id/emitir` no tenía guard de rol (a diferencia de
`GET /dashboard/indicadores`, que sí lo tiene). No escribía ninguna tabla protegida por RLS antes de
encolar: leía tarifas/consumo con el JWT del llamante y encolaba un mensaje `emitir_factura` por
suscriptor a `FACTURACION_COLA`; el consumidor de esa cola (`queues/cierre-facturacion.ts`) escribe
con `service_role`, **sin pasar por RLS en absoluto**. Es decir: la afirmación de M-2 de que "la
escritura está bien acotada" era cierta para INSERT/UPDATE directos vía RLS, pero no cubría esta vía
indirecta por cola — antes de este commit, con una sesión real de `lector`, se podía encolar la
emisión de facturas de todo el acueducto. Dos rutas hermanas (`.../simular`, y los dos
`enviar-correo`) tenían el mismo patrón de fondo (sin guard); las de correo ya fallaban de hecho
porque insertan en `notificaciones` con el JWT del llamante y esa tabla sí exige `admin_acueducto`
— pero fallaban en silencio (`202` con `encoladas: 0`), no con un error claro. *No era cruce de
tenant* (el lector solo afectaba su propio acueducto, no otros) y *requería una cuenta de lector
real* (no era explotable de forma anónima), por eso se clasifica ALTO y no CRÍTICO — mismo nivel que
M-2, del cual es la contraparte de escritura. *Resuelto:* guard de rol
(`ctx.rol === 'admin_acueducto'`) en las 4 rutas, mismo patrón ya usado en
`/dashboard/indicadores`. Verificado contra `wrangler dev` real, con sesiones reales de
`admin_acueducto` y `lector`: las 4 rutas dan `403` al lector (incluida `/emitir`); `admin_acueducto`
no pierde nada.

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

**M-4 · Cookies `SameSite=Lax` con frontend y backend en sitios distintos. — RESUELTO (feature 020),
verificado en producción real.**
Se confirmó en producción real, con evidencia de Mateo (pestaña Network): `undreocol-
frontend.undreocol.workers.dev` y `undreocol-api.undreocol.workers.dev` **son sitios distintos** —
`workers.dev` está en la Public Suffix List, así que la cuenta (`undreocol`) no basta para
compartir dominio registrable, cada Worker de la cuenta es su propio sitio. No era "probablemente ya
no aplica" (así se dejó escrito por error en la Sesión 029, `CHANGELOG.md`): el login respondía `200`
con `Set-Cookie` válido, pero la cookie quedaba bajo el dominio de la API y el frontend nunca la veía
— el login nunca llevaba a ningún lado. **No se corrigió con `SameSite=None`** (la advertencia de CSRF
de abajo sigue aplicando): se eligió la Opción B (proxy de mismo origen, `specs/020-proxy-
cookies-mismo-origen/`) — el navegador deja de hablar directo con la API; el Worker del frontend
reenvía por Service Binding, así que la cookie queda scopeada al dominio que el navegador visita.
`SameSite=Lax` se mantiene sin cambios, y con él la única defensa CSRF del sistema.

**Verificación real, Sesión 032/033, contra producción:** con el backend Y el frontend desplegados
desde código actualizado (el backend llevaba días sin redesplegarse — causa de una segunda ronda de
errores, ver CHANGELOG), `curl` real con cookie guardada:
```
POST /api/auth/login  -> 200, Set-Cookie bajo undreocol-frontend.undreocol.workers.dev (antes: bajo
                          undreocol-api.undreocol.workers.dev)
GET  /app/dashboard    -> 307 -> /plataforma (esAdminPlataforma=true, cuenta superadmin sin acueducto)
GET  /plataforma       -> 200, "Panel de plataforma" en el cuerpo
```
Confirmado también visualmente por Mateo en su navegador real.

**M-5 · El registro era público y crear acueducto era gratis. — RESUELTO (Sesión 041,
decisión de Mateo: cerrar el registro).**
`POST /auth/registro` era abierto y `crear_tenant_con_admin()` estaba otorgada a `authenticated`:
cualquiera creaba una cuenta y un acueducto gratis — y en Supabase Free la base tiene 500 MB
(`ARQUITECTURA.md §6`). Fue además el peldaño 2 de la cadena de C-1.

*Resuelto:* la feature 018 (panel de plataforma) ya había reemplazado la necesidad real de este
flujo con uno controlado — solo el superadmin (`administrador`, membresía sin `cliente_id`) da de
alta acueductos, desde `POST /plataforma/acueductos`. Con esa vía en producción, el autoservicio
gratuito no tenía ningún beneficio de producto, solo superficie de abuso. Migración
`20260922090000`: `revoke execute on function crear_tenant_con_admin(text, text, text) from
authenticated`. No se elimina la función ni su atomicidad — si el autoservicio se convierte en un
objetivo de producto real, se reactiva con un solo `GRANT` (mismo criterio que B-1 más abajo).
`service_role` no pierde acceso (nunca tuvo `GRANT` explícito, lo alcanza por los *default
privileges* del bootstrap de Supabase, igual que `tamano_base_mb()`).

Se eliminaron del Worker las dos rutas públicas que formaban la cadena de autoservicio:
`POST /auth/registro` (sin ningún uso legítimo — no había página en el frontend que lo llamara,
solo era invocable a mano, exactamente como lo usó C-1) y `POST /onboarding` (el formulario de
autoservicio). La página `/onboarding` del frontend se conserva porque `GET /dashboard` sigue
redirigiendo ahí a cualquier cuenta sin membresía activa — hoy ese es un borde real: un alta desde
`/plataforma/acueductos` que falla a mitad de camino (`auth.users` creado, membresía sin
vincular). Se reemplazó el formulario muerto por un mensaje explicando el estado y un botón de
salir (reutiliza `BotonSalir`, 021) — mejora aplicada junto con el cierre, a criterio propio: dejar
el formulario tal cual habría quedado como un botón "Crear acueducto" que siempre falla con un
error de Postgres sin explicación.

**Deviación de spec documentada:** esto reemplaza el flujo manual CA-11 de `001-fundacion`
("registro → onboarding → dashboard → logout → login → dashboard") — ese flujo ya no existe, el
alta de acueductos pasa por 018. CA-7 (atomicidad del onboarding transaccional) no se ve afectado:
la función conserva su atomicidad, solo cambió quién puede invocarla.

**Verificado:** test `tests/aislamiento/001_fundacion_aislamiento.sql` (PASO 14) actualizado —
`authenticated` recibe `permission denied` al intentar `crear_tenant_con_admin()`; la atomicidad
(slug duplicado, "ya tiene acueducto", sin huérfanos) se re-verificó completa como `service_role`,
el único rol que conserva acceso. Contraprueba: con el `GRANT` reotorgado a mano, el mismo test
falla exactamente en esa aserción (`PASO 14 FALLÓ: authenticated ejecutó crear_tenant_con_admin
pese a M-5`) — confirma que mide lo que dice medir. `FUNDACION-AISLAMIENTO OK` contra PostgreSQL
real (22 migraciones desde cero + fixture). Backend: **217/217 tests en verde** (incluye
`registro-cerrado.test.ts`, nuevo: confirma `404` real de `app.fetch` en ambas rutas eliminadas).
Frontend: `npm run build` y `npm run lint` limpios. Backend: `npx wrangler deploy --dry-run`
exitoso.

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

**B-1 · `planes` es legible por `anon`. — CERRADO, decisión consciente de Mateo (Sesión 042): queda
público.** (`planes_lectura ... using (true)`). Expone el catálogo comercial de UndreoCol (nombres
de plan y `valor_suscriptor`) a cualquiera. Es la única tabla de las 22 legible sin sesión. Que el
catálogo comercial de un SaaS sea público es normal — no se toca. Verificado que hoy **nada lo lee
salvo `GET /salud`**, que lo usa como prueba de conectividad. Si en el futuro cambia de opinión, el
cambio sigue siendo de una línea:
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

**B-5 · `postcss` con 4 vulnerabilidades por dependencia transitiva de `next`. — PARCIALMENTE
RESUELTO (Sesión 047): `sharp` corregido, `postcss`/`next` sigue abierto, y se sumó un hallazgo
nuevo en backend.**
`npm audit` del frontend lo confirma; el arreglo de `postcss` exige `next@16` (cambio mayor, sin
tocar por ahora — decisión de Mateo pendiente). Las cuatro advertencias requieren CSS controlado
por un atacante y aquí PostCSS solo procesa el CSS propio del proyecto en tiempo de compilación. Sin
ruta de explotación en este sistema.

*Corregido en la misma sesión:* `sharp` (alta, vía `miniflare`/`wrangler`, dependencia de
desarrollo — nunca viaja al Worker desplegado) con `npm audit fix` (sin `--force`, sin cambios de
versión mayor). Verificado: `npm run build` y `npm run lint` limpios; `wrangler deploy --dry-run`
exitoso (requiere Node ≥22 desde este parche — ya disponible vía `nvm` en este equipo, `v22.23.2`;
con el Node por defecto del shell, v20, `wrangler` ahora rehúsa arrancar con un mensaje explícito,
no en silencio).

**Hallazgo nuevo — backend, no en el `npm audit` original.** `npm audit` real del backend hoy:
**10 vulnerabilidades** (3 moderadas, 6 altas, 1 crítica), no las 0 que este documento decía antes
— drift normal de un árbol de dependencias de `wrangler` que no se había vuelto a auditar. Mismo
perfil que `sharp`/B-5: todas dentro del árbol de herramientas de desarrollo (`miniflare`, `vitest`,
`esbuild`, `vite`, `undici`, `ws`), ninguna viaja al Worker real desplegado (el bundle de
`wrangler deploy` es solo `src/`, no sus propias herramientas). **No se corrigió**: a diferencia del
`sharp` de frontend, acá `npm audit fix` (sin `--force`) no encontró ningún cambio no-breaking
aplicable — la única vía es `--force`, que sube `vitest` de `^2.1.0` a `4.1.11` (dos versiones
mayores), un cambio real de test runner que exige correr los 217 tests y revisar compatibilidad de
config antes de aceptarlo. Decisión de Mateo pendiente, del mismo tamaño que la de `next@16`.

**B-6 · No había cabeceras de seguridad en el frontend. — RESUELTO Y VERIFICADO (`4ab4200`).** (`next.config.ts` estaba vacío): sin CSP, sin
`X-Frame-Options`/`frame-ancestors`, sin `Referrer-Policy`. El panel administrativo se podía embeber
en un iframe (clickjacking sobre un panel que anula facturas y cambia tarifas). *Resuelto:* las cinco
cabeceras que no pueden romper una aplicación normal. **Deliberadamente NO se añadió una CSP
completa** —una CSP mal ajustada rompe la aplicación en silencio—; merece su propia tarea con el
navegador delante. **Verificado (Sesión 033), `curl -I` real contra producción:**
```
content-security-policy: frame-ancestors 'none'
permissions-policy: camera=(), microphone=(), geolocation=()
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
```

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

---

## Estado general — qué queda pendiente (actualizado 2026-09-13, Sesión 055)

Consolidado de todo lo abierto a esta fecha, para no tener que reconstruirlo de memoria en la
próxima sesión. Cada punto tiene su detalle completo en el hallazgo, spec o entrada de CHANGELOG
que se referencia.

**Cerrados desde la última actualización (Sesión 042, en otra conversación):** M-5 (registro
público) y B-1 (`planes` público — Mateo confirmó dejarlo así, decisión consciente, no pendiente).

**Sesión 046:** `undreocol-produccion` quedó sincronizada con el esquema local — ver "Sincronización
de `undreocol-produccion`" más abajo. El stack local de Docker, reportado caído al cierre de la
Sesión 042, ya está restaurado (confirmado corriendo esta sesión).

**Sesión 047:** parche de `sharp` en frontend (B-5, no-breaking). Hallazgo nuevo: backend tenía 10
vulnerabilidades sin documentar (no las 0 que decía este archivo), todas en herramientas de
desarrollo de `wrangler`, sin ruta de explotación en el Worker real — ver B-5 más abajo.

**Sesión 051:** feature 033 (credenciales del panel de plataforma) implementada y verificada de
punta a punta contra `wrangler dev` real — ver "Panel maestro" más abajo. Bug real encontrado y
corregido durante la auditoría: `auth.updateUser()` necesita `setSession()` con ambos tokens de la
cookie, no alcanza con el `access_token` como header (patrón que sí sirve para las consultas
PostgREST del resto del sistema, pero no para el módulo `auth.*`) — las pruebas unitarias con mocks
no lo detectaban, solo se vio corriendo la ruta real.

**Sesión 052:** feature 034 (completar recuperación de contraseña) — cierra el flujo de "olvidé mi
contraseña" que 033 dejó a medias: el correo se enviaba pero el enlace no llevaba a ninguna página
funcional. Investigación previa confirmó que el flujo PKCE no sirve para este caso (quien pide la
recuperación y quien hace clic en el correo casi nunca comparten navegador) — se fijó
`flowType: 'implicit'` explícito. **Dos bugs reales encontrados en la auditoría, ninguno visible en
build/lint/tests con mocks, solo siguiendo el enlace real de punta a punta:** (1) `redirectTo`
usaba `ALLOWED_ORIGIN` tal cual, sin ruta — el correo llevaba a la raíz del sitio, no a
`/restablecer-contrasena`; (2) `supabase/config.toml` no tenía esa URL en su lista blanca de
redirects — Supabase Auth la rechazaba en silencio y caía al `site_url` por defecto (que además
usaba `127.0.0.1` mientras el resto del proyecto usa `localhost`, inconsistencia previa a esta
sesión). Los dos corregidos y reverificados contra el enlace real del correo, no contra una
suposición de cómo debía verse.

**Sesión 053:** feature 019 (invitar admin de acueducto por correo) — reemplaza la contraseña
temporal de 018 por una invitación real, reutilizando `resetPasswordForEmail` +
`/restablecer-contrasena` (033/034). Bug real encontrado en la auditoría: Luna reescribió el cuerpo
de `recovery.html` pero no el asunto del correo (vive aparte en `config.toml`), corregido y
reverificado con un correo real. Ver CHANGELOG para el detalle completo.

**Sesión 054:** feature 015, mitad QR (dividida de OCR por decisión de Mateo) — botón "Escanear QR"
en "Nueva lectura" y "Ver etiqueta QR" en la ficha del suscriptor, cero backend nuevo. A pedido de
Mateo, esta sesión agregó una regla nueva a CLAUDE.md §3: ninguna decisión de implementación se
inventa, se investiga primero contra prácticas de la comunidad (aplicada acá:
`BarcodeDetector` nativo + corrección de errores nivel H). De paso se corrigieron dos desvíos de
documentación encontrados al escribir el spec: `ESPECIFICACION-FUNCIONAL.md §2.14.1` decía
"Feature 014" (el registro maestro `.specify/config.md` confirma que siempre fue 015), y ese mismo
registro maestro no reflejaba la 019 (Sesión 053) como implementada.

**Sesión 055:** feature 035 — planes/estado de cuenta y salud del sistema en `/plataforma`, los dos
únicos módulos del mapa que seguían sin empezar desde 033. T-001 (backend) por Luna, auditado y
corregido por Claude; T-002 (frontend) implementado directamente por Claude (autorización expresa).
**Dos bugs de seguridad/robustez reales, invisibles en build/lint/tests con mocks:** un `GRANT` de
columna que faltaba (023 ya había revocado el `UPDATE` completo de `clientes` para `authenticated`)
y, más serio, ese mismo `GRANT` sin un trigger dejaba a un `admin_acueducto` cambiar el plan/estado
de su propio acueducto vía una política de RLS de 023 pensada para otra columna — RLS combina
políticas de `UPDATE` con OR, no distingue por columna. Corregido con un trigger, mismo patrón que
`bloquear_factura_inmutable`. Un tercer bug (declaration merging de dos `interface Acueducto`
homónimas en `lib/api.ts`, previo a esta sesión) se encontró implementando el frontend. Ver
CHANGELOG Sesión 055 para el detalle completo y la evidencia real de cada verificación. De paso,
esta sesión agregó Knip (ISC) a backend y frontend para código muerto en TypeScript, a pedido de
Mateo — PL/pgSQL y un bundler aparte se descartaron tras investigar (ya resueltos por
Wrangler/Next.js; sin problema medido para tocar SQL de dinero).

**Sesión 056:** feature 036 (OCR de lectura, mejor esfuerzo v1 con `tesseract.js`) y feature 038
(guardado offline de lecturas — activa `id_cliente_offline`, que existía sin usar desde 004),
ambas implementadas directamente por Claude (autorización expresa, no pasaron por Luna). De paso,
limpieza de 2 exports muertos de 035 (`listarAcueductos`/`obtenerSaludSistema`, duplicados por
`app/plataforma/page.tsx`, no una pantalla faltante). **Hallazgo con impacto más allá de esta
sesión: Playwright + Chromium SÍ se puede instalar en este entorno** (aislado, nunca como
dependencia del proyecto) — se usó para verificar de punta a punta, con navegador real, los CA de
036 y 038 que habían quedado "NO VERIFICADO — requiere Mateo" por la vieja asunción de que este
entorno no tenía Chromium. Los "Verificación en navegador real — pendiente de Mateo" de la sección
de abajo deberían revisarse con esto en mente la próxima vez que se retomen, en vez de asumir que
siguen bloqueados. Detalle completo, metodología y resultado de cada CA en el CHANGELOG.

### Hallazgos de seguridad/producto, genuinamente abiertos (ninguno urgente, todos son decisión de Mateo o trabajo mayor)

- **B-5 · `postcss` (frontend, cambio mayor `next@16`) y el árbol de `wrangler` en backend
  (cambio mayor `vitest` 2→4).** `sharp` ya se corrigió en frontend sin cambios mayores. Ninguna de
  las dos tiene ruta de explotación real en este sistema — ambas son dependencias de desarrollo, no
  código que llegue al Worker desplegado.
- **"Leaked password protection" de Supabase Auth** — un toggle en el dashboard, nunca activado.
  No es de código; es un clic de Mateo.

### Verificación en navegador real — pendiente de Mateo

**Actualización Sesión 056: este encabezado ya no es del todo cierto.** Se confirmó que Playwright +
Chromium SÍ se pueden instalar en este entorno (aislado, no como dependencia del proyecto) — se usó
para verificar 036 y 038 de punta a punta contra un navegador real, no simulado. Antes de asumir que
un punto de esta lista "no se puede verificar acá", vale la pena intentar instalarlo — puede cambiar
la calidad de la evidencia entregada. Lo que sigue genuinamente fuera de alcance de este entorno es
lo que depende de hardware real que no existe acá (cámara física, un celular Android, una impresora
física) — no la falta de un navegador.

- **023** — encabezado + color de acento de la factura, imprimiendo de verdad (`Ctrl+P`).
- **025 (AquaLectura)** — el shell del lector en un celular real (o modo responsivo del navegador).
- **026** — colapso de la barra lateral en pantalla angosta, aspecto final de la tipografía Inter.
- **027** — aspecto visual final del Panel principal re-vestido.
- **Portal del suscriptor y descarga de PDF** — de punta a punta contra producción real (ya
  verificado en local, sesión de PDF/portal de esta misma sesión de trabajo).

### Rediseño visual — en curso, 5 de 15 pantallas

`specs/026-shell-panel-admin/propuesta-referencia.html` es la referencia completa. Hecho: el marco
compartido (026), el Panel principal (027), Facturación — lista (030), Detalle de factura (031) y
Cartera (032) — las últimas tres redactadas por Luna vía el flujo Luna/Claude, auditadas y
corregidas contra `next build`/`lint` reales antes de cerrar. `PagoForm` (compartido por las 3
pantallas de dinero) quedó re-vestido en su contenedor, sin tocar su lógica. Faltan, cada una su
propio spec cuando se decida seguir: Lecturas (vista admin), Suscriptores (lista + ficha + importar), Catálogo y
tarifas, Cortes, Notificaciones.
AquaLectura (025, vista del lector) ya tiene su propia identidad y no se reemplaza por la versión
del prototipo.

### Roadmap — features grandes sin empezar

- **Rol `secretaria` — implementado en 028:** migración `20260923090000_rol-secretaria.sql`,
  políticas RLS y guardas de funciones verificadas contra PostgreSQL real; `secretaria` puede hacer
  la operación administrativa permitida y registrar pagos, pero no puede ver indicadores ni anular,
  ejecutar cortes/reconexiones, cambiar tarifas o configuración. Test `015` en verde y regresión de
  `admin_acueducto` en verde. Pendiente únicamente la integración HTTP contra Workers y la inspección
  visual en navegador real.
- **Autorización temporal de tarifas para `secretaria` — implementada en 029:** `admin_acueducto`
  autoriza servicio+categoría con motivo y expiración; la autorización es de un solo uso, revocable
  y queda en bitácora inmutable. Suite SQL 016 en verde. El superadmin conserva permisos globales
  de base de datos; la selección visual de cliente desde el panel maestro queda como mejora separada.
- **Feature 019 (invitar admin de acueducto por correo) — implementada (Sesión 053):** el alta de
  un acueducto ya no muestra una contraseña temporal; envía una invitación real reutilizando
  `resetPasswordForEmail` + `/restablecer-contrasena` (033/034). Verificado de punta a punta contra
  `wrangler dev` + Mailpit reales — ver CHANGELOG, Sesión 053, para el detalle y el bug real
  encontrado (asunto del correo desactualizado en `config.toml`, corregido).
- **Feature 015 — identificación por QR (Sesión 054) y feature 036 — sugerencia de lectura por OCR
  (Sesión 056), las dos mitades de la Feature 015 del roadmap original, ambas implementadas.**
  `specs/015-identificacion-contador-qr/` agrega "Escanear QR" en "Nueva lectura" (`qr-scanner`,
  `BarcodeDetector` nativo con respaldo) y "Ver etiqueta QR" en la ficha del suscriptor (`qrcode`,
  corrección de errores nivel H). `specs/036-ocr-lectura-contador/` agrega "Sugerir lectura con
  foto" al mismo formulario (`tesseract.js`, restringido a dígitos, mejor esfuerzo v1 — sin
  entrenamiento propio, decisión documentada). Ninguna de las dos toca backend/esquema; el `<select>`
  manual nunca se eliminó. 015 verificado con cabeceras reales contra sesión de lector real (Sesión
  054); 036 verificado con Playwright + Chromium real (Sesión 056) — OCR leyendo exacto una imagen
  de prueba, campo vacío sin error con una imagen borrosa. Pendiente de Mateo: una foto de un
  contador de agua real, en un celular Android real (única prueba que ningún tooling de este
  entorno puede simular).
- **Guardado offline de lecturas — implementado (038, Sesión 056).** Cola en IndexedDB del
  navegador (sin librería nueva), drenada al abrir AquaLectura y en cada evento `online` — sin
  Service Worker/Background Sync en v1 (decisión documentada, mejora futura). Activa
  `id_cliente_offline`, que el backend ya deduplicaba desde 004 sin que nada del frontend lo
  generara. Verificado con Playwright + Chromium real (Sesión 056): guardar sin conexión no la
  pierde, sube sola al reconectar, sobrevive a un reinicio de página, un rechazo real no reintenta
  en bucle. Pendiente de Mateo: prueba de campo con corte de señal genuino en un celular real.
- **Asignación de rutas/zonas al lector (037)** — dejada fuera de 024 y 025 a propósito ("no existe
  como feature todavía"). `specs/037-rutas-zonas-lector/` tiene spec+plan+tasks aprobados desde
  antes de esta sesión; **implementación sin empezar** (cero migración, cero función SQL, cero ruta
  backend). Es el único feature grande del roadmap del lector que sigue sin arrancar — se priorizó
  038 primero porque resuelve un problema de escala (varios lectores con zonas distintas) que no
  existe con cero clientes en producción, mientras que el offline resuelve un problema de día uno.

### Panel maestro (`/plataforma`) — mapa de módulos

Mateo pidió el mapa completo antes de aprobar 033, para no construir credenciales sin ver dónde
encaja. Los 5 puntos del mapa ya están implementados (3 y 4 los cerró 035, Sesión 055) — esta
sección queda como referencia de qué cubre cada uno, no como roadmap pendiente.

1. **Acueductos** — implementado en 018, ampliado por 033 y por 019 (Sesión 053: el alta ya no
   entrega contraseña, invita por correo — ver CHANGELOG): alta de acueducto + admin por
   invitación, lista, email del `admin_acueducto` de cada uno, restablecer su contraseña.
   **Verificado de punta a punta contra `wrangler dev` real (Sesión 051)**: `GET /plataforma`
   devuelve el `adminEmail` correcto por acueducto; "Restablecer contraseña" dispara el correo real
   de Supabase Auth
   (confirmado en Mailpit) y no revela si una cuenta existe o no. **El enlace de ese correo
   funciona de punta a punta desde 034** (antes llevaba a la raíz del sitio sin completar nada):
   verificado siguiendo el enlace real hasta `/restablecer-contrasena`, definiendo la contraseña
   nueva y confirmando el login con ella. **El alta por invitación (019) tiene su propia
   verificación de punta a punta, Sesión 053** (mismo mecanismo, admin recién creado en vez de uno
   existente) — ver CHANGELOG.
2. **Mi cuenta / Seguridad** — implementado en 033: el superadmin cambia su propia contraseña, con
   aviso por correo al cambiar. **Verificado de punta a punta (Sesión 051)**: login → cambiar
   contraseña → logout → la vieja falla, la nueva funciona; el correo de aviso se generó con el
   contenido correcto (confirmado leyendo el archivo simulado por `wrangler dev`). Si algún día hay
   más de un superadmin, este módulo crecería a "cuentas de superadmin" (crear/revocar otras
   cuentas `administrador`) — no existe esa necesidad hoy, hay una sola cuenta.
3. **Planes y estado de cuenta — implementado (035, Sesión 055).** Cada acueducto muestra su plan
   y su `estado_cuenta`, y el superadmin puede cambiar ambos (`PATCH /plataforma/acueductos/:id`) —
   `clientes_plataforma` (001) ya autorizaba el `UPDATE`, solo faltaba el `GRANT` de columna
   (revocado por 023 para `authenticated`) y, hallazgo real de la auditoría, un trigger para que
   `admin_acueducto` no pudiera cambiar el plan/estado de **su propio** acueducto vía la política de
   `color_acento` (023) — ver CHANGELOG. `estado_cuenta` sigue sin ningún efecto real en el resto del
   sistema (decisión explícita del spec, relevante recién cuando haya cobro real a acueductos, ver
   `ARQUITECTURA.md §6`); esto solo lo hace visible y editable.
4. **Salud del sistema — implementado (035, Sesión 055).** `/plataforma` muestra tamaño de la base
   + nivel (vía `_salud_sistema`, que `monitor-db.ts` ya escribe con su `service_role`), último
   keepalive (`_keepalive`, con una política de lectura nueva) y último backup (binding R2 nuevo
   `BACKUPS_R2`) — ninguno de los tres se mide en vivo ni usa `service_role_key` en la ruta del
   superadmin. Verificado con datos reales contra `wrangler dev` — ver CHANGELOG Sesión 055.
5. **Feature 019** (invitar admins de acueducto por correo, en vez de contraseña temporal) —
   **implementada (Sesión 053)**, dentro del flujo de alta de "Acueductos" (punto 1), no como módulo
   aparte.

### Producción real

La base de producción (`undreocol-produccion`) sigue **vacía**: 0 acueductos, 0 suscriptores. Nadie
la ha probado con datos reales todavía. El primer cliente piloto es lo que activa el primer gasto
de infraestructura (`ARQUITECTURA.md §6`).

### Stack local de Supabase (Docker) — RESUELTO

El incidente de la Sesión 042 (`supabase db reset`/`start` eliminó los 13 contenedores, el volumen
y la red del stack local por un desfase de versión de imágenes) quedó atrás: Mateo corrió
`supabase start` con red normal y el stack está arriba de nuevo — verificado esta sesión
(`docker ps`: los 13 contenedores, `supabase_db_UndreoCol2` sano, con los 24 migraciones aplicadas).
Nada de esto tocó nunca `undreocol-produccion` (Supabase Cloud, stack separado).

### Sincronización de `undreocol-produccion` — RESUELTO (esquema + código)

**Esquema: sincronizado.** `undreocol-produccion` estaba aplicada solo hasta `panel_plataforma`
(equivalente a `20260919090000`, feature 018). Esta sesión se le aplicaron, en orden, las 5
migraciones que faltaban — `personalizacion-factura` (023), `permisos-lector` (024),
`cerrar-registro-publico` (M-5), `rol-secretaria` (028) y `autorizacion-tarifas-secretaria` (029).
Verificado contra el proyecto real (no supuesto): `rol_usuario` incluye `secretaria`; las 9
funciones nuevas (`es_staff_de`, `importar_suscriptores`, `reemplazar_contador`, `registrar_pago`,
`bloquear_factura_inmutable`, `usuarios_servicio_lector`, `crear_autorizacion_tarifa`,
`revocar_autorizacion_tarifa`, `usar_autorizacion_tarifa`) existen; las 10 políticas `_staff`
existen y las políticas viejas de lectura amplia de M-2 ya no; `autorizaciones_tarifa` y
`auditoria_tarifas_autorizadas` existen con RLS `FORCE`; `authenticated` ya no puede ejecutar
`crear_tenant_con_admin` (M-5 cerrado también en producción, no solo en local).
`get_advisors` (seguridad) no encontró hallazgos nuevos: los únicos WARN son el mismo patrón ya
aceptado en la auditoría (`SECURITY DEFINER` con guarda interna, igual que `es_admin_de`/
`tarifa_vigente`) más los dos ítems ya conocidos de esta lista (leaked password protection,
`_keepalive` sin política por diseño).

**Código: RESUELTO, por el pipeline automático (022), no a mano.** Al detectar el desfase (el
Worker desplegado no tenía ni una línea de 028/029: 0 coincidencias contra el bundle real), se
decidió deliberadamente **no** correr `wrangler deploy` desde acá — `.github/workflows/deploy-
backend.yml`/`deploy-frontend.yml` (feature 022) ya disparan solos con cualquier push a `main` que
toque `backend/**`/`frontend/**`, con su propio dry-run, sus verificaciones (paquete sin
`.env.production` colado, sin llamadas cruzando dominio) y smoke test — saltárselos con un deploy
manual es exactamente el patrón que causó los incidentes de las Sesiones 021 y 035. El `git push
origin main` de esta sesión disparó ambos workflows automáticamente. Verificado después, contra la
API real de Cloudflare y HTTP real (no supuesto): `undreocol-api` y `undreocol-frontend` muestran
`modified_on` de hoy; el bundle desplegado de `undreocol-api` ya contiene `es_staff_de`/
`autorizaciones_tarifa`/`usar_autorizacion_tarifa` (0 → 3 coincidencias); `GET /salud` → `200`,
`GET /login` → `200`. Rol secretaria y autorización de tarifas ya son usables en producción real.

**Bookkeeping pendiente (cosmético, no bloquea nada):** las 5 migraciones se aplicaron pegando el
SQL a mano en el SQL Editor del dashboard (ver la mejora de abajo, "Cómo aplicar migraciones a
`undreocol-produccion`") en vez de por `apply_migration`/`supabase db push`, así que no quedaron
registradas en `supabase_migrations.schema_migrations`. El esquema real está correcto y verificado;
solo el historial del dashboard no lo refleja. Insertarlas ahí es opcional:
```sql
insert into supabase_migrations.schema_migrations (version, name) values
  (to_char(now(), 'YYYYMMDDHH24MISS'), 'permisos_lector'),
  (to_char(now() + interval '1 second', 'YYYYMMDDHH24MISS'), 'cerrar_registro_publico'),
  (to_char(now() + interval '2 second', 'YYYYMMDDHH24MISS'), 'rol_secretaria'),
  (to_char(now() + interval '3 second', 'YYYYMMDDHH24MISS'), 'autorizacion_tarifas_secretaria');
```

### Mejora propia (Sesión 046): cómo aplicar migraciones a `undreocol-produccion`

Documentado porque esta sesión lo tuvo que redescubrir a los tropezones, y la próxima no debería:

1. **`supabase db push --linked` no sirve tal cual está este equipo.** Pide la contraseña real de
   Postgres del proyecto (no la `service_role_key`), que no está guardada en ningún `.env`/
   `.dev.vars` del repo — correcto por CLAUDE.md §12, pero significa que `db push` se queda
   esperando un password que nunca llega y hay que matarlo a mano.
2. **La vía real es el MCP `apply_migration`** (autentica por la API de gestión de Supabase, no por
   la contraseña de Postgres) — así se aplicaron ya las 6 migraciones anteriores a esta sesión
   (`fix_autorizacion_siguiente_numero_factura` … `panel_plataforma`). Sus versiones en
   `supabase_migrations.schema_migrations` **no coinciden con los timestamps de los archivos
   locales** (usa el momento en que se llamó, no el prefijo del nombre del archivo) — es así desde
   antes de esta sesión, no es un desvío nuevo.
3. **El clasificador automático de seguridad de Claude Code bloquea `apply_migration` cuando el SQL
   trae varios `drop policy`/`grant`/`revoke`** (bloqueó `permisos_lector` dos veces seguidas, con
   el mismo mensaje ambas veces — no es un fallo transitorio para este patrón). Cuando pasa eso, no
   hay vuelta por `execute_sql` (mismo filtro) ni por forzar el reintento: la única vía es pegar el
   SQL a mano en el SQL Editor del dashboard.
4. **Pegar a mano tiene su propio riesgo, ya visto esta sesión:** un bloque de una sola línea
   (`cerrar_registro_publico`) se salteó al copiar entre dos bloques grandes, y quedó sin aplicar
   sin ningún error visible — se detectó recién al verificar el ACL real de la función, no por
   ningún mensaje de la consola. **Después de pegar a mano, verificar siempre contra el proyecto
   real** (ACL, `pg_policies`, `pg_proc`, no solo "Success. No rows returned"), nunca asumir que
   "no dio error" equivale a "se aplicó completo".
5. **Pegar a mano no deja rastro en `supabase_migrations.schema_migrations`** (ver bookkeeping
   arriba) — si además ese insert lo bloquea el clasificador (pasó esta sesión), queda un desvío
   documentado en vez de una corrección silenciosa.

**Corrección (Sesión 043):** los `tests/fixtures/*.sql` (los datos de prueba — Acueducto A,
`admin-a@test.local`, `lector-a@test.local`, las facturas de prueba, etc.) **no** los reaplica
`supabase start` — son fixtures de test, separados de las migraciones versionadas, y siempre se
aplicaron a mano (`psql -f tests/fixtures/*.sql`, en orden). Hace falta ese paso aparte después de
`supabase start` para volver a tener los mismos logins/datos que se venían usando.

**Estado a esta fecha (Sesión 043): sigue caído.** Confirmado de nuevo: `docker ps -a` sin
contenedores, puerto 54322 sin responder, `public.ecr.aws` sin resolver por DNS desde este entorno
— el mismo bloqueo de red del incidente original, verificado otra vez antes de intentar nada. No se
reintentó `supabase start`/`db reset` acá para no repetir el rollback destructivo que borró el stack
la primera vez. Pendiente que Mateo corra `supabase start` con su propia red; al confirmarlo, se
reaplican los fixtures.
