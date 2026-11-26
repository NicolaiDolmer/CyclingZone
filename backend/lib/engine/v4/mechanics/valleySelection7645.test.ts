// #7645 (dalens selektion paa kuperet og mellembjerg, SLUKKET): kontrakt-tests.
//  1. Kontakten slukket (udeladt, null, true, ukendt vaerdi) er bit-identisk med merge-basen
//     (frosne digests i test-data/valleySelection7645OffDigests.json, skrevet fra koden foer kontakten).
//  2. Kontakten virker kun paa s5_profiles_v3, kun paa kuperet og mellembjerg.
//  3. Mekanikken: raekkevidden maales mod forgruppen; uden for den kommer en gruppe kun tilbage,
//     naar et hold med en kandidat i den har hjaelpere der jager; hjaelperne har et budget;
//     forgruppens hold kan holde dem ude. Ingen balance-tal i assertions ud over tuningens egne felter.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VALLEY_7645_OFF_COMPUTE, VALLEY_7645_OFF_PROFILES, VALLEY_7645_OFF_SEEDS, type Valley7645OffKey } from "../testUtils/valleySelection7645OffDigests.ts";
import { digestOf, frozenField, frozenStages } from "../testUtils/oldRevisionDigests6199.ts";
import { FIRST_STAGE_GC } from "../testUtils/stageRaceField6804.ts";
import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { routeFromStageProfileRow } from "../adapters/routeAdapter.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import {
  VALLEY_SELECTION_7645_TUNING,
  VALLEY_SELECTION_7645_VARIANTS,
  valleySelection7645For,
  valleySelection7645Variant,
  valleySelectionTempo7645,
  type ValleySelection7645Variant,
} from "./timeModel.ts";
import type { RaceGroup, StageInput } from "../types.ts";

const expected = JSON.parse(readFileSync(new URL("../test-data/valleySelection7645OffDigests.json", import.meta.url), "utf8")) as Record<string, unknown>;

test("#7645: fixturen er skrevet fra en merge-base og daekker praecis de frosne noegler", () => {
  assert.match(String(expected.sourceCommit), /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(expected).filter((k) => k !== "sourceCommit" && k !== "note"), Object.keys(VALLEY_7645_OFF_COMPUTE));
});

for (const key of Object.keys(VALLEY_7645_OFF_COMPUTE) as Valley7645OffKey[]) {
  test(`#7645: kontakten slukket, ${key} er bit-identisk med merge-basen`, () => {
    assert.deepEqual(VALLEY_7645_OFF_COMPUTE[key](), expected[key]);
  });
}

// Samme felt og etaper som de frosne digests, med kontaktens vaerdi paa input.
function runWith(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of frozenStages().filter((r) => (VALLEY_7645_OFF_PROFILES as readonly string[]).includes(r.profile_type))) {
    const route = routeFromStageProfileRow(row as Parameters<typeof routeFromStageProfileRow>[0]);
    const field = frozenField();
    const plan = buildStageOrderPlan({
      rows: [],
      stageNumber: 1,
      roster: field.map((rider) => ({ team_id: rider.team_id as string, rider_id: rider.rider_id, role: rider.role, is_ai: true, abilities: rider.abilities })),
      context: { route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null }, race: { is_stage_race: true, later_stages: [] }, rules_revision: "s5_profiles_v3" },
    } as Parameters<typeof buildStageOrderPlan>[0]);
    const startlist = field.map((rider) => ({ ...rider, role: plan.aiRoleByRider?.get(rider.rider_id) ?? rider.role, effort: plan.aiEffortByRider.get(rider.rider_id) ?? rider.effort }));
    for (const seed of VALLEY_7645_OFF_SEEDS) {
      const input = { route, startlist, orders: plan.orders, seed: `${seed}:${row.stage_number ?? 1}`, tuning: RACE_V4_TUNING, rules_revision: "s5_profiles_v3", gc_context: FIRST_STAGE_GC, valley_selection_7645: value } as unknown as StageInput;
      out[`${row.profile_type}#${row.stage_number ?? 1}@${seed}`] = digestOf(simulateStageV4(input));
    }
  }
  return out;
}

test("#7645: null, true og ukendte vaerdier er slukket (bit-identisk med merge-basen)", () => {
  for (const value of [null, true, "on", "front-reach", 1]) assert.deepEqual(runWith(value), expected.stageRace, String(value));
});

test("#7645: varianterne roerer aldrig bjerg (bit-identisk med merge-basen)", () => {
  const base = expected.stageRace as Record<string, string>;
  for (const variant of VALLEY_SELECTION_7645_VARIANTS) {
    const got = runWith(variant);
    for (const [key, digest] of Object.entries(got)) if (key.startsWith("mountain#")) assert.equal(digest, base[key], `${variant} ${key}`);
  }
});

test("#7645: hver variant flytter mindst én kuperet etape (kontakten virker, naar den er taendt)", () => {
  const base = expected.stageRace as Record<string, string>;
  for (const variant of VALLEY_SELECTION_7645_VARIANTS) {
    const got = runWith(variant);
    assert.ok(Object.entries(got).some(([key, digest]) => key.startsWith("hilly#") && digest !== base[key]), variant);
  }
});

test("#7645: kontakten gaelder kun s5_profiles_v3 og kun kuperet og mellembjerg", () => {
  assert.equal(valleySelection7645For({ rules_revision: "s5_profiles_v3", valley_selection_7645: "team_chase_hold" }, "hilly"), "team_chase_hold");
  assert.equal(valleySelection7645For({ rules_revision: "s5_profiles_v3", valley_selection_7645: "front_reach" }, "medium_mountain"), "front_reach");
  for (const profile of ["flat", "rolling", "mountain", "high_mountain", "cobbles", "classic"] as const) {
    assert.equal(valleySelection7645For({ rules_revision: "s5_profiles_v3", valley_selection_7645: "team_chase_hold" }, profile), null, profile);
  }
  for (const revision of ["legacy", "s5_profiles_v1", "s5_profiles_v2", "official_times_v5", null]) {
    assert.equal(valleySelection7645For({ rules_revision: revision, valley_selection_7645: "team_chase_hold" }, "hilly"), null, String(revision));
  }
  assert.equal(valleySelection7645Variant(true), null);
  assert.equal(valleySelection7645Variant("team_chase"), "team_chase");
});

// ── Mekanikken paa haandbyggede grupper ───────────────────────────────────────
type T = { dtSeconds: number; frontRiderIds: Set<string> };
const SEGMENTS = [
  { kind: "climb" as const, from_km: 0, to_km: 10 },
  { kind: "flat" as const, from_km: 10, to_km: 30 },
];

function rider(team: string, role: string, sprint: number) {
  return { team_id: team, role, effort: "normal", abilities: { sprint, punch: 50, climbing: 50, descending: 50, time_trial: 50 } };
}

// Forgruppe F (hold A's svagere spurter + hjaelpere), gruppe B langt bagved (hold B's hurtige spurter + hjaelpere).
function scene(behindGap: number) {
  const entrants: Record<string, ReturnType<typeof rider>> = {
    a1: rider("A", "sprint_captain", 70), a2: rider("A", "helper", 40), a3: rider("A", "helper", 40),
    b1: rider("B", "sprint_captain", 90), b2: rider("B", "helper", 40), b3: rider("B", "helper", 40),
    c1: rider("C", "captain", 30), c2: rider("C", "helper", 30),
  };
  const riders = Object.fromEntries(Object.keys(entrants).map((id) => [id, { status: "racing" }]));
  const groups: RaceGroup[] = [
    { id: "F", kind: "peloton", rider_ids: ["a1", "a2", "a3", "c1"], gap_seconds: 0, cohesion: 1 } as RaceGroup,
    { id: "B", kind: "peloton", rider_ids: ["b1", "b2", "b3", "c2"], gap_seconds: behindGap, cohesion: 1 } as RaceGroup,
  ];
  // Gruppen bagved koerer i sit eget tempo lidt langsommere end forgruppen.
  const tempo = new Map<string, T>([["F", { dtSeconds: 1000, frontRiderIds: new Set(["a2"]) }], ["B", { dtSeconds: 1030, frontRiderIds: new Set(["b2"]) }]]);
  return { entrants, riders, groups, tempo };
}

function run(variant: ValleySelection7645Variant, behindGap: number, workKm?: Record<string, number>) {
  const s = scene(behindGap);
  return valleySelectionTempo7645({
    groups: s.groups, tempoByGroup: s.tempo, segments: SEGMENTS, segmentIndex: 1, incidentChasers: undefined, variant,
    entrants: s.entrants, riders: s.riders, finaleType: "flat_sprint", profileType: "hilly", workKm,
  });
}

test("#7645: inden for raekkevidden af forgruppen vokser hullet ikke (alle varianter)", () => {
  for (const variant of VALLEY_SELECTION_7645_VARIANTS) {
    const r = run(variant, VALLEY_SELECTION_7645_TUNING.frontReachSeconds / 2);
    assert.ok((r.tempo.get("B")?.dtSeconds ?? Infinity) <= 1000, variant);
  }
});

test("#7645: mulighed 1 lader en gruppe uden for raekkevidden koere sit eget tempo", () => {
  const r = run("front_reach", VALLEY_SELECTION_7645_TUNING.frontReachSeconds * 3);
  assert.equal(r.tempo.get("B")?.dtSeconds, 1030);
  assert.equal(r.workKm, undefined);
});

test("#7645: jagten med en aarsag: holdet med kandidaten bagved jager og betaler", () => {
  const r = run("team_chase", VALLEY_SELECTION_7645_TUNING.frontReachSeconds * 3);
  const dt = r.tempo.get("B")?.dtSeconds ?? Infinity;
  assert.ok(dt < 1000, "gruppen bagved vinder tid paa forgruppen");
  assert.deepEqual([...(r.tempo.get("B")?.frontRiderIds ?? [])].sort(), ["b2", "b3"], "kun hold B's hjaelpere foerer");
  assert.deepEqual(Object.keys(r.workKm ?? {}).sort(), ["b2", "b3"]);
  assert.equal(r.chases[0]?.teamIds.join(","), "B");
});

test("#7645: en jagt lukker aldrig mere end hullet (gruppen kommer ikke forbi)", () => {
  const gap = VALLEY_SELECTION_7645_TUNING.frontReachSeconds + 1;
  const r = run("team_chase", gap);
  assert.ok((r.tempo.get("B")?.dtSeconds ?? 0) >= 1000 - gap);
});

test("#7645: hjaelpere med brugt budget jager ikke", () => {
  const spent = VALLEY_SELECTION_7645_TUNING.workerBudgetKm;
  const r = run("team_chase", VALLEY_SELECTION_7645_TUNING.frontReachSeconds * 3, { b2: spent, b3: spent });
  assert.equal(r.tempo.get("B")?.dtSeconds, 1030);
  assert.equal(r.chases.length, 0);
});

test("#7645: forgruppens hold holder dem ude og betaler; ingen der arbejder = hullet holder", () => {
  const far = VALLEY_SELECTION_7645_TUNING.frontReachSeconds * 3;
  const chase = run("team_chase", far).tempo.get("B")?.dtSeconds ?? 0;
  const hold = run("team_chase_hold", far);
  assert.ok((hold.tempo.get("B")?.dtSeconds ?? 0) >= chase, "forsvaret goer jagten langsommere");
  assert.ok([...(hold.tempo.get("F")?.frontRiderIds ?? [])].some((id) => id === "a2" || id === "a3"), "hold A's hjaelpere foerer forgruppen");
  // Ingen kandidat bagved (kun hold C, som ikke har en kandidat): ingen jager, ingen forsvarer, hullet vokser ikke.
  const s = scene(far);
  s.groups[1] = { ...s.groups[1], rider_ids: ["c2"] };
  const quiet = valleySelectionTempo7645({ groups: s.groups, tempoByGroup: s.tempo, segments: SEGMENTS, segmentIndex: 1, incidentChasers: undefined, variant: "team_chase_hold", entrants: s.entrants, riders: s.riders, finaleType: "flat_sprint", profileType: "hilly", workKm: undefined });
  assert.equal(quiet.tempo.get("B")?.dtSeconds, 1000);
});

test("#7645: foer etapens foerste stigning og paa andet end fladt/rullende goer kontakten intet", () => {
  const s = scene(VALLEY_SELECTION_7645_TUNING.frontReachSeconds * 3);
  const before = valleySelectionTempo7645({ groups: s.groups, tempoByGroup: s.tempo, segments: [{ kind: "flat", from_km: 0, to_km: 20 }], segmentIndex: 0, incidentChasers: undefined, variant: "team_chase_hold", entrants: s.entrants, riders: s.riders, finaleType: "flat_sprint", profileType: "hilly", workKm: undefined });
  assert.equal(before.tempo, s.tempo);
  const onClimb = valleySelectionTempo7645({ groups: s.groups, tempoByGroup: s.tempo, segments: [SEGMENTS[0], { kind: "climb", from_km: 10, to_km: 20 }], segmentIndex: 1, incidentChasers: undefined, variant: "team_chase_hold", entrants: s.entrants, riders: s.riders, finaleType: "flat_sprint", profileType: "hilly", workKm: undefined });
  assert.equal(onClimb.tempo, s.tempo);
});
