// #5508 · Tests for klassifikatoren bag hard rule 35. Ingen gh, intet net.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  analyzeMigrationSql,
  CATEGORY,
  classifyPr,
  fetchMigrationFacts,
  fetchPrFromGh,
  formatClassification,
  hasProdMeasurement,
  isFrontendUiFile,
  isPlayerTextFile,
  isReleaseOpsFile,
  OWNER_GO_MARKER,
  parseCliArgs,
  semverBumpKind,
  splitSqlStatements,
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
  assert.match(formatClassification(classifyPr(pr({ files: ["database/x.sql"] }))), /^EJER-GO: kraever ejer-go \[migration: database\/x\.sql \(ukendt om migrationen er ny\)\]$/);
});

// ── (d) additive, idempotente migrationer (ejer-valg B 4/11, #7578) ────────

const FLAG_SEED_OFF = `-- #1: flag. DROP TABLE i en kommentar taeller ikke.
INSERT INTO public.app_config (key, value, description)
VALUES ('x_enabled', '"off"'::jsonb, 'Stage flag (off|on). Owner-only flip; never DROP or UPDATE.')
ON CONFLICT (key) DO NOTHING;`;

const ADD_COLUMN_INDEX = `BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS value_at_close INTEGER,
  ADD COLUMN IF NOT EXISTS note text DEFAULT 'x';
COMMENT ON COLUMN public.auctions.value_at_close IS 'snapshot; NULL for old rows';
CREATE INDEX CONCURRENTLY IF NOT EXISTS auctions_close_idx ON public.auctions (value_at_close) WHERE value_at_close IS NOT NULL;
COMMIT;
NOTIFY pgrst, 'reload schema';`;

test("analyzeMigrationSql: additive, idempotente former", () => {
  assert.equal(analyzeMigrationSql(FLAG_SEED_OFF).additive, true);
  assert.equal(analyzeMigrationSql(ADD_COLUMN_INDEX).additive, true);
  assert.deepEqual(analyzeMigrationSql(FLAG_SEED_OFF).flagKeys, ["x_enabled"]);
  assert.deepEqual(analyzeMigrationSql(ADD_COLUMN_INDEX).flagKeys, []);
  assert.equal(analyzeMigrationSql("ALTER TABLE x ADD COLUMN IF NOT EXISTS a numeric(10, 2), ADD COLUMN IF NOT EXISTS b timestamp with time zone DEFAULT now(), ADD COLUMN IF NOT EXISTS c text[] NULL;").additive, true);
  // Flere flag i én saetning, false i stedet for "off", citeret tabelnavn.
  assert.equal(analyzeMigrationSql(`INSERT INTO "app_config" (key, value) VALUES ('a', '"off"'::jsonb), ('b', 'false') ON CONFLICT DO NOTHING;`).additive, true);
});

test("analyzeMigrationSql: destruktivt, RLS, grants og ikke-idempotent er ejer-go", () => {
  const cases = [
    ["DROP INDEX IF EXISTS x;", /DROP/],
    ["ALTER TABLE t DROP COLUMN IF EXISTS c;", /DROP/],
    ["TRUNCATE public.x;", /TRUNCATE/],
    ["DELETE FROM public.app_config WHERE key = 'x';", /DELETE/],
    ["UPDATE public.riders SET x = 1;", /UPDATE/],
    [`INSERT INTO public.app_config (key, value) VALUES ('x', '"off"'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`, /UPDATE/],
    ["GRANT SELECT ON public.x TO authenticated;", /GRANT/],
    ["REVOKE ALL ON FUNCTION public.f() FROM anon;", /GRANT\/REVOKE/],
    ["ALTER TABLE public.x ENABLE ROW LEVEL SECURITY;", /RLS/],
    ["CREATE POLICY p ON public.x FOR SELECT USING (true);", /RLS/],
    ["ALTER TABLE public.x RENAME COLUMN a TO b;", /RENAME/],
    // Ikke idempotent.
    ["CREATE INDEX x_idx ON public.x (a);", /ikke idempotent/],
    ["ALTER TABLE public.x ADD COLUMN c int;", /ikke idempotent/],
    [`INSERT INTO public.app_config (key, value) VALUES ('x', '"off"'::jsonb);`, /ikke idempotent/],
    // Flag-flip forklaedt som seed, og data-INSERT uden for flag-tabellen.
    [`INSERT INTO public.app_config (key, value) VALUES ('x', '"on"'::jsonb) ON CONFLICT (key) DO NOTHING;`, /ikke er off/],
    [`INSERT INTO public.app_config (key, value) VALUES ('x', '"beta"'::jsonb) ON CONFLICT (key) DO NOTHING;`, /ikke er off/],
    [`INSERT INTO public.app_config (key, value) VALUES ('a', '"off"'::jsonb), ('b', 'true') ON CONFLICT DO NOTHING;`, /ikke er off/],
    ["INSERT INTO public.roadmap_items (id, title) VALUES (1, 'x') ON CONFLICT DO NOTHING;", /spillervendt/],
    // Aendrer eksisterende eller adfaerd.
    ["ALTER TABLE public.x ALTER COLUMN c SET DEFAULT 0;", /aendrer eksisterende/],
    ["ALTER TABLE public.x ADD COLUMN IF NOT EXISTS c int NOT NULL DEFAULT 0;", /nullable/],
    ["ALTER TABLE public.x ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id);", /nullable/],
    ["ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS ordinal serial;", /nullable/],
    ["ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS ordinal bigserial;", /nullable/],
    ["ALTER TABLE public.x ADD COLUMN IF NOT EXISTS c my_domain;", /nullable/],
    ["ALTER TABLE public.x ADD COLUMN IF NOT EXISTS c uuid DEFAULT gen_random_uuid();", /nullable/],
    [`INSERT INTO public.app_config (key, value, description) VALUES ('x', '"off"'::jsonb, nextval('public.s')::text) ON CONFLICT (key) DO NOTHING;`, /udtryk/],
    ["CREATE UNIQUE INDEX IF NOT EXISTS x_u ON public.x (a);", /UNIQUE/],
    ["CREATE TABLE IF NOT EXISTS public.x (id int);", /ny tabel/],
    ["CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;", /funktion/],
    ["DO $$ BEGIN PERFORM 1; END $$;", /ukendt/],
    // Fail-closed: tom og ulaeselig SQL.
    ["-- kun en kommentar\n", /tom/],
    ["INSERT INTO public.app_config (key) VALUES ('x", /ulaeselig/],
  ];
  for (const [sql, reason] of cases) {
    const r = analyzeMigrationSql(sql);
    assert.equal(r.additive, false, sql);
    assert.match(r.reason, reason, sql);
  }
  // Destruktivt i koden vinder, selvom resten er additiv.
  assert.equal(analyzeMigrationSql(`${FLAG_SEED_OFF}\nDROP FUNCTION IF EXISTS public.f();`).additive, false);
  // Et DROP gemt i en dollar-literal (DO-blok) er stadig ejer-go (ukendt form).
  assert.equal(analyzeMigrationSql("DO $x$ BEGIN EXECUTE 'DROP TABLE t'; END $x$;").additive, false);
});

test("splitSqlStatements: kommentarer og literaler fjernes, semikolon i streng deler ikke", () => {
  const stmts = splitSqlStatements("/* a /* nested */ b */ SELECT 'x;y' -- c;\n; SELECT $q$z;$q$;");
  assert.deepEqual(stmts.map((s) => s.code), ["SELECT '§0'", "SELECT '§0'"]);
  assert.deepEqual(stmts.map((s) => s.literals), [["x;y"], ["z;"]]);
  assert.equal(splitSqlStatements("SELECT 1 /* aaben"), null);
  assert.deepEqual(splitSqlStatements("SELECT E'a\\'b'")[0].literals, ["a'b"]);
});

// Fakta for en ny migration hvis flag-noegler ingen kode paa base naevner.
const facts = (sqlByPath, keys = ["x_enabled", "a", "b"]) => ({
  migrationSql: sqlByPath,
  migrationIsNew: Object.fromEntries(Object.keys(sqlByPath).map((p) => [p, true])),
  flagKeyInCode: Object.fromEntries(keys.map((k) => [k, false])),
});

test("(d) PR med kun additive migrationer + docs/test = kategori d; alt andet ejer-go", () => {
  const files = [{ path: "database/2026-11-04-1-x-flag.sql", additions: 5, deletions: 0 }, { path: "docs/x.md" }, { path: "backend/lib/x.test.js" }];
  const ok = classifyPr(pr({ title: "feat(flags): seed x off", files, ...facts({ "database/2026-11-04-1-x-flag.sql": FLAG_SEED_OFF }) }));
  assert.equal(ok.category, CATEGORY.D_ADDITIVE_MIGRATION);
  assert.equal(ok.ownerGo, false);
  assert.match(ok.reason, /additiv migration: database\/2026-11-04-1-x-flag\.sql \+ docs uden spillertekst \+ test-only/);
  assert.match(formatClassification(ok), /^KATEGORI d: \(d\) additiv, idempotent migration/);
  assert.equal(classifyPr(pr({ files: ["database/a.sql", "database/b.sql"], ...facts({ "database/a.sql": FLAG_SEED_OFF, "database/b.sql": ADD_COLUMN_INDEX }) })).category, CATEGORY.D_ADDITIVE_MIGRATION);

  // Én destruktiv migration ud af to er nok til ejer-go, og grunden navngiver filen.
  const mixed = classifyPr(pr({ files: ["database/a.sql", "database/b.sql"], ...facts({ "database/a.sql": FLAG_SEED_OFF, "database/b.sql": "DROP TABLE x;" }) }));
  assert.equal(mixed.category, CATEGORY.OWNER);
  assert.match(mixed.reason, /migration: database\/b\.sql \(DROP\)/);
  // Additiv migration + kode, UI, spillertekst eller flag-flip-label er stadig ejer-go.
  const seed = facts({ "database/a.sql": FLAG_SEED_OFF });
  assert.match(classifyPr(pr({ files: ["database/a.sql", "backend/lib/x.js"], ...seed })).reason, /additiv migration sammen med kode: backend\/lib\/x\.js/);
  assert.match(classifyPr(pr({ files: ["database/a.sql", "frontend/src/pages/X.jsx"], ...seed })).reason, /UI/);
  assert.match(classifyPr(pr({ files: ["database/a.sql", "frontend/public/locales/en/x.json"], ...seed })).reason, /spillertekst/);
  assert.match(classifyPr(pr({ labels: ["flag-flip"], files: ["database/a.sql"], ...seed })).reason, /flag-flip/);
  // Klaebende ejer-go slaar ogsaa en additiv migration.
  assert.match(classifyPr(pr({ files: ["database/a.sql"], ...seed, comments: [{ body: OWNER_GO_MARKER }] })).reason, /klaebende/);
});

test("(d) fail-closed: manglende fakta, eksisterende migration, flag der allerede laeses af kode", () => {
  const path = "database/a.sql";
  const seed = facts({ [path]: FLAG_SEED_OFF });
  // Manglende SQL eller ukendt om filen er ny.
  assert.match(classifyPr(pr({ files: [path], migrationIsNew: { [path]: true } })).reason, /SQL ikke hentet/);
  assert.match(classifyPr(pr({ files: [path], migrationSql: { [path]: FLAG_SEED_OFF } })).reason, /ukendt om migrationen er ny/);
  assert.match(classifyPr(pr({ files: [path] })).reason, /ukendt om migrationen er ny/);
  // Eksisterende migration: slettede linjer, eller kun tilfoejede (auto-migrate koerer den aldrig igen).
  assert.match(classifyPr(pr({ files: [{ path, additions: 1, deletions: 1 }], ...seed })).reason, /eksisterende migration aendret/);
  assert.match(classifyPr(pr({ files: [{ path, additions: 3, deletions: 0 }], ...seed, migrationIsNew: { [path]: false } })).reason, /eksisterende migration aendret/);
  // En off-seed for et flag som kode allerede laeser kan skifte adfaerd (manglende noegle = on).
  const read = classifyPr(pr({ files: [path], ...seed, flagKeyInCode: { x_enabled: true } }));
  assert.equal(read.category, CATEGORY.OWNER);
  assert.match(read.reason, /flag-seed x_enabled laeses allerede af kode/);
  assert.match(classifyPr(pr({ files: [path], ...seed, flagKeyInCode: {} })).reason, /ukendt om kode laeser flaget x_enabled/);
  // Kolonne/indeks uden flag kraever ingen kode-opslag.
  assert.equal(classifyPr(pr({ files: [path], ...facts({ [path]: ADD_COLUMN_INDEX }, []) })).category, CATEGORY.D_ADDITIVE_MIGRATION);
});

test("fetchMigrationFacts: SQL paa head, ny-vs-eksisterende paa base, flag-noegler via git grep", () => {
  const ghCalls = [];
  const gitCalls = [];
  const runGh = (args) => {
    ghCalls.push(args);
    const url = args.at(-1);
    if (url.includes("gone.sql")) throw new Error("HTTP 404");
    if (url.endsWith("?ref=bbb2222")) {
      if (url.includes("old.sql")) return "SELECT 1;";
      if (url.includes("flaky.sql")) throw new Error("HTTP 502");
      throw Object.assign(new Error("Command failed"), { stderr: "gh: Not Found (HTTP 404)" });
    }
    return url.includes("new.sql") ? FLAG_SEED_OFF : "SELECT 1;";
  };
  const runGit = (args) => {
    gitCalls.push(args);
    throw Object.assign(new Error("exit 1"), { status: 1 });
  };
  const files = ["database/new.sql", "database/old.sql", "database/gone.sql", "database/flaky.sql", "docs/x.md"].map((p) => ({ path: p }));
  const out = fetchMigrationFacts({ headRefOid: "aaa1111", baseRefOid: "bbb2222", files }, "o/r", { runGh, runGit });
  assert.deepEqual(Object.keys(out.migrationSql).sort(), ["database/flaky.sql", "database/new.sql", "database/old.sql"]);
  assert.deepEqual(out.migrationIsNew, { "database/new.sql": true, "database/old.sql": false });
  assert.deepEqual(out.flagKeyInCode, { x_enabled: false });
  assert.deepEqual(ghCalls[0], ["api", "-H", "Accept: application/vnd.github.raw", "repos/o/r/contents/database/new.sql?ref=aaa1111"]);
  assert.deepEqual(gitCalls[0], ["grep", "-q", "-F", "-e", "x_enabled", "bbb2222", "--", ".", ":(exclude)database", ":(exclude)docs", ":(exclude)*.md"]);
  assert.equal(ghCalls.some((a) => a.at(-1).includes("docs/x.md")), false);

  // git grep finder noeglen (exit 0) = true; ukendt commit (exit 128) = udeladt.
  const found = fetchMigrationFacts({ headRefOid: "aaa1111", baseRefOid: "bbb2222", files: [{ path: "database/new.sql" }] }, "o/r", { runGh, runGit: () => "" });
  assert.deepEqual(found.flagKeyInCode, { x_enabled: true });
  const unknown = fetchMigrationFacts({ headRefOid: "aaa1111", baseRefOid: "bbb2222", files: [{ path: "database/new.sql" }] }, "o/r", {
    runGh,
    runGit: () => { throw Object.assign(new Error("bad object"), { status: 128 }); },
  });
  assert.deepEqual(unknown.flagKeyInCode, {});
  // Uden gyldige SHA'er hentes intet, og classifyPr giver ejer-go.
  assert.deepEqual(fetchMigrationFacts({ files: [{ path: "database/a.sql" }] }, "o/r", { runGh, runGit }), { migrationSql: {}, migrationIsNew: {}, flagKeyInCode: {} });
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
  assert.deepEqual(calls[0], ["pr", "view", "7", "--repo", "o/r", "--json", "number,title,body,labels,files,author,comments,headRefOid,baseRefOid"]);
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
