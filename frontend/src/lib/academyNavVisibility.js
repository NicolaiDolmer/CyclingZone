// Robust synligheds-beslutning for Akademi-nav-punktet (Layout.jsx).
//
// Baggrund: menupunktet blev sat synligt ud fra ÉT /api/academy/me-kald ved
// sideindlæsning. Den gamle logik fejlede LUKKET — et forbigående 401 (udløbet/
// fornyende session, #1792-klassen), 5xx eller netværksfejl efterlod punktet
// skjult uden retry, så et fungerende akademi "forsvandt" fra menuen til næste
// reload (LEGO-Vestas-symptomet).
//
// Nu: kun et AUTORITATIVT svar ændrer tilstanden — 200 → eksakt `enabled`, 409
// (academy_disabled) → skjul. Alt andet (401/5xx/netværk) BEVARER sidst kendte
// værdi (localStorage-cache), så en bruger der har set akademiet beholder det på
// tværs af et auth-/netværks-hikke. Flaget bevarer fuld kontrol: et eksplicit
// enabled:false eller 409 skjuler stadig punktet ved næste vellykkede kald.

export const ACADEMY_NAV_CACHE_KEY = "cz:academyNavEnabled";

/**
 * Afgør om Akademi-nav-punktet skal vises ud fra et /api/academy/me-resultat.
 *
 * @param {object} p
 * @param {number} [p.status]     HTTP-status (undefined = netværksfejl, intet svar)
 * @param {boolean} [p.enabled]   body.enabled ved status 200
 * @param {boolean} [p.lastKnown] sidst kendte synlighed (fra cache)
 * @returns {boolean}
 */
export function resolveAcademyNavVisible({ status, enabled, lastKnown = false } = {}) {
  if (status === 200) return Boolean(enabled); // autoritativt: vis præcis hvad serveren siger
  if (status === 409) return false;            // feature slået fra for denne viewer
  return Boolean(lastKnown);                   // 401/5xx/netværk → fejl lukker ikke punktet
}

export function readCachedAcademyNav() {
  try {
    return globalThis.localStorage?.getItem(ACADEMY_NAV_CACHE_KEY) === "1";
  } catch {
    return false; // private mode / storage afvist
  }
}

export function writeCachedAcademyNav(visible) {
  try {
    globalThis.localStorage?.setItem(ACADEMY_NAV_CACHE_KEY, visible ? "1" : "0");
  } catch {
    /* private mode / storage afvist — ignorer */
  }
}
