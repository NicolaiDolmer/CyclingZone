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

test("loadManualRegisteredRaceIds chunker race_id-listen — én samlet .in() med hele sæsonen sprængte GET-URL'en (#2516)", () => {
  const idx = apiSource.indexOf("async function loadManualRegisteredRaceIds");
  assert.ok(idx !== -1, "loadManualRegisteredRaceIds skal findes");
  const block = apiSource.slice(idx, idx + 1600);
  assert.match(block, /ID_CHUNK/, "race_id-listen skal chunkes (423 sæson-løb i én URL gav undici 'fetch failed', CYCLINGZONE-33)");
  assert.match(block, /raceIds\.slice\(i,\s*i \+ ID_CHUNK\)/, "chunk-loopet skal følge fetchAllStageProfiles-mønstret");
  assert.match(block, /throw new Error\(`race_entries \(peak suggestions\)/, "fejl skal KASTE, ikke trunkere tavst");
});

test("race_entries head-counts selecter en reel kolonne — tabellen har ingen id-kolonne (#2516)", () => {
  const badSelects = [...apiSource.matchAll(/from\("race_entries"\)\s*\.select\("id"/g)];
  assert.equal(badSelects.length, 0, "race_entries har composite key (race_id, rider_id, team_id) — select(\"id\") giver 42703 (CYCLINGZONE-34)");
});
