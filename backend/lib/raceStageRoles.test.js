// Race Engine v3 (#2224), slice S3 (#2034) — race_stage_roles-resolution.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveStageEntrant,
  resolveStageEntrants,
  effortsSequenceForRider,
  effortByRiderForStage,
  serializeStageRoleOverrides,
  loadStageRoleOverrides,
  orderEffortByRiderForStage,
  resolvedEffortByRiderForStage,
} from "./raceStageRoles.js";

// ── resolveStageEntrant: fallback-kæde ────────────────────────────────────────

test("resolveStageEntrant: ingen override for etapen → falder til entrant.race_role, effort='normal'", () => {
  const entrant = { rider_id: "r1", race_role: "helper" };
  const resolved = resolveStageEntrant(entrant, undefined);
  assert.equal(resolved.race_role, "helper");
  assert.equal(resolved.effort, "normal");
});

test("resolveStageEntrant: override for RYTTEREN på DENNE etape vinder over basis-rollen", () => {
  const entrant = { rider_id: "r1", race_role: "helper" };
  const overridesForStage = new Map([["r1", { race_role: "captain", effort: "protect" }]]);
  const resolved = resolveStageEntrant(entrant, overridesForStage);
  assert.equal(resolved.race_role, "captain");
  assert.equal(resolved.effort, "protect");
});

test("resolveStageEntrant: override for en ANDEN rytter påvirker ikke denne", () => {
  const entrant = { rider_id: "r1", race_role: "helper" };
  const overridesForStage = new Map([["r2", { race_role: "captain", effort: "protect" }]]);
  const resolved = resolveStageEntrant(entrant, overridesForStage);
  assert.equal(resolved.race_role, "helper");
  assert.equal(resolved.effort, "normal");
});

test("resolveStageEntrant: entrant uden basis-race_role og ingen override → ingen rolle (nøglen udelades)", () => {
  const entrant = { rider_id: "r1" };
  const resolved = resolveStageEntrant(entrant, undefined);
  assert.equal(resolved.race_role, undefined);
  assert.ok(!("race_role" in resolved), "race_role-nøglen skal være fraværende, ikke undefined-værdi");
  assert.equal(resolved.effort, "normal");
});

test("resolveStageEntrant: override sætter KUN rolle uden effort → effort falder alligevel til 'normal' (DB-schema garanterer effort NOT NULL, men defensivt)", () => {
  const entrant = { rider_id: "r1", race_role: "helper" };
  const overridesForStage = new Map([["r1", { race_role: "hunter" }]]);
  const resolved = resolveStageEntrant(entrant, overridesForStage);
  assert.equal(resolved.race_role, "hunter");
  assert.equal(resolved.effort, "normal");
});

test("resolveStageEntrant: bevarer entrantens øvrige felter (spread)", () => {
  const entrant = { rider_id: "r1", race_role: "helper", team_id: "A", abilities: { climbing: 50 } };
  const resolved = resolveStageEntrant(entrant, undefined);
  assert.equal(resolved.team_id, "A");
  assert.deepEqual(resolved.abilities, { climbing: 50 });
});

// ── #5223: resolveStageEntrants — hold-niveau-sammenfletning ──────────────────
//
// Rodårsagen bag Sentry CYCLINGZONE-5Z: basisrollen (race_entries.race_role) og
// etape-rollen (race_stage_roles) blev flettet PR. RYTTER, så holdets basis-
// sprint_captain og en etape-override på en ANDEN rytter begge kom igennem som
// sprint_captain for samme (hold, etape).

const ov = (rows) => new Map(rows.map(([riderId, race_role, effort = "normal"]) => [riderId, { race_role, effort }]));

test("resolveStageEntrants: basis-sprint_captain A + etape-override sprint_captain på B → PRÆCIS én sprint_captain (dublet-input, #5223)", () => {
  const entrants = [
    { rider_id: "rA", team_id: "T", race_role: "sprint_captain" },
    { rider_id: "rB", team_id: "T", race_role: "helper" },
  ];
  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, ov([["rB", "sprint_captain"]]));

  const captains = resolved.filter((r) => r.race_role === "sprint_captain");
  assert.equal(captains.length, 1, "netop én sprint_captain på holdet");
  assert.equal(captains[0].rider_id, "rB", "etape-rollen vinder over basisrollen");
  assert.equal(resolved[0].race_role, "helper", "basis-indehaveren degraderes til helper for DENNE etape");
  assert.deepEqual(conflicts, [], "tilsigtet taktik — ikke en data-anomali, intet signal");
});

test("resolveStageEntrants: samme dublet ville i dag udløse motorens duplicate-signal — efter sammenfletningen gør den ikke (#5223/#4357)", async () => {
  const { buildTeamContext } = await import("./raceSimulator.js");
  const ability = Object.fromEntries(["climbing", "sprinting", "time_trial", "endurance", "recovery", "durability", "positioning", "descending", "cobbles", "punch"].map((k) => [k, 60]));
  const entrants = [
    { rider_id: "rA", team_id: "T", race_role: "sprint_captain", abilities: ability },
    { rider_id: "rB", team_id: "T", race_role: "helper", abilities: ability },
  ];
  const overrides = ov([["rB", "sprint_captain"]]);
  const terrainById = new Map([["rA", 0.5], ["rB", 0.5]]);

  // FØR-tilstanden: pr.-rytter-resolution (den gamle sti) → to sprint_captains.
  const perRider = entrants.map((e) => resolveStageEntrant(e, overrides));
  const before = [];
  buildTeamContext({ entrants: perRider, terrainById, captureExceptionFn: (err, ctx) => before.push({ message: err.message, ctx }) });
  assert.equal(before.length, 1, "pr.-rytter-resolution udløser dublet-signalet");
  assert.match(before[0].message, /duplicate sprint_captain/);

  // EFTER: hold-niveau-resolution → intet signal, og B (etape-rollen) er lederen.
  const after = [];
  const ctx = buildTeamContext({
    entrants: resolveStageEntrants(entrants, overrides).entrants,
    terrainById,
    captureExceptionFn: (err, c) => after.push({ message: err.message, c }),
  });
  assert.deepEqual(after, [], "ingen dublet tilbage at rapportere");
  assert.equal(ctx.get("T").sprintCaptainId, "rB");
});

test("resolveStageEntrants: forfremmelses-stien (#5202) — udgået basis-kaptajn stadig i entrants + ny etape-kaptajn → ingen dublet", () => {
  // Gemme-guarden lader en forfremmelse passere når basis-indehaveren er udgået
  // (#5202). Er han af en anden grund stadig med i entrant-listen, må motoren
  // ikke se to captains.
  const entrants = [
    { rider_id: "rDNF", team_id: "T", race_role: "captain" },
    { rider_id: "rNew", team_id: "T", race_role: "helper" },
    { rider_id: "rC", team_id: "T", race_role: "helper" },
  ];
  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, ov([["rNew", "captain"]]));
  assert.deepEqual(resolved.map((r) => r.race_role), ["helper", "captain", "helper"]);
  assert.deepEqual(conflicts, []);
});

test("resolveStageEntrants: hunter er også eksklusiv pr. hold/etape (#4746, RACE_ENGINE_RULES §7 modsigelse 12)", () => {
  const entrants = [
    { rider_id: "rA", team_id: "T", race_role: "hunter" },
    { rider_id: "rB", team_id: "T", race_role: "helper" },
  ];
  const { entrants: resolved } = resolveStageEntrants(entrants, ov([["rB", "hunter"]]));
  assert.equal(resolved.filter((r) => r.race_role === "hunter").length, 1);
  assert.equal(resolved[1].race_role, "hunter");
});

test("resolveStageEntrants: to ETAPE-overrides med samme rolle (rå/legacy-data) → laveste rider_id vinder + conflict rapporteres", () => {
  const entrants = [
    { rider_id: "r9", team_id: "T", race_role: "helper" },
    { rider_id: "r1", team_id: "T", race_role: "helper" },
  ];
  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, ov([["r9", "sprint_captain"], ["r1", "sprint_captain"]]));
  assert.equal(resolved.filter((r) => r.race_role === "sprint_captain").length, 1);
  assert.equal(resolved[1].race_role, "sprint_captain", "r1 < r9 → r1 vinder");
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], {
    teamId: "T", role: "sprint_captain", source: "stage_override", keptRiderId: "r1", droppedRiderIds: ["r9"],
  });
});

test("resolveStageEntrants: vinderen er uafhængig af entrants-rækkefølgen (determinisme, ikke DB-orden)", () => {
  const a = { rider_id: "r1", team_id: "T", race_role: "helper" };
  const b = { rider_id: "r9", team_id: "T", race_role: "helper" };
  const overrides = ov([["r1", "captain"], ["r9", "captain"]]);
  const ab = resolveStageEntrants([a, b], overrides).entrants.find((r) => r.race_role === "captain");
  const ba = resolveStageEntrants([b, a], overrides).entrants.find((r) => r.race_role === "captain");
  assert.equal(ab.rider_id, "r1");
  assert.equal(ba.rider_id, "r1");
});

test("resolveStageEntrants: to BASIS-indehavere uden overrides (DB-indexet forhindrer det) → laveste rider_id vinder, source=base_role", () => {
  const entrants = [
    { rider_id: "r9", team_id: "T", race_role: "captain" },
    { rider_id: "r1", team_id: "T", race_role: "captain" },
  ];
  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, undefined);
  assert.equal(resolved[1].race_role, "captain");
  assert.equal(resolved[0].race_role, "helper");
  assert.equal(conflicts[0].source, "base_role");
});

test("resolveStageEntrants: forskellige hold påvirker ikke hinanden", () => {
  const entrants = [
    { rider_id: "a1", team_id: "A", race_role: "sprint_captain" },
    { rider_id: "b1", team_id: "B", race_role: "sprint_captain" },
  ];
  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, undefined);
  assert.deepEqual(resolved.map((r) => r.race_role), ["sprint_captain", "sprint_captain"]);
  assert.deepEqual(conflicts, []);
});

test("resolveStageEntrants: helper/free_role er IKKE eksklusive — flere af hver pr. hold er lovligt", () => {
  const entrants = [
    { rider_id: "r1", team_id: "T", race_role: "helper" },
    { rider_id: "r2", team_id: "T", race_role: "helper" },
    { rider_id: "r3", team_id: "T", race_role: "free_role" },
    { rider_id: "r4", team_id: "T", race_role: "free_role" },
  ];
  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, undefined);
  assert.deepEqual(resolved.map((r) => r.race_role), ["helper", "helper", "free_role", "free_role"]);
  assert.deepEqual(conflicts, []);
});

test("resolveStageEntrants: uden dublet er outputtet identisk med entrants.map(resolveStageEntrant) (bit-identitet)", () => {
  const entrants = [
    { rider_id: "r1", team_id: "T", race_role: "captain", abilities: { climbing: 50 } },
    { rider_id: "r2", team_id: "T", race_role: "helper" },
    { rider_id: "r3", team_id: "U", race_role: "sprint_captain" },
    { rider_id: "r4", team_id: null },
  ];
  const overrides = ov([["r2", "hunter", "all_out"]]);
  assert.deepEqual(
    resolveStageEntrants(entrants, overrides).entrants,
    entrants.map((e) => resolveStageEntrant(e, overrides))
  );
});

test("resolveStageEntrants: rytter uden hold tælles aldrig med i en hold-konflikt", () => {
  const entrants = [
    { rider_id: "r1", race_role: "captain" },
    { rider_id: "r2", race_role: "captain" },
  ];
  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, undefined);
  assert.deepEqual(resolved.map((r) => r.race_role), ["captain", "captain"]);
  assert.deepEqual(conflicts, []);
});

test("resolveStageEntrants: en udgået rytter kan ikke vinde en konflikt og degraderer ikke en aktiv holdkammerat (CodeRabbit-fund)", () => {
  // To etape-overrides på samme rolle, hvor den LAVESTE rider_id er udgået.
  // Uden ineligibleRiderIds ville han vinde, r9 blev degraderet — og kald-stedet
  // filtrerer så vinderen væk. Holdet ville stå uden sprint_captain.
  const entrants = [
    { rider_id: "r1", team_id: "T", race_role: "helper" },
    { rider_id: "r9", team_id: "T", race_role: "helper" },
  ];
  const overrides = ov([["r1", "sprint_captain"], ["r9", "sprint_captain"]]);

  const naive = resolveStageEntrants(entrants, overrides);
  assert.equal(naive.entrants[0].race_role, "sprint_captain", "uden eksklusion vinder r1");

  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, overrides, {
    ineligibleRiderIds: new Set(["r1"]),
  });
  assert.equal(resolved[1].race_role, "sprint_captain", "r9 er den eneste der kører — han beholder rollen");
  assert.deepEqual(conflicts, [], "kun én berettiget indehaver tilbage → ingen konflikt");
});

test("resolveStageEntrants: udgået basis-indehaver blokerer ikke en aktiv etape-override", () => {
  const entrants = [
    { rider_id: "rDNF", team_id: "T", race_role: "captain" },
    { rider_id: "rNew", team_id: "T", race_role: "helper" },
  ];
  const { entrants: resolved, conflicts } = resolveStageEntrants(entrants, ov([["rNew", "captain"]]), {
    ineligibleRiderIds: new Set(["rDNF"]),
  });
  assert.equal(resolved[1].race_role, "captain");
  assert.deepEqual(conflicts, []);
});

test("resolveStageEntrants: tom liste → tomt resultat", () => {
  assert.deepEqual(resolveStageEntrants([], undefined), { entrants: [], conflicts: [] });
});

// ── effortsSequenceForRider ────────────────────────────────────────────────────

test("effortsSequenceForRider: tom/manglende stageRoleOverrides → null (kald-stedet falder tilbage til enkelt-effort)", () => {
  assert.equal(effortsSequenceForRider(undefined, "r1", [1, 2, 3]), null);
  assert.equal(effortsSequenceForRider(new Map(), "r1", [1, 2, 3]), null);
});

test("effortsSequenceForRider: bygger effort PR. ETAPE, 'normal' hvor der ingen override er", () => {
  const overrides = new Map([
    [1, new Map([["r1", { race_role: "helper", effort: "protect" }]])],
    [3, new Map([["r1", { race_role: "helper", effort: "save" }]])],
  ]);
  assert.deepEqual(effortsSequenceForRider(overrides, "r1", [1, 2, 3]), ["protect", "normal", "save"]);
});

test("effortsSequenceForRider: en ANDEN rytters override lækker ikke ind", () => {
  const overrides = new Map([[1, new Map([["r2", { race_role: "helper", effort: "protect" }]])]]);
  assert.deepEqual(effortsSequenceForRider(overrides, "r1", [1, 2]), ["normal", "normal"]);
});

// ── effortByRiderForStage ──────────────────────────────────────────────────────

test("effortByRiderForStage: ingen overrides for etapen → null", () => {
  assert.equal(effortByRiderForStage(undefined, 1), null);
  assert.equal(effortByRiderForStage(new Map(), 1), null);
  assert.equal(effortByRiderForStage(new Map([[1, new Map()]]), 1), null);
});

test("effortByRiderForStage: returnerer Map(rider_id → effort) for DENNE etape", () => {
  const overrides = new Map([
    [1, new Map([["r1", { race_role: "helper", effort: "protect" }], ["r2", { race_role: "captain", effort: "normal" }]])],
    [2, new Map([["r1", { race_role: "helper", effort: "save" }]])],
  ]);
  const forStage1 = effortByRiderForStage(overrides, 1);
  assert.equal(forStage1.get("r1"), "protect");
  assert.equal(forStage1.get("r2"), "normal");
  const forStage2 = effortByRiderForStage(overrides, 2);
  assert.equal(forStage2.get("r1"), "save");
  assert.equal(forStage2.has("r2"), false);
});

// ── serializeStageRoleOverrides ────────────────────────────────────────────────

test("serializeStageRoleOverrides: flad, sorteret [[stage, rider_id, role, effort]]", () => {
  const overrides = new Map([
    [2, new Map([["rB", { race_role: "captain", effort: "normal" }]])],
    [1, new Map([["rZ", { race_role: "helper", effort: "protect" }], ["rA", { race_role: "hunter", effort: "save" }]])],
  ]);
  const flat = serializeStageRoleOverrides(overrides);
  assert.deepEqual(flat, [
    [1, "rA", "hunter", "save"],
    [1, "rZ", "helper", "protect"],
    [2, "rB", "captain", "normal"],
  ]);
});

test("serializeStageRoleOverrides: tom Map → tomt array", () => {
  assert.deepEqual(serializeStageRoleOverrides(new Map()), []);
});

test("serializeStageRoleOverrides: deterministisk uanset insertion-rækkefølge", () => {
  const a = new Map([[1, new Map([["x", { race_role: "helper", effort: "normal" }]])], [2, new Map([["y", { race_role: "hunter", effort: "save" }]])]]);
  const b = new Map([[2, new Map([["y", { race_role: "hunter", effort: "save" }]])], [1, new Map([["x", { race_role: "helper", effort: "normal" }]])]]);
  assert.deepEqual(serializeStageRoleOverrides(a), serializeStageRoleOverrides(b));
});

// ── loadStageRoleOverrides (I/O, minimal mock-supabase) ────────────────────────

function makeSupabase({ rows = [], error = null } = {}) {
  function from() {
    const b = {
      select() { return b; },
      eq() { return b; },
      then(resolve, reject) {
        return Promise.resolve({ data: error ? null : rows, error }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("loadStageRoleOverrides: grupperer rækker stage → rider → {race_role, effort}", async () => {
  const supabase = makeSupabase({
    rows: [
      { stage_number: 1, rider_id: "r1", race_role: "helper", effort: "protect" },
      { stage_number: 1, rider_id: "r2", race_role: "captain", effort: "normal" },
      { stage_number: 2, rider_id: "r1", race_role: "hunter", effort: "save" },
    ],
  });
  const overrides = await loadStageRoleOverrides({ supabase, raceId: "race-1" });
  assert.equal(overrides.get(1).get("r1").race_role, "helper");
  assert.equal(overrides.get(1).get("r1").effort, "protect");
  assert.equal(overrides.get(1).get("r2").race_role, "captain");
  assert.equal(overrides.get(2).get("r1").race_role, "hunter");
});

test("loadStageRoleOverrides: ingen rækker → tom Map", async () => {
  const overrides = await loadStageRoleOverrides({ supabase: makeSupabase({ rows: [] }), raceId: "race-1" });
  assert.equal(overrides.size, 0);
});

test("loadStageRoleOverrides: DB-fejl → kaster Error", async () => {
  const supabase = makeSupabase({ error: { message: "connection refused" } });
  await assert.rejects(
    () => loadStageRoleOverrides({ supabase, raceId: "race-1" }),
    /race_stage_roles/
  );
});

// ── #5580 (spec motor runde 2, M1 punkt 6 + 7): én kilde til effort ──────────

const ORDER_ROWS = [
  { team_id: "t1", stage_number: 2, riders: [{ rider_id: "r1", effort: "all_out" }, { rider_id: "r2", effort: "bogus" }] },
  { team_id: "t2", stage_number: 2, riders: [{ rider_id: "r3", effort: "save" }] },
  { team_id: "t1", stage_number: 3, riders: [{ rider_id: "r1", effort: "grupetto" }] },
];

test("#5580 orderEffortByRiderForStage: kun denne etape, kun kendte trin; null uden ordrer", () => {
  const stage2 = orderEffortByRiderForStage(ORDER_ROWS, 2);
  assert.deepEqual([...stage2.entries()].sort(), [["r1", "all_out"], ["r3", "save"]]);
  assert.equal(stage2.has("r2"), false, "en ukendt effort-vaerdi er aldrig et indsatsvalg");
  assert.deepEqual([...orderEffortByRiderForStage(ORDER_ROWS, 3).entries()], [["r1", "grupetto"]]);
  assert.equal(orderEffortByRiderForStage(ORDER_ROWS, 9), null);
  assert.equal(orderEffortByRiderForStage([], 2), null);
  assert.equal(orderEffortByRiderForStage(undefined, 2), null);
});

test("#5580 resolveStageEntrant: ordrens effort vinder over stage-raekken; stage-raekken er fallback", () => {
  const overrides = new Map([
    ["r1", { race_role: "captain", effort: "save" }],
    ["r4", { race_role: "helper", effort: "protect" }],
  ]);
  const orders = new Map([["r1", "all_out"]]);
  const r1 = resolveStageEntrant({ rider_id: "r1", race_role: "helper" }, overrides, orders);
  assert.equal(r1.effort, "all_out", "ordren er sandheden");
  assert.equal(r1.race_role, "captain", "rollen roeres ikke af ordren");
  assert.equal(resolveStageEntrant({ rider_id: "r4" }, overrides, orders).effort, "protect", "fallback til stage-raekken");
  assert.equal(resolveStageEntrant({ rider_id: "r9" }, overrides, orders).effort, "normal");
});

test("#5580 resolveStageEntrant(s): uden ordre-kort er resultatet bit-identisk med foer (v3-stien)", () => {
  const overrides = new Map([["r1", { race_role: "captain", effort: "save" }]]);
  const entrants = [{ rider_id: "r1", team_id: "t1", race_role: "helper" }, { rider_id: "r2", team_id: "t1" }];
  assert.deepEqual(resolveStageEntrants(entrants, overrides), resolveStageEntrants(entrants, overrides, { orderEffortByRider: null }));
  assert.deepEqual(resolveStageEntrant(entrants[0], overrides), resolveStageEntrant(entrants[0], overrides, null));
});

test("#5580 resolveStageEntrants: ordre-kortet naar igennem hold-niveau-resolutionen", () => {
  const entrants = [{ rider_id: "r1", team_id: "t1", race_role: "captain" }];
  const { entrants: out } = resolveStageEntrants(entrants, undefined, { orderEffortByRider: new Map([["r1", "protect"]]) });
  assert.equal(out[0].effort, "protect");
});

test("#5580 resolvedEffortByRiderForStage: traetheden bruger samme kilde som motoren (ordre > stage-raekke)", () => {
  const stageRoleOverrides = new Map([
    [2, new Map([["r1", { race_role: "helper", effort: "save" }], ["r4", { race_role: "helper", effort: "protect" }]])],
  ]);
  const merged = resolvedEffortByRiderForStage(stageRoleOverrides, 2, orderEffortByRiderForStage(ORDER_ROWS, 2));
  assert.equal(merged.get("r1"), "all_out");
  assert.equal(merged.get("r3"), "save");
  assert.equal(merged.get("r4"), "protect");
  // Uden ordrer: praecis effortByRiderForStage (v3-stiens kilde).
  assert.deepEqual(resolvedEffortByRiderForStage(stageRoleOverrides, 2, null), effortByRiderForStage(stageRoleOverrides, 2));
  assert.equal(resolvedEffortByRiderForStage(undefined, 2, null), null);
  assert.deepEqual([...resolvedEffortByRiderForStage(undefined, 3, orderEffortByRiderForStage(ORDER_ROWS, 3)).entries()], [["r1", "grupetto"]]);
});
