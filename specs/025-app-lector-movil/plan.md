# PLAN — 025: app-lector-movil

**Spec aprobado:** 2026-09-10

## 1. Archivos

| Archivo | Acción | Propósito |
|---|---|---|
| `frontend/lib/api.ts` | Modificado | `obtenerContextoUsuario()`: `GET /dashboard` desde el cliente (ruta ya existente), solo para leer `cliente.rol` |
| `frontend/components/lector/shell-lector.tsx` | Nuevo | Encabezado ("AquaLectura" + indicador en línea/sin conexión) + navegación inferior de 4 pestañas |
| `frontend/components/lector/inicio-lector.tsx` | Nuevo | Saludo, nombre del acueducto, conteo de lecturas de hoy y de pendientes |
| `frontend/components/lector/nueva-lectura-lector.tsx` | Nuevo | Formulario de alta de lectura, mismo dato que ya usa el admin |
| `frontend/components/lector/pendientes-lector.tsx` | Nuevo | Lista de anomalías del periodo abierto, solo lectura |
| `frontend/components/lector/historial-lector.tsx` | Nuevo | Lista de periodos + lecturas de un periodo elegido |
| `frontend/app/app/lecturas/page.tsx` | Modificado | Pide el rol al montar; si es `lector` renderiza `<ShellLector />`, si no, se queda como está hoy |
| `CHANGELOG.md` | Modificado | Entrada de la sesión |

Cero archivos de backend — confirmado en el spec, sin RLS ni rutas nuevas.

## 2. Esquema de base de datos

Ninguno.

## 3. Rutas de la API (Hono)

Ninguna nueva. Reutilizadas, todas ya existentes: `GET /dashboard` (rol), `GET /acueducto` (nombre
del acueducto, 023), `GET /periodos`, `GET /suscriptores`, `GET /lecturas`,
`POST /lecturas`.

## 4. Contratos de core/

Ninguno — sin lógica de negocio nueva.

## 5. Decisiones técnicas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Las 4 "pantallas" son estado de React dentro de la misma página (`useState<'inicio'\|...>`), no rutas de Next.js | 4 rutas propias bajo `/app/lecturas/*` | Es navegación interna de una sola pantalla lógica, no páginas independientes que alguien comparta por URL; menos complejidad de enrutamiento para el mismo resultado visual |
| `GET /dashboard` (ya existe) para saber el rol, en vez de una ruta nueva | Endpoint nuevo `GET /mi-rol` | Cero superficie nueva de API — `GET /dashboard` ya devuelve `cliente.rol` para cualquier rol autenticado |
| Iconos como SVG inline a mano (gota, casa, más, alerta, reloj) | Librería de iconos (lucide-react, heroicons) | Son 5 símbolos simples y fijos; una librería completa para 5 iconos es la dependencia nueva que 023 evitó con el mismo criterio |
| Indicador "En línea/Sin conexión" lee `navigator.onLine` + eventos `online`/`offline` | Simularlo siempre en "En línea" | Mostrar un estado de conectividad que no se verifica sería mentirle a la interfaz — el spec ya aclara que no implica guardado offline real todavía |

## 6. Dependencias nuevas

Ninguna.

## 7. Límites de Cloudflare Workers a considerar

No aplica — sin cambios de backend.

## 8. Estrategia de pruebas

- **Unitarias:** no aplica (sin `core/`, sin lógica de negocio nueva).
- **Aislamiento:** no aplica (sin RLS nueva).
- **Integración (manual, `wrangler dev` + `next dev` reales, mismo método que 023/024):**
  `GET /dashboard` con sesión de `lector` real → confirma `rol` correcto; cada pestaña del shell
  nuevo con datos reales del fixture (acueducto, periodo abierto, suscriptores, lecturas);
  `admin_acueducto` real → `/app/lecturas` sin cambios (regresión).
- **Manual, requiere Mateo:** el renderizado final del shell en un navegador real (este entorno
  sigue sin Chromium/Playwright) — confirmar que se ve bien en un celular real o en las
  herramientas de desarrollo del navegador en modo responsivo.
