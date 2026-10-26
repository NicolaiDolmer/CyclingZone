// backend/lib/engine/v4/mechanics/dayForm6649.test.ts
// #6649 (KUN s5_profiles_v3): dagsform med forklaring. Ingen balance-tal her
// (hard rule 17): testene laaser reglerne (retning, determinisme, aarsag,
// fog-gate, bit-identitet for aeldre revisioner), ikke kalibreringen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulateStageV4 } from "../index.ts";
import { initRiderStates } from "../groups.ts";
import { RACE_V4_TUNING as ENGINE_TUNING } from "../tuning.ts";
import type { Entrant, RouteV2, Segment, StageInput } from "../types.ts";
import {
  applyDayForm6649,
  DAY_FORM_6649_TUNING as T,
  dayForm6649Events,
  dayForm6649For,
  dayForm6649FinaleScale,
  dayForm6649On,
  weatherStress,
} from "./dayForm6649.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): StageInput => JSON.parse(readFileSync(path.join(here, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;

const flat = (from: number, to: number): Segment => ({ kind: "flat", from_km: from, to_km: to } as Segment);
const climb = (from: number, to: number): Segment => ({ kind: "climb", from_km: from, to_km: to, category: "1", avg_gradient: 7, top_elevation_m: 2000 } as Segment);
const route = (kind: "sun" | "overcast" | "rain" | "wind", segments: Segment[] = [flat(0, 160)], wind = 0.5) =>
  ({ distance_km: segments[segments.length - 1].to_km, segments, weather: { kind, wind_exposure: wind } }) as Pick<RouteV2, "weather" | "segments" | "distance_km">;

const abilities = (v: number) => ({ climbing: v, time_trial: v, sprint: v, punch: v, endurance: v, cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v, flat: v, tempo: v, durability: v, aggression: v, descending: v }) as Entrant["abilities"];
const rider = (id: string, extra: Partial<Entrant> = {}): Entrant => ({ rider_id: id, abilities: abilities(70), role: "free_role", effort: "normal", condition: 1, ...extra });

const ids = Array.from({ length: 2000 }, (_, i) => `r${i}`);

/** Andel daarlige dage og gennemsnitligt udsving over mange ryttere (samme seed). */
function sample(make: (id: string) => Entrant, r = route("overcast"), seed = "s6649") {
  let bad = 0;
  let sum = 0;
  const reasons: Record<string, number> = {};
  for (const id of ids) {
    const d = dayForm6649For(make(id), r, seed);
    sum += d.delta;
    if (d.reason) {
      bad += 1;
      reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
    }
  }
  return { bad: bad / ids.length, mean: sum / ids.length, reasons };
}

test("#6649: deterministic per (seed, rider) and independent of who else starts", () => {
  const r = route("rain");
  const a = dayForm6649For(rider("x", { condition: 0.4, form: 30 }), r, "seed-1");
  const b = dayForm6649For(rider("x", { condition: 0.4, form: 30 }), r, "seed-1");
  assert.deepEqual(a, b);
  const other = dayForm6649For(rider("x", { condition: 0.4, form: 30 }), r, "seed-2");
  assert.notDeepEqual(a, other, "a new stage seed is a new day");
});

test("#6649: tiredness, low form and hard weather each make a bad day more likely and the average day worse", () => {
  const fresh = sample((id) => rider(id));
  const tired = sample((id) => rider(id, { condition: 0.2 }));
  const lowForm = sample((id) => rider(id, { form: 15 }));
  const highForm = sample((id) => rider(id, { form: 90 }));
  const rain = sample((id) => rider(id, { abilities: abilities(20) }), route("rain"));
  const dry = sample((id) => rider(id, { abilities: abilities(20) }), route("overcast"));
  assert.ok(tired.bad > fresh.bad && tired.mean < fresh.mean, "tired");
  assert.ok(lowForm.bad > fresh.bad && lowForm.mean < fresh.mean, "low form");
  assert.ok(highForm.bad < fresh.bad, "good form protects");
  assert.ok(rain.bad > dry.bad && rain.mean < dry.mean, "rain");
});

test("#6649: weather technique protects: in the rain a skilled rider has fewer bad days than an unskilled one", () => {
  const skilled = sample((id) => rider(id, { abilities: abilities(95) }), route("rain"));
  const unskilled = sample((id) => rider(id, { abilities: abilities(5) }), route("rain"));
  assert.ok(skilled.bad < unskilled.bad);
});

test("#6649: every bad day names its cause, and the cause follows the rider's state", () => {
  const tired = sample((id) => rider(id, { condition: 0.05 }));
  assert.ok((tired.reasons.fatigue ?? 0) > (tired.reasons.form ?? 0), "an exhausted field is mostly tired");
  assert.ok((tired.reasons.illness ?? 0) > 0, "extreme tiredness brings illness");
  const wet = sample((id) => rider(id, { abilities: abilities(0) }), route("rain"));
  assert.ok((wet.reasons.weather ?? 0) > 0);
  for (const id of ids.slice(0, 400)) {
    const d = dayForm6649For(rider(id, { condition: 0.3, form: 35 }), route("wind", [flat(0, 160)], 1), "seed-r");
    if (d.reason) assert.ok(d.delta <= -T.eventThreshold, "a named bad day is a clear dip");
    else assert.ok(d.delta > -T.eventThreshold, "a clear dip always has a cause");
    if (d.reason === "weather") assert.equal(d.weather, "wind");
    else assert.equal(d.weather, null);
  }
});

test("#6649: heat counts only on a long, hilly day in the sun", () => {
  assert.equal(weatherStress(route("sun", [flat(0, 160)])).kind, null);
  assert.equal(weatherStress(route("sun", [flat(0, 60), climb(60, 110), flat(110, 170)])).kind, "heat");
  assert.equal(weatherStress(route("sun", [flat(0, 30), climb(30, 60), flat(60, 90)])).kind, null, "short stage");
  assert.equal(weatherStress(route("overcast")).kind, null);
  assert.equal(weatherStress(route("wind", [flat(0, 160)], 0)).stress, 0, "sheltered wind costs nothing");
});

test("#6649: applyDayForm6649 off returns the very same object (older revisions untouched)", () => {
  const startlist = [rider("a"), rider("b", { form: 30 })];
  const riders = initRiderStates(startlist, ENGINE_TUNING, "seed");
  assert.equal(applyDayForm6649(riders, startlist, route("rain"), "seed", false), riders);
  const on = applyDayForm6649(riders, startlist, route("rain"), "seed", true);
  assert.notEqual(on, riders);
  assert.equal(riders.a.dayform, initRiderStates(startlist, ENGINE_TUNING, "seed").a.dayform, "input not mutated");
  assert.equal(on.a.wprime, riders.a.wprime, "only the day form changes");
});

test("#6649: events name only the day's candidates, at the finish, without numbers (fog-gate)", () => {
  const startlist = ids.slice(0, 200).map((id, i) => rider(id, { condition: 0.1, abilities: abilities(i < 10 ? 90 : 30) }));
  const r = route("rain", [flat(0, 80), climb(80, 100), flat(100, 160)]);
  const events = dayForm6649Events(startlist, r, "seed-e", ENGINE_TUNING);
  const top = new Set(startlist.slice(0, 10).map((e) => e.rider_id));
  for (const e of events) {
    assert.equal(e.type, "bad_day");
    assert.equal(e.km, r.distance_km);
    assert.ok(top.has(e.params.rider_id as string), "only a real candidate is named");
    assert.ok(["form", "fatigue", "illness", "weather"].includes(e.params.reason as string));
    for (const v of Object.values(e.params)) assert.equal(typeof v, "string", "no numbers in the params");
  }
});

test("#6649: a full stage under s5_profiles_v3 runs with the new day form; s5_profiles_v2 is unchanged and has no bad_day", () => {
  const input = fixture("bjerg-selektion");
  const startlist = input.startlist.map((e, i) => ({ ...e, condition: i % 3 === 0 ? 0.15 : 1, form: i % 2 ? 25 : 60 }));
  const v2a = simulateStageV4({ ...input, startlist, rules_revision: "s5_profiles_v2" } as StageInput);
  const v2b = simulateStageV4({ ...input, startlist, rules_revision: "s5_profiles_v2" } as StageInput);
  assert.deepEqual(v2a, v2b);
  assert.equal(v2a.timeline.events.filter((e) => e.type === "bad_day").length, 0);
  const v3 = simulateStageV4({ ...input, startlist, rules_revision: "s5_profiles_v3", day_form_6649: true } as StageInput);
  assert.equal(v3.results.length, startlist.length);
  const finish = v3.timeline.events.findIndex((e) => e.type === "finish");
  for (const [i, e] of v3.timeline.events.entries()) if (e.type === "bad_day") assert.ok(i < finish, "named before the finish line closes the log");
});

test("#6649: an individual time trial under s5_profiles_v3 gets the day form too", () => {
  const input = fixture("itt-solo");
  const startlist = input.startlist.map((e) => ({ ...e, condition: 0.1, form: 20 }));
  const v2 = simulateStageV4({ ...input, startlist, rules_revision: "s5_profiles_v2" } as StageInput);
  const v3 = simulateStageV4({ ...input, startlist, rules_revision: "s5_profiles_v3", day_form_6649: true } as StageInput);
  assert.equal(v3.results.length, v2.results.length);
  assert.notDeepEqual(v3.results.map((r) => r.time_seconds), v2.results.map((r) => r.time_seconds), "the day form reaches the time trial");
});

test("#6649: the day form needs both s5_profiles_v3 and the bridge flag; without the flag v3 is exactly as before", () => {
  assert.equal(dayForm6649On({ rules_revision: "s5_profiles_v3", day_form_6649: true }), true);
  assert.equal(dayForm6649On({ rules_revision: "s5_profiles_v3" }), false);
  assert.equal(dayForm6649On({ rules_revision: "s5_profiles_v2", day_form_6649: true }), false);
  assert.equal(dayForm6649On({ rules_revision: null, day_form_6649: true }), false);
  for (const name of ["bjerg-selektion", "flat-massespurt", "itt-solo"]) {
    const input = fixture(name);
    const plain = simulateStageV4({ ...input, rules_revision: "s5_profiles_v3" } as StageInput);
    const nullFlag = simulateStageV4({ ...input, rules_revision: "s5_profiles_v3", day_form_6649: null } as StageInput);
    assert.equal(JSON.stringify(nullFlag), JSON.stringify(plain), `${name}: no flag = unchanged`);
    const on = simulateStageV4({ ...input, rules_revision: "s5_profiles_v3", day_form_6649: true } as StageInput);
    assert.notEqual(JSON.stringify(on), JSON.stringify(plain), `${name}: the flag turns it on`);
  }
});

test("#6649: the mass-sprint finale reads less of the day form, and only when the day form is on", () => {
  assert.equal(dayForm6649FinaleScale(false), 1);
  assert.ok(dayForm6649FinaleScale(true) > 0 && dayForm6649FinaleScale(true) < 1);
});
