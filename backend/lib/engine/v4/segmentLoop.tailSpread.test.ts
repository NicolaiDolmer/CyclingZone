// backend/lib/engine/v4/segmentLoop.tailSpread.test.ts
// #4885: property-tests for de to led der giver feltet en hale — udmattelsen i
// tærsklen (physiology.wprimeDepletionCpMultiplier) og det relative styrke-led
// i fart-modellen (segmentLoop.groupStrengthSpeedFactor + referenceCpByKind).
//
// Samme form som segmentLoop.groupDraft.test.ts (#4604): funktionerne er
// eksporteret netop for at kunne testes direkte, fordi en ende-til-ende-test
// ikke kan skelne "leddet er koblet fra" fra "leddet er koblet til og flyttede
// ingenting".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { groupStrengthSpeedFactor, referenceCpByKind, tailGrupettoMerge } from "./segmentLoop.ts";
import { wprimeDepletionCpMultiplier, deriveCp } from "./physiology.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import { simulateStageV4 } from "./index.ts";
import { rngFor } from "./rng.ts";
import { entrantsFromAbilitiesRows } from "./adapters/entrantAdapter.ts";
import { routeFromStageProfileRow } from "./adapters/routeAdapter.ts";
import type { AbilityKey, Entrant, RaceGroup, SegmentKind } from "./types.ts";

const KINDS: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function entrant(riderId: string, level: number): Entrant {
  const abilities = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) abilities[key] = level;
  return { rider_id: riderId, abilities, role: "free_role", effort: "normal", condition: 1 };
}

// ── Udmattelsen i tærsklen ──────────────────────────────────────────────────

test("#4885: en fuld reserve koster ingenting, en tom koster mest", () => {
  assert.equal(wprimeDepletionCpMultiplier(1, 1), 1, "fuld reserve => multiplikator 1");
  const empty = wprimeDepletionCpMultiplier(0, 1);
  assert.ok(empty < 1, "tom reserve skal koste tærskel");
  assert.ok(empty > 0, "udmattelsen maa aldrig nulstille tærsklen");
});

test("#4885: udmattelses-multiplikatoren er monotont ikke-faldende i reserve-andelen", () => {
  let previous = -Infinity;
  for (let i = 0; i <= 20; i++) {
    const value = wprimeDepletionCpMultiplier(i / 20, 1);
    assert.ok(value >= previous, `reserve-andel ${i / 20}: ${value} < ${previous} — styrke straffes`);
    previous = value;
  }
});

test("#4885: udmattelsen har ingen evne-akse — samme reserve-andel giver samme straf", () => {
  // Invariant 3 (§3): to ryttere med samme udtoemning skal rammes identist,
  // uanset hvor stor deres reserve er i absolutte tal.
  const halfSmall = wprimeDepletionCpMultiplier(0.1, 0.2);
  const halfLarge = wprimeDepletionCpMultiplier(0.5, 1);
  assert.equal(halfSmall, halfLarge, "halv reserve skal koste det samme uanset kapacitetens stoerrelse");
});

test("#4885: ingen anaerob kapacitet overhovedet giver fuld straf, ikke immunitet", () => {
  // Samme holdning som climbSelection.energyDeficit01, hvor #4604 rettede
  // praecis den modsatte guard.
  assert.equal(wprimeDepletionCpMultiplier(0, 0), wprimeDepletionCpMultiplier(0, 1));
});

test("#4885: udmattelsen kan aldrig vende to rytteres indbyrdes CP-orden ved samme udtoemning", () => {
  const strongCp = deriveCp(entrant("a", 80).abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
  const weakCp = deriveCp(entrant("b", 20).abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const factor = wprimeDepletionCpMultiplier(fraction, 1);
    assert.ok(strongCp * factor > weakCp * factor, `reserve-andel ${fraction}: den staerkeste skal blive staerkest`);
  }
});

// ── Det relative styrke-led i fart-modellen ─────────────────────────────────

test("#4885: en gruppe der matcher feltets reference koerer praecis basishastigheden", () => {
  for (const kind of KINDS) {
    assert.equal(groupStrengthSpeedFactor(0.25, 0.25, kind, RACE_V4_TUNING), 0, `${kind}: reference => faktor 0`);
  }
});

test("#4885: styrke-leddet er monotont ikke-faldende i gruppens kollektive CP", () => {
  for (const kind of KINDS) {
    let previous = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const value = groupStrengthSpeedFactor((i / 40) * 0.5, 0.25, kind, RACE_V4_TUNING);
      assert.ok(value >= previous, `${kind}: en staerkere gruppe blev langsommere (${value} < ${previous})`);
      previous = value;
    }
  }
});

test("#4885: en svagere gruppe end referencen er altid langsommere, en staerkere altid hurtigere", () => {
  for (const kind of KINDS) {
    assert.ok(groupStrengthSpeedFactor(0.1, 0.25, kind, RACE_V4_TUNING) < 0, `${kind}: underskud skal koste fart`);
    assert.ok(groupStrengthSpeedFactor(0.4, 0.25, kind, RACE_V4_TUNING) > 0, `${kind}: overskud skal give fart`);
  }
});

test("#4885: styrke omsaettes mest til fart op ad bakke og mindst nedad", () => {
  // Samme rangorden som work.draftFactor's terraen-ordning, af samme fysiske
  // grund: op ad bakke er farten naer proportional med baeredygtig effekt,
  // nedad koerer tyngdekraften.
  const deficitAt = (kind: SegmentKind) => -groupStrengthSpeedFactor(0.1, 0.25, kind, RACE_V4_TUNING);
  assert.ok(deficitAt("climb") > deficitAt("cobbles"));
  assert.ok(deficitAt("cobbles") > deficitAt("rolling"));
  assert.ok(deficitAt("rolling") > deficitAt("flat"));
  assert.ok(deficitAt("flat") > deficitAt("descent"));
});

test("#4885: en reference paa 0 degenererer sikkert til ingen effekt", () => {
  for (const kind of KINDS) {
    assert.equal(groupStrengthSpeedFactor(0.3, 0, kind, RACE_V4_TUNING), 0);
  }
});

test("#4885: reference-CP'en er feltets staerkeste andel og er skala-invariant i feltets stoerrelse", () => {
  const small = [entrant("a", 90), entrant("b", 10), entrant("c", 10), entrant("d", 10), entrant("e", 10)];
  const reference = referenceCpByKind(small, RACE_V4_TUNING);
  const strongestClimbCp = deriveCp(small[0].abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
  // 5 ryttere x frontFraction 0,2 => netop 1 rytter i front-skiven.
  assert.equal(reference.climb, strongestClimbCp, "front-skiven skal vaere feltets staerkeste");

  // Et ensartet felt har sin egen CP som reference, uanset niveau — det er
  // hele pointen med relativiseringen (population-uafhaengighed, #4604).
  for (const level of [5, 30, 99]) {
    const uniform = Array.from({ length: 20 }, (_, i) => entrant(`r${i}`, level));
    const ref = referenceCpByKind(uniform, RACE_V4_TUNING);
    const own = deriveCp(uniform[0].abilities, "climb", RACE_V4_TUNING.physiology.cpWeights);
    assert.ok(Math.abs(ref.climb - own) < 1e-12, `niveau ${level}: et ensartet felt er sin egen reference`);
    assert.equal(groupStrengthSpeedFactor(own, ref.climb, "climb", RACE_V4_TUNING), 0);
  }
});

// ── #5813: tidsgraensen paa en rullende etape uden bjerge ────────────────────
//
// S4-testpakken (27/9) viste ryttere uden for tidsgraensen paa bakkede etaper
// uden bjerge — sidste mand op mod en halv time efter, hvor v3 aldrig kom over
// faa minutter. Aarsagen: en tom reserve tvang rytteren af paa ENHVER stigning
// (ogsaa en kort 4. kategori midtvejs), og de afhaengte ryttere koerte
// derefter resten af dagen i mange smaa, langsomme grupper. Testen koerer den
// rullende proxy-etape fra den pinnede proxy-kalender (165 km, en kort 4.
// kategori midtvejs og to 3. kategorier) med et felt paa 180 fra den pinnede
// population og kraever: ingen rytter uden for tidsgraensen, medmindre han
// havde et uheld.

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINES = join(HERE, "..", "..", "..", "scripts", "baselines");

type PopulationRider = { id: string; team_id: string | null; abilities: Record<string, number | null> };

function loadJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(BASELINES, file), "utf8")) as T;
}

/** Deterministisk felt: Fisher-Yates paa motorens egen seedede stream. */
function sampleField(riders: readonly PopulationRider[], size: number, seed: string): PopulationRider[] {
  const pool = [...riders];
  const rng = rngFor(seed, "test_field_sample");
  const count = Math.min(size, pool.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

test("#5813: rullende etape uden bjerge (felt 180) — ingen uden for tidsgraensen uden et uheld", () => {
  const population = loadJson<{ riders: PopulationRider[] }>("population-snapshot-2026-09-24.json");
  const stages = loadJson<Array<Record<string, unknown>>>("v4-proxy-stages-2026-09-06.json");
  const stageRow = stages.find(
    (s) => s.profile_type === "rolling" && s.distance_km === 165 && s.elevation_gain_m === 1070,
  );
  assert.ok(stageRow, "den rullende proxy-etape skal findes i den pinnede kalender");
  const route = routeFromStageProfileRow(stageRow as Parameters<typeof routeFromStageProfileRow>[0]);
  const smallClimb = route.segments.find((s) => s.kind === "climb");
  assert.ok(smallClimb && smallClimb.to_km - smallClimb.from_km < 1.5, "etapens foerste stigning er den korte bakke midtvejs");

  let droppedSeen = false;
  for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
    const riders = sampleField(population.riders, 180, `5813-${seed}`);
    const teamByRider = new Map(riders.map((r) => [r.id, r.team_id]));
    const startlist = entrantsFromAbilitiesRows(
      riders.map((r) => ({ rider_id: r.id, ...r.abilities })),
      (riderId) => ({ role: "free_role", effort: "normal", condition: 1, teamId: teamByRider.get(riderId) ?? null }),
    );
    const output = simulateStageV4({ route, startlist, orders: [], seed: `5813-${seed}`, tuning: RACE_V4_TUNING });
    const hadIncident = new Set((output.incidents ?? []).map((i) => i.rider_id));
    const otlWithoutIncident = output.results.filter((r) => r.status === "otl" && !hadIncident.has(r.rider_id));
    assert.deepEqual(
      otlWithoutIncident.map((r) => r.rider_id),
      [],
      `${seed}: ryttere uden for tidsgraensen uden et uheld`,
    );
    const winnerTime = output.results[0].time_seconds;
    if (output.results.some((r) => r.status !== "abandoned" && r.time_seconds - winnerTime > 60)) droppedSeen = true;
  }
  // Ingen tom groen test: etapen skal faktisk have sat ryttere af.
  assert.ok(droppedSeen, "etapen skal have en hale — ellers tester den ikke tidsgraensen");
});

test("#5813: grupetto-samlingen koerer kun paa aabent terraen og aldrig paa finale-segmentet", () => {
  const group = (id: string, count: number, gap: number): RaceGroup => ({
    id,
    kind: "chase",
    rider_ids: Array.from({ length: count }, (_, i) => `${id}-${i}`),
    gap_seconds: gap,
    cohesion: 1,
  });
  // Front 60, to afhaengte klumper 30 s fra hinanden.
  const groups = [group("front", 60, 0), group("a", 20, 300), group("b", 20, 330)];
  for (const kind of ["flat", "rolling", "descent"] as SegmentKind[]) {
    const out = tailGrupettoMerge(groups, kind, false);
    assert.equal(out.groups.length, 2, `${kind}: de to afhaengte klumper samles`);
    assert.deepEqual(out.merges.map((m) => m.absorbed_group_id), ["b"]);
  }
  for (const kind of ["climb", "cobbles"] as SegmentKind[]) {
    assert.equal(tailGrupettoMerge(groups, kind, false).groups, groups, `${kind}: ingen samling`);
  }
  assert.equal(tailGrupettoMerge(groups, "flat", true).groups, groups, "finale-segmentet: ingen samling");
});

test("#4885: reference-CP'en daekker alle terraen-typer", () => {
  const field = Array.from({ length: 10 }, (_, i) => entrant(`r${i}`, 40 + i));
  const reference = referenceCpByKind(field, RACE_V4_TUNING);
  for (const kind of KINDS) {
    assert.ok(Number.isFinite(reference[kind]), `${kind} skal have en reference`);
    assert.ok(reference[kind] > 0, `${kind}: reference skal vaere positiv for et felt med evner`);
  }
});
