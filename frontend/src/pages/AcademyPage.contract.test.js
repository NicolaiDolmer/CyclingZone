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

test("/academy/me's backend-select bærer rytterfelterne (#2796)", () => {
  // #6155: akademisidens egen rytterliste er væk, men /academy/me sender stadig
  // rosteret (useAcademy deles med rytterprofilens "Move squad"), så felterne
  // skal fortsat være med.
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
  // tilbuddet udløber efter intakeOfferExpiryDaysFor(source) (#5844).
  assert.match(academyMeBlock, /signingFee/, "/academy/me sender ikke signingFee");
  assert.match(academyMeBlock, /expiresAt/, "/academy/me sender ikke expiresAt");
  assert.match(
    academyMeBlock,
    /intakeOfferExpiryDaysFor\(/,
    "udløbsdatoen skal udledes af intakeOfferExpiryDaysFor (SSOT i academyIntakeSource.js: 7 dage, bestyrelsens gave 14, #5844), ikke af et hardkodet tal",
  );
  assert.match(
    academyMeBlock,
    /ACADEMY\.SIGNING_FEE_RATE/,
    "signeringsprisen skal bruge ACADEMY.SIGNING_FEE_RATE — samme sats som selve debiteringen",
  );
});

test("#6155: intet akademihold, akademisiden peger på U23- og Juniorsiden med antal/plads", () => {
  // Ejer 4/10 + 9/11 (#7932): en rytter hører kun til senior, U23 eller junior.
  // Akademiets egen rytterliste (DataTable + Promovér/Fyr) er fjernet; flyt og
  // fyring sker på rytterprofilen som for alle andre ryttere.
  for (const gone of [/\bDataTable\b/, /useTableSort/, /rosterColumns/, /rosterPotentialSort/, /rosterHeading/,
    /emptyRoster/, /AcademyTransferConfirmModal/, /AcademyReleaseConfirmModal/, /AcademyPrognosisCell/]) {
    assert.doesNotMatch(pageSource, gone, `${gone} hører til den fjernede rytterliste`);
  }
  assert.match(pageSource, /u23: "\/squads\/u23", junior: "\/squads\/junior"/, "links til de to trupsider");
  assert.match(pageSource, /squadRows\.map\(\(row\) => \(\s*<Link/, "én link-række pr. ungdomstrup fra squadCapRows");
  assert.match(pageSource, /t\("squadLinks\.count", \{ used: row\.used, max: row\.max \}\)/, "antal/plads pr. trup");
  assert.match(pageSource, /\{youthSquadPagesOn && \(\s*<Section data-testid="academy-squad-links">/, "links kun når trupsiderne findes");
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

test("#6155: fuld juniortrup spærrer ikke, når U23 har plads; kortet siger hvor han kommer hen", () => {
  assert.match(pageSource, /const landing = academyLandingSquad\(targetSquad, ageForSeason\(rider\.birthdate, seasonYear\), squadCounts\);/);
  assert.match(pageSource, /const isFull = landing\.full;/, "spærringen afgøres af ALLE mulige trupper, ikke kun aldersplaceringen");
  assert.match(pageSource, /landing\.movedToU23 && \(\s*<p[^>]*data-testid="intake-lands-u23">\{t\("landsOnU23"\)\}/);
  assert.match(pageSource, /blockedBoth \? t\("fullNoteBoth"\)/);
});

test("intake-kandidat-navnet linker ALDRIG til rytterprofilen (#3142)", () => {
  // #3142: en 'offered' academy_intake-kandidat er bevidst skjult for den
  // almindelige rytter-DB via RLS (database/2026-06-22-hide-intake-riders-from-db.sql,
  // #1743) — is_offered_intake_rider() gør /riders/:id "rytter ikke fundet" for
  // NETOP denne rytter, uanset hvilket hold der klikker. Et RiderLink her ville
  // derfor altid være en dødsende. Isolér INTAKE-sektionen (mellem sektions-
  // kommentarerne) og assertér at den ikke bruger RiderLink.
  const start = pageSource.indexOf("INTAKE-sektion");
  assert.ok(start > 0, "kunne ikke finde INTAKE-sektionen i AcademyPage.jsx");
  const end = pageSource.indexOf("UNGDOMSTRUP-links", start);
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
// samme mønster som INTAKE-isolationen ovenfor.
const disabledBranch = (() => {
  const start = pageSource.indexOf("// Flag slukket");
  assert.ok(start > 0, "kunne ikke finde !enabled-grenen (\"Flag slukket\")");
  const end = pageSource.indexOf("// #3454: T2", start);
  assert.ok(end > start, "kunne ikke finde slutningen af !enabled-grenen");
  return pageSource.slice(start, end);
})();

const enabledBranch = (() => {
  const start = pageSource.indexOf("// #3454: T2");
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

// #5844 (ejer 28/9): potentiale vises som TAL i akademiet, aldrig som stjerner.
test("akademi-siden viser aldrig stjerner på intake-kort (#5844)", () => {
  assert.doesNotMatch(pageSource, /PotentialeStars/, "AcademyPage må ikke importere/rendere PotentialeStars");
  assert.match(pageSource, /potentialPending/, "manglende bånd skal vise en tekst, ikke et stjerne-fallback");
});

test("hent-knappen vises uanset åbne tilbud, og 'provisional value' kun på pull-kandidater (#6155)", () => {
  const cardIdx = pageSource.indexOf('t("intakePull.pullBtn")');
  assert.ok(cardIdx > 0, "hent-knappen findes");
  const before = pageSource.slice(Math.max(0, cardIdx - 900), cardIdx);
  assert.match(before, /intakePull\.enabled && !intakePull\.pulledThisWeek && \(/);
  assert.doesNotMatch(before, /regularIntake\.length === 0 && intakePull\.enabled && !intakePull\.pulledThisWeek \?/);
  assert.match(pageSource, /isPull \? t\("intakePull\.provisionalValue"\) : t\("colValue"\)/);
  assert.match(pageSource, /isPull && \(\s*<p[^>]*>\{t\("intakePull\.valuationNote"\)\}/);
});

// #6666 Optag 2.0 (ejer-beslutninger 15/10).
const localesDir = join(__dirname, "..", "..", "public", "locales");
const academyLocale = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "academy.json"), "utf8"));

test("hent-knappen siger aldrig 'scout' (#6666 punkt 3)", () => {
  assert.equal(academyLocale("en").intakePull.pullBtn, "Bring in this week's intake");
  assert.equal(academyLocale("da").intakePull.pullBtn, "Hent ugens kandidater");
  for (const lng of ["en", "da"]) {
    const pull = JSON.stringify(academyLocale(lng).intakePull);
    assert.doesNotMatch(pull, /scout/i, `${lng}: intakePull-teksterne må ikke love scouting`);
  }
});

test("hentede kandidater viser 'Learned through training and racing', og backend maskerer båndet (#6666 punkt 1)", () => {
  assert.match(pageSource, /item\.potentialLearned && \(/);
  assert.match(pageSource, /t\("potentialLearned"\)/);
  assert.equal(academyLocale("en").potentialLearned, "Learned through training and racing");
  // Maskeringen sker i backend, bag samme flag som pull-optaget.
  assert.match(academyMeBlock, /intakePullEnabled\s*\?\s*await buildIntake2View\(/);
  assert.match(academyMeBlock, /intake: intake2\?\.intake \?\? intake/);
});

test("hentede kandidater viser nuværende evner, som SSOT og copy lover (#6666 punkt 1, Codex-fund)", () => {
  // Copy'en lover "age, nationality, type and current abilities"; kortet skal holde det.
  assert.match(academyLocale("en").intakePull.description, /current abilities/);
  assert.match(pageSource, /const abilitiesNow = isPull \? pullCandidateAbilities\(item\) : null;/);
  assert.match(pageSource, /data-testid="intake-abilities-now"/);
  assert.match(pageSource, /t\("intakePull\.abilitiesNow"\)/);
  assert.equal(academyLocale("en").intakePull.abilitiesNow, "Abilities now");
  assert.equal(academyLocale("da").intakePull.abilitiesNow, "Evner nu");
  // Tabulære tal på al numerik (TASTE).
  assert.match(pageSource, /font-data text-3xs tabular-nums/);
});

test("#6155: teksterne antyder ingen akademitrup; EN og DA har samme nye nøgler, ingen em-dash", () => {
  const en = academyLocale("en");
  const da = academyLocale("da");
  for (const [lng, json] of [["en", en], ["da", da]]) {
    for (const key of ["rosterHeading", "emptyRoster", "emptyRosterTitle"]) {
      assert.equal(json[key], undefined, `${lng}: ${key} hører til den fjernede rytterliste`);
    }
    for (const text of [json.subtitle, json.pnl.subtitle, json.pnl.currentHeading, json.pnl.currentCaption, json.landsOnU23,
      json.fullNoteBoth, json.fullTooltipBoth, ...Object.values(json.squadLinks)]) {
      assert.equal(typeof text, "string", `${lng}: en ny tekst mangler`);
      assert.doesNotMatch(text, /—/, `${lng}: ingen em-dash ("${text}")`);
      assert.doesNotMatch(text, /academy roster|akademihold|in your academy|i akademiet|\bloft\b/i, `${lng}: "${text}" antyder en akademitrup`);
    }
  }
  assert.deepEqual(Object.keys(en.squadLinks), Object.keys(da.squadLinks));
});

test("profil-kortet vises kun med Optag 2.0 og har ingen guld-knap (#6666 punkt 4-5)", () => {
  assert.match(pageSource, /intakePull\.enabled && academyProfile && \(/);
  const card = readFileSync(join(__dirname, "..", "components", "AcademyProfileCard.tsx"), "utf8");
  assert.doesNotMatch(card, /variant="primary"/, "sidens eneste guld er hent-knappen (TASTE: ét guld pr. view)");
  assert.match(apiSource, /router\.put\("\/academy\/profile"/);
});
