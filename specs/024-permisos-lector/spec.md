# SPEC — 024: permisos-lector

**Estado:** Borrador para aprobación
**Depende de:** 001-fundacion, 003-suscriptores-contadores, 004-lecturas-y-consumo

## 1. Objetivo

Cerrar el hallazgo M-2 de la auditoría pre-producción (`docs/PLAN-PRODUCCION.md`): el rol `lector`
lee hoy exactamente lo mismo que el `admin_acueducto` — facturas, pagos, tarifas, configuración y
el directorio completo de suscriptores (cédula, teléfono, email, notas) — cuando la especificación
funcional (§3) y CLAUDE.md §10 punto 24 dicen que "solo puede crear y ver lecturas y ejecutar
órdenes asignadas a él". Se acota la lectura por rol; la escritura ya estaba bien acotada (M-2 lo
confirma: el lector no puede insertar pagos, anular facturas, tocar tarifas ni configuración).

## 2. Por qué ahora

Hallazgo ALTO de la auditoría, pendiente desde que se documentó (M-2, sin fecha de cierre hasta
ahora). Mateo pidió continuar con él directamente en esta sesión. El riesgo concreto que describe
el propio hallazgo: el celular Android de un fontanero, perdido o robado en campo, entrega hoy el
registro completo de suscriptores (cédula, dirección, teléfono) y todo el histórico de facturación
y recaudo del acueducto — no una fuga entre acueductos (eso está bien: `mis_clientes()` sigue
aislando por tenant), sino sobre-exposición **dentro** del propio tenant, por rol.

## 3. Alcance

### 3.1 Bloqueo total de lectura para el rol `lector` en 6 tablas
`facturas`, `factura_detalles`, `pagos`, `pago_aplicaciones`, `tarifas`, `configuracion`: el
`lector` deja de poder leerlas, en cualquier forma (tabla directa, `GET /cartera` — que hoy es un
endpoint calculado sobre facturas/pagos con el JWT del usuario, así que se cierra solo en cuanto
RLS deja de dejarlo pasar). `admin_acueducto` y `administrador` no cambian.

### 3.2 `usuarios_servicio`: el lector conserva SOLO lo que necesita para su trabajo
Investigado contra el código real, no supuesto: `/app/lecturas` (la pantalla que usa el lector)
llama a `listarSuscriptores()` para el desplegable de "a quién le estoy tomando la lectura", y de
ahí usa exactamente 4 campos: `id`, `codigo_suscriptor`, `nombre`, `contador_actual_id` (más
`estado`, ya expuesto en otras listas del mismo endpoint). Sacarle al lector la tabla completa sin
más rompería ese flujo — es su trabajo real, no un capricho de la interfaz.

Decisión (confirmada con Mateo): el lector consulta esos 5 campos a través de una función/vista de
solo lectura nueva, nunca la tabla `usuarios_servicio` completa. `numero_documento`,
`tipo_documento`, `telefono`, `email`, `direccion`, `sector`, `categoria`, `notas` y
`fecha_vinculacion` quedan fuera para ese rol, a nivel de base de datos — no solo ocultos en la
interfaz. `GET /suscriptores` (el mismo endpoint que ya usa la pantalla) decide en el backend qué
fuente usar según `ctx.rol`; el frontend no cambia.

### 3.3 Sin cambios
`contadores`, `periodos`, `servicios`, `lecturas`: el `lector` los sigue leyendo igual que hoy — no
están en el hallazgo M-2 y los necesita para su trabajo (identificar el contador, saber qué periodo
está abierto). La escritura de `lecturas` (crear/revisar) tampoco cambia.

## 4. Fuera de alcance

- **Asignación de rutas/órdenes al lector** ("ejecuta órdenes asignadas a él", CLAUDE.md §10.24).
  `ESPECIFICACION-FUNCIONAL.md §2.14.1` ya reconoce que esto **no existe como feature todavía** y
  que no bloquea nada del roadmap actual. Sin esto, el lector sigue viendo **todas** las lecturas y
  **todos** los suscriptores (la lista acotada, no la completa) de su acueducto, no solo los de una
  ruta asignada — es una feature aparte, más grande, para más adelante.
- Ocultar campos de `usuarios_servicio` para el `admin_acueducto` — no aplica, el hallazgo es
  específico del rol `lector`.
- Cualquier cambio a nivel de Postgres ROLE (`authenticated` sigue siendo el único rol de conexión
  para ambos; la distinción `admin_acueducto`/`lector` sigue resolviéndose por `membresias.rol`
  dentro de las políticas/funciones, igual que en el resto del proyecto).

## 5. Reglas de negocio que aplican

- CLAUDE.md §10 punto 24: "El lector solo crea/ve lecturas y ejecuta órdenes asignadas a él" — esta
  feature cierra la parte de "solo lecturas"; la de "órdenes asignadas" queda fuera (§4).
- CLAUDE.md §5.4: RLS `FORCE` en toda tabla; ninguna política nueva se afirma sin su test de
  aislamiento.
- Mismo patrón que 008/010 (funciones `SECURITY DEFINER` que revalidan quién llama, nunca confían
  en un identificador desnudo) para la función/vista nueva de `usuarios_servicio`.

## 6. Criterios de aceptación

### CA-1 — El lector pierde lectura de las 6 tablas
Con sesión de `lector` de A: `select count(*) from facturas` (y las otras 5) devuelve 0 filas,
contra PostgreSQL real — no un 403 de la API, un aislamiento real de fila. `GET /cartera` con
sesión de lector devuelve vacío o error, nunca los datos del `admin_acueducto`.

### CA-2 — El `admin_acueducto` y el `administrador` no pierden nada
Mismas consultas, con sesión de `admin_acueducto` de A: siguen viendo exactamente lo mismo que
antes de esta feature (regresión, no solo el caso nuevo).

### CA-3 — El lector arma el desplegable de lecturas con datos mínimos
`GET /suscriptores` con sesión de `lector` devuelve `id`, `codigo_suscriptor`, `nombre`,
`contador_actual_id`, `estado` — y **no** `numero_documento`, `telefono`, `email`, `direccion`,
`notas`, aunque se pidan explícitamente. Verificado contra la respuesta HTTP real, no solo el tipo
de TypeScript.

### CA-4 — `/app/lecturas` sigue funcionando igual para el lector
Con sesión de lector real (`wrangler dev` + `next dev`), el desplegable de suscriptor/contador de
`/app/lecturas` se arma igual que antes — sin cambios visibles para quien hace el trabajo real.

### CA-5 — Aislamiento entre acueductos, sin cambios
El lector de A sigue sin ver nada de B en ninguna de las tablas tocadas (ya lo garantiza
`mis_clientes()`, se re-verifica que la función/vista nueva de `usuarios_servicio` no lo rompa).

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Alguna otra pantalla admin reutiliza `GET /suscriptores` y espera los campos completos | `ctx.rol` decide la fuente; `admin_acueducto`/`administrador` reciben la tabla completa sin cambios — solo `lector` ve la versión acotada |
| La función/vista nueva de `usuarios_servicio` se vuelve otro `SECURITY DEFINER` sin revalidar el llamante | Mismo patrón de 008/010: revalida `cliente_id` contra `mis_clientes()`/`tiene_rol()` del que llama, nunca confía en un parámetro desnudo |
| Romper `/app/suscriptores/[id]` u otras pantallas que si dependen de los campos completos, si por error quedan detrás del mismo guard de rol | Los CA verifican explícitamente que `admin_acueducto` no pierde nada (CA-2) |

## 8. Definición de terminado

- [ ] Todos los CA con evidencia
- [ ] `npm run build` (frontend) sin errores ni warnings de TypeScript
- [ ] `npx wrangler deploy --dry-run` (backend) exitoso
- [ ] `npm run lint` limpio en ambos proyectos
- [ ] Tests en verde
- [ ] Migración versionada + test de aislamiento nuevo, cubriendo las 6 tablas bloqueadas y la
      función/vista acotada de `usuarios_servicio`
- [ ] `docs/PLAN-PRODUCCION.md` actualizado: M-2 marcado resuelto (o "resuelto salvo asignación de
      rutas, fuera de alcance")
- [ ] `CHANGELOG.md` actualizado
- [ ] Aprobación de Mateo
