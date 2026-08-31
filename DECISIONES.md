# DECISIONES.md — Registro de decisiones del proyecto

Cada decisión tiene: contexto, opciones evaluadas, decisión tomada y razón.
Las decisiones con código **D-N** están referenciadas en otros documentos.

---

## D-1 — `limite_basico_m3` es INCLUSIVO
**Fecha:** 2026-08-31 | **Tomada por:** Mateo Castro

Ver `ESPECIFICACION-FUNCIONAL.md §2.4`.

---

## D-2 — Suscriptores NO van en `auth.users`
**Fecha:** 2026-08-31 | **Tomada por:** Mateo Castro

Ver `ESPECIFICACION-FUNCIONAL.md §2.5` e `INFRAESTRUCTURA.md §4`.

---

## D-3 — Formato del número de factura
**Fecha:** 2026-08-31 | **Tomada por:** recomendación técnica aceptada

### Contexto
El sistema necesita generar números de factura únicos por acueducto,
legibles por humanos, y que soporten auditoría contable.

### Opciones evaluadas

| Opción | Ejemplo | Problema |
|---|---|---|
| Consecutivo global sin año | FAC-00001 | En el año 3 del sistema, la factura 36.000 ya no es legible |
| Consecutivo con año | FAC-2026-00001 | Reinicia en enero: la factura FAC-2027-00001 puede confundirse con la FAC-2026-00001 si alguien omite el año |
| Año + mes + consecutivo mensual | FAC-202601-001 | El consecutivo mensual puede ser muy corto para acueductos grandes |
| **Año + consecutivo anual con 5 dígitos** | **FAC-2026-00001** | Elegido |

### Decisión

Formato: `{prefijo}-{YYYY}-{NNNNN}`

- `prefijo`: configurable por acueducto, por defecto `FAC`
- `YYYY`: año de emisión con 4 dígitos
- `NNNNN`: consecutivo de 5 dígitos, **reinicia en 1 cada año**

Ejemplos:
```
FAC-2026-00001   primera factura de 2026
FAC-2026-00347   factura 347 del año 2026
FAC-2027-00001   primera factura de 2027 (reinicia)
REC-2026-00001   primera reconexión de 2026 (prefijo distinto)
```

### Series separadas por tipo

Las facturas de reconexión y de ajuste usan un prefijo distinto al de ciclo,
pero el **mismo consecutivo anual**. El consecutivo no es por tipo sino por año.

Esto simplifica la auditoría: el consecutivo anual de un acueducto nunca tiene
huecos ni solapamientos, sin importar el tipo de factura.

```
FAC-2026-00001   ciclo
FAC-2026-00002   ciclo
FAC-2026-00003   reconexión  ← siguiente en el consecutivo, prefijo distinto
FAC-2026-00004   ciclo
```

El administrador del acueducto puede configurar el prefijo de cada tipo en la
tabla `configuracion`. Por defecto: `FAC` para ciclo y ajuste, `REC` para
reconexión.

### Implementación

- `configuracion.consecutivo_factura`: entero que se incrementa en 1 por
  emisión. Se resetea a 0 el 1 de enero de cada año (cron job o al primer
  cierre del año).
- `configuracion.anio_consecutivo`: año al que corresponde el consecutivo
  actual. Si `anio_consecutivo < año actual`, se resetea automáticamente.
- El número se genera en el servidor dentro de una transacción para garantizar
  unicidad: `SELECT ... FOR UPDATE` sobre `configuracion` antes de incrementar.
- La unicidad final la garantiza `facturas(cliente_id, numero)` con índice único.

### Razón del reinicio anual

Los acueductos colombianos están habituados al formato año-consecutivo por
influencia de la facturación DIAN. Un auditor o un suscriptor que ve
`FAC-2026-00347` sabe inmediatamente que es la factura 347 del año 2026.

---

## D-4 — Sesión del portal del suscriptor
**Fecha:** 2026-08-31 | **Tomada por:** recomendación técnica aceptada

### Contexto

El suscriptor no tiene cuenta en `auth.users`. Necesita una sesión propia
que sea segura, simple de implementar y apropiada para el perfil del usuario:
personas que consultan su factura una vez al mes, desde el celular, en zonas
con conectividad variable.

### Opciones evaluadas

| Opción | Duración | Problema |
|---|---|---|
| Sesión muy corta (15 min) | Exige reautenticarse en cada visita. El suscriptor no recuerda su código | Mala UX para el perfil de usuario |
| Sesión muy larga (1 año) | Conveniente | Si alguien accede al celular del suscriptor, tiene acceso permanente |
| Sesión de 30 días con renovación | Equilibrio | Elegido |
| Sin expiración | Máxima comodidad | Riesgo de seguridad inaceptable |

### Decisión

**Duración de la sesión: 30 días con renovación automática.**

- El JWT se firma con `SESSION_SECRET` y tiene `exp` = 30 días desde la emisión
- Se guarda en una **cookie HttpOnly, Secure, SameSite=Lax**
  - `HttpOnly`: JavaScript no puede leerla (mitiga XSS)
  - `Secure`: solo se envía por HTTPS
  - `SameSite=Lax`: protección básica contra CSRF
- **Renovación automática:** si el suscriptor visita el portal con menos de
  7 días de vida restante en el JWT, el servidor emite un JWT nuevo.
  El suscriptor nunca nota la renovación.
- **Expiración dura:** si no visita el portal en 30 días, debe volver a
  autenticarse con cédula + código de suscriptor.

### Contenido del JWT

```json
{
  "sub": "<usuario_servicio_id>",
  "cid": "<cliente_id>",
  "iat": 1234567890,
  "exp": 1234567890,
  "tipo": "suscriptor"
}
```

El campo `tipo: "suscriptor"` distingue esta sesión de la sesión administrativa
en `lib/auth.ts`. Sin este campo, un JWT de suscriptor no puede acceder a rutas
administrativas.

### Si el suscriptor pierde su `codigo_suscriptor`

El administrador del acueducto puede **regenerar** el código desde el panel.
El código anterior queda inválido inmediatamente. La sesión activa del
suscriptor también queda inválida (el JWT referencia `usuario_servicio_id`,
pero la validación del servidor comprueba que `codigo_suscriptor` siga activo).

El nuevo código se le comunica al suscriptor por el canal que tenga disponible
(teléfono, visita presencial). No hay recuperación automática por email porque
muchos suscriptores no tienen email registrado.

### Invalidación de sesiones activas

No se implementa una lista negra de JWTs (requeriría Redis o una tabla de
tokens revocados, complejidad innecesaria en esta etapa). La invalidación
ocurre naturalmente cuando:

- El JWT expira (máximo 30 días)
- Se rota `SESSION_SECRET` (invalida todas las sesiones activas de todos los
  suscriptores de todos los acueductos — usar solo en emergencias)
- El `codigo_suscriptor` se regenera (la validación del servidor falla)
- El suscriptor pasa a estado `inactivo` o `cortado` — el servidor verifica
  el estado en cada petición

### Lo que el portal NO permite nunca

- Ver facturas de otro suscriptor
- Ver suscriptores del mismo acueducto
- Modificar ningún dato
- Acceder a rutas del panel administrativo

El aislamiento es responsabilidad del Route Handler del servidor, que filtra
siempre por el `usuario_servicio_id` extraído del JWT.

---

## D-5 — Tarifas de referencia (Soacha — datos aproximados)
**Fecha:** 2026-08-31 | **Tomada por:** recomendación técnica

### Contexto

Se necesitan tarifas de referencia para construir los casos dorados de
verificación de facturación. Mateo validó el sistema anterior contra las
tarifas reales de Soacha/EAAB. Se usan esos valores como referencia hasta
que Mateo entregue las tarifas definitivas verificadas.

### ⚠️ ADVERTENCIA

**Estos valores son aproximados y de referencia.** No usar en producción sin
verificación contra la resolución tarifaria vigente del acueducto real.
Actualizar `docs/CASOS-DORADOS.md` en cuanto Mateo entregue los valores reales.

### Tarifas de referencia — Soacha 2026 (aproximadas)

#### Servicio: Acueducto

| Categoría | Cargo fijo | Límite básico | Precio básico | Precio no básico |
|---|---|---|---|---|
| Estrato 1 | $4.200 | 11 m³ | $890/m³ | $1.780/m³ |
| Estrato 2 | $5.600 | 11 m³ | $1.070/m³ | $2.140/m³ |
| Estrato 3 | $7.800 | 22 m³ | $1.490/m³ | $2.980/m³ |
| Estrato 4 | $10.400 | 22 m³ | $1.980/m³ | $3.960/m³ |
| Estrato 5 | $13.000 | 22 m³ | $2.480/m³ | $4.960/m³ |
| Estrato 6 | $15.600 | 22 m³ | $2.970/m³ | $5.940/m³ |
| Comercial | $18.200 | 0 m³ | — | $3.460/m³ |
| Industrial | $20.800 | 0 m³ | — | $4.150/m³ |
| Oficial | $13.000 | 0 m³ | — | $2.480/m³ |

#### Servicio: Alcantarillado

| Categoría | Cargo fijo | Límite básico | Precio básico | Precio no básico |
|---|---|---|---|---|
| Estrato 1 | $3.800 | 11 m³ | $820/m³ | $1.640/m³ |
| Estrato 2 | $5.100 | 11 m³ | $980/m³ | $1.960/m³ |
| Estrato 3 | $7.100 | 22 m³ | $1.370/m³ | $2.740/m³ |
| Estrato 4 | $9.500 | 22 m³ | $1.820/m³ | $3.640/m³ |
| Estrato 5 | $11.800 | 22 m³ | $2.270/m³ | $4.540/m³ |
| Estrato 6 | $14.200 | 22 m³ | $2.730/m³ | $5.460/m³ |
| Comercial | $16.600 | 0 m³ | — | $3.190/m³ |
| Industrial | $19.000 | 0 m³ | — | $3.820/m³ |
| Oficial | $11.800 | 0 m³ | — | $2.270/m³ |

### Verificación del ejemplo conocido

Con las tarifas de referencia, estrato 3, consumo 25 m³:

```
Acueducto:
  Cargo fijo:          $7.800
  Básico (22 × $1.490):  $32.780
  No básico (3 × $2.980): $8.940
  Subtotal:            $49.520

Alcantarillado:
  Cargo fijo:          $7.100
  Básico (22 × $1.370):  $30.140
  No básico (3 × $2.740): $8.220
  Subtotal:            $45.460

Total:                 $94.980
```

El ejemplo validado por Mateo era $132.658 para el mismo caso. La diferencia
indica que las tarifas de referencia aquí son menores a las reales. Esto
confirma que **estos valores son solo de referencia** y deben reemplazarse
con los reales antes de los casos dorados definitivos.

### Acción requerida de Mateo

Entregar las tarifas reales verificadas contra la resolución vigente:
- Cargo fijo por estrato, para acueducto y alcantarillado
- Precio básico y no básico por m³, por estrato
- Límite de consumo básico por estrato (puede diferir entre estratos bajos y altos)
- Vigencia desde qué fecha

Con esos valores se actualiza esta tabla y se construyen los casos dorados en
`docs/CASOS-DORADOS.md`.
