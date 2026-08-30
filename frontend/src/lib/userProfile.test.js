// #3034 — UserProfileProvider samler de spredte `users`-opslag (language,
// role, username, consent_preferences) i ét Supabase-kald pr. session.
//
// Repoet har bevidst ingen jsdom (se App.authRestore.test.js m.fl.), så disse
// tests dækker (a) de rene, framework-uafhængige hjælpefunktioner der bærer
// invaliderings-reglerne, med RIGTIGE assertions på deres faktiske adfærd, og
// (b) kilde-struktur-checks (samme mønster som sessionRejection.4350.test.js)
// der holder selve provideren og dens tre forbrugere ærlige om at der kun er
// ÉT `.select(...)`-opslag tilbage, og at ingen af de tre laver deres eget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROFILE_COLUMNS,
  shouldClearProfileOnAuthChange,
  mergeProfilePatch,
} from "./userProfileCache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), "utf8");

const userProfileSource = read("userProfile.jsx");
const languageSource = read("language.jsx");
const consentSource = read("consent.jsx");
const layoutSource = read("../components/Layout.jsx");

// --- Rene funktioner: invalidering ved logout (krav 4) -------------------

test("shouldClearProfileOnAuthChange: logout (null uid) rydder cachen", () => {
  assert.equal(shouldClearProfileOnAuthChange(null), true);
});

test("shouldClearProfileOnAuthChange: manglende session (undefined uid) rydder cachen", () => {
  assert.equal(shouldClearProfileOnAuthChange(undefined), true);
});

test("shouldClearProfileOnAuthChange: en aktiv bruger rydder IKKE cachen", () => {
  assert.equal(shouldClearProfileOnAuthChange("user-123"), false);
});

// --- Rene funktioner: invalidering ved eksplicit ændring (krav 3) --------

test("mergeProfilePatch: patcher sprogfeltet uden at røre resten af cachen", () => {
  const prev = { language: "en", role: "admin", username: "nico", consent_preferences: { analytics: true } };
  const next = mergeProfilePatch(prev, { language: "da" });
  assert.deepEqual(next, { ...prev, language: "da" });
  // prev må ikke muteres — cachen skal skiftes ud, ikke ændres in-place.
  assert.equal(prev.language, "en");
});

test("mergeProfilePatch: patcher consent_preferences uden at røre role/username/language", () => {
  const prev = { language: "da", role: "user", username: "test", consent_preferences: { analytics: false } };
  const next = mergeProfilePatch(prev, { consent_preferences: { analytics: true, marketing: true } });
  assert.deepEqual(next, {
    language: "da",
    role: "user",
    username: "test",
    consent_preferences: { analytics: true, marketing: true },
  });
});

test("mergeProfilePatch: virker fra en tom/null cache (fx lige efter login, før første fetch)", () => {
  assert.deepEqual(mergeProfilePatch(null, { language: "da" }), { language: "da" });
});

// --- Ét kald i stedet for tre --------------------------------------------

test("PROFILE_COLUMNS dækker alle fire felter i ét select", () => {
  assert.equal(PROFILE_COLUMNS, "language, role, username, consent_preferences");
});

test("userProfile.jsx laver præcis ét users-opslag (PROFILE_COLUMNS) — ikke tre", () => {
  const selectCalls = userProfileSource.match(/\.from\("users"\)\s*\n?\s*\.select\(/g) || [];
  assert.equal(
    selectCalls.length,
    1,
    "UserProfileProvider skal hente alle fire felter i ét .select(...)-kald, ikke flere",
  );
  assert.match(
    userProfileSource,
    /\.from\("users"\)\s*\n?\s*\.select\(PROFILE_COLUMNS\)/,
    "det ene select skal bruge PROFILE_COLUMNS (language, role, username, consent_preferences)",
  );
});

// #3034: regex'erne matcher kun en RIGTIG kaldekæde (select efterfulgt af
// .eq(...) på næste linje) — ikke de forklarende kommentarer i disse filer
// der bevidst citerer det gamle opslag som before/after-dokumentation.

test("language.jsx laver IKKE længere sit eget users.language-opslag (#3034)", () => {
  assert.doesNotMatch(
    languageSource,
    /\.from\("users"\)\s*\n\s*\.select\("language"\)\s*\n\s*\.eq\(/,
    "LanguageProvider skal læse language fra den delte UserProfileProvider, ikke sit eget opslag",
  );
});

test("consent.jsx laver IKKE længere sit eget users.consent_preferences-LÆSNING (#3034)", () => {
  assert.doesNotMatch(
    consentSource,
    /\.from\("users"\)\s*\n\s*\.select\("consent_preferences"\)\s*\n\s*\.eq\(/,
    "ConsentProvider skal læse consent_preferences fra den delte UserProfileProvider, ikke sit eget opslag",
  );
});

test("Layout.jsx laver IKKE længere sit eget users.role/username-opslag (#3034)", () => {
  assert.doesNotMatch(
    layoutSource,
    /\.select\("role, username"\)\.eq\(/,
    "Layout skal læse role fra den delte UserProfileProvider, ikke sit eget opslag",
  );
});

// --- Cache-hit ved anden læser: alle tre forbrugere bruger konteksten -----

test("language.jsx, consent.jsx og Layout.jsx bruger alle useUserProfile (delt cache, ikke egen fetch)", () => {
  assert.match(languageSource, /import\s*\{\s*useUserProfile\s*\}\s*from\s*"\.\/userProfile\.jsx"/);
  assert.match(languageSource, /useUserProfile\(\)/);
  assert.match(consentSource, /import\s*\{\s*useUserProfile\s*\}\s*from\s*"\.\/userProfile\.jsx"/);
  assert.match(consentSource, /useUserProfile\(\)/);
  assert.match(layoutSource, /import\s*\{\s*useUserProfile\s*\}\s*from\s*"\.\.\/lib\/userProfile\.jsx"/);
  assert.match(layoutSource, /useUserProfile\(\)/);
});

// --- Invalidering ved logout: selve providerens auth-lytter -------------

test("UserProfileProvider rydder profile SYNKRONT (via shouldClearProfileOnAuthChange) i onAuthStateChange, ikke kun i den async fetch", () => {
  const authBlock = userProfileSource.slice(userProfileSource.indexOf("supabase.auth.onAuthStateChange("));
  assert.match(
    authBlock.slice(0, 700),
    /shouldClearProfileOnAuthChange\(uid\)\)\s*setProfile\(null\)/,
    "logout/bruger-skift skal rydde profile-state med det samme, ellers kan næste bruger nå at se den forrige i et stale render",
  );
});

// --- Invalidering ved sprogskift (krav 3) --------------------------------

test("setLanguage() invaliderer den delte cache efter en succesfuld DB-skrivning", () => {
  const fn = languageSource.slice(
    languageSource.indexOf("const setLanguage = useCallback"),
    languageSource.indexOf("return (\n    <LanguageContext.Provider"),
  );
  assert.match(
    fn,
    /\.update\(\{\s*language:\s*lng\s*\}\)[\s\S]*?updateProfile\(\{\s*language:\s*lng\s*\}\)/,
    "setLanguage skal kalde updateProfile({ language: lng }) EFTER DB-skrivningen, så den delte cache ikke bliver stale",
  );
});

test("saveConsent() invaliderer den delte cache efter en succesfuld DB-skrivning", () => {
  const fn = consentSource.slice(
    consentSource.indexOf("const saveConsent = useCallback"),
    consentSource.indexOf("const acceptAll"),
  );
  assert.match(
    fn,
    /\.update\(\{\s*consent_preferences:\s*next\s*\}\)[\s\S]*?updateProfile\(\{\s*consent_preferences:\s*next\s*\}\)/,
    "saveConsent skal kalde updateProfile({ consent_preferences: next }) EFTER DB-skrivningen",
  );
});

// --- AppProviders: UserProfileProvider skal ligge OVER de to andre -------

test("AppProviders.jsx monterer UserProfileProvider OVER både ConsentProvider og LanguageProvider", () => {
  const appProvidersSource = read("../AppProviders.jsx");
  const idxProfile = appProvidersSource.indexOf("<UserProfileProvider>");
  const idxConsent = appProvidersSource.indexOf("<ConsentProvider>");
  const idxLanguage = appProvidersSource.indexOf("<LanguageProvider");
  assert.ok(idxProfile > -1, "UserProfileProvider skal monteres i AppProviders");
  assert.ok(
    idxProfile < idxConsent && idxProfile < idxLanguage,
    "UserProfileProvider skal ligge OVER ConsentProvider og LanguageProvider — de læser fra dens context",
  );
});
