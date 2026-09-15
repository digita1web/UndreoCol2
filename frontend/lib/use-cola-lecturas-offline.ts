'use client';

import { useCallback, useEffect, useState } from 'react';
import { crearLectura, ErrorPeticion, type DatosCrearLectura } from '@/lib/api';

const NOMBRE_DB = 'undreocol-lecturas-offline';
const NOMBRE_TABLA = 'cola';
const VERSION_DB = 1;

export interface LecturaEnCola extends DatosCrearLectura {
  id_cliente_offline: string;
  guardadaEn: string;
  estado: 'pendiente' | 'rechazada';
  errorRechazo?: string;
}

function abrirBaseCola(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const apertura = indexedDB.open(NOMBRE_DB, VERSION_DB);
    apertura.onupgradeneeded = () => {
      apertura.result.createObjectStore(NOMBRE_TABLA, { keyPath: 'id_cliente_offline' });
    };
    apertura.onsuccess = () => resolve(apertura.result);
    apertura.onerror = () => reject(apertura.error ?? new Error('No se pudo abrir la cola local de lecturas'));
  });
}

function promisificar<T>(peticion: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error ?? new Error('Error en la cola local de lecturas'));
  });
}

async function agregarACola(entrada: LecturaEnCola): Promise<void> {
  const db = await abrirBaseCola();
  const tabla = db.transaction(NOMBRE_TABLA, 'readwrite').objectStore(NOMBRE_TABLA);
  await promisificar(tabla.add(entrada));
  db.close();
}

// 038: orden FIFO resuelto en JS (getAll() no garantiza orden cronológico con
// keyPath = id_cliente_offline, un UUID) — sin índice nuevo, la cola esperada
// es de pocas lecturas por corte de señal (plan.md §2).
async function listarCola(): Promise<LecturaEnCola[]> {
  const db = await abrirBaseCola();
  const tabla = db.transaction(NOMBRE_TABLA, 'readonly').objectStore(NOMBRE_TABLA);
  const items = await promisificar(tabla.getAll() as IDBRequest<LecturaEnCola[]>);
  db.close();
  return items.slice().sort((a, b) => a.guardadaEn.localeCompare(b.guardadaEn));
}

async function actualizarEnCola(entrada: LecturaEnCola): Promise<void> {
  const db = await abrirBaseCola();
  const tabla = db.transaction(NOMBRE_TABLA, 'readwrite').objectStore(NOMBRE_TABLA);
  await promisificar(tabla.put(entrada));
  db.close();
}

async function quitarDeCola(id: string): Promise<void> {
  const db = await abrirBaseCola();
  const tabla = db.transaction(NOMBRE_TABLA, 'readwrite').objectStore(NOMBRE_TABLA);
  await promisificar(tabla.delete(id));
  db.close();
}

interface ResultadoColaOffline {
  rechazadas: LecturaEnCola[];
  sinSubirCount: number;
  encolar: (datos: DatosCrearLectura) => Promise<void>;
  descartar: (idClienteOffline: string) => Promise<void>;
}

// 038: instanciado una sola vez en VistaLector (app/app/lecturas/page.tsx),
// no dentro de NuevaLecturaLector — ese componente se desmonta al cambiar de
// pestaña, y la cola tiene que seguir drenando aunque el fontanero esté
// viendo "Historial" cuando vuelve la señal (plan.md §5).
export function useColaLecturasOffline(alSincronizarUna: () => void): ResultadoColaOffline {
  const [items, setItems] = useState<LecturaEnCola[]>([]);

  const refrescar = useCallback(async () => {
    setItems(await listarCola());
  }, []);

  const sincronizar = useCallback(async () => {
    const cola = await listarCola();
    for (const item of cola.filter((i) => i.estado === 'pendiente')) {
      try {
        await crearLectura(item);
        await quitarDeCola(item.id_cliente_offline);
        alSincronizarUna();
      } catch (e) {
        if (e instanceof ErrorPeticion) {
          // Rechazo real del backend (duplicado, fuera de orden, periodo
          // cerrado...) — sale del reintento automático, no bloquea a las
          // demás lecturas de la cola (CA-5).
          await actualizarEnCola({ ...item, estado: 'rechazada', errorRechazo: e.message });
        } else {
          // Falla de red real: se sabe que no hay señal, seguir intentando
          // las demás solo generaría más fetches fallidos. Se reintenta
          // completo en el próximo evento `online` o el próximo montaje.
          console.error('cola-lecturas-offline: se detiene el drenado por falla de red', e);
          break;
        }
      }
    }
    await refrescar();
  }, [alSincronizarUna, refrescar]);

  // Dependencia real (no `[]`): `sincronizar` cambia de identidad cuando
  // cambia `alSincronizarUna` (en VistaLector, cuando `periodoAbierto` pasa
  // de null a un periodo real tras la carga inicial) — con `[]` el listener
  // de `online` quedaría con un closure viejo para siempre. Reinscribirlo es
  // barato y `sincronizar()` es idempotente si se llama de más.
  useEffect(() => {
    refrescar();
    sincronizar();
    window.addEventListener('online', sincronizar);
    return () => window.removeEventListener('online', sincronizar);
  }, [sincronizar, refrescar]);

  const encolar = useCallback(
    async (datos: DatosCrearLectura) => {
      const entrada: LecturaEnCola = {
        ...datos,
        id_cliente_offline: datos.id_cliente_offline ?? crypto.randomUUID(),
        guardadaEn: new Date().toISOString(),
        estado: 'pendiente',
      };
      await agregarACola(entrada);
      await refrescar();
    },
    [refrescar],
  );

  const descartar = useCallback(
    async (idClienteOffline: string) => {
      await quitarDeCola(idClienteOffline);
      await refrescar();
    },
    [refrescar],
  );

  return {
    rechazadas: items.filter((i) => i.estado === 'rechazada'),
    sinSubirCount: items.filter((i) => i.estado === 'pendiente').length,
    encolar,
    descartar,
  };
}
