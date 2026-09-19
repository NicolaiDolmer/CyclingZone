// apiBase — ét sted der bygger backendens URL'er (#5322).
//
// ── Hvorfor den findes ──────────────────────────────────────────────────────
//
// 96 filer i frontend/src bygger i dag selv `${import.meta.env.VITE_API_URL}
// /api/...`. Et domæneskifte (eller bare en manglende/efterslæbende skråstreg)
// skal derfor rettes 96 steder i stedet for ét. Denne helper er det ene sted —
// selve mass-migreringen af de 96 filer hører til #5242 (udbredelsen), ikke
// hertil; her bliver helperen født og taget i brug af apiFetch, så ethvert
// kaldsted der allerede går gennem apiFetch kan nøjes med en relativ sti.
//
// ── Kontrakt ────────────────────────────────────────────────────────────────
//
// · `apiUrl("/api/x")`      -> "<base>/api/x"
// · `apiUrl("api/x")`       -> "<base>/api/x" (manglende skråstreg tilføjes)
// · `apiUrl("https://…/x")` -> uændret. Det er bagudkompatibiliteten: de
//   eksisterende kaldsteder sender allerede en FULD url ind i apiFetch, og de
//   skal blive ved med at ramme præcis den url de selv byggede.
// · Basen læses gennem `import.meta.env?.` (optional), ikke `import.meta.env.`:
//   modulet importeres af apiFetch, som unit-testes under Node's ESM-loader
//   hvor `import.meta.env` slet ikke findes. Samme mønster som
//   trafficBeacon.js/posthogClient.js af samme grund.

/**
 * Backendens base-url uden efterfølgende skråstreg(er). Tom streng når
 * VITE_API_URL ikke er sat (Node-tests, SSR-prerender) — så bliver `apiUrl`
 * til en ren relativ sti i stedet for at bygge "undefined/api/x".
 */
export function apiBase(): string {
  const raw = import.meta.env?.VITE_API_URL;
  return typeof raw === "string" ? raw.replace(/\/+$/, "") : "";
}

/** Har stien allerede sit eget skema (http:, https:, blob:, data:)? */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Byg en absolut backend-url ud fra en relativ sti. En sti der ALLEREDE er
 * absolut returneres uændret.
 *
 * @param path relativ sti ("/api/board/status") eller en færdig url.
 * @param base injicérbar base — kun til tests; default er `apiBase()`.
 */
export function apiUrl(path: string, base: string = apiBase()): string {
  if (ABSOLUTE_URL.test(path)) return path;
  // Protokol-relativ ("//host/x") er også absolut i browserens øjne; den må
  // aldrig få basen sat foran sig.
  if (path.startsWith("//")) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
