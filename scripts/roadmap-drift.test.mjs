import { test } from "node:test";
import assert from "node:assert/strict";
import { planIssueNumbers, findDrift, formatDrift, findFlagDrift } from "./roadmap-drift.mjs";

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

const fi = (o) => ({ id: "x", title_en: "T", status: "planned", flag_key: "f", beta_since: null, ...o });

test("findFlagDrift: beta uden in_progress eller uden beta_since er drift", () => {
  const items = [
    fi({ id: "a", status: "planned" }),
    fi({ id: "b", status: "in_progress", beta_since: null }),
    fi({ id: "c", status: "in_progress", beta_since: "2026-10-01T00:00:00Z" }),
  ];
  const out = findFlagDrift({ items, flags: { f: "beta" } });
  assert.deepEqual(out.map((d) => d.id), ["a", "b"]);
  assert.equal(out[0].flag, "beta");
});

test("findFlagDrift: on med uafsluttet punkt er drift (boolean true tæller som on)", () => {
  const items = [fi({ id: "a", status: "in_progress", beta_since: "2026-10-01" }), fi({ id: "b", status: "planned" })];
  assert.deepEqual(findFlagDrift({ items, flags: { f: "on" } }).map((d) => d.id), ["a", "b"]);
  assert.deepEqual(findFlagDrift({ items, flags: { f: true } }).map((d) => d.id), ["a", "b"]);
});

test("findFlagDrift: off med beta_since på et in_progress-punkt er drift (false tæller som off)", () => {
  const items = [
    fi({ id: "a", status: "in_progress", beta_since: "2026-10-01" }),
    fi({ id: "b", status: "in_progress", beta_since: null }),
    fi({ id: "c", status: "planned", beta_since: null }),
  ];
  assert.deepEqual(findFlagDrift({ items, flags: { f: "off" } }).map((d) => d.id), ["a"]);
  assert.deepEqual(findFlagDrift({ items, flags: { f: false } }).map((d) => d.id), ["a"]);
});

test("findFlagDrift rører aldrig shipped/archived og ignorerer punkter uden flag_key", () => {
  const items = [
    fi({ id: "a", status: "shipped" }),
    fi({ id: "b", status: "archived", beta_since: "2026-10-01" }),
    fi({ id: "c", status: "planned", flag_key: null }),
  ];
  for (const stage of ["beta", "on", "off"]) {
    assert.deepEqual(findFlagDrift({ items, flags: { f: stage } }), []);
  }
  assert.deepEqual(findFlagDrift({ items: [fi({ id: "a", status: "shipped", flag_key: "missing" })], flags: {} }), []);
});

test("findFlagDrift: ukendt nøgle rapporteres som 'kontakt findes ikke'", () => {
  const out = findFlagDrift({ items: [fi({ id: "a", flag_key: "gone" })], flags: { f: "on" } });
  assert.equal(out.length, 1);
  assert.equal(out[0].reason, "kontakt findes ikke");
  assert.equal(out[0].flag, null);
});

test("formatDrift viser Beta-drift og hvordan den rettes", () => {
  const drift = { missing: [], stale: [], flagDrift: [{ id: "abcdef123", title: "Form", status: "planned", flag_key: "f", flag: "beta", reason: "kontakt er beta" }] };
  const text = formatDrift(drift);
  assert.match(text, /Beta-drift \(1\)/);
  assert.match(text, /--resync/);
  assert.match(formatDrift({ missing: [], stale: [], flagDrift: [] }), /Beta-drift \(0\)/);
});
