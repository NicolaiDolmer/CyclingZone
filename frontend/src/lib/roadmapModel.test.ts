import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTab, partitionItems, isRated, countUnrated, filterUnrated,
  engineCounts, issueAreaCounts, splitChecking, CHECKING_VISIBLE, splitIssues, buildDoneList, latestIssueUpdates,
  type RoadmapItem, type RoadmapVote, type KnownIssue,
} from "./roadmapModel.ts";

const item = (over: Partial<RoadmapItem> = {}): RoadmapItem => ({
  id: "i1", engine: "races", sort_order: 10, title_en: "A", title_da: "A",
  approved: true, status: "active", horizon: "next",
  beta_since: null, beta_soon: false, live_soon: false,
  created_at: "2026-09-24T00:00:00Z", shipped_at: null, ...over,
});

const iss = (over: Partial<KnownIssue> = {}): KnownIssue => ({
  id: "k", area: "races", status: "checking", title_en: "t", title_da: "t",
  sort_order: 0, created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z", closed_at: null, ...over,
});

test("parseTab falder tilbage til plan ved ukendt eller manglende værdi", () => {
  assert.equal(parseTab("vote"), "vote");
  assert.equal(parseTab("issues"), "issues");
  assert.equal(parseTab("beta"), "beta");
  assert.equal(parseTab("done"), "done");
  assert.equal(parseTab("nope"), "plan");
  assert.equal(parseTab(null), "plan");
  assert.equal(parseTab(undefined), "plan");
});

test("partitionItems deler efter status og horizon og sorterer på sort_order", () => {
  const p = partitionItems([
    item({ id: "a", status: "planned", horizon: "later", sort_order: 5 }),
    item({ id: "b", status: "planned", sort_order: 20 }),
    item({ id: "c", status: "planned", sort_order: 10 }),
    item({ id: "d", status: "in_progress" }),
    item({ id: "e", status: "active" }),
    item({ id: "f", status: "shipped", shipped_at: "2026-09-21T00:00:00Z" }),
    item({ id: "g", status: "archived" }),
    item({ id: "h", status: "in_progress", beta_since: "2026-10-01T00:00:00Z" }),
    item({ id: "k", status: "in_progress", beta_since: "2026-09-27T00:00:00Z", live_soon: true, sort_order: 90 }),
    item({ id: "j", status: "planned", beta_soon: true, sort_order: 30 }),
  ]);
  // I beta står kun på Beta-fanen; "snart for alle" først.
  assert.deepEqual(p.inBeta.map((i) => i.id), ["k", "h"]);
  assert.deepEqual(p.comingToBeta.map((i) => i.id), ["j"]);
  assert.deepEqual(p.plannedNext.map((i) => i.id), ["c", "b", "j"]);
  assert.deepEqual(p.plannedLater.map((i) => i.id), ["a"]);
  assert.deepEqual(p.inProgress.map((i) => i.id), ["d"]);
  assert.deepEqual(p.ideas.map((i) => i.id), ["e"]);
  assert.deepEqual(p.shipped.map((i) => i.id), ["f"]);
});

test("partitionItems tåler null og tom liste", () => {
  const p = partitionItems(null);
  assert.equal(p.ideas.length, 0);
  assert.equal(p.inBeta.length, 0);
});

test("isRated: planlagt kræver kun vigtighed, idé kræver begge", () => {
  const planned = item({ status: "planned" });
  const idea = item({ status: "active" });
  assert.equal(isRated(planned, { item_id: "i1", idea_score: null, importance_score: 4 }), true);
  assert.equal(isRated(planned, undefined), false);
  assert.equal(isRated(idea, { item_id: "i1", idea_score: null, importance_score: 4 }), false);
  assert.equal(isRated(idea, { item_id: "i1", idea_score: 5, importance_score: 4 }), true);
});

test("countUnrated tæller pr. fane og samlet", () => {
  const items = [
    item({ id: "p1", status: "planned" }), item({ id: "p2", status: "planned" }),
    item({ id: "v1" }), item({ id: "v2" }), item({ id: "d", status: "in_progress" }),
  ];
  const votes = new Map<string, RoadmapVote>([
    ["p1", { item_id: "p1", idea_score: null, importance_score: 3 }],
    ["v1", { item_id: "v1", idea_score: 6, importance_score: 2 }],
  ]);
  assert.deepEqual(countUnrated(items, votes), { plan: 1, vote: 1, total: 4, rated: 2 });
});

test("filterUnrated returnerer alt når filteret er slået fra", () => {
  const items = [item({ id: "v1" }), item({ id: "v2" })];
  const votes = new Map<string, RoadmapVote>([["v1", { item_id: "v1", idea_score: 6, importance_score: 2 }]]);
  assert.deepEqual(filterUnrated(items, votes, false).map((i) => i.id), ["v1", "v2"]);
  assert.deepEqual(filterUnrated(items, votes, true).map((i) => i.id), ["v2"]);
});

test("engineCounts giver kun områder med punkter, i fast rækkefølge", () => {
  const counts = engineCounts([item({ engine: "club" }), item({ engine: "races" }), item({ engine: "club" })]);
  assert.deepEqual(counts, [{ key: "races", count: 1 }, { key: "club", count: 2 }]);
});

test("issueAreaCounts tager 'other' med til sidst", () => {
  const counts = issueAreaCounts([iss({ area: "other" }), iss({ area: "training" }), iss({ area: "other" })]);
  assert.deepEqual(counts, [{ key: "training", count: 1 }, { key: "other", count: 2 }]);
});

test("splitChecking: de første 8 vises, resten foldes, og 8 eller færre giver ingen fold", () => {
  assert.equal(CHECKING_VISIBLE, 8);
  const mk = (n: number) => Array.from({ length: n }, (_, i) => iss({ id: `c${i}`, sort_order: i }));
  const many = splitChecking(mk(26));
  assert.equal(many.visible.length, 8);
  assert.equal(many.folded.length, 18);
  assert.deepEqual(many.visible.map((i) => i.id), ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
  assert.equal(many.folded[0].id, "c8");
  assert.equal(splitChecking(mk(8)).folded.length, 0);
  assert.equal(splitChecking(mk(0)).visible.length, 0);
});

test("splitIssues: bekræftede og indmeldte hver for sig, lukkede kun de seneste 14 dage", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const s = splitIssues([
    iss({ id: "a", sort_order: 2 }), iss({ id: "b", sort_order: 1, status: "fixing" }),
    iss({ id: "e", sort_order: 3, status: "confirmed" }), iss({ id: "f", sort_order: 1 }),
    iss({ id: "c", status: "fixed", closed_at: "2026-10-01T00:00:00Z" }),
    iss({ id: "d", status: "fixed", closed_at: "2026-09-20T00:00:00Z" }),
    iss({ id: "g", status: "dismissed", closed_at: "2026-10-05T00:00:00Z" }),
  ], now);
  assert.deepEqual(s.confirmed.map((i) => i.id), ["b", "e"]);
  assert.deepEqual(s.checking.map((i) => i.id), ["f", "a"]);
  assert.deepEqual(s.recentlyFixed.map((i) => i.id), ["c"]);
  assert.deepEqual(s.recentlyDismissed.map((i) => i.id), ["g"]);
});

test("buildDoneList fletter features og fixes, nyeste først, med loft", () => {
  const done = buildDoneList(
    [item({ id: "f1", status: "shipped", shipped_at: "2026-09-21T00:00:00Z" }),
     item({ id: "f0", status: "shipped", shipped_at: null })],
    [iss({ id: "k1", status: "fixed", title_en: "Fix", title_da: "Rettelse",
       created_at: "2026-09-29T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: "2026-10-01T00:00:00Z" })],
    30,
  );
  assert.deepEqual(done.map((d) => [d.id, d.kind]), [["k1", "fix"], ["f1", "feature"], ["f0", "feature"]]);
  assert.equal(buildDoneList([item({ id: "x", status: "shipped" })], [], 0).length, 0);
});

test("latestIssueUpdates grupperer pr. fejl, nyeste først", () => {
  const map = latestIssueUpdates([
    { id: "u1", issue_id: "k1", body_en: "old", body_da: "gammel", created_at: "2026-09-30T00:00:00Z" },
    { id: "u2", issue_id: "k1", body_en: "new", body_da: "ny", created_at: "2026-10-01T00:00:00Z" },
    { id: "u3", issue_id: "k2", body_en: "x", body_da: "x", created_at: "2026-10-01T00:00:00Z" },
  ]);
  assert.deepEqual(map.get("k1")?.map((u) => u.id), ["u2", "u1"]);
  assert.deepEqual(map.get("k2")?.map((u) => u.id), ["u3"]);
  assert.equal(latestIssueUpdates(null).size, 0);
});
