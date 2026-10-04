import { test } from "node:test";
import assert from "node:assert/strict";
import { planIssueNumbers, findDrift, formatDrift } from "./roadmap-drift.mjs";

test("planIssueNumbers læser issue-numre fra Brand og Lovet, ikke fra resten", () => {
  const md = [
    "## 🔴 Brand (nu)",
    "⚪ #6156 form · 🟠 #6115",
    "## Bane 1 · Træning færdig",
    "#7000",
    "## Bane 1 · Lovet til spillerne (dato først)",
    "27/9: #5831 · #6156",
    "## Bane 3 · Færdiggør",
    "#6081",
  ].join("\n");
  assert.deepEqual(planIssueNumbers(md), [6156, 6115, 5831]);
});

test("findDrift: lovet uden punkt, og punkt hvis issue er færdigt", () => {
  const drift = findDrift({
    planIssues: [6156, 5831],
    items: [
      { id: "a", issue_ref: 5831, status: "planned", title_en: "Message" },
      { id: "b", issue_ref: 4385, status: "planned", title_en: "Upkeep" },
    ],
    issues: [{ id: "k", issue_ref: 5952, status: "fixing", title_en: "Team classification" }],
    doneIssues: new Set([4385, 5952]),
  });
  assert.deepEqual(drift.missing, [6156]);
  assert.deepEqual(drift.stale.map((s) => [s.table, s.id]), [["roadmap_items", "b"], ["known_issues", "k"]]);
});

test("findDrift ignorerer allerede færdige punkter og fejl", () => {
  const drift = findDrift({
    planIssues: [],
    items: [{ id: "a", issue_ref: 1, status: "shipped", title_en: "x" }],
    issues: [{ id: "k", issue_ref: 1, status: "fixed", title_en: "y" }],
    doneIssues: new Set([1]),
  });
  assert.deepEqual(drift, { missing: [], stale: [] });
});

test("formatDrift viser 'ingen' når der ikke er drift", () => {
  const text = formatDrift({ missing: [], stale: [] });
  assert.match(text, /\(0\)/);
  assert.match(text, /ingen/);
});
