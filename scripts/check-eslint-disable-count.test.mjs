// scripts/check-eslint-disable-count.test.mjs
// ============================================================
// Tests for the eslint-disable ratchet-guard (#4332).
// Run: node --test scripts/check-eslint-disable-count.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countDisableDirectives,
  scanRepo,
  scanUnjustified,
  compareAgainstBaseline,
  findUnjustifiedDirectives,
} from "./check-eslint-disable-count.mjs";

test("countDisableDirectives flags eslint-disable-next-line", () => {
  assert.equal(
    countDisableDirectives("// eslint-disable-next-line react-hooks/exhaustive-deps\nuseEffect();"),
    1
  );
});

test("countDisableDirectives flags trailing eslint-disable-line", () => {
  assert.equal(
    countDisableDirectives('useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps'),
    1
  );
});

test("countDisableDirectives flags block-comment eslint-disable-line", () => {
  assert.equal(
    countDisableDirectives("useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);"),
    1
  );
});

test("countDisableDirectives flags a directive with a trailing -- reason", () => {
  assert.equal(
    countDisableDirectives("// eslint-disable-next-line react-hooks/exhaustive-deps -- ids er derived af cacheKey"),
    1
  );
});

test("countDisableDirectives flags multiple rules on one directive as ONE directive", () => {
  assert.equal(
    countDisableDirectives("// eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/immutability"),
    1
  );
});

test("countDisableDirectives flags bare eslint-disable (blanket)", () => {
  assert.equal(countDisableDirectives("/* eslint-disable */"), 1);
  assert.equal(countDisableDirectives("/* eslint-disable*/"), 1);
});

test("countDisableDirectives counts multiple directives across lines", () => {
  const src = [
    "// eslint-disable-next-line react-hooks/exhaustive-deps",
    "useEffect(a, []);",
    "// eslint-disable-next-line no-unused-vars",
    "const x = 1;",
  ].join("\n");
  assert.equal(countDisableDirectives(src), 2);
});

test("countDisableDirectives does NOT count prose mentioning the word (ResultaterPage.jsx:179 case)", () => {
  // Ordret det reelle uddrag fra frontend/src/pages/ResultaterPage.jsx —
  // "eslint-disable" optraeder i loebende tekst, ikke i direktiv-position
  // (efterfoelges af et punktum, ikke whitespace/komma/kommentar-slut).
  const src = [
    "  // #4068: loadAllInner memoized (useCallback) med de tre url-drevne filtre som",
    "  // deps — samme værdier mount-effekten nedenfor allerede lytter på, så",
    "  // memoiseringen hverken ændrer kald-hyppigheden eller genindfører et",
    "  // eslint-disable. loadAll (wrapperen) er stabil så snart loadAllInner er det.",
  ].join("\n");
  assert.equal(countDisableDirectives(src), 0);
});

test("countDisableDirectives does not false-positive on unrelated comments", () => {
  assert.equal(countDisableDirectives("// this is a normal comment"), 0);
  assert.equal(countDisableDirectives("// eslint-disabled (typo, not a directive)"), 0);
});

test("compareAgainstBaseline only flags increases over baseline", () => {
  const findings = { "a.jsx": 2 };
  const baseline = { files: { "a.jsx": 1 } };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
  assert.match(newViolations[0], /a\.jsx/);
});

test("compareAgainstBaseline flags a brand new file not in baseline", () => {
  const findings = { "new-file.jsx": 1 };
  const baseline = { files: {} };
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 1);
  assert.match(newViolations[0], /new-file\.jsx/);
});

test("compareAgainstBaseline reports stale baseline when a directive is removed", () => {
  const findings = { "a.jsx": 0 };
  const baseline = { files: { "a.jsx": 1 } };
  const { newViolations, stale } = compareAgainstBaseline(findings, baseline);
  assert.equal(newViolations.length, 0);
  assert.equal(stale.length, 1);
});

test("nul NYE eslint-disable-fund paa nuvaerende traae mod committet baseline", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const baseline = JSON.parse(readFileSync(join(here, "eslint-disable-baseline.json"), "utf8"));
  const findings = scanRepo();
  const { newViolations } = compareAgainstBaseline(findings, baseline);
  assert.equal(
    newViolations.length,
    0,
    `Nye eslint-disable-direktiver (kør \`node scripts/check-eslint-disable-count.mjs\` for detaljer):\n${newViolations.join("\n")}`
  );
});

// --- Begrundelses-kravet (#4332-gennemgangen, 30/8) ------------------------

test("findUnjustifiedDirectives flags a directive with no -- reason", () => {
  assert.deepEqual(
    findUnjustifiedDirectives("// eslint-disable-next-line react-hooks/exhaustive-deps\nuseEffect();"),
    [1]
  );
});

test("findUnjustifiedDirectives accepts a directive with a -- reason", () => {
  assert.deepEqual(
    findUnjustifiedDirectives("// eslint-disable-next-line react-hooks/exhaustive-deps -- kun mount-fetch"),
    []
  );
});

test("findUnjustifiedDirectives accepts a block-comment directive with a reason", () => {
  assert.deepEqual(
    findUnjustifiedDirectives("useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps -- kun mount */ }, []);"),
    []
  );
});

test("findUnjustifiedDirectives rejects an empty -- reason", () => {
  assert.deepEqual(
    findUnjustifiedDirectives("// eslint-disable-next-line react-hooks/exhaustive-deps -- "),
    [1]
  );
});

test("findUnjustifiedDirectives ignores prose and a decrement before the directive", () => {
  assert.deepEqual(findUnjustifiedDirectives("// vi genindfoerer et eslint-disable."), []);
  // `i--` staar FOER direktivet, saa den maa ikke tælle som begrundelse.
  assert.deepEqual(
    findUnjustifiedDirectives("i--; // eslint-disable-line no-console"),
    [1]
  );
});

test("nul ubegrundede direktiver paa nuvaerende traae", () => {
  const hits = scanUnjustified();
  const total = Object.values(hits).reduce((s, l) => s + l.length, 0);
  assert.equal(
    total,
    0,
    `eslint-disable uden \`-- begrundelse\`:\n${Object.entries(hits).map(([f, l]) => `${f}: ${l.join(", ")}`).join("\n")}`
  );
});

test("ResultaterPage.jsx:179 (real file) is not counted as a directive", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..");
  const src = readFileSync(join(repoRoot, "frontend/src/pages/ResultaterPage.jsx"), "utf8");
  const line179 = src.split("\n")[178]; // 0-indexed
  assert.match(line179, /eslint-disable/);
  assert.equal(countDisableDirectives(line179), 0);
});
