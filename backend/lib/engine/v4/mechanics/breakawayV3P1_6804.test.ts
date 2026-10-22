// #6804 P1 (KUN s5_profiles_v3, slukket): jagten paa kuperet i etapeloeb.
// Kontrakter, ingen balance-tal (hard rule 17): hvornaar P1 gaelder, ordenen K2,
// monotoni i finalevaegten og at alle aeldre revisioner og endagsloeb er uroerte.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isStageRaceGcContext, s5V3FinaleWeightScale, s5V3HillyChaseApplies, s5V3LetGoMaxGapScale, s5V3PreFinalChaseClosingScale } from "./breakawayV3_6804.ts";
import { stageWinChaseForceV3 } from "./breakaway.ts";
import { BREAKAWAY_CHASE_V3_TUNING, MOUNTAIN_SELECTION_V2_TUNING, S5_V3_BREAKAWAY_TUNING } from "../tuning.ts";
import { simulateStageV4 } from "../index.ts";
import type { Entrant, GcContext } from "../types.ts";

const standings: GcContext = { status: "standings", stage_number: 2, leader_id: null, standings: [] };
const firstStage: GcContext = { status: "first_stage", stage_number: 1 };
const oneDay: GcContext = { status: "one_day" };

test("#6804 P1: gaelder kun under v3, paa kuperet og i et etapeloeb", () => {
  assert.equal(isStageRaceGcContext(standings), true);
  assert.equal(isStageRaceGcContext(firstStage), true);
  assert.equal(isStageRaceGcContext(oneDay), false);
  assert.equal(isStageRaceGcContext({ status: "missing" }), false);
  assert.equal(isStageRaceGcContext(null), false);
  assert.equal(s5V3HillyChaseApplies({ s5ProfilesV3: true, profileType: "hilly", gcContext: standings }), true);
  assert.equal(s5V3HillyChaseApplies({ s5ProfilesV3: true, profileType: "hilly", gcContext: firstStage }), true);
  assert.equal(s5V3HillyChaseApplies({ s5ProfilesV3: true, profileType: "hilly", gcContext: oneDay }), false, "endagsloeb uroert (G14)");
  assert.equal(s5V3HillyChaseApplies({ s5ProfilesV3: false, profileType: "hilly", gcContext: standings }), false);
  assert.equal(s5V3HillyChaseApplies({ profileType: "hilly", gcContext: standings }), false);
  for (const profileType of ["flat", "rolling", "mountain", "high_mountain", "medium_mountain"] as const) {
    assert.equal(s5V3HillyChaseApplies({ s5ProfilesV3: true, profileType, gcContext: standings }), false, profileType);
  }
});

test("#6804 P1: neutrale vaerdier naar P1 ikke gaelder", () => {
  assert.equal(s5V3FinaleWeightScale(false, "flat_sprint"), 1);
  assert.equal(s5V3FinaleWeightScale(true, null), 1);
  assert.equal(s5V3LetGoMaxGapScale(false), 1);
  assert.equal(s5V3PreFinalChaseClosingScale(false), undefined);
});

test("#6804 P1.1 (K2): kuperet spurt jages mindre, men ordenen spurt > bakke/mur > nedkoersel i jagtvaegt bevares", () => {
  const w = (finale: keyof typeof BREAKAWAY_CHASE_V3_TUNING.stageWinFinaleWeight) =>
    (BREAKAWAY_CHASE_V3_TUNING.stageWinFinaleWeight[finale] ?? BREAKAWAY_CHASE_V3_TUNING.stageWinFinaleWeightDefault) * s5V3FinaleWeightScale(true, finale);
  assert.ok(s5V3FinaleWeightScale(true, "flat_sprint") < 1, "kuperet spurt vaegtes lavere end flad");
  assert.ok(w("flat_sprint") > w("wall_finish"));
  assert.ok(w("uphill_sprint") > w("punch"));
  assert.ok(w("wall_finish") > w("descent"));
  assert.ok(w("punch") > w("descent"));
  assert.equal(s5V3FinaleWeightScale(true, "descent"), 1, "nedkoerslen roeres ikke");
  for (const f of Object.values(S5_V3_BREAKAWAY_TUNING.p1.finaleWeightFactorByFinale)) assert.ok((f as number) > 0 && (f as number) <= 1);
});

test("#6804 P1.2/P1.3: daempet jagt foer finalen og lavere lad-gaa-loft (aldrig over 1)", () => {
  const pre = s5V3PreFinalChaseClosingScale(true) as number;
  assert.ok(pre > 0 && pre < 1, "daempet, men jagter stadig");
  assert.ok(pre <= MOUNTAIN_SELECTION_V2_TUNING.finalChaseClosingScale);
  const letGo = s5V3LetGoMaxGapScale(true);
  assert.ok(letGo > 0 && letGo <= 1, "lavere loft, aldrig hoejere");
});

function entrant(id: string, team: string, over: Partial<Record<string, number>> = {}): Entrant {
  const base = { sprint: 60, punch: 60, climbing: 60, tempo: 60, time_trial: 60, endurance: 60, acceleration: 60, positioning: 60, durability: 60, recovery: 60, aggression: 60, tactics: 60, cobblestone: 60, descending: 60 };
  return { rider_id: id, team_id: team, abilities: { ...base, ...over } } as unknown as Entrant;
}

test("#6804 P1.1: finaleWeightScale skalerer kun etapeinteressen; udeladt = bit-identisk", () => {
  const entrants: Record<string, Entrant> = {};
  const ids = ["a1", "a2", "b1", "b2", "c1"];
  ids.forEach((id, i) => { entrants[id] = entrant(id, id.slice(0, 1), { sprint: 50 + i * 5 }); });
  const base = { chaseGroupRiderIds: ids, entrants, finaleType: "flat_sprint" as const, abilityScale: 1, profileType: "hilly" as const, teamSignals: new Map<string, number>() };
  const plain = stageWinChaseForceV3(base);
  const one = stageWinChaseForceV3({ ...base, finaleWeightScale: 1 });
  assert.deepEqual({ ...one, interestByTeam: [...one.interestByTeam] }, { ...plain, interestByTeam: [...plain.interestByTeam] });
  const half = stageWinChaseForceV3({ ...base, finaleWeightScale: 0.5 });
  assert.ok(half.interest < plain.interest);
  assert.ok(Math.abs(half.interest - plain.interest * 0.5) < 1e-9);
  // Monotoni: en ordre kan stadig kun oege kraften.
  const ordered = stageWinChaseForceV3({ ...base, finaleWeightScale: 0.5, teamSignals: new Map([["a", 1]]) });
  assert.ok(ordered.total >= half.total);
});

test("#6804 P1: v3 er byte-identisk med v2 paa alle motor-fixtures uden etapeloebs-klassement", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  const names = readdirSync(dir).filter((n) => statSync(path.join(dir, n)).isDirectory()).sort();
  assert.ok(names.length > 0);
  for (const name of names) {
    const input = JSON.parse(readFileSync(path.join(dir, name, "input.json"), "utf8"));
    for (const gc of [undefined, oneDay]) {
      const extra = gc ? { gc_context: gc } : {};
      const v2 = simulateStageV4({ ...input, ...extra, rules_revision: "s5_profiles_v2" });
      const v3 = simulateStageV4({ ...input, ...extra, rules_revision: "s5_profiles_v3" });
      assert.equal(JSON.stringify(v3), JSON.stringify(v2), `${name} ${gc?.status ?? "uden gc"}`);
    }
  }
});

test("#6804 P1: v3 er deterministisk paa en kuperet etape i et etapeloeb, og flad/bjerg er uroert", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  for (const name of ["mur-finale", "punch-finale-forspring", "flat-massespurt", "bjerg-selektion"]) {
    const input = JSON.parse(readFileSync(path.join(dir, name, "input.json"), "utf8"));
    const run = (rev: string) => JSON.stringify(simulateStageV4({ ...input, gc_context: firstStage, rules_revision: rev }));
    assert.equal(run("s5_profiles_v3"), run("s5_profiles_v3"), `${name} deterministisk`);
    if (input.route.profile_type !== "hilly") assert.equal(run("s5_profiles_v3"), run("s5_profiles_v2"), `${name}: P1 roerer kun kuperet`);
  }
});
