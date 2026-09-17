# PLAN — 046: onboarding-acueducto

**Spec aprobado:** 2026-09-17 (con el agregado de §3.4: reabrir el checklist a mano)

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `backend/src/index.ts` | Modificado | `GET /dashboard` suma `conteoServicios` a la respuesta (mismo patrón que `conteoUsuariosServicio`, sin RPC nueva) |
| `backend/tests/unit/dashboard-rutas.test.ts` (o el archivo real de tests de esta ruta) | Modificado | Cubre el campo nuevo |
| `frontend/components/panel/checklist-onboarding.tsx` | Nuevo | El checklist en sí — 3 pasos, estado hecho/pendiente derivado de los conteos, enlaces a pantallas reales, botón "Ver guía de inicio" para reabrirlo |
| `frontend/app/app/dashboard/page.tsx` | Modificado | `RespuestaDashboard` (interfaz local del archivo) suma `conteoServicios: number`; pasa los conteos al componente nuevo; oculta el bloque de indicadores mientras el acueducto está vacío (evita mostrar una pared de ceros). `frontend/lib/api.ts` (`ContextoUsuario`, usado por la barra lateral) NO se toca — nada ahí consume este campo nuevo |

Cero cambios a `core/`, cero migración (no hace falta ninguna tabla ni columna nueva — todo se
deriva de conteos ya existentes).

## 2-3. Esquema / Rutas de la API

Ninguna tabla nueva. `GET /dashboard` (ya existe) gana UN campo en la respuesta JSON:
`conteoServicios: number` — mismo patrón exacto que `conteoUsuariosServicio` (líneas 378-395 de
`backend/src/index.ts` hoy), una consulta más contra `servicios` filtrada por `cliente_id`.

## 4. Contratos de `core/`

Ninguno — esta feature no calcula dinero ni tiene lógica de negocio propia.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| El conteo de servicios se agrega a la respuesta que YA pide el dashboard (`GET /dashboard`), no una llamada nueva del cliente | Que `ChecklistOnboarding` llame a `listarServicios()` (ya existe, la usa `/app/catalogo`) por su cuenta | Spec §3.1: reusar datos que el dashboard ya pide. Una consulta más en el mismo round-trip del servidor es más barato que un segundo `fetch` del navegador, y evita un parpadeo de "cargando" para un dato tan chico |
| "Vacío" = `conteoUsuariosServicio === 0` (no exige también `conteoServicios === 0`) | Exigir ambos en cero para considerar el acueducto "vacío" | Un acueducto con catálogo cargado pero cero suscriptores sigue sin poder facturar nada real — el criterio que importa para mostrar el checklist por defecto es "no hay nada que gestionar todavía", y eso lo determina la ausencia de suscriptores, no de servicios (podría tener catálogo cargado de antemano y aun así estar vacío de operación real) |
| Mientras el acueducto está vacío, el bloque de indicadores (`DashboardIndicadores`) se oculta del todo, reemplazado por el checklist | Mostrar indicadores en cero junto al checklist | Una fila de $0 / 0 suscriptores no informa nada y compite visualmente con la guía — mismo criterio de no mostrar ceros sin sentido que ya usa `DashboardIndicadores` con la variación del recaudo (027: "sin línea si el mes anterior fue $0") |
| El botón "Ver guía de inicio" y el estado de mostrar/ocultar viven en un único componente cliente (`ChecklistOnboarding`), con `useState` local — sin store global ni parámetro de URL | Un query param (`?guia=1`) o contexto React compartido | Es un toggle de UI puramente local a esta pantalla, sin necesidad de persistir entre sesiones ni compartirse con otro componente — la opción más simple que cumple el CA-4b tal cual está escrito |
| El paso "Lector" del checklist se marca "hecho" si existe al menos un lector activo del acueducto (mismo dato que ya expone `GET /lectores`, pero ese endpoint exige rol `admin_acueducto` explícito — coincide con quién ve el checklist) | Omitir el estado de este paso, mostrarlo siempre como pendiente | Es opcional (spec §3.2) pero igual merece reflejar la realidad si ya se hizo — se resuelve con una llamada `listarLectoresConSectores()` del lado del cliente ya existente, sin tocar el backend (a diferencia de servicios/suscriptores, no vale la pena sumarlo a `GET /dashboard` para un paso opcional) |

## 6-7. Dependencias / Límites de Workers

Ninguna dependencia nueva. Una columna más en una respuesta JSON ya pequeña — sin impacto en los
límites de Cloudflare Workers.

## 8. Estrategia de pruebas

- **Backend (`vitest`, sin red real):** `GET /dashboard` devuelve `conteoServicios` con el valor
  real de la tabla; sin servicios → `0`; error de la consulta → mismo manejo que
  `conteoUsuariosServicio` hoy.
- **Frontend (manual, `wrangler dev` + `next dev` reales, o contra producción con el acueducto
  piloto real):**
  - CA-1: acueducto sin suscriptores (Idroredes del Sur hoy mismo) → el checklist aparece, sin
    indicadores.
  - CA-2: cargar un servicio+tarifa real → el paso "Catálogo y tarifas" pasa a "hecho" al recargar.
  - CA-3: cada enlace lleva a la pantalla real correspondiente, sin ningún formulario duplicado.
  - CA-4: cargar el primer suscriptor real (o de prueba) → el checklist desaparece solo, aparecen
    los indicadores normales.
  - CA-4b: con el acueducto ya con datos, "Ver guía de inicio" reabre el checklist.
  - CA-5: sesión de `secretaria`/`lector` nunca ve el checklist (ya lo garantiza que hoy tampoco ven
    `DashboardIndicadores`, mismo `if (rol === 'admin_acueducto')`).
