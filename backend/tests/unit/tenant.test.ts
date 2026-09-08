// resolverClienteActivo (018, T-004) — con Supabase falso.
// Cubre el bug real de esta sesión: con solo la membresía 'administrador'
// (cliente_id NULL), antes del fix `activo` quedaba con clienteId: null en
// vez de esAdminPlataforma: true. Ver lib/tenant.ts para el detalle.

import { describe, expect, it } from 'vitest';
import { resolverClienteActivo } from '../../src/lib/tenant';

function supabaseFalso(filas: Array<{ cliente_id: string | null; rol: string; clientes: unknown }>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: filas, error: null }),
        }),
      }),
    }),
  } as never;
}

describe('resolverClienteActivo', () => {
  it('solo la membresía administrador (cliente_id NULL) -> lista vacía, activo null, esAdminPlataforma true', async () => {
    const supabase = supabaseFalso([{ cliente_id: null, rol: 'administrador', clientes: null }]);
    await expect(resolverClienteActivo(supabase, 'perfil-1')).resolves.toEqual({
      activo: null,
      lista: [],
      esAdminPlataforma: true,
    });
  });

  it('un acueducto -> activo resuelto, esAdminPlataforma false', async () => {
    const supabase = supabaseFalso([
      { cliente_id: 'cliente-1', rol: 'admin_acueducto', clientes: { nombre: 'Acueducto X' } },
    ]);
    await expect(resolverClienteActivo(supabase, 'perfil-1')).resolves.toEqual({
      activo: { clienteId: 'cliente-1', rol: 'admin_acueducto', nombre: 'Acueducto X' },
      lista: [{ clienteId: 'cliente-1', rol: 'admin_acueducto', nombre: 'Acueducto X' }],
      esAdminPlataforma: false,
    });
  });

  it('cero membresías -> lista vacía, activo null, esAdminPlataforma false', async () => {
    const supabase = supabaseFalso([]);
    await expect(resolverClienteActivo(supabase, 'perfil-1')).resolves.toEqual({
      activo: null,
      lista: [],
      esAdminPlataforma: false,
    });
  });

  it('varios acueductos -> activo null, lista completa, esAdminPlataforma false', async () => {
    const supabase = supabaseFalso([
      { cliente_id: 'cliente-1', rol: 'admin_acueducto', clientes: { nombre: 'A' } },
      { cliente_id: 'cliente-2', rol: 'lector', clientes: { nombre: 'B' } },
    ]);
    const r = await resolverClienteActivo(supabase, 'perfil-1');
    expect(r.activo).toBeNull();
    expect(r.lista).toHaveLength(2);
    expect(r.esAdminPlataforma).toBe(false);
  });

  it('superadmin que ADEMÁS es admin de un acueducto -> ese acueducto es el activo, esAdminPlataforma true', async () => {
    const supabase = supabaseFalso([
      { cliente_id: null, rol: 'administrador', clientes: null },
      { cliente_id: 'cliente-1', rol: 'admin_acueducto', clientes: { nombre: 'Acueducto X' } },
    ]);
    await expect(resolverClienteActivo(supabase, 'perfil-1')).resolves.toEqual({
      activo: { clienteId: 'cliente-1', rol: 'admin_acueducto', nombre: 'Acueducto X' },
      lista: [{ clienteId: 'cliente-1', rol: 'admin_acueducto', nombre: 'Acueducto X' }],
      esAdminPlataforma: true,
    });
  });

  it('error de Supabase -> lanza', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
          }),
        }),
      }),
    } as never;
    await expect(resolverClienteActivo(supabase, 'perfil-1')).rejects.toThrow(/connection refused/);
  });
});
