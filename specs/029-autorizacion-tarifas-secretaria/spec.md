# SPEC — 029: autorización temporal de tarifas para `secretaria`

**Estado:** Implementación aprobada por Mateo
**Depende de:** 002-catalogo-y-tarifas, 028-rol-secretaria

## Objetivo

Permitir que un `admin_acueducto` autorice a una `secretaria` a cambiar una tarifa
concreta, de un servicio y categoría concretos, durante una ventana temporal.

## Reglas

- La autorización la crea únicamente `admin_acueducto` del mismo acueducto.
- Debe indicar servicio, categoría, motivo y fecha de expiración.
- No puede expirar en el pasado ni superar 30 días.
- No puede haber dos autorizaciones abiertas para la misma combinación
  servicio+categoría en el mismo cliente.
- La autorización es de un solo uso.
- El administrador puede revocarla antes de usarla.
- La secretaria solo puede usar una autorización vigente que pertenezca a su
  acueducto y coincida exactamente con servicio y categoría.
- Cada uso genera una bitácora inmutable con autorización, ejecutor y valores
  económicos aplicados.
- `admin_acueducto` mantiene el cambio directo de tarifas.
- El superadmin de plataforma puede gestionar cualquier acueducto por sus
  permisos globales existentes.

## Criterios de aceptación

- CA-1: secretaria sin autorización recibe `403` al intentar crear una tarifa.
- CA-2: admin crea una autorización válida y la secretaria la ve.
- CA-3: secretaria usa la autorización una vez y crea la nueva versión.
- CA-4: la segunda utilización falla; la autorización queda consumida.
- CA-5: autorización expirada o revocada falla.
- CA-6: no se puede usar una autorización de otro servicio, categoría o acueducto.
- CA-7: admin conserva el flujo directo de tarifas.
- CA-8: superadmin puede leer y gestionar autorizaciones de cualquier cliente.
- CA-9: la bitácora no puede modificarse ni borrarse por usuarios autenticados.