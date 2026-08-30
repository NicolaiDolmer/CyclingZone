// Rene, framework-uafhængige hjælpefunktioner for UserProfileProvider (#3034).
//
// Udtrukket i egen .js-fil (ikke .jsx) så de kan importeres direkte af
// node:test uden en JSX-transform (repoet har bevidst ingen jsdom/loader —
// se App.authRestore.test.js m.fl.). userProfile.jsx importerer dem herfra.

// De fire felter der før blev hentet med tre separate Supabase-kald
// (language.jsx, consent.jsx, Layout.jsx) — nu ét fælles opslag.
export const PROFILE_COLUMNS = "language, role, username, consent_preferences";

// Afgør om cachen skal ryddes ved et auth-event. Bruges SYNKRONT (samme tick
// som userId opdateres) for at forhindre at næste bruger på samme
// session/enhed kan nå at se forrige brugers rolle/username i et stale
// render, mens den nye fetch stadig afventer (#3034 krav 4 — logout må ikke
// lække).
export function shouldClearProfileOnAuthChange(nextUserId) {
  return !nextUserId;
}

// Slår en eksplicit ændring (sprogskift, consent-gem) ind i cachen uden en
// ekstra DB-læsning (#3034 krav 3 — invalidering ved eksplicitte ændringer).
export function mergeProfilePatch(prevProfile, patch) {
  return { ...(prevProfile || {}), ...patch };
}
