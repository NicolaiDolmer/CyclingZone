import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPLIT_SD, IDEA_TARGET, rankPlan, rankIdeas, rankIssues, isSplit, nextSortOrder, statusPatch,
  issueStatusPatch, ownOrder, movePatches, ideaPool, visibleIdeaCount, mergeItemRows,
  latestUpdateByIssue, validateTitles, fmtScore,
} from "./roadmapAdminModel.ts";

const row = (over = {}) => ({ item_id: "a", status: "planned", title_en: "A", title_da: "A", votes: 10,
  avg_idea: 5, avg_importance: 4, steering_score: 14, sort_order: 10, horizon: "next", sd_importance: 1, ...over });

test("rankPlan: kun planned, højeste vigtighed først, null sidst", () => {
  const r = rankPlan([row({ item_id: "a", avg_importance: 4 }), row({ item_id: "b", avg_importance: 5.1 }),
    row({ item_id: "c", avg_importance: null }), row({ item_id: "d", status: "active" })]);
  assert.deepEqual(r.map((x) => x.item_id), ["b", "a", "c"]);
});
test("rankIdeas: kun active, højeste styringsscore først", () => {
  const r = rankIdeas([row({ item_id: "a", status: "active", steering_score: 9 }),
    row({ item_id: "b", status: "active", steering_score: 21 }), row({ item_id: "c" })]);
  assert.deepEqual(r.map((x) => x.item_id), ["b", "a"]);
});
test("rankIdeas: skjulte idéer står i puljen, ikke i idé-tabellen", () => {
  const rows = [row({ item_id: "a", status: "active", approved: true }),
    row({ item_id: "b", status: "active", approved: false, votes: 2 }),
    row({ item_id: "c", status: "active", approved: false, votes: 7 }),
    row({ item_id: "d", status: "planned", approved: false })];
  assert.deepEqual(rankIdeas(rows).map((x) => x.item_id), ["a"]);
  assert.deepEqual(ideaPool(rows).map((x) => x.item_id), ["c", "b"]);
  assert.equal(visibleIdeaCount(rows), 1);
  assert.equal(IDEA_TARGET, 30);
});
test("isSplit bruger tærsklen 1,75", () => {
  assert.equal(SPLIT_SD, 1.75);
  assert.equal(isSplit(1.75), true); assert.equal(isSplit(1.74), false); assert.equal(isSplit(null), false);
});
test("rankIssues: bekræftede og indmeldte hver for sig, flest ramte først, lukkede udeladt", () => {
  const r = rankIssues([{ issue_id: "x", status: "fixing", reports: 3 }, { issue_id: "y", status: "confirmed", reports: 11 },
    { issue_id: "c", status: "checking", reports: 7 }, { issue_id: "z", status: "fixed", reports: 40 },
    { issue_id: "d", status: "dismissed", reports: 9 }]);
  assert.deepEqual(r.confirmed.map((x) => x.issue_id), ["y", "x"]);
  assert.deepEqual(r.checking.map((x) => x.issue_id), ["c"]);
});
test("nextSortOrder lægger et punkt sidst i planen med 10 i afstand", () => {
  assert.equal(nextSortOrder([row({ sort_order: 10 }), row({ sort_order: 30 })]), 40);
  assert.equal(nextSortOrder([]), 10);
});
test("statusPatch sætter og nulstiller shipped_at", () => {
  const now = "2026-10-06T10:00:00.000Z";
  assert.deepEqual(statusPatch("shipped", now), { status: "shipped", shipped_at: now });
  assert.deepEqual(statusPatch("planned", now), { status: "planned", shipped_at: null });
});
test("issueStatusPatch: rettet og lukket uden fund sætter closed_at, andre trin nulstiller", () => {
  const now = "2026-10-06T10:00:00.000Z";
  assert.deepEqual(issueStatusPatch("fixed", now), { status: "fixed", closed_at: now, updated_at: now });
  assert.deepEqual(issueStatusPatch("dismissed", now), { status: "dismissed", closed_at: now, updated_at: now });
  assert.deepEqual(issueStatusPatch("fixing", now), { status: "fixing", closed_at: null, updated_at: now });
});
test("ownOrder nummererer planlagte punkter efter ejerens sort_order", () => {
  const order = ownOrder([row({ item_id: "a", sort_order: 30 }), row({ item_id: "b", sort_order: 10 }),
    row({ item_id: "x", status: "active", sort_order: 1 })]);
  assert.deepEqual([...order.entries()], [["b", 1], ["a", 2]]);
});
test("movePatches bytter med naboen og skriver kun ændrede rækker", () => {
  const plan = [row({ item_id: "a", sort_order: 10 }), row({ item_id: "b", sort_order: 20 }), row({ item_id: "c", sort_order: 30 })];
  assert.deepEqual(movePatches(plan, "b", -1), [{ item_id: "b", sort_order: 10 }, { item_id: "a", sort_order: 20 }]);
  assert.deepEqual(movePatches(plan, "a", -1), []);
  assert.deepEqual(movePatches(plan, "c", 1), []);
});
test("movePatches nummererer om, når naboerne har samme sort_order", () => {
  const plan = [row({ item_id: "a", sort_order: 0 }), row({ item_id: "b", title_en: "B", sort_order: 0 })];
  assert.deepEqual(movePatches(plan, "b", -1), [{ item_id: "b", sort_order: 10 }, { item_id: "a", sort_order: 20 }]);
});
test("mergeItemRows lægger kontakt-felterne fra roadmap_items på view-rækkerne", () => {
  const merged = mergeItemRows([row({ item_id: "a" }), row({ item_id: "b" })],
    [{ id: "a", flag_key: "training_groups", beta_since: "2026-10-01T00:00:00Z", beta_soon: false, live_soon: true }]);
  assert.equal(merged[0].flag_key, "training_groups");
  assert.equal(merged[0].live_soon, true);
  assert.equal(merged[1].flag_key, null);
  assert.equal(merged[1].beta_soon, false);
});
test("latestUpdateByIssue giver den nyeste opdatering pr. fejl", () => {
  const m = latestUpdateByIssue([
    { issue_id: "k", body_da: "gammel", created_at: "2026-10-01T00:00:00Z" },
    { issue_id: "k", body_da: "ny", created_at: "2026-10-03T00:00:00Z" },
    { issue_id: "j", body_da: "eneste", created_at: "2026-09-01T00:00:00Z" },
  ]);
  assert.equal(m.get("k")?.body_da, "ny");
  assert.equal(m.get("j")?.body_da, "eneste");
});
test("validateTitles kræver begge titler", () => {
  assert.equal(validateTitles("A", "B"), true);
  assert.equal(validateTitles(" ", "B"), false);
  assert.equal(validateTitles("A", null), false);
});
test("fmtScore bruger dansk komma og tankestreg for tomt", () => {
  assert.equal(fmtScore(5.1), "5,10");
  assert.equal(fmtScore(21.37, 1), "21,4");
  assert.equal(fmtScore(null), "–");
  assert.equal(fmtScore("4.5"), "4,50");
});
