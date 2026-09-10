import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BotonSalir } from '@/components/boton-salir';

// El autoservicio de alta de acueductos se cerró (M-5, docs/PLAN-PRODUCCION.md,
// decisión de Mateo Sesión 041): crear_tenant_con_admin() ya no está otorgada a
// `authenticated`. GET /dashboard sigue redirigiendo aquí a cualquier cuenta sin
// membresía activa (frontend/app/app/dashboard/page.tsx) — hoy solo llega por un
// borde real: un alta desde /plataforma/acueductos (018) que falló a mitad de
// camino (auth.users creado, membresía sin vincular todavía). Esta pantalla ya
// no ofrece un formulario de autoservicio; solo explica el estado y deja salir.
export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sin acueducto asignado</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Tu cuenta todavía no tiene ningún acueducto asignado. Contacta al administrador de la
            plataforma para que complete el alta.
          </p>
          <BotonSalir />
        </CardContent>
      </Card>
    </main>
  );
}
