// #6327 (ejer 11/10: "det må aldrig ske igen"): et udbrud, der er hentet eller sat
// af feltet, må aldrig stå BAG feltet som et udbrud, som feltet stadig jagter.
// Rettet 7/10 (PR #6326, ejer-beslutning A) og præcis kontakt (#6329) under
// official_times_v2; under den live revision skal det forblive 0.
//
// Måling: Giro-fixturet (#6088) under CURRENT_RACE_RULES_REVISION, hele løbet med
// klassementet akkumuleret som i spillet. I hvert gruppe-snapshot før mål må ingen
// gruppe af arten "breakaway" have større tid til tætten end feltet (+ en lille
// tolerance for afrunding). Snapshottet PÅ mållinjen er undtaget: der kommer et
// hentet udbrud korrekt i mål efter feltet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runStagesInOrder, sortedStages, splitEntrants } from "../../scripts/dev/lib/tourScorecard.mjs";
import { loadRaceEngineV4 } from "../../lib/raceEngineV4Bridge.js";
import { CURRENT_RACE_RULES_REVISION } from "../../lib/raceEngineRulesRevision.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");
const data = JSON.parse(readFileSync(FIXTURE, "utf8"));
const stages: any[] = sortedStages(data);
const SEEDS = 2;
const TOLERANCE_SECONDS = 5;

/** Snapshots (før mål) hvor en udbrudsgruppe står bag feltet. Ren, testet nedenfor. */
export function breakawaysBehindPeloton(snapshots: any[], distanceKm: number): string[] {
  const hits: string[] = [];
  for (const s of snapshots ?? []) {
    if (Number(s.km) >= Number(distanceKm) - 0.01) continue;
    const groups = s.groups ?? [];
    const peloton = groups.find((g: any) => g.kind === "peloton");
    if (!peloton) continue;
    for (const g of groups) {
      if (g.kind !== "breakaway") continue;
      if ((g.gap_seconds ?? 0) > (peloton.gap_seconds ?? 0) + TOLERANCE_SECONDS) {
        hits.push(`km ${Math.round(s.km)} ${g.group_id} ${Math.round(g.gap_seconds)} s mod feltet ${Math.round(peloton.gap_seconds)} s`);
      }
    }
  }
  return hits;
}

test("#6327 detektoren: udbrud bag feltet før mål tæller; mållinjen og styrtede solo-ryttere gør ikke", () => {
  const snap = (km: number, groups: any[]) => ({ km, groups });
  const pel = (gap: number) => ({ group_id: "peloton-0", kind: "peloton", gap_seconds: gap });
  assert.deepEqual(breakawaysBehindPeloton([snap(50, [{ group_id: "breakaway-0", kind: "breakaway", gap_seconds: 0 }, pel(60)])], 180), []);
  assert.equal(breakawaysBehindPeloton([snap(89, [{ group_id: "breakaway-5001", kind: "breakaway", gap_seconds: 243 }, pel(204)])], 180).length, 1);
  assert.deepEqual(breakawaysBehindPeloton([snap(180, [{ group_id: "breakaway-0", kind: "breakaway", gap_seconds: 61 }, pel(0)])], 180), [], "mållinjen er undtaget");
  assert.deepEqual(breakawaysBehindPeloton([snap(56, [{ group_id: "solo-m10", kind: "solo", gap_seconds: 380 }, pel(373)])], 180), [], "en styrtet rytter bag feltet er ikke et udbrud");
});

test(`#6327 ${CURRENT_RACE_RULES_REVISION}: intet udbrud står bag feltet og jagtes stadig (Giro-feltet, hele løbet)`, async () => {
  const v4 = await loadRaceEngineV4();
  const hits: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    runStagesInOrder({
      v4, data, revision: CURRENT_RACE_RULES_REVISION, seedTag: `guard6327-${seed}`, stages, entrants: splitEntrants(data).entrants,
      onStage: ({ profile, res }: any) => {
        for (const h of breakawaysBehindPeloton(res.v4Output.groupSnapshots, profile.distance_km)) hits.push(`etape ${profile.stage_number} seed ${seed}: ${h}`);
      },
    });
  }
  assert.deepEqual(hits, []);
});
