'use client';

import { useEffect, useState } from 'react';

/**
 * Detecta que el componente YA está hidratado en el cliente.
 *
 * Retorna `false` durante el render inicial (SSR y primer render del cliente,
 * antes del primer efecto) y `true` a partir del primer `useEffect`, es decir,
 * cuando React ya adjuntó sus listeners (`onSubmit`, `onChange`, etc.) al DOM.
 *
 * Previene el submit NATIVO de HTML durante la hidratación: si el usuario
 * envía el formulario antes de que React hidrate, el navegador ejecuta el
 * submit por defecto (GET con los campos como query string en la URL),
 * ignorando el `preventDefault()` del handler de React que aún no existe.
 * Deshabilitando el botón de submit hasta que `hidratado` sea `true` se
 * elimina esa ventana de carrera.
 *
 * Uso obligatorio en todo `<form onSubmit>` del proyecto (ver CLAUDE.md §7).
 */
export function useHidratado(): boolean {
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => {
    setHidratado(true);
  }, []);
  return hidratado;
}
