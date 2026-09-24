// node --test scripts/check-pr-claims.test.mjs
// PR-paastands-tjekket (#5507). Baglaens-fixtures efter PR #5446, #5501 og
// #5503 - de tre PR'er hvis body paastod noget koden ikke bar, og som kom
// igennem review. Fixtures er korte udsnit af bodyen + de filer der afgjorde
// sagen, i hukommelsen: ingen git, intet netvaerk.

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkClaims, cleanBody, extractClaims, parseDiff, toMarkdown } from "./check-pr-claims.mjs";

function run({ body, head, base = head, diff = "", isIgnored }) {
  return checkClaims({ body, diffText: diff, headFiles: head, baseFiles: base, isIgnored });
}

function claim(report, type, value) {
  const r = report.results.find((x) => x.type === type && x.value === value);
  assert.ok(r, `paastanden ${type} "${value}" blev ikke trukket ud af bodyen`);
  return r;
}

// ---------------------------------------------------------------- PR #5501
const MOCK_5501 = {
  path: "frontend/src/preview/installPreviewMock.js",
  text: [
    "function previewBestRoleEnabled() {",
    '  const param = new URLSearchParams(window.location.search).get("bestRole");',
    '  if (param === "on") localStorage.setItem("cz_mock_best_role", "1");',
    '  return localStorage.getItem("cz_mock_best_role") !== "0";',
    "}",
  ].join("\n"),
};
const MAIN_5501 = { path: "frontend/src/main.jsx", text: 'if (import.meta.env.VITE_PREVIEW_MOCK) { await import("./preview/installPreviewMock.js"); }' };

test("BAGLAENS PR #5501: ?bestRole-paastanden fanges som 'kun i preview-mocken'", () => {
  const body = "- **Preview:** kontakten er ON paa preview-deployet; `?bestRole=off` / `?bestRole=on` skifter (huskes).";
  const report = run({ body, head: [MOCK_5501, MAIN_5501] });
  const r = claim(report, "param", "bestRole");
  assert.equal(r.verdict, "kun-mock-preview");
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /kun i preview-mocken/);
  assert.match(report.warnings[0], /VITE_PREVIEW_MOCK/);
});

test("BAGLAENS PR #5501: rettelsen 'findes INGEN ?bestRole=' var ogsaa forkert - samme svar", () => {
  const body = "- **Preview (rettet):** der findes INGEN `?bestRole=`-parameter i koden.";
  const report = run({ body, head: [MOCK_5501, MAIN_5501] });
  assert.equal(claim(report, "param", "bestRole").verdict, "kun-mock-preview");
});

test("en parameter som den rigtige app laeser, er 'findes' og giver ingen advarsel", () => {
  const body = "Aabn `/riders?view=grid` paa preview.";
  const report = run({ body, head: [{ path: "frontend/src/pages/RidersPage.jsx", text: 'const view = params.get("view");' }] });
  assert.equal(claim(report, "param", "view").verdict, "findes");
  assert.deepEqual(report.warnings, []);
});

// ---------------------------------------------------------------- PR #5503
const GEN_5503 = {
  path: "backend/lib/fictionalRiderGenerator.js",
  text: [
    'export const PRIMARY_TYPE_FROM_DISTRIBUTION_FLAG_KEY = "rider_primary_type_from_distribution";',
    "export function generateFictionalRiders(opts = {}) {",
    '  const primaryTypeMode = opts.primaryTypeMode ?? "tier";',
    "  return primaryTypeMode;",
    "}",
  ].join("\n"),
};
const CALLER_5503 = { path: "backend/lib/aiTeamGenerator.js", text: 'import { generateFictionalRiders } from "./fictionalRiderGenerator.js";\nexport const riders = generateFictionalRiders({ count: 3 });' };
const DEV_5503 = { path: "backend/scripts/dev/typeDistribution5327.mjs", text: 'generateFictionalRiders({ primaryTypeMode: "distribution" });' };
const TEST_5503 = { path: "backend/lib/fictionalRiderGenerator.test.js", text: 'generateFictionalRiders({ primaryTypeMode: "distribution" });' };

test("BAGLAENS PR #5503: opts-kontakten og *_FLAG_KEY uden kaldested fanges", () => {
  const body = [
    "## Bag kontakt (OFF som default)",
    '- `primaryTypeMode` er et opts-felt paa `generateFictionalRiders()`, default `"tier"`.',
    "- `PRIMARY_TYPE_FROM_DISTRIBUTION_FLAG_KEY` er eksporteret som den tiltaenkte app_config-noegle.",
  ].join("\n");
  const head = [GEN_5503, CALLER_5503, DEV_5503, TEST_5503];
  const report = run({ body, head, base: [CALLER_5503] });
  const opts = claim(report, "kontakt", "primaryTypeMode");
  assert.deepEqual(opts.callSites, [], "dev-scriptet og testen er ikke kaldesteder");
  assert.ok(!report.results.some((r) => r.type === "kontakt" && r.value === "generateFictionalRiders"), "`navn()` er en funktion, ikke en kontakt");
  const key = claim(report, "kontakt", "PRIMARY_TYPE_FROM_DISTRIBUTION_FLAG_KEY");
  assert.equal(key.key, "rider_primary_type_from_distribution");
  assert.deepEqual(key.callSites, []);
  assert.equal(key.isNew, true);
  assert.equal(report.warnings.filter((w) => /intet kaldested/.test(w)).length, 2);
});

test("en opts-kontakt som et produktions-kaldested sender, giver ingen advarsel", () => {
  const body = "- `primaryTypeMode` er et opts-felt bag kontakten.";
  const caller = { path: "backend/lib/aiTeamGenerator.js", text: 'generateFictionalRiders({ primaryTypeMode: "distribution" });' };
  // Kalderen staar FOERST (som i git's alfabetiske raekkefoelge): hjemmet skal
  // findes paa `opts.primaryTypeMode`, ikke paa raekkefoelgen.
  const report = run({ body, head: [caller, GEN_5503] });
  const r = claim(report, "kontakt", "primaryTypeMode");
  assert.deepEqual(r.homes, ["backend/lib/fictionalRiderGenerator.js"]);
  assert.deepEqual(r.callSites, ["backend/lib/aiTeamGenerator.js"]);
  assert.deepEqual(report.warnings, []);
});

// ---------------------------------------------------------------- PR #5446
const SELECT_5446 = {
  path: "backend/lib/riderValuationModelSelect.js",
  text: [
    'import { readFileSync } from "node:fs";',
    'export const RIDER_VALUATION_MODEL_KEY = "rider_valuation_model";',
    "const FILES = {",
    '  v4: join(__dirname, "./riderValuationModelV4.json"),',
    '  v5: join(__dirname, "./riderValuationModelV5.json"),',
    "};",
    "async function readChoice(client) {",
    '  const { data } = await client.from("app_config").select("value").eq("key", RIDER_VALUATION_MODEL_KEY).maybeSingle();',
    "  return data?.value;",
    "}",
    "export async function loadValuationModel(client) {",
    "  return JSON.parse(readFileSync(FILES[(await readChoice(client)) === \"v5\" ? \"v5\" : \"v4\"], \"utf8\"));",
    "}",
  ].join("\n"),
};
const VIA_SWITCH = [
  { path: "backend/lib/riderValueRefresh.js", text: 'import { loadValuationModel } from "./riderValuationModelSelect.js";\nexport async function run(c) { return loadValuationModel(c); }' },
  { path: "backend/lib/riderProgressionEngine.js", text: 'import { loadValuationModel } from "./riderValuationModelSelect.js";\nexport async function t(c) { return loadValuationModel(c); }' },
];
const DIRECT = (path) => ({ path, text: 'const MODEL = JSON.parse(readFileSync(join(__dirname, "../lib/riderValuationModelV4.json"), "utf8"));' });
const SQL_5446 = { path: "database/2026-09-20-5443-rider-valuation-model.sql", text: "INSERT INTO public.app_config (key, value) VALUES ('rider_valuation_model', '\"v4\"'::jsonb) ON CONFLICT (key) DO NOTHING;" };
const BODY_5446 = [
  "**Modellen er IKKE aktiv naar denne PR merges.** Den taendes af ejeren med et skridt: en app_config-noegle.",
  "```sql",
  "UPDATE public.app_config SET value = '\"v5\"'::jsonb WHERE key = 'rider_valuation_model';",
  "```",
].join("\n");

test("BAGLAENS PR #5446: en kontakt som tre produktions-laesere gaar udenom, fanges", () => {
  const head = [SELECT_5446, ...VIA_SWITCH, DIRECT("backend/routes/api.js"), DIRECT("backend/lib/backfillCores.js"), DIRECT("backend/lib/starterSquadAllocator.js"), SQL_5446];
  const report = run({ body: BODY_5446, head, base: head.filter((f) => f !== SQL_5446 && f !== SELECT_5446) });
  const r = claim(report, "kontakt", "rider_valuation_model");
  assert.deepEqual(r.callSites, ["backend/lib/riderProgressionEngine.js", "backend/lib/riderValueRefresh.js"]);
  assert.deepEqual(r.bypass.map((b) => b.path).sort(), ["backend/lib/backfillCores.js", "backend/lib/starterSquadAllocator.js", "backend/routes/api.js"]);
  const w = report.warnings.find((x) => /udenom kontakten/.test(x));
  assert.ok(w, "advarslen om laesere udenom kontakten mangler");
  assert.match(w, /3 produktionsfil/);
});

test("BAGLAENS PR #5446: efter rettelsen (alle laesere gennem kontakten) er der ingen advarsel", () => {
  const head = [SELECT_5446, ...VIA_SWITCH, SQL_5446, { path: "backend/routes/api.js", text: 'import { loadValuationModel } from "../lib/riderValuationModelSelect.js";\n// laeste foer riderValuationModelV4.json direkte\nexport const x = loadValuationModel;' }];
  const report = run({ body: BODY_5446, head });
  assert.deepEqual(claim(report, "kontakt", "rider_valuation_model").bypass, []);
  assert.deepEqual(report.warnings, []);
});

// ---------------------------------------------------------------- oevrige typer
test("endpoint: en backend-route er 'findes'; kun en mock-handler er 'kun-mock-preview'", () => {
  const head = [
    { path: "backend/routes/api.js", text: 'router.get("/display-flags", handler);' },
    { path: "frontend/src/preview/mockHandlers.js", text: 'if (url.endsWith("/api/youth-squads")) return json([]);' },
  ];
  const report = run({ body: "Ny `GET /api/display-flags` og `GET /api/youth-squads`.", head });
  assert.equal(claim(report, "endpoint", "/api/display-flags").verdict, "findes");
  assert.equal(claim(report, "endpoint", "/api/youth-squads").verdict, "kun-mock-preview");
});

test("endpoint som frontenden kalder, men ingen backend definerer, er 'findes-ikke' med en note", () => {
  const head = [{ path: "frontend/src/lib/api.js", text: 'fetch("/api/ghost-route")' }];
  const report = run({ body: "Kalder `/api/ghost-route`.", head });
  const r = claim(report, "endpoint", "/api/ghost-route");
  assert.equal(r.verdict, "findes-ikke");
  assert.match(r.note, /ingen backend-route/);
});

test("sti: findes, findes ikke, gitignoreret og slettet i diffen", () => {
  const head = [{ path: "backend/lib/keep.js", text: "export const a = 1;" }];
  const diff = ["diff --git a/backend/lib/gone.js b/backend/lib/gone.js", "deleted file mode 100644", "--- a/backend/lib/gone.js", "+++ /dev/null"].join("\n");
  const report = run({
    body: "Filer: `backend/lib/keep.js`, `backend/lib/gone.js`, `backend/lib/never.js` og `balance-internals/tal.md`.",
    head,
    base: [...head, { path: "backend/lib/gone.js", text: "" }],
    diff,
    isIgnored: (p) => p.startsWith("balance-internals/"),
  });
  assert.equal(claim(report, "sti", "backend/lib/keep.js").verdict, "findes");
  assert.equal(claim(report, "sti", "backend/lib/gone.js").verdict, "slettet-i-diffen");
  assert.equal(claim(report, "sti", "backend/lib/never.js").verdict, "findes-ikke");
  assert.equal(claim(report, "sti", "balance-internals/tal.md").verdict, "gitignoreret");
});

test("sti relativt til frontend/ matches paa suffiks", () => {
  const report = run({ body: "Gengiv: `node tests/e2e/shots.mjs`", head: [{ path: "frontend/tests/e2e/shots.mjs", text: "" }] });
  assert.equal(claim(report, "sti", "tests/e2e/shots.mjs").verdict, "findes");
});

test("env-navne: VITE_* og process.env.X slaas op i kode og workflows", () => {
  const head = [MAIN_5501, { path: ".github/workflows/ci.yml", text: "env:\n  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}" }];
  const report = run({ body: "Kraever `VITE_PREVIEW_MOCK` og `process.env.SUPABASE_URL`, men ikke `VITE_NOPE`.", head });
  assert.equal(claim(report, "env", "VITE_PREVIEW_MOCK").verdict, "findes");
  assert.equal(claim(report, "env", "SUPABASE_URL").verdict, "findes");
  assert.equal(claim(report, "env", "VITE_NOPE").verdict, "findes-ikke");
});

test("i diffen / paa main skelnes", () => {
  const diff = ["diff --git a/backend/lib/n.js b/backend/lib/n.js", "new file mode 100644", "+++ b/backend/lib/n.js", '+export const NEW_THING_LIMIT = 3;'].join("\n");
  const head = [{ path: "backend/lib/n.js", text: "export const NEW_THING_LIMIT = 3;" }];
  const r = claim(run({ body: "Ny `NEW_THING_LIMIT`.", head, base: [], diff }), "konstant", "NEW_THING_LIMIT");
  assert.equal(r.inDiff, true);
  assert.equal(r.onMain, false);
});

test("cleanBody fjerner CodeRabbits auto-summary og billed-links", () => {
  const body = "Rigtig `?real=1`\n<!-- This is an auto-generated comment: release notes by coderabbit.ai -->\nTilfoejede `?fake=1`\n<!-- end of auto-generated comment: release notes by coderabbit.ai -->\n![](https://x/y.png?raw=1)";
  const cleaned = cleanBody(body);
  assert.ok(cleaned.includes("?real=1"));
  assert.ok(!cleaned.includes("fake"));
  assert.ok(!cleaned.includes("raw=1"));
});

test("extractClaims: parametre i links til appen taeller, andre links ignoreres", () => {
  const claims = extractClaims("Se https://cz-git-x.vercel.app/riders/1?bestRole=off og https://github.com/o/r/pull/1?tab=files");
  assert.deepEqual(claims.filter((c) => c.type === "param").map((c) => c.value), ["bestRole"]);
});

test("extractClaims: en hjaelpefunktion paa en linje der ogsaa naevner 'kontakten' langt vaek, er ikke en kontakt", () => {
  const line = "samme regel som backendens `bestRoleForAbilities` (ECONOMY_RULES Datakontrakt 1a). `riderOverallRating` beholder sin signatur og laeser kontakten";
  const values = extractClaims(line).filter((c) => c.type === "kontakt").map((c) => c.value);
  assert.ok(!values.includes("bestRoleForAbilities"));
});

test("extractClaims: kendte noegler fanges ogsaa uden backticks, tabelnavne er ikke kontakter", () => {
  const claims = extractClaims("Flip race_engine_v4 i `app_config`-noeglen.", new Set(["race_engine_v4"]));
  const kontakter = claims.filter((c) => c.type === "kontakt").map((c) => c.value);
  assert.deepEqual(kontakter, ["race_engine_v4"]);
});

test("parseDiff laeser status og tilfoejede linjer", () => {
  const d = parseDiff(["diff --git a/x.js b/x.js", "new file mode 100644", "--- /dev/null", "+++ b/x.js", "@@ -0,0 +1 @@", "+hej"].join("\n"));
  assert.deepEqual(d.get("x.js"), { status: "added", added: ["hej"] });
});

test("playwright-kommando med --prefix frontend men uden --config giver en bemaerkning", () => {
  const bad = run({ body: "- [x] `npx --prefix frontend playwright test foo.spec.ts` groen", head: [] });
  assert.ok(bad.notices.some((n) => /uden --config/.test(n)));
  const ok = run({ body: "- [x] `npx --prefix frontend playwright test --config=frontend/playwright.config.js foo.spec.ts`", head: [] });
  assert.ok(!ok.notices.some((n) => /uden --config/.test(n)));
});

test("toMarkdown giver en tabel med kaldesteder til revieweren", () => {
  const head = [GEN_5503, CALLER_5503];
  const md = toMarkdown(run({ body: "- `primaryTypeMode` er et opts-felt bag kontakten.", head }));
  assert.match(md, /\| kontakt \| `primaryTypeMode` \| findes \|/);
  assert.match(md, /kaldesteder: INGEN/);
  assert.match(md, /ADVARSEL/);
});
