# CHANGELOG — UndreoCol

Formato: una entrada por sesión de trabajo. Lo más reciente arriba.

## [Sin publicar]

### 2026-08-31 — Sesión 006: Implementación de la fundación
**Hecho**
- Aprobados `specs/001-fundacion/plan.md` y `specs/001-fundacion/tasks.md`
- Instalado Node 20.20.2 vía nvm (requisito del stack: Node 20+)
- Scaffolding Next.js 15.5.24 + TypeScript estricto + Tailwind + Vitest con
  `output: 'standalone'` (app/, configs, eslint flat con `eslint-config-next` 16)
- Migración única `supabase/migrations/20260831150000_fundacion-tenancy.sql`:
  6 tablas (planes, clientes, perfiles, membresias, configuracion,
  usuarios_servicio mínima sin `perfil_id`), enums (rol_usuario de 3 valores),
  funciones SECURITY DEFINER, trigger updated_at, RLS con FORCE y políticas
- `lib/db.ts` (crearClienteServidor) y `lib/auth.ts` (dos tipos de sesión:
  administrativa implementada; suscriptor como contrato que lanza
  `ErrorSesionSuscriptorPendiente`, D-4)
- Tests: unit de auth 12/12 verdes; fixtures y script de aislamiento RLS
  (pasos 2-11 de CA-1) redactados; test de integración auth vs Supabase local
- CA-2 en verde: `npm run build` sin warnings, `npm run lint` limpio,
  `dev:200` y `standalone:200`, grep `@supabase/` vacío en app/ y components/

**NO VERIFICADO — requiere entorno local (Docker + Supabase CLI + psql)**
- CA-1 pasos 1 y 6-11 (supabase db reset y ejecución del aislamiento RLS)
- T-01 (supabase init/start) y T-18 (integración contra Supabase local)
- CA-1 pasos 2-5 (estructura) están cubiertos por el script pero sin ejecutar

**Decisiones de implementación (hallazgos)**
- `eslint-config-next` 15.x legacy falla con ESLint 9.39 (@rushstack/eslint-patch
  incompatible con @eslint/eslintrc 3); se resolvió con `eslint-config-next`
  16.3.4 (flat nativo), que funciona con Next 15
- `next dev` sobreescribe `.next/` y borra el build standalone: el orden de
  verificación debe ser build → standalone, sin dev intermedio

**Pendiente de Mateo**
- Instalar Docker + Supabase CLI + psql y ejecutar las tareas 🐳
- Subir `specs/001-fundacion/spec.md` para contrastar CA-1/CA-2
- Decidir si se inicializa el repositorio git (`git init`) si no existe


### 2026-08-31 — Sesión 001: Gobernanza y esquema
**Hecho**
- Definidas las reglas de desarrollo en `CLAUDE.md`
- Inicializado el harness SDD: `.specify/`, `specs/plantillas/`
- Propuesto el esquema completo de PostgreSQL en `docs/esquema-propuesto.sql`
- Definido el roadmap de 13 features en `.specify/config.md`

**Decisiones**
- Proyecto nuevo, no migración: el repo de Frappe es especificación funcional, no código fuente
- Multi-tenant por esquema compartido con RLS `FORCE`, no una base por cliente
- Tarifa con estructura básico / no básico por servicio, conforme a la regulación CRA
- Infraestructura de costo cero hasta el primer cliente pagando

**Pendiente**
- Aprobación del esquema por Mateo
- Redactar `specs/001-fundacion/spec.md`

### 2026-08-31 — Sesión 002: Decisiones D-1/D-2 y spec de la fundación
**Hecho**
- Redactado `specs/001-fundacion/spec.md` con 8 criterios de aceptación
- Actualizado `docs/esquema-propuesto.sql` con las decisiones D-1 y D-2
- Actualizado `CLAUDE.md` §9 casos 15 y 25

**Decisiones**
- **D-1:** `limite_basico_m3` es INCLUSIVO. Con límite 22 y consumo 25 → 22 m³ básicos + 3 no básicos
- **D-2:** los suscriptores NO van en `auth.users`. El portal usa sesión propia firmada,
  validando cédula + `codigo_suscriptor` en el servidor. Se elimina el rol `suscriptor`
  del enum, `usuarios_servicio.perfil_id` y la función `mi_suscriptor_id()`

**Pendiente**
- Aprobación del spec 001 por Mateo
- Redactar `specs/001-fundacion/plan.md`

### 2026-08-31 — Sesión 003: Documentación base
**Hecho**
- Redactado `docs/ESPECIFICACION-FUNCIONAL.md` con todo el comportamiento del sistema
- Redactado `docs/INFRAESTRUCTURA.md` con entornos, costos, despliegue, backups y portabilidad

**Pendientes documentados en INFRAESTRUCTURA.md §12**
- Tarifas reales de Soacha/EAAB (para casos dorados)
- Formato del número de factura
- Duración de sesión del portal del suscriptor
- Proveedor de correo (recomendado Resend)
- Dominio del producto

### 2026-08-31 — Sesión 004: Gestión de tarifas en tiempo real
**Hecho**
- `docs/ESPECIFICACION-FUNCIONAL.md §2.4.1`: sección completa de cambios de tarifa
  en tiempo real con reglas de integridad, efecto en historial y flujo del panel
- `CLAUDE.md §9`: 4 reglas nuevas sobre versionado de tarifas (0, 0b, 0c, 0d)
- `docs/esquema-propuesto.sql`: función `tarifa_vigente()` helper y comentarios
  explicativos en la tabla `tarifas`

**Decisiones**
- Las tarifas nunca se editan: se cierran y se crea una nueva versión
- La tarifa a usar en el cierre es la vigente en la fecha de ejecución del cierre
- Si no hay tarifa configurada para un suscriptor, el cierre lo marca como anomalía
  y no emite factura (no silencia el error)

### 2026-08-31 — Sesión 005: Decisiones D-3, D-4 y D-5
**Hecho**
- Creado `docs/DECISIONES.md` con contexto, opciones y razón de cada decisión
- D-3: número de factura formato `FAC-YYYY-NNNNN`, consecutivo anual, series por prefijo
- D-4: sesión del portal 30 días, cookie HttpOnly+Secure+SameSite=Lax, renovación automática <7 días
- D-5: tarifas de referencia Soacha (aproximadas) — requieren verificación de Mateo
- Actualizados `ESPECIFICACION-FUNCIONAL.md`, `CLAUDE.md`, `esquema-propuesto.sql` e `INFRAESTRUCTURA.md`
- Pendientes resueltos: 3 de 7 items de INFRAESTRUCTURA.md §12

**Pendientes que aún requieren Mateo**
- Tarifas reales verificadas contra resolución vigente (para `docs/CASOS-DORADOS.md`)
- Dominio del producto
- Proveedor de correo (Resend recomendado)
- Umbrales por defecto reales del negocio
