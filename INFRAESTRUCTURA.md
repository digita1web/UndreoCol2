# INFRAESTRUCTURA.md — UndreoCol

**Versión:** 1.0
**Fecha:** 2026-08-31

---

## 1. Principio rector

> No se paga infraestructura hasta que un cliente esté pagando.

El costo de infraestructura de toda la plataforma debe mantenerse **por debajo
de USD $30/mes** hasta superar los 5.000 suscriptores facturados en total.

---

## 2. Stack de infraestructura

| Capa | Tecnología | Licencia |
|---|---|---|
| Frontend | Next.js 15 + TypeScript + Tailwind + shadcn/ui | MIT |
| Base de datos | PostgreSQL 15 vía Supabase | PostgreSQL License |
| Autenticación administrativa | Supabase Auth | Apache 2.0 |
| Sesión del portal suscriptor | JWT firmado en servidor (Next.js Route Handler) | — |
| Autorización | Row Level Security nativo de PostgreSQL | — |
| PDF | pdfme | MIT |
| Correo transaccional | Por definir — recomendado Resend (3.000/mes gratis) | — |
| Hosting | Vercel (frontend) + Supabase Cloud (DB) | — |

---

## 3. Entornos

### 3.1 Desarrollo local — costo $0

```
Base de datos:  Supabase CLI sobre Docker (PostgreSQL local)
Frontend:       npm run dev (Next.js en modo desarrollo)
Auth:           Supabase local (incluido en el CLI)
Correo:         Inbucket (servidor local, incluido en Supabase CLI)
```

No se necesita ningún servicio de pago para desarrollar. El entorno local es
completamente autónomo.

**Requisitos del equipo de desarrollo:**
- Docker Desktop (o Docker Engine en Linux)
- Node.js 20+
- Supabase CLI
- Git

### 3.2 Staging — costo $0

```
Base de datos:  Proyecto gratuito de Supabase #2 (distinto al de producción)
Frontend:       Vercel (plan Hobby, uso no comercial = solo demos internas)
```

Staging existe para:
- Probar el cierre de facturación antes de hacerlo en producción
- Restaurar y verificar backups de producción
- Validar cada despliegue antes de subir a producción

**Regla absoluta:** ningún cierre de facturación de prueba se ejecuta contra la
base de producción. Nunca.

El proyecto de Supabase gratuito se pausa tras ~1 semana de inactividad. Para
reactivarlo: entrar al panel de Supabase → proyecto → clic en "Restore project".
El proceso toma ~2 minutos.

### 3.3 Producción — costo desde USD $25/mes

```
Base de datos:  Supabase Pro (~USD $25/mes, sin pausa, backups diarios)
Frontend:       Vercel Pro (~USD $20/mes, uso comercial habilitado)
Correo:         Resend (plan gratuito hasta 3.000 emails/mes, luego ~$20/mes)
```

**Cuándo se activa producción:**
- Cuando el primer acueducto cliente pague su primera mensualidad
- No antes

**Costo total de producción:**

| Suscriptores facturados | Ingreso mensual (COP) | Costo infra (USD) | Margen bruto |
|---|---|---|---|
| 300 (1 cliente pequeño) | $210.000 | ~$45 ≈ $180.000 | ~15% |
| 1.000 | $700.000 | ~$45 ≈ $180.000 | ~74% |
| 3.000 | $2.100.000 | ~$45 ≈ $180.000 | ~91% |
| 10.000 | $7.000.000 | ~$70 ≈ $280.000 | ~96% |

El costo de Supabase es fijo hasta 8 GB de base de datos. Con el esquema
diseñado, 10.000 suscriptores con 24 meses de historia caben en menos de 2 GB.

---

## 4. Arquitectura de despliegue

```
Internet
   │
   ▼
Vercel (Next.js)
   │
   ├── App Router — páginas del panel administrativo
   ├── App Router — portal del suscriptor
   ├── Route Handlers — API interna
   │      ├── Llaman a Supabase con anon key (sesiones admin)
   │      └── Llaman a Supabase con service key (sesión suscriptor, workers)
   │
Supabase
   ├── PostgreSQL + RLS
   ├── Supabase Auth (solo usuarios administrativos)
   └── Storage (fotos de lecturas, PDFs generados)
```

**Nota sobre la sesión del suscriptor:** el portal no usa Supabase Auth. El
Route Handler valida `numero_documento` + `codigo_suscriptor`, consulta
`usuarios_servicio` con la `service_role_key` (servidor, nunca expuesta al
navegador), y emite un JWT propio firmado con `SESSION_SECRET`. Ese JWT se
guarda en una cookie HttpOnly. Toda consulta del portal pasa por el servidor,
que filtra por `usuario_servicio_id` antes de devolver los datos.

---

## 5. Variables de entorno

Documentadas en `.env.example`. **Nunca se commitean valores reales.**

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=          # URL del proyecto (pública)
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Clave anónima (pública, RLS protege)
SUPABASE_SERVICE_ROLE_KEY=         # Clave de servicio — SOLO en servidor, NUNCA en cliente

# Sesión del portal del suscriptor (D-4)
# JWT HttpOnly + Secure + SameSite=Lax, duración 30 días, renovación a <7 días
SESSION_SECRET=                    # Mínimo 32 chars aleatorios. NUNCA en NEXT_PUBLIC_

# Correo (cuando se implemente)
RESEND_API_KEY=                    # API key de Resend

# URL base (para emails y redirecciones)
NEXT_PUBLIC_APP_URL=               # https://app.undreocol.com en producción
```

### Reglas de seguridad

- `SUPABASE_SERVICE_ROLE_KEY` y `SESSION_SECRET` son **secretos de servidor**.
  Nunca van en variables con prefijo `NEXT_PUBLIC_`. Nunca llegan al navegador.
- Rotación de `SESSION_SECRET`: al rotar, todas las sesiones del portal activas
  quedan inválidas. Los suscriptores deben volver a autenticarse.
- Si `SUPABASE_SERVICE_ROLE_KEY` se expone accidentalmente, rotarla de inmediato
  desde el panel de Supabase → Settings → API.

---

## 6. Portabilidad — ruta de salida documentada

El código está diseñado para no depender de Supabase ni de Vercel de forma
irreversible. Si alguno cambia condiciones:

### Salir de Supabase
1. `pg_dump` de la base de producción
2. Levantar PostgreSQL en cualquier servidor (Docker, RDS, etc.)
3. Restaurar el dump
4. Crear la función `auth.uid()` equivalente (ver bloque al final de
   `docs/esquema-propuesto.sql`)
5. En `lib/db.ts` cambiar la URL de conexión
6. El resto del código no cambia

### Salir de Vercel
```bash
# Next.js con output: 'standalone' se despliega en cualquier servidor con Docker
docker build -t undreocol .
docker run -p 3000:3000 --env-file .env undreocol
```

No hay funciones ni APIs propietarias de Vercel en el código.

---

## 7. Migraciones de base de datos

Las migraciones viven en `supabase/migrations/` como SQL versionado por
timestamp. Son la **única fuente de verdad** del esquema.

**Regla:** ningún cambio de esquema se hace manualmente desde el panel de
Supabase. Si se hizo, se escribe la migración equivalente antes de cerrar la
tarea.

**Flujo:**

```bash
# Crear una migración nueva
supabase migration new nombre-descriptivo

# Aplicar en local
supabase db reset

# Aplicar en staging/producción
supabase db push --project-ref <ref>
```

**Nomenclatura:** `YYYYMMDDHHMMSS_descripcion-corta.sql`
Ejemplo: `20260901120000_fundacion-tenancy.sql`

---

## 8. Proceso de despliegue a producción

**Nunca se despliega directamente desde la rama `main` en caliente sin verificar.**

1. Correr todo en staging: `supabase db push` + `vercel --prod` apuntando a staging
2. Verificar la migración con `supabase db diff` antes de aplicar
3. Ejecutar el checklist de `docs/CHECKLIST-DESPLIEGUE.md` (pendiente de redactar)
4. Aplicar migración en producción: `supabase db push --project-ref <prod-ref>`
5. Desplegar frontend: merge a `main`, Vercel despliega automáticamente
6. Verificar que la app responde y que el login funciona
7. Actualizar `CHANGELOG.md`

---

## 9. Backups y recuperación

### Supabase Pro
- Backup automático diario incluido en el plan
- Retención de 7 días en el plan Pro
- Restauración desde el panel de Supabase o con `pg_restore`

### Backup manual (recomendado antes de migraciones grandes)
```bash
pg_dump \
  --no-acl --no-owner \
  "postgres://postgres:<password>@<host>:5432/postgres" \
  -Fc -f "backup-$(date +%Y%m%d-%H%M%S).dump"
```

### Verificación mensual obligatoria
**Un backup sin restaurar no es un backup, es una esperanza.**

Protocolo mensual:
1. Tomar el dump más reciente de producción
2. Restaurarlo en el proyecto de staging
3. Verificar que la app levanta y que los datos son coherentes
4. Registrar la verificación en `CHANGELOG.md`

---

## 10. Observabilidad

### Nivel mínimo viable (costo $0)
- **Sentry** (plan gratuito — 5.000 errores/mes) para errores no capturados en
  frontend y en Next.js
- **Logs de Vercel** para las invocaciones de Route Handlers
- **Logs de Supabase** para queries lentas y errores de base de datos

### Alertas obligatorias
Cuando se implemente el worker de notificaciones, alertar por email cuando:
- Un trabajo queda en estado `fallido`
- Un cierre de periodo termina con ítems en error
- La variación de facturación de un acueducto supera el 20% respecto al periodo
  anterior

---

## 11. Costos detallados por etapa

### Etapa 1 — Desarrollo (ahora)
| Servicio | Plan | Costo |
|---|---|---|
| Supabase | Free (CLI local) | $0 |
| Vercel | Hobby | $0 |
| Resend | — | $0 |
| **Total** | | **$0/mes** |

### Etapa 2 — Demo a prospectos
| Servicio | Plan | Costo |
|---|---|---|
| Supabase | Free (cloud, se pausa) | $0 |
| Vercel | Hobby (no comercial) | $0 |
| **Total** | | **$0/mes** |

### Etapa 3 — Primer cliente pagando
| Servicio | Plan | Costo |
|---|---|---|
| Supabase | Pro | ~USD $25/mes |
| Vercel | Pro | ~USD $20/mes |
| Resend | Free (hasta 3.000/mes) | $0 |
| **Total** | | **~USD $45/mes** |

Con un cliente de 1.000 suscriptores: ingreso $700.000 COP (~USD $175),
costo $45 USD (~$180.000 COP). Margen bruto ~74%.

---

## 12. Pendientes (requieren decisión de Mateo)

| Pendiente | Impacto |
|---|---|
| Dominio del producto | URL de la app y del portal del suscriptor |
| Proveedor de correo transaccional | Resend es la recomendación; confirmar |
| ~~Duración de la sesión del portal del suscriptor~~ | ✅ Resuelto — D-4: 30 días con renovación |
| ~~Si `codigo_suscriptor` es regenerable~~ | ✅ Resuelto — D-4: el admin lo regenera desde el panel |
| ~~Formato definitivo del número de factura~~ | ✅ Resuelto — D-3: FAC-YYYY-NNNNN, consecutivo anual |
| Umbrales por defecto reales | Días de vencimiento, mora, valor de reconexión |
| Tarifas reales de referencia (Soacha/EAAB) | Para armar los casos dorados |
