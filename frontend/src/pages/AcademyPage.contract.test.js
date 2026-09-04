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

test("AcademyPage bruger den kanoniske DataTable og er sorterbar (#2796, migreret #3045)", () => {
  // #3045: rosteret migreret fra de hånd-rullede Table/Tr/Th/Td (ingen sticky
  // navnekolonne, ingen fold-mekanisme) til den kanoniske DataTable — samme
  // T2-recipe som RidersPage/TeamPage/WatchlistPage. DataTable erklærer
  // data-sortable internt på sit eget <table>-element, så AcademyPage.jsx
  // behøver ikke længere den literale streng selv.
  assert.doesNotMatch(
    pageSource,
    /data-sort-exempt/,
    "akademi-rosteret er ikke længere sorterings-undtaget (Discord 22/7)",
  );
  assert.match(pageSource, /useTableSort/, "sortering skal bruge den delte useTableSort");
  assert.match(pageSource, /\bDataTable\b/, "roster-tabellen skal bruge den kanoniske DataTable (T2), ikke en hånd-rullet variant");
  for (const comp of ["NationCell", "RiderTypeBadge"]) {
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

test("promote-dialogen projicerer lønnen fra rytteren selv (#2796/#3989)", () => {
  // #3989 fjernede division-parameteren: satsen er global, så halvdelen af
  // #2796's fejlklasse er væk strukturelt. Tilbage står den anden halvdel —
  // et rytter-objekt uden current_production_value giver base-fallbacken 1000
  // og dermed samme plausible, forkerte løn for ENHVER rytter. Vagten kræver
  // derfor at kaldet sender rytteren selv (ikke et literal-objekt), og at
  // AcademyPage aldrig igen sender en division ind.
  assert.match(
    pageSource,
    /projectSeniorSalary\(rider\)/,
    "promote-dialogen skal projicere fra rytter-objektet, så current_production_value følger med",
  );
  assert.doesNotMatch(
    pageSource,
    /projectSeniorSalary\([^)]*division/,
    "løn må ikke skalere med division (#3989) — parameteren findes ikke længere",
  );
});

test("intake-kandidat-navnet linker ALDRIG til rytterprofilen (#3142)", () => {
  // #3142: en 'offered' academy_intake-kandidat er bevidst skjult for den
  // almindelige rytter-DB via RLS (database/2026-06-22-hide-intake-riders-from-db.sql,
  // #1743) — is_offered_intake_rider() gør /riders/:id "rytter ikke fundet" for
  // NETOP denne rytter, uanset hvilket hold der klikker. Et RiderLink her ville
  // derfor altid være en dødsende. Isolér INTAKE-sektionen (mellem sektions-
  // kommentarerne) og assertér at den ikke bruger RiderLink — roster- og
  // graduerings-sektionerne (allerede ejede/signerede ryttere, ikke 'offered')
  // beholder deres RiderLink uændret.
  const start = pageSource.indexOf("INTAKE-sektion");
  assert.ok(start > 0, "kunne ikke finde INTAKE-sektionen i AcademyPage.jsx");
  const end = pageSource.indexOf("ROSTER-sektion", start);
  assert.ok(end > start, "kunne ikke finde slutningen af INTAKE-sektionen");
  const intakeSection = pageSource.slice(start, end);
  assert.doesNotMatch(
    intakeSection,
    /<RiderLink\b/,
    "intake-kandidatkortet må ikke linke til /riders/:id — profilen er RLS-skjult for 'offered'-kandidater og giver altid 'rider not found'",
  );
});

// #4618 (slice 0 af epic #2492) — "Youth squads"-kortet: to rækker (Junior
// team, U23 team), hver med en Coming soon-pille og ét roadmap-link, kun
// synligt når roster-grenen renderer (academy_enabled=true). Isolér den
// slukkede-flag-gren (mellem "Flag slukket" og den efterfølgende T2-kommentar)
// og den aktiverede hoved-retur (fra samme T2-kommentar til filens slutning)
// samme mønster som INTAKE/ROSTER-isolationen ovenfor.
const disabledBranch = (() => {
  const start = pageSource.indexOf("// Flag slukket");
  assert.ok(start > 0, "kunne ikke finde !enabled-grenen (\"Flag slukket\")");
  const end = pageSource.indexOf("// #3454: T1 (max-w-4xl)", start);
  assert.ok(end > start, "kunne ikke finde slutningen af !enabled-grenen");
  return pageSource.slice(start, end);
})();

const enabledBranch = (() => {
  const start = pageSource.indexOf("// #3454: T1 (max-w-4xl)");
  assert.ok(start > 0, "kunne ikke finde den aktiverede hoved-retur");
  return pageSource.slice(start);
})();

test("Youth squads-kortet renderer to Coming soon-piller og et roadmap-link (#4618)", () => {
  assert.match(enabledBranch, /youthSquads\.title/, "Youth squads-kortets titel mangler");
  assert.match(
    enabledBranch,
    /<SectionAction\s+as=\{Link\}\s+to="\/roadmap">\s*\{t\("youthSquads\.roadmap"\)\}/,
    "kortets quiet action skal linke til /roadmap via SectionAction",
  );
  assert.match(enabledBranch, /youthSquads\.junior\.title/, "Junior team-rækkens titel mangler");
  assert.match(enabledBranch, /youthSquads\.junior\.description/, "Junior team-rækkens sætning mangler");
  assert.match(enabledBranch, /youthSquads\.u23\.title/, "U23 team-rækkens titel mangler");
  assert.match(enabledBranch, /youthSquads\.u23\.description/, "U23 team-rækkens sætning mangler");
  // Pillen renderes én gang i JSX'en (mappet over rows = to piller i DOM'en),
  // så kildeteksten skal indeholde netop ét t("youthSquads.comingSoon")-kald.
  const comingSoonCalls = enabledBranch.match(/t\("youthSquads\.comingSoon"\)/g) || [];
  assert.equal(comingSoonCalls.length, 1, "Coming soon-pillen skal renderes via t(\"youthSquads.comingSoon\") i den fælles row-map");
  const rowKeys = enabledBranch.match(/key:\s*"(junior|u23)"/g) || [];
  assert.equal(rowKeys.length, 2, "der skal være netop to rækker (junior, u23), som hver får sin egen Coming soon-pille i DOM'en");
});

test("Youth squads-kortet renderer IKKE i EmptyState-grenen (academy_enabled=false, #4618)", () => {
  assert.doesNotMatch(
    disabledBranch,
    /youthSquads/,
    "Youth squads-kortet må ikke optræde når akademiet er slukket — EmptyState-grenen er urørt",
  );
});

test("Youth squads-kortet har ingen guld-primary-knap (kun quiet action, PAGE_TEMPLATES.md)", () => {
  const cardStart = enabledBranch.indexOf("youthSquads.title");
  const cardEnd = enabledBranch.indexOf("Akademi-regnskab", cardStart);
  assert.ok(cardEnd > cardStart, "kunne ikke afgrænse Youth squads-kortet frem til regnskabs-sektionen");
  const card = enabledBranch.slice(cardStart, cardEnd);
  assert.doesNotMatch(
    card,
    /variant="primary"/,
    "Youth squads-kortet må ikke have en guld-primær knap — kun SectionAction (P3, ét guld-primært element pr. view)",
  );
});
