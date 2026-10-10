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
import { breakawayWin, runStagesInOrder, sortedStages } from "../../../scripts/dev/lib/tourScorecard.mjs";
import { analyseDescentFinish } from "../../../scripts/dev/descentFinish6200.mjs";
import { routeFromStageProfileRow } from "./adapters/routeAdapter.ts";
import { finishDescentChaseCapSeconds, timeModelTuningFor } from "./mechanics/timeModel.ts";

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
