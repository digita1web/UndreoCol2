// Tipos de los bindings del Worker del frontend (020, proxy-cookies-mismo-origen).
// `Fetcher` es un tipo global de @cloudflare/workers-types (dependencia
// transitiva de wrangler). Sin `any` (CLAUDE.md §7).
//
// Regenerar/ampliar con `npx wrangler types` si se agregan más bindings —
// no se ejecutó aquí porque este entorno no puede instalar node_modules
// (bloqueo de cdn.sheetjs.com, ver frontend/package.json).

interface CloudflareEnv {
  API: Fetcher;
}
