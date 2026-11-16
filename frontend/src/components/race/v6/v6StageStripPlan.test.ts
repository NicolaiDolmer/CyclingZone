// #7865 (beta-klar, #7778 valg 21-22): planens tilstand pr. etape, vindernavn paa alle
// koerte etaper og ægte roving tabindex i etapestriben. Opdigtede navne og id'er.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  v6NamesFromResults, v6PlanState, v6SavedStages, v6StripCells, v6StripKeyTarget, v6StripTabStop, v6StripWinners, v6WinnerIdsByStage,
} from "./racePageV6Model.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const captainTeam = [
  { rider_id: "r1", name: "Kaj Lind", race_role: "captain" },
  { rider_id: "r2", name: "Ole Sand", race_role: "helper" },
];
const noCaptainTeam = [
  { rider_id: "r1", name: "Kaj Lind", race_role: "helper" },
  { rider_id: "r2", name: "Ole Sand", race_role: "hunter" },
];

// ── Planens tilstand (valg 21; ordet er "Gemt", valg 7) ──

test("gemte etaper: samme kilder som Taktik (gemte etaper og ordrerækker); uden svar ukendt", () => {
  assert.deepEqual([...(v6SavedStages({ savedStageNumbers: [4, 0, -1], orders: [{ stage_number: 5 }, { stage_number: null }] }) ?? [])].sort(), [4, 5]);
  assert.deepEqual([...(v6SavedStages({ savedStageNumbers: [], orders: [] }) ?? [])], []);
  assert.equal(v6SavedStages(null), null, "team-orders ikke hentet eller fejlede");
  assert.equal(v6SavedStages(undefined), null);
});

test("Gemt: en gemt plan for netop etapen, ogsaa naar den kun staar som rolle-undtagelse", () => {
  assert.equal(v6PlanState({ stage: 4, savedStages: new Set([4]), riders: noCaptainTeam, overrides: [] }), "saved");
  const overrides = [{ stage_number: 5, rider_id: "r2", race_role: "captain", effort: "all_out" }];
  assert.equal(v6PlanState({ stage: 5, savedStages: new Set<number>(), riders: noCaptainTeam, overrides }), "saved");
  assert.equal(v6PlanState({ stage: 5, savedStages: null, riders: noCaptainTeam, overrides }), "saved", "undtagelsen kendes uden team-orders");
});

test("Standardplan: intet gemt, men etapens opstilling har en kaptajn; Ikke gemt: hverken plan eller kaptajn", () => {
  assert.equal(v6PlanState({ stage: 4, savedStages: new Set<number>(), riders: captainTeam, overrides: [] }), "default");
  assert.equal(v6PlanState({ stage: 4, savedStages: new Set<number>(), riders: noCaptainTeam, overrides: [] }), "not_saved");
  // En udgaaet kaptajn taeller ikke med (samme opstilling som Taktik bruger).
  const abandoned = [{ ...captainTeam[0], abandoned: true }, captainTeam[1]];
  assert.equal(v6PlanState({ stage: 4, savedStages: new Set<number>(), riders: abandoned, overrides: [] }), "not_saved");
});

test("ukendt: uden Taktiks data og uden undtagelse vises intet ord (aldrig et gaet)", () => {
  assert.equal(v6PlanState({ stage: 4, savedStages: null, riders: captainTeam, overrides: [] }), null);
});

test("striben: kommende etaper baerer tilstanden; koerte og etaper paa vejen goer ikke", () => {
  const schedule = [1, 2, 3, 4, 5].map((n) => ({ stage_number: n, scheduled_at: `2026-11-${String(11 + n).padStart(2, "0")}T12:00:00.000Z` }));
  const cells = v6StripCells({
    totalStages: 5, stagesCompleted: 2, raceFinished: false, schedule, nowMs: Date.parse("2026-11-14T12:30:00.000Z"),
    profileTypeByStage: {}, winners: { 1: "Per Vang", 2: "Lis Holm" }, myBest: { 2: { rank: 6 } },
    riders: captainTeam, overrides: [], savedStages: new Set([5]), whenFor: () => null,
  });
  assert.deepEqual(cells.map((c) => c.foot), [
    { kind: "ridden", winner: "Per Vang", myRank: null },
    { kind: "ridden", winner: "Lis Holm", myRank: 6 },
    { kind: "on_road" },
    { kind: "plan", state: "default" },
    { kind: "plan", state: "saved" },
  ]);
});

test("cellen viser ordet, aldrig en farvet pille; kun Ikke gemt staar med vaegt", () => {
  const strip = read("./V6StageStrip.tsx");
  assert.match(strip, /saved: "racePageV6\.strip\.planSaved"/);
  assert.match(strip, /default: "racePageV6\.strip\.planDefault"/);
  assert.match(strip, /not_saved: "racePageV6\.strip\.planNotSaved"/);
  assert.match(strip, /c\.foot\.state === "not_saved" \? "font-semibold text-cz-1" : undefined/);
  assert.doesNotMatch(strip, /danger|error|red-|bg-cz-(warning|danger)|rounded-full/, "ingen roed pille (valg 22)");
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const json = JSON.parse(readFileSync(new URL(`../../../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    for (const key of ["planSaved", "planDefault", "planNotSaved"]) assert.ok(json.racePageV6.strip[key], `${lang}: ${key}`);
    assert.equal(json.racePageV6.strip.plan, undefined, `${lang}: den gamle "x af 3"-noegle er fjernet`);
  }
  const da = JSON.parse(readFileSync(new URL("../../../../public/locales/da/races.json", import.meta.url), "utf8"));
  assert.deepEqual([da.racePageV6.strip.planSaved, da.racePageV6.strip.planDefault, da.racePageV6.strip.planNotSaved], ["Gemt", "Standardplan", "Ikke gemt"]);
});

test("siden henter Taktiks data igen, naar Taktik aabnes, skifter etape eller forlades", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /fetchTeamOrders\(\{ raceId \}\)/);
  assert.match(page, /activeTab === "tactics" \? `tactics-\$\{tacticsStage\}` : "away"/);
});

// ── Vindernavn paa ALLE koerte etaper ──

test("vinderen pr. etape fra hele loebets etaperaekker; foerste raekke vinder ved delt foersteplads", () => {
  const rows = [
    { stage_number: 1, result_type: "stage", rank: 2, rider_id: "a" },
    { stage_number: 1, result_type: "stage", rank: 1, rider_id: "b" },
    { stage_number: 2, result_type: "stage", rank: 1, rider_id: "c" },
    { stage_number: 2, result_type: "stage", rank: 1, rider_id: "d" },
    { stage_number: 3, result_type: "gc", rank: 1, rider_id: "e" },
    { stage_number: 4, result_type: "stage", rank: 1, rider_id: null },
  ];
  assert.deepEqual(v6WinnerIdsByStage(rows), { 1: "b", 2: "c" });
  assert.deepEqual(v6WinnerIdsByStage(null), {});
});

test("navnet slaas op paa id'et; ukendt navn udelades; en hentet etape beholder sin egen liste", () => {
  const names = new Map([["b", "Per Vang"]]);
  const w = v6StripWinners({
    winnerIds: { 1: "b", 2: "c", 3: "x" },
    nameById: (id) => names.get(id) ?? (id === "c" ? "Lis Holm" : null),
    fromResults: { 3: "Bo Dahl", 4: "Eva Krog" },
  });
  assert.deepEqual(w, { 1: "Per Vang", 2: "Lis Holm", 3: "Bo Dahl", 4: "Eva Krog" });
});

test("navne fra de hentede lister: rytter-embed foerst, ellers rytterens navn", () => {
  const m = v6NamesFromResults([
    { result_type: "stage", rider_id: "b", rider: { firstname: "Per", lastname: "Vang" } },
    { result_type: "gc", rider_id: "b", rider: { firstname: "X", lastname: "Y" } },
    { result_type: "stage", rider_id: "c", rider_name: "Lis Holm" },
    { result_type: "team", rider_id: null, rider_name: null },
  ]);
  assert.deepEqual([...m], [["b", "Per Vang"], ["c", "Lis Holm"]]);
});

test("siden slaar kun de vindere op, den ikke allerede kender navnet paa", () => {
  const page = read("./RacePageV6.tsx");
  assert.match(page, /v6WinnerIdsByStage\(stagePointRows\)/);
  assert.match(page, /!resultNames\.has\(id\) && !nameById\.get\(id\)/);
  assert.match(page, /useRiderNames\(unnamedWinnerIds\)/);
});

// ── Ægte roving tabindex (review-punkt c) ──

test("tab-stoppet: sidst fokuserede etape, ellers den valgte, ellers den foerste", () => {
  assert.equal(v6StripTabStop([1, 2, 3, 4], 3, 1), 3);
  assert.equal(v6StripTabStop([1, 2, 3, 4], null, 2), 2);
  assert.equal(v6StripTabStop([1, 2, 3, 4], 9, 2), 2, "en forsvundet etape giver tab-stoppet tilbage til den valgte");
  assert.equal(v6StripTabStop([1, 2, 3, 4], null, 9), 1);
  assert.equal(v6StripTabStop([], null, 1), null);
});

test("piletaster, Home og End flytter baade fokus og tab-stop; der er praecis eet tab-stop", () => {
  // Fokus paa etape 2, valgt etape 1: ArrowRight -> 3 bliver tab-stoppet.
  const next = v6StripKeyTarget("ArrowRight", 2, 4);
  assert.equal(next, 3);
  assert.equal(v6StripTabStop([1, 2, 3, 4], next, 1), 3);
  assert.equal(v6StripTabStop([1, 2, 3, 4], v6StripKeyTarget("End", 2, 4), 1), 4);
  assert.equal(v6StripTabStop([1, 2, 3, 4], v6StripKeyTarget("Home", 3, 4), 4), 1);
  const strip = read("./V6StageStrip.tsx");
  assert.match(strip, /tabIndex=\{c\.number === tabStop \? 0 : -1\}/, "kun tab-stoppet har tabindex 0");
  assert.match(strip, /onFocus=\{\(\) => setFocused\(c\.number\)\}/, "tab-stoppet foelger fokus (ogsaa ved klik)");
  assert.match(strip, /e\.preventDefault\(\);\n\s+setFocused\(target\);/, "piletasten flytter tab-stoppet");
  assert.match(strip, /focus && focus\.selected === selected \? focus\.stage : null/, "et nyt valg flytter tab-stoppet med");
  assert.doesNotMatch(strip, /tabIndex=\{active \? 0 : -1\}/, "ikke laengere kun den valgte");
});
