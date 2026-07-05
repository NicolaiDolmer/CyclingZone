// frontend/src/lib/raceHubLogic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeColumnStatus, isRiderBound, deriveRaceStatus, poolRaceDayTotals, fitTier, freshnessTier, draftBindingMap, windowsOverlap, canAddRiderToColumn, overlapConflictColumn, riderColumnState, findSelectionOverlaps, groupColumnsByGameDay, sameDayCompatibilityHint } from "./raceHubLogic.js";

const W = (g) => ({ start: g, end: g }); // 1-dags in-game-vindue på game-dag g

test("groupColumnsByGameDay: grupperer + sorterer efter spil-dag, null-gruppe sidst", () => {
  const cols = [
    { id: "A", game_day: 11, game_day_end: 11 },
    { id: "B", game_day: 10, game_day_end: 10 },
    { id: "C", game_day: null },
    { id: "D", game_day: 10, game_day_end: 10 },
  ];
  const groups = groupColumnsByGameDay(cols);
  assert.deepEqual(groups.map((g) => g.gameDay), [10, 11, null]);
  assert.deepEqual(groups[0].columns.map((c) => c.id), ["B", "D"]); // rækkefølge bevaret i gruppen
});

test("groupColumnsByGameDay: etapeløb → gameDayEnd = seneste spil-dag", () => {
  const groups = groupColumnsByGameDay([{ id: "S", game_day: 12, game_day_end: 15 }]);
  assert.deepEqual(groups, [{ gameDay: 12, gameDayEnd: 15, columns: [{ id: "S", game_day: 12, game_day_end: 15 }] }]);
});

test("sameDayCompatibilityHint: rytter i et andet (ikke-overlappende) løb → navn + spil-dag", () => {
  const columns = [
    { id: "A", game_day: 10, name: "Léon", selection: { rider_ids: ["r1"] } },
    { id: "B", game_day: 11, name: "Navarra", selection: { rider_ids: [] } },
  ];
  const hint = sameDayCompatibilityHint({ column: columns[1], columns, riderId: "r1" });
  assert.deepEqual(hint, { raceId: "A", name: "Léon", gameDay: 10 });
});

test("sameDayCompatibilityHint: afmeldte løb tæller ikke; ingen andre løb → null", () => {
  const columns = [
    { id: "A", game_day: 10, name: "Léon", withdrawn: true, selection: { rider_ids: ["r1"] } },
    { id: "B", game_day: 11, name: "Navarra", selection: { rider_ids: [] } },
  ];
  assert.equal(sameDayCompatibilityHint({ column: columns[1], columns, riderId: "r1" }), null);
});

test("draftBindingMap: binder rytter til de kolonner han er i kladden, med game-dag-vindue (ekskl. afmeldte)", () => {
  const cols = [
    { id: "A", withdrawn: false, bindingWindow: W(4), selection: { rider_ids: ["r1", "r2"] } },
    { id: "B", withdrawn: false, bindingWindow: W(4), selection: { rider_ids: ["r2"] } },
    { id: "C", withdrawn: true, bindingWindow: W(5), selection: { rider_ids: ["r1"] } },
  ];
  const map = draftBindingMap(cols);
  assert.deepEqual(map.r1, [{ id: "A", window: W(4) }]); // C er afmeldt → tæller ikke
  assert.deepEqual(map.r2.map((e) => e.id).sort(), ["A", "B"]);
});

test("windowsOverlap: deler game-dag → true; forskellige game-dage → false", () => {
  assert.equal(windowsOverlap(W(4), W(4)), true);
  assert.equal(windowsOverlap(W(4), W(5)), false);
  assert.equal(windowsOverlap({ start: 4, end: 8 }, W(5)), true); // etapeløb-span dækker gd5
  assert.equal(windowsOverlap(null, W(4)), false);
});

test("computeColumnStatus: full / understaffed / withdrawn", () => {
  assert.deepEqual(computeColumnStatus({ selected: 6, target: 6, withdrawn: false }), { kind: "full", selected: 6, target: 6 });
  assert.deepEqual(computeColumnStatus({ selected: 5, target: 7, withdrawn: false }), { kind: "understaffed", selected: 5, target: 7 });
  assert.deepEqual(computeColumnStatus({ selected: 0, target: 8, withdrawn: true }), { kind: "withdrawn", selected: 0, target: 8 });
  // Rod A: transient over max (kladde-bytte på fuld trup) → overfull, ikke full.
  assert.deepEqual(computeColumnStatus({ selected: 7, target: 6, max: 6, withdrawn: false }), { kind: "overfull", selected: 7, target: 6 });
  assert.deepEqual(computeColumnStatus({ selected: 6, target: 6, max: 6, withdrawn: false }), { kind: "full", selected: 6, target: 6 });
});

test("isRiderBound: kun bundet når game-dag-vinduer overlapper (samme IRL-dag ≠ binding)", () => {
  // r1 er i a (gd4); b er gd4 (overlapper → bundet); c er gd5 (samme IRL-dag, anden game-dag → IKKE bundet).
  const bindingMap = { r1: [{ id: "a", window: W(4) }] };
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "b", forWindow: W(4) }), true);
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "c", forWindow: W(5) }), false, "anden game-dag → fri");
  assert.equal(isRiderBound({ bindingMap, riderId: "r1", forRaceId: "a", forWindow: W(4) }), false); // a er hans eget løb
  assert.equal(isRiderBound({ bindingMap, riderId: "r9", forRaceId: "b", forWindow: W(4) }), false);
});

test("canAddRiderToColumn: game-dag-fri kolonne på samme IRL-dag er tilføjbar", () => {
  const bindingMap = { r1: [{ id: "a", window: W(4) }] };
  const colB = { id: "b", bindingWindow: W(4), selection: { rider_ids: [] } }; // gd4 → bundet
  const colC = { id: "c", bindingWindow: W(5), selection: { rider_ids: [] } }; // gd5 → fri
  assert.equal(canAddRiderToColumn({ column: colB, bindingMap, riderId: "r1" }), false);
  assert.equal(canAddRiderToColumn({ column: colC, bindingMap, riderId: "r1" }), true);
  assert.equal(canAddRiderToColumn({ column: { ...colC, withdrawn: true }, bindingMap, riderId: "r1" }), false);
  assert.equal(canAddRiderToColumn({ column: { ...colC, selection: { rider_ids: ["r1"] } }, bindingMap, riderId: "r1" }), false);
});

// deriveRaceStatus (#1828): visnings-status afledt af stages_completed. Backend
// skriver ALDRIG 'active' (finalization-invarianter); fronten afleder "live".
test("deriveRaceStatus: scheduled + ingen etaper kørt → scheduled", () => {
  assert.equal(deriveRaceStatus("scheduled", 0, 7), "scheduled");
});

test("deriveRaceStatus: scheduled + nogle (ikke alle) etaper kørt → live (#1828)", () => {
  assert.equal(deriveRaceStatus("scheduled", 3, 7), "live");
  assert.equal(deriveRaceStatus("scheduled", 1, 7), "live");
});

test("deriveRaceStatus: completed → completed uanset etape-tal", () => {
  assert.equal(deriveRaceStatus("completed", 7, 7), "completed");
  assert.equal(deriveRaceStatus("completed", 0, 7), "completed");
});

test("deriveRaceStatus: scheduled men alle etaper kørt → completed (status-flip undervejs)", () => {
  assert.equal(deriveRaceStatus("scheduled", 7, 7), "completed");
});

test("deriveRaceStatus: endagsløb (stages=1) bliver aldrig live", () => {
  assert.equal(deriveRaceStatus("scheduled", 0, 1), "scheduled");
  assert.equal(deriveRaceStatus("scheduled", 1, 1), "completed");
});

test("deriveRaceStatus: robust mod manglende stages", () => {
  assert.equal(deriveRaceStatus("scheduled", 0, 0), "scheduled");
  assert.equal(deriveRaceStatus("scheduled", 0, null), "scheduled");
});

// poolRaceDayTotals (#1829): per-pulje løbsdage-tæller. total = sum(stages);
// completed = løbsdage faktisk kørt INKL. igangværende etaper; inProgress = de
// løbsdage der hører til løb som stadig kører (ærligt mellemregnings-tal).
test("poolRaceDayTotals: total = sum(stages); completed inkluderer igangværende etaper", () => {
  const races = [
    { status: "completed", stages: 1, stages_completed: 1 },  // endagsløb færdig → 1/1
    { status: "scheduled", stages: 7, stages_completed: 3 },  // etapeløb i gang → 3 af 7
    { status: "scheduled", stages: 5, stages_completed: 0 },  // ikke startet → 0 af 5
  ];
  assert.deepEqual(poolRaceDayTotals(races), { completed: 4, total: 13, inProgress: 3 });
});

test("poolRaceDayTotals: completed-løb tæller alle sine etaper selv hvis stages_completed mangler", () => {
  assert.deepEqual(poolRaceDayTotals([{ status: "completed", stages: 21, stages_completed: 0 }]),
    { completed: 21, total: 21, inProgress: 0 });
});

test("poolRaceDayTotals: tom liste → nul", () => {
  assert.deepEqual(poolRaceDayTotals([]), { completed: 0, total: 0, inProgress: 0 });
  assert.deepEqual(poolRaceDayTotals(), { completed: 0, total: 0, inProgress: 0 });
});

test("poolRaceDayTotals: manglende stages → tæller som 1 (matcher DEFAULT 1)", () => {
  assert.deepEqual(poolRaceDayTotals([{ status: "scheduled", stages: null, stages_completed: 0 }]),
    { completed: 0, total: 1, inProgress: 0 });
});

test("poolRaceDayTotals: stages_completed klampes til [0, stages] (defensivt mod inkonsistent data)", () => {
  assert.deepEqual(poolRaceDayTotals([{ status: "scheduled", stages: 7, stages_completed: 9 }]),
    { completed: 7, total: 7, inProgress: 0 });
});

// fitTier/freshnessTier: centraliserede tærskler (erstatter inline-tal som fatigue>50).
test("fitTier: strong/average/poor + null ved manglende score", () => {
  assert.equal(fitTier(80), "strong");
  assert.equal(fitTier(66), "strong");
  assert.equal(fitTier(50), "average");
  assert.equal(fitTier(40), "average");
  assert.equal(fitTier(20), "poor");
  assert.equal(fitTier(null), null);
  assert.equal(fitTier(undefined), null);
});

test("freshnessTier: fresh/ok/tired + null ved manglende værdi", () => {
  assert.equal(freshnessTier(0), "fresh");
  assert.equal(freshnessTier(33), "fresh");
  assert.equal(freshnessTier(34), "ok");
  assert.equal(freshnessTier(66), "ok");
  assert.equal(freshnessTier(67), "tired");
  assert.equal(freshnessTier(null), null);
});

test("overlapConflictColumn: returnerer det overlappende løb rytteren allerede er i (#1984)", () => {
  const colBur = { id: "bur", name: "Burgalesa", bindingWindow: W(3), selection: { rider_ids: ["yonas"] } };
  const colChe = { id: "che", name: "Chesapeake", bindingWindow: W(3), selection: { rider_ids: [] } };
  const colMun = { id: "mun", name: "Münsterland", bindingWindow: W(5), selection: { rider_ids: [] } };
  const columns = [colBur, colChe, colMun];
  const bindingMap = draftBindingMap(columns);
  // Yonas blokeret fra Chesapeake (gd3) → konflikt er Burgalesa.
  assert.deepEqual(
    overlapConflictColumn({ column: colChe, columns, bindingMap, riderId: "yonas" }),
    colBur,
  );
  // Münsterland (gd5) overlapper ikke → ingen konflikt.
  assert.equal(overlapConflictColumn({ column: colMun, columns, bindingMap, riderId: "yonas" }), null);
  // Ukendt rytter → null.
  assert.equal(overlapConflictColumn({ column: colChe, columns, bindingMap, riderId: "nobody" }), null);
});

test("riderColumnState: riding / overlap / available / locked (#1984)", () => {
  const colBur = { id: "bur", name: "Burgalesa", bindingWindow: W(3), selection: { rider_ids: ["yonas"] } };
  const colChe = { id: "che", name: "Chesapeake", bindingWindow: W(3), selection: { rider_ids: [] } };
  const colMun = { id: "mun", name: "Münsterland", bindingWindow: W(5), selection: { rider_ids: [] } };
  const colDone = { id: "done", name: "Started", bindingWindow: W(5), lineup_locked: true, selection: { rider_ids: [] } };
  const bindingMap = draftBindingMap([colBur, colChe, colMun, colDone]);
  assert.equal(riderColumnState({ column: colBur, bindingMap, riderId: "yonas" }), "riding");
  assert.equal(riderColumnState({ column: colChe, bindingMap, riderId: "yonas" }), "overlap");
  assert.equal(riderColumnState({ column: colMun, bindingMap, riderId: "yonas" }), "available");
  assert.equal(riderColumnState({ column: colDone, bindingMap, riderId: "yonas" }), "locked");
});

test("findSelectionOverlaps: én rytter i to overlappende løb → konflikt med begge navne (#1983/#1984)", () => {
  const cols = [
    { id: "bur", name: "Burgalesa", bindingWindow: W(3), selection: { rider_ids: ["yonas", "theo"] } },
    { id: "che", name: "Chesapeake", bindingWindow: W(3), selection: { rider_ids: ["yonas"] } },
    { id: "mun", name: "Münsterland", bindingWindow: W(5), selection: { rider_ids: ["yonas"] } },
    { id: "wd", name: "Withdrawn", withdrawn: true, bindingWindow: W(3), selection: { rider_ids: ["theo"] } },
  ];
  const overlaps = findSelectionOverlaps({ columns: cols });
  assert.equal(overlaps.length, 1, "kun Burgalesa∩Chesapeake (gd3); Münsterland gd5 overlapper ikke; afmeldt tæller ikke");
  assert.equal(overlaps[0].riderId, "yonas");
  assert.deepEqual(overlaps[0].raceNames.sort(), ["Burgalesa", "Chesapeake"]);
});

test("findSelectionOverlaps: ingen overlap → tom liste", () => {
  const cols = [
    { id: "a", name: "A", bindingWindow: W(3), selection: { rider_ids: ["r1"] } },
    { id: "b", name: "B", bindingWindow: W(5), selection: { rider_ids: ["r1"] } },
  ];
  assert.deepEqual(findSelectionOverlaps({ columns: cols }), []);
});
