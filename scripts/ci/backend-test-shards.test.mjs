// Selvtest for scripts/ci/backend-test-shards.mjs (#7582).
//
//   node --test scripts/ci/backend-test-shards.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ALWAYS_RELEVANT_PREFIXES,
  IGNORED_DIRS,
  NARROWED_DIRECTORY_READS,
  REPO_ROOT,
  SHARD_TOTAL,
  TEST_FILE_SUFFIXES,
  classifyChangedFiles,
  collectBackendRelevantRefs,
  discoverBackendTestFiles,
  eventToLogLine,
  extractRepoReferences,
  formatVerifySummary,
  relevanceOf,
  stripComments,
  verifyShardLogs,
} from "./backend-test-shards.mjs";

const TOPS = ["docs", "frontend", "scripts", "database", ".claude", "marketing", "setup.py"];

// ------------------------------------------------------------
// Drift mod backend/scripts/run-tests.js
// ------------------------------------------------------------

test("filsoegningen spejler run-tests.js (suffikser og ignorerede mapper)", () => {
  const runner = readFileSync(path.join(REPO_ROOT, "backend", "scripts", "run-tests.js"), "utf8");
  const suffixes = /TEST_FILE_SUFFIXES = Object\.freeze\(\[([^\]]*)\]\)/u.exec(runner);
  const ignored = /IGNORED_DIRS = new Set\(\[([^\]]*)\]\)/u.exec(runner);
  assert.ok(suffixes && ignored, "run-tests.js har skiftet form; opdater spejlet i backend-test-shards.mjs");
  const list = (s) => [...s.matchAll(/"([^"]+)"/gu)].map((m) => m[1]).sort();
  assert.deepEqual(list(suffixes[1]), [...TEST_FILE_SUFFIXES].sort());
  assert.deepEqual(list(ignored[1]), [...IGNORED_DIRS].sort());
});

test("run-tests.js videresender CLI-argumenter til node:test (forudsaetning for --test-shard)", () => {
  const runner = readFileSync(path.join(REPO_ROOT, "backend", "scripts", "run-tests.js"), "utf8");
  assert.match(runner, /const extraArgs = process\.argv\.slice\(2\)/u);
  assert.match(runner, /\.\.\.extraArgs/u);
});

test("discoverBackendTestFiles finder .test.js/.ts/.mjs og springer node_modules over", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bts-"));
  try {
    mkdirSync(path.join(dir, "lib", "engine"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    for (const f of ["lib/a.test.js", "lib/engine/b.test.ts", "c.test.mjs", "lib/d.js", "lib/e.spec.js", "node_modules/x/f.test.js"]) {
      writeFileSync(path.join(dir, f), "");
    }
    assert.deepEqual(discoverBackendTestFiles(dir), ["c.test.mjs", "lib/a.test.js", "lib/engine/b.test.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("den rigtige backend har mange testfiler og economyEngine-filen (#3172)", () => {
  const files = discoverBackendTestFiles(path.join(REPO_ROOT, "backend"));
  assert.ok(files.length > 500, `forventede mange backend-testfiler, fandt ${files.length}`);
  assert.ok(files.includes("lib/economyEngine.test.js"));
});

// ------------------------------------------------------------
// Reporter
// ------------------------------------------------------------

test("eventToLogLine: test:summary med fil = ran, andre events med fil = seen", () => {
  const cwd = path.resolve("/repo/backend");
  assert.equal(eventToLogLine({ type: "test:summary", data: { file: path.join(cwd, "lib", "a.test.js") } }, cwd), "ran\tlib/a.test.js");
  assert.equal(eventToLogLine({ type: "test:start", data: { file: path.join(cwd, "lib", "a.test.js") } }, cwd), "seen\tlib/a.test.js");
  assert.equal(eventToLogLine({ type: "test:summary", data: {} }, cwd), null);
  assert.equal(eventToLogLine({ type: "test:plan", data: { file: undefined } }, cwd), null);
});

test("eventToLogLine: file://-URL normaliseres til relativ sti", () => {
  const cwd = path.resolve("/repo/backend");
  const url = new URL(`file://${path.join(cwd, "lib", "b.test.mjs").replaceAll("\\", "/").replace(/^(?!\/)/u, "/")}`).href;
  assert.equal(eventToLogLine({ type: "test:summary", data: { file: url } }, cwd), "ran\tlib/b.test.mjs");
});

// ------------------------------------------------------------
// Verify
// ------------------------------------------------------------

const DISCOVERED = ["lib/a.test.js", "lib/b.test.js", "lib/c.test.js", "lib/economyEngine.test.js", "x.test.mjs"];
const logs = (entries) => new Map(entries.map(([i, lines]) => [i, lines.join("\n")]));

test("verify: groen naar hver fil koerte i praecis een del, og tallene summerer til hele listen", () => {
  const result = verifyShardLogs({
    discovered: DISCOVERED,
    logs: logs([
      [1, ["seen\tlib/economyEngine.test.js", "ran\tlib/a.test.js", "seen\tlib/a.test.js", "ran\tx.test.mjs"]],
      [2, ["ran\tlib/b.test.js", "seen\t../scripts/helper.mjs"]],
      [3, ["ran\tlib/c.test.js"]],
    ]),
  });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.deepEqual([...result.perShard.entries()], [[1, 3], [2, 1], [3, 1]]);
  assert.equal(result.covered, DISCOVERED.length);
  assert.match(formatVerifySummary(result), /\| \*\*Sum\*\* \| \*\*5\*\* \|/u);
});

test("verify: roed naar en fil ikke koerte i nogen del", () => {
  const result = verifyShardLogs({
    discovered: DISCOVERED,
    logs: logs([
      [1, ["seen\tlib/economyEngine.test.js", "ran\tlib/a.test.js", "ran\tx.test.mjs"]],
      [2, ["ran\tlib/b.test.js"]],
      [3, []],
    ]),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["lib/c.test.js"]);
});

test("verify: roed naar en fil koerte i to dele", () => {
  const result = verifyShardLogs({
    discovered: DISCOVERED,
    logs: logs([
      [1, ["seen\tlib/economyEngine.test.js", "ran\tlib/a.test.js", "ran\tx.test.mjs"]],
      [2, ["ran\tlib/b.test.js", "ran\tlib/a.test.js"]],
      [3, ["ran\tlib/c.test.js"]],
    ]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.duplicated.length, 1);
  assert.match(result.duplicated[0], /lib\/a\.test\.js \(del 1, 2\)/u);
});

test("verify: roed naar en del-log mangler helt", () => {
  const result = verifyShardLogs({
    discovered: ["lib/a.test.js"],
    logs: logs([[1, ["ran\tlib/a.test.js"]], [2, []]]),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes(`del 3/${SHARD_TOTAL}: log mangler`)));
  assert.match(formatVerifySummary(result), /log mangler/u);
});

// ------------------------------------------------------------
// Reference-scanner
// ------------------------------------------------------------

const refsOf = (src, file = "backend/lib/x.test.js") => extractRepoReferences(src, file, TOPS);

test("scanner: relativ import ud af backend/ loeses mod filens mappe", () => {
  const refs = refsOf('import { a } from "../../scripts/lint-finance-types.mjs";');
  assert.deepEqual(refs, [{ ref: "scripts/lint-finance-types.mjs", cut: false }, { ref: "scripts/lint-finance-types.mjs", cut: false }]);
});

test("scanner: relativ sti der bliver i backend/ taeller ikke", () => {
  assert.deepEqual(refsOf('import { a } from "../scripts/run-tests-args.mjs";', "backend/lib/x.test.js").filter((r) => r.ref.startsWith("scripts/run-tests")), [
    // (b) tager "scripts/..." konservativt med, selvom (a) loeser den ind i backend/.
    { ref: "scripts/run-tests-args.mjs", cut: false },
  ]);
  assert.deepEqual(refsOf('const x = "./fixtures/a.json";'), []);
});

test("scanner: join(ROOT, \"frontend\", \"src\") giver frontend/src", () => {
  const refs = refsOf('const FE = join(REPO_ROOT, "frontend", "src");');
  assert.deepEqual(refs, [{ ref: "frontend/src", cut: false }]);
});

test("scanner: join(here, \"..\", \"..\", \"frontend\", \"public\", \"locales\") loeses fra modulets mappe", () => {
  const refs = refsOf('const L = join(here, "..", "..", "frontend", "public", "locales");');
  assert.deepEqual(refs, [{ ref: "frontend/public/locales", cut: false }]);
});

test("scanner: join(BACKEND_ROOT, \"scripts\") er backend/scripts, ikke repo-scripts", () => {
  assert.deepEqual(refsOf('walk(join(BACKEND_ROOT, "scripts"), f);'), []);
});

test("scanner: dynamisk led afbryder stien (hele praefikset er relevant)", () => {
  const refs = refsOf("const p = `../../docs/snapshots/${id}/x.json`;");
  assert.ok(refs.some((r) => r.ref === "docs/snapshots" && r.cut));
});

test("scanner: sammenligninger og arrays med et top-level-navn er ikke stier", () => {
  assert.deepEqual(refsOf('if (entry === "scripts") continue; const roles = ["finance", "marketing"];'), []);
});

test("scanner: kommentarer og negerede globs taeller ikke", () => {
  assert.deepEqual(refsOf('// se .claude/learnings/2026-01-01-x.md og "docs/NOW.md"\nconst w = ["!/docs/**"];'), []);
});

test("scanner: prosa-strenge giver kun hele filnavne, aldrig mapper", () => {
  const refs = refsOf('lines.push(`Dette boer have et \\`.claude/learnings/\\`-indlaeg og se frontend/src/lib/x.js.`);');
  assert.deepEqual(refs, [{ ref: "frontend/src/lib/x.js", cut: false }]);
});

test("scanner: et top-level-navn der kun findes i PR'ens filliste (slettet fil) kan stadig matches", () => {
  const src = 'const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");';
  assert.deepEqual(extractRepoReferences(src, "backend/x.test.js", ["docs"]), []);
  assert.deepEqual(extractRepoReferences(src, "backend/x.test.js", ["docs", ".gitignore"]), [{ ref: ".gitignore", cut: false }]);
  const refs = collectBackendRelevantRefs(REPO_ROOT, { extraTopNames: [".gitignore"] });
  assert.ok(relevanceOf(".gitignore", refs), "backend-testene laeser .gitignore; en PR der sletter den skal koere dem");
});

test("stripComments bevarer strenge med // og /*", () => {
  const src = 'const u = "https://x.y/*z"; // kommentar\n/* blok */ const v = 1;';
  const out = stripComments(src);
  assert.match(out, /"https:\/\/x\.y\/\*z"/u);
  assert.doesNotMatch(out, /kommentar|blok/u);
});

// ------------------------------------------------------------
// Klassifikation
// ------------------------------------------------------------

const REFS = [
  { ref: "frontend/src", cut: false },
  { ref: "frontend/public/locales", cut: false },
  { ref: "docs/snapshots/49", cut: true },
  { ref: "docs", cut: false, topLevelExt: ".md" },
];

test("relevanceOf: backend/, ci.yml og testfiler overalt er altid relevante", () => {
  for (const f of ["backend/server.js", ".github/workflows/ci.yml", "scripts/ci/backend-test-shards.mjs", "marketing/app/x.test.tsx", "scripts/foo.test.mjs"]) {
    assert.ok(relevanceOf(f, []), f);
  }
  assert.ok(ALWAYS_RELEVANT_PREFIXES.includes("backend/"));
});

test("relevanceOf: naevnte stier, mapper og afbrudte praefikser", () => {
  assert.ok(relevanceOf("frontend/src/pages/X.jsx", REFS));
  assert.ok(relevanceOf("frontend/public/locales/da/help.json", REFS));
  assert.ok(relevanceOf("docs/snapshots/4931/a.json", REFS));
  assert.equal(relevanceOf("frontend/srcfoo/x.js", REFS), null);
  assert.equal(relevanceOf("frontend/tests/e2e/a.spec.ts", REFS), null);
});

test("relevanceOf: indsnaevret docs-laesning rammer kun docs/*.md paa topniveau", () => {
  assert.ok(relevanceOf("docs/NOW.md", REFS));
  assert.equal(relevanceOf("docs/design/TASTE.md", REFS), null);
  assert.equal(relevanceOf("docs/FEATURE_REGISTRY.yml", REFS), null);
});

test("classifyChangedFiles: ops-/docs-PR uden backend-relevans springer over", () => {
  const res = classifyChangedFiles([".github/workflows/roadmap-sync.yml", "docs/design/TASTE.md", ".claude/learnings/x.md"], REFS);
  assert.equal(res.needsBackend, false);
  assert.deepEqual(res.reasons, []);
});

test("classifyChangedFiles: een relevant fil er nok", () => {
  const res = classifyChangedFiles(["docs/design/TASTE.md", "frontend/src/App.jsx"], REFS);
  assert.equal(res.needsBackend, true);
  assert.equal(res.reasons[0].file, "frontend/src/App.jsx");
});

test("classifyChangedFiles: tom filliste koerer for sikkerheds skyld", () => {
  assert.equal(classifyChangedFiles([], REFS).needsBackend, true);
});

// ------------------------------------------------------------
// Den rigtige backend (kontrakt mod repoets nuvaerende tilstand)
// ------------------------------------------------------------

test("rigtig scanning: de kendte laesninger uden for backend/ er fundet", () => {
  const refs = collectBackendRelevantRefs(REPO_ROOT);
  const hit = (file) => relevanceOf(file, refs) !== null;
  // backend-tests laeser frontend-kilder og locales (paritets- og i18n-kontrakter).
  assert.ok(hit("frontend/src/lib/marketValues.js"));
  assert.ok(hit("frontend/public/locales/en/errors.json"));
  // Migrationer laeses af PGlite-testene.
  assert.ok(hit("database/2026-09-15-4619-riders-squad.sql"));
  // Topniveau-docs laeses af promisedTestFilesExist.
  assert.ok(hit("docs/GAME_INVARIANTS.md"));
  // Kode uden for backend/, som en backend-test importerer.
  assert.ok(hit("scripts/lint-finance-types.mjs"));
});

test("rigtig scanning: rene ops-filer er ikke relevante", () => {
  const refs = collectBackendRelevantRefs(REPO_ROOT);
  for (const f of [".github/workflows/roadmap-sync.yml", "scripts/build-stop.json", "AGENTS.md", "docs/design/TASTE.md"]) {
    assert.equal(relevanceOf(f, refs), null, f);
  }
});

test("indsnaevringen af docs-laesningen haenger stadig sammen med kilden", () => {
  for (const rule of NARROWED_DIRECTORY_READS) {
    const source = readFileSync(path.join(REPO_ROOT, rule.source), "utf8");
    assert.ok(
      source.includes(rule.marker),
      `${rule.source} indeholder ikke laengere markoeren; indsnaevringen er slaaet fra (konservativt), ret eller fjern reglen`,
    );
  }
});
