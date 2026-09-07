// Defensa multi-tenant del consumidor de la cola — hallazgo M-1 de la auditoría
// pre-producción (docs/PLAN-PRODUCCION.md).
//
// El consumidor corre con service_role, que SALTA RLS: el `cliente_id` del
// mensaje es la única frontera que queda entre acueductos. Estas pruebas
// sustituyen el cliente de Supabase por uno falso que aplica de verdad los
// filtros `.eq(...)` sobre filas en memoria, y comprueban que un mensaje que
// apunte a datos de OTRO acueducto no encuentra nada.
//
// No es un test de la base: es un test de que el consumidor PIDE los datos
// acotados por cliente_id. Que RLS funcione ya está cubierto por las suites de
// tests/aislamiento/.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const A = 'a0000000-0000-0000-0000-000000000001';
const B = 'b0000000-0000-0000-0000-000000000002';

// Filas en memoria: todo pertenece al acueducto A.
type Fila = Record<string, unknown>;
// Tipado nominal (no Record<string, …>) para que `tablas.periodos` no sea
// `Fila[] | undefined` bajo TypeScript estricto (CLAUDE.md §7: sin `any`, sin `!`).
interface Tablas {
  periodos: Fila[]; usuarios_servicio: Fila[]; configuracion: Fila[]; facturas: Fila[];
  factura_detalles: Fila[]; clientes: Fila[]; notificaciones: Fila[]; contadores: Fila[];
}
const tablas: Tablas = {
  periodos: [{ id: 'per-a', cliente_id: A, nombre: 'Enero', fecha_fin: '2026-01-31' }],
  usuarios_servicio: [{ id: 'sus-a', cliente_id: A, nombre: 'Ana', codigo_suscriptor: 'A-001', direccion: 'Calle 1', categoria: 'estrato_3', estado: 'activo', email: 'ana@test.local' }],
  configuracion: [{ cliente_id: A, prefijo_factura: 'FAC', dias_vencimiento: 30, porcentaje_mora: 2 }],
  facturas: [{ id: 'fac-a', cliente_id: A, usuario_servicio_id: 'sus-a', numero: 'FAC-2026-00001', total: 1000, total_pagado: 0 }],
  factura_detalles: [{ id: 'det-a', cliente_id: A, factura_id: 'fac-a', orden: 1 }],
  clientes: [{ id: A, nombre: 'Acueducto A', nit: null, direccion: null, telefono: null, municipio: null, logo_url: null }],
  notificaciones: [{ id: 'not-a', cliente_id: A, intentos: 0 }],
  contadores: [{ id: 'con-a', cliente_id: A, usuario_servicio_id: 'sus-a', estado: 'activo' }],
};

// Constructor de consultas mínimo pero HONESTO: `.eq()` filtra de verdad.
function constructor(tabla: string) {
  let filas: Fila[] = [...(tablas[tabla as keyof Tablas] ?? [])];
  const api = {
    select: () => api,
    update: () => api,
    insert: () => api,
    order: () => api,
    eq: (columna: string, valor: unknown) => {
      filas = filas.filter((f) => f[columna] === valor);
      return api;
    },
    single: () => Promise.resolve(filas.length === 1 ? { data: filas[0], error: null } : { data: null, error: { message: 'no rows' } }),
    maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
    then: (resolver: (v: { data: unknown; error: null }) => unknown) => resolver({ data: filas, error: null }),
  };
  return api;
}

const supabaseFalso = { from: (t: string) => constructor(t), rpc: () => Promise.resolve({ data: null, error: { message: 'rpc no usada en esta prueba' } }) };

vi.mock('../../src/lib/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  crearClienteServicio: () => supabaseFalso,
}));

const { emitirFacturaDeMensaje, enviarCorreoDeFactura } = await import('../../src/queues/cierre-facturacion');

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  ALLOWED_ORIGIN: 'http://localhost:3000',
  SESSION_SECRET: 'secreto',
} as never;

describe('cola de facturación — el cliente_id del mensaje acota las consultas (M-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emitir_factura: un periodo de OTRO acueducto no se encuentra', async () => {
    await expect(
      emitirFacturaDeMensaje(env, { tipo: 'emitir_factura', clienteId: B, periodoId: 'per-a', usuarioServicioId: 'sus-a' }),
    ).rejects.toThrow(/Periodo per-a no existe/);
  });

  it('emitir_factura: con el cliente_id correcto el periodo SÍ se encuentra (falla más adelante, no en el periodo)', async () => {
    await expect(
      emitirFacturaDeMensaje(env, { tipo: 'emitir_factura', clienteId: A, periodoId: 'per-a', usuarioServicioId: 'sus-a' }),
    ).rejects.not.toThrow(/Periodo per-a no existe/);
  });

  it('emitir_factura: un suscriptor de OTRO acueducto no se encuentra', async () => {
    // periodo de B inexistente evitaría llegar al suscriptor, así que se siembra el par cruzado:
    tablas.periodos.push({ id: 'per-b', cliente_id: B, nombre: 'Enero B', fecha_fin: '2026-01-31' });
    tablas.configuracion.push({ cliente_id: B, prefijo_factura: 'FAC', dias_vencimiento: 30, porcentaje_mora: 2 });
    await expect(
      emitirFacturaDeMensaje(env, { tipo: 'emitir_factura', clienteId: B, periodoId: 'per-b', usuarioServicioId: 'sus-a' }),
    ).rejects.toThrow(/Suscriptor sus-a no existe/);
    tablas.periodos.pop();
    tablas.configuracion.pop();
  });

  it('enviar_correo_factura: una factura de OTRO acueducto no se encuentra', async () => {
    await expect(
      enviarCorreoDeFactura(env, { tipo: 'enviar_correo_factura', clienteId: B, facturaId: 'fac-a' }),
    ).rejects.toThrow(/Factura fac-a no existe/);
  });

  it('mensaje sin clienteId: se rechaza explícitamente, no se procesa a medias', async () => {
    await expect(
      emitirFacturaDeMensaje(env, { tipo: 'emitir_factura', clienteId: '', periodoId: 'per-a', usuarioServicioId: 'sus-a' }),
    ).rejects.toThrow(/falta.*clienteId|faltan clienteId/i);
    await expect(
      enviarCorreoDeFactura(env, { tipo: 'enviar_correo_factura', clienteId: '', facturaId: 'fac-a' }),
    ).rejects.toThrow(/falta clienteId/i);
  });
});
