// #4103 — GT-dagsform, testet mod det AEGTE katalog.
//
// Fixturen (lib/__fixtures__/racePoolCatalog.prod.json) er et read-only snapshot af
// prods race_pool + divisioner. Testene koerer den SAMME rene funktion og de SAMME
// parametre som scripts/dev/regenSeason3Calendar.mjs' dry-run, saa det de haevder
// gaelder den kalender der faktisk bliver skrevet - ikke en syntetisk konstruktion.
//
// Ejer-krav (aftalt med @thelamba i #feedback-and-ideas 22/8 20:27, bekraeftet af
// ejeren i traaden): "Agree on no days with 5 gt stages" + "6 sounds like a decent max".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "./calendarStartDate.js";
import { MAX_GT_STAGES_PER_DAY, MAX_GT_SPAN_DAYS } from "./raceCalendarLanePacker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");
const GT_MIN_STAGES = 15;

// Fast fixture-dato + fast `now`. resolveCalendarFrom afviser en foerste loebsdag der
// ikke er strengt i fremtiden (27/6-blitz-guarden), og laeste testen systemuret, ville
// den derfor begynde at fejle praecis paa dagen 2026-08-25 — hvilket den gjorde 25/8.
// `now` injiceres, saa testen er tidsuafhaengig OG deterministisk. Datoen er en ren
// fixture: disse tests haevder noget om GT-dagsform, ikke om saesonens rigtige startdato
// (den er 28/8, se docs/CALENDAR_RULES.md §2).
const FIXTURE_FIRST_RACE_DAY = "2026-08-25";
const FIXTURE_NOW = new Date("2026-08-01T12:00:00Z");

function planlaeg() {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: FIXTURE_FIRST_RACE_DAY, now: FIXTURE_NOW });
  return buildTierMaterializationPlan({ pools, catalog, from, baseSeed: 1 }).tierPlans;
}

// Dag-for-dag GT-optaelling for een tier (een pulje er repraesentativ, #2276).
function gtPerDag(plan) {
  const pool = (plan.pools ?? [])[0] ?? { raceRows: [], stageRows: [] };
  const byPoolRace = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));
  const dage = new Map(); // dato -> Map(gt-navn -> antal)
  for (const s of pool.stageRows ?? []) {
    const r = byPoolRace.get(s.pool_race_id);
    if (!r || r.race_type !== "stage_race" || (r.stages ?? 0) < GT_MIN_STAGES) continue;
    const d = String(s.scheduled_at).slice(0, 10);
    if (!dage.has(d)) dage.set(d, new Map());
    dage.get(d).set(r.name, (dage.get(d).get(r.name) ?? 0) + 1);
  }
  return dage;
}

const D1 = () => planlaeg().find((p) => p.tier === 1);

test("#4103: ingen kalenderdag baerer flere end MAX_GT_STAGES_PER_DAY GT-etaper", () => {
  const over = [];
  for (const [dag, m] of gtPerDag(D1())) {
    let n = 0; for (const c of m.values()) n += c;
    if (n > MAX_GT_STAGES_PER_DAY) over.push({ dag, n });
  }
  assert.deepEqual(over, [], `dage over loftet paa ${MAX_GT_STAGES_PER_DAY}: ${JSON.stringify(over)}`);
});

test("#4103: hver Grand Tour koeres i et vindue paa hoejst MAX_GT_SPAN_DAYS dage", () => {
  const dage = gtPerDag(D1());
  const spanByGt = new Map();
  for (const [dag, m] of dage) for (const navn of m.keys()) {
    if (!spanByGt.has(navn)) spanByGt.set(navn, new Set());
    spanByGt.get(navn).add(dag);
  }
  const forBrede = [...spanByGt.entries()]
    .map(([navn, set]) => ({ navn, dage: set.size }))
    .filter((x) => x.dage > MAX_GT_SPAN_DAYS);
  assert.deepEqual(forBrede, [], `GT'er over ${MAX_GT_SPAN_DAYS} dage: ${JSON.stringify(forBrede)}`);
});

test("#4103: to GT'er deler ALDRIG en kalenderdag (#3472 v3's haarde invariant)", () => {
  const delte = [];
  for (const [dag, m] of gtPerDag(D1())) if (m.size > 1) delte.push({ dag, gts: [...m.keys()] });
  assert.deepEqual(delte, [], `delte GT-dage: ${JSON.stringify(delte)}`);
  assert.equal((D1().gtRealDaySeparationViolations ?? []).length, 0);
});

test("#4103: kvoten er uroert — D1 har fortsat 140 etaper over 28 dage", () => {
  const pool = D1().pools[0];
  assert.equal(pool.stageRows.length, 140);
  const dage = new Set(pool.stageRows.map((s) => String(s.scheduled_at).slice(0, 10)));
  assert.equal(dage.size, 28);
});

test("#4103: hvert loebs etaper er fortsat kronologiske (ingen etape koeres foer sin forgaenger)", () => {
  for (const plan of planlaeg()) {
    const pool = (plan.pools ?? [])[0];
    if (!pool) continue;
    const byRace = new Map();
    for (const s of pool.stageRows) {
      if (!byRace.has(s.pool_race_id)) byRace.set(s.pool_race_id, []);
      byRace.get(s.pool_race_id).push(s);
    }
    for (const [id, liste] of byRace) {
      liste.sort((a, b) => a.stage_number - b.stage_number);
      for (let i = 1; i < liste.length; i++) {
        assert.ok(
          String(liste[i].scheduled_at) >= String(liste[i - 1].scheduled_at),
          `tier ${plan.tier}, loeb ${id}: etape ${liste[i].stage_number} koeres foer etape ${liste[i - 1].stage_number}`,
        );
      }
    }
  }
});

test("#4103: determinisme — to koersler giver identisk dagsfordeling", () => {
  const a = JSON.stringify([...gtPerDag(D1())].map(([d, m]) => [d, [...m]]));
  const b = JSON.stringify([...gtPerDag(D1())].map(([d, m]) => [d, [...m]]));
  assert.equal(a, b);
});
