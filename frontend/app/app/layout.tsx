// Layout del área protegida /app/* (middleware.ts exige la cookie de sesión
// administrativa antes de llegar aquí).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
