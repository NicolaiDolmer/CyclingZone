import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Race Engine v3 (#2224) S5 — peak-planner CRUD wiring-guard.
//
// Kilde-scan (samme mønster som boardBankGuard.routes.test.js): låser de
// sikkerheds-kritiske invarianter i routes/api.js så en regression fanges uden en
// live server/supertest-harness. Den ÆGTE DB-kontrakt (kolonner + RLS + insert)
// verificeres separat via execute_sql mod prod (se PR-beskrivelse / NOW.md).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function handlerBlock(marker) {
  const idx = apiSource.indexOf(marker);
  assert.ok(idx !== -1, `${marker} skal findes`);
  // Frem til næste route-registrering (groft handler-omfang).
  const next = apiSource.indexOf("\nrouter.", idx + 1);
  return apiSource.slice(idx, next === -1 ? idx + 4000 : next);
}

const ROUTES = [
  { name: "GET /peak-plans", marker: 'router.get("/peak-plans"' },
  { name: "POST /peak-plans", marker: 'router.post("/peak-plans"' },
  { name: "PATCH /peak-plans/:id", marker: 'router.patch("/peak-plans/:id"' },
  { name: "DELETE /peak-plans/:id", marker: 'router.delete("/peak-plans/:id"' },
];

for (const { name, marker } of ROUTES) {
  test(`${name} er registreret med requireAuth`, () => {
    const block = handlerBlock(marker);
    assert.match(block, /requireAuth/, `${name} skal kræve auth`);
  });
  test(`${name} gates bag peak_planner_enabled (launch-switch)`, () => {
    const block = handlerBlock(marker);
    assert.match(block, /isPeakPlannerEnabled|peakPlannerEnabledFor/, `${name} skal tjekke launch-flaget`);
  });
}

// Writes bruger marketWriteLimiter (rate-limit) — GET er billig/uafgrænset.
for (const { name, marker } of ROUTES.filter((r) => !r.name.startsWith("GET"))) {
  test(`${name} har marketWriteLimiter`, () => {
    assert.match(handlerBlock(marker), /marketWriteLimiter/, `${name} skal rate-limites`);
  });
}

test("POST håndhæver ejerskab (egen rytter) + max-2/duplikat-guard", () => {
  const block = handlerBlock('router.post("/peak-plans"');
  assert.match(block, /not_own_rider/, "POST skal afvise fremmede ryttere");
  assert.match(block, /canCreatePeakPlan/, "POST skal bruge max-2/duplikat-guarden");
});

test("POST afleder vinduet server-side (snap), læser IKKE window fra body", () => {
  const block = handlerBlock('router.post("/peak-plans"');
  assert.match(block, /snapPeakWindow/, "POST skal snappe vinduet server-side");
  // Insert bruger det server-afledte vindue, ikke klient-input.
  assert.match(block, /window_start:\s*window\.window_start/, "insert skal bruge det snappede vindue");
  // Body destruktureres KUN til rider_id + target_race_id (ingen window-felter).
  const bodyLine = block.match(/const \{[^}]*\} = req\.body/)?.[0] ?? "";
  assert.doesNotMatch(bodyLine, /window/, "POST må ALDRIG læse et window-felt fra body");
});

test("POST kræver mål-løb i holdets kalender (division-tilhør)", () => {
  const block = handlerBlock('router.post("/peak-plans"');
  assert.match(block, /loadTargetRaceForPeak/, "POST skal validere mål-løbets kalender-tilhør");
});

test("PATCH + DELETE håndhæver ejerskab + lås-guard (kun redigerbar)", () => {
  for (const marker of ['router.patch("/peak-plans/:id"', 'router.delete("/peak-plans/:id"']) {
    const block = handlerBlock(marker);
    assert.match(block, /loadOwnedPeakPlan/, `${marker} skal verificere ejerskab`);
    assert.match(block, /lockGuardForWrite/, `${marker} skal afvise låste planer`);
    assert.match(block, /"locked"/, `${marker} skal svare 409 locked`);
  }
});

// ── S5 Planner-cockpit: aggregat-board + accept-training (spec §3/§5) ──────────
const COCKPIT_ROUTES = [
  { name: "GET /peak-plans/board", marker: 'router.get("/peak-plans/board"' },
  { name: "POST /peak-plans/:id/accept-training", marker: 'router.post("/peak-plans/:id/accept-training"' },
];

for (const { name, marker } of COCKPIT_ROUTES) {
  test(`${name} er registreret med requireAuth`, () => {
    assert.match(handlerBlock(marker), /requireAuth/, `${name} skal kræve auth`);
  });
  test(`${name} gates bag peak_planner_enabled (launch-switch)`, () => {
    assert.match(handlerBlock(marker), /isPeakPlannerEnabled|peakPlannerEnabledFor/, `${name} skal tjekke launch-flaget`);
  });
}

test("GET /peak-plans/board bruger den motor-konsistente tq-kobling + rival-aggregat", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(block, /resolvePeakTrainingQualities/, "board skal bruge motorens tq-kobling, ikke en ad-hoc beregning");
  assert.match(block, /countRivalPeaks/, "board skal aggregere rival-neutralisering server-side");
});

test("POST accept-training rate-limites + håndhæver ejerskab (egen rytter)", () => {
  const block = handlerBlock('router.post("/peak-plans/:id/accept-training"');
  assert.match(block, /marketWriteLimiter/, "accept-training skal rate-limites");
  assert.match(block, /loadOwnedPeakPlan/, "accept-training skal verificere ejerskab");
});

test("POST accept-training er ikke-destruktivt: kun build/taper-ugen, valideret, til training_week_plans", () => {
  const block = handlerBlock('router.post("/peak-plans/:id/accept-training"');
  assert.match(block, /invalid_week/, "kun 'build'|'taper' må accepteres");
  assert.match(block, /week !== "build" && week !== "taper"/, "ugen skal begrænses til build/taper");
  assert.match(block, /isValidWeekPlanDays/, "de skrevne dage skal valideres mod week-plan-kontrakten");
  assert.match(block, /training_week_plans/, "accept skal skrive den valgte rytme til training_week_plans");
});

test("gate-helperen giver ejer/beta-preview (isViewerBetaTester → isPeakPlannerEnabled)", () => {
  const idx = apiSource.indexOf("async function peakPlannerEnabledFor");
  assert.ok(idx !== -1, "peakPlannerEnabledFor skal findes");
  const block = apiSource.slice(idx, idx + 400);
  assert.match(block, /isViewerBetaTester/, "gaten skal udlede viewerens beta-status (admin/beta-tester)");
  assert.match(block, /isPeakPlannerEnabled\(supabase,\s*\{\s*isBetaTester/, "gaten skal sende isBetaTester til flag-evalueringen (så 'beta'-stage virker)");
});

// ── Assistent-forslag (#2455) ────────────────────────────────────────────────

test("POST /peak-plans/dismiss-suggestions er registreret med requireAuth + gate + rate-limit", () => {
  const block = handlerBlock('router.post("/peak-plans/dismiss-suggestions"');
  assert.match(block, /requireAuth/, "skal kræve auth");
  assert.match(block, /isPeakPlannerEnabled|peakPlannerEnabledFor/, "skal tjekke launch-flaget");
  assert.match(block, /marketWriteLimiter/, "skal rate-limites (samme mønster som øvrige peak-plans-writes)");
});

test("POST /peak-plans/dismiss-suggestions håndhæver ejerskab (egen rytter)", () => {
  const block = handlerBlock('router.post("/peak-plans/dismiss-suggestions"');
  assert.match(block, /not_own_rider/, "skal afvise fremmede ryttere");
});

test("POST /peak-plans/dismiss-suggestions degraderer gracefully hvis #2455-migrationen ikke er anvendt endnu", () => {
  const block = handlerBlock('router.post("/peak-plans/dismiss-suggestions"');
  assert.match(block, /42703/, "skal tåle en manglende peak_suggestions_dismissed_season_id-kolonne (42703) uden 500");
});

test("GET /peak-plans/board genererer assistent-forslag via peakSuggestions-libben, ALDRIG en rider_peak_plans-insert for dem", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(block, /suggestPeaksForRider/, "board skal beregne forslag via den rene peakSuggestions-lib");
  assert.match(block, /isSuggestion:\s*true/, "forslag skal være tydeligt markeret i payloaden");
  assert.doesNotMatch(block, /rider_peak_plans["'`]\)\s*\n?\s*\.insert/, "forslags-generering må ALDRIG skrive til rider_peak_plans");
});

test("GET /peak-plans/board respekterer nulstil-til-blank (dismissedSet) + ekskluderer allerede-mål-satte løb", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(block, /loadPeakSuggestionDismissals/, "board skal tjekke sæson-scoped nulstilling");
  assert.match(block, /dismissedSet\.has\(rd\.id\)/, "dismissede ryttere må ikke få forslag");
  assert.match(block, /realTargetIds/, "forslag må ikke duplikere et allerede-ægte mål-løb");
});

test("loadRegisteredRaceIds chunker race_id-listen — én samlet .in() med hele sæsonen sprængte GET-URL'en (#2516)", () => {
  const idx = apiSource.indexOf("async function loadRegisteredRaceIds");
  assert.ok(idx !== -1, "loadRegisteredRaceIds skal findes");
  const block = apiSource.slice(idx, idx + 2200);
  assert.match(block, /ID_CHUNK/, "race_id-listen skal chunkes (423 sæson-løb i én URL gav undici 'fetch failed', CYCLINGZONE-33)");
  assert.match(block, /raceIds\.slice\(i,\s*i \+ ID_CHUNK\)/, "chunk-loopet skal følge fetchAllStageProfiles-mønstret");
  assert.match(block, /throw new Error\(`race_entries \(peak suggestions\)/, "fejl skal KASTE, ikke trunkere tavst");
});

// ── #3102 PR 2: payback ser ALLE entries (hul 1 fra #3093), forslag kun manuelle ──
test("loadRegisteredRaceIds skiller manual (forslag) fra all (payback/belastning)", () => {
  const idx = apiSource.indexOf("async function loadRegisteredRaceIds");
  const block = apiSource.slice(idx, idx + 2200);
  assert.match(block, /is_auto_filled === false/, "manual-sættet skal fortsat filtrere på is_auto_filled=false (#1835-diskriminatoren for forslag)");
  assert.doesNotMatch(block, /\.eq\("is_auto_filled"/, "queryen må IKKE filtrere auto-fyldte fra server-side — payback skal se dem (hul 1, #3093)");
});

test("GET /peak-plans/board: payback-passet bruger ALLE entries, forslagene kun manuelle (hul 1)", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(block, /raceIdsToCheck = new Set\(allEntriesByRider\.get/, "payback-kollisioner skal regnes over alle entries (auto + manuelle)");
  assert.match(block, /registeredRaceIds:\s*registeredByRider\.get\(rd\.id\)/, "forslags-generatoren skal fortsat bruge det manuelle sæt");
});

test("GET /peak-plans/board eksponerer peakWindow pr. løb + registeredRaceIds pr. rytter (hul 2 + #2772)", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(block, /peakWindow:\s*snapPeakWindow\(/, "racesOut skal sende det færdig-snappede vindue (samme snapPeakWindow som skrive-stien — aldrig to formler)");
  assert.match(block, /rd\.registeredRaceIds = \[\.\.\.\(allEntriesByRider\.get/, "ridersOut skal sende rytterens fulde løbsprogram til dropdown-risiko + belastning");
});

test("race_entries head-counts selecter en reel kolonne — tabellen har ingen id-kolonne (#2516)", () => {
  const badSelects = [...apiSource.matchAll(/from\("race_entries"\)\s*\.select\("id"/g)];
  assert.equal(badSelects.length, 0, "race_entries har composite key (race_id, rider_id, team_id) — select(\"id\") giver 42703 (CYCLINGZONE-34)");
});

// ── #2518: Season Planner sæson-vælger (S1/S2) ──────────────────────────────
// Planner-fladerne skal kunne opløse EN ANDEN sæson end den aktive (fx S2 før
// den starter) via ?season_number=/body.season_number — resolvePlannerSeason
// bevarer bagudkompatibiliteten (default = activePeakSeason, uændret).

test("resolvePlannerSeason falder tilbage til activePeakSeason når intet nummer er angivet", () => {
  const idx = apiSource.indexOf("async function resolvePlannerSeason");
  assert.ok(idx !== -1, "resolvePlannerSeason skal findes");
  const block = apiSource.slice(idx, idx + 700);
  assert.match(block, /activePeakSeason\(\)/, "uden season_number skal aktiv sæson stadig bruges (bagudkompatibelt)");
  assert.match(block, /\.eq\("number",\s*n\)/, "med et gyldigt nummer skal sæsonen slås op via sit spiller-vendte nummer");
});

const SEASON_SELECTABLE_ROUTES = [
  { name: "GET /peak-plans", marker: 'router.get("/peak-plans"' },
  { name: "POST /peak-plans", marker: 'router.post("/peak-plans"' },
  { name: "GET /peak-plans/board", marker: 'router.get("/peak-plans/board"' },
  { name: "POST /peak-plans/dismiss-suggestions", marker: 'router.post("/peak-plans/dismiss-suggestions"' },
];

for (const { name, marker } of SEASON_SELECTABLE_ROUTES) {
  test(`${name} opløser sæson via resolvePlannerSeason (sæson-vælger #2518)`, () => {
    const block = handlerBlock(marker);
    assert.match(block, /resolvePlannerSeason\(/, `${name} skal bruge resolvePlannerSeason i stedet for et hardkodet activePeakSeason()-kald`);
  });
}

test("GET /peak-plans/board + GET /races/calendar eksponerer availableSeasons til UI'ets sæson-vælger", () => {
  const boardBlock = handlerBlock('router.get("/peak-plans/board"');
  assert.match(boardBlock, /availableSeasons/, "board skal returnere listen af oprettede sæsoner");
  // #2600 · sæson 0 (bogførings-sæsonen, number=0) må aldrig tilbydes i spillerens
  // sæson-vælger. Filteret .gt("number", 0) skjuler den; låses her så en fjernelse fejler.
  assert.match(boardBlock, /\.gt\(\s*["']number["']\s*,\s*0\s*\)/, "board skal filtrere sæson 0 ud af spillerens vælger (#2600)");
  const calIdx = apiSource.indexOf('router.get("/races/calendar"');
  assert.ok(calIdx !== -1, "GET /races/calendar skal findes");
  const calBlock = apiSource.slice(calIdx, calIdx + 3500);
  assert.match(calBlock, /availableSeasons/, "kalenderen skal returnere listen af oprettede sæsoner");
  assert.match(calBlock, /\.gt\(\s*["']number["']\s*,\s*0\s*\)/, "kalenderen skal filtrere sæson 0 ud af spillerens vælger (#2600)");
});

// #2883: tre testere rapporterede planneren som "låst til den aktive sæson" 25/7.
// Sæson-vælgeren (#2518) understøtter reelt et vilkårligt sæsonnummer allerede —
// men availableSeasons-queryen manglede fejl-håndtering (eneste query i disse to
// handlere der IKKE kastede ved error). En fejlende query degraderede tavst til
// availableSeasons:[], hvilket skjuler sæson-vælgeren HELT (UI'et renderer den kun
// ved length > 1) — ikke-til-at-skelne fra "låst til aktiv sæson", uden en eneste
// Sentry-linje at debugge ud fra. Låser at BEGGE handlere nu kaster her.
test("GET /peak-plans/board + GET /races/calendar kaster hvis availableSeasons-queryen fejler (#2883)", () => {
  const boardBlock = handlerBlock('router.get("/peak-plans/board"');
  assert.match(
    boardBlock,
    /const \{ data: allSeasonsRows, error: seasonsErr \} = await supabase[\s\S]{0,200}if \(seasonsErr\) throw new Error/,
    "board skal kaste hvis availableSeasons-queryen fejler, ikke tavst degradere til []",
  );
  // #2861 gjorde de tre uafhængige opslag (sæson, sæson-liste, divisioner) parallelle,
  // så destruktureringen sker fra Promise.all-resultatet i stedet for direkte på awaitet.
  // Garantien der låses er uændret: en fejlende availableSeasons-query skal KASTE.
  const calIdx = apiSource.indexOf('router.get("/races/calendar"');
  const calBlock = apiSource.slice(calIdx, calIdx + 3500);
  assert.match(
    calBlock,
    /const \{ data: allSeasonsRows, error: allSeasonsErr \} = [\s\S]{0,200}if \(allSeasonsErr\) throw new Error/,
    "kalenderen skal kaste hvis availableSeasons-queryen fejler, ikke tavst degradere til []",
  );
});

// ── #3018 · planlæggeren må ikke vise den GAMLE divisions kalender ────────────
// thelamba 26/7: S2-planlæggeren viste D3's kalender til et hold på vej op i D2.
// Rod-årsag: boardet sendte holdets NUVÆRENDE league_division_id ind i
// buildCalendarModel uanset hvilken sæson der blev spurgt om, og isMine matchede
// derfor den gamle division. Målt mod prod samme dag: 140 af 156 ægte
// managerhold lander i en anden pulje i S2.

test("GET /peak-plans/board bruger den SÆSON-opløste division, ikke holdets nuværende", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(
    block,
    /teamDivisionId: seasonDivisionId/,
    "boardet må ikke sende req.team.league_division_id direkte ind i buildCalendarModel",
  );
  assert.doesNotMatch(
    block,
    /teamDivisionId: req\.team\.league_division_id/,
    "den gamle 'altid nuværende division'-adfærd er præcis fejlen i #3018",
  );
  assert.match(block, /resolveTeamDivisionForSeason\(/, "divisionen skal opløses pr. sæson");
});

test("GET /peak-plans/board eksponerer divisionPending til UI'et", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(block, /divisionPending: !divisionSettled/, "UI'et skal kunne vise den ærlige 'din division afgøres ved sæsonskiftet'-tilstand");
});

test("GET /peak-plans/board laver ingen assistent-forslag når divisionen ikke er afgjort", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(
    block,
    /divisionSettled \? ridersOut\.filter/,
    "forslag vælger blandt isMine-løb og ville ellers pege på den gamle division",
  );
});

// Den tre-vejs-regel hele fixet hviler på. Retningen for 'completed' er den #2908
// fastslog for sæsonsiden: en afsluttet sæson hører til den division holdet
// FAKTISK kørte i, ikke den det er havnet i efter sæsonskiftet.
test("resolveTeamDivisionForSeason skelner upcoming / active / completed", () => {
  const idx = apiSource.indexOf("async function resolveTeamDivisionForSeason");
  assert.ok(idx !== -1, "resolveTeamDivisionForSeason skal findes");
  const block = apiSource.slice(idx, idx + 1200);
  assert.match(block, /teamDivisionKnownForSeason\(season\?\.status\)/, "upcoming → pending");
  assert.match(block, /pending: true/, "upcoming skal signalere pending, ikke gætte en division");
  assert.match(block, /season\?\.status === "active"/, "aktiv sæson → holdets nuværende division");
  assert.match(block, /from\("season_standings"\)/, "afsluttet sæson → den division holdet faktisk kørte i");
  assert.match(block, /\.eq\("season_id", season\.id\)/, "standings-opslaget skal scopes til den valgte sæson");
});

test("loadTargetRaceForPeak afviser writes mod en sæson uden afgjort division", () => {
  const idx = apiSource.indexOf("async function loadTargetRaceForPeak");
  assert.ok(idx !== -1, "loadTargetRaceForPeak skal findes");
  const block = apiSource.slice(idx, idx + 2000);
  assert.match(block, /resolveTeamDivisionForSeason\(/, "skrive-stien skal bruge SAMME resolver som boardet");
  assert.match(block, /division_not_settled/, "afvisningen skal have sin egen fejlkode, så UI'et kan forklare hvorfor");
  // Guarden SKAL ligge før den almindelige division-sammenligning, ellers ville et
  // løb i den gamle division stadig slippe igennem som gyldigt mål.
  assert.ok(
    block.indexOf("division_not_settled") < block.indexOf("race_not_in_calendar"),
    "division_not_settled skal evalueres FØR race_not_in_calendar",
  );
});

test("peak-CRUD sender hele holdet til loadTargetRaceForPeak (ikke kun nuværende division)", () => {
  for (const marker of ['router.post("/peak-plans"', 'router.patch("/peak-plans/:id"']) {
    const block = handlerBlock(marker);
    assert.match(block, /loadTargetRaceForPeak\([^)]*req\.team\)/, `${marker} skal give resolveren holdet, så divisionen kan opløses pr. sæson`);
    assert.doesNotMatch(block, /loadTargetRaceForPeak\([^)]*league_division_id/, `${marker} må ikke låse guarden til den nuværende division`);
  }
});

test("resolvePlannerSeason henter status med, så division-gaten kan afgøres", () => {
  const idx = apiSource.indexOf("async function resolvePlannerSeason");
  const block = apiSource.slice(idx, idx + 700);
  assert.match(block, /select\("id, number, status, start_date"\)/, "status skal med i sæson-opslaget");
});
