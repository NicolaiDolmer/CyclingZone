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

import {
  AREAS,
  STATES,
  TOKEN_BUDGET_FAIL,
  approxTokens,
  parseRegistry,
  render,
  validate,
} from "./generate-feature-status.mjs";

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

test("validate kraever note ved state dormant (#4928)", () => {
  const entries = parseRegistry(`features:
  - id: no-note-dormant
    area: ops
    title_en: X
    title_da: X
    state: dormant
    flag: x_enabled
    verified: 2026-09-07
`);
  assert.match(validate(entries).join("\n"), /state dormant kraever en note/);
});

test("validate accepterer state dormant med note", () => {
  const entries = parseRegistry(`features:
  - id: has-note-dormant
    area: ops
    title_en: X
    title_da: X
    state: dormant
    flag: x_enabled
    verified: 2026-09-07
    note: Bygget; flaget aabnes ved cutover.
`);
  assert.deepEqual(validate(entries), []);
});

test("STATES kender dormant og sorterer den lige efter beta", () => {
  assert.ok(STATES.includes("dormant"));
  assert.equal(STATES.indexOf("dormant"), STATES.indexOf("beta") + 1);
});

test("render grupperer dormant-raekker lige efter beta-raekker i samme area", () => {
  const entries = parseRegistry(`features:
  - id: building-x
    area: ops
    title_en: Building X
    title_da: Building X
    state: building
    verified: 2026-09-07
  - id: dormant-x
    area: ops
    title_en: Dormant X
    title_da: Dormant X
    state: dormant
    flag: dormant_x_enabled
    verified: 2026-09-07
    note: Bygget; flaget aabnes senere.
  - id: beta-x
    area: ops
    title_en: Beta X
    title_da: Beta X
    state: beta
    flag: beta_x_enabled
    verified: 2026-09-07
`);
  const markdown = render(entries);
  const betaIdx = markdown.indexOf("Beta X (`beta-x`)");
  const dormantIdx = markdown.indexOf("Dormant X (`dormant-x`)");
  const buildingIdx = markdown.indexOf("Building X (`building-x`)");
  assert.ok(betaIdx < dormantIdx && dormantIdx < buildingIdx);
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
  // live-poster (#5430): kompakt linje, ingen 7-kolonne tabelraekke.
  assert.match(markdown, /\*\*live:\*\* Alpha \(`alpha-feature`\) 2026-09-06/);
  assert.doesNotMatch(markdown, /\| Alpha \(`alpha-feature`\) \|/);
  // ikke-live-poster (building) faar stadig en fuld tabelraekke.
  assert.match(markdown, /\| Beta \(`beta-feature`\) \| building \| - \|/);
});

test("live-poster faar kompakt liste, ikke-live faar fuld tabel i samme area (#5430)", () => {
  const entries = parseRegistry(`features:
  - id: live-x
    area: ops
    title_en: Live X
    title_da: Live X
    state: live
    verified: 2026-09-07
  - id: building-x
    area: ops
    title_en: Building X
    title_da: Building X
    state: building
    verified: 2026-09-07
`);
  const markdown = render(entries);
  assert.match(markdown, /\*\*live:\*\* Live X \(`live-x`\) 2026-09-07/);
  assert.match(markdown, /\| Building X \(`building-x`\) \| building \| - \|/);
  // "live:"-linjen staar foer tabellen for samme area.
  assert.ok(markdown.indexOf("**live:**") < markdown.indexOf("| Building X"));
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

test("docs/FEATURE_STATUS.md er inden for token-loftet (#5430, jf. check-agent-token-hygiene.ps1)", () => {
  const entries = parseRegistry(readFileSync(join(ROOT, "docs", "FEATURE_REGISTRY.yml"), "utf8"));
  const tokens = approxTokens(render(entries));
  assert.ok(tokens <= TOKEN_BUDGET_FAIL, `FEATURE_STATUS.md er ${tokens} approx tokens, loftet er ${TOKEN_BUDGET_FAIL}`);
});

test("en ny live-raekke i registret koster kun en kompakt linje, ikke en fuld tabelraekke (forward-guard, #5430)", () => {
  const entries = parseRegistry(readFileSync(join(ROOT, "docs", "FEATURE_REGISTRY.yml"), "utf8"));
  const before = approxTokens(render(entries));
  const extra = {
    id: "guard-test-new-live-feature",
    area: "ops",
    title_en: "Guard test new live feature",
    title_da: "Guard test new live feature",
    state: "live",
    verified: "2026-09-25",
  };
  const after = approxTokens(render([...entries, extra]));
  const delta = after - before;
  // En fuld 7-kolonne tabelraekke koster typisk 40-60+ tokens (id + 6 kolonner
  // inkl. cellemarkoerer); en kompakt live-linje-tilfoejelse (" · navn (`id`) dato")
  // koster ca. 15-25. 30 er en solid margin der stadig ville fange en
  // regression tilbage til fulde raekker for live.
  assert.ok(delta <= 30, `en enkelt ny live-raekke kostede ${delta} approx tokens, forventet <= 30 (kompakt format)`);
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
