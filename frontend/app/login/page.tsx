import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático de public/ */}
      <img src="/logo/wordmark.svg" alt="UndreoCol" className="h-auto w-64" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Ingresar</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
