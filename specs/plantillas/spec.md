# SPEC — NNN: <Nombre de la feature>

**Estado:** Borrador para aprobación
**Depende de:** <features previas o "ninguna">

## 1. Objetivo
<Qué se construye y para qué, en 2-3 frases.>

## 2. Por qué ahora
<Qué desbloquea. Por qué va en este punto del roadmap.>

## 3. Alcance
### 3.1 <Bloque>
- <Comportamiento observable, no implementación>

## 4. Fuera de alcance
<Lo que explícitamente NO se construye aquí, y en qué feature va.>

## 5. Reglas de negocio que aplican
<Referencia a los casos límite de CLAUDE.md §10 y decisiones de
docs/DECISIONES.md que toca esta feature.>

## 6. Criterios de aceptación
Cada uno cerrado con evidencia ejecutada y pegada.

### CA-1 — <Nombre>
<Verificación concreta. Qué se ejecuta, qué debe salir.>

## 7. Riesgos
| Riesgo | Mitigación |
|---|---|

## 8. Definición de terminado
- [ ] Todos los CA con evidencia
- [ ] Build (frontend) y `wrangler deploy --dry-run` (backend) limpios
- [ ] Tests en verde
- [ ] Test de aislamiento de tablas nuevas
- [ ] CHANGELOG.md actualizado
- [ ] Aprobación de Mateo
