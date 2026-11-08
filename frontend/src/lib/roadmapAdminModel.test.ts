import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPLIT_SD, IDEA_TARGET, rankPlan, rankIdeas, rankIssues, isSplit, nextSortOrder, statusPatch,
  issueStatusPatch, ownOrder, movePatches, ideaPool, visibleIdeaCount, mergeItemRows,
  latestUpdateByIssue, validateTitles, fmtScore, ADMIN_TABS, HORIZONS, HORIZON_LABELS, DEFAULT_SORT, isAdminTab,
  tabRows, filterItems, filterIssueRows, sortRows, nextSort, tabCounts, dontKnowTotal,
} from "./roadmapAdminModel.ts";

const row = (over = {}) => ({ item_id: "a", status: "planned", title_en: "A", title_da: "A", votes: 10,
  avg_idea: 5, avg_importance: 4, steering_score: 14, sort_order: 10, horizon: "next", sd_importance: 1, ...over });

test("Ved ikke (#7788): Stemmer-fanen viser punktet, totalen lægges sammen, og kolonnen kan sorteres", () => {
  const rows = [
    row({ item_id: "a", votes: 0, dont_know: 2 }),
    row({ item_id: "b", votes: 4, dont_know: "1" }),
    row({ item_id: "c", votes: 0, dont_know: 0 }),
    // Før migrationen er applied, har viewet ikke kolonnen.
    row({ item_id: "d", votes: 0 }),
  ];
  assert.deepEqual(tabRows(rows, "votes").map((r) => r.item_id), ["a", "b"]);
  assert.equal(dontKnowTotal(rows), 3);
  assert.equal(dontKnowTotal([]), 0);
  assert.deepEqual(sortRows(rows, { key: "dontKnow", dir: "desc" }).map((r) => r.item_id), ["a", "b", "c", "d"]);
});

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

// --- Faner, filtre og sortering (#6204) ---
const mix = [
  row({ item_id: "i1", status: "active", engine: "races", votes: 3, steering_score: 9, issue_ref: 120 }),
  row({ item_id: "i2", status: "active", engine: "market", votes: 8, steering_score: 20, approved: false }),
  row({ item_id: "p1", status: "planned", engine: "races", horizon: "this_week", avg_importance: 5, sort_order: 20, issue_ref: 1205 }),
  row({ item_id: "p2", status: "planned", engine: "training", horizon: "y2027", avg_importance: 4, sort_order: 10 }),
  row({ item_id: "g1", status: "in_progress", engine: "club", votes: 0 }),
  row({ item_id: "s1", status: "shipped", engine: "races", votes: 5, shipped_at: "2026-10-01T00:00:00Z" }),
  row({ item_id: "s2", status: "shipped", engine: "races", votes: 0, shipped_at: "2026-10-09T00:00:00Z" }),
  row({ item_id: "a1", status: "archived", horizon: "y2027", votes: 2 }),
];
const ids = (rs: { item_id: string }[]) => rs.map((r) => r.item_id);

test("fanerne er de syv aftalte, og isAdminTab afviser andet", () => {
  assert.deepEqual(ADMIN_TABS.map((t) => t.label), ["Idéer", "Planlagt", "I gang", "Færdigt", "Kendte fejl", "2027", "Stemmer"]);
  assert.equal(isAdminTab("y2027"), true);
  assert.equal(isAdminTab("roadmap"), false);
  assert.equal(isAdminTab(null), false);
});
test("horisont-vælgeren tilbyder sæsoner, kvartaler og uden tid (#7895)", () => {
  assert.equal(HORIZON_LABELS.season_5, "Sæson 5");
  assert.equal(HORIZON_LABELS.q1_2027, "Q1 2027");
  assert.ok(!(HORIZONS as readonly string[]).includes("later"));
  for (const h of ["this_week", "next_week", "season_5", "season_6", "q1_2027", "q2_2027", "y2027", "unscheduled"]) {
    assert.ok((HORIZONS as readonly string[]).includes(h), h);
    assert.ok(HORIZON_LABELS[h], h);
  }
});
test("tabRows: hver fane får sine rækker, 2027 på tværs af status uden færdige", () => {
  assert.deepEqual(ids(tabRows(mix, "ideas")), ["i1", "i2"]);
  assert.deepEqual(ids(tabRows(mix, "planned")), ["p1"]);
  assert.deepEqual(ids(tabRows(mix, "in_progress")), ["g1"]);
  assert.deepEqual(ids(tabRows(mix, "shipped")), ["s1", "s2"]);
  assert.deepEqual(ids(tabRows(mix, "y2027")), ["p2"]);
  assert.deepEqual(ids(tabRows(mix, "votes")).sort(), ["a1", "i1", "i2", "p1", "p2", "s1"].sort());
});
test("filterItems: område, status, horisont og issue kombineres; tomt filter slipper alt igennem", () => {
  assert.equal(filterItems(mix, {}).length, mix.length);
  assert.deepEqual(ids(filterItems(mix, { area: "races" })), ["i1", "p1", "s1", "s2"]);
  assert.deepEqual(ids(filterItems(mix, { area: "races", status: "shipped" })), ["s1", "s2"]);
  assert.deepEqual(ids(filterItems(mix, { horizon: "y2027" })), ["p2", "a1"]);
  assert.deepEqual(ids(filterItems(mix, { issue: "#12" })), ["i1", "p1"]);
  assert.deepEqual(ids(filterItems(mix, { issue: "1205" })), ["p1"]);
  assert.deepEqual(filterItems(mix, { issue: "999" }), []);
});
test("filterIssueRows filtrerer på område, trin og issue-nummer", () => {
  const issues = [
    { issue_id: "x", status: "confirmed", area: "races", issue_ref: 77 },
    { issue_id: "y", status: "checking", area: "market", issue_ref: null },
  ];
  assert.deepEqual(filterIssueRows(issues, { area: "races" }).map((i) => i.issue_id), ["x"]);
  assert.deepEqual(filterIssueRows(issues, { status: "checking" }).map((i) => i.issue_id), ["y"]);
  assert.deepEqual(filterIssueRows(issues, { issue: "7" }).map((i) => i.issue_id), ["x"]);
});
test("sortRows: tal begge veje, tomme værdier altid sidst", () => {
  const rs = [row({ item_id: "a", votes: 5 }), row({ item_id: "b", votes: null }), row({ item_id: "c", votes: 9 })];
  assert.deepEqual(ids(sortRows(rs, { key: "votes", dir: "desc" })), ["c", "a", "b"]);
  assert.deepEqual(ids(sortRows(rs, { key: "votes", dir: "asc" })), ["a", "c", "b"]);
});
test("sortRows: tomme værdier følger ejerens rækkefølge indbyrdes, efter de bedømte (Codex P2)", () => {
  const rs = [row({ item_id: "u2", avg_importance: null, sort_order: 2 }), row({ item_id: "r", avg_importance: 4, sort_order: 9 }),
    row({ item_id: "u1", avg_importance: null, sort_order: 1 })];
  assert.deepEqual(ids(sortRows(rs, { key: "importance", dir: "desc" })), ["r", "u1", "u2"]);
  assert.deepEqual(ids(sortRows(rs, { key: "importance", dir: "asc" })), ["r", "u1", "u2"]);
});
test("sortRows: tekst efter dansk rækkefølge og stabil ved lighed", () => {
  const rs = [row({ item_id: "a", title_da: "Zebra" }), row({ item_id: "b", title_da: "Ægir" }),
    row({ item_id: "c", title_da: "Bue" }), row({ item_id: "d", title_da: "Bue" })];
  assert.deepEqual(ids(sortRows(rs, { key: "title", dir: "asc" })), ["c", "d", "a", "b"]);
});
test("sortRows dækker styringsscore, vigtighed, rækkefølge og dato", () => {
  assert.deepEqual(ids(sortRows(mix.filter((r) => r.status === "active"), { key: "score", dir: "desc" })), ["i2", "i1"]);
  assert.deepEqual(ids(sortRows(tabRows(mix, "planned").concat(tabRows(mix, "y2027")), { key: "importance", dir: "desc" })), ["p1", "p2"]);
  assert.deepEqual(ids(sortRows(tabRows(mix, "planned").concat(tabRows(mix, "y2027")), { key: "own", dir: "asc" })), ["p2", "p1"]);
  assert.deepEqual(ids(sortRows(tabRows(mix, "shipped"), { key: "date", dir: "desc" })), ["s2", "s1"]);
});
test("sortRows: ved lighed gælder ejerens rækkefølge og så titlen", () => {
  const rs = [row({ item_id: "a", avg_importance: 4, sort_order: 30, title_en: "A" }),
    row({ item_id: "b", avg_importance: 4, sort_order: 10, title_en: "B" }),
    row({ item_id: "c", avg_importance: 4, sort_order: 10, title_en: "A2" })];
  assert.deepEqual(ids(sortRows(rs, { key: "importance", dir: "desc" })), ["c", "b", "a"]);
  assert.deepEqual(ids(sortRows(rs, { key: "own", dir: "asc" })), ["c", "b", "a"]);
});
test("sortRows med ukendt nøgle ændrer ikke rækkefølgen", () => {
  assert.deepEqual(ids(sortRows(mix, { key: "findes-ikke", dir: "asc" })), ids(mix));
});
test("sortRows sorterer fejl på ramte og dage åben", () => {
  const issues = [{ issue_id: "x", reports: 2, days_open: 9 }, { issue_id: "y", reports: 7, days_open: 1 }];
  assert.deepEqual(sortRows(issues, { key: "reports", dir: "desc" }).map((i) => i.issue_id), ["y", "x"]);
  assert.deepEqual(sortRows(issues, { key: "days", dir: "desc" }).map((i) => i.issue_id), ["x", "y"]);
});
test("nextSort vender retningen på samme nøgle og vælger fornuftig start på ny", () => {
  assert.deepEqual(nextSort({ key: "votes", dir: "desc" }, "votes"), { key: "votes", dir: "asc" });
  assert.deepEqual(nextSort({ key: "votes", dir: "desc" }, "title"), { key: "title", dir: "asc" });
  assert.deepEqual(nextSort({ key: "title", dir: "asc" }, "score"), { key: "score", dir: "desc" });
});
test("DEFAULT_SORT har en sortering til hver fane", () => {
  for (const t of ADMIN_TABS) assert.ok(DEFAULT_SORT[t.key], t.key);
});
test("tabCounts tæller åbne fejl og rækker pr. fane", () => {
  const c = tabCounts(mix, [{ issue_id: "x", status: "confirmed" }, { issue_id: "y", status: "fixed" }]);
  assert.equal(c.ideas, 2); assert.equal(c.planned, 1); assert.equal(c.shipped, 2); assert.equal(c.issues, 1); assert.equal(c.y2027, 1);
});
test("mergeItemRows tager datoerne med fra roadmap_items", () => {
  const m = mergeItemRows([row({ item_id: "a" })],
    [{ id: "a", flag_key: null, beta_since: null, beta_soon: false, live_soon: false, shipped_at: "2026-10-09T00:00:00Z" }]);
  assert.equal(m[0].shipped_at, "2026-10-09T00:00:00Z");
  assert.equal(m[0].created_at, null);
});
