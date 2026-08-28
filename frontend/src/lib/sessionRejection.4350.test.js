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
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const layout = read("../components/Layout.jsx");
const loginPage = read("../pages/LoginPage.jsx");
const sessionExpiry = read("./sessionExpiry.js");

test("#4350 hjerteslaget kigger på svaret i stedet for at fyre og glemme", () => {
  const heartbeat = layout.slice(layout.indexOf("heartbeatRef.current = setInterval"));
  assert.match(
    heartbeat.slice(0, 900),
    /api\/presence[\s\S]{0,200}expireSessionIfRejected/,
    "hjerteslagets presence-kald må ikke igen kaste svaret væk — det er #4350's rod",
  );
});

test("#4350 online-count afgør 401 FØR den bevarer sidst kendte tal", () => {
  const idx401 = layout.indexOf('expireSessionIfRejected(res, h, "online-count")');
  const idxOk = layout.indexOf("if (!res.ok) return;", layout.indexOf("api/online-count"));
  assert.ok(idx401 > -1, "online-count mangler 401-tjekket");
  assert.ok(
    idx401 < idxOk,
    "401-tjekket skal ligge før !res.ok-grenen — ellers sluges den afviste session som 'behold sidst kendte tal'",
  );
});

test("#4350 detektoren vejer 401'eren mod sessionens NUVÆRENDE token", () => {
  const fn = layout.slice(
    layout.indexOf("async function expireSessionIfRejected"),
    layout.indexOf("export default function Layout"),
  );
  assert.match(fn, /getSession\(\)/, "uden et opslag af den nuværende session kan et fornyelses-race ikke skelnes");
  assert.match(fn, /shouldDeclareExpired/, "beslutningen skal gå gennem den testede regel, ikke en lokal if");
  assert.match(fn, /signOut\(\)/, "detektoren skal udløse den eksisterende udlognings-kæde");
});

test("#4350 reglen afviser stadig et fornyet token (regressions-lås på selve reglen)", () => {
  assert.match(
    sessionExpiry,
    /if \(sentToken && currentToken !== sentToken\) return false;/,
    "fornyelses-race-grenen er værnet mod at logge raske spillere ud — den må ikke forsvinde",
  );
});

// Backendens requireAuth svarer 401 BÅDE når tokenet er afvist og når den ikke
// kunne nå Supabase til at tjekke det (`if (error || !user)`). De to tilstande
// ser ens ud herfra og betyder stik modsat. Uden en anden kilde ville et
// kortvarigt Supabase-udfald logge raske spillere ud — værre end bugget vi
// fikser. Denne guard er låsen på at den anden kilde bliver stående.
test("#4350 to uafhængige kilder skal være enige før noget ryddes", () => {
  const fn = layout.slice(
    layout.indexOf("async function expireSessionIfRejected"),
    layout.indexOf("export default function Layout"),
  );
  assert.match(fn, /getAuthedUser()/, "Supabase skal spørges direkte, ikke kun vores egen backends 401");
  const askIdx = fn.indexOf("getAuthedUser()");
  const signOutIdx = fn.indexOf("signOut()");
  assert.ok(askIdx > -1 && signOutIdx > -1, "begge trin skal findes");
  assert.ok(
    askIdx < signOutIdx,
    "den anden kilde skal spørges FØR sessionen ryddes — ellers er værnet dekoration",
  );
  const guardBlock = fn.slice(fn.indexOf("if (user)"), fn.indexOf("if (user)") + 200);
  assert.ok(
    guardBlock.includes("return false;"),
    "kender Supabase stadig brugeren, skal vi lade sessionen være",
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
