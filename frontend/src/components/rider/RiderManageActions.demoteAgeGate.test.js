// #5145 — nedryknings-knappens alders-gate i UI'et.
//
// node --test har ingen DOM → kildekode-strukturelle guards (samme mønster som
// BidConfirmModal.retirementWarning.test.js). Selve reglen er unit-testet i
// lib/academyDemoteGate.test.ts; DENNE fil beviser at begge steder knappen findes
// rent faktisk bruger den delte gate — og ikke er faldet tilbage til isU23.
//
// Hvorfor to steder: knappen bor både på rytter-profilen (RiderManageActions) og
// i holdsidens RiderActionModal (TeamPage). #5145's fix er kun halvt hvis den ene
// stadig tilbyder nedrykning af en 22-årig.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(__dirname, ...p), "utf8");

const actionsSrc = read("RiderManageActions.jsx");
const teamPageSrc = read("..", "..", "pages", "TeamPage.jsx");
const localesDir = join(__dirname, "..", "..", "..", "public", "locales");
const readLocale = (lang, file) => JSON.parse(readFileSync(join(localesDir, lang, file), "utf8"));

test("RiderManageActions gater nedrykning på canDemoteToAcademy, ikke på isU23", () => {
  assert.match(
    actionsSrc,
    /const canDemote = !isAcademyRider && canDemoteToAcademy\(rider\.birthdate, seasonYear\)/,
    "gaten skal komme fra den delte SSOT (academyDemoteGate.ts)",
  );
  assert.doesNotMatch(actionsSrc, /\bisU23\b/, "U23-grænsen (≤22) er netop bug'en i #5145 — den må ikke bruges til demote");
  assert.match(actionsSrc, /from "\.\.\/\.\.\/lib\/academyDemoteGate\.ts"/, "helperen skal importeres, ikke gentages inline");
});

test("TeamPage's RiderActionModal bruger SAMME gate — ellers er fixet kun halvt", () => {
  assert.match(
    teamPageSrc,
    /const canDemote = !rider\.is_academy && canDemoteToAcademy\(rider\.birthdate, seasonYear\)/,
    "holdsidens demote-fane skal have samme grænse som rytter-profilen",
  );
  assert.match(teamPageSrc, /from "\.\.\/lib\/academyDemoteGate\.ts"/);
});

test("ved præcis gradueringsalderen vises knappen deaktiveret MED forklaring, ikke tavst fjernet", () => {
  assert.match(
    actionsSrc,
    /const demoteAgeBlocked = !isAcademyRider && isDemoteBlockedByAge\(rider\.birthdate, seasonYear\)/,
    "kun alder 22 udløser forklaringen (23+ har aldrig haft en knap at savne)",
  );
  assert.match(
    actionsSrc,
    /\{\(canDemote \|\| demoteAgeBlocked\) && \(/,
    "akademi-sub-komponenten skal også mountes i den spærrede tilstand, så forklaringen kan vises",
  );
  const blockedBranch = actionsSrc.match(/!isAcademyRider && !canDemote && demoteAgeBlocked && \([\s\S]{0,600}?<\/>/);
  assert.ok(blockedBranch, "der skal findes en spærret gren i RiderAcademyActions");
  assert.match(blockedBranch[0], /<button[^>]*\bdisabled\b/, "knappen skal være disabled, ikke bare tekst");
  assert.match(blockedBranch[0], /t\("manage\.demote\.ageBlocked"\)/, "forklaringen skal komme fra i18n, ikke hardkodet copy");
});

test("manage.demote.ageBlocked findes i BÅDE en og da, og nævner ikke længere U23", () => {
  for (const lang of ["en", "da"]) {
    const rider = readLocale(lang, "rider.json");
    const text = rider?.manage?.demote?.ageBlocked;
    assert.equal(typeof text, "string", `${lang}/rider.json mangler manage.demote.ageBlocked`);
    assert.ok(text.trim().length > 0, `${lang}: forklaringen må ikke være tom`);
    assert.doesNotMatch(text, /U23/i, `${lang}: teksten må ikke kalde grænsen U23 — den er 21 nu`);
    assert.match(text, /22/, `${lang}: teksten skal nævne den alder der faktisk spærrer`);
  }
});

test("api.not_u23-teksten siger 21, ikke U23 — koden er historisk, teksten er player-facing", () => {
  for (const lang of ["en", "da"]) {
    const msg = readLocale(lang, "errors.json")?.api?.not_u23;
    assert.equal(typeof msg, "string", `${lang}/errors.json mangler api.not_u23`);
    assert.match(msg, /21/, `${lang}: fejlteksten skal nævne den rigtige grænse`);
    assert.doesNotMatch(msg, /U23/i, `${lang}: "U23" er nu forkert (U23 rummer 22-årige)`);
  }
});

test("holdsidens demote-beskrivelse lover ikke længere 22 år", () => {
  for (const lang of ["en", "da"]) {
    const desc = readLocale(lang, "team.json")?.actionModal?.demote?.description;
    assert.equal(typeof desc, "string", `${lang}/team.json mangler actionModal.demote.description`);
    assert.match(desc, /21/, `${lang}: beskrivelsen skal nævne den nye grænse`);
    assert.doesNotMatch(desc, /22 (or under|år eller derunder)/i, `${lang}: den gamle grænse må ikke stå tilbage`);
  }
});
