import { test } from "node:test";
import assert from "node:assert/strict";
import {
  squadSlots, targetableRacesFor, peakNeedsAction, plannerStatusSummary,
  pendingSuggestionPairs, ridersWithSuggestions, paybackRiskRaceIds, riderSeasonLoad,
  locksImmediatelyRaceIds,
} from "./plannerSquadModel.js";

const race = (id, date, isMine = true) => ({ id, name: `Race ${id}`, date, isMine });

const peak = (over = {}) => ({
  id: `p:${over.targetRaceId ?? "x"}`,
  targetRaceId: "r1",
  windowStart: "2026-08-05",
  windowEnd: "2026-08-15",
  status: "pending",
  isSuggestion: false,
  paybackCollisions: [],
  ...over,
});

test("squadSlots: peaks først (kronologisk), derefter tomme pladser op til loftet", () => {
  const rider = { id: "rd1", peaks: [peak({ targetRaceId: "b", windowStart: "2026-09-01" }), peak({ targetRaceId: "a", windowStart: "2026-06-01" })] };
  const slots = squadSlots(rider, 3);
  assert.equal(slots.length, 3);
  assert.equal(slots[0].peak.targetRaceId, "a", "tidligste vindue først");
  assert.equal(slots[1].peak.targetRaceId, "b");
  assert.equal(slots[2].peak, null, "resten er tomme pladser");
});

test("squadSlots: flere peaks end loftet trunkeres ALDRIG væk", () => {
  // Loftet kan sænkes uden at eksisterende planer slettes — en plan der ikke
  // kan ses, kan heller ikke fjernes.
  const rider = { id: "rd1", peaks: [peak({ targetRaceId: "a" }), peak({ targetRaceId: "b" }), peak({ targetRaceId: "c" })] };
  assert.equal(squadSlots(rider, 2).filter((s) => s.peak).length, 3);
});

test("squadSlots: rytter uden peaks får tomme pladser, ikke en tom liste", () => {
  const slots = squadSlots({ id: "rd1", peaks: [] }, 2);
  assert.equal(slots.length, 2);
  assert.ok(slots.every((s) => s.peak === null));
  assert.notEqual(slots[0].key, slots[1].key, "nøglerne skal være unikke");
});

test("targetableRacesFor: kun egne fremtidige løb, kronologisk", () => {
  const races = [race("r3", "2026-09-01"), race("r1", "2026-06-01"), race("r2", "2026-08-01"), race("r4", "2026-08-10", false)];
  const out = targetableRacesFor({ rider: { peaks: [] }, races, todayOrd: 20640 /* 2026-07-13 */ });
  assert.deepEqual(out.map((r) => r.id), ["r2", "r3"], "fortid og fremmed-divisions løb er ude");
});

test("targetableRacesFor: rytterens ANDRE mål er ude, pladsens eget mål er med", () => {
  const races = [race("r1", "2026-08-01"), race("r2", "2026-08-20"), race("r3", "2026-09-05")];
  const rider = { peaks: [peak({ targetRaceId: "r1" }), peak({ targetRaceId: "r2" })] };
  const out = targetableRacesFor({ rider, races, todayOrd: 20640, currentTargetId: "r1" });
  assert.deepEqual(out.map((r) => r.id), ["r1", "r3"], "r2 (den anden plads) er ude, r1 (egen) er med");
});

test("targetableRacesFor: et mål i fortiden kan stadig LÆSES i kontrollen", () => {
  const races = [race("r1", "2026-05-01"), race("r2", "2026-09-01")];
  const out = targetableRacesFor({ rider: { peaks: [] }, races, todayOrd: 20640, currentTargetId: "r1" });
  assert.deepEqual(out.map((r) => r.id), ["r1", "r2"]);
});

test("peakNeedsAction: at_risk ELLER payback-kollision", () => {
  assert.equal(peakNeedsAction(peak()), false);
  assert.equal(peakNeedsAction(peak({ status: "at_risk" })), true);
  assert.equal(peakNeedsAction(peak({ paybackCollisions: [{ raceId: "r9", daysAfterPeak: 4 }] })), true);
  assert.equal(peakNeedsAction(null), false);
});

test("plannerStatusSummary: tæller ægte peaks, handlinger og dage til næste optakt", () => {
  const riders = [
    { id: "a", peaks: [peak({ targetRaceId: "r1", windowStart: "2026-08-05" })] },
    { id: "b", peaks: [peak({ targetRaceId: "r2", windowStart: "2026-07-25", status: "at_risk" })] },
    { id: "c", peaks: [peak({ targetRaceId: "r3", windowStart: "2026-07-20", isSuggestion: true })] },
  ];
  const s = plannerStatusSummary({ riders, today: "2026-07-13", leadupDays: 14 });
  assert.equal(s.peaksPlanned, 2, "forslaget tæller ikke som planlagt");
  assert.equal(s.needsAction, 1);
  // b's vindue starter 25/7; optakten begynder 14 dage før = 11/7, altså i gang.
  // a's vindue starter 5/8 → optakt fra 22/7 → 9 dage.
  assert.equal(s.daysToNextLeadup, 9, "kun optakter der ikke er begyndt tæller");
});

test("plannerStatusSummary: et FORSLAG med payback-kollision tæller som handling", () => {
  // Ellers kunne 'Accept all' skjule et sammenstød manageren burde se først.
  const riders = [{ id: "a", peaks: [peak({ isSuggestion: true, paybackCollisions: [{ raceId: "r9", daysAfterPeak: 3 }] })] }];
  const s = plannerStatusSummary({ riders, today: "2026-07-13", leadupDays: 14 });
  assert.equal(s.peaksPlanned, 0);
  assert.equal(s.needsAction, 1);
});

test("plannerStatusSummary: tomt bræt giver nul og null, ikke NaN", () => {
  const s = plannerStatusSummary({ riders: [], today: "2026-07-13", leadupDays: 14 });
  assert.deepEqual(s, { peaksPlanned: 0, needsAction: 0, daysToNextLeadup: null });
});

test("plannerStatusSummary: ukendt dags dato → ingen nedtælling, men stadig tællinger", () => {
  const riders = [{ id: "a", peaks: [peak({ status: "at_risk" })] }];
  const s = plannerStatusSummary({ riders, today: null, leadupDays: 14 });
  assert.equal(s.peaksPlanned, 1);
  assert.equal(s.needsAction, 1);
  assert.equal(s.daysToNextLeadup, null);
});

test("pendingSuggestionPairs + ridersWithSuggestions: kun uaccepterede forslag", () => {
  const riders = [
    { id: "a", peaks: [peak({ targetRaceId: "r1" }), peak({ targetRaceId: "r2", windowStart: "2026-09-01", isSuggestion: true })] },
    { id: "b", peaks: [peak({ targetRaceId: "r3", windowStart: "2026-06-01", isSuggestion: true })] },
    { id: "c", peaks: [] },
  ];
  assert.deepEqual(pendingSuggestionPairs(riders), [
    { riderId: "a", raceId: "r2" },
    { riderId: "b", raceId: "r3" },
  ]);
  assert.equal(ridersWithSuggestions(riders), 2);
});

test("pendingSuggestionPairs: forslag uden mål-løb sendes aldrig videre", () => {
  const riders = [{ id: "a", peaks: [peak({ targetRaceId: null, isSuggestion: true })] }];
  assert.deepEqual(pendingSuggestionPairs(riders), []);
});

// ── #3102 PR 2 (hul 2): payback-risiko pr. løb i dropdownen, FØR valget ───────

const riskRace = (id, date, { peakWindow, stages, isMine = true } = {}) => ({
  id, name: `Race ${id}`, date, isMine,
  stages: stages ?? 1,
  // Vinduet kommer FÆRDIGT fra boardet (snapPeakWindow server-side) — testene
  // sætter det direkte, som payloaden ville.
  peakWindow: peakWindow ?? null,
});

test("paybackRiskRaceIds retning A: kandidatens formhul dækker et registreret løb", () => {
  const candidate = riskRace("cand", "2026-08-10", { peakWindow: { window_start: "2026-08-08", window_end: "2026-08-12" } });
  const hit = riskRace("hit", "2026-08-15");     // 3 dage efter vindue-slut → i payback (7 dage)
  const free = riskRace("free", "2026-08-25");   // 13 dage efter → fri
  const rider = { id: "rd1", registeredRaceIds: ["hit", "free"], peaks: [] };
  const risky = paybackRiskRaceIds({ rider, races: [candidate, hit, free], paybackDays: 7 });
  assert.deepEqual([...risky], ["cand"]);
});

test("paybackRiskRaceIds retning A: grænserne er end+1 og end+paybackDays (inklusiv)", () => {
  const cand = (id) => riskRace(id, "2026-08-10", { peakWindow: { window_start: "2026-08-08", window_end: "2026-08-12" } });
  const check = (programDate) => {
    const program = riskRace("prog", programDate);
    const rider = { id: "rd1", registeredRaceIds: ["prog"], peaks: [] };
    return paybackRiskRaceIds({ rider, races: [cand("cand"), program], paybackDays: 7 }).has("cand");
  };
  assert.equal(check("2026-08-12"), false, "løb på vinduets sidste dag er ikke i formhullet");
  assert.equal(check("2026-08-13"), true, "dagen efter vindue-slut er payback");
  assert.equal(check("2026-08-19"), true, "sidste payback-dag (end+7) tæller med");
  assert.equal(check("2026-08-20"), false, "dagen efter payback-vinduet er fri");
});

test("paybackRiskRaceIds retning B: kandidaten ligger i en ANDEN peaks formhul", () => {
  const other = peak({ targetRaceId: "other", windowEnd: "2026-08-12" });
  const inDip = riskRace("inDip", "2026-08-15", { peakWindow: { window_start: "2026-09-01", window_end: "2026-09-05" } });
  const clear = riskRace("clear", "2026-09-10", { peakWindow: { window_start: "2026-09-08", window_end: "2026-09-12" } });
  const rider = { id: "rd1", registeredRaceIds: [], peaks: [other] };
  const risky = paybackRiskRaceIds({ rider, races: [inDip, clear], paybackDays: 7 });
  assert.deepEqual([...risky], ["inDip"], "man ville toppe mod et løb man kører med reduceret form");
});

test("paybackRiskRaceIds: pladsens NUVÆRENDE mål ekskluderes som peak (retarget erstatter den), entries står urørt", () => {
  // Rytteren topper i dag mod 'current' — overvejer at flytte til 'cand'.
  const current = peak({ targetRaceId: "current", windowEnd: "2026-08-12" });
  const cand = riskRace("cand", "2026-08-15", { peakWindow: { window_start: "2026-08-13", window_end: "2026-08-17" } });
  const currentRace = riskRace("current", "2026-08-10");
  // Uden currentTargetId ville 'cand' flagges (ligger i currents formhul, retning B).
  const withoutExclusion = paybackRiskRaceIds({ rider: { id: "rd1", registeredRaceIds: [], peaks: [current] }, races: [cand, currentRace], paybackDays: 7 });
  assert.equal(withoutExclusion.has("cand"), true);
  // MED currentTargetId (samme plads) forsvinder den gamle peaks formhul.
  const withExclusion = paybackRiskRaceIds({ rider: { id: "rd1", registeredRaceIds: [], peaks: [current] }, races: [cand, currentRace], paybackDays: 7, currentTargetId: "current" });
  assert.equal(withExclusion.has("cand"), false);
  // Men en REGISTRERET entry til det gamle mål-løb bliver i programmet: kandidatens
  // formhul (end 2026-08-17) rammer intet her — flyt entry-datoen ind i hullet:
  const entryInDip = riskRace("current", "2026-08-19");
  const stillRegistered = paybackRiskRaceIds({ rider: { id: "rd1", registeredRaceIds: ["current"], peaks: [current] }, races: [cand, entryInDip], paybackDays: 7, currentTargetId: "current" });
  assert.equal(stillRegistered.has("cand"), true, "entry'en forsvinder ikke fordi peaken flytter");
});

test("paybackRiskRaceIds: øvrige peak-MÅL tæller som program (dem kører man per definition)", () => {
  const other = peak({ targetRaceId: "otherTarget", windowEnd: "2026-09-05" });
  const otherTarget = riskRace("otherTarget", "2026-08-15");
  const cand = riskRace("cand", "2026-08-10", { peakWindow: { window_start: "2026-08-08", window_end: "2026-08-12" } });
  const rider = { id: "rd1", registeredRaceIds: [], peaks: [other] };
  const risky = paybackRiskRaceIds({ rider, races: [cand, otherTarget], paybackDays: 7 });
  assert.equal(risky.has("cand"), true, "kandidatens formhul dækker det andet peak-mål");
});

test("paybackRiskRaceIds: defensiv — manglende peakWindow/datoer/paybackDays giver aldrig falske flag", () => {
  const noWindow = riskRace("noWin", "2026-08-10");
  const rider = { id: "rd1", registeredRaceIds: ["prog"], peaks: [] };
  const program = riskRace("prog", "2026-08-15");
  assert.equal(paybackRiskRaceIds({ rider, races: [noWindow, program], paybackDays: 7 }).size, 0);
  const cand = riskRace("cand", "2026-08-10", { peakWindow: { window_start: "2026-08-08", window_end: "2026-08-12" } });
  assert.equal(paybackRiskRaceIds({ rider, races: [cand, program], paybackDays: 0 }).size, 0, "payback-vindue på 0 dage kan ikke kollidere");
  assert.equal(paybackRiskRaceIds({ rider: null, races: [cand, program], paybackDays: 7 }).size, 0);
});

// ── #3094: løb der ville låse en peak med det samme ───────────────────────────

test("locksImmediatelyRaceIds: løb hvis vindue allerede er begyndt flages", () => {
  const started = riskRace("started", "2026-08-10", { peakWindow: { window_start: "2026-08-04", window_end: "2026-08-08" } });
  const today = riskRace("today", "2026-08-11", { peakWindow: { window_start: "2026-08-06", window_end: "2026-08-10" } });
  const future = riskRace("future", "2026-08-20", { peakWindow: { window_start: "2026-08-14", window_end: "2026-08-18" } });
  const risky = locksImmediatelyRaceIds({ races: [started, today, future], todayOrd: 20671 /* 2026-08-06 */ });
  assert.deepEqual([...risky].sort(), ["started", "today"], "vindue-start i dag ELLER før flages, fremtidigt vindue gør ikke");
});

test("locksImmediatelyRaceIds: defensiv — manglende peakWindow/todayOrd giver aldrig falske flag", () => {
  const noWindow = riskRace("noWin", "2026-08-10");
  assert.equal(locksImmediatelyRaceIds({ races: [noWindow], todayOrd: 20670 }).size, 0);
  const cand = riskRace("cand", "2026-08-10", { peakWindow: { window_start: "2026-08-04", window_end: "2026-08-08" } });
  assert.equal(locksImmediatelyRaceIds({ races: [cand], todayOrd: null }).size, 0);
  assert.equal(locksImmediatelyRaceIds({ races: null, todayOrd: 20670 }).size, 0);
});

// ── #2772: sæson-belastning pr. rytter ────────────────────────────────────────

test("riderSeasonLoad: løb + løbsdage (etaper) summeres over registrerede entries", () => {
  const races = [
    riskRace("oneday", "2026-08-10", { stages: 1 }),
    riskRace("tour", "2026-08-20", { stages: 5 }),
    riskRace("unentered", "2026-08-25", { stages: 3 }),
  ];
  const rider = { id: "rd1", registeredRaceIds: ["oneday", "tour"] };
  assert.deepEqual(riderSeasonLoad({ rider, races }), { races: 2, raceDays: 6 });
});

test("riderSeasonLoad: ukendte løb (uden for payloadens kalender) tælles ikke; manglende stages → 1", () => {
  const races = [{ id: "known", name: "Known", date: "2026-08-10", isMine: true }]; // ingen stages-felt
  const rider = { id: "rd1", registeredRaceIds: ["known", "gone-race"] };
  assert.deepEqual(riderSeasonLoad({ rider, races }), { races: 1, raceDays: 1 });
  assert.deepEqual(riderSeasonLoad({ rider: { id: "x" }, races }), { races: 0, raceDays: 0 });
});
