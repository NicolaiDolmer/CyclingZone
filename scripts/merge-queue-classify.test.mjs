// #5508 · Tests for klassifikatoren bag hard rule 35. Ingen gh, intet net.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CATEGORY,
  classifyPr,
  fetchPrFromGh,
  formatClassification,
  hasProdMeasurement,
  isFrontendUiFile,
  isPlayerTextFile,
  isReleaseOpsFile,
  OWNER_GO_MARKER,
  parseCliArgs,
  semverBumpKind,
} from "./merge-queue-classify.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "merge-queue-classify.mjs");

const MEASURED = "## Hvad\nRettet.\n\n## Fejlens effekt i prod\n- Før: 69 hold mistede rækker 23/9\n- Efter: 0 hold 24/9\n\n## Risk\nlav";

const pr = (over = {}) => ({ number: 100, title: "feat: x", body: "", labels: [], files: [], author: { login: "NicolaiDolmer" }, ...over });

// ── (c) ────────────────────────────────────────────────────────────────────

test("(c) Dependabot patch/minor med kun package-filer; major og fremmede filer = ejer-go", () => {
  const dep = (title, files = ["backend/package.json", "backend/package-lock.json"]) =>
    classifyPr(pr({ title, files, author: { login: "dependabot[bot]" }, labels: [{ name: "dependencies" }] }));
  assert.equal(dep("chore(deps): bump express from 5.1.0 to 5.1.2 in /backend").category, CATEGORY.C_SAFE);
  assert.equal(dep("chore(deps-dev): bump vite from 7.1.0 to 7.2.0 in /frontend", ["frontend/package.json", "frontend/package-lock.json"]).category, CATEGORY.C_SAFE);
  const major = dep("chore(deps): bump react from 19.1.0 to 20.0.0 in /frontend");
  assert.equal(major.category, CATEGORY.OWNER);
  assert.match(major.reason, /major/);
  assert.equal(dep("chore(deps): bump x from 1.0.0 to 1.0.1", ["backend/package.json", "backend/lib/x.js"]).category, CATEGORY.OWNER);
  assert.equal(semverBumpKind("bump x from 1.2.3 to 1.2.9"), "patch");
  assert.equal(semverBumpKind("bump x from v1.2.3 to v1.3.0"), "minor");
  assert.equal(semverBumpKind("bump x from 1.2.3 to 2.0.0"), "major");
  assert.equal(semverBumpKind("no versions here"), null);
});

test("(c) docs uden spillertekst, CI/hooks, test-only, og kombinationer", () => {
  assert.equal(classifyPr(pr({ files: ["docs/NOW.md", "docs/drafts/spec-x.md", ".claude/learnings/2026-09-24-x.md"] })).category, CATEGORY.C_SAFE);
  assert.equal(classifyPr(pr({ files: [".github/workflows/ci.yml", "scripts/hooks/guard-x.sh"] })).category, CATEGORY.C_SAFE);
  assert.equal(classifyPr(pr({ files: ["backend/lib/x.test.js", "frontend/src/pages/HelpPage.flagGates.test.js", "frontend/tests/e2e/x.spec.ts"] })).category, CATEGORY.C_SAFE);
  const combo = classifyPr(pr({ files: ["docs/x.md", ".github/workflows/ci.yml", "scripts/x.test.mjs"] }));
  assert.equal(combo.category, CATEGORY.C_SAFE);
  assert.match(combo.reason, /docs uden spillertekst \+ CI\/hooks \+ test-only/);
});

test("docs MED spillertekst er ejer-go: patch notes, locales, TONE-flader", () => {
  for (const f of [
    "frontend/src/data/patchNotes.js",
    "frontend/public/locales/en/help.json",
    "frontend/public/locales/da/help.json",
    "backend/locales/en.json",
    "frontend/src/pages/PatchNotesPage.jsx",
    "frontend/index.html",
    "docs/TONE_OF_VOICE.md",
  ]) {
    assert.equal(isPlayerTextFile(f), true, f);
    const r = classifyPr(pr({ files: ["docs/x.md", f] }));
    assert.equal(r.category, CATEGORY.OWNER, f);
    assert.match(r.reason, /spillertekst/);
  }
});

// ── (b) ────────────────────────────────────────────────────────────────────

test("(b) motor-PR: kun backend/lib/engine/v4 (+ tests/docs) = kategori b; #5580/#5581 undtaget", () => {
  const files = ["backend/lib/engine/v4/finale.ts", "backend/lib/engine/v4/finale.test.ts", "docs/RACE_ENGINE_RULES.md"];
  const ok = classifyPr(pr({ title: "feat(engine): gevinst i stigningsselektion (Refs #5577)", files }));
  assert.equal(ok.category, CATEGORY.B_ENGINE_V4);
  const excepted = classifyPr(pr({ title: "feat(engine): indsats model 3 (Refs #5580)", files }));
  assert.equal(excepted.category, CATEGORY.OWNER);
  assert.match(excepted.reason, /#5580/);
  const exceptedByNumber = classifyPr(pr({ number: 5581, title: "feat(engine): realisme-gate", files }));
  assert.equal(exceptedByNumber.category, CATEGORY.OWNER);
  // Motor + noget uden for v4 er ikke (b).
  const mixed = classifyPr(pr({ title: "feat(engine): x", files: ["backend/lib/engine/v4/finale.ts", "backend/lib/raceRunner.js"] }));
  assert.equal(mixed.category, CATEGORY.OWNER);
});

// ── (a) ────────────────────────────────────────────────────────────────────

test("(a) brand-fix uden spillertekst kraever prod-maaling i body", () => {
  const files = ["backend/routes/api.js", "backend/routes/api.test.js"];
  const withMeasure = classifyPr(pr({
    title: "fix(dashboard): resultater tabt ved 1.000-raekker (Refs #5589)",
    body: MEASURED,
    files,
    labels: [{ name: "brand" }],
  }));
  assert.equal(withMeasure.category, CATEGORY.A_BRAND_FIX);
  const noMeasure = classifyPr(pr({ title: "fix(dashboard): resultater tabt", body: "## Hvad\nRettet.", files }));
  assert.equal(noMeasure.category, CATEGORY.OWNER);
  assert.match(noMeasure.reason, /prod-maaling/);
  // Samme fix med spillertekst er ejer-go uanset maaling.
  const withText = classifyPr(pr({ title: "fix(dashboard): x", body: MEASURED, files: [...files, "frontend/public/locales/en/dashboard.json"] }));
  assert.equal(withText.category, CATEGORY.OWNER);
});

test("(a) prod-maaling kraever sektion med Foer: og Efter:; loese formuleringer taeller ikke (ejer 4/10)", () => {
  assert.equal(hasProdMeasurement(MEASURED), true);
  assert.equal(hasProdMeasurement("## Fault effect in prod\n- Before: 503 on deploy\n- After: deploy passes\n"), true);
  // #6135-klassen: loes saetning eller "Prod-maaling foer/efter:"-overskrift i fritekst.
  assert.equal(hasProdMeasurement("Målt i prod 23/9: 12 hold"), false);
  assert.equal(hasProdMeasurement("measured in prod before/after"), false);
  assert.equal(hasProdMeasurement("**Prod-måling før/efter:** Før merge: 404. Efter: 200."), false);
  // Sektion uden begge linjer, eller med tom Efter:, er ikke en maaling.
  assert.equal(hasProdMeasurement("## Fejlens effekt i prod\nFør: 69 hold\n"), false);
  assert.equal(hasProdMeasurement("## Fejlens effekt i prod\nFør: 69 hold\nEfter:\n"), false);
  // Linjerne skal staa I sektionen, ikke i en senere.
  assert.equal(hasProdMeasurement("## Fejlens effekt i prod\nFør: 69 hold\n## Andet\nEfter: 0 hold\n"), false);
  assert.equal(hasProdMeasurement("virker lokalt"), false);
});

test("ejer-go er klaebende: markoer paa PR'en slaar en senere maaling i body (ejer 4/10)", () => {
  const files = ["backend/routes/api.js"];
  const base = { title: "fix(x): y", body: MEASURED, files, labels: [{ name: "brand" }] };
  assert.equal(classifyPr(pr(base)).category, CATEGORY.A_BRAND_FIX);
  const sticky = classifyPr(pr({ ...base, comments: [{ body: "andet" }, { body: `${OWNER_GO_MARKER}\nmerge-koe: EJER-GO` }] }));
  assert.equal(sticky.category, CATEGORY.OWNER);
  assert.match(sticky.reason, /klaebende/);
  assert.equal(classifyPr(pr({ ...base, comments: [{ body: "ingen markoer" }] })).category, CATEGORY.A_BRAND_FIX);
});

test("release-tjek, deploy og overvaagning er ejer-go, ogsaa som CI-fil (ejer 4/10)", () => {
  for (const f of [
    ".github/workflows/deploy-verify.yml",
    ".github/workflows/auto-migrate.yml",
    "backend/railway.json",
    "backend/lib/healthRoutes.ts",
    "backend/lib/stallWatchdog.js",
    "backend/scripts/checkBackendReadiness.ts",
    "scripts/verify-deploy.ps1",
    "scripts/merge-queue-classify.mjs",
  ]) {
    assert.equal(isReleaseOpsFile(f), true, f);
    const r = classifyPr(pr({ title: "fix(x): y", body: MEASURED, files: [f], labels: [{ name: "brand" }] }));
    assert.equal(r.category, CATEGORY.OWNER, f);
    assert.match(r.reason, /release\/deploy\/overvaagning/);
  }
  // Rene tests af de samme filer og almindelige CI-filer forbliver (c).
  assert.equal(isReleaseOpsFile("backend/lib/healthRoutes.test.ts"), false);
  assert.equal(classifyPr(pr({ files: ["backend/lib/stallWatchdog.test.js"] })).category, CATEGORY.C_SAFE);
  assert.equal(classifyPr(pr({ files: [".github/workflows/ci.yml"] })).category, CATEGORY.C_SAFE);
  // #6135's faktiske filsaet.
  const pr6135 = classifyPr(pr({ title: "fix(health): separate deployment liveness from DB readiness (#5905)", body: MEASURED,
    files: [".github/workflows/deploy-verify.yml", "backend/lib/healthRoutes.ts", "backend/server.js", "scripts/verify-deploy.ps1"] }));
  assert.equal(pr6135.category, CATEGORY.OWNER);
});

test("(a) fix i spillervendte tal (oekonomi/traening/vaegte) er ejer-go", () => {
  const r = classifyPr(pr({ title: "fix(training): raten for mellem-pas", body: "maalt i prod", files: ["backend/lib/dailyTraining.js"] }));
  assert.equal(r.category, CATEGORY.OWNER);
  assert.match(r.reason, /spillervendte tal/);
});

// ── Ejerens roede linjer ────────────────────────────────────────────────────

test("roede linjer vinder over alt: migration, flag-flip, risk:high, UI, prod-skrivning", () => {
  const mig = classifyPr(pr({ files: ["docs/x.md", "database/2026-09-24-x.sql"] }));
  assert.equal(mig.category, CATEGORY.OWNER);
  assert.match(mig.reason, /migration/);

  assert.match(classifyPr(pr({ labels: ["flag-flip"], files: ["docs/x.md"] })).reason, /flag-flip/);
  const flip = classifyPr(pr({ title: "chore(flags): flip training_tick_per_race_day on", files: ["backend/lib/stageFlagCatalog.js"] }));
  assert.equal(flip.category, CATEGORY.OWNER);
  assert.match(flip.reason, /flag-flip/);

  assert.match(classifyPr(pr({ labels: [{ name: "risk:high" }], files: ["docs/x.md"] })).reason, /risk:high/);

  const ui = classifyPr(pr({ title: "fix(ui): x", body: "maalt i prod", files: ["frontend/src/pages/DashboardPage.jsx"] }));
  assert.equal(ui.category, CATEGORY.OWNER);
  assert.match(ui.reason, /UI/);
  assert.equal(isFrontendUiFile("frontend/src/pages/DashboardPage.jsx"), true);
  assert.equal(isFrontendUiFile("frontend/src/pages/DashboardPage.test.jsx"), false);
  assert.equal(isFrontendUiFile("frontend/public/locales/en/x.json"), false);

  const prodWrite = classifyPr(pr({ title: "ops: retirement-notice-freeze --execute", files: ["scripts/ops/x.mjs"] }));
  assert.match(prodWrite.reason, /prod-skrivning/);
});

test("kode uden for kategorierne og tom filliste er ejer-go med grund", () => {
  const r = classifyPr(pr({ title: "feat(squad): trup-sider", files: ["backend/lib/squads.js", "backend/lib/squads.test.js"] }));
  assert.equal(r.category, CATEGORY.OWNER);
  assert.match(r.reason, /backend\/lib\/squads\.js/);
  assert.match(classifyPr(pr({ files: [] })).reason, /ingen filliste/);
  // gh's fil-form ({path}) og GitHub-API'ets ({filename}) accepteres begge.
  assert.equal(classifyPr(pr({ files: [{ path: "docs/x.md" }] })).category, CATEGORY.C_SAFE);
  assert.equal(classifyPr(pr({ files: [{ filename: "docs/x.md" }] })).category, CATEGORY.C_SAFE);
});

test("formatClassification: én linje, kategori eller EJER-GO foerst", () => {
  assert.equal(formatClassification(classifyPr(pr({ files: ["docs/x.md"] }))), "KATEGORI c: (c) Dependabot/docs/CI-hooks-test [docs uden spillertekst]");
  assert.match(formatClassification(classifyPr(pr({ files: ["database/x.sql"] }))), /^EJER-GO: kraever ejer-go \[migration: database\/x\.sql\]$/);
});

// ── CLI ────────────────────────────────────────────────────────────────────

test("parseCliArgs og fetchPrFromGh (gh-kaldet er injiceret)", () => {
  assert.deepEqual(parseCliArgs(["--pr", "5654"]), { pr: 5654, repo: "NicolaiDolmer/CyclingZone", input: null, json: false });
  assert.deepEqual(parseCliArgs(["--input", "x.json", "--json", "--repo", "o/r"]), { pr: null, repo: "o/r", input: "x.json", json: true });
  assert.throws(() => parseCliArgs([]), /--pr/);
  assert.throws(() => parseCliArgs(["--pr", "abc"]), /positivt/);
  assert.throws(() => parseCliArgs(["--nope"]), /Ukendt/);
  const calls = [];
  const out = fetchPrFromGh(7, "o/r", (args) => { calls.push(args); return JSON.stringify({ number: 7, title: "t", files: [] }); });
  assert.equal(out.number, 7);
  assert.deepEqual(calls[0], ["pr", "view", "7", "--repo", "o/r", "--json", "number,title,body,labels,files,author,comments"]);
});

test("CLI end-to-end med --input (ingen gh): tekst og --json", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cz-mq-classify-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "pr.json");
  writeFileSync(file, JSON.stringify({ number: 5659, title: "docs(drafts): fire specs", body: "", labels: [{ name: "docs-only" }], files: [{ path: "docs/drafts/a.md" }], author: { login: "NicolaiDolmer" } }));

  const text = spawnSync(process.execPath, [SCRIPT, "--input", file], { encoding: "utf8" });
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout.trim(), "KATEGORI c: (c) Dependabot/docs/CI-hooks-test [docs uden spillertekst]");

  const json = spawnSync(process.execPath, [SCRIPT, "--input", file, "--json"], { encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.number, 5659);
  assert.equal(parsed.category, "c");
  assert.equal(parsed.ownerGo, false);

  const bad = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--pr/);
});
