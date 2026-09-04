import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkDeploymentIdBaked,
  checkNoDplQuery,
  DPL_QUERY_RE,
  readSkewProtectionEnabledFlag,
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

// Skriver en fixture-udgave af skewProtection.js med kun det linjeformat
// gaten parser statisk — så testene kan styre flaget uafhængigt af den
// virkelige (i dag `false`) kildefil.
function makeSkewSourceFile(enabled) {
  const dir = mkdtempSync(path.join(tmpdir(), "cz-skew-src-"));
  const file = path.join(dir, "skewProtection.js");
  writeFileSync(
    file,
    `// fixture\nexport const SKEW_PROTECTION_ENABLED = ${enabled};\nexport const VDPL_COOKIE = "__vdpl";\n`,
    "utf8"
  );
  return file;
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

test("run() accepts a preview build that deliberately bakes no deployment id (flag enabled)", () => {
  const dir = makeDist({
    "app.html": '<!doctype html><script type="module" src="/assets/main-A1.js"></script>',
    "assets/main-A1.js": `document.cookie="${VDPL_COOKIE_NAME}=";`,
  });
  const skewSourceFile = makeSkewSourceFile(true);
  try {
    const res = run(dir, { VERCEL_DEPLOYMENT_ID: DPL, VERCEL_ENV: "preview" }, { skewSourceFile });
    assert.equal(res.ok, true);
    assert.ok(res.lines.some((l) => l.includes("previewet pinnes ikke")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.dirname(skewSourceFile), { recursive: true, force: true });
  }
});

test("run() fails when a preview build DID bake the deployment id (flag enabled, must never pin)", () => {
  const dir = goodDist();
  const skewSourceFile = makeSkewSourceFile(true);
  try {
    const res = run(dir, { VERCEL_DEPLOYMENT_ID: DPL, VERCEL_ENV: "preview" }, { skewSourceFile });
    assert.equal(res.ok, false);
    assert.ok(res.lines.some((l) => l.includes("Kun production må pinnes")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.dirname(skewSourceFile), { recursive: true, force: true });
  }
});

test("run() skips the pin check when the build had no Skew Protection env (flag enabled)", () => {
  const dir = goodDist();
  const skewSourceFile = makeSkewSourceFile(true);
  try {
    const res = run(dir, {}, { skewSourceFile });
    assert.equal(res.ok, true);
    assert.ok(res.lines.some((l) => l.includes("VERCEL_DEPLOYMENT_ID ikke sat")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.dirname(skewSourceFile), { recursive: true, force: true });
  }
});

test("run() verifies the pin on a production build (flag enabled)", () => {
  const dir = goodDist();
  const skewSourceFile = makeSkewSourceFile(true);
  try {
    const res = run(dir, { VERCEL_DEPLOYMENT_ID: DPL, VERCEL_ENV: "production" }, { skewSourceFile });
    assert.equal(res.ok, true);
    assert.ok(res.lines.some((l) => l.includes("deployment-id bagt ind")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.dirname(skewSourceFile), { recursive: true, force: true });
  }
});

test("run() fails loudly on a missing dist dir", () => {
  const res = run(path.join(tmpdir(), "cz-skew-does-not-exist"), {});
  assert.equal(res.ok, false);
  assert.match(res.lines[0], /findes ikke/);
});

// --- Flag-gate (#2423 hotfix): gate 2/2b skal kun køre når koden reelt kalder
// installSkewProtection() (SKEW_PROTECTION_ENABLED = true i skewProtection.js).

test("readSkewProtectionEnabledFlag parses true and false from the source file", () => {
  const enabledFile = makeSkewSourceFile(true);
  const disabledFile = makeSkewSourceFile(false);
  try {
    assert.deepEqual(readSkewProtectionEnabledFlag(enabledFile), { ok: true, enabled: true });
    assert.deepEqual(readSkewProtectionEnabledFlag(disabledFile), { ok: true, enabled: false });
  } finally {
    rmSync(path.dirname(enabledFile), { recursive: true, force: true });
    rmSync(path.dirname(disabledFile), { recursive: true, force: true });
  }
});

test("readSkewProtectionEnabledFlag fails loudly when the flag line is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cz-skew-src-"));
  const file = path.join(dir, "skewProtection.js");
  writeFileSync(file, "export const VDPL_COOKIE = \"__vdpl\";\n", "utf8");
  try {
    const res = readSkewProtectionEnabledFlag(file);
    assert.equal(res.ok, false);
    assert.match(res.reason, /SKEW_PROTECTION_ENABLED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readSkewProtectionEnabledFlag fails loudly when the source file does not exist", () => {
  const res = readSkewProtectionEnabledFlag(path.join(tmpdir(), "cz-skew-does-not-exist.js"));
  assert.equal(res.ok, false);
  assert.match(res.reason, /findes ikke/);
});

test("run() skips gate 2 entirely and passes when the flag is disabled, even with a broken build", () => {
  // Buildet har IKKE bagt id'et ind (den nuværende, tilsigtede tilstand efter
  // #2423-hotfixet) — uden flag-gaten ville dette fejle gate 2. Med flaget
  // slået fra skal gaten stadig blive grøn, fordi funktionen aldrig kaldes.
  const dir = makeDist({
    "app.html": '<!doctype html><script type="module" src="/assets/main-A1.js"></script>',
    "assets/main-A1.js": "export const noop=1;",
  });
  const skewSourceFile = makeSkewSourceFile(false);
  try {
    const res = run(dir, { VERCEL_DEPLOYMENT_ID: DPL, VERCEL_ENV: "production" }, { skewSourceFile });
    assert.equal(res.ok, true);
    assert.ok(
      res.lines.some((l) => l.includes("Skew Protection er slået fra i koden (#2423)"))
    );
    assert.ok(res.lines.some((l) => l.includes("gate 1 kørt: OK")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.dirname(skewSourceFile), { recursive: true, force: true });
  }
});

test("run() still enforces gate 1 (no ?dpl=) when the flag is disabled", () => {
  const dir = makeDist({
    "app.html": `<script type="module" src="/assets/main-A1.js?dpl=${DPL}"></script>`,
    "assets/main-A1.js": "export const a=1;",
  });
  const skewSourceFile = makeSkewSourceFile(false);
  try {
    const res = run(dir, { VERCEL_DEPLOYMENT_ID: DPL, VERCEL_ENV: "production" }, { skewSourceFile });
    assert.equal(res.ok, false);
    assert.ok(res.lines[0].includes("bærer \"?dpl=\""));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.dirname(skewSourceFile), { recursive: true, force: true });
  }
});

test("run() fails loudly when the flag file exists but the flag line cannot be parsed", () => {
  const dir = goodDist();
  const badDir = mkdtempSync(path.join(tmpdir(), "cz-skew-src-"));
  const skewSourceFile = path.join(badDir, "skewProtection.js");
  writeFileSync(skewSourceFile, "// no flag here\n", "utf8");
  try {
    const res = run(dir, { VERCEL_DEPLOYMENT_ID: DPL, VERCEL_ENV: "production" }, { skewSourceFile });
    assert.equal(res.ok, false);
    assert.ok(res.lines.some((l) => l.includes("SKEW_PROTECTION_ENABLED")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(badDir, { recursive: true, force: true });
  }
});

// Lås den nuværende, tilsigtede tilstand fast: pr. #2423-hotfixet 4/9 er
// Skew Protection slået FRA i den virkelige kildefil. Flipper nogen flaget
// uden at opdatere denne test, er det et tegn på at gen-tændingen ikke gik
// gennem det ejer-only review #2423 kræver.
test("the real frontend/src/lib/skewProtection.js currently has Skew Protection disabled", () => {
  const res = readSkewProtectionEnabledFlag();
  assert.equal(res.ok, true);
  assert.equal(
    res.enabled,
    false,
    "SKEW_PROTECTION_ENABLED er flippet til true — det er ejer-only (#2423); " +
      "opdatér denne test bevidst hvis ejeren har godkendt gen-tænding."
  );
});
