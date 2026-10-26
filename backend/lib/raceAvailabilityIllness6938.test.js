// #6938: laegens besked naar en rytter bliver syg af langvarig ekstrem traethed.
import test from "node:test";
import assert from "node:assert/strict";
import { buildRiderIllNotification, newTrainingIllnesses } from "./raceAvailabilityNotifications.js";
import { loadIllnessFatigueHistory } from "./dailyTrainingEngine.js";

test("#6938 newTrainingIllnesses: kun nye sygdomme med en dato fra i dag og frem", () => {
  const reportRiders = [{ rider_id: "a", name: "A", illness_days: 3 }, { rider_id: "b", name: "B", illness_days: 0 }, { rider_id: "c", name: "C", injury_days: 2 }, { rider_id: "d", name: "D", illness_days: 2 }];
  const conditionUpserts = [{ rider_id: "a", injured_until: "2026-11-04" }, { rider_id: "d", injured_until: "2026-10-30" }];
  assert.deepEqual(newTrainingIllnesses({ reportRiders, conditionUpserts, today: "2026-11-01" }), [{ riderId: "a", riderName: "A", injuredUntil: "2026-11-04" }]);
});

test("#6938 buildRiderIllNotification: koder til oversaettelsen, ingen tal ud over datoen", () => {
  const p = buildRiderIllNotification({ riderId: "a", riderName: "Ada", injuredUntil: "2026-11-04" });
  assert.equal(p.metadata.titleCode, "notif.riderIll.title");
  assert.equal(p.metadata.messageCode, "notif.riderIll.message");
  assert.equal(p.metadata.messageParams.rider, "Ada");
});

test("#6938 loadIllnessFatigueHistory: kun dage i traek foer i dag, nyeste foerst", async () => {
  const rows = [
    { rider_id: "a", tick_date: "2026-11-02", fatigue: "90" }, { rider_id: "a", tick_date: "2026-11-01", fatigue: "88" }, { rider_id: "a", tick_date: "2026-10-30", fatigue: "95" },
    { rider_id: "b", tick_date: "2026-11-01", fatigue: "99" },
  ];
  const chain = { select: () => chain, eq: () => chain, in: () => chain, gte: () => chain, lt: () => chain, order: () => Promise.resolve({ data: rows, error: null }) };
  const out = await loadIllnessFatigueHistory({ from: () => chain }, ["a", "b"], "2026-11-03");
  assert.deepEqual(out.get("a"), [90, 88], "hullet 31/10 bryder stimen");
  assert.equal(out.has("b"), false, "i gaar mangler: ingen stime");
});
