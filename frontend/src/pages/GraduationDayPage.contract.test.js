import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2491 — kilde-tekst-kontrakt for Graduation Day-siden, samme moenster som
// AcademyPage.contract.test.js og TeamPage.fields.test.js. Den daekker praecis
// de ting den ejer-godkendte mockup (3g/3h) og HANDOFF.md binder os paa, og som
// ellers kun ses med oejnene: skabelon, guld-rationeringen, den ene flade, og at
// backend faktisk sender de felter raekken renderer.

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(__dirname, "GraduationDayPage.tsx"), "utf8");
const academySource = readFileSync(join(__dirname, "AcademyPage.jsx"), "utf8");
const notificationsSource = readFileSync(join(__dirname, "NotificationsPage.jsx"), "utf8");
const appSource = readFileSync(join(__dirname, "..", "App.jsx"), "utf8");
const apiSource = readFileSync(
  join(__dirname, "..", "..", "..", "backend", "routes", "api.js"),
  "utf8",
);

const academyMeBlock = (() => {
  const start = apiSource.indexOf('router.get("/academy/me"');
  assert.ok(start > 0, "kunne ikke finde GET /academy/me i backend/routes/api.js");
  const end = apiSource.indexOf('router.get("/academy/pnl"', start);
  assert.ok(end > start, "kunne ikke finde slutningen af /academy/me-handleren");
  return apiSource.slice(start, end);
})();

test("siden foelger T1: max-w-4xl og den kanoniske PageHeader (PAGE_TEMPLATES)", () => {
  assert.match(pageSource, /max-w-4xl/, "Graduation Day er T1 (896 px) per YOUTH_RULES par. 2.6");
  assert.doesNotMatch(pageSource, /max-w-\[1600px\]|max-w-5xl/, "T1 har ingen T2/T3-bredde");
  assert.match(pageSource, /PageHeader/, "sidehovedet skal vaere den kanoniske recipe, aldrig hand-rullet");
  assert.doesNotMatch(pageSource, /rounded-(?:lg|xl|2xl)|shadow-/, "ingen off-token radius, ingen skygger");
});

test("praecis ÉN guld primary paa viewet: Confirm all (HANDOFF pkt. 7)", () => {
  // Button defaulter til variant="primary" (guld), saa hver <Button uden en
  // eksplicit variant er et guld-kald. Der maa vaere ét, og det skal vaere
  // Confirm all i sidehovedets action-cluster.
  const buttons = pageSource.match(/<Button\b[^>]*>/gs) ?? [];
  const goldButtons = buttons.filter((b) => !/variant=/.test(b));
  assert.equal(goldButtons.length, 1, `forventede 1 guld-knap, fandt ${goldButtons.length}`);
  assert.match(pageSource, /graduationDay\.confirmAll/, "guld-knappen er 'Confirm all'");
});

test("tom tilstand er EmptyState med inbox-ikon og INGEN guld (artboard 3h)", () => {
  assert.match(pageSource, /EmptyState/, "tom tilstand skal bruge den kanoniske EmptyState");
  assert.match(pageSource, /InboxIcon/, "mockup 3h foreskriver inbox-ikonet");
  // Vejen videre er en sekundaer knap, ikke sidens guld.
  assert.match(pageSource, /buttonClass\(\{ variant: "secondary"/, "handlingen i tom tilstand maa ikke vaere guld");
});

test("raekken baerer alle seks kolonner fra mockup 3g", () => {
  for (const marker of [
    "RiderName",              // identitet
    "statPlateStyle",         // rating-plade
    "ScoutablePotentiale",    // potentiale-baand
    "graduationDay.colContract", // kontrakt + loen
    "graduationDay.coach.",   // traenerens vurdering
    "SegmentedControl",       // segmentet
  ]) {
    assert.ok(pageSource.includes(marker), `raekken mangler '${marker}' fra den ejer-godkendte mockup`);
  }
});

test("blokeret Move up staar men er uvaelgelig, med aarsagen i danger", () => {
  assert.match(
    pageSource,
    /disabled: disabled \|\| \(value === "promote" && Boolean\(block\)\)/,
    "'Move up' skal vaere disabled, ikke fjernet: et fjernet segment skjuler at valget findes",
  );
  assert.match(pageSource, /text-cz-danger/, "aarsagen staar i danger under segmentet");
  assert.match(pageSource, /graduationDay\.blocked\.squadFull/, "aarsagen skal naevne truppens loft");
});

test("tal er tabulaere, og teksten baerer ingen emoji eller em-dash paa fladen", () => {
  assert.match(pageSource, /tabular-nums/, "al numerik er tabular (PAGE_TEMPLATES)");
  // Em-dash er tilladt i danske kode-kommentarer her, men aldrig i en t()-noegle
  // eller literal streng der naar spilleren. Locale-filerne vogtes separat af
  // scripts/tone-check-em-dash.mjs.
  assert.doesNotMatch(pageSource, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "ingen emoji");
});

test("Academy har KUN et banner tilbage, ingen anden graduerings-flade", () => {
  assert.match(academySource, /\/academy\/graduation/, "Academy skal linke til Graduation Day-siden");
  assert.match(academySource, /graduationBanner\.title/, "banneret er den eneste graduerings-flade paa Academy");
  // Den gamle blok kaldte ruten direkte pr. kort. Ingen dobbelt flade.
  assert.doesNotMatch(academySource, /resolveGraduate/, "AcademyPage maa ikke laengere resolve'e en graduate selv");
  assert.doesNotMatch(academySource, /handleGraduate/, "den gamle kort-handler skal vaere slettet, ikke efterladt som doed kode");
});

test("Inbox-notifikationen peger paa den nye side, ikke paa Academy (HANDOFF pkt. 8)", () => {
  const row = notificationsSource
    .split("\n")
    .find((l) => l.includes("academy_graduation_ready:"));
  assert.ok(row, "academy_graduation_ready mangler i notifikations-kortet");
  assert.match(row, /link: "\/academy\/graduation"/, "notifikationen skal foere til Graduation Day");
});

test("ruten findes og er lazy, som resten af app-siderne", () => {
  assert.match(appSource, /path="academy\/graduation"/, "ruten /academy/graduation mangler i App.jsx");
  // `.js`-endelsen: TypeScripts konvention for et .tsx-modul, samme moenster som
  // TransfersPage's import af TradeListPage.tsx. Uden den er importen
  // extensionless, hvilket bestaar Vite men fejler i Node's ESM-loader (#803).
  assert.match(appSource, /lazy\(\(\) => import\("\.\/pages\/GraduationDayPage\.js"\)\)/, "siden skal lazy-loades med .js-endelsen");
});

test("backend sender de felter raekken renderer (#2491)", () => {
  for (const field of [
    "from_squad",
    "to_squad",
    "targetSquadCount",
    "targetSquadMax",
    "contract_end_season",
    "rider_derived_abilities",
  ]) {
    assert.match(
      academyMeBlock,
      new RegExp(`\\b${field}\\b`),
      `/academy/me mangler '${field}' — Graduation Day renderer det`,
    );
  }
  assert.match(
    academyMeBlock,
    /SQUAD_CAPS/,
    "maal-truppens loft skal komme fra SQUAD_CAPS (backend/lib/squads.js), ikke fra et tal skrevet her",
  );
});

test("siden opfinder ikke sin egen graduerings-rute", () => {
  // Handlingen gaar gennem useAcademy's resolveGraduate -> POST /api/academy/graduate.
  assert.match(pageSource, /resolveGraduate/, "valget skal gaa gennem den eksisterende rute");
  assert.doesNotMatch(pageSource, /apiFetch|fetch\(/, "siden maa ikke kalde backenden udenom useAcademy");
});
