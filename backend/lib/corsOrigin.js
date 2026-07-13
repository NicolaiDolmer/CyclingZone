// CORS origin-allowlist for Express-API'et — #1875-rod-årsag.
//
// Uden preview-scope CORS-blokeres ALLE /api/*-kald fra Vercel branch-previews:
// per-branch/per-commit deploy-URLs har tilfældige hashes
// (cycling-zone-git-<branch>-<hash>-<team>.vercel.app) og kan derfor ikke listes
// eksakt i ALLOWED_ORIGINS. Konsekvens: når man tester et preview med ægte data
// loader kun Supabase-direkte reads (permissiv CORS) — mens ALT Express-baseret
// (gated features, nye flader) er usynligt fordi browseren blokerer svaret uden en
// matchende Access-Control-Allow-Origin.
//
// Fix: tillad previews under EJERENS Vercel-team-scope (team-slug'en er det sidste
// subdomæne-segment før .vercel.app). Kun team'et selv kan lave deploys der ender på
// dét segment, så suffix-matchet er scope-sikkert — vi åbner IKKE for hele
// *.vercel.app, hvor enhver Vercel-bruger kunne kalde API'et med credentials.

// Deploy-URLs har formen <project>-<hash|git-branch>-<team>.vercel.app. Team-slug'en
// (nicolai-dolmers-projects) er altid det trailing segment før .vercel.app, så et
// fremmed projekt/team kan ikke ramme dette mønster. Kræver https (ingen http-preview).
const VERCEL_PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+-nicolai-dolmers-projects\.vercel\.app$/;

/**
 * Er en request-origin tilladt af CORS? Eksakt allowlist ELLER ejerens Vercel-
 * preview-scope. Fraværende origin (server-til-server / samme-origin) → tilladt.
 * @param {string|undefined} origin  request Origin-headeren
 * @param {string[]} [allowedList=[]]  eksakte tilladte origins (ALLOWED_ORIGINS)
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, allowedList = []) {
  if (!origin) return true;
  if (allowedList.includes(origin)) return true;
  return VERCEL_PREVIEW_ORIGIN_RE.test(origin);
}
