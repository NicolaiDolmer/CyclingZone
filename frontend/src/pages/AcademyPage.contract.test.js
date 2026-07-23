import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2796 — Akademi-siden havde INGEN test (til forskel fra RidersPage's fire),
// så kolonne- og payload-kontrakten var ubeskyttet: et felt kunne falde ud af
// backend-selecten og efterlade tomme celler uden at noget fejlede.
//
// Testene her er kilde-tekst-assertions (samme mønster som TeamPage.fields.test.js
// og RidersPage.columns.test.js) — de kræver ingen React-render, men fanger
// præcis de regressioner der ellers kun ses med øjnene i prod.

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(__dirname, "AcademyPage.jsx"), "utf8");
const apiSource = readFileSync(
  join(__dirname, "..", "..", "..", "backend", "routes", "api.js"),
  "utf8",
);

// Backend-selecten der føder akademi-rosteret. Isolér den ved at klippe
// /academy/me-handleren ud, så vi ikke matcher en tilfældig anden riders-select.
const academyMeBlock = (() => {
  const start = apiSource.indexOf('router.get("/academy/me"');
  assert.ok(start > 0, "kunne ikke finde GET /academy/me i backend/routes/api.js");
  const end = apiSource.indexOf('router.get("/academy/pnl"', start);
  assert.ok(end > start, "kunne ikke finde slutningen af /academy/me-handleren");
  return apiSource.slice(start, end);
})();

test("akademi-rosterets backend-select bærer felterne kolonnerne renderer (#2796)", () => {
  // Type-kolonnen, Værdi-kolonnen og promote-dialogens løn-projektion hænger på
  // disse felter. Uden dem er cellerne tomme / lønnen bliver fallback-konstanten.
  for (const field of [
    "primary_type",
    "secondary_type",
    "market_value",
    "current_production_value",
    "contract_end_season",
    "nationality_code",
  ]) {
    assert.match(
      academyMeBlock,
      new RegExp(`\\b${field}\\b`),
      `/academy/me mangler '${field}' — akademi-rosteret renderer det`,
    );
  }
});

test("intake-payloaden bærer pris og udløbsfrist (#2796)", () => {
  // Signér er et irreversibelt køb: prisen SKAL være kendt før klikket, og
  // tilbuddet udløber efter INTAKE_OFFER_EXPIRY_DAYS.
  assert.match(academyMeBlock, /signingFee/, "/academy/me sender ikke signingFee");
  assert.match(academyMeBlock, /expiresAt/, "/academy/me sender ikke expiresAt");
  assert.match(
    academyMeBlock,
    /INTAKE_OFFER_EXPIRY_DAYS/,
    "udløbsdatoen skal udledes af INTAKE_OFFER_EXPIRY_DAYS (SSOT i academyIntakeExpirySweep.js), ikke af et hardkodet 7-tal",
  );
  assert.match(
    academyMeBlock,
    /ACADEMY\.SIGNING_FEE_RATE/,
    "signeringsprisen skal bruge ACADEMY.SIGNING_FEE_RATE — samme sats som selve debiteringen",
  );
});

test("AcademyPage bruger de delte tabel-primitiver og er sorterbar (#2796)", () => {
  assert.match(pageSource, /data-sortable/, "roster-tabellen skal erklære data-sortable");
  assert.doesNotMatch(
    pageSource,
    /data-sort-exempt/,
    "akademi-rosteret er ikke længere sorterings-undtaget (Discord 22/7)",
  );
  assert.match(pageSource, /useTableSort/, "sortering skal bruge den delte useTableSort");
  for (const comp of ["NationCell", "RiderTypeBadge", "Table", "Tr", "Th", "Td"]) {
    assert.match(
      pageSource,
      new RegExp(`\\b${comp}\\b`),
      `AcademyPage skal bruge den delte ${comp} i stedet for en hånd-rullet variant`,
    );
  }
});

test("AcademyPage formaterer beløb locale-bevidst (#2796)", () => {
  assert.doesNotMatch(
    pageSource,
    // Kun det egentlige kald — kommentaren ovenfor i AcademyPage.jsx forklarer
    // netop denne fejl og må gerne nævne den ved navn.
    /new\s+Intl\.NumberFormat\(\s*["']en-US["']/,
    'løn-kolonnen hardkodede en-US, så en dansk bruger så to talformater på samme skærm — brug formatNumber',
  );
  assert.match(pageSource, /formatNumber/, "beløb skal formateres med den locale-bevidste formatNumber");
});

test("AcademyPage skelner backend-fejl fra slukket flag (#2796)", () => {
  // En 500'er efterlod enabled=false og ramte "kommer snart"-grenen, så
  // spilleren fik at vide at akademiet ikke fandtes endnu.
  assert.match(pageSource, /if \(error\)/, "AcademyPage skal have en egen fejl-gren før !enabled-grenen");
  assert.ok(
    pageSource.indexOf("if (error)") < pageSource.indexOf("if (!enabled)"),
    "fejl-grenen skal komme FØR !enabled-grenen, ellers vises 'kommer snart' ved en backend-fejl",
  );
});

test("promote-dialogen projicerer lønnen med holdets division (#2796)", () => {
  assert.match(
    pageSource,
    /projectSeniorSalary\(rider,\s*\{\s*division\s*\}\s*\)/,
    "uden division falder projectSeniorSalary tilbage på den globale sats og viser samme løn for alle ryttere",
  );
});
