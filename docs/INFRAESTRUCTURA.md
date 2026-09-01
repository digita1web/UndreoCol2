# INFRAESTRUCTURA.md — UndreoCol

**Versión:** 3.0 — Arquitectura Cloudflare + Supabase, sin VPS
**Fecha:** 2026-08-31
**Estado:** Vigente. Reemplaza toda versión anterior de este documento.

---

## 1. Principio rector

> Cero infraestructura de pago hasta el primer cliente. El primer gasto es
> mínimo. Ningún componente de pago se activa sin un disparador medible.

Ver `ARQUITECTURA.md` §2 y §6 para la tabla completa de disparadores de costo.

---

## 2. Cuentas y servicios a crear

| Servicio | Para qué | Plan de inicio |
|---|---|---|
| Cloudflare | DNS, Pages, Workers, R2, Queues, Cron, Email Service | Free |
| Supabase | PostgreSQL, Auth, RLS | Free |
| GitHub | Repositorio, GitHub Actions (backup) | Free |
| Sentry | Observabilidad de errores | Free |
| UptimeRobot | Verificación de disponibilidad | Free |

Ninguno requiere tarjeta de crédito para el nivel gratuito, excepto Cloudflare al
activar Workers Paid (solo en el momento del primer cliente).

---

## 3. Entornos

### 3.1 Desarrollo local — costo $0

```bash
# Supabase local (PostgreSQL + Auth en Docker)
supabase start

# API en Workers, modo local
cd backend && npx wrangler dev

# Frontend Next.js
cd frontend && npm run dev
```

Todo el desarrollo ocurre sin tocar ningún servicio de pago. `wrangler dev` simula
el entorno de Workers localmente, incluyendo bindings de R2 y Queues.

### 3.2 Staging — costo $0

Un segundo proyecto de Cloudflare Pages + Workers, apuntando a un segundo proyecto
de Supabase Free. Sirve para:

- Probar el cierre de facturación antes de ejecutarlo en producción
- Verificar cada despliegue antes de promoverlo
- Restaurar y validar backups mensualmente (ver §7.3)

**Regla absoluta:** ningún cierre de prueba se ejecuta contra la base de producción.

### 3.3 Producción — costo desde $0, sube a $5 con el primer cliente

Mismo stack que staging, en el proyecto principal de Cloudflare y Supabase.

---

## 4. Estructura del repositorio

```
undreocol/
├── frontend/               → Next.js (admin + portal + PWA del lector)
│   └── (Cloudflare Pages)
├── backend/                → Hono.js
│   ├── src/
│   │   ├── index.ts        → Worker principal (API)
│   │   ├── cron/
│   │   │   ├── keepalive.ts    → Ping diario a Supabase
│   │   │   ├── monitor-db.ts   → Alerta de tamaño de base de datos
│   │   │   └── limpieza.ts     → Purga de tablas de sistema
│   │   ├── queues/
│   │   │   └── cierre-facturacion.ts
│   │   └── core/            → Lógica de negocio pura (ver CLAUDE.md §5.3)
│   └── wrangler.toml
├── supabase/
│   └── migrations/          → SQL versionado
└── .github/
    └── workflows/
        └── backup-diario.yml
```

---

## 5. Mantener Supabase Free vivo — Worker de keepalive

**Problema que resuelve:** los proyectos gratuitos de Supabase se pausan tras 7 días
sin actividad de base de datos.

**Solución:** un Cloudflare Cron Trigger que ejecuta una consulta real contra
Supabase todos los días. No es un truco — es tráfico legítimo de una aplicación
en uso, exactamente el tipo de actividad que el mecanismo de pausa está diseñado
para detectar.

### Tabla de soporte

```sql
create table if not exists _keepalive (
  id           smallint primary key default 1,
  ultimo_ping  timestamptz not null default now(),
  constraint chk_singleton check (id = 1)
);

insert into _keepalive (id, ultimo_ping) values (1, now())
  on conflict (id) do nothing;
```

### Worker (`backend/src/cron/keepalive.ts`)

```typescript
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/_keepalive?id=eq.1`,
      {
        method: "PATCH",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ ultimo_ping: new Date().toISOString() }),
      }
    );

    if (!response.ok) {
      // No se silencia: si el ping falla, hay que saberlo.
      throw new Error(
        `Keepalive falló: ${response.status} ${await response.text()}`
      );
    }
  },
};
```

### Configuración (`wrangler.toml`)

```toml
[triggers]
crons = ["0 9 * * *"]  # Todos los días a las 09:00 UTC (04:00 hora Colombia)
```

**Verificación de que funciona:** revisar en el panel de Supabase que
`ultimo_ping` se actualiza cada día, y que el proyecto nunca muestra el estado
"Paused".

---

## 6. Backup diario — GitHub Actions + Cloudflare R2

**Problema que resuelve:** Supabase Free no incluye backups automáticos.

**Solución:** un workflow de GitHub Actions que corre `pg_dump` todos los días y
sube el resultado, cifrado y comprimido, a un bucket de R2 propio.

### Workflow (`.github/workflows/backup-diario.yml`)

```yaml
name: backup-diario

on:
  schedule:
    - cron: "0 7 * * *"  # 07:00 UTC = 02:00 hora Colombia
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: backup-diario
  cancel-in-progress: false

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Instalar cliente de PostgreSQL
        run: sudo apt-get update && sudo apt-get install -y postgresql-client

      - name: Ejecutar pg_dump
        env:
          DATABASE_URL: ${{ secrets.SUPABASE_SESSION_POOLER_URL }}
        run: |
          FECHA=$(date +%Y%m%d-%H%M%S)
          pg_dump "$DATABASE_URL" --no-acl --no-owner -Fc \
            -f "backup-${FECHA}.dump"
          gzip "backup-${FECHA}.dump"
          echo "ARCHIVO=backup-${FECHA}.dump.gz" >> "$GITHUB_ENV"

      - name: Subir a Cloudflare R2
        uses: shallwefootball/s3-upload-action@master
        with:
          aws_key_id: ${{ secrets.R2_ACCESS_KEY_ID }}
          aws_secret_access_key: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          aws_bucket: ${{ secrets.R2_BUCKET_BACKUPS }}
          endpoint: ${{ secrets.R2_ENDPOINT }}
          source_dir: "."
          destination_dir: "backups/"

      - name: Purgar backups con más de 30 días
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        run: |
          aws s3 ls "s3://${{ secrets.R2_BUCKET_BACKUPS }}/backups/" \
            --endpoint-url "${{ secrets.R2_ENDPOINT }}" | \
          awk '{print $4}' | \
          while read -r archivo; do
            FECHA_ARCHIVO=$(echo "$archivo" | grep -oP '\d{8}' | head -1)
            FECHA_LIMITE=$(date -d '30 days ago' +%Y%m%d)
            if [[ "$FECHA_ARCHIVO" < "$FECHA_LIMITE" ]]; then
              aws s3 rm "s3://${{ secrets.R2_BUCKET_BACKUPS }}/backups/${archivo}" \
                --endpoint-url "${{ secrets.R2_ENDPOINT }}"
            fi
          done
```

### Secretos requeridos en GitHub

| Secreto | De dónde sale |
|---|---|
| `SUPABASE_SESSION_POOLER_URL` | Supabase → Settings → Database → Connection string (Session pooler, puerto 5432) |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → Manage API tokens |
| `R2_SECRET_ACCESS_KEY` | Igual que el anterior |
| `R2_BUCKET_BACKUPS` | Nombre del bucket, ej. `undreocol-backups` |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |

**Importante:** usar el **Session Pooler** de Supabase, no la conexión directa —
GitHub Actions no soporta IPv6 y la conexión directa de Supabase la requiere.

### Retención

30 días rotativos en R2. Costo: dentro del límite gratuito de 10 GB para bases de
datos de este tamaño.

### Consumo de cuotas gratuitas

| Recurso | Cuota gratuita | Uso de este backup |
|---|---|---|
| Minutos de GitHub Actions | 2.000/mes | ~90 min/mes (3 min × 30 días) |
| R2 — almacenamiento | 10 GB | Depende del tamaño de la base, holgado por años |
| R2 — escrituras | 1.000.000/mes | ~30/mes |

---

## 7. Restauración de backup — protocolo obligatorio

**Regla:** un backup sin restaurar no es un backup.

### 7.1 Restauración de emergencia

```bash
# Descargar el backup más reciente de R2
aws s3 cp "s3://undreocol-backups/backups/backup-<fecha>.dump.gz" . \
  --endpoint-url "$R2_ENDPOINT"

gunzip "backup-<fecha>.dump.gz"

# Restaurar en un proyecto de Supabase (staging o uno nuevo)
pg_restore --no-acl --no-owner -d "$DATABASE_URL_STAGING" "backup-<fecha>.dump"
```

### 7.2 Verificación tras restaurar

1. Contar filas de las tablas principales y comparar contra lo esperado
2. Confirmar que las políticas RLS siguen activas (`\d+ facturas` en `psql`
   debe mostrar "Row Security: enabled")
3. Levantar la aplicación de staging contra la base restaurada y hacer login

### 7.3 Ritual mensual

El primer lunes de cada mes:

1. Tomar el backup más reciente
2. Restaurarlo en staging
3. Ejecutar la verificación de §7.2
4. Registrar el resultado en `CHANGELOG.md`

Si la restauración falla, es una prioridad inmediata — no una tarea pendiente.

---

## 8. Monitoreo del tamaño de la base de datos

**Problema que resuelve:** saber con anticipación cuándo la base se acerca al
límite de 500 MB del plan Free, para decidir con tiempo si se sube a Supabase Pro.

### Worker (`backend/src/cron/monitor-db.ts`)

```typescript
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_ALERTA_EMAIL: string; // o el correo de destino de la alerta
}

const LIMITE_MB = 500;
const UMBRAL_INFORMATIVO_MB = 300;
const UMBRAL_ALERTA_MB = 400;
const UMBRAL_CRITICO_MB = 480;

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/tamano_base_mb`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    if (!resp.ok) {
      throw new Error(`No se pudo consultar el tamaño de la base: ${resp.status}`);
    }

    const tamanoMb: number = await resp.json();
    const porcentaje = ((tamanoMb / LIMITE_MB) * 100).toFixed(1);

    let nivel: "informativo" | "alerta" | "critico" | null = null;
    if (tamanoMb >= UMBRAL_CRITICO_MB) nivel = "critico";
    else if (tamanoMb >= UMBRAL_ALERTA_MB) nivel = "alerta";
    else if (tamanoMb >= UMBRAL_INFORMATIVO_MB) nivel = "informativo";

    if (nivel) {
      ctx.waitUntil(
        enviarAlerta(env, nivel, tamanoMb, porcentaje)
      );
    }
  },
};

async function enviarAlerta(
  env: Env,
  nivel: string,
  tamanoMb: number,
  porcentaje: string
): Promise<void> {
  const asunto =
    nivel === "critico"
      ? `🔴 CRÍTICO: base de datos al ${porcentaje}% (${tamanoMb} MB de 500 MB)`
      : nivel === "alerta"
      ? `🟠 Alerta: base de datos al ${porcentaje}%`
      : `ℹ️ Informativo: base de datos al ${porcentaje}%`;

  // Envío vía Cloudflare Email Service — ver docs/DECISIONES.md D-8
  // Implementación exacta en backend/src/lib/email.ts
}
```

### Función SQL de soporte

```sql
create or replace function tamano_base_mb()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2);
$$;
```

### Configuración

```toml
[triggers]
crons = ["0 12 * * *"]  # Todos los días a mediodía UTC
```

---

## 9. Limpieza automática de tablas de sistema

Reduce el crecimiento de tablas que no aportan valor histórico indefinido.

| Tabla | Regla de limpieza |
|---|---|
| Sesiones expiradas de auth | Purgar al expirar |
| `auditoria` | Archivar a R2 y purgar registros con más de 90 días |
| `trabajos` completados | Purgar con más de 30 días |
| `notificaciones` enviadas | Purgar con más de 60 días |

Implementado como Worker semanal (`backend/src/cron/limpieza.ts`), con cron
`0 5 * * 0` (domingos 5am UTC). El detalle de implementación se especifica en la
feature correspondiente del roadmap (`.specify/config.md`).

---

## 10. Variables de entorno

```bash
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=              # pública, protegida por RLS
SUPABASE_SERVICE_ROLE_KEY=      # SOLO en Workers/GitHub Actions, nunca en frontend

# Sesión del portal del suscriptor (D-2, D-4)
SESSION_SECRET=                 # mínimo 32 caracteres aleatorios

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_BACKUPS=
R2_BUCKET_ARCHIVOS=              # fotos, adjuntos de correo

# Alertas
ALERTA_EMAIL_DESTINO=            # correo de Mateo para monitor-db y uptime

# Backup (solo en GitHub Actions, no en Workers)
SUPABASE_SESSION_POOLER_URL=
```

### Reglas de seguridad

- `SUPABASE_SERVICE_ROLE_KEY` y `SESSION_SECRET` nunca llegan al navegador — son
  secretos de Worker, configurados con `wrangler secret put`.
- `SUPABASE_SESSION_POOLER_URL` vive únicamente en los secretos de GitHub Actions.
- Ningún valor real se commitea. `.env.example` documenta las claves sin valores.

---

## 11. Despliegue

```bash
# Backend (Workers)
cd backend
npx wrangler deploy

# Frontend (Pages) — automático al hacer push a main,
# vía integración GitHub de Cloudflare Pages
```

### Migraciones de base de datos

```bash
supabase db push --project-ref <ref-produccion>
```

**Regla:** ningún cambio de esquema se hace manualmente desde el panel de
Supabase. Toda migración vive en `supabase/migrations/` y se aplica con el CLI.

---

## 12. Ruta de salida — portabilidad

Si en el futuro Cloudflare o Supabase cambian condiciones de forma desfavorable:

- **Salir de Supabase:** es PostgreSQL estándar. `pg_dump` / `pg_restore` a
  cualquier proveedor (Neon, RDS, un VPS propio). El único trabajo adicional es
  reemplazar Supabase Auth por otra solución para la sesión administrativa — la
  sesión del suscriptor (D-2) ya es independiente y no requiere cambios.
- **Salir de Cloudflare Workers:** Hono.js corre en cualquier runtime compatible
  con Fetch API (Node, Deno, Bun) con cambios mínimos de adaptador.
- **Salir de Cloudflare Pages:** Next.js se despliega en cualquier plataforma
  compatible (Vercel, un VPS con Docker) sin cambios de código.

Ningún componente crítico del negocio (esquema SQL, lógica de `core/`, políticas
RLS) depende de una API propietaria irremplazable.
