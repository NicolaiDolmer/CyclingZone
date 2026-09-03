// #4123 — kalender-invarianterne som CI-gate.
//
// Genererer S3-kalenderen OFFLINE via samme mekanik som scripts/dev/calendarDryRunLocal.mjs
// / scripts/dev/calendarScorecard4218.mjs (den rene buildTierMaterializationPlan mod
// lib/__fixtures__/racePoolCatalog.prod.json, delt via
// scripts/dev/lib/s3OfflineCalendarPlan.mjs) og asserterer på det der de facto ville blive
// skrevet, ikke en syntetisk konstruktion. Fixturen er genopfrisket fra prod 3/9 (#4203) og
// bærer nu selv de 22 løb fra 2026-08-25-4218-katalog-22-nye-loeb.sql; den in-memory
// katalog-udvidelse der før kompenserede for et forældet snapshot er derfor fjernet.
//
// SCOPE (issuets egen afgrænsning): KUN de objektivt afgjorte invarianter. De fire
// bånd-invarianter (enkeltstart-andel, brosten-andel, høj-bjerg-monotoni, klasse↔etapebånd
// for Class1/Class2) er EJER-UBESLUTTEDE balance-valg (docs/CALENDAR_RULES.md §11 punkt
// 2/3/6, #4220/#4103) og står nedenfor som `test.skip` med henvisning, IKKE som en gættet
// påstand.
//
// VAGT-REGEL. Testene her er kørt mod main's nuværende tilstand FØR de blev erklæret
// klar (se PR-body for tallene). Havde en af dem fældet main, ville den IKKE være rettet
// ind i kalenderen her — den ville stå som advisory/skip med issue-ref, jf. hard rule i
// spawn-prompten. Alle nedenstående var grønne.
//
// Refs #4123 #4218 #4121 #4215

import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { buildS3OfflineCalendarPlan, FIXTURE_PATH } from "../scripts/dev/lib/s3OfflineCalendarPlan.mjs";
import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";
import { computeTierCoverageStats } from "./tierCalendarGuarantees.js";
import { detectEmptyCalendarDays } from "./calendarDailyCoverage.js";
import { MAX_GT_STAGES_PER_DAY, MAX_GT_SPAN_DAYS } from "./raceCalendarLanePacker.js";
import { GRAND_TOUR_MIN_STAGES } from "./grandTourRestDays.js";

// Bygget ÉN gang og delt af alle tests i filen — samme deterministiske plan, ingen DB,
// intet ur. Node-testrunneren isolerer filer i egne workers, så global state her er
// ufarlig og undgår at generere kalenderen 12 gange for 12 assertions.
let PLAN;
test.before(() => { PLAN = buildS3OfflineCalendarPlan(); });

function tier(t) {
  return PLAN.tierPlans.find((p) => p.tier === t);
}
function pool1() {
  return tier(1).pools[0];
}
function raceMetaByTier(t) {
  const pool = tier(t).pools[0];
  return new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));
}
function stagesByRace(pool) {
  const byRace = new Map();
  for (const s of pool.stageRows ?? []) {
    if (!byRace.has(s.pool_race_id)) byRace.set(s.pool_race_id, []);
    byRace.get(s.pool_race_id).push(s);
  }
  return byRace;
}

test("#4123: fixture-kataloget har ingen dublet-navne", () => {
  // Foer 3/9 vogtede denne test at den IN-MEMORY katalog-udvidelse ikke kolliderede med
  // fixturen. Udvidelsen er vaek (fixturen ER prods katalog), saa vagten flyttes hen paa
  // det den reelt beskytter: at en fixture-refresh ikke smugler dubletter ind. To loeb med
  // samme navn giver to raekker der ikke kan skelnes i UI, i resultater eller i selektionen.
  assert.deepEqual(PLAN.kollisioner, [], "offline-planen maa ikke rapportere kollisioner");

  const { catalog } = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const set = new Set();
  const dubletter = [];
  for (const r of catalog) {
    if (set.has(r.name)) dubletter.push(r.name);
    set.add(r.name);
  }
  assert.deepEqual(dubletter, [], `dublet-navne i racePoolCatalog.prod.json: ${dubletter.join(", ")}`);
});

// ── De fire allerede-håndhævede GT/kronologi-invarianter (issuets [x]-liste) ──────

test("#4123: to Grand Tours deler ALDRIG en kalenderdag", () => {
  const meta = raceMetaByTier(1);
  const byRace = stagesByRace(pool1());
  const gtPerDag = new Map();
  for (const [id, ss] of byRace) {
    const r = meta.get(id);
    if (!r || r.race_type !== "stage_race" || (r.stages ?? 0) < GRAND_TOUR_MIN_STAGES) continue;
    for (const s of ss) {
      const d = String(s.scheduled_at).slice(0, 10);
      if (!gtPerDag.has(d)) gtPerDag.set(d, new Set());
      gtPerDag.get(d).add(r.name);
    }
  }
  const delte = [...gtPerDag.entries()].filter(([, navne]) => navne.size > 1);
  assert.deepEqual(delte, [], `delte GT-dage: ${JSON.stringify(delte)}`);
});

test("#4123: ingen kalenderdag bærer flere end MAX_GT_STAGES_PER_DAY GT-etaper", () => {
  const meta = raceMetaByTier(1);
  const perDag = new Map();
  for (const s of pool1().stageRows ?? []) {
    const r = meta.get(s.pool_race_id);
    if (!r || r.race_type !== "stage_race" || (r.stages ?? 0) < GRAND_TOUR_MIN_STAGES) continue;
    const d = String(s.scheduled_at).slice(0, 10);
    perDag.set(d, (perDag.get(d) ?? 0) + 1);
  }
  const over = [...perDag.entries()].filter(([, n]) => n > MAX_GT_STAGES_PER_DAY);
  assert.deepEqual(over, [], `dage over loftet: ${JSON.stringify(over)}`);
});

test("#4123: hver Grand Tour køres i højst MAX_GT_SPAN_DAYS kalenderdage", () => {
  const meta = raceMetaByTier(1);
  const byRace = stagesByRace(pool1());
  for (const [id, ss] of byRace) {
    const r = meta.get(id);
    if (!r || r.race_type !== "stage_race" || (r.stages ?? 0) < GRAND_TOUR_MIN_STAGES) continue;
    const dage = new Set(ss.map((s) => String(s.scheduled_at).slice(0, 10)));
    assert.ok(dage.size <= MAX_GT_SPAN_DAYS, `${r.name}: ${dage.size} dage, loft ${MAX_GT_SPAN_DAYS}`);
  }
});

test("#4123: hvert løbs etaper er kronologiske (ingen etape før sin forgænger)", () => {
  const brud = [];
  for (const plan of PLAN.tierPlans) {
    const pool = plan.pools[0];
    const byRace = stagesByRace(pool);
    const meta = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));
    for (const [id, ss] of byRace) {
      const sorted = ss.slice().sort((a, b) => a.stage_number - b.stage_number);
      for (let i = 1; i < sorted.length; i++) {
        if (String(sorted[i].scheduled_at) < String(sorted[i - 1].scheduled_at)) {
          brud.push(`tier ${plan.tier} ${meta.get(id)?.name ?? id}: etape ${sorted[i].stage_number} før ${sorted[i - 1].stage_number}`);
        }
      }
    }
  }
  assert.deepEqual(brud, []);
});

// ── Nye, objektivt afgjorte invarianter ────────────────────────────────────────────

test("#4123: monumenterne er sæsonens LÆNGSTE endagsløb (D1, jf. CLASS_DISTANCE_BANDS.Monuments)", () => {
  // Monuments-klassen er kun tilladt i tier 1 (#2251-whitelist). Ejer-direktiv 21/8
  // (#4104): "monumenter skal være lange ruter som i virkeligheden" — CLASS_DISTANCE_BANDS
  // giver dem båndet [250,290] km, strengt over ethvert andet endagsløbs terrænbånd i
  // samme pulje (raceRouteGenerator.js's DISTANCE_BANDS topper på 260 for `classic`, som
  // kun D1's cobbled_classic-arketype IKKE bruger — se distancemåling nedenfor).
  const pool = pool1();
  const externalIdByPoolRace = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r.external_id ?? null]));

  let monumentMin = Infinity;
  let andreMax = -Infinity;
  for (const r of pool.raceRows ?? []) {
    if (r.race_type === "stage_race") continue; // kun endagsløb er relevante for "længste endagsløb"
    const profiles = generateRaceStageProfiles({
      id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
      external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
      terrain_archetype: r.terrain_archetype ?? null,
      race_class: r.race_class ?? null,
      season_id: "00000000-0000-0000-0000-000000000003", season_variant: 0,
    });
    const distance = profiles[0]?.distance_km;
    assert.ok(Number.isFinite(distance), `${r.name}: mangler distance_km`);
    if (r.race_class === "Monuments") monumentMin = Math.min(monumentMin, distance);
    else andreMax = Math.max(andreMax, distance);
  }

  assert.ok(Number.isFinite(monumentMin), "fixturen skal have mindst ét monument i tier 1");
  assert.ok(
    monumentMin > andreMax,
    `korteste monument (${monumentMin} km) skal være længere end det længste andet endagsløb (${andreMax} km)`,
  );
});

test("#4123: klasse↔etapeantal er koblet for de BESLUTTEDE klasser (ProSeries + OtherWorldTour A/B/C, #3328)", () => {
  // CLASS_STAGE_LENGTH_BAND dækker kun de fire besluttede klasser (tierCalendarGuarantees.js).
  // Class1/Class2 er BEVIDST udenfor båndet her (§11 punkt 2 — ikke besluttet, se skip nedenfor).
  const brud = [];
  for (const plan of PLAN.tierPlans) {
    const pool = plan.pools[0];
    const externalIdByPoolRace = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r.external_id ?? null]));
    const profilesByPoolRaceId = new Map();
    for (const r of pool.raceRows ?? []) {
      profilesByPoolRaceId.set(r.pool_race_id, generateRaceStageProfiles({
        id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
        external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
        terrain_archetype: r.terrain_archetype ?? null,
        race_class: r.race_class ?? null,
        season_id: "00000000-0000-0000-0000-000000000003", season_variant: 0,
      }));
    }
    const coverage = computeTierCoverageStats({ raceRows: pool.raceRows ?? [], profilesByPoolRaceId });
    for (const v of coverage.classBandViolations) brud.push(`tier ${plan.tier}: ${v}`);
  }
  assert.deepEqual(brud, []);
});

test("#4123: ingen etape og intet endagsløb tabes ud af pakkeren (0 uplacerede)", () => {
  const brud = [];
  for (const plan of PLAN.tierPlans) {
    if ((plan.unplaced ?? []).length) brud.push(`tier ${plan.tier}: ${plan.unplaced.length} uplacerede etapeløb`);
    if ((plan.leftoverSingles ?? []).length) brud.push(`tier ${plan.tier}: ${plan.leftoverSingles.length} uplacerede endagsløb`);
  }
  assert.deepEqual(brud, []);
});

test("#4123: løb hver kalenderdag i alle divisioner (ejer-direktiv 25/8, #4218)", () => {
  const stageDays = [];
  for (const plan of PLAN.tierPlans) {
    for (const s of plan.pools[0].stageRows ?? []) {
      stageDays.push({ division: plan.tier, date: String(s.scheduled_at).slice(0, 10) });
    }
  }
  const dækning = detectEmptyCalendarDays({
    stageDays, from: PLAN.firstDay, to: PLAN.lastDay, divisions: PLAN.tierPlans.map((p) => p.tier),
  });
  assert.ok(dækning.ok, `tomme kalenderdage: ${JSON.stringify(dækning.violations)}`);
});

test("#4123/§1b: kvoten rammes EKSAKT i alle fire divisioner (ejer 3/9, #4270)", () => {
  // §1b, ejer-beslutning 3/9: eksakt 100 % pr. division - hverken 99 eller 101. Kvoten ER
  // det antal løbsdage divisionens tidsplan har.
  //
  // Testen kunne først skrives 3/9. Før da leverede D3 84 af 93 i det gamle 31-dages
  // vindue, og gulvet for kvote-opfyldelse var ejer-ubesluttet (§11 punkt 4), så CI måtte
  // nøjes med et regressions-gulv. Med S4's 28-dages vindue rammer alle fire præcist —
  // og §5b's forsyningsgrænse er dermed synlig som en EGENSKAB VED VINDUET, ikke som en
  // permanent undtagelse: D4's klasse-vindue rummer 96 etaper, så 84 går op og 93 gør ikke.
  for (const t of [1, 2, 3, 4]) {
    const antal = tier(t).pools[0].stageRows.length;
    assert.equal(antal, PLAN.quotas[t], `tier ${t}: ${antal} etaper, kvote ${PLAN.quotas[t]} — se docs/CALENDAR_RULES.md §1b`);
  }
});
test("SKIPPET — brosten-andel pr. division inden for bånd", { skip: "afventer ejer-beslutning, se #4123/#4220/#4103 (docs/CALENDAR_RULES.md §11)" }, () => {});
test("SKIPPET — høj-bjerg-andel er ikke-faldende gennem pyramiden", { skip: "afventer ejer-beslutning, se #4123/#4220/#4103 (docs/CALENDAR_RULES.md §11)" }, () => {});
test("SKIPPET — klasse↔etapebånd for Class1/Class2", { skip: "afventer ejer-beslutning, se #4123/#4220 (docs/CALENDAR_RULES.md §11 punkt 2)" }, () => {});
