'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listarLectoresConSectores } from '@/lib/api';

interface ChecklistOnboardingProps {
  nombreAcueducto: string;
  vacio: boolean;
  conteoServicios: number;
  conteoUsuariosServicio: number;
}

// 046: guía de primer uso para admin_acueducto — checklist derivado de datos
// reales (nunca un flag propio que guardar), con enlaces a las pantallas que
// ya existen. Visible siempre que el acueducto está vacío (spec CA-1); si ya
// tiene datos, colapsada detrás de "Ver guía de inicio" (spec §3.4/CA-4b).
export function ChecklistOnboarding({
  nombreAcueducto,
  vacio,
  conteoServicios,
  conteoUsuariosServicio,
}: ChecklistOnboardingProps) {
  const [abierto, setAbierto] = useState(vacio);
  const [tieneLector, setTieneLector] = useState<boolean | null>(null);

  useEffect(() => {
    if (!abierto || tieneLector !== null) return;
    listarLectoresConSectores()
      .then((r) => setTieneLector(r.lectores.length > 0))
      .catch(() => setTieneLector(false));
  }, [abierto, tieneLector]);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-fit text-sm font-medium text-accent hover:underline"
      >
        Ver guía de inicio
      </button>
    );
  }

  const pasos = [
    {
      hecho: conteoServicios > 0,
      titulo: 'Catálogo y tarifas',
      descripcion: 'Cargá al menos un servicio con su tarifa vigente — sin esto no se puede facturar.',
      acciones: [{ texto: 'Ir a Catálogo', href: '/app/catalogo' }],
    },
    {
      hecho: conteoUsuariosServicio > 0,
      titulo: 'Suscriptores',
      descripcion: 'Cargá tu primer suscriptor, a mano o de una con un Excel.',
      acciones: [
        { texto: 'Cargar a mano', href: '/app/suscriptores' },
        { texto: 'Importar Excel', href: '/app/suscriptores/importar' },
      ],
    },
    {
      hecho: tieneLector,
      titulo: 'Lector (opcional)',
      descripcion: 'Si alguien va a tomar lecturas en campo, creale su acceso.',
      acciones: [{ texto: 'Ir a Lectores', href: '/app/lectores' }],
    },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">
            {vacio ? `Bienvenido a ${nombreAcueducto}` : 'Guía de inicio'}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {vacio
              ? 'Estos son los pasos para dejar tu acueducto listo para facturar.'
              : `Repasá los pasos de arranque de ${nombreAcueducto} cuando quieras.`}
          </p>
        </div>
        {!vacio && (
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
            aria-label="Ocultar guía de inicio"
          >
            Ocultar
          </button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pasos.map((paso) => (
          <div key={paso.titulo} className="flex items-start gap-3 rounded-lg border border-border p-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                paso.hecho ? 'bg-accent-soft text-accent' : 'border border-border text-muted-foreground'
              }`}
              aria-hidden
            >
              {paso.hecho ? '✓' : ''}
            </span>
            <div className="flex flex-1 flex-col gap-2">
              <div>
                <p className="text-sm font-semibold">{paso.titulo}</p>
                <p className="text-xs text-muted-foreground">{paso.descripcion}</p>
              </div>
              {!paso.hecho && (
                <div className="flex flex-wrap gap-2">
                  {paso.acciones.map((accion) => (
                    <Link
                      key={accion.href}
                      href={accion.href}
                      className="h-8 rounded-md border border-border px-3 text-xs font-medium leading-8 hover:bg-muted"
                    >
                      {accion.texto}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
