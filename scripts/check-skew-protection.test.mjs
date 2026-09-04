import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkDeploymentIdBaked,
  checkNoDplQuery,
  DPL_QUERY_RE,
  run,
  VDPL_COOKIE_NAME,
} from "./check-skew-protection.mjs";

const DPL = "dpl_test123";

function makeDist(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "cz-skew-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

// Et realistisk, korrekt build: cookie-koden er med, ingen URL er rørt.
function goodDist() {
  return makeDist({
    "app.html": '<!doctype html><script type="module" src="/assets/main-A1.js"></script>',
    "index.html": '<!doctype html><script type="module" src="/assets/main-A1.js"></script>',
    "assets/main-A1.js": `import{r as R}from"./react-B2.js";document.cookie="${VDPL_COOKIE_NAME}="+"${DPL}"+"; Path=/";`,
    "assets/react-B2.js": "export const r=1;",
    "assets/main-A1.css": ".a{color:red}",
  });
}

test("the regex only matches a dpl query parameter, never the cookie name", () => {
  assert.ok(DPL_QUERY_RE.test("/assets/main.js?dpl=dpl_1"));
  assert.ok(DPL_QUERY_RE.test("/assets/main.js?v=1&dpl=dpl_1"));
  assert.ok(!DPL_QUERY_RE.test(`${VDPL_COOKIE_NAME}=dpl_1; Path=/`));
});

test("passes a build with no rewritten asset URLs", () => {
  const dir = goodDist();
  try {
    const res = checkNoDplQuery(dir);
    assert.equal(res.ok, true);
    assert.ok(res.scanned >= 5, "scans html, js and css");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when entry HTML carries ?dpl= (the #4745 regression)", () => {
  const dir = makeDist({
    "app.html": `<script type="module" src="/assets/main-A1.js?dpl=${DPL}"></script>`,
    "assets/main-A1.js": "export const a=1;",
  });
  try {
    const res = checkNoDplQuery(dir);
    assert.equal(res.ok, false);
    assert.equal(res.offenders.length, 1);
    assert.ok(res.offenders[0].file.endsWith("app.html"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when a JS chunk carries ?dpl= on a dynamic import", () => {
  const dir = makeDist({
    "app.html": "<script></script>",
    "assets/main-A1.js": `import("./lazy-C3.js?dpl=${DPL}")`,
  });
  try {
    assert.equal(checkNoDplQuery(dir).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deployment id + cookie name must be baked into a JS chunk", () => {
  const dir = goodDist();
  try {
    assert.equal(checkDeploymentIdBaked(dir, DPL).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when the define wiring is dead (id missing from the bundle)", () => {
  const dir = makeDist({
    "app.html": "<script></script>",
    "assets/main-A1.js": `document.cookie="${VDPL_COOKIE_NAME}=";`,
  });
  try {
    const res = checkDeploymentIdBaked(dir, DPL);
    assert.equal(res.ok, false);
    assert.match(res.reason, /define-wiringen/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when the cookie call was tree-shaken away", () => {
  const dir = makeDist({
    "app.html": "<script></script>",
    "assets/main-A1.js": `const id="${DPL}";`,
  });
  try {
    const res = checkDeploymentIdBaked(dir, DPL);
    assert.equal(res.ok, false);
    assert.match(res.reason, /tree-shaket/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run() skips the pin check when the build had no Skew Protection env", () => {
  const dir = goodDist();
  try {
    const res = run(dir, {});
    assert.equal(res.ok, true);
    assert.ok(res.lines.some((l) => l.startsWith("[skip]")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run() verifies the pin when VERCEL_DEPLOYMENT_ID is set", () => {
  const dir = goodDist();
  try {
    const res = run(dir, { VERCEL_DEPLOYMENT_ID: DPL });
    assert.equal(res.ok, true);
    assert.ok(res.lines.some((l) => l.includes("deployment-id bagt ind")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run() fails loudly on a missing dist dir", () => {
  const res = run(path.join(tmpdir(), "cz-skew-does-not-exist"), {});
  assert.equal(res.ok, false);
  assert.match(res.lines[0], /findes ikke/);
});
