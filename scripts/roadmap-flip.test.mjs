import { test } from "node:test";
import assert from "node:assert/strict";
import { planFlips, parseArgs, formatPlan } from "./roadmap-flip.mjs";

const NOW = "2026-10-06T10:00:00.000Z";

test("planFlips finder punkter og fejl med issue_ref og foreslår færdig-status", () => {
  const plan = planFlips({
    issue: 5435,
    now: NOW,
    items: [
      { id: "a", issue_ref: 5435, status: "in_progress", title_en: "Secondary type" },
      { id: "b", issue_ref: 5435, status: "shipped", title_en: "Already" },
      { id: "c", issue_ref: 1, status: "planned", title_en: "Other" },
    ],
    issues: [{ id: "k", issue_ref: 5435, status: "fixing", title_en: "Bug" }],
  });
  assert.deepEqual(plan, [
    { table: "roadmap_items", id: "a", title: "Secondary type", from: "in_progress", patch: { status: "shipped", shipped_at: NOW } },
    { table: "known_issues", id: "k", title: "Bug", from: "fixing", patch: { status: "fixed", closed_at: NOW, updated_at: NOW } },
  ]);
});

test("planFlips er tom når intet matcher eller alt allerede er færdigt", () => {
  assert.deepEqual(planFlips({ issue: 9, now: NOW, items: [], issues: [] }), []);
  assert.deepEqual(
    planFlips({
      issue: 9,
      now: NOW,
      items: [{ id: "a", issue_ref: 9, status: "archived", title_en: "x" }],
      issues: [{ id: "k", issue_ref: 9, status: "dismissed", title_en: "y" }],
    }),
    [],
  );
});

test("planFlips afviser et issue-nummer der ikke er et positivt heltal", () => {
  assert.throws(() => planFlips({ issue: "abc", now: NOW, items: [], issues: [] }));
  assert.throws(() => planFlips({ issue: NaN, now: NOW, items: [], issues: [] }));
  assert.throws(() => planFlips({ issue: 0, now: NOW, items: [], issues: [] }));
});

test("parseArgs læser --issue og --apply, og afviser ukendte argumenter", () => {
  assert.deepEqual(parseArgs(["--issue", "12"]), { issue: 12, apply: false });
  assert.deepEqual(parseArgs(["--issue=12", "--apply"]), { issue: 12, apply: true });
  assert.throws(() => parseArgs(["--bogus"]));
});

test("formatPlan er læsbar for tom og ikke-tom plan", () => {
  assert.match(formatPlan([]), /Ingen/);
  const text = formatPlan(planFlips({
    issue: 1, now: NOW,
    items: [{ id: "abcdef123456", issue_ref: 1, status: "planned", title_en: "T" }],
    issues: [],
  }));
  assert.match(text, /roadmap_items/);
  assert.match(text, /planned -> shipped/);
});
