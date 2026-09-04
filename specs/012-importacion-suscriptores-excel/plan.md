# PLAN — 012: importacion-suscriptores-excel

**Spec aprobado:** 2026-09-04 (7 criterios de aceptación, ver `spec.md`)
**Estado:** PROPUESTO — pendiente de aprobación explícita de Mateo. No se escribe `tasks.md` hasta esa aprobación. Con autorización explícita de Mateo para esta tarea, se implementa ya el parser/validador puro (CA-1/CA-2) sin tocar Supabase real — el resto queda para después del checkpoint.

---

## 0. Punto de partida

Reutilizado sin tocar:
- `usuarios_servicio` completa (003): columnas y sus requeridos exactos
  (`codigo_suscriptor`, `nombre`, `numero_documento`, `direccion`, `categoria`), constraint único
  real `(cliente_id, codigo_suscriptor)`.
- `categoria_tarifaria` (002): `estrato_1`..`estrato_6`, `comercial`, `industrial`, `oficial`.
- Patrón de `core/` puro + `lib/` con Supabase (todo el proyecto, más cercano en estilo a
  `core/pagos.ts`/`lib/pagos.ts` de 007: cálculo puro separado de la capa que toca la base).
- Patrón de RLS estándar (lectura miembros del cliente, escritura `admin_acueducto`) para la tabla
  de historial nueva.

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `backend/src/core/importacion-suscriptores.ts` | crear | CA-1/CA-2: validación pura de filas + traducción de categoría |
| `backend/tests/unit/importacion-suscriptores.test.ts` | crear | Tests unitarios de CA-1/CA-2 |
| `supabase/migrations/20260910090000_importacion-suscriptores.sql` | crear (fase posterior al checkpoint) | Tabla `importaciones_suscriptores` (historial, CA-4), RLS |
| `backend/src/lib/importacion-suscriptores.ts` | crear (fase posterior) | CA-3: duplicados contra la base; inserción transaccional (CA-6); registro de historial |
| `backend/src/index.ts` | editar (fase posterior) | `POST /suscriptores/importar/validar`, `POST /suscriptores/importar/confirmar` |
| `frontend/lib/api.ts` | editar (fase posterior) | Funciones de importación |
| `frontend/app/app/suscriptores/importar/page.tsx` | crear (fase posterior) | Carga, mapeo, resumen, confirmación, reporte |
| `frontend/components/importacion-*.tsx` | crear (fase posterior) | Formulario de mapeo, tabla de resumen de errores |
| `CHANGELOG.md` | editar | Cierre de la feature |

**División explícita:** esta sesión implementa solo la primera fila (parser/validador puro, sin
Supabase). Las filas marcadas "fase posterior" quedan en `tasks.md` para cuando Mateo tenga el
bench (Docker/Supabase local) encendido — no se tocan en esta pasada.

## 2. Esquema de base de datos (fase posterior al checkpoint — documentado ahora, no aplicado)

### Migración

| Archivo | Contenido |
|---|---|
| `20260910090000_importacion-suscriptores.sql` | Tabla `importaciones_suscriptores` + RLS |

### Tabla

```sql
create table importaciones_suscriptores (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,
  nombre_archivo      text not null,
  filas_intentadas    integer not null,
  filas_importadas    integer not null,
  filas_con_error     integer not null,
  errores             jsonb not null default '[]'::jsonb, -- [{fila, motivo}], sin datos personales
  realizado_por       uuid references perfiles(id),
  created_at          timestamptz not null default now()
);

create index on importaciones_suscriptores (cliente_id, created_at desc);
```

`errores` guarda `{fila: number, motivo: string}` — el número de fila y por qué falló, nunca el
contenido de la fila (spec.md §3.6: evita acumular datos personales de filas que ni se importaron).

### Políticas RLS

Mismo patrón que el resto del proyecto:

```sql
create policy importaciones_suscriptores_lectura on importaciones_suscriptores for select
  using (es_admin_plataforma() or cliente_id in (select mis_clientes()));
create policy importaciones_suscriptores_escritura on importaciones_suscriptores for all
  using (es_admin_de(cliente_id)) with check (es_admin_de(cliente_id));
```

## 3. Rutas de la API (fase posterior al checkpoint)

| Método | Ruta | Auth | Propósito |
|---|---|---|---|
| POST | `/suscriptores/importar/validar` | sesión admin | Recibe filas + mapeo, corre CA-1/CA-2 (`core/`) + CA-3 (duplicados contra la base), devuelve el resumen sin escribir nada |
| POST | `/suscriptores/importar/confirmar` | sesión admin, `admin_acueducto` (RLS) | Recibe las filas ya validadas a importar, inserta transaccionalmente (RPC, CA-6), registra el historial, devuelve el reporte |

`POST /suscriptores/importar/confirmar` llama una función de base de datos nueva
(`importar_suscriptores(p_cliente_id, p_filas jsonb)`, a detallar en la migración cuando se
implemente esa fase) que hace el `INSERT` en lote dentro de una sola transacción PL/pgSQL — si una
fila falla (constraint no anticipado por la prevalidación), la excepción revierte todo el `INSERT`
(comportamiento nativo de una función `plpgsql`, no necesita `SELECT FOR UPDATE` porque no hay una
fila contendida como en `crear_tarifa_version()`/`reemplazar_contador()` — cada fila nueva es
independiente, el único invariante es "todo o nada" del lote).

## 4. Contratos de `core/` (implementado en esta sesión)

```ts
// backend/src/core/importacion-suscriptores.ts

export type CampoSuscriptor =
  | 'codigo_suscriptor' | 'nombre' | 'numero_documento' | 'direccion' | 'categoria'
  | 'tipo_documento' | 'telefono' | 'email' | 'sector' | 'notas';

// Mapeo elegido por el admin: nombre de columna del archivo → campo de usuarios_servicio.
// Las 5 claves requeridas deben estar presentes (se valida antes de llamar validarFilas).
export type MapeoColumnas = Partial<Record<CampoSuscriptor, string>>;

// Una fila cruda tal como la entregó el parser de .xlsx/.csv (ya resuelto antes de
// llegar aquí — este módulo no sabe nada de formatos de archivo).
export type FilaCruda = Record<string, string | number | null | undefined>;

export interface FilaNormalizada {
  codigo_suscriptor: string;
  nombre: string;
  numero_documento: string;
  direccion: string;
  categoria: string; // ya traducida a categoria_tarifaria válida
  tipo_documento?: string;
  telefono?: string;
  email?: string;
  sector?: string;
  notas?: string;
}

export interface ErrorFila {
  indiceFila: number; // 0-based sobre el array de filas crudas recibido
  motivo: string;
}

export interface ResultadoValidacion {
  validas: Array<{ indiceFila: number; fila: FilaNormalizada }>;
  errores: ErrorFila[];
}

// CA-1 + CA-2. Valida requeridos, traduce categoría (alias), y detecta duplicados de
// codigo_suscriptor/numero_documento DENTRO del array recibido (no contra la base —
// eso es CA-3, en lib/). No lanza: todo error queda en `errores`.
export function validarFilas(filas: FilaCruda[], mapeo: MapeoColumnas): ResultadoValidacion;

// Traduce un valor libre de categoría a categoria_tarifaria, o null si no se reconoce.
// Exportada aparte (no solo interna) para que CA-2 la teste de forma aislada.
export function traducirCategoria(valorLibre: string): string | null;
```

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| El parser de `.xlsx`/`.csv` en sí (biblioteca, dónde corre) se decide en la fase posterior al checkpoint, no ahora | Elegir la librería ya en este plan | La spec (§3) es agnóstica del formato de entrada: `core/importacion-suscriptores.ts` recibe filas ya parseadas (`FilaCruda[]`), así que la elección de librería no bloquea implementar y testear la validación pura hoy. Se decide cuando se construya la carga real de archivo, con la licencia (MIT/Apache-2.0/BSD/ISC, CLAUDE.md §2) verificada en ese momento |
| `traducirCategoria()` usa una tabla de alias fija en código (normalización: minúsculas, sin tildes, sin espacios extra) | Tabla de alias configurable por acueducto en la base de datos | Sin el Excel real del cliente, diseñar una tabla configurable en base de datos sería especular sobre una necesidad que no está confirmada (CLAUDE.md §7: "sin archivos de más"). Si tras ver el Excel real hace falta un alias que la tabla fija no cubre, se agrega ahí — es un cambio de una línea, no una razón para una tabla nueva |
| Duplicados dentro del archivo se detectan en `core/` (puro); duplicados contra la base en `lib/` (con Supabase) | Todo en una sola función | `core/` no puede tocar la base por regla (CLAUDE.md §5.3); separar las dos validaciones también permite testear con `vitest` la parte que no necesita datos reales, que es exactamente lo que esta sesión puede verificar hoy |
| La función de importación en lote (`importar_suscriptores()`) no usa `SELECT FOR UPDATE` | Replicar el patrón de `crear_tarifa_version()`/`reemplazar_contador()` | Esos patrones bloquean una fila existente que se va a cerrar/reemplazar; aquí cada suscriptor nuevo es una fila independiente sin contención — el único invariante es la atomicidad del `INSERT` en lote, que una función `plpgsql` ya garantiza (la excepción de cualquier fila revierte toda la función) |

## 6. Dependencias nuevas

Ninguna en esta sesión (el parser puro no necesita ninguna). La librería de parseo de
`.xlsx`/`.csv` se decide y se agrega en la fase posterior — pendiente, no una dependencia de esta
tarea.

## 7. Límites de Cloudflare Workers a considerar

`POST /suscriptores/importar/confirmar` procesa un lote de filas en una sola invocación de `fetch`.
Para el tamaño de un acueducto piloto (unos pocos cientos de suscriptores) el `INSERT` en lote es
trivial para Postgres y está muy por debajo de los 30s de CPU por defecto (CLAUDE.md §5.5). Se
define un límite explícito de filas por archivo en la fase posterior (a determinar, ej. 2000) —
un archivo que lo supere se rechaza con un mensaje claro antes de procesar nada, nunca un intento
silencioso de procesar un lote arbitrariamente grande.

## 8. Estrategia de pruebas

- **Unitarias (`core/`) — implementadas en esta sesión:** `backend/tests/unit/importacion-suscriptores.test.ts`
  con `vitest run`. Cubre (spec CA-1/CA-2): cada uno de los 5 campos requeridos vacío, categoría no
  reconocida, categoría con variantes de mayúsculas/espacios/con-sin-tilde que sí debe reconocer,
  duplicado de `codigo_suscriptor` dentro del archivo, duplicado de `numero_documento` dentro del
  archivo, archivo sin filas, fila válida completa (caso feliz).
- **Integración contra la base (CA-3, CA-6) — fase posterior:** requiere Postgres real (con o sin
  Docker según el entorno de turno, mismo mecanismo de shim que 002/003 si hace falta). NO
  VERIFICADO en esta sesión.
- **Aislamiento (CA-4) — fase posterior:** test de `importaciones_suscriptores` mismo mecanismo que
  el resto del proyecto. NO VERIFICADO en esta sesión.
- **Manual (CA-7, requiere Mateo con el bench encendido):** flujo completo en navegador con un
  archivo `.xlsx`/`.csv` de prueba real. NO VERIFICADO en esta sesión — ni siquiera hay frontend
  todavía, queda para la fase posterior.
