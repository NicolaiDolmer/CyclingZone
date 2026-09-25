// Selvtest for scripts/ci/detect-marketing-changes.mjs (#5424).
//
//   node --test scripts/ci/detect-marketing-changes.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { marketingChanged } from "./detect-marketing-changes.mjs";

test("marketingChanged: true naar en fil ligger under marketing/", () => {
  assert.equal(marketingChanged(["marketing/app/page.tsx", "README.md"]), true);
});

test("marketingChanged: false naar ingen filer ligger under marketing/", () => {
  assert.equal(marketingChanged(["frontend/src/App.jsx", "backend/server.js"]), false);
});

test("marketingChanged: false paa tom liste (ingen filer aendret)", () => {
  assert.equal(marketingChanged([]), false);
});

// Regex skal matche fra stien START - en fil der bare INDEHOLDER "marketing/"
// laengere inde maa ikke give falsk positiv.
test("marketingChanged: 'marketing/' midt i en sti giver ikke falsk positiv", () => {
  assert.equal(marketingChanged(["docs/marketing/plan.md", "scripts/not-marketing/foo.mjs"]), false);
});

test("marketingChanged: matcher ikke en fil der blot starter paa 'marketing' uden skraastreg", () => {
  assert.equal(marketingChanged(["marketing.json"]), false);
});
