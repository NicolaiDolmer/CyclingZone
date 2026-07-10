import test from "node:test";
import assert from "node:assert/strict";
import { computeCanonicalSignatures, classifyIllegalTier4Races, computeFinanceReversals, partitionTier4FullReset } from "./div4CascadeRepair.js";

function makePools({ legalCount = 8, extraInPoolA = true, illegalClassInAll = true } = {}) {
  const racesByPool = new Map();
  for (let p = 1; p <= legalCount; p++) {
    const races = [
      { id: `r-${p}-1`, name: "Tour du Léman", race_class: "Class1", stages: 5, game_day_start: 3, status: "scheduled" },
      { id: `r-${p}-2`, name: "GP Class2 A", race_class: "Class2", stages: 1, game_day_start: 8, status: "scheduled" },
    ];
    if (illegalClassInAll) {
      races.push({ id: `r-${p}-3`, name: "Il Lombardia", race_class: "Monuments", stages: 1, game_day_start: 40, status: "completed" });
    }
    racesByPool.set(p, races);
  }
  if (extraInPoolA) {
    racesByPool.get(1).push({ id: "r-1-extra", name: "Tour du Jura", race_class: "Class1", stages: 3, game_day_start: 99, status: "scheduled" });
  }
  return racesByPool;
}

test("computeCanonicalSignatures: flertallets (stages, game_day_start) vinder pr. navn", () => {
  const racesByPool = makePools();
  const canon = computeCanonicalSignatures(racesByPool);
  assert.deepEqual(canon.get("Tour du Léman"), { stages: 5, game_day_start: 3, count: 8 });
  assert.equal(canon.get("Tour du Jura").count, 1); // kun pulje A har den
});

test("classifyIllegalTier4Races: ulovlig klasse (Monuments) fjernes i ALLE 8 puljer", () => {
  const { toDelete } = classifyIllegalTier4Races({ racesByPool: makePools() });
  const monumentDeletes = toDelete.filter((d) => d.name === "Il Lombardia");
  assert.equal(monumentDeletes.length, 8, "Il Lombardia skal slettes i alle 8 puljer");
  for (const d of monumentDeletes) assert.ok(d.reasons.includes("illegal-class:Monuments"));
});

test("classifyIllegalTier4Races: pulje A's ekstra/skæve løb (kun i 1 af 8 puljer) flages", () => {
  const { toDelete } = classifyIllegalTier4Races({ racesByPool: makePools() });
  const juraDelete = toDelete.find((d) => d.name === "Tour du Jura");
  assert.ok(juraDelete, "Tour du Jura skal flages");
  assert.ok(juraDelete.reasons.includes("not-shared-across-pools"));
});

test("classifyIllegalTier4Races: cross-tier-dedup mod tier 1-3-navne flager selv en ellers lovlig klasse", () => {
  const racesByPool = makePools({ illegalClassInAll: false, extraInPoolA: false });
  const { toDelete } = classifyIllegalTier4Races({ racesByPool, tier1to3Names: new Set(["Tour du Léman"]) });
  const flagged = toDelete.filter((d) => d.name === "Tour du Léman");
  assert.equal(flagged.length, 8);
  for (const d of flagged) assert.ok(d.reasons.includes("cross-tier-dedup"));
});

test("classifyIllegalTier4Races: lovlige, delte, korrekt-daterede løb overlever og danner canonicalTemplate", () => {
  const racesByPool = makePools({ illegalClassInAll: false, extraInPoolA: false });
  const { toDelete, canonicalTemplate } = classifyIllegalTier4Races({ racesByPool });
  assert.equal(toDelete.length, 0);
  assert.deepEqual(canonicalTemplate.map((t) => t.name).sort(), ["GP Class2 A", "Tour du Léman"]);
});

test("classifyIllegalTier4Races: stale-signature — samme navn men afvigende game_day i én pulje", () => {
  const racesByPool = makePools({ illegalClassInAll: false, extraInPoolA: false });
  racesByPool.get(3)[0] = { ...racesByPool.get(3)[0], game_day_start: 999 };
  const { toDelete } = classifyIllegalTier4Races({ racesByPool });
  const stale = toDelete.find((d) => d.pool_id === 3 && d.name === "Tour du Léman");
  assert.ok(stale, "afvigende dato i pulje 3 skal flages");
  assert.ok(stale.reasons.includes("stale-signature"));
  // De øvrige 7 puljers version af samme løb er STADIG lovlig.
  assert.equal(toDelete.filter((d) => d.name === "Tour du Léman").length, 1);
});

test("computeFinanceReversals: summerer prize + sponsor_race_day pr. hold, ignorerer andre typer og andre løb", () => {
  const transactions = [
    { race_id: "race-1", team_id: "team-a", type: "prize", amount: 15000 },
    { race_id: "race-1", team_id: "team-a", type: "sponsor_race_day", amount: 5000 },
    { race_id: "race-1", team_id: "team-b", type: "prize", amount: 9000 },
    { race_id: "race-2", team_id: "team-a", type: "prize", amount: 3000 }, // andet løb, medtages fordi race-2 er i raceIds
    { race_id: "race-3", team_id: "team-a", type: "prize", amount: 999999 }, // IKKE i raceIds — skal ignoreres
    { race_id: "race-1", team_id: "team-a", type: "transfer_fee", amount: 500 }, // ikke reversibel type
  ];
  const reversals = computeFinanceReversals({ transactions, raceIds: ["race-1", "race-2"] });
  const byTeamRace = Object.fromEntries(reversals.map((r) => [`${r.raceId}:${r.teamId}`, r]));
  assert.equal(byTeamRace["race-1:team-a"].amount, -20000);
  assert.equal(byTeamRace["race-1:team-a"].idempotencyKey, "race_prize_reversal:race-1:team-a");
  assert.equal(byTeamRace["race-1:team-b"].amount, -9000);
  assert.equal(byTeamRace["race-2:team-a"].amount, -3000);
  assert.equal(reversals.some((r) => r.raceId === "race-3"), false);
});

test("computeFinanceReversals: tom liste ved ingen transaktioner", () => {
  assert.deepEqual(computeFinanceReversals({ transactions: [], raceIds: ["race-1"] }), []);
});

test("partitionTier4FullReset: ALLE løb medtages i allIds — completed/prize_paid → toReverse, resten → toDeleteScheduled", () => {
  const races = [
    { id: "a", name: "Completed lovlig", race_class: "Class1", status: "completed", prize_paid_at: "2026-07-01T00:00:00Z" },
    { id: "b", name: "Completed uden prize_paid_at", race_class: "Monuments", status: "completed", prize_paid_at: null },
    { id: "c", name: "Prize paid men status weird", race_class: "Class2", status: "in_progress", prize_paid_at: "2026-07-02T00:00:00Z" },
    { id: "d", name: "Scheduled lovlig", race_class: "Class1", status: "scheduled", prize_paid_at: null },
    { id: "e", name: "Scheduled ulovlig", race_class: "Monuments", status: "scheduled", prize_paid_at: null },
  ];
  const { toReverse, toDeleteScheduled, allIds } = partitionTier4FullReset({ races });
  // Fuld nulstilling: alle 5 slettes uanset klasse/lovlighed.
  assert.deepEqual(allIds.sort(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(toReverse.map((r) => r.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(toDeleteScheduled.map((r) => r.id).sort(), ["d", "e"]);
});

test("partitionTier4FullReset: tom input → tomme lister", () => {
  const { toReverse, toDeleteScheduled, allIds } = partitionTier4FullReset({ races: [] });
  assert.deepEqual(toReverse, []);
  assert.deepEqual(toDeleteScheduled, []);
  assert.deepEqual(allIds, []);
});
