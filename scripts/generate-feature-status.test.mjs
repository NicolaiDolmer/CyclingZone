// Selvtest for scripts/generate-feature-status.mjs (#4921).
//
// Vagten er kun noget vaerd hvis den fejler naar den skal. Testen daekker
// derfor tre ting: at parseren laeser det flade skema (inkl. noter med "#"
// i sig), at valideringen afviser de fejl der ellers ville producere en
// misvisende status-fil, og at --check-stien faktisk exit 1'er paa drift.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AREAS, STATES, parseRegistry, render, validate } from "./generate-feature-status.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "generate-feature-status.mjs");

const MINIMAL = `# kommentar der skal ignoreres
features:
  - id: alpha-feature
    area: market
    title_en: Alpha
    title_da: Alfa
    state: live
    flag: alpha_enabled
    ssot: docs/TRANSFER_MARKET_RULES.md
    epic: 42
    verified: 2026-09-06
    note: Se PR #4913 for detaljer.

  - id: beta-feature
    area: race-engine
    title_en: Beta
    title_da: Beta
    state: building
    verified: 2026-09-06
`;

test("parseRegistry laeser det flade skema", () => {
  const entries = parseRegistry(MINIMAL);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "alpha-feature");
  assert.equal(entries[0].flag, "alpha_enabled");
  assert.equal(entries[1].id, "beta-feature");
  assert.equal(entries[1].flag, undefined);
});

test("parseRegistry beholder '#' inde i en note (ikke en kommentar)", () => {
  const entries = parseRegistry(MINIMAL);
  assert.equal(entries[0].note, "Se PR #4913 for detaljer.");
});

test("parseRegistry afviser en form den ikke forstaar", () => {
  assert.throws(
    () =>
      parseRegistry(`features:
  - id: nested
    area: market
    extra:
      - deep: value
`),
    /uventet form/,
  );
});

test("validate accepterer et gyldigt register", () => {
  assert.deepEqual(validate(parseRegistry(MINIMAL)), []);
});

test("validate fanger ukendt area, ukendt state, dublet-id og manglende felter", () => {
  const bad = parseRegistry(`features:
  - id: dup
    area: not-an-area
    title_en: X
    title_da: X
    state: shipped
    verified: 6-9-2026
  - id: dup
    area: market
    title_en: Y
    state: live
    verified: 2026-09-06
`);
  const errors = validate(bad).join("\n");
  assert.match(errors, /ukendt area "not-an-area"/);
  assert.match(errors, /ukendt state "shipped"/);
  assert.match(errors, /verified skal vaere YYYY-MM-DD/);
  assert.match(errors, /id findes to gange/);
  assert.match(errors, /mangler paakraevet felt "title_da"/);
});

test("validate afviser en note med | (ville bryde tabellen)", () => {
  const entries = parseRegistry(`features:
  - id: pipe-note
    area: ops
    title_en: X
    title_da: X
    state: idea
    verified: 2026-09-06
    note: a | b
`);
  assert.match(validate(entries).join("\n"), /note maa ikke indeholde \|/);
});

test("render sorterer area -> state -> id og markerer filen som genereret", () => {
  const markdown = render(parseRegistry(MINIMAL));
  assert.match(markdown, /GENERERET FIL/);
  // race-engine kommer foer market i AREAS, uanset raekkefoelgen i registret.
  assert.ok(markdown.indexOf("## race-engine") < markdown.indexOf("## market"));
  assert.match(markdown, /\| Alpha \(`alpha-feature`\) \| live \| `alpha_enabled` \|/);
  assert.match(markdown, /\| Beta \(`beta-feature`\) \| building \| - \|/);
});

test("render er stabil (samme input giver samme output)", () => {
  const entries = parseRegistry(MINIMAL);
  assert.equal(render(entries), render(entries));
});

test("roundtrip: det committede register genererer den committede status-fil", () => {
  // Samme kontrakt som --check, men uden at shelle ud: fanger ogsaa at
  // registret i repoet stadig er parsebart og validt.
  const source = readFileSync(join(ROOT, "docs", "FEATURE_REGISTRY.yml"), "utf8");
  const entries = parseRegistry(source);
  assert.deepEqual(validate(entries), []);
  const committed = readFileSync(join(ROOT, "docs", "FEATURE_STATUS.md"), "utf8");
  assert.equal(committed.replace(/\r\n/g, "\n"), render(entries).replace(/\r\n/g, "\n"));
});

test("registret bruger kun kendte areas og states", () => {
  const entries = parseRegistry(readFileSync(join(ROOT, "docs", "FEATURE_REGISTRY.yml"), "utf8"));
  for (const e of entries) {
    assert.ok(AREAS.includes(e.area), `${e.id}: ukendt area ${e.area}`);
    assert.ok(STATES.includes(e.state), `${e.id}: ukendt state ${e.state}`);
  }
});

test("--check exit 1 naar status-filen er ude af sync", () => {
  const dir = mkdtempSync(join(tmpdir(), "feature-status-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(SCRIPT, join(dir, "scripts", "generate-feature-status.mjs"));
  writeFileSync(join(dir, "docs", "FEATURE_REGISTRY.yml"), MINIMAL, "utf8");

  const run = (args) =>
    execFileSync(process.execPath, [join(dir, "scripts", "generate-feature-status.mjs"), ...args], {
      encoding: "utf8",
    });

  run([]);
  run(["--check"]); // i sync -> exit 0

  writeFileSync(join(dir, "docs", "FEATURE_STATUS.md"), "# haandredigeret\n", "utf8");
  assert.throws(() => run(["--check"]), (err) => err.status === 1);
});

test("--check exit 1 paa et ugyldigt register", () => {
  const dir = mkdtempSync(join(tmpdir(), "feature-status-bad-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(SCRIPT, join(dir, "scripts", "generate-feature-status.mjs"));
  writeFileSync(
    join(dir, "docs", "FEATURE_REGISTRY.yml"),
    `features:
  - id: broken
    area: nowhere
    title_en: X
    title_da: X
    state: live
    verified: 2026-09-06
`,
    "utf8",
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [join(dir, "scripts", "generate-feature-status.mjs"), "--check"], {
        encoding: "utf8",
      }),
    (err) => err.status === 1,
  );
});
