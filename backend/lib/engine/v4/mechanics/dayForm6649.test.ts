// backend/lib/engine/v4/mechanics/dayForm6649.test.ts
// #6649 (KUN s5_profiles_v3): dagsform med forklaring. Ingen balance-tal her
// (hard rule 17): testene laaser reglerne (retning, determinisme, aarsag,
// fog-gate, bit-identitet for aeldre revisioner), ikke kalibreringen.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  dayWord7725,
  dayWordEvents7725,
  weatherStress,
} from "./dayForm6649.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): StageInput => JSON.parse(readFileSync(path.join(here, "..", "fixtures", name, "input.json"), "utf8")) as StageInput;

const flat = (from: number, to: number): Segment => ({ kind: "flat", from_km: from, to_km: to } as Segment);
const climb = (from: number, to: number): Segment => ({ kind: "climb", from_km: from, to_km: to, category: "1", avg_gradient: 7, top_elevation_m: 2000 } as Segment);
const route = (kind: "sun" | "overcast" | "rain" | "wind", segments: Segment[] = [flat(0, 160)], wind = 0.5) =>
  ({ distance_km: segments[segments.length - 1].to_km, segments, weather: { kind, wind_exposure: wind } }) as Pick<RouteV2, "weather" | "segments" | "distance_km">;

const abilities = (v: number) => ({ climbing: v, time_trial: v, sprint: v, punch: v, endurance: v, cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v, flat: v, tempo: v, durability: v, aggression: v, descending: v }) as Entrant["abilities"];
// Alle testryttere har SAMME objekt-form: `form` og `form_peak_points` er altid
// noegler (undefined = ukendt, praecis som et udeladt felt, se riskFormOf).
// CI 27/10 (run 40484685458, Node 24.21.0): "low form" fejlede én gang paa uaendret
// kode, der var groen i 6 andre CI-koersler og lokalt. Testen er ren og koerer i egen
// proces, saa delt tilstand er udelukket; mistanken er V8's optimerende compiler ved
// skiftet fra en form uden `form` (fresh/tired, 4000 kald) til en med. Den faste form
// fjernede IKKE fejlen (CI 29/10 og 30/10, samme tal); se #7366-blokken nedenfor.
const rider = (id: string, extra: Partial<Entrant> = {}): Entrant => ({ rider_id: id, abilities: abilities(70), role: "free_role", effort: "normal", condition: 1, form: undefined, form_peak_points: undefined, ...extra });
const show = (s: { bad: number; mean: number }) => `bad=${s.bad} mean=${s.mean}`;

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

// #7366: retnings-testen fejlede sporadisk i CI (kun Linux, Node 24.21/24.22; aldrig
// lokalt i 200+ koersler, heller ikke under V8-stressflag) med bit-identiske tal hver
// gang: "low form" gav PRAECIS samme andel og middel som "good form" (form 90), dvs.
// rytterne blev regnet som om formen var hoej. Modulet er rent (ingen IO/Date/
// Math.random, frosne tabeller, ingen cache), seed er fast, og filen koerer i egen
// proces, saa delt tilstand, testraekkefoelge og seed-deling er udelukket. Tilbage
// staar V8's optimerende compiler (tier-up-timing er det eneste der varierer mellem
// koersler). Derfor er testen delt i to, uden at skjule noget:
//   1. Reglen (retningen) maales i en separat proces der kun koerer V8's fortolker:
//      deterministisk og isoleret, den oprindelige assertion uaendret.
//   2. Samme stikproever regnet i denne proces (JIT tilladt) skal give bit-identisk
//      det samme. Afviger de, fejler den test med en besked der peger paa #7366, saa
//      en JIT-afvigelse i motorkoden er synlig som det den er og ikke ligner en
//      regelfejl.
const DIRECTION_REFERENCE_ENV = "DAYFORM6649_DIRECTION_REFERENCE";
const INTERPRETER_ONLY = ["--no-opt", "--no-maglev", "--no-sparkplug"];

type Sample = ReturnType<typeof sample>;
type DirectionSamples = { fresh: Sample; tired: Sample; lowForm: Sample; highForm: Sample; rain: Sample; dry: Sample };

function directionSamples(): DirectionSamples {
  return {
    fresh: sample((id) => rider(id)),
    tired: sample((id) => rider(id, { condition: 0.2 })),
    lowForm: sample((id) => rider(id, { form: 15 })),
    highForm: sample((id) => rider(id, { form: 90 })),
    rain: sample((id) => rider(id, { abilities: abilities(20) }), route("rain")),
    dry: sample((id) => rider(id, { abilities: abilities(20) }), route("overcast")),
  };
}

if (process.env[DIRECTION_REFERENCE_ENV] === "1") {
  // Referenceprocessen: skriv stikproeverne og stop, foer nogen test registreres.
  process.stdout.write(`${JSON.stringify(directionSamples())}\n`);
  process.exit(0);
}

let referenceCache: DirectionSamples | null = null;
/** Stikproeverne regnet i en frisk proces med kun V8's fortolker (ingen JIT-tier). */
function interpreterReference(): DirectionSamples {
  if (referenceCache) return referenceCache;
  const env: NodeJS.ProcessEnv = { ...process.env, [DIRECTION_REFERENCE_ENV]: "1" };
  delete env.NODE_TEST_CONTEXT; // ellers taler barnet node:test's interne protokol
  delete env.NODE_OPTIONS;
  const res = spawnSync(process.execPath, [...INTERPRETER_ONLY, fileURLToPath(import.meta.url)], { env, encoding: "utf8", timeout: 60_000 });
  assert.equal(res.status, 0, `interpreter reference failed: ${res.error?.message ?? ""}\n${res.stderr}`);
  const line = res.stdout.trim().split("\n").pop() ?? "";
  referenceCache = JSON.parse(line) as DirectionSamples;
  return referenceCache;
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
  const { fresh, tired, lowForm, highForm, rain, dry } = interpreterReference();
  assert.ok(tired.bad > fresh.bad && tired.mean < fresh.mean, `tired: ${show(tired)} vs fresh ${show(fresh)}`);
  assert.ok(lowForm.bad > fresh.bad && lowForm.mean < fresh.mean, `low form: ${show(lowForm)} vs fresh ${show(fresh)}`);
  assert.ok(highForm.bad < fresh.bad, `good form protects: ${show(highForm)} vs fresh ${show(fresh)}`);
  assert.ok(rain.bad > dry.bad && rain.mean < dry.mean, `rain: ${show(rain)} vs dry ${show(dry)}`);
});

test("#6649/#7366: the day form is bit-identical with and without V8's optimizing compiler", () => {
  const reference = interpreterReference();
  const inProcess = directionSamples();
  for (const key of Object.keys(reference) as (keyof DirectionSamples)[]) {
    assert.deepEqual(
      inProcess[key],
      reference[key],
      `${key}: optimized ${show(inProcess[key])} vs interpreter ${show(reference[key])}. ` +
        "The module is pure and the seed fixed, so a difference here is the JIT computing the engine differently, not the rule (#7366).",
    );
  }
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

test("#7725: the word follows the day: a clear slump is bad, the top of the good legs is great, most days have no word", () => {
  const words = ids.map((id) => dayWord7725(dayForm6649For(rider(id), route("overcast"), "seed-w")));
  const share = (w: string | null) => words.filter((x) => x === w).length / words.length;
  assert.ok(share(null) > 0.5, "an ordinary day has no word");
  assert.ok(share("good") > share("great") && share("great") > 0, "a really good day is rarer than a good one");
  assert.equal(dayWord7725({ delta: 0, reason: "form" }), "bad");
  assert.equal(dayWord7725({ delta: 0, reason: null }), null);
  for (const id of ids) {
    const day = dayForm6649For(rider(id), route("overcast"), "seed-w");
    if (dayWord7725(day) === "good" || dayWord7725(day) === "great") assert.ok(day.delta > 0, "a good day is never a negative day");
  }
});

test("#7725: the word events cover the whole field, at the finish, without numbers, and do not touch the input", () => {
  const startlist = ids.slice(0, 200).map((id) => rider(id, { condition: 0.3 }));
  const before = JSON.stringify(startlist);
  const r = route("rain", [flat(0, 80), climb(80, 100), flat(100, 160)]);
  const events = dayWordEvents7725(startlist, r, "seed-e");
  assert.equal(JSON.stringify(startlist), before);
  assert.deepEqual(events, dayWordEvents7725(startlist, r, "seed-e"), "deterministic");
  assert.ok(events.length > 10, "more than the day's candidates");
  for (const e of events) {
    assert.equal(e.type, "day_word");
    assert.equal(e.km, r.distance_km);
    for (const v of Object.values(e.params)) assert.equal(typeof v, "string", "no numbers in the params");
    if (e.params.word === "bad") assert.ok(["form", "fatigue", "illness", "weather"].includes(e.params.reason as string));
    else assert.equal("reason" in e.params, false);
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
