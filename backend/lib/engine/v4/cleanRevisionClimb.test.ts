// backend/lib/engine/v4/cleanRevisionClimb.test.ts
// Ren motor-revision spor 1 (#6200, ejer-design 10/10, D1): paa en bjergetape
// med nedkoerselsfinale vinder den bedste klatrer 5-8 af 12 loeb, og nr. 10
// ligger 60-150 s efter vinderen og varierer fra loeb til loeb.
//
// Feltet er det anonymiserede Giro-felt (backend/scripts/baselines), etape 7
// (bjerg, nedkoersel mod maal), koert med hele klassementet fra etape 1-6 som i
// spillet (tourScorecard.runStagesInOrder) under official_times_v3. Maalingen af
// "bedste klatrer" og nr. 10 er den samme som i descentFinish6200.mjs.
// official_times_v2 og aeldre er byte-identiske (officialTimesV2Frozen6200.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../raceEngineV4Bridge.js";
import { breakawayWin, runStagesInOrder as runStagesInOrderJs, sortedStages } from "../../../scripts/dev/lib/tourScorecard.mjs";
import { analyseDescentFinish as analyseDescentFinishJs } from "../../../scripts/dev/descentFinish6200.mjs";

// JS-hjaelperne (scripts/dev) har ingen typer; kald dem med et aabent options-objekt.
const runStagesInOrder = runStagesInOrderJs as unknown as (opts: Record<string, unknown>) => unknown;
const analyseDescentFinish = analyseDescentFinishJs as unknown as (opts: Record<string, unknown>) => { bestClimberFinishRank: number; nr10Finish: number; breakawayWon: boolean } | null;
import { routeFromStageProfileRow } from "./adapters/routeAdapter.ts";
import {
  SHARED_TIME_MODEL_V2_TUNING,
  SHARED_TIME_MODEL_V3_TUNING,
  TIME_MODEL_V3_TUNING,
  climbSplitGapSeconds,
  finishDescentChaseCapSeconds,
  timeModelTuningFor,
} from "./mechanics/timeModel.ts";
import { decidingClimbSelectionsOnTheDay } from "./mechanics/climbSelection.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const GIRO = path.join(here, "..", "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const SEEDS = 12;
const DECIDING_STAGE = 7;

type Row = { seed: number; bestClimberRank: number; nr10: number; breakawayWon: boolean };

async function measureGiroStage7(revision: string): Promise<Row[]> {
  const data = JSON.parse(readFileSync(GIRO, "utf8"));
  __resetRaceEngineV4Cache();
  const v4 = await loadRaceEngineV4();
  const stages = sortedStages(data).filter((p: { stage_number: number }) => p.stage_number <= DECIDING_STAGE);
  const abilitiesById = new Map((data.abilities as Array<{ rider_id: string }>).map((a) => [a.rider_id, a]));
  const rows: Row[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    runStagesInOrder({
      v4, data, revision, seedTag: `tour6285-${seed}`, stages,
      onStage: ({ profile, res }: { profile: { stage_number: number }; res: { v4Output: unknown } }) => {
        if (profile.stage_number !== DECIDING_STAGE) return;
        const route = routeFromStageProfileRow(profile as never);
        const tuning = timeModelTuningFor({ ordersGcV3: true, sharedGroupTime: { timeModelGeneration: 3 }, route: { profile_type: route.profile_type } });
        const a = analyseDescentFinish({ route, out: res.v4Output, abilitiesById, capFor: (gap: number, km: number) => finishDescentChaseCapSeconds(gap, km, tuning), breakawayWin });
        assert.ok(a, `seed ${seed}: etape ${DECIDING_STAGE} er en nedkoerselsfinale`);
        rows.push({ seed, bestClimberRank: a.bestClimberFinishRank, nr10: a.nr10Finish, breakawayWon: a.breakawayWon });
      },
    });
  }
  return rows;
}

// ── Enheden: dagsform og angreb paa den afgoerende stigning ───────────────────

type Sel = { riderId: string; baseScore: number; scoreTriggered: boolean; wprimeForced: boolean; effortForced: boolean; deficit01: number; energyDeficit01: number };
const sel = (riderId: string, deficit01 = 0): Sel => ({ riderId, baseScore: 0, scoreTriggered: false, wprimeForced: false, effortForced: false, deficit01, energyDeficit01: 0.3 });
const V3 = SHARED_TIME_MODEL_V3_TUNING;
// Giro e7's afgoerende stigning (12,4 km a 7,2 %).
const gapOf = (d: number, e: number) => climbSplitGapSeconds(7.2, 12.4, d, e, V3);

test("D1: uden vaegte (alle aeldre tidsmodeller) er underskuddene uaendrede", () => {
  const input = [sel("a", 0), sel("b", 0.05), sel("c", 0.1)];
  for (const t of [TIME_MODEL_V3_TUNING, SHARED_TIME_MODEL_V2_TUNING]) {
    const out = decidingClimbSelectionsOnTheDay(input as never, () => 80, () => 0.02, gapOf, t);
    assert.deepEqual(out.map((s) => s.deficit01), [0, 0.05, 0.1]);
  }
});

test("D1: styrke straffes aldrig - en hoejere klatre-evne giver aldrig et stoerre underskud (samme dagsform)", () => {
  let x = 7;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 200; trial++) {
    const ids = Array.from({ length: 8 }, (_, i) => `r${i}`);
    const climbing = new Map(ids.map((id) => [id, 70 + Math.round(rnd() * 25)]));
    const form = new Map(ids.map((id) => [id, (rnd() - 0.5) * 0.08]));
    const run = (c: Map<string, number>) => new Map(decidingClimbSelectionsOnTheDay(ids.map((id) => sel(id)) as never,
      (id) => c.get(id) ?? 0, (id) => form.get(id) ?? 0, gapOf, V3).map((s) => [s.riderId, s.deficit01]));
    const before = run(climbing);
    const stronger = new Map(climbing);
    stronger.set("r3", (climbing.get("r3") ?? 0) + 1 + Math.round(rnd() * 6));
    const after = run(stronger);
    assert.ok((after.get("r3") ?? 1) <= (before.get("r3") ?? 0) + 1e-9, `trial ${trial}: r3 ${before.get("r3")} -> ${after.get("r3")}`);
  }
});

test("D1: angrebet holder rytterne inden for vinduet, og dagsformen kan vende raekkefoelgen mellem naere klatrere", () => {
  // a er den bedste klatrer, b er 2 point bag. Med god dagsform til b vinder b angrebet.
  const climbing = new Map([["a", 90], ["b", 88], ["c", 70]]);
  const form = new Map([["a", -0.02], ["b", 0.02], ["c", 0]]);
  const base = [sel("a", 0), sel("b", 2 / 99), sel("c", 20 / 99)];
  const out = new Map(decidingClimbSelectionsOnTheDay(base as never, (id) => climbing.get(id) ?? 0, (id) => form.get(id) ?? 0, gapOf, V3).map((s) => [s.riderId, s]));
  assert.equal(out.get("b")?.deficit01, 0, "b er foerst paa dagen");
  assert.ok((out.get("a")?.deficit01 ?? 0) > 0);
  assert.ok(gapOf(out.get("a")!.deficit01, 0.3) <= V3.descentFinishClimbAttackWindowSeconds + 1e-6, "a holdes inden for vinduet");
  assert.ok(gapOf(out.get("c")!.deficit01, 0.3) > V3.descentFinishClimbAttackWindowSeconds, "c er uden for angrebet");
});

test("D1 (ejer 10/10): official_times_v3 - den bedste klatrer vinder 5-8 af 12 paa Giro e7, nr. 10 er 60-150 s og varierer", async () => {
  const rows = await measureGiroStage7("official_times_v3");
  assert.equal(rows.length, SEEDS);
  const wins = rows.filter((r) => r.bestClimberRank === 1).length;
  assert.ok(wins >= 5 && wins <= 8, `bedste klatrer vinder ${wins} af ${SEEDS} (D1: 5-8)`);
  // Vandt morgenudbruddet, er nr. 10 favoritternes etape og ikke D1 (scorecardets N/A).
  const measured = rows.filter((r) => !r.breakawayWon);
  assert.ok(measured.length >= SEEDS - 2, `kun ${measured.length} seeds uden udbrudssejr`);
  for (const r of measured) assert.ok(r.nr10 >= 60 && r.nr10 <= 150, `seed ${r.seed}: nr. 10 er ${r.nr10} s (D1: 60-150)`);
  const distinct = new Set(measured.map((r) => Math.round(r.nr10 / 5) * 5));
  assert.ok(distinct.size >= 4, `nr. 10 er ikke konstant: ${distinct.size} forskellige huller (afrundet til 5 s)`);
});
