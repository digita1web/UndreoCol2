'use client';

import { useEffect, useState } from 'react';

// La hora tiene que ser la de quien LEE la página, no la del Worker que la
// sirvió (027, riesgo del plan) — se calcula en el cliente. El servidor
// siempre renderiza "Hola" (sin franja horaria) para no adivinar; se corrige
// apenas hidrata, sin parpadeo perceptible.
function calcularSaludo(): string {
  const hora = new Date().getHours();
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export function SaludoHora({ nombre }: { nombre: string }) {
  const [saludo, setSaludo] = useState('Hola');
  useEffect(() => setSaludo(calcularSaludo()), []);
  return (
    <>
      {saludo}, {nombre}
    </>
  );
}
