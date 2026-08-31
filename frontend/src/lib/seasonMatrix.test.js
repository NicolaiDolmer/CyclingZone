import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyRaceDraft, buildDraftsFromEntries, roleOf, setRiderRole, removeRiderFromRace, raceDraftDirty, dirtyRaceIds,
  buildDayColumns, raceDateRangeLabel, buildRiderRowSegments, countProblems,
  buildRaceHeaderGroups, riderLoadDays, roleBadgeClass, conflictingEntryForRace, raceLockLabel, buildSaveError,
} from "./seasonMatrix.js";

test("buildDraftsFromEntries: grupperer entries pr. løb og udleder rolle-felter", () => {
  const drafts = buildDraftsFromEntries([
    { raceId: "r1", riderId: "a", raceRole: "captain" },
    { raceId: "r1", riderId: "b", raceRole: "helper" },
    { raceId: "r1", riderId: "c", raceRole: "free_role" },
    { raceId: "r2", riderId: "d", raceRole: "sprint_captain" },
  ]);
  assert.deepEqual(drafts.get("r1").rider_ids, ["a", "b", "c"]);
  assert.equal(drafts.get("r1").captain_id, "a");
  assert.deepEqual(drafts.get("r1").free_role_ids, ["c"]);
  assert.equal(drafts.get("r2").sprint_captain_id, "d");
});

test("roleOf: helper når rytteren er i rider_ids uden noget rolle-felt", () => {
  const d = { ...emptyRaceDraft(), rider_ids: ["a"] };
  assert.equal(roleOf(d, "a"), "helper");
  assert.equal(roleOf(d, "z"), null);
});

test("setRiderRole: sætter rollen direkte (celle-popoverens rollevalg, #4323) — tilføjer ryttereren hvis han ikke allerede er i truppen", () => {
  let d = emptyRaceDraft();
  d = setRiderRole(d, "a", "hunter");
  assert.equal(roleOf(d, "a"), "hunter");
  assert.equal(d.rider_ids.includes("a"), true);
});

test("setRiderRole: skift fra én rolle til en anden for samme rytter (ingen dublet i rider_ids/free_role_ids)", () => {
  let d = emptyRaceDraft();
  d = setRiderRole(d, "a", "free_role");
  d = setRiderRole(d, "a", "captain");
  assert.equal(roleOf(d, "a"), "captain");
  assert.deepEqual(d.free_role_ids, []);
  assert.deepEqual(d.rider_ids, ["a"]);
});

test("setRiderRole: overtagelse af en eksklusiv rolle degraderer den forrige indehaver til helper (aldrig to captains)", () => {
  let d = emptyRaceDraft();
  d = setRiderRole(d, "a", "captain");
  assert.equal(roleOf(d, "a"), "captain");
  d = setRiderRole(d, "b", "captain"); // b overtager
  assert.equal(roleOf(d, "b"), "captain");
  assert.equal(roleOf(d, "a"), "helper", "a skal degraderes til helper, ikke forsvinde fra truppen");
  assert.equal(d.rider_ids.includes("a"), true);
});

test("removeRiderFromRace: fjerner rytteren helt fra kladden (celle-popoverens 'Fjern fra løbet')", () => {
  let d = emptyRaceDraft();
  d = setRiderRole(d, "a", "captain");
  d = removeRiderFromRace(d, "a");
  assert.equal(roleOf(d, "a"), null);
  assert.equal(d.rider_ids.includes("a"), false);
  assert.equal(d.captain_id, null);
});

test("conflictingEntryForRace (refutations-fund #4323, 27/8): finder løbet rytteren allerede sidder i, naar dets spaend overlapper kandidatloebets — repro fra fundet (GT dag 1-10 + endagsloeb dag 5)", () => {
  const races = [
    { id: "r_A", name: "GT", gameDayStart: 1, gameDayEnd: 10 },
    { id: "r_B", name: "Endagsloeb", gameDayStart: 5, gameDayEnd: 5 },
  ];
  // Rytteren er allerede captain i r_B (dag 5) — r_A's spaend (1-10) daekker
  // dag 5, saa r_A skal vises som konflikt naar rytteren proever at vaelge den.
  const draftByRace = new Map([
    ["r_A", emptyRaceDraft()],
    ["r_B", { ...emptyRaceDraft(), rider_ids: ["rider1"], captain_id: "rider1" }],
  ]);
  const conflict = conflictingEntryForRace("rider1", races[0], races, draftByRace);
  assert.equal(conflict?.id, "r_B");
  assert.equal(conflict?.name, "Endagsloeb");
});

test("conflictingEntryForRace: ikke-overlappende loeb giver ingen konflikt", () => {
  const races = [
    { id: "r1", name: "Loeb 1", gameDayStart: 1, gameDayEnd: 3 },
    { id: "r2", name: "Loeb 2", gameDayStart: 4, gameDayEnd: 6 },
  ];
  const draftByRace = new Map([
    ["r1", emptyRaceDraft()],
    ["r2", { ...emptyRaceDraft(), rider_ids: ["rider1"], captain_id: "rider1" }],
  ]);
  assert.equal(conflictingEntryForRace("rider1", races[0], races, draftByRace), null);
});

test("conflictingEntryForRace: samme loeb er ALDRIG en konflikt (rolle-skift er lovligt)", () => {
  const races = [{ id: "r1", name: "Loeb 1", gameDayStart: 1, gameDayEnd: 3 }];
  const draftByRace = new Map([["r1", { ...emptyRaceDraft(), rider_ids: ["rider1"], captain_id: "rider1" }]]);
  assert.equal(conflictingEntryForRace("rider1", races[0], races, draftByRace), null);
});

test("conflictingEntryForRace: rytteren har ingen anden udtagelse -> ingen konflikt", () => {
  const races = [
    { id: "r1", name: "Loeb 1", gameDayStart: 1, gameDayEnd: 3 },
    { id: "r2", name: "Loeb 2", gameDayStart: 2, gameDayEnd: 4 },
  ];
  const draftByRace = new Map([["r1", emptyRaceDraft()], ["r2", emptyRaceDraft()]]);
  assert.equal(conflictingEntryForRace("rider1", races[0], races, draftByRace), null);
});

test("setRiderRole: blocked-guarden (defense-in-depth, #4323) er et no-op — draften returneres uaendret", () => {
  const d = emptyRaceDraft();
  const result = setRiderRole(d, "rider1", "captain", true);
  assert.equal(result, d, "blocked skal returnere PRAECIS samme draft-reference, ingen mutation");
  assert.equal(roleOf(result, "rider1"), null);
});

test("setRiderRole: blocked=false (default) opfoerer sig som foer — ingen regression", () => {
  const d = setRiderRole(emptyRaceDraft(), "rider1", "captain", false);
  assert.equal(roleOf(d, "rider1"), "captain");
});

test("roleBadgeClass: kaptajn/sprint-kaptajn faar gold-tint, resten neutral", () => {
  assert.match(roleBadgeClass("captain"), /accent\/25/);
  assert.match(roleBadgeClass("sprint_captain"), /accent\/25/);
  assert.match(roleBadgeClass("hunter"), /accent\/10/);
  assert.match(roleBadgeClass("helper"), /accent\/10/);
});

// #3410-genbrug (spillertest-punkt 2+3, Discord 29/8): SAMME i18n-nøgler som
// rytterpuljens fix — raceLockLabel duplikerer ikke matrixens egen formulering.
test("raceLockLabel: navngivet konflikt bruger racehub.boundNamed (samme nøgle som rytterpuljen)", () => {
  const calls = [];
  const t = (key, params) => { calls.push([key, params]); return `T:${key}`; };
  const label = raceLockLabel({ id: "r2", name: "Ocean Road Classic" }, t);
  assert.equal(label, "T:racehub.boundNamed");
  assert.deepEqual(calls, [["racehub.boundNamed", { race: "Ocean Road Classic" }]]);
});

test("raceLockLabel: null konflikt -> null (ingen tekst)", () => {
  assert.equal(raceLockLabel(null, () => "x"), null);
});

test("raceDraftDirty + dirtyRaceIds: kun reelt ændrede løb rapporteres", () => {
  const server = new Map([["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }]]);
  const draft = new Map([
    ["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }], // uændret
    ["r2", { ...emptyRaceDraft(), rider_ids: ["b"] }], // nyt løb, ikke på serveren
  ]);
  assert.equal(raceDraftDirty(draft.get("r1"), server.get("r1")), false);
  assert.deepEqual(dirtyRaceIds(draft, server), ["r2"]);
});

// Akse-konvertering (kontrakt #7, ejer-låst 27-28/8, spillertest-punkt 6): ÉN
// kolonne pr. (løb, løbsdag) — ikke pr. delt game_day.
test("buildDayColumns: én kolonne pr. (løb, løbsdag), race-relativt 1-baseret stageIndex", () => {
  const races = [
    { id: "r1", gameDayStart: 3, gameDayEnd: 5 },
    { id: "r3", gameDayStart: 10, gameDayEnd: 11 },
  ];
  const cols = buildDayColumns(races);
  assert.deepEqual(cols.map((c) => [c.raceId, c.gameDay, c.stageIndex]), [
    ["r1", 3, 1], ["r1", 4, 2], ["r1", 5, 3],
    ["r3", 10, 1], ["r3", 11, 2],
  ]);
});

test("buildDayColumns: to løb der deler en kalenderdag (D1-normalen) bliver to ADSKILTE kolonner, ikke én fælles", () => {
  const races = [
    { id: "r1", gameDayStart: 5, gameDayEnd: 5 },
    { id: "r2", gameDayStart: 5, gameDayEnd: 5 },
  ];
  const cols = buildDayColumns(races);
  assert.equal(cols.length, 2, "to loeb paa samme dag = to kolonner, ikke en delt kolonne");
  assert.deepEqual(cols.map((c) => c.raceId), ["r1", "r2"]);
  assert.deepEqual(cols.map((c) => c.gameDay), [5, 5]);
});

test("buildDayColumns: løb uden gyldigt spænd (mangler game_day) bidrager intet", () => {
  const races = [{ id: "r1", gameDayStart: null, gameDayEnd: null }];
  assert.deepEqual(buildDayColumns(races), []);
});

// #4535 — datobåndene (buildDateBands) er fjernet; datoen bor i SeasonView-
// båndet + som ét spænd pr. løbs-header.
test("raceDateRangeLabel: tværs af måneder, samme måned, endagsløb og ukendt dato", () => {
  assert.equal(raceDateRangeLabel("2027-08-28", "2027-09-08"), "28 AUG – 8 SEP");
  assert.equal(raceDateRangeLabel("2027-09-01", "2027-09-05"), "1–5 SEP");
  assert.equal(raceDateRangeLabel("2027-09-05", "2027-09-05"), "5 SEP");
  assert.equal(raceDateRangeLabel("2027-09-05", null), "5 SEP");
  assert.equal(raceDateRangeLabel(null, "2027-09-05"), null);
});

test("buildRiderRowSegments: ét spænd pr. holdudtag (kontrakt #3), tomme celler ellers", () => {
  const races = [
    { id: "gt", gameDayStart: 2, gameDayEnd: 6 },
    { id: "oneDay", gameDayStart: 8, gameDayEnd: 8 },
  ];
  const dayColumns = buildDayColumns(races);
  const draftByRace = new Map([
    ["gt", { ...emptyRaceDraft(), rider_ids: ["rider1"], captain_id: "rider1" }],
    ["oneDay", emptyRaceDraft()],
  ]);
  const segs = buildRiderRowSegments(dayColumns, races, draftByRace, "rider1");
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0], { kind: "entry", race: races[0], role: "captain", days: [2, 3, 4, 5, 6], colSpan: 5 });
  assert.deepEqual(segs[1], { kind: "empty", day: 8, raceId: "oneDay" });
});

test("buildRiderRowSegments: to løb der deler en dag giver TO adskilte segmenter for rytteren (ingen klip/forskydning — kolonnerne er nu adskilte)", () => {
  // Ulovlig kladde-tilstand (DB-constraint no_rider_double_booking_day skulle
  // forhindre den, men gitteret må aldrig krakelere hvis den alligevel opstår):
  // rytteren er "udtaget" til A(1-2) OG B(2-3), som overlapper på dag 2. Efter
  // akse-konverteringen (kontrakt #7) er A's og B's kolonner ADSKILTE, så begge
  // udtagelser vises som deres EGET segment i stedet for at konkurrere om én
  // delt kolonne.
  const races = [
    { id: "A", gameDayStart: 1, gameDayEnd: 2 },
    { id: "B", gameDayStart: 2, gameDayEnd: 3 },
    { id: "C", gameDayStart: 4, gameDayEnd: 4 },
  ];
  const dayColumns = buildDayColumns(races);
  const draftByRace = new Map([
    ["A", { ...emptyRaceDraft(), rider_ids: ["rider1"], captain_id: "rider1" }],
    ["B", { ...emptyRaceDraft(), rider_ids: ["rider1"] }],
    ["C", { ...emptyRaceDraft(), rider_ids: ["rider1"] }],
  ]);
  const segs = buildRiderRowSegments(dayColumns, races, draftByRace, "rider1");
  assert.deepEqual(segs.map((s) => ({ kind: s.kind, race: s.race?.id ?? null, colSpan: s.colSpan ?? 1 })), [
    { kind: "entry", race: "A", colSpan: 2 },
    { kind: "entry", race: "B", colSpan: 2 },
    { kind: "entry", race: "C", colSpan: 1 },
  ]);
  const totalCols = segs.reduce((n, s) => n + (s.colSpan ?? 1), 0);
  assert.equal(totalCols, dayColumns.length);

  // Uafhængigt: countProblems() opdager og tæller konflikten (peer-conflict),
  // så den forbliver synlig i problemtælleren.
  const problems = countProblems(races, draftByRace);
  assert.ok(problems.peerConflicts.some((c) => c.riderId === "rider1" && [c.raceIdA, c.raceIdB].includes("A") && [c.raceIdA, c.raceIdB].includes("B")));
  assert.ok(problems.affectedRiderIds.has("rider1"));
});

test("dirtyRaceIds: taeller PRAECIS det antal Gem plan-knappen skal vise", () => {
  const server = new Map([
    ["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }],
    ["r2", { ...emptyRaceDraft(), rider_ids: ["b"] }],
    ["r3", { ...emptyRaceDraft(), rider_ids: ["c"] }],
  ]);
  const draft = new Map([
    ["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }], // uændret
    ["r2", { ...emptyRaceDraft(), rider_ids: ["b", "d"] }], // ændret
    ["r3", { ...emptyRaceDraft(), rider_ids: [] }], // ændret (ryttere fjernet)
  ]);
  const ids = dirtyRaceIds(draft, server);
  assert.equal(ids.length, 2, "kun r2 og r3 er reelt dirty");
  assert.deepEqual([...ids].sort(), ["r2", "r3"]);
});

test("countProblems: overfyldt løb tælles med", () => {
  const races = [{ id: "r1", gameDayStart: 1, gameDayEnd: 1, sizeMin: 6, sizeMax: 6 }];
  const draftByRace = new Map([["r1", { ...emptyRaceDraft(), rider_ids: ["a", "b", "c", "d", "e", "f", "g"] }]]);
  const p = countProblems(races, draftByRace);
  assert.equal(p.count, 1);
  assert.ok(p.affectedRaceIds.has("r1"));
});

test("countProblems: samme rytter i to overlappende løb i kladden er en peer-konflikt", () => {
  const races = [
    { id: "r1", gameDayStart: 1, gameDayEnd: 3, sizeMin: 6, sizeMax: 8 },
    { id: "r2", gameDayStart: 2, gameDayEnd: 2, sizeMin: 6, sizeMax: 6 },
  ];
  const draftByRace = new Map([
    ["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }],
    ["r2", { ...emptyRaceDraft(), rider_ids: ["a"] }],
  ]);
  const p = countProblems(races, draftByRace);
  assert.equal(p.count, 1);
  assert.equal(p.peerConflicts.length, 1);
  assert.ok(p.affectedRiderIds.has("a"));
});

test("countProblems: ingen problemer → 'No problems'-tilstanden (count 0, tomme sæt)", () => {
  const races = [{ id: "r1", gameDayStart: 1, gameDayEnd: 1, sizeMin: 6, sizeMax: 6 }];
  const draftByRace = new Map([["r1", { ...emptyRaceDraft(), rider_ids: ["a"] }]]);
  const p = countProblems(races, draftByRace);
  assert.equal(p.count, 0);
});

test("buildRaceHeaderGroups: efter akse-konverteringen er hver kolonne entydigt ét løb — altid ÉN lane, colSpan summerer til alle kolonner", () => {
  const races = [
    { id: "gt", gameDayStart: 2, gameDayEnd: 4 },
    { id: "one", gameDayStart: 6, gameDayEnd: 6 },
  ];
  const dayColumns = buildDayColumns(races);
  const lanes = buildRaceHeaderGroups(dayColumns);
  assert.equal(lanes.laneCount, 1);
  assert.equal(lanes.length, 1);
  const groups = lanes[0];
  assert.equal(groups.length, 2);
  assert.equal(groups[0].raceId, "gt");
  assert.deepEqual(groups[0].days, [2, 3, 4]);
  assert.equal(groups[0].colSpan, 3);
  assert.equal(groups[1].raceId, "one");
  const totalCols = groups.reduce((n, g) => n + g.colSpan, 0);
  assert.equal(totalCols, dayColumns.length);
});

test("buildRaceHeaderGroups: to løb der deler en dag (D1-normalen) giver to ADSKILTE grupper i samme lane, ikke en lane-konflikt", () => {
  // A og B deler løbsdag 2 (D1-normalen: op til 5 løb samme dag). Før akse-
  // konverteringen krævede dette lane-pakning (packRaceLanes, nu fjernet) — nu
  // er A's dag-2-kolonne og B's dag-2-kolonne simpelthen to FORSKELLIGE
  // kolonner side om side, så begge grupper ligger problemfrit i lane 0.
  const races = [
    { id: "A", gameDayStart: 1, gameDayEnd: 2 },
    { id: "B", gameDayStart: 2, gameDayEnd: 3 },
    { id: "C", gameDayStart: 4, gameDayEnd: 4 },
  ];
  const dayColumns = buildDayColumns(races);
  assert.equal(dayColumns.length, 5, "A(2)+B(2)+C(1) = 5 adskilte kolonner, ikke 4 delte dage");

  const lanes = buildRaceHeaderGroups(dayColumns);
  assert.equal(lanes.laneCount, 1);
  const groups = lanes[0];
  assert.deepEqual(groups.map((g) => g.raceId), ["A", "B", "C"]);
  const sum = groups.reduce((n, g) => n + g.colSpan, 0);
  assert.equal(sum, dayColumns.length);
});

test("riderLoadDays: summerer løbsdage over ALLE løb rytteren er udtaget til i kladden", () => {
  const races = [
    { id: "gt", gameDayStart: 2, gameDayEnd: 6 }, // 5 dage
    { id: "one", gameDayStart: 8, gameDayEnd: 8 }, // 1 dag
  ];
  const draftByRace = new Map([
    ["gt", { ...emptyRaceDraft(), rider_ids: ["a"] }],
    ["one", { ...emptyRaceDraft(), rider_ids: ["a"] }],
  ]);
  assert.equal(riderLoadDays(races, draftByRace, "a"), 6);
  assert.equal(riderLoadDays(races, draftByRace, "z"), 0);
});

// Spillertest-punkt 1 (Discord 29/8): PUT /races/selection/bulk's fejlsvar
// oversat/navngivet, ikke en generisk "prøv igen".
const RACES = [
  { id: "r1", name: "Grand Prix de Namur" },
  { id: "r2", name: "Tour des Hauts Plateaux" },
];
const RIDERS = [{ id: "rider-1", name: "Ada Pedersen" }, { id: "rider-2", name: "Bo Madsen" }];

test("buildSaveError: pr.-løb-validering (fx trupløft) navngiver det ramte løb", () => {
  const err = buildSaveError({ error: "selection_wrong_size", race_id: "r1", max: 6 }, RACES, RIDERS);
  assert.equal(err.code, "selection_wrong_size");
  assert.equal(err.raceId, "r1");
  assert.equal(err.raceName, "Grand Prix de Namur");
  assert.deepEqual(err.params, {});
});

test("buildSaveError: selection_rider_bound (db_conflict) er allerede navngivet af serveren (rider_name/race_name)", () => {
  const body = {
    error: "selection_rider_bound", race_id: "r1",
    conflicts: [{ rider_id: "rider-1", rider_name: "Ada Pedersen", race_id: "r2", race_name: "Tour des Hauts Plateaux" }],
  };
  const err = buildSaveError(body, RACES, RIDERS);
  assert.equal(err.code, "selection_rider_bound_named");
  assert.equal(err.raceId, "r1");
  assert.equal(err.raceName, "Grand Prix de Namur");
  assert.deepEqual(err.params, { rider: "Ada Pedersen", race: "Tour des Hauts Plateaux" });
});

test("buildSaveError: selection_rider_bound (peer_conflict) leverer kun raa ids — slaas op mod races/riders client-side", () => {
  const body = {
    error: "selection_rider_bound", race_id: "r1",
    conflicts: [{ rider_id: "rider-1", race_id: "r1", conflict_race_id: "r2" }],
  };
  const err = buildSaveError(body, RACES, RIDERS);
  assert.equal(err.code, "selection_rider_bound_named");
  assert.deepEqual(err.params, { rider: "Ada Pedersen", race: "Tour des Hauts Plateaux" });
});

// #4534 (regression, live-fund 31/8): backend afviser nu OGSÅ fjernelser fra startede
// løb med selection_race_started (samme fejlklasse som tilføjelser). Kataloget skal
// navngive det ramte løb, så cellen/banneret forklarer sig selv — races.json har
// allerede EN+DA-teksten ("This race has started, so the lineup is locked").
test("buildSaveError: selection_race_started (afvist fjernelse, #4534) navngiver det ramte løb", () => {
  const err = buildSaveError({ error: "selection_race_started", race_id: "r2" }, RACES, RIDERS);
  assert.equal(err.code, "selection_race_started");
  assert.equal(err.raceId, "r2");
  assert.equal(err.raceName, "Tour des Hauts Plateaux");
  assert.deepEqual(err.params, {});
});

test("buildSaveError: selection_bulk_too_large bærer max, intet berørt løb", () => {
  const err = buildSaveError({ error: "selection_bulk_too_large", max: 60 }, RACES, RIDERS);
  assert.equal(err.code, "selection_bulk_too_large");
  assert.equal(err.raceId, null);
  assert.deepEqual(err.params, { max: 60 });
});

test("buildSaveError: ukendt/manglende body falder tilbage til generic uden at kaste", () => {
  const err = buildSaveError({}, RACES, RIDERS);
  assert.equal(err.code, "generic");
  assert.equal(err.raceId, null);
  assert.equal(err.raceName, null);
});
