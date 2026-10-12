// backend/lib/engine/v4/mountainGapsV4_6464.test.ts
// #6464 + #6456 (ejer 11/10): bjergets tidsgab under official_times_v4 (slukket).
//
// Rodaarsag (#6464): hullet paa en stigning var tiden paa stigningen gange
// evneforskellen i ABSOLUTTE evne-point. Felterne i de lavere divisioner har en
// bredere spredning i point mellem feltets bedste klatrer og nr. 10, saa nr. 10
// paa en topankomst laa flere gange laengere bag end i D1. Under
// official_times_v4 maales hullet i feltets egen klatre-spredning (samme faktor
// for alle ryttere paa etapen), saa samme felt-struktur giver samme nr. 10 uanset
// evne-niveau. official_times_v3 og aeldre er uaendrede (faktor 1).
//
// Tal staar ikke her (hard rule 17); de maalte tal ligger i balance-internals/6464/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../raceEngineV4Bridge.js";
import { breakawaySets, runStagesInOrder as runStagesInOrderJs, sortedStages } from "../../../scripts/dev/lib/tourScorecard.mjs";
import { median } from "../../../scripts/lib/headToHeadStats.js";
import {
  SHARED_TIME_MODEL_V2_TUNING,
  SHARED_TIME_MODEL_V3_TUNING,
  SHARED_TIME_MODEL_V4_TUNING,
  TIME_MODEL_V3_TUNING,
  climbGapFieldScale,
  climbSplitGapSeconds,
  fieldScaledClimbTuning,
  timeModelTuningFor,
} from "./mechanics/timeModel.ts";
import type { StageOutput } from "./types.ts";

const runStagesInOrder = runStagesInOrderJs as unknown as (opts: Record<string, unknown>) => unknown;
const here = path.dirname(fileURLToPath(import.meta.url));
const GIRO = path.join(here, "..", "..", "..", "scripts", "baselines", "giro-field-6088-2026-10-02.json");

// ── Tuning-kontrakten ────────────────────────────────────────────────────────

test("#6464: only official_times_v4's time model measures the gap in the field's own spread", () => {
  const field = [90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 1];
  for (const t of [TIME_MODEL_V3_TUNING, SHARED_TIME_MODEL_V2_TUNING, SHARED_TIME_MODEL_V3_TUNING]) {
    assert.equal(climbGapFieldScale(field, t), 1);
    assert.equal(fieldScaledClimbTuning(t, 1), t, "factor 1 returns the very same tuning (byte-identical)");
    assert.deepEqual(t.climbGapFieldScaleProfiles, []);
  }
  assert.deepEqual([...SHARED_TIME_MODEL_V4_TUNING.climbGapFieldScaleProfiles].sort(), ["high_mountain", "mountain"]);
  // The hook context picks v4 only with the v4 flag on top of generation 3.
  const ctx = (sharedGroupTime: unknown) => timeModelTuningFor({ ordersGcV3: true, sharedGroupTime });
  assert.equal(ctx({ timeModelGeneration: 3 }), SHARED_TIME_MODEL_V3_TUNING);
  assert.equal(ctx({ timeModelGeneration: 3, mountainGapsV4: true }), SHARED_TIME_MODEL_V4_TUNING);
  assert.equal(ctx({ mountainGapsV4: true }), SHARED_TIME_MODEL_V2_TUNING, "the v4 flag alone never selects v4");
});

test("#6464: a wider field gets a smaller factor; the factor is bounded and never negative", () => {
  const t = SHARED_TIME_MODEL_V4_TUNING;
  const [lo, hi] = t.climbGapFieldScaleBounds;
  const narrow = Array.from({ length: 30 }, (_, i) => 80 - i * 0.5);
  const wide = Array.from({ length: 30 }, (_, i) => 80 - i * 3);
  const huge = Array.from({ length: 30 }, (_, i) => 99 - i * 9);
  const flat = Array.from({ length: 30 }, () => 50);
  assert.ok(climbGapFieldScale(wide, t) < climbGapFieldScale(narrow, t));
  for (const f of [narrow, wide, huge, flat]) {
    const k = climbGapFieldScale(f, t);
    assert.ok(k >= lo && k <= hi, `factor ${k} inside bounds`);
  }
  assert.equal(climbGapFieldScale(huge, t), lo);
  assert.equal(climbGapFieldScale(flat, t), hi);
  assert.equal(climbGapFieldScale([], t), 1);
});

test("#6464: strength is never penalised - one factor per stage keeps the gap monotone in the deficit (#4707)", () => {
  const field = Array.from({ length: 40 }, (_, i) => 75 - i * 1.5);
  const scaled = fieldScaledClimbTuning(SHARED_TIME_MODEL_V4_TUNING, climbGapFieldScale(field, SHARED_TIME_MODEL_V4_TUNING));
  let prev = -Infinity;
  for (let deficit = 0; deficit <= 0.6; deficit += 0.02) {
    const gap = climbSplitGapSeconds(8, 12, deficit, 0.2, scaled);
    assert.ok(gap >= prev, `gap is non-decreasing in the deficit (${deficit})`);
    prev = gap;
  }
});

// ── Hele motoren: samme felt-struktur, to evne-niveauer ────────────────────────

const SUMMIT_STAGES = [12, 13];
const SEEDS = 6;
// Feltets klatring strakt omkring den bedste: samme raekkefoelge, bredere spredning
// (som et felt i en lavere division).
const STRETCH = 2.5;

type StageRun = { profile: { stage_number: number }; res: { v4Output: StageOutput } };

function stretchedField(data: { abilities: Array<Record<string, unknown>> }): typeof data {
  const top = Math.max(...data.abilities.map((a) => Number(a.climbing) || 0));
  return {
    ...data,
    abilities: data.abilities.map((a) => ({ ...a, climbing: Math.max(0, top - STRETCH * (top - (Number(a.climbing) || 0))) })),
  };
}

async function nr10OnSummits(data: Record<string, unknown>, revision: string): Promise<number> {
  __resetRaceEngineV4Cache();
  const v4 = await loadRaceEngineV4();
  const gaps: number[] = [];
  for (const stageNumber of SUMMIT_STAGES) {
    const stages = sortedStages(data).filter((p: { stage_number: number }) => p.stage_number === stageNumber);
    for (let seed = 1; seed <= SEEDS; seed++) {
      runStagesInOrder({
        v4, data, revision, seedTag: `v4gaps6464-${seed}`, stages,
        onStage: ({ res }: StageRun) => {
          // Favoritternes etape: nr. 10 blandt ryttere uden for morgenudbruddet,
          // maalt til den foerste af dem (enkelt-etaper uden klassement lader
          // tit udbruddet gaa; hullet til udbruddet ejes af Udbrudsmaal).
          const { formed } = breakawaySets(res.v4Output);
          const fav = res.v4Output.results.filter((r) => r.status === "finished" && !formed.has(r.rider_id)).sort((a, b) => a.time_seconds - b.time_seconds);
          if (fav.length >= 10) gaps.push(fav[9].time_seconds - fav[0].time_seconds);
        },
      });
    }
  }
  return median(gaps) as number;
}

test("#6464: on summit finishes nr. 10 no longer grows with the field's spread in ability points (Giro field, stretched copy)", async () => {
  const data = JSON.parse(readFileSync(GIRO, "utf8"));
  const wide = stretchedField(data);
  const v3Ratio = (await nr10OnSummits(wide, "official_times_v3")) / (await nr10OnSummits(data, "official_times_v3"));
  const v4Ratio = (await nr10OnSummits(wide, "official_times_v4")) / (await nr10OnSummits(data, "official_times_v4"));
  // official_times_v3: the wider field spreads far more (the reported bug).
  assert.ok(v3Ratio > 1.5, `v3 grows with the spread (ratio ${v3Ratio.toFixed(2)})`);
  // official_times_v4: the same structure gives about the same nr. 10.
  assert.ok(v4Ratio > 0.7 && v4Ratio < 1.35, `v4 is scale-invariant (ratio ${v4Ratio.toFixed(2)})`);
});
