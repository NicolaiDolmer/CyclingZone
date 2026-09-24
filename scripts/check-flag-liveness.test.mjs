// node --test scripts/check-flag-liveness.test.mjs
// Kontakt-vagten (#5507). Fixtures i hukommelsen - ingen git, ingen DB.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  baselineFrom,
  buildIndex,
  classifyPath,
  compareToBaseline,
  evaluateFlags,
  findReaders,
  parseStageFlagKeys,
  readerApi,
  stripComments,
} from "./check-flag-liveness.mjs";

const CATALOG = `export const STAGE_FLAGS = Object.freeze([
  { key: "widget_enabled", area: "x", label: "Widget" },
  { key: "orphan_enabled", area: "x", label: "Forladt" },
]);
export const PLAYER_VISIBLE_FLAG_KEYS = Object.freeze(["not_a_stage_key"]);`;

function repo(extra = []) {
  return buildIndex([
    { path: "backend/lib/stageFlagCatalog.js", text: CATALOG },
    {
      path: "backend/lib/widgetFlag.js",
      text: [
        'import { readFlagStage, evaluateFlagStage } from "./featureStage.js";',
        'export const WIDGET_FLAG_KEY = "widget_enabled";',
        "async function readRaw(client) {",
        "  return readFlagStage(client, WIDGET_FLAG_KEY);",
        "}",
        "export async function isWidgetEnabled(client, opts = {}) {",
        "  return evaluateFlagStage(await readRaw(client), opts);",
        "}",
        "export function unrelatedHelper() {",
        "  return 1;",
        "}",
      ].join("\n"),
    },
    {
      path: "backend/routes/widgetRoute.js",
      text: 'import { isWidgetEnabled } from "../lib/widgetFlag.js";\nexport async function handler(c) { return isWidgetEnabled(c); }',
    },
    {
      path: "backend/lib/helperOnly.js",
      text: 'import { unrelatedHelper } from "./widgetFlag.js";\nexport const x = unrelatedHelper();',
    },
    {
      path: "backend/lib/widgetFlag.test.js",
      text: 'import { isWidgetEnabled } from "./widgetFlag.js";\ntest("on", async () => {\n  const c = stub({ widget_enabled: "on" });\n  assert.equal(await isWidgetEnabled(c), true);\n});',
    },
    { path: "database/2026-09-01-widget.sql", text: "INSERT INTO public.app_config (key, value) VALUES ('widget_enabled', '\"off\"'::jsonb) ON CONFLICT (key) DO NOTHING;" },
    ...extra,
  ]);
}

test("classifyPath skelner produktion, test, mock og scripts", () => {
  assert.equal(classifyPath("backend/lib/a.js"), "prod");
  assert.equal(classifyPath("frontend/src/pages/A.jsx"), "prod");
  assert.equal(classifyPath("backend/lib/a.test.js"), "test");
  assert.equal(classifyPath("frontend/tests/e2e/a.spec.ts"), "test");
  assert.equal(classifyPath("frontend/src/preview/installPreviewMock.js"), "mock");
  assert.equal(classifyPath("frontend/src/preview/mockHandlers.test.js"), "test");
  assert.equal(classifyPath("backend/scripts/dev/x.mjs"), "script");
  assert.equal(classifyPath("frontend/scripts/dev-preview.mjs"), "script");
  assert.equal(classifyPath("database/2026-01-01-x.sql"), "sql");
  assert.equal(classifyPath("docs/x.md"), "docs");
});

test("parseStageFlagKeys laeser kun STAGE_FLAGS-blokken", () => {
  assert.deepEqual(parseStageFlagKeys(CATALOG), ["widget_enabled", "orphan_enabled"]);
});

test("readerApi foelger kaeden transitivt og kun eksporterede navne", () => {
  const f = repo().byPath.get("backend/lib/widgetFlag.js");
  assert.deepEqual(readerApi(f.text, ["widget_enabled", "WIDGET_FLAG_KEY"]), ["isWidgetEnabled"]);
});

test("findReaders: kalderen af laese-funktionen er en laeser, en fil der kun importerer en anden funktion er ikke", () => {
  const r = findReaders("widget_enabled", repo());
  assert.deepEqual(r.homes, ["backend/lib/widgetFlag.js"]);
  assert.deepEqual(r.readers, ["backend/routes/widgetRoute.js"]);
});

test("en hel kontakt har ingen huller; en forladt kontakt mangler alle tre", () => {
  const rows = evaluateFlags(repo());
  const widget = rows.find((r) => r.key === "widget_enabled");
  const orphan = rows.find((r) => r.key === "orphan_enabled");
  assert.deepEqual(widget.gaps, []);
  assert.deepEqual(widget.migrations, ["database/2026-09-01-widget.sql"]);
  assert.deepEqual(widget.testsOn, ["backend/lib/widgetFlag.test.js"]);
  assert.deepEqual(orphan.gaps, ["reader", "migration", "test-on"]);
  assert.equal(rows.some((r) => r.key === "not_a_stage_key"), false, "PLAYER_VISIBLE_FLAG_KEYS er ikke STAGE_FLAGS");
});

test("en test der kun naevner noeglen i en katalog-assertion taeller ikke som 'taendt'", () => {
  const rows = evaluateFlags(
    repo([
      {
        path: "backend/lib/orphan.test.js",
        text: 'test("k", () => {\n  assert.equal(isStageFlagKey("orphan_enabled"), true);\n});',
      },
    ]),
  );
  assert.ok(rows.find((r) => r.key === "orphan_enabled").gaps.includes("test-on"));
});

test("en laeser i dev-scripts, tests eller preview-mocken taeller ikke", () => {
  const rows = evaluateFlags(
    repo([
      { path: "backend/scripts/dev/x.mjs", text: 'const k = "orphan_enabled";' },
      { path: "frontend/src/preview/installPreviewMock.js", text: 'const flags = { orphan_enabled: true };' },
    ]),
  );
  assert.ok(rows.find((r) => r.key === "orphan_enabled").gaps.includes("reader"));
});

test("BAGLAENS PR #5503: en eksporteret *_FLAG_KEY uden laeser, migration og test fanges", () => {
  // Tilstanden efter merge af #5503: noeglen er eksporteret fra generatoren som
  // "den tiltaenkte app_config-noegle", men intet laeser den.
  const index = buildIndex([
    { path: "backend/lib/stageFlagCatalog.js", text: "export const STAGE_FLAGS = Object.freeze([\n]);" },
    {
      path: "backend/lib/fictionalRiderGenerator.js",
      text: [
        'export const PRIMARY_TYPE_FROM_DISTRIBUTION_FLAG_KEY = "rider_primary_type_from_distribution";',
        "export function generateFictionalRiders(opts = {}) {",
        '  const mode = opts.primaryTypeMode ?? "tier";',
        "  return mode;",
        "}",
      ].join("\n"),
    },
    { path: "backend/lib/aiTeamGenerator.js", text: 'import { generateFictionalRiders } from "./fictionalRiderGenerator.js";\nexport const r = generateFictionalRiders({ count: 1 });' },
    { path: "backend/scripts/dev/typeDistribution5327.mjs", text: 'generateFictionalRiders({ primaryTypeMode: "distribution" });' },
    { path: "backend/lib/fictionalRiderGenerator.test.js", text: 'test("x", () => generateFictionalRiders({ primaryTypeMode: "distribution" }));' },
  ]);
  const row = evaluateFlags(index).find((r) => r.key === "rider_primary_type_from_distribution");
  assert.ok(row, "den eksporterede noegle skal vaere med, selv uden STAGE_FLAGS-post");
  assert.deepEqual(row.gaps, ["reader", "migration", "test-on"]);
  assert.deepEqual(row.readers, []);
});

test("baselinen: kendt gaeld er tilladt, nye huller fejler, lukkede huller skal ud", () => {
  const rows = [
    { key: "a", gaps: ["migration"] },
    { key: "b", gaps: ["reader", "test-on"] },
    { key: "c", gaps: [] },
  ];
  const cmp = compareToBaseline(rows, { known: { a: ["migration"], b: ["reader"], c: ["test-on"], gone: ["reader"] } });
  assert.deepEqual(cmp.newGaps, [{ key: "b", check: "test-on" }]);
  assert.deepEqual(cmp.closed, [{ key: "c", check: "test-on" }]);
  assert.deepEqual(cmp.orphaned, ["gone"]);
  assert.deepEqual(baselineFrom(rows).known, { a: ["migration"], b: ["reader", "test-on"] });
});

test("stripComments fjerner hele kommentarlinjer, men aeder ikke kode efter en streng med '/*'", () => {
  const src = 'const a = "image/*";\nconst m = readFileSync("./model.json");\n// kommentar med model.json\n/* blok */\nconst b = 1; // hale';
  const out = stripComments(src);
  assert.ok(out.includes('readFileSync("./model.json")'));
  assert.ok(!out.includes("kommentar med"));
  assert.ok(!out.includes("blok"));
});

test("baseline-filen er gyldig JSON med kendte check-navne", () => {
  const baseline = JSON.parse(readFileSync(new URL("./flag-liveness-baseline.json", import.meta.url), "utf8"));
  assert.equal(typeof baseline.known, "object");
  for (const [key, checks] of Object.entries(baseline.known)) {
    assert.match(key, /^[a-z0-9_]+$/);
    for (const c of checks) assert.ok(["reader", "migration", "test-on"].includes(c), `${key}: ukendt check ${c}`);
  }
});
