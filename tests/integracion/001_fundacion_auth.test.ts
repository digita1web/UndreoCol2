import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { iniciarSesion } from '@/lib/auth';

// Test de integración contra Supabase LOCAL (plan §6.3, tasks T-18).
// Requiere: supabase start + variables de entorno del proyecto local.
// Si no están disponibles, se reporta NO VERIFICADO (el suite se salta) y
// NUNCA se marca como aprobado (CLAUDE.md §4).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const idAdminA = 'a0000000-0000-0000-0000-0000000000a1';
const emailAdminA = 'admin-a@test.local';
const contrasena = 'clave-test-123';

describe.skipIf(!url || !anonKey || !serviceKey)(
  'Integración de iniciarSesion contra Supabase local',
  () => {
    let clienteAdmin: SupabaseClient;

    beforeAll(async () => {
      clienteAdmin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Asegura el usuario en auth.users con id fijo (coincide con el fixture).
      const { error } = await clienteAdmin.auth.admin.createUser({
        id: idAdminA,
        email: emailAdminA,
        password: contrasena,
        email_confirm: true,
      });
      // 22304 = user already exists (el fixture ya lo creó): es aceptable.
      if (error && error.code !== 'user_already_exists') {
        throw new Error(`No se pudo crear el usuario de prueba: ${error.message}`);
      }

      // Asegura el perfil asociado (id = auth.users.id).
      const { error: errorPerfil } = await clienteAdmin
        .from('perfiles')
        .upsert({ id: idAdminA, nombre: 'Admin A', email: emailAdminA });
      if (errorPerfil) {
        throw new Error(`No se pudo asegurar el perfil de prueba: ${errorPerfil.message}`);
      }
    });

    it('inicia sesión real y devuelve una sesión administrativa', async () => {
      const sesion = await iniciarSesion(emailAdminA, contrasena);
      expect(sesion.tipo).toBe('administrativa');
      expect(sesion.perfilId).toBe(idAdminA);
      expect(sesion.email).toBe(emailAdminA);
    });

    it('rechaza credenciales inválidas con un error explícito', async () => {
      await expect(iniciarSesion(emailAdminA, 'clave-incorrecta')).rejects.toThrow(
        /No se pudo iniciar sesión/
      );
    });
  }
);
