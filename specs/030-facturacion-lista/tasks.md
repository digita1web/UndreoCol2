# TASKS — 030: facturacion-lista

**Plan aprobado:** 2026-09-12

Una tarea = un commit. Sin evidencia no hay commit.

**Cómo usar este archivo con Luna (ChatGPT):** T-001 está armada para pegarse completa, tal cual,
en una conversación nueva con Luna (después del prompt base de reglas de UndreoCol) — trae la
tarea, el archivo actual completo, los tipos y funciones que ya existen, y los criterios de
aceptación. No hace falta agregar nada más ni explicárselo de nuevo. T-002 la hago yo (Claude) o la
hacés vos directo — es cierre de documentación, no redacción de código, así que no es tarea para
Luna.

---

## T-001 — Re-vestido completo de `/app/facturacion` (PARA LUNA)

### Objetivo

Reescribir `frontend/app/app/facturacion/page.tsx` con el sistema visual de 026: encabezado
(`page-head`) con selector de periodo + Simular/Confirmar reubicados, resumen de urgencia del
periodo, filtros de búsqueda/estado (100% cliente), tabla con `Badge` de color por estado, y un
estado "No autorizado" explícito para el rol `lector`. Ni una sola llamada nueva a la API: se
reordena y se le agrega presentación a los mismos datos que ya trae hoy.

### Archivo a modificar (completo, tal cual está hoy)

`frontend/app/app/facturacion/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  emitirPeriodo,
  enviarCorreoPeriodo,
  listarFacturasDePeriodo,
  listarPeriodos,
  obtenerContextoUsuario,
  simularPeriodo,
  type Factura,
  type Periodo,
  type ResumenSimulacion,
} from '@/lib/api';

export default function FacturacionPage() {
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [periodoId, setPeriodoId] = useState('');
  const [facturas, setFacturas] = useState<Factura[] | null>(null);
  const [resumen, setResumen] = useState<ResumenSimulacion | null>(null);
  const [simulado, setSimulado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [rol, setRol] = useState<string | null>(null);

  useEffect(() => {
    listarPeriodos().then((r) => setPeriodos(r.periodos)).catch(() => setPeriodos([]));
    obtenerContextoUsuario()
      .then((r) => setRol(r.cliente.rol))
      .catch(() => setRol('admin_acueducto'));
  }, []);

  async function cargarFacturas(pid: string) {
    try {
      const r = await listarFacturasDePeriodo(pid);
      setFacturas(r.facturas);
    } catch {
      setFacturas([]);
    }
  }

  async function alSeleccionarPeriodo(pid: string) {
    setPeriodoId(pid);
    setResumen(null);
    setSimulado(false);
    setError(null);
    setInfo(null);
    if (pid) await cargarFacturas(pid);
    else setFacturas(null);
  }

  async function alSimular() {
    if (!periodoId) return;
    setError(null);
    setInfo(null);
    setTrabajando(true);
    try {
      const r = await simularPeriodo(periodoId);
      setResumen(r.resumen);
      setSimulado(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo simular el periodo');
    } finally {
      setTrabajando(false);
    }
  }

  async function alEmitir() {
    if (!periodoId || !simulado) return;
    if (!window.confirm('¿Confirmar la emisión de las facturas del periodo? Revisa el resumen de la simulación antes.')) return;
    setError(null);
    setInfo(null);
    setTrabajando(true);
    try {
      const r = await emitirPeriodo(periodoId);
      setInfo(`${r.mensaje} · encoladas ${r.encoladas}, omitidas ${r.omitidas}`);
      setSimulado(false);
      await cargarFacturas(periodoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo emitir el periodo');
    } finally {
      setTrabajando(false);
    }
  }

  async function alEnviarCorreosPeriodo() {
    if (!periodoId || !facturas?.length) return;
    if (!window.confirm('¿Enviar el correo con el PDF a los suscriptores de las facturas del periodo que tengan email? (sin email se entregan impresas)')) return;
    setError(null);
    setInfo(null);
    setTrabajando(true);
    try {
      const r = await enviarCorreoPeriodo(periodoId);
      setInfo(`${r.mensaje} · encolados ${r.encoladas}, omitidos ${r.omitidas}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo encolar el lote de correos');
    } finally {
      setTrabajando(false);
    }
  }

  const nombresAnomalia: Record<string, string> = {
    consumo_atipico: 'Consumo atípico',
    usuario_sin_lectura: 'Sin lectura',
    sin_tarifa: 'Sin tarifa (no se emite, 9d)',
    total_cero_o_negativo: 'Total cero/negativo',
    variacion_superior_20: 'Variación > 20% vs periodo anterior',
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Facturación</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {info && <p className="text-sm text-green-700">{info}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Cierre del periodo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <select
            className="h-9 w-fit rounded-md border border-border bg-background px-3 text-sm"
            value={periodoId}
            onChange={(e) => alSeleccionarPeriodo(e.target.value)}
          >
            <option value="">Selecciona un periodo…</option>
            {(periodos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} ({p.estado})
              </option>
            ))}
          </select>
          {rol === 'admin_acueducto' && (
            <div className="flex gap-3">
              <button
                className="h-9 w-fit rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={alSimular}
                disabled={!periodoId || trabajando}
              >
                {trabajando ? 'Procesando…' : 'Simular periodo'}
              </button>
              {simulado && (
                <button
                  className="h-9 w-fit rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
                  onClick={alEmitir}
                  disabled={trabajando}
                >
                  Confirmar emisión
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {resumen && (
        <Card>
          <CardHeader>
            <CardTitle>Resumen de la simulación</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              Suscriptores: <strong>{resumen.totalSuscriptores}</strong> · con factura:{' '}
              <strong>{resumen.suscriptoresConFactura}</strong> · consumo total:{' '}
              <strong>{resumen.consumoTotalM3} m³</strong> · facturación total:{' '}
              <strong>${resumen.facturacionTotal.toLocaleString('es-CO')}</strong>
            </p>
            {resumen.anomalias.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3">
                {resumen.anomalias.map((a, i) => (
                  <li key={i}>
                    {nombresAnomalia[a.tipo] ?? a.tipo} — {a.detalle}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-green-700">Sin anomalías.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Facturas del periodo</CardTitle>
            {facturas && facturas.length > 0 && (
              <button
                className="h-9 w-fit rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50 print:hidden"
                onClick={alEnviarCorreosPeriodo}
                disabled={trabajando}
              >
                {trabajando ? 'Encolando…' : 'Enviar correos del periodo'}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {facturas === null && <p className="text-sm text-muted-foreground">Selecciona un periodo…</p>}
          {facturas?.length === 0 && <p className="text-sm text-muted-foreground">Sin facturas emitidas para este periodo.</p>}
          {facturas?.map((f) => (
            <div key={f.id} className="border-b border-border py-2 last:border-0">
              <Link href={`/app/facturacion/${f.id}`} className="font-medium hover:underline">
                {f.numero}
              </Link>
              <p className="text-xs text-muted-foreground">
                {(f.snapshot_suscriptor.nombre as string) ?? '—'} · $
                {f.total.toLocaleString('es-CO')} · {f.estado}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
```

### Tipos y funciones ya existentes que vas a usar (no inventar otros)

De `@/lib/api`:

```ts
export type EstadoFactura = 'pendiente' | 'pagada' | 'vencida' | 'anulada';

export interface Factura {
  id: string;
  cliente_id: string;
  usuario_servicio_id: string;
  periodo_id: string | null;
  tipo: TipoFactura;
  numero: string;
  snapshot_suscriptor: Record<string, unknown>; // { nombre, direccion, categoria, codigo_suscriptor, estado }
  consumo_m3: number;
  subtotal_servicios: number;
  recargo_mora: number;
  saldo_anterior: number;
  total: number;
  total_pagado: number;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: EstadoFactura;
  motivo_anulacion: string | null;
  anulada_por: string | null;
}

export interface Periodo {
  id: string;
  cliente_id: string;
  nombre: string;
  anio: number;
  mes: number;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_vencimiento: string;
  estado: 'abierto' | 'cerrado';
  fecha_cierre: string | null;
  cerrado_por: string | null;
}

export interface ResumenSimulacion {
  periodoId: string;
  totalSuscriptores: number;
  suscriptoresConFactura: number;
  consumoTotalM3: number;
  facturacionTotal: number;
  anomalias: AnomaliaFacturacion[]; // { tipo: string; detalle: string }
  detalle: SuscriptorSimulado[];
}

export interface ContextoUsuario {
  cliente: { clienteId: string; rol: string; nombre: string };
  perfil: { id: string; email: string; nombre: string };
  conteoUsuariosServicio: number;
}

function listarPeriodos(): Promise<{ periodos: Periodo[] }>;
function simularPeriodo(periodoId: string): Promise<{ resumen: ResumenSimulacion }>;
function emitirPeriodo(periodoId: string): Promise<{ encoladas: number; omitidas: number; mensaje: string }>;
function listarFacturasDePeriodo(periodoId: string): Promise<{ facturas: Factura[] }>;
function enviarCorreoPeriodo(periodoId: string): Promise<{ encoladas: number; omitidas: number; mensaje: string }>;
function obtenerContextoUsuario(): Promise<ContextoUsuario>;
```

`categoria_tarifaria` (valor real de `snapshot_suscriptor.categoria`, un string):
`'estrato_1' | 'estrato_2' | 'estrato_3' | 'estrato_4' | 'estrato_5' | 'estrato_6' | 'comercial' |
'industrial' | 'oficial'`.

### Componente `Badge` ya existente (no crear uno nuevo)

`frontend/components/ui/badge.tsx`:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

const VARIANTES = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  gray: 'bg-muted text-muted-foreground',
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variante: keyof typeof VARIANTES;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variante, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold',
        VARIANTES[variante],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = 'Badge';

export { Badge };
```

Import: `import { Badge } from '@/components/ui/badge';`. Uso: `<Badge variante="danger">Vencida</Badge>`.

### Patrón "No autorizado" ya existente (reutilizar el mismo tono, mismo markup)

De `frontend/app/app/dashboard/page.tsx` (Panel principal, 027) — así se ve hoy cuando un rol sin
permiso llega a una pantalla que no le corresponde:

```tsx
<div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-8 text-center">
  <p className="text-lg font-semibold">No autorizado</p>
  <p className="text-sm text-muted-foreground">
    Los indicadores del acueducto son visibles solo para el administrador del acueducto.
  </p>
  <Link href="/app/lecturas" className="text-sm text-accent hover:underline">
    Ir a lecturas →
  </Link>
</div>
```

Para esta pantalla, mismo markup, cambiando el segundo párrafo a algo como "Las facturas del
acueducto son visibles solo para quien administra la facturación." — el texto exacto es tu
criterio de redacción, no hace falta que sea idéntico.

### Qué construir (plan.md §1 y §5)

1. **Encabezado (`page-head`)**: reemplaza el `<h1>Facturación</h1>` suelto por un bloque con
   eyebrow "Facturación", `<h1>Facturas</h1>`, subtítulo con el periodo seleccionado (nombre +
   estado), y ahí mismo el selector de periodo + los botones "Simular periodo"/"Confirmar emisión"
   que ya existen (visibles solo si `rol === 'admin_acueducto'`, igual que hoy — no cambiar esa
   condición).
2. **Resumen de urgencia** (spec §3.5b, nuevo): si `facturas` tiene al menos una con
   `estado === 'vencida'`, mostrar una franja/tarjeta corta con `Badge variante="danger"`: cantidad
   de facturas vencidas y la suma de `(total - total_pagado)` de esas facturas (el saldo real, no
   `total`), formateada con `.toLocaleString('es-CO')` y prefijo `$`. Si no hay ninguna vencida, no
   se muestra nada (ni una versión en $0).
3. **Filtros** (spec §3.3, nuevo): un `<input>` de búsqueda (no dentro de un `<form>` — es un
   filtro en vivo, no un submit, así que no aplica la regla de `useHidratado()` de CLAUDE.md §7) que
   filtra por `numero` o por `snapshot_suscriptor.nombre` (case-insensitive, `includes`), y un
   `<select>` con las 4 opciones reales de `EstadoFactura` ("Todos los estados" + Pendiente / Pagada
   / Vencida / Anulada) que filtra por `estado` exacto. Ambos filtran el array `facturas` ya
   cargado en el cliente — ninguna llamada nueva.
4. **Tabla con `Badge`** (spec §3.4): reemplaza la lista de `<div>` actual por filas con: nombre
   del suscriptor + código + categoría (ej. "A-001 · Estrato 3", armado desde
   `snapshot_suscriptor.codigo_suscriptor` y `.categoria` — si `categoria` no empieza con
   `estrato_`, no forzar la palabra "Estrato", mostrar el valor tal cual con un formato razonable),
   número de factura, total (`$` + `toLocaleString('es-CO')`), `Badge` de estado, y un botón "Ver"
   que enlaza a `/app/facturacion/{f.id}` (la ruta ya existe, no se toca). Mapeo estado→Badge:
   `pendiente`→`warning` ("Pendiente"), `pagada`→`success` ("Pagada"), `vencida`→`danger`
   ("Vencida"), `anulada`→`gray` ("Anulada"). Sugerencia de plan.md: armar esto como una constante
   `Record<EstadoFactura, { variante: BadgeProps['variante']; etiqueta: string }>` en el mismo
   archivo, para no repetir un `switch` en cada uso.
5. **Estado "No autorizado" para `lector`**: si `rol === 'lector'`, no llamar a
   `listarPeriodos()`/`listarFacturasDePeriodo()` en absoluto (o si ya se llamaron, no renderizar
   sus resultados) — mostrar el bloque "No autorizado" de arriba en su lugar. El resto de la
   pantalla (selector, tabla, filtros) no se renderiza para este rol.
6. **Todo lo demás se mantiene igual**: "Resumen de la simulación" (anomalías incluidas) y "Enviar
   correos del periodo" siguen existiendo, solo re-vestidos con las tarjetas/tokens que ya usa el
   resto del panel (no hace falta que inventes tokens nuevos — usá los mismos `Card`/`Badge`/clases
   `text-muted-foreground` etc. que ya se ven en este mismo archivo).

### Qué NO hacer

- No cambiar ninguna ruta de `@/lib/api` ni agregar una llamada nueva.
- No crear un componente nuevo para la tabla o los filtros (viven en este mismo archivo — plan.md
  §1, sin un segundo consumidor no se justifica extraerlos).
- No tocar `/app/facturacion/[facturaId]` (el detalle) — es otro spec.
- No agregar paginación, exportar a CSV ni ningún botón que no tenga una acción real detrás.

### Criterios de aceptación (spec.md §6, verificación real pendiente de Claude/Mateo — no tuya)

- CA-1: cada fila de la tabla coincide con lo que devuelve `GET /facturacion/periodos/:id/facturas`.
- CA-2: el `Badge` usa el color y la etiqueta correctos para los 4 estados.
- CA-3: buscar/filtrar no dispara ninguna petición de red nueva.
- CA-4: Simular → Confirmar emisión sigue funcionando igual que hoy, solo reubicado.
- CA-5: `lector` ve "No autorizado" explícito, nunca la tabla ni el selector.
- CA-6: el botón "Ver" de cada fila enlaza al `id` correcto.
- CA-7: el resumen de urgencia muestra el saldo (`total - total_pagado`), no el total bruto, y no
  aparece si no hay ninguna factura vencida.

### Formato de entrega esperado de Luna

El archivo completo `frontend/app/app/facturacion/page.tsx` listo para pegar, reemplazando el
actual entero — no un diff ni fragmentos sueltos. Al final, la sección "Asunciones sin verificar"
de tu prompt base.

---

## T-002 — Cierre: verificación real, CHANGELOG y PLAN-PRODUCCION.md (NO es para Luna)

**Quién la hace:** Claude, cuando Mateo pase el resultado de Luna aplicado al repo.

**Archivos:** `CHANGELOG.md`, `docs/PLAN-PRODUCCION.md` (contador de pantallas re-vestidas del
rediseño, hoy "2 de 15").

**Verificación real, no supuesta:**
```
cd frontend && npm run build && npm run lint
```
Más inspección manual contra `next dev` real con sesión de `admin_acueducto` y de `lector` (CA-5,
la única que no se puede confirmar solo con build/lint).

**Estado:** COMPLETADO — auditoría real encontró 1 bloqueante (build fallaba, typo
`encolados`/`encoladas`) y 2 menores (eyebrow no coincidía con el patrón visual de 027; clase
`page-head` muerta, copiada del prototipo). Corregidas por Claude directo, con autorización de
Mateo. `npm run build` y `npm run lint` verificados en verde después de las correcciones.
Verificación visual en navegador real (CA-5 incluido) queda pendiente de Mateo.
