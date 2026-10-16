// node --test scripts/ci/workflow-paths-match.test.mjs  (#6724)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anyFileMatches, globToRegExp, pullRequestPaths } from "./workflow-paths-match.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("globToRegExp: ** krydser mapper, * holder sig i et segment", () => {
  assert.ok(globToRegExp("database/**").test("database/2026-10-16-x.sql"));
  assert.ok(globToRegExp("database/**").test("database/templates/new-public-table.sql"));
  assert.ok(globToRegExp("scripts/audit-table-grants*").test("scripts/audit-table-grants.test.mjs"));
  assert.ok(!globToRegExp("scripts/audit-table-grants*").test("scripts/sub/audit-table-grants.mjs"));
  assert.ok(globToRegExp("**/*.yml").test(".github/workflows/ci.yml"));
  assert.ok(globToRegExp("**/*.yml").test("top.yml"));
  assert.ok(!globToRegExp("docs/*.md").test("docs/sub/x.md"));
});

test("pullRequestPaths: laeser kun pull_request's liste, ikke push's", () => {
  const yml = [
    "name: x",
    "on:",
    "  pull_request:",
    "    paths:",
    "      - 'database/**'",
    "      - \"scripts/a*\"",
    "  push:",
    "    branches: [main]",
    "    paths:",
    "      - 'other/**'",
    "permissions:",
    "  contents: read",
  ].join("\n");
  assert.deepEqual(pullRequestPaths(yml), ["database/**", "scripts/a*"]);
});

test("pullRequestPaths: null naar pull_request ikke har paths (koerer altid)", () => {
  const yml = ["on:", "  pull_request:", "  push:", "    branches: [main]", "jobs:", "  a:"].join("\n");
  assert.equal(pullRequestPaths(yml), null);
});

test("pullRequestPaths: rigtige workflows giver de forventede filtre", () => {
  const tg = pullRequestPaths(readFileSync(join(root, ".github/workflows/table-grants.yml"), "utf8"));
  assert.ok(tg && tg.includes("database/**"), `table-grants: ${tg}`);
  const fr = pullRequestPaths(readFileSync(join(root, ".github/workflows/feature-registry-check.yml"), "utf8"));
  assert.ok(fr && fr.includes("docs/FEATURE_REGISTRY.yml"), `feature-registry-check: ${fr}`);
  // ts-core-ratchet har ingen paths: den skal koere i hver PR.
  assert.equal(pullRequestPaths(readFileSync(join(root, ".github/workflows/ts-core-ratchet.yml"), "utf8")), null);
});

test("anyFileMatches: sidste matchende moenster vinder (negation)", () => {
  const p = ["docs/**", "!docs/drafts/**"];
  assert.ok(anyFileMatches(p, ["docs/NOW.md"]));
  assert.ok(!anyFileMatches(p, ["docs/drafts/x.md"]));
  assert.ok(!anyFileMatches(p, ["frontend/src/a.ts"]));
});
