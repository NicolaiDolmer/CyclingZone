// backend/lib/raceDistribution.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildColumnSet,
  buildBindingMap,
  buildExternalBindings,
  columnBindingRiderIds,
  filterBindingEntries,
  dominantTerrain,
  lockedWindowsFromEntries,
  partitionRegenTargets,
  partitionClearTargets,
  buildClearPreview,
  startListVisible,
  daysUntilStart,
  groupGrossSquads,
  raceDaysByRace,
  seasonLoadByRider,
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

// #3041: assistentens auto-udtagne picks må aldrig gråne en rytter for et andet
// overlappende løb (de viger automatisk ved gem, #2637) — kun MANUELLE picks og
// entries i allerede STARTEDE løb (frys, #1825) må binde.
test("columnBindingRiderIds: auto-filled binder ikke (løb ikke startet)", () => {
  const selection = { rider_ids: ["r1", "r2"], manual_rider_ids: [] }; // begge auto-udtaget
  assert.deepEqual(columnBindingRiderIds({ selection, startedHere: false }), []);
});

test("columnBindingRiderIds: manuelt udtagne binder altid", () => {
  const selection = { rider_ids: ["r1", "r2"], manual_rider_ids: ["r1"] }; // r1 manuel, r2 auto
  assert.deepEqual(columnBindingRiderIds({ selection, startedHere: false }), ["r1"]);
});

test("columnBindingRiderIds: startet løb (frys) binder ALT, også auto-udtagne", () => {
  const selection = { rider_ids: ["r1", "r2"], manual_rider_ids: [] }; // begge auto-udtaget
  assert.deepEqual(columnBindingRiderIds({ selection, startedHere: true }), ["r1", "r2"]);
});

test("columnBindingRiderIds: ingen udtagelse → tom liste", () => {
  assert.deepEqual(columnBindingRiderIds({ selection: null, startedHere: false }), []);
});

test("buildBindingMap: auto-udtaget entry i ikke-startet løb låser ikke andre kolonner (#3041)", () => {
  // Kalderens ansvar (api.js): riderIds er allerede filtreret via columnBindingRiderIds
  // FØR de når buildBindingMap — her simuleres det: kolonne 'a' har et auto-pick af r1,
  // der ER filtreret fra (tom riderIds), så r1 er fri til det overlappende løb 'b'.
  const columns = [
    { id: "a", window: W("12"), riderIds: [] }, // r1 var auto-udtaget her, men er filtreret ud
    { id: "b", window: W("12"), riderIds: [] }, // overlapper a
  ];
  const map = buildBindingMap({ columns });
  assert.equal(map["r1"], undefined, "auto-udtaget r1 gråner ikke løb b");
});

test("filterBindingEntries: auto-filled i ikke-startet løb filtreres væk", () => {
  const entries = [
    { race_id: "a", rider_id: "r1", is_auto_filled: true },
    { race_id: "b", rider_id: "r2", is_auto_filled: false }, // manuel
  ];
  const result = filterBindingEntries({ entries, startedRaceIds: new Set() });
  assert.deepEqual(result, [{ race_id: "b", rider_id: "r2", is_auto_filled: false }]);
});

test("filterBindingEntries: manuelle entries beholdes uanset løbsstatus", () => {
  const entries = [{ race_id: "a", rider_id: "r1", is_auto_filled: false }];
  const result = filterBindingEntries({ entries, startedRaceIds: new Set() });
  assert.deepEqual(result, entries);
});

test("filterBindingEntries: auto-filled i STARTET løb beholdes (frys, #1825)", () => {
  const entries = [{ race_id: "a", rider_id: "r1", is_auto_filled: true }];
  const result = filterBindingEntries({ entries, startedRaceIds: new Set(["a"]) });
  assert.deepEqual(result, entries);
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

// partitionClearTargets (#2599 "Ryd dag"/"Ryd alt"): en bekræftet ryd-handling rydder
// ALT (inkl. manuelle) — kun frys (#1825) undtager et løb.
test("partitionClearTargets: rydder både auto- og manuel-kolonner, men ALDRIG igangværende", () => {
  const { target, skipped } = partitionClearTargets({ cols: COLS });
  assert.deepEqual(target.map((r) => r.id).sort(), ["auto", "manual", "withdrawn"]);
  assert.equal(skipped, 1); // kun "started" fryses
});

test("partitionClearTargets: tom kolonne-liste → intet target, intet skipped", () => {
  const { target, skipped } = partitionClearTargets({ cols: [] });
  assert.deepEqual(target, []);
  assert.equal(skipped, 0);
});

// buildClearPreview (#3061): konsekvens-forhåndsvisning til "Clear all"-dialogen.
const PREVIEW_NOW = Date.parse("2026-07-26T10:00:00Z");
test("buildClearPreview: kun reelt KOMMENDE løb, sorteret efter starttidspunkt", () => {
  const cols = [
    { id: "soon", name: "Tour Belge", stages_completed: 0 },
    { id: "later", name: "Roskilde Rundt", stages_completed: 0 },
    { id: "started", name: "Igangværende", stages_completed: 3 }, // frys — udelades helt
  ];
  const windowByRace = new Map([
    ["soon", { start: PREVIEW_NOW + 4 * 3_600_000 }],
    ["later", { start: PREVIEW_NOW + 26 * 3_600_000 }],
    ["started", { start: PREVIEW_NOW - 3_600_000 }],
  ]);
  const { races } = buildClearPreview({ cols, windowByRace, nowMs: PREVIEW_NOW });
  assert.deepEqual(races.map((r) => r.id), ["soon", "later"]); // nærmeste først, "started" fryses væk
  assert.equal(races[0].name, "Tour Belge");
});

test("buildClearPreview: løb uden schedule-data eller allerede forbi sin starttid tælles ikke med", () => {
  const cols = [
    { id: "no-window", name: "Ukendt tid", stages_completed: 0 },
    { id: "past", name: "Skulle være kørt", stages_completed: 0 },
  ];
  const windowByRace = new Map([
    ["no-window", null],
    ["past", { start: PREVIEW_NOW - 1000 }],
  ]);
  const { races } = buildClearPreview({ cols, windowByRace, nowMs: PREVIEW_NOW });
  assert.deepEqual(races, []);
});

test("buildClearPreview: ingen kolonner → tom liste (dialogen skal ikke vises)", () => {
  assert.deepEqual(buildClearPreview({ cols: [], windowByRace: new Map(), nowMs: PREVIEW_NOW }), { races: [] });
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

// #2256: buildExternalBindings — bindings for løb UDEN FOR dagens kolonner.
test("buildExternalBindings: kolonne-løb + afmeldte + løb uden vindue filtreres fra", () => {
  const W = (d) => ({ start: d, end: d });
  const map = buildExternalBindings({
    entries: [
      { race_id: "col-1", rider_id: "r1" },       // dagens kolonne → ude
      { race_id: "ext-1", rider_id: "r1" },       // ekstern → med
      { race_id: "ext-2", rider_id: "r2" },       // afmeldt → ude
      { race_id: "ext-3", rider_id: "r3" },       // intet binding-vindue → ude
      { race_id: "ext-1", rider_id: "r4" },       // ekstern → med
    ],
    columnIds: new Set(["col-1"]),
    withdrawnIds: new Set(["ext-2"]),
    windowByRace: new Map([["col-1", W(1)], ["ext-1", W(5)], ["ext-2", W(6)]]),
    nameByRace: new Map([["ext-1", "Vuelta al Sol"]]),
  });
  assert.deepEqual(map.r1, [{ id: "ext-1", name: "Vuelta al Sol", window: W(5) }]);
  assert.deepEqual(map.r4, [{ id: "ext-1", name: "Vuelta al Sol", window: W(5) }]);
  assert.equal(map.r2, undefined, "afmeldt løb binder ikke");
  assert.equal(map.r3, undefined, "løb uden vindue kan ikke binde");
});

test("buildExternalBindings: manglende navn → null; tom input → tom map", () => {
  const map = buildExternalBindings({
    entries: [{ race_id: "ext-1", rider_id: "r1" }],
    columnIds: new Set(),
    withdrawnIds: new Set(),
    windowByRace: new Map([["ext-1", { start: 2, end: 3 }]]),
    nameByRace: new Map(),
  });
  assert.equal(map.r1[0].name, null);
  assert.deepEqual(buildExternalBindings({}), {});
});

// ── #4245: løbsdage != etaper ────────────────────────────────────────────────
// Den regressionstest der VILLE have fanget fejlen: feltet raceDays summerede
// races.stages (etapetal). Det var kun tilfældigt rigtigt så længe hver etape fik
// sin egen game_day. docs/CALENDAR_RULES.md §0 + §2b: rytteren bindes pr. LØBSDAG.
//
// Belastning != binding: bindingen er hele spændet min..max game_day (ejer-direktiv
// 25/8, #4217, CALENDAR_RULES §2b + §8). Belastning er de løbsdage rytteren faktisk
// kører på — springene imellem er ikke hviledage, men halvdags-slots hvor puljens
// ØVRIGE løb kører. De to tal er bevidst forskellige.

test("raceDaysByRace: to etaper på samme løbsdag tæller ÉN løbsdag (#4245)", () => {
  const rows = [
    { race_id: "a", stage_number: 1, game_day: 4 },
    { race_id: "a", stage_number: 2, game_day: 4 }, // samme løbsdag → ikke en ekstra dag
    { race_id: "b", stage_number: 1, game_day: 10 },
    { race_id: "b", stage_number: 2, game_day: 13 }, // spring på 3 dage
  ];
  const m = raceDaysByRace(rows);
  assert.equal(m.get("a"), 1, "to etaper, én løbsdag (den gamle etape-sum gav 2)");
  assert.equal(
    m.get("b"),
    2,
    "belastning = de løbsdage rytteren kører på; spændet 10..13 er BINDINGEN (#4217) og ville give 4"
  );
});

test("raceDaysByRace: rækker uden brugbar game_day ignoreres", () => {
  const rows = [
    { race_id: "a", stage_number: 1, game_day: null },
    { race_id: "a", stage_number: 2, game_day: 7 },
    { race_id: "c", stage_number: 1, game_day: undefined },
  ];
  const m = raceDaysByRace(rows);
  assert.equal(m.get("a"), 1);
  assert.equal(m.has("c"), false, "løb helt uden game_day får ingen post når der ikke gives et fallback-kort");
  assert.equal(raceDaysByRace().size, 0);
});

test("raceDaysByRace: fælles fallback — løb uden game_day-rækker får etapetallet (#4245)", () => {
  // Rework-fund: Race Hub faldt til 1 løbsdag, planner-boardet til etapetal. Et
  // delvist backfillet etapeløb viste derfor 1 dag på den ene skærm og 8 på den
  // anden. Fallbacket bor nu ÉT sted, så begge flader falder ens tilbage.
  const rows = [{ race_id: "a", stage_number: 1, game_day: 4 }];
  const stagesByRaceId = new Map([["a", 3], ["b", 8], ["c", null], ["d", 0]]);
  const m = raceDaysByRace(rows, { stagesByRaceId });
  assert.equal(m.get("a"), 1, "løb MED game_day-rækker bruger de distinkte dage, ikke etapetallet");
  assert.equal(m.get("b"), 8, "løb uden game_day-rækker falder til etapetallet, ikke til 1");
  assert.equal(m.get("c"), 1, "ubrugeligt etapetal → mindst 1");
  assert.equal(m.get("d"), 1, "0 etaper → mindst 1 (0 ville skjule belastnings-chippen tavst)");
});

test("seasonLoadByRider: løbsdage summeres fra løbsdags-kortet, ikke fra etaper (#4245)", () => {
  const entries = [
    { race_id: "a", rider_id: "r1" },
    { race_id: "b", rider_id: "r1" },
    { race_id: "b", rider_id: "r2" },
  ];
  // "a" har 3 etaper men kun 1 løbsdag; "b" har 2 etaper på 2 løbsdage.
  const raceDaysByRaceId = new Map([["a", 1], ["b", 2]]);
  assert.deepEqual(seasonLoadByRider({ entries, raceDaysByRaceId }), {
    r1: { races: 2, raceDays: 3 },
    r2: { races: 1, raceDays: 2 },
  });
});

test("seasonLoadByRider: løb uden løbsdags-data tæller som mindst én løbsdag", () => {
  // Fallback-grenen skal give 1, ALDRIG 0. Chippen i AvailableRidersPool er gated
  // på `load.raceDays > 0`, så en 0-værdi ville skjule belastningen tavst.
  assert.deepEqual(
    seasonLoadByRider({ entries: [{ race_id: "z", rider_id: "r1" }], raceDaysByRaceId: new Map() }),
    { r1: { races: 1, raceDays: 1 } }
  );
  assert.deepEqual(
    seasonLoadByRider({ entries: [{ race_id: "z", rider_id: "r1" }], raceDaysByRaceId: new Map([["z", 0]]) }),
    { r1: { races: 1, raceDays: 1 } }
  );
  assert.deepEqual(seasonLoadByRider(), {});
});

test("seasonLoadByRider: entries uden for den aktive sæson tælles ikke (#4245)", () => {
  // Chippens copy siger "tilmeldt denne sæson". race_entries er ikke sæson-scopet,
  // så uden seasonRaceIds tælles gamle sæsoners entries med. Målt i prod 27/8:
  // 68.661 af 94.184 entries var fra tidligere sæsoner.
  const entries = [
    { race_id: "nu-1", rider_id: "r1" },
    { race_id: "nu-2", rider_id: "r1" },
    { race_id: "gammel-1", rider_id: "r1" }, // sæson 2
    { race_id: "gammel-2", rider_id: "r2" }, // sæson 2 — r2 har intet i år
  ];
  const raceDaysByRaceId = new Map([["nu-1", 1], ["nu-2", 3]]);
  const seasonRaceIds = new Set(["nu-1", "nu-2"]);

  assert.deepEqual(
    seasonLoadByRider({ entries, raceDaysByRaceId, seasonRaceIds }),
    { r1: { races: 2, raceDays: 4 } },
    "kun den aktive sæsons entries; r2 forsvinder helt i stedet for at vise 1 løb"
  );

  // Uden filteret: den gamle, oppustede adfærd — dokumenteret, så et fremtidigt
  // kald der glemmer seasonRaceIds ikke ser ud som om det var meningen.
  assert.deepEqual(seasonLoadByRider({ entries, raceDaysByRaceId }), {
    r1: { races: 3, raceDays: 5 },
    r2: { races: 1, raceDays: 1 },
  });
});
