// Gatens BESLUTNING testes uden DB — samme mønster som realisme-scorecardets
// eksporterede data-/render-lag. Filen ligger i lib/ (ikke scripts/) fordi
// `npm test` kun opsamler lib/**/*.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreComposition, formatScorecard, seasonUuid, VERDICT, EXIT_CODE,
} from "../scripts/calendarCompositionScorecard.js";
import { computeCompositionStats, KB_TARGET_INTERIM } from "./calendarCompositionTargets.js";
import { computeStageOrderStats } from "./stageOrderMetrics.js";

// Byg en tier-entry hvis komposition matcher målet præcist over `raceDays` dage.
function onTargetTier(tier, raceDays, target = KB_TARGET_INTERIM) {
  const profileFor = { flat: "flat", hilly: "hilly", mountain: "mountain", itt: "itt", cobbles: "cobbles", ttt: "ttt" };
  const buckets = [];
  let assigned = 0;
  for (const [cat, pct] of Object.entries(target)) {
    const n = Math.round((pct / 100) * raceDays);
    assigned += n;
    if (n > 0) buckets.push(Array(n).fill(profileFor[cat]));
  }
  // Afrundings-rest lægges på kuperet, så antallene summer PRÆCIST til raceDays.
  if (assigned !== raceDays) buckets.push(Array(raceDays - assigned).fill("hilly"));

  // Interleave bunkerne (round-robin) i stedet for at lægge dem i blokke: bygges listen
  // kategori for kategori, ender alle bjerge bagest og #3326's "bjerg i første halvdel"
  // ville fejle på en fixture der kun handler om komposition. Round-robin bevarer
  // antallene eksakt (modsat en stride-permutation, som kun er en permutation når
  // stride og længde er indbyrdes primiske).
  const spread = [];
  for (let i = 0; buckets.some((b) => i < b.length); i++) {
    for (const b of buckets) if (i < b.length) spread.push(b[i]);
  }
  assert.equal(spread.length, raceDays);

  const races = [];
  for (let i = 0; i < spread.length; i += 4) {
    const chunk = spread.slice(i, i + 4);
    races.push(chunk.length >= 2
      ? { race_type: "stage_race", terrain_archetype: "balanced_week", stages: chunk.map((profile_type) => ({ profile_type })) }
      : { race_type: "single", terrain_archetype: "flat_sprint", stages: chunk.map((profile_type) => ({ profile_type })) });
  }
  return { tier, compositionStats: computeCompositionStats(races), stageOrderStats: computeStageOrderStats(races), errors: [], plan: null };
}

test("seasonUuid følger computeSeasonUuid-konventionen (hex, 12 cifre)", () => {
  assert.equal(seasonUuid(2), "00000000-0000-0000-0000-000000000002");
  assert.equal(seasonUuid(3), "00000000-0000-0000-0000-000000000003");
  assert.equal(seasonUuid(16), "00000000-0000-0000-0000-000000000010");
});

test("scoreComposition: alle tiers på målet → GO (exit 0)", () => {
  const summary = scoreComposition([onTargetTier(1, 140), onTargetTier(2, 112)]);
  assert.deepEqual(summary.failures, [], `uventede brud: ${summary.failures.join(" | ")}`);
  assert.deepEqual(summary.unassessed, []);
  assert.equal(summary.verdict, VERDICT.GO);
  assert.equal(summary.exitCode, 0);
});

test("scoreComposition: sæson-aggregatet vægtes efter løbsdage, ikke pr. tier", () => {
  const summary = scoreComposition([onTargetTier(1, 140), onTargetTier(4, 56)]);
  assert.equal(summary.season.raceDays, 196);
});

test("scoreComposition: en skæv tier giver NO-GO (exit 1)", () => {
  const skew = {
    tier: 4, errors: [], plan: null,
    compositionStats: computeCompositionStats([{ race_type: "stage_race", stages: Array(56).fill({ profile_type: "mountain" }) }]),
    stageOrderStats: computeStageOrderStats([]),
  };
  const summary = scoreComposition([onTargetTier(1, 140), skew]);
  assert.equal(summary.verdict, VERDICT.NO_GO);
  assert.equal(summary.exitCode, 1);
  assert.ok(summary.failures.some((f) => f.includes("tier 4") && f.includes("bjerg")));
});

test("scoreComposition: 0 løbsdage er UKENDT (exit 2), ALDRIG GO", () => {
  const empty = { tier: 3, compositionStats: computeCompositionStats([]), stageOrderStats: computeStageOrderStats([]), errors: [], plan: null };
  const summary = scoreComposition([empty]);
  assert.equal(summary.verdict, VERDICT.UNKNOWN);
  assert.equal(summary.exitCode, 2);
  assert.ok(summary.unassessed.some((u) => u.includes("0 løbsdage")));
});

test("scoreComposition: et brud vinder over 'kunne ikke vurderes'", () => {
  // Et konkret båndbrud er det mere specifikke og handlebare signal (#2854-konventionen).
  const skew = {
    tier: 4, errors: ["tier 4: kvoten blev ikke fyldt"], plan: null,
    compositionStats: computeCompositionStats([{ race_type: "stage_race", stages: Array(56).fill({ profile_type: "flat" }) }]),
    stageOrderStats: computeStageOrderStats([]),
  };
  const summary = scoreComposition([skew]);
  assert.equal(summary.verdict, VERDICT.NO_GO);
  assert.ok(summary.unassessed.length > 0, "unassessed rapporteres stadig");
});

test("scoreComposition: tier-tolerancen skaleres, sæson-tolerancen gør ikke", () => {
  // 56 dage, 5 ITT = 8,9 % mod mål 10 % → -1,1 pp: OK begge steder.
  // Men 3 ITT = 5,4 % → -4,6 pp: brud begge steder. Vi tester grænsetilfældet 4 ITT
  // (7,1 %, -2,9 pp): inden for tier-tolerancen (±3,6 pp), uden for sæson-tolerancen (±2 pp).
  const types = [...Array(4).fill("itt"), ...Array(13).fill("flat"), ...Array(18).fill("hilly"), ...Array(16).fill("mountain"), ...Array(5).fill("cobbles")];
  assert.equal(types.length, 56);
  const entry = {
    tier: 4, errors: [], plan: null,
    compositionStats: computeCompositionStats([{ race_type: "stage_race", stages: types.map((profile_type) => ({ profile_type })) }]),
    stageOrderStats: computeStageOrderStats([]),
  };
  const summary = scoreComposition([entry]);
  assert.ok(!summary.failures.some((f) => f.startsWith("tier 4: ITT")), "tier-tolerancen skal rumme -2,9 pp på 56 dage");
  assert.ok(summary.failures.some((f) => f.startsWith("sæson (alle tiers): ITT")), "sæson-tolerancen er skarp ±2 pp");
});

test("formatScorecard rapporterer TTT-forbeholdet, tier-tabeller og verdict", () => {
  const summary = scoreComposition([onTargetTier(1, 140)]);
  const out = formatScorecard(summary, { seasonNumber: 3, mode: "dry-run-plan" }).join("\n");
  assert.ok(out.includes("sæson 3"));
  assert.ok(out.includes("dry-run-plan"));
  assert.ok(out.includes("TTT-forbeholdet er AKTIVT"), "forbeholdet må ikke forsvinde fra rapporten");
  assert.ok(out.includes("Tier 1"));
  assert.ok(out.includes("SÆSON I ALT"));
  assert.ok(out.includes("GO"));
});

test("EXIT_CODE dækker alle tre verdicts", () => {
  assert.equal(EXIT_CODE[VERDICT.GO], 0);
  assert.equal(EXIT_CODE[VERDICT.NO_GO], 1);
  assert.equal(EXIT_CODE[VERDICT.UNKNOWN], 2);
});
