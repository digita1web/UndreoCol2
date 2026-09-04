# PLAN-PRODUCCION.md — UndreoCol

**Versión:** 1.0
**Fecha:** 2026-09-04
**Estado:** Vigente

Documento que reúne los pasos y verificaciones necesarios antes de migrar el primer cliente real
a producción. Complementa a `ARQUITECTURA.md`, `docs/DECISIONES.md`, `docs/INFRAESTRUCTURA.md` y
`docs/INFRAESTRUCTURA-Y-COSTOS.md` — no los reemplaza.

---

## Auditoría de seguridad pre-producción

Antes de migrar el primer cliente real a producción, se realizará una auditoría de seguridad
dirigida usando un modelo de IA avanzado (Claude con modelo Opus, o DeepSeek con modelo
Reasoner/Pro — el de mayor capacidad de razonamiento disponible en ese momento), como complemento
a Semgrep (que ya corre automáticamente en cada commit desde esta sesión).

Esta auditoría es necesaria porque Semgrep detecta patrones conocidos de vulnerabilidad pero no
entiende el contexto de negocio específico del sistema. La auditoría por LLM debe revisar
explícitamente:
- Todas las políticas RLS de todas las tablas del esquema completo
- Todas las funciones SECURITY DEFINER (que ninguna filtre datos entre acueductos ni entre
  suscriptores)
- El manejo de sesiones admin y portal (fijación de sesión, robo de cookies, separación correcta
  entre ambas)
- Rate limiting y protección de fuerza bruta en login admin y portal
- Cualquier hallazgo pendiente de Semgrep que requiera juicio humano/contextual para decidir si es
  un falso positivo o un riesgo real

Se realiza una sola vez, al completar el roadmap principal (features 001-014), antes de
producción real — no reemplaza la verificación de seguridad ya hecha feature por feature durante
el desarrollo.
