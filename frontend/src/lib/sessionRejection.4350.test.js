// #4350 forward-guard — kilde-struktur-scanner (ingen jsdom i kodebasen, samme
// form som silentFailureContract.4165.test.js).
//
// Bugget var IKKE at udlogningen manglede. Kæden fandtes:
//   SIGNED_OUT → App.jsx rydder session → ProtectedRoute → /login?next=
// Den blev bare aldrig udløst, når serveren afviste et token som supabase-js
// lokalt stadig troede på. Der er derfor to ting at pinne, og den anden er den
// nemme at tabe i en oprydning:
//
//   1. hjerteslaget SKAL kigge på svaret (ellers er vi tilbage i bugget),
//   2. en 401 SKAL vejes mod sessionens nuværende token (ellers har vi byttet
//      bugget ud med et værre: raske spillere smidt ud midt i en normal
//      token-fornyelse).
//
// #5242 (opfoelger #5233 fund 2): Layout.jsx's egen kopi af begge regler
// (den lokale `expireSessionIfRejected`) er FJERNET og erstattet af
// apiFetch → networkErrorGuards.reportUnauthorizedResponse — samme kæde
// RiderStatsPage m.fl. allerede delte. De to regler ovenfor findes derfor
// ikke længere i Layout.jsx som tekst at scanne efter; de er strukturelt
// GARANTERET af apiFetch.ts (401 afgøres ALTID inden apiFetch returnerer —
// se apiFetch.test.ts's "et 401 afleveres til networkErrorGuards og
// retry'es aldrig automatisk") og af networkErrorGuards.ts (getSession/
// shouldDeclareExpired/getUser/isDefinitiveAuthDenial/signOut-kæden — se
// networkErrorGuards.5089.test.ts's fulde dedup/anden-kilde-dækning).
// Denne fils job er nu kun at pinne at Layout.jsx rent faktisk DELEGERER
// (bruger apiFetch på de tre 401-følsomme kaldsteder, genopfinder intet selv).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const layout = read("../components/Layout.jsx");
const loginPage = read("../pages/LoginPage.jsx");
const sessionExpiry = read("./sessionExpiry.js");

test("#4350/#5242 Layout.jsx har ikke længere sin egen 401-kopi", () => {
  assert.ok(
    !layout.includes("async function expireSessionIfRejected"),
    "den lokale 401-detektor skal være væk — #5242 erstattede den med apiFetch->networkErrorGuards (#5233 fund 2)",
  );
  assert.match(
    layout,
    /import \{ apiFetch \} from "\.\.\/lib\/apiFetch\.ts"/,
    "Layout.jsx skal importere apiFetch — det er den nye 401-vej",
  );
});

test("#4350 hjerteslaget kigger på svaret i stedet for at fyre og glemme", () => {
  const heartbeat = layout.slice(layout.indexOf("heartbeatRef.current = setInterval"));
  assert.match(
    heartbeat.slice(0, 1400),
    /apiFetch\(`\$\{API\}\/api\/presence`/,
    "hjerteslagets presence-kald skal gå gennem apiFetch — den kigger ALTID på status (401 afgøres inden den returnerer, se apiFetch.test.ts), så #4350's 'fyr og glem' ikke kan genopstå",
  );
});

test("#4350 online-count afgør 401 FØR den bevarer sidst kendte tal", () => {
  const block = layout.slice(layout.indexOf("async function fetchOnlineCount"), layout.indexOf("async function fetchOnlineCount") + 900);
  const idxFetch = block.indexOf("apiFetch(`${API}/api/online-count`");
  const idxOk = block.indexOf("if (!res.ok");
  assert.ok(idxFetch > -1, "online-count mangler apiFetch-kaldet");
  assert.ok(
    idxFetch < idxOk,
    "apiFetch-kaldet (som selv afgør 401 FØR det returnerer) skal ligge før !res.ok-grenen — ellers kunne en afvist session sluges som 'behold sidst kendte tal'",
  );
});

test("#4350 reglen afviser stadig et fornyet token (regressions-lås på selve reglen)", () => {
  assert.match(
    sessionExpiry,
    /if \(sentToken && currentToken !== sentToken\) return false;/,
    "fornyelses-race-grenen er værnet mod at logge raske spillere ud — den må ikke forsvinde",
  );
});

test("#4350 login-siden fortæller hvorfor spilleren står der", () => {
  assert.match(loginPage, /peekSessionExpiredFlash/, "flash-beskeden skal læses");
  const clearEffect = loginPage.slice(loginPage.indexOf("clearSessionExpiredFlash()") - 400, loginPage.indexOf("clearSessionExpiredFlash()"));
  assert.ok(
    clearEffect.includes("useEffect("),
    "rydningen skal ligge i en useEffect — i useState-initializeren spiser StrictMode beskeden",
  );
  assert.ok(
    !loginPage.includes("useState(() => clearSessionExpiredFlash"),
    "rydning i initializeren er præcis den fejl der gjorde banneret usynligt",
  );
  assert.match(
    loginPage,
    /sessionExpired && !success/,
    "banneret skal renderes — og ikke oven i kvitteringsfladen",
  );
  assert.match(
    loginPage,
    /errors:supabase\.sessionMissing/,
    "genbrug den eksisterende tekst; #4350 introducerer ingen ny copy",
  );
});
