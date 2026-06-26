// backend/lib/raceDistribution.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildColumnSet,
  buildBindingMap,
  dominantTerrain,
  lockedWindowsFromEntries,
  partitionRegenTargets,
  startListVisible,
  daysUntilStart,
  groupGrossSquads,
} from "./raceDistribution.js";

const W = (h) => ({ start: Date.parse(`2026-07-04T${h}:00Z`), end: Date.parse(`2026-07-04T${h}:00Z`) });

test("buildColumnSet: kun egne-pulje scheduled-løb hvis vindue rammer dagen", () => {
  const races = [
    { id: "a", league_division_id: "p1", status: "scheduled", window: W("12") }, // egen pulje, i dag
    { id: "b", league_division_id: "p2", status: "scheduled", window: W("15") }, // fremmed pulje
    { id: "c", league_division_id: "p1", status: "completed", window: W("12") }, // afsluttet
    { id: "d", league_division_id: null, status: "scheduled", window: W("18") }, // pulje-løs (tilladt)
  ];
  const cols = buildColumnSet({
    races,
    teamDivisionId: "p1",
    dayWindow: { start: W("00").start, end: Date.parse("2026-07-04T23:59:00Z") },
  });
  assert.deepEqual(cols.map((r) => r.id).sort(), ["a", "d"]);
});

test("buildBindingMap: rytter udtaget i ét kolonne-løb bindes i de overlappende", () => {
  const columns = [
    { id: "a", window: W("12"), riderIds: ["r1", "r2"] },
    { id: "b", window: W("12"), riderIds: ["r3"] }, // samme tid → overlap med a
    { id: "c", window: W("20"), riderIds: [] }, // senere → ingen overlap
  ];
  const map = buildBindingMap({ columns });
  assert.deepEqual(map["r1"], ["a"]); // r1 er i a, bundet ift. b
  assert.deepEqual(map["r3"], ["b"]);
  assert.equal(map["r9"], undefined);
});

// Rod A (#1823): et afmeldt kolonne-løb binder ikke — dets ryttere er frie til de
// overlappende løb (puljen viser dem ikke som låst).
test("buildBindingMap: afmeldt kolonne binder ikke (frigør ryttere)", () => {
  const columns = [
    { id: "a", window: W("12"), riderIds: ["r1", "r2"] },
    { id: "b", window: W("12"), riderIds: ["r3"] }, // overlapper a
  ];
  const map = buildBindingMap({ columns, withdrawnIds: new Set(["a"]) });
  assert.equal(map["r1"], undefined, "r1 i afmeldt a binder ikke");
  assert.equal(map["r2"], undefined);
  assert.equal(map["r3"], undefined, "b overlapper kun det afmeldte a → r3 fri");
});

test("dominantTerrain: flertal vinder, lige → mixed", () => {
  assert.equal(dominantTerrain(["flat", "flat", "hills"]), "flat");
  assert.equal(dominantTerrain(["flat", "hills"]), "mixed");
  assert.equal(dominantTerrain([]), null);
});

// lockedWindowsFromEntries (#1823 1b + dual-mode): låser ALLE committede entries
// (manuelle OG auto-filled) i løb der IKKE regenereres (excludeRaceIds). Det lukker
// hullet hvor en auto-filled rytter i et ikke-synligt overlappende løb (fx et multi-
// dag-etapeløb) blev dobbeltbooket fordi kun manuelle entries blev låst.
test("lockedWindowsFromEntries: låser ALLE committede entries (manuelle + auto) i ikke-regenererede løb", () => {
  const entries = [
    { race_id: "x", rider_id: "r1", is_auto_filled: false },
    { race_id: "x", rider_id: "r2", is_auto_filled: false },
    { race_id: "y", rider_id: "r3", is_auto_filled: true }, // auto i ANDET løb → låses nu (1b-fix)
  ];
  const windowByRace = new Map([["x", { start: 1, end: 2 }], ["y", { start: 3, end: 4 }]]);
  const locks = lockedWindowsFromEntries({ entries, windowByRace, excludeRaceIds: new Set() });
  const byWindow = Object.fromEntries(locks.map((l) => [l.window.start, l.riderIds.sort()]));
  assert.deepEqual(byWindow[1], ["r1", "r2"]);
  assert.deepEqual(byWindow[3], ["r3"]);
});

test("lockedWindowsFromEntries: excludeRaceIds (de regenererede løb) udelades", () => {
  const entries = [
    { race_id: "x", rider_id: "r1", is_auto_filled: false },
    { race_id: "y", rider_id: "r3", is_auto_filled: true },
  ];
  const windowByRace = new Map([["x", { start: 1, end: 2 }], ["y", { start: 3, end: 4 }]]);
  const locks = lockedWindowsFromEntries({ entries, windowByRace, excludeRaceIds: new Set(["y"]) });
  assert.equal(locks.length, 1);
  assert.deepEqual(locks[0].riderIds, ["r1"]);
});

test("lockedWindowsFromEntries: løb uden vindue ignoreres", () => {
  const entries = [{ race_id: "z", rider_id: "r1", is_auto_filled: true }];
  const locks = lockedWindowsFromEntries({ entries, windowByRace: new Map(), excludeRaceIds: new Set() });
  assert.equal(locks.length, 0);
});

// partitionRegenTargets (#1823 dual-mode + #1825 frys): hvilke kolonner regenereres.
const COLS = [
  { id: "auto", stages_completed: 0 },     // assistent-udfyldt (eller tom)
  { id: "manual", stages_completed: 0 },    // manuelt udtaget
  { id: "started", stages_completed: 3 },   // igangværende → frys
  { id: "withdrawn", stages_completed: 0 }, // afmeldt
];
test("partitionRegenTargets mode=missing: springer manuelle + igangværende over, afmeldte tæller ikke som skipped", () => {
  const { target, skipped } = partitionRegenTargets({
    cols: COLS, withdrawnIds: new Set(["withdrawn"]), manualRaceIds: new Set(["manual"]), mode: "missing",
  });
  assert.deepEqual(target.map((r) => r.id), ["auto"]);
  assert.equal(skipped, 2); // manual + started (afmeldt tæller IKKE)
});

test("partitionRegenTargets mode=all: regenererer også manuelle, men aldrig igangværende", () => {
  const { target, skipped } = partitionRegenTargets({
    cols: COLS, withdrawnIds: new Set(["withdrawn"]), manualRaceIds: new Set(["manual"]), mode: "all",
  });
  assert.deepEqual(target.map((r) => r.id).sort(), ["auto", "manual"]);
  assert.equal(skipped, 1); // kun started (frys gælder uanset mode)
});

test("partitionRegenTargets: igangværende løb fryses i begge modes", () => {
  for (const mode of ["missing", "all"]) {
    const { target } = partitionRegenTargets({ cols: COLS, withdrawnIds: new Set(), manualRaceIds: new Set(), mode });
    assert.ok(!target.find((r) => r.id === "started"), `started fryses i mode=${mode}`);
  }
});

// Race Hub Fase 5 (#1835 / S6): read-only "andre divisioner"-browse — bruttotrupper.
const DAY = 86_400_000;
const NOW = Date.parse("2026-07-04T12:00:00Z");

test("startListVisible: synlig inden for horisonten, låst udenfor", () => {
  assert.equal(startListVisible({ startMs: NOW + 2 * DAY, nowMs: NOW }), true);
  assert.equal(startListVisible({ startMs: NOW + 6 * DAY, nowMs: NOW }), true);
  assert.equal(startListVisible({ startMs: NOW + 7 * DAY, nowMs: NOW }), true, "lige på horisonten = synlig");
  assert.equal(startListVisible({ startMs: NOW + 8 * DAY, nowMs: NOW }), false, "ud over 7 dage = låst");
  assert.equal(startListVisible({ startMs: NOW - 1 * DAY, nowMs: NOW }), true, "allerede startet = synlig");
});

test("startListVisible: kortere horisont kan sættes; ugyldige tider → ikke synlig", () => {
  assert.equal(startListVisible({ startMs: NOW + 5 * DAY, nowMs: NOW, horizonDays: 3 }), false);
  assert.equal(startListVisible({ startMs: NOW + 2 * DAY, nowMs: NOW, horizonDays: 3 }), true);
  assert.equal(startListVisible({ startMs: NaN, nowMs: NOW }), false);
  assert.equal(startListVisible({ startMs: NOW, nowMs: NaN }), false);
});

test("daysUntilStart: afrunder op til hele dage", () => {
  assert.equal(daysUntilStart({ startMs: NOW + 2 * DAY, nowMs: NOW }), 2);
  assert.equal(daysUntilStart({ startMs: NOW + 2 * DAY + 3_600_000, nowMs: NOW }), 3, "delvis dag rundes op");
  assert.equal(daysUntilStart({ startMs: NOW - 1 * DAY, nowMs: NOW }), -1);
  assert.equal(daysUntilStart({ startMs: NaN, nowMs: NOW }), null);
});

test("groupGrossSquads: grupperer pr. hold, kun navn + nationalitet (ingen roller/form/fit)", () => {
  const ridersById = new Map([
    ["r1", { id: "r1", firstname: "Lars", lastname: "Aerts", nationality_code: "BE", race_role: "captain", form: 90, fatigue: 12, suitability: 88 }],
    ["r2", { id: "r2", firstname: "Mads", lastname: "Vos", nationality_code: "NL" }],
    ["r3", { id: "r3", firstname: "Tom", lastname: "Garnier", nationality_code: "FR" }],
  ]);
  const teamsById = new Map([
    ["tA", { id: "tA", name: "Maas Wielerploeg" }],
    ["tB", { id: "tB", name: "Équipe Lorraine" }],
  ]);
  const entries = [
    { race_id: "x", team_id: "tA", rider_id: "r2", race_role: "sprint_captain" },
    { race_id: "x", team_id: "tA", rider_id: "r1", race_role: "captain" },
    { race_id: "x", team_id: "tB", rider_id: "r3", race_role: null },
  ];
  const out = groupGrossSquads({ entries, ridersById, teamsById });
  // Hold sorteret efter navn: "Équipe Lorraine" < "Maas Wielerploeg".
  assert.deepEqual(out.map((g) => g.team.name), ["Équipe Lorraine", "Maas Wielerploeg"]);
  // Maas-trup sorteret efter efternavn: Aerts før Vos.
  const maas = out.find((g) => g.team.id === "tA");
  assert.deepEqual(maas.riders.map((r) => r.lastname), ["Aerts", "Vos"]);
  // KUN strippede felter — ingen race_role/form/fatigue/suitability lækket.
  assert.deepEqual(Object.keys(maas.riders[0]).sort(), ["firstname", "id", "lastname", "nationality_code"]);
});

test("groupGrossSquads: springer ukendte ryttere + hold-løse entries over", () => {
  const ridersById = new Map([["r1", { id: "r1", firstname: "A", lastname: "One", nationality_code: "DK" }]]);
  const entries = [
    { team_id: "t1", rider_id: "r1" },
    { team_id: "t1", rider_id: "ghost" }, // ukendt rytter → udeladt
    { team_id: null, rider_id: "r1" },     // ingen hold → udeladt
  ];
  const out = groupGrossSquads({ entries, ridersById });
  assert.equal(out.length, 1);
  assert.equal(out[0].riders.length, 1);
  assert.equal(out[0].team.name, null, "manglende team-opslag → navn null (id bevares)");
  assert.equal(out[0].team.id, "t1");
});
