# PLAN — NNN: <Nombre de la feature>

**Spec aprobado:** <fecha>

## 1. Archivos
| Archivo | Acción | Propósito |
|---|---|---|

## 2. Esquema de base de datos
### Migraciones
| Archivo | Contenido |
|---|---|

### Tablas
<DDL o referencia a docs/esquema-propuesto.sql>

### Políticas RLS
<Qué puede hacer cada rol sobre cada tabla nueva.>

## 3. Rutas de la API (Hono)
| Método | Ruta | Auth | Propósito |
|---|---|---|---|

## 4. Contratos de core/
```ts
// firma de cada función pura, con su tipo de entrada y salida
```

## 5. Decisiones técnicas
| Decisión | Alternativa descartada | Razón |
|---|---|---|

## 6. Dependencias nuevas
| Paquete | Versión | Licencia | Por qué | Alternativa descartada |
|---|---|---|---|---|

## 7. Límites de Cloudflare Workers a considerar
<CPU, memoria, bundle — ver CLAUDE.md §5.5>

## 8. Estrategia de pruebas
- Unitarias (core/):
- Aislamiento (RLS):
- Integración:
- Manual (requiere Mateo):
