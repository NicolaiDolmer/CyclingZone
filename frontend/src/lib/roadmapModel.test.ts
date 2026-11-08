import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTab, partitionItems, isRated, countUnrated, filterUnrated,
  engineCounts, issueAreaCounts, splitChecking, CHECKING_VISIBLE, splitIssues, buildDoneList, latestIssueUpdates,
  groupPlan, planRanks, planStage, normalizeHorizon, weekRange, copenhagenDateKey, issueTimeline,
  splitRecentDone, patchNotesByIssue, pickPatchNote, searchRoadmap, normalizeSearch,
  holdsItem, doneLimitFor, roadmapRowId, DONE_PAGE_SIZE, isFoldedHorizon, parseHorizon, horizonRank, horizonLabelKey,
  type RoadmapItem, type RoadmapVote, type KnownIssue,
} from "./roadmapModel.ts";

const item = (over: Partial<RoadmapItem> = {}): RoadmapItem => ({
  id: "i1", engine: "races", sort_order: 10, title_en: "A", title_da: "A",
  approved: true, status: "active", horizon: "next_week",
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
    item({ id: "a", status: "planned", horizon: "q1_2027", sort_order: 5 }),
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
  // "Snart for alle" først på Beta-fanen.
  assert.deepEqual(p.inBeta.map((i) => i.id), ["k", "h"]);
  assert.deepEqual(p.comingToBeta.map((i) => i.id), ["j"]);
  // #7666: Plan = i gang og planlagt pr. horisont; beta står kun på Beta-fanen (#6160).
  assert.deepEqual(p.planGroups.map((g) => [g.horizon, g.items.map((i) => i.id)]), [
    ["next_week", ["d", "c", "b", "j"]],
    ["q1_2027", ["a"]],
  ]);
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

test("Ved ikke besvarer punktet på begge faner og forsvinder fra mangler dit svar (#7788)", () => {
  const planned = item({ id: "p1", status: "planned" });
  const idea = item({ id: "v1", status: "active" });
  const dontKnow = (id: string): RoadmapVote => ({ item_id: id, idea_score: null, importance_score: null });
  assert.equal(isRated(planned, dontKnow("p1")), true);
  assert.equal(isRated(idea, dontKnow("v1")), true);
  const votes = new Map<string, RoadmapVote>([["p1", dontKnow("p1")], ["v1", dontKnow("v1")]]);
  assert.deepEqual(countUnrated([planned, idea], votes), { plan: 0, vote: 0, total: 2, rated: 2 });
  assert.deepEqual(filterUnrated([planned, idea], votes, true), []);
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

// ── #7666 ────────────────────────────────────────────────────────────────

test("groupPlan (#7895): uger, sæsoner, kvartaler, år; tomme udelades, ukendt læses som uden tid", () => {
  const groups = groupPlan([
    item({ id: "l", status: "planned", horizon: "q2_2027" }),
    item({ id: "y", status: "planned", horizon: "y2027" }),
    item({ id: "q", status: "planned", horizon: "q1_2027" }),
    item({ id: "s6", status: "planned", horizon: "season_6" }),
    item({ id: "w2", status: "planned", horizon: "this_week", sort_order: 20 }),
    item({ id: "w1", status: "in_progress", horizon: "this_week", sort_order: 90 }),
    item({ id: "n", status: "planned", horizon: "next_week" }),
    item({ id: "s", status: "planned", horizon: "season_5" }),
    item({ id: "u", status: "planned", horizon: "someday" as never }),
    item({ id: "x", status: "active", horizon: "this_week" }),
    item({ id: "z", status: "shipped", horizon: "this_week" }),
  ]);
  assert.deepEqual(groups.map((g) => [g.horizon, g.items.map((i) => i.id)]), [
    ["this_week", ["w1", "w2"]],
    ["next_week", ["n"]],
    ["season_5", ["s"]],
    ["season_6", ["s6"]],
    ["q1_2027", ["q"]],
    ["q2_2027", ["l"]],
    ["y2027", ["y"]],
    ["unscheduled", ["u"]],
  ]);
  assert.equal(normalizeHorizon("season_7"), "season_7");
  assert.equal(normalizeHorizon("later"), "unscheduled");
  assert.equal(normalizeHorizon(null), "unscheduled");
});

test("planStage og planRanks: kun planlagte nummereres, og ikke i de foldede horisonter", () => {
  assert.equal(planStage(item({ status: "in_progress", beta_since: "2026-10-01T00:00:00Z" })), "beta");
  assert.equal(planStage(item({ status: "in_progress" })), "in_progress");
  assert.equal(planStage(item({ status: "planned" })), "planned");
  const ranks = planRanks(groupPlan([
    item({ id: "a", status: "planned", horizon: "next_week" }),
    item({ id: "b", status: "in_progress", horizon: "this_week" }),
    item({ id: "c", status: "planned", horizon: "this_week" }),
    item({ id: "d", status: "planned", horizon: "q1_2027" }),
  ]));
  assert.deepEqual([...ranks], [["c", 1], ["a", 2]]);
});

test("weekRange: mandag til søndag i dansk tid, også lige efter midnat søndag/mandag", () => {
  // Søndag 8/11 23:30 UTC er mandag 9/11 00:30 i København.
  assert.equal(copenhagenDateKey(new Date("2026-11-08T23:30:00Z")), "2026-11-09");
  assert.deepEqual(weekRange(new Date("2026-11-08T23:30:00Z"), 0), { start: "2026-11-09", end: "2026-11-15" });
  // Onsdag 4/11.
  assert.deepEqual(weekRange(new Date("2026-11-04T12:00:00Z"), 0), { start: "2026-11-02", end: "2026-11-08" });
  assert.deepEqual(weekRange(new Date("2026-11-04T12:00:00Z"), 1), { start: "2026-11-09", end: "2026-11-15" });
});

test("issueTimeline: datoer kun på nåede trin; et sprunget trin vises uden dato", () => {
  const fixing = issueTimeline(iss({ status: "fixing", created_at: "2026-10-01T00:00:00Z", fixing_at: "2026-10-03T00:00:00Z" }));
  assert.deepEqual(fixing.map((s) => [s.key, s.reached, s.current, s.date]), [
    ["reported", true, false, "2026-10-01T00:00:00Z"],
    ["confirmed", true, false, null],
    ["fixing", true, true, "2026-10-03T00:00:00Z"],
    ["fixed", false, false, null],
  ]);
  // En gammel closed_at på en genåbnet fejl må ikke vises.
  const checking = issueTimeline(iss({ status: "checking", closed_at: "2026-10-05T00:00:00Z" }));
  assert.deepEqual(checking.map((s) => s.reached), [true, false, false, false]);
  assert.equal(checking[3].date, null);
  const dismissed = issueTimeline(iss({ status: "dismissed", closed_at: "2026-10-05T00:00:00Z" }));
  assert.deepEqual(dismissed.map((s) => [s.key, s.current, s.date]), [
    ["reported", false, "2026-09-30T00:00:00Z"],
    ["dismissed", true, "2026-10-05T00:00:00Z"],
  ]);
});

test("buildDoneList bærer issue_ref, og splitRecentDone skiller de sidste 7 dage ud", () => {
  const done = buildDoneList(
    [item({ id: "f1", status: "shipped", shipped_at: "2026-11-02T00:00:00Z", issue_ref: 7003 }),
     item({ id: "f2", status: "shipped", shipped_at: "2026-10-20T00:00:00Z" }),
     item({ id: "f0", status: "shipped", shipped_at: null })],
    [iss({ id: "k1", status: "fixed", closed_at: "2026-11-03T00:00:00Z", issue_ref: 7092 })],
    Infinity,
  );
  assert.deepEqual(done.map((d) => [d.id, d.issue_ref]), [["k1", 7092], ["f1", 7003], ["f2", null], ["f0", null]]);
  const { recent, earlier } = splitRecentDone(done, new Date("2026-11-04T12:00:00Z"));
  assert.deepEqual(recent.map((d) => d.id), ["k1", "f1"]);
  assert.deepEqual(earlier.map((d) => d.id), ["f2", "f0"]);
});

test("patchNotesByIssue + pickPatchNote: kun spillernoter, nærmeste dato vinder", () => {
  const index = patchNotesByIssue([
    { version: "7.398", date: "2026-11-04", changes: [
      { audience: "player", refs: [7003], en: { title: "Later fix", body: "b" }, da: { title: "Senere", body: "b" } },
      { audience: "admin", refs: [7092], en: { title: "Hidden", body: "b" }, da: { title: "Skjult", body: "b" } },
    ] },
    { version: "7.390", date: "2026-10-27", changes: [
      { audience: "player", refs: [7003, "x"], en: { title: "Stage plan", body: "Plan it" }, da: { title: "Etapeplan", body: "Planlæg" } },
    ] },
    { nonsense: true },
  ]);
  assert.equal(index.has(7092), false);
  assert.equal(index.get(7003)?.length, 2);
  assert.equal(pickPatchNote(index, 7003, "2026-10-27T12:00:00Z")?.version, "7.390");
  assert.equal(pickPatchNote(index, 7003, "2026-11-05T12:00:00Z")?.version, "7.398");
  assert.equal(pickPatchNote(index, 7003, null)?.version, "7.398");
  assert.equal(pickPatchNote(index, null, "2026-11-01"), null);
  assert.equal(pickPatchNote(index, 1, "2026-11-01"), null);
  assert.equal(patchNotesByIssue(null).size, 0);
});

test("searchRoadmap: EN og DA, uden accenter, med fanen hittet ligger på", () => {
  const items = [
    item({ id: "p", status: "planned", title_en: "Stage plan", title_da: "Etapeplan" }),
    item({ id: "b", status: "in_progress", beta_since: "2026-10-01T00:00:00Z", title_en: "Race film", title_da: "Løbsfilm" }),
    item({ id: "i", status: "active", title_en: "Team kit", title_da: "Holddragt på ryttere" }),
    item({ id: "s", status: "shipped", title_en: "Stage weather", title_da: "Etapevejr" }),
    item({ id: "a", status: "archived", title_en: "Stage old", title_da: "Gammel" }),
  ];
  const issues = [
    iss({ id: "k", status: "confirmed", title_en: "Stage page is slow", title_da: "Etapesiden er langsom" }),
    iss({ id: "f", status: "fixed", title_en: "Fixed thing", title_da: "Rettet etape" }),
    iss({ id: "d", status: "dismissed", title_en: "Stage nothing", title_da: "Intet" }),
  ];
  assert.deepEqual(searchRoadmap("etape", items, issues).map((h) => [h.id, h.where, h.tab]), [
    ["p", "planned", "plan"], ["k", "issue", "issues"], ["s", "done_feature", "done"], ["f", "done_fix", "done"],
  ]);
  assert.deepEqual(searchRoadmap("pa ryttere", items, issues).map((h) => h.id), ["i"]);
  assert.deepEqual(searchRoadmap("FILM", items, issues).map((h) => [h.id, h.tab]), [["b", "beta"]]);
  assert.deepEqual(searchRoadmap("e", items, issues), []);
  assert.equal(normalizeSearch("  Étape På "), "etape pa");
});

// Codex-fund på #7668: et hit på en gammel leveret post eller en fjern plan
// skiftede fane, men punktet blev skjult bag "Show more" eller en lukket fold.
test("doneLimitFor: et hit dybt i Done udvider listen, til punktet er med", () => {
  const earlier = Array.from({ length: 95 }, (_, i) => ({ id: `e${i}` }));
  const shown = (id: string | null) => earlier.slice(0, doneLimitFor(earlier, id));

  assert.equal(shown("e70").at(-1)?.id, "e70");
  assert.equal(shown("e94").length, 95);
  assert.equal(doneLimitFor(earlier, "e3"), DONE_PAGE_SIZE, "listen krymper aldrig under én side");
  assert.equal(doneLimitFor(earlier, null), DONE_PAGE_SIZE);
  assert.equal(doneLimitFor(earlier, "ikke-her"), DONE_PAGE_SIZE);
});

test("holdsItem: kun folden med det valgte punkt åbner", () => {
  const groups = groupPlan([
    item({ id: "near", status: "planned", horizon: "this_week" }),
    item({ id: "y", status: "planned", horizon: "y2027" }),
    item({ id: "l", status: "planned", horizon: "q2_2027" }),
  ]);
  const open = (id: string | null) => groups
    .filter((g) => isFoldedHorizon(g.horizon) && holdsItem(g.items, id))
    .map((g) => g.horizon);

  assert.deepEqual(open("y"), ["y2027"]);
  assert.deepEqual(open("l"), ["q2_2027"]);
  assert.deepEqual(open("near"), []);
  assert.deepEqual(open(null), []);
});

test("holdsItem: et hit i de foldede indmeldte fejl åbner den fold", () => {
  const checking = Array.from({ length: CHECKING_VISIBLE + 2 }, (_, i) => iss({ id: `k${i}` }));
  const { folded } = splitChecking(checking);
  assert.equal(holdsItem(folded, `k${CHECKING_VISIBLE}`), true);
  assert.equal(holdsItem(folded, "k0"), false);
});

test("roadmapRowId: samme id på rækken og i scroll-opslaget", () => {
  assert.equal(roadmapRowId("abc"), "roadmap-row-abc");
});

test("horisont-hjælpere (#7895): navne, rækkefølge og fold", () => {
  assert.deepEqual(parseHorizon("season_5"), { kind: "season", season: 5 });
  assert.deepEqual(parseHorizon("q2_2027"), { kind: "quarter", quarter: 2, year: 2027 });
  assert.deepEqual(parseHorizon("next"), { kind: "unscheduled" });
  assert.deepEqual(horizonLabelKey("season_6"), { key: "plan.horizon.season", values: { season: 6 } });
  assert.deepEqual(horizonLabelKey("q1_2027"), { key: "plan.horizon.quarter", values: { quarter: 1, year: 2027 } });
  assert.deepEqual(horizonLabelKey("y2027"), { key: "plan.horizon.year", values: { year: 2027 } });
  assert.ok(horizonRank("next_week") < horizonRank("season_5"));
  assert.ok(horizonRank("season_12") < horizonRank("q1_2027"));
  assert.ok(horizonRank("q4_2027") < horizonRank("y2027"));
  assert.equal(isFoldedHorizon("season_6"), false);
  assert.equal(isFoldedHorizon("q1_2027"), true);
});
