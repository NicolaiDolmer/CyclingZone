import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scan, evaluate, inScope, defaultFiles, KNOWN_DEBT } from "./check-locale-compare.mjs";

test("flags localeCompare without a locale", () => {
  const f = scan("rows.sort((a, b) => a.rider_id.localeCompare(b.rider_id));", "x.ts");
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 1);
});

test("flags an explicit undefined locale and Intl.Collator without one", () => {
  const src = [
    "a.localeCompare(b, undefined);",
    "const c = new Intl.Collator();",
    "const d = Intl.Collator(undefined, { numeric: true });",
  ].join("\n");
  assert.deepEqual(scan(src, "x.ts").map((f) => f.line), [1, 2, 3]);
});

test("accepts an explicit locale and compareIds", () => {
  const src = [
    'a.localeCompare(b, "en-US");',
    'String(a.id).localeCompare(String(b.id), "en-US", { numeric: true });',
    "a.localeCompare(b, ENGINE_COLLATION_LOCALE);",
    'new Intl.Collator("en-US");',
    "compareIds(a.id, b.id);",
  ].join("\n");
  assert.deepEqual(scan(src, "x.ts"), []);
});

test("ignores comments and strings", () => {
  const src = [
    "// a.localeCompare(b)",
    "/* x.localeCompare(y) */",
    'const s = "a.localeCompare(b)";',
    "const t = `${'('}`;",
  ].join("\n");
  assert.deepEqual(scan(src, "x.ts"), []);
});

test("parens inside the argument do not hide a missing locale", () => {
  const f = scan("a.localeCompare(String(fn(b, c)));", "x.ts");
  assert.equal(f.length, 1);
});

test("scope: engine and race files, never tests", () => {
  assert.equal(inScope("backend/lib/engine/v4/index.ts"), true);
  assert.equal(inScope("backend/lib/engine/v4/mechanics/breakaway.ts"), true);
  assert.equal(inScope("backend/lib/raceSimulator.js"), true);
  assert.equal(inScope("backend/lib/raceEngineV4Bridge.js"), true);
  assert.equal(inScope("backend/lib/engine/v4/index.test.ts"), false);
  assert.equal(inScope("backend/lib/raceSimulator.test.js"), false);
  assert.equal(inScope("backend/lib/boardMembers.js"), false);
  assert.equal(inScope("backend/lib/engine/v4/fixtures/itt-solo/README.md"), false);
});

test("ratchet: new call fails, known debt passes, shrinking is reported", () => {
  const debt = { "backend/lib/raceOld.js": 2 };
  const one = [{ file: "backend/lib/raceOld.js" }];
  const three = [...one, ...one, ...one];
  assert.equal(evaluate(three, debt).violations.length, 1);
  const ok = evaluate(one, debt);
  assert.equal(ok.violations.length, 0);
  assert.deepEqual(ok.shrunk, [{ file: "backend/lib/raceOld.js", allowed: 2, n: 1 }]);
  assert.equal(evaluate([{ file: "backend/lib/engine/v4/index.ts" }], debt).violations.length, 1);
});

test("the engine path has no allowance", () => {
  for (const file of Object.keys(KNOWN_DEBT)) {
    assert.ok(!file.startsWith("backend/lib/engine/"), file);
    assert.ok(!/raceSimulator|raceEngineV4Bridge/.test(file), file);
  }
});

test("the repo passes the guard today", () => {
  const files = defaultFiles();
  assert.ok(files.length > 50, `scope found ${files.length} files`);
  const findings = files.flatMap((f) => scan(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), f));
  assert.deepEqual(evaluate(findings).violations, []);
});
