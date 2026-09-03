// scripts/extract-e2e-flakes.test.mjs
// Unit-test for flake-rapporten (#4647, refs #4292). Tiden injiceres (hard rule 16).

import test from "node:test";
import assert from "node:assert/strict";

import { collectFlakes, buildShardReport, mergeShardReports, firstErrorLine } from "./extract-e2e-flakes.mjs";

const FIXED_NOW = new Date("2026-09-02T22:00:00.000Z");

// Minimal-udsnit af Playwrights JSON-rapport: suites -> specs -> tests -> results.
const report = {
  suites: [
    {
      title: "auction",
      file: "auction-leader-visible.spec.js",
      specs: [
        {
          title: "viser foererlinjen",
          file: "auction-leader-visible.spec.js",
          line: 17,
          tests: [
            {
              projectName: "mobile-webkit",
              status: "flaky",
              results: [
                { status: "failed", retry: 0, error: { message: "Error: expect(locator).toBeVisible() failed\n  waiting for locator" } },
                { status: "passed", retry: 1 },
              ],
            },
            { projectName: "desktop-chromium", status: "expected", results: [{ status: "passed", retry: 0 }] },
          ],
        },
      ],
      suites: [
        {
          title: "nested",
          file: "auction-leader-visible.spec.js",
          specs: [
            {
              title: "nested flake",
              file: "auction-leader-visible.spec.js",
              line: 52,
              tests: [
                {
                  projectName: "mobile-webkit",
                  status: "flaky",
                  results: [{ status: "timedOut", retry: 0, error: { message: "Test timeout of 30000ms exceeded." } }, { status: "passed", retry: 1 }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "board",
      file: "board-sign.spec.js",
      specs: [
        {
          title: "underskriver",
          file: "board-sign.spec.js",
          line: 9,
          tests: [{ projectName: "desktop-chromium", status: "unexpected", results: [{ status: "failed", retry: 0 }, { status: "failed", retry: 1 }] }],
        },
      ],
    },
  ],
};

test("collectFlakes finder kun status flaky, ogsaa i indlejrede suites", () => {
  const flakes = collectFlakes(report);
  assert.equal(flakes.length, 2);
  assert.deepEqual(
    flakes.map((f) => f.line),
    [17, 52],
  );
  assert.ok(flakes.every((f) => f.project === "mobile-webkit"));
  assert.equal(flakes[0].attempts, 2);
  assert.ok(flakes[0].error.includes("toBeVisible"));
});

test("collectFlakes ignorerer aegte roede tests (unexpected)", () => {
  const flakes = collectFlakes(report);
  assert.equal(
    flakes.some((f) => f.file === "board-sign.spec.js"),
    false,
  );
});

test("collectFlakes taaler tom eller ugyldig rapport", () => {
  assert.deepEqual(collectFlakes(null), []);
  assert.deepEqual(collectFlakes({}), []);
  assert.deepEqual(collectFlakes({ suites: [] }), []);
});

test("buildShardReport filtrerer paa projekt og bruger injiceret tid", () => {
  const shardReport = buildShardReport(report, "desktop-chromium", FIXED_NOW);
  assert.equal(shardReport.flakes.length, 0);
  assert.equal(shardReport.generatedAt, FIXED_NOW.toISOString());

  const webkit = buildShardReport(report, "mobile-webkit", FIXED_NOW);
  assert.equal(webkit.flakes.length, 2);
  assert.equal(webkit.project, "mobile-webkit");
});

test("mergeShardReports summerer pr. projekt og sorterer stabilt", () => {
  const merged = mergeShardReports(
    [
      { project: "mobile-webkit", flakes: [{ project: "mobile-webkit", file: "b.spec.js", line: 2, title: "b", attempts: 2, error: "x" }] },
      { project: "desktop-chromium", flakes: [{ project: "desktop-chromium", file: "a.spec.js", line: 1, title: "a", attempts: 2, error: "y" }] },
      { project: "mobile-chromium", flakes: [] },
    ],
    FIXED_NOW,
  );
  assert.equal(merged.total, 2);
  assert.deepEqual(merged.byProject, { "mobile-webkit": 1, "desktop-chromium": 1 });
  assert.equal(merged.flakes[0].project, "desktop-chromium");
  assert.equal(merged.generatedAt, FIXED_NOW.toISOString());
});

test("mergeShardReports paa tomme shards giver en tom, gyldig rapport", () => {
  const merged = mergeShardReports([], FIXED_NOW);
  assert.equal(merged.total, 0);
  assert.deepEqual(merged.flakes, []);
  assert.deepEqual(merged.byProject, {});
});

test("firstErrorLine tager foerste linje, stripper ANSI og kapper laengden", () => {
  const esc = String.fromCharCode(27);
  assert.equal(firstErrorLine({ message: `${esc}[31mfejl her${esc}[39m\nnaeste linje` }), "fejl her");
  assert.equal(firstErrorLine("bare en streng"), "bare en streng");
  assert.equal(firstErrorLine(undefined), "");
  assert.equal(firstErrorLine({ message: "x".repeat(500) }).length, 240);
});
