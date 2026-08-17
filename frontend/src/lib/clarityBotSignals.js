// #3819: Clarity counted ~4.000 "unikke brugere" 3/8 mod 35 ægte i backenden
// (player_events). Rod-årsagen var syntetisk trafik der allerede undgår
// Clarity's egen IsBot-detektion (den er ekskluderet i dashboard-queryen i
// #3819 og alligevel til stede). De tre kendetegn fra issuet:
//   1. Ingen cookie-persistens (1 session = 1 "ny" bruger på tværs af alle
//      segmenter) — fanges ikke herfra, det er allerede løst af identify()
//      (#1797) for ægte trafik og er i sig selv ikke et signal vi kan handle på.
//   2. Fingerprint-mismatch (fx "SamsungInternet på Linux PC") — kan ikke
//      verificeres pålideligt client-side uden false positives på ægte,
//      usædvanlige enheder; efterlades til Clarity-dashboardets egen
//      enheds-parsing/owner-review.
//   3. Self-referral: 2.929 af ~4.000 sessions havde cyclingzone.org som
//      referrer til cyclingzone.org uden en forudgående indgangskilde — det
//      ER handlingsbart herfra, se isSelfReferralEntry().
//
// Alle funktioner er rene og tager deres afhængigheder som argumenter, så de
// kan testes med node --test uden en DOM (mirroring clarityConsent.js's
// leaf-modul-mønster).

// Automation-frameworks (Selenium/Puppeteer/Playwright m.fl.) sætter
// navigator.webdriver = true. Ægte browsere sætter den aldrig. Fanger ikke
// nødvendigvis #3819-spikens trafik (den undgår allerede Clarity's egen
// IsBot-heuristik, som formentlig tjekker det samme signal) men er en billig,
// false-positive-fri filtrering af kendte automatiserings-frameworks generelt.
export function isLikelyAutomation(nav) {
  return Boolean(nav?.webdriver);
}

// Chrome's Speculation Rules API kan prerendere en side før brugeren rent
// faktisk navigerer dertil. En prerendering-session der aldrig aktiveres er
// ikke et rigtigt besøg og bør ikke starte en Clarity-session. Bruges sammen
// med "prerenderingchange"-eventet i clarityIntegration.jsx til at udskyde
// init til siden faktisk er aktiveret.
export function isPrerendering(doc) {
  return Boolean(doc?.prerendering);
}

// Sand hvis document.referrer peger på vores eget domæne som indgangskilde —
// dvs. et FÆRSK browser-load (ikke en SPA-routeskift, referrer opdateres ikke
// af client-side routing) hvor referrer allerede er os selv. Det er det
// dominerende signal fra #3819 (2.929/~4.000 sessions). Ægte selv-referral
// findes (fx target="_blank" fra en intern side, eller en auth-redirect), så
// vi blokerer IKKE optagelsen — vi tagger den, så ejeren kan ekskludere den i
// Clarity's dashboard-filtre (Filters → Custom tags) uden at miste ægte
// session-recordings/heatmaps.
export function isSelfReferralEntry(referrer, origin) {
  if (!referrer || !origin) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}
