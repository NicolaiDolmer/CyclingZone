// backend/lib/engine/v4/mechanics/ittNoDayRoll7726.test.ts
// #7726 (ejer 5/11): en enkeltstart afgoeres af evne, form, traethed, vejr, rute og
// dagsform, ikke af en ekstra terning. Kontakten er slukket og gaelder kun s5_profiles_v3.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateStageV4 } from "../index.ts";
import { INCIDENTS_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import type { EngineTuning, StageInput } from "../types.ts";
import type { IncidentsTuning } from "./incidents.ts";
import { INDIVIDUAL_TIME_TRIAL_TUNING, simulateIndividualTimeTrialStage } from "./individualTimeTrial.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): StageInput => JSON.parse(readFileSync(path.join(here, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;
const NO_ROLL_TUNING = { ...INDIVIDUAL_TIME_TRIAL_TUNING, stageNoiseSd: 0 };
const NO_DAYFORM: EngineTuning = { ...RACE_V4_TUNING, dayform: { ...RACE_V4_TUNING.dayform, sd: 0, jourSansPBase: 0 } };
const NO_INCIDENTS: IncidentsTuning = { ...INCIDENTS_EXTRA_TUNING, baseRiskPerSegment: { flat: 0, rolling: 0, climb: 0, descent: 0, cobbles: 0 } };

test("#7726: kontakten giver praecis samme enkeltstart som en motor uden dagsudsving", () => {
  const input = fixture("itt-solo");
  const on = simulateIndividualTimeTrialStage(input.route, input.startlist, input.seed, input.tuning, { rulesRevision: "s5_profiles_v3", ittNoDayRoll7726: true });
  const noRoll = simulateIndividualTimeTrialStage(input.route, input.startlist, input.seed, input.tuning, { rulesRevision: "s5_profiles_v3", ittTuning: NO_ROLL_TUNING });
  const today = simulateIndividualTimeTrialStage(input.route, input.startlist, input.seed, input.tuning, { rulesRevision: "s5_profiles_v3" });
  assert.deepEqual(on, noRoll);
  assert.notDeepEqual(on.results.map((r) => r.time_seconds), today.results.map((r) => r.time_seconds), "terningen er vaek");
});

test("#7726: aeldre revisioner ignorerer kontakten", () => {
  const input = fixture("itt-solo");
  for (const rulesRevision of ["s5_profiles_v2", "official_times_v5", "legacy"]) {
    const on = simulateIndividualTimeTrialStage(input.route, input.startlist, input.seed, input.tuning, { rulesRevision, ittNoDayRoll7726: true });
    const off = simulateIndividualTimeTrialStage(input.route, input.startlist, input.seed, input.tuning, { rulesRevision });
    assert.deepEqual(on, off, rulesRevision);
  }
});

test("#7726: StageInput.itt_no_day_roll_7726 naar enkeltstarten, og en vejetape er uroert", () => {
  const itt = fixture("itt-solo");
  const on = simulateStageV4({ ...itt, rules_revision: "s5_profiles_v3", itt_no_day_roll_7726: true } as StageInput);
  const off = simulateStageV4({ ...itt, rules_revision: "s5_profiles_v3" } as StageInput);
  assert.notDeepEqual(on.results.map((r) => r.time_seconds), off.results.map((r) => r.time_seconds));
  const road = fixture("bjerg-selektion");
  assert.deepEqual(
    simulateStageV4({ ...road, rules_revision: "s5_profiles_v3", itt_no_day_roll_7726: true } as StageInput),
    simulateStageV4({ ...road, rules_revision: "s5_profiles_v3" } as StageInput),
  );
});

test("#7726: uden terning er to ens ryttere lige hurtige, uanset deres id", () => {
  const input = fixture("itt-solo");
  const twin = { ...input.startlist[0], rider_id: "tvilling-a" };
  const startlist = [twin, { ...twin, rider_id: "tvilling-b" }, ...input.startlist.slice(1)];
  const run = (options: { ittNoDayRoll7726?: true }) => {
    const out = simulateIndividualTimeTrialStage(input.route, startlist, input.seed, NO_DAYFORM, { rulesRevision: "s5_profiles_v3", incidentsTuning: NO_INCIDENTS, ...options });
    const time = (id: string) => out.results.find((r) => r.rider_id === id)?.time_seconds;
    return [time("tvilling-a"), time("tvilling-b")];
  };
  const [a, b] = run({ ittNoDayRoll7726: true });
  assert.equal(a, b);
  const [withRollA, withRollB] = run({});
  assert.notEqual(withRollA, withRollB, "med terningen skilles de ad uden nogen aarsag");
});
