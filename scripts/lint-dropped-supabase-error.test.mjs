// scripts/lint-dropped-supabase-error.test.mjs
// ============================================================
// Tests for forward-guarden mod droppede Supabase-errors (#2897 / #2861-rodårsagen).
// Run: node --test scripts/lint-dropped-supabase-error.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findDroppedSupabaseErrors,
  topLevelKeys,
  collectFiles,
  BASELINE,
} from "./lint-dropped-supabase-error.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Kernemønsteret: det der brændte kalender-siden (#2861) ───────────────────

test("flager `const { data } = await supabase...` uden error", () => {
  const src = `const { data } = await supabase.from("races").select("*").eq("season_id", id);`;
  assert.equal(findDroppedSupabaseErrors(src).length, 1);
});

test("flager aliaseret data uden error", () => {
  const src = `const { data: team } = await supabase.from("teams").select("*").single();`;
  assert.equal(findDroppedSupabaseErrors(src).length, 1);
});

test("flager multi-linje-kæde (den faktiske skrivestil i api.js)", () => {
  const src = `
    const { data: rows } = await supabase
      .from("race_results")
      .select("rider_id, points_earned")
      .eq("race_id", raceId)
      .order("rank", { ascending: true });
  `;
  const findings = findDroppedSupabaseErrors(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

test("flager `let { data } = await supabase...`", () => {
  const src = `let { data } = await supabase.from("x").select("*");`;
  assert.equal(findDroppedSupabaseErrors(src).length, 1);
});

test("flager .rpc-kald uden error", () => {
  const src = `const { data } = await supabase.rpc("apply_stage_result", { p_race_id: id });`;
  assert.equal(findDroppedSupabaseErrors(src).length, 1);
});

// ── Det korrekte mønster må ikke flages ──────────────────────────────────────

test("destruktureret error → ikke flaget", () => {
  const src = `const { data, error } = await supabase.from("x").select("*");`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

test("aliaseret error → ikke flaget", () => {
  const src = `const { data: rows, error: rowsErr } = await supabase.from("x").select("*");`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

test("nested data-destrukturering med error på top-niveau → ikke flaget", () => {
  // Det faktiske auth-mønster i api.js.
  const src = `const { data: { user }, error } = await supabase.auth.getUser(token);`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

test("data + count + error → ikke flaget", () => {
  const src = `const { data, error, count } = await query;`;
  // `query` er ikke en genkendelig supabase-kæde, men error ER destruktureret →
  // to grunde til ikke at flage. Begge skal holde.
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

// ── Afgrænsning: ikke-Supabase-kald må ikke flages ───────────────────────────

test("almindelig helper uden supabase-signatur → ikke flaget", () => {
  const src = `const { data } = await axios.get("/api/riders");`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

test("ikke-await'et destrukturering → ikke flaget", () => {
  const src = `const { data } = cachedResult.from("x");`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

test("mønster uden `data`-binding → ikke flaget", () => {
  const src = `const { error } = await supabase.from("x").update({ a: 1 }).eq("id", 2);`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

// ── Strenge, kommentarer og markør-escape-hatch ──────────────────────────────

test("mønsteret i en streng giver ikke false positive", () => {
  const src = `const msg = "const { data } = await supabase.from('x').select('*');";`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

test("mønsteret i en kommentar giver ikke false positive", () => {
  const src = `// const { data } = await supabase.from("x").select("*");\nconst y = 1;`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

test("'// best-effort'-markør på samme linje → ikke flaget", () => {
  const src = `const { data } = await supabase.from("x").select("*"); // best-effort: kun til visning`;
  assert.equal(findDroppedSupabaseErrors(src).length, 0);
});

test("'// error-ok'-markør over statementet → ikke flaget", () => {
  const src = `// error-ok: telemetri, må gerne fejle\nconst { data } = await supabase.from("x").select("*");`;
  // Markøren ligger FØR declStart → tæller ikke. Dokumenterer den skarpe kant:
  // markøren skal stå på/efter statementet.
  assert.equal(findDroppedSupabaseErrors(src).length, 1);
});

// ── Flere fund + rapportering ────────────────────────────────────────────────

test("tæller flere fund i samme fil hver for sig", () => {
  const src = `
    const { data: a } = await supabase.from("teams").select("*");
    const { data: b, error: bErr } = await supabase.from("riders").select("*");
    const { data: c } = await supabase.from("races").select("*");
  `;
  const findings = findDroppedSupabaseErrors(src);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.line), [2, 4]);
});

// ── topLevelKeys-hjælperen ───────────────────────────────────────────────────

test("topLevelKeys læser kun top-niveau-nøgler", () => {
  assert.deepEqual(topLevelKeys("{ data, error }"), ["data", "error"]);
  assert.deepEqual(topLevelKeys("{ data: rows, error: e }"), ["data", "error"]);
  assert.deepEqual(topLevelKeys("{ data: { user }, error }"), ["data", "error"]);
  assert.deepEqual(topLevelKeys("{ data = [], error }"), ["data", "error"]);
  // `error` nested INDE i data er IKKE en top-level binding → skal ikke tælle.
  assert.deepEqual(topLevelKeys("{ data: { error } }"), ["data"]);
});

// ── Scope: #2897's hele pointe var at api.js lå udenfor ──────────────────────

// ── Forward-guard: de ryddede filer må ALDRIG få en baseline igen (#2997) ────
//
// De seks kolde filer blev ryddet til 0 den 31/8. Ratchet'en fanger allerede en
// ny droppet error i dem (implicit baseline 0 → over baseline → CI fejler), men
// den fanger IKKE at nogen "løser" den fejl ved at skrive filen ind i BASELINE
// igen med et tal > 0. Denne test låser begge ender: filerne skal være ude af
// tabellen, OG de skal faktisk stå på 0 fund i kilden.
const CLEARED_2997 = [
  "backend/lib/discordNotifier.js",
  "backend/lib/loanEngine.js",
  "backend/lib/proxyBidding.js",
  "backend/lib/academyGraduation.js",
  "backend/lib/deadlineDayReport.js",
  "backend/lib/riderBidTimeline.js",
  "backend/lib/prizePayoutEngine.js",
];

test("ryddede filer (#2997) står ikke i BASELINE og har 0 fund", () => {
  for (const rel of CLEARED_2997) {
    assert.equal(
      BASELINE[rel],
      undefined,
      `${rel} blev ryddet i #2997 — den må ikke få en baseline-linje igen, ret fejlen i stedet`,
    );
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.equal(findDroppedSupabaseErrors(src).length, 0, `${rel} har fået en droppet Supabase-error igen`);
  }
});

test("scopet dækker backend/routes, backend/lib og cron.js — og ikke tests", () => {
  const files = collectFiles(ROOT).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.ok(files.includes("backend/routes/api.js"), "backend/routes/api.js skal være i scope (#2897)");
  assert.ok(files.includes("backend/cron.js"));
  assert.ok(files.some((f) => f.startsWith("backend/lib/")));
  assert.ok(!files.some((f) => f.endsWith(".test.js")), "test-filer skal være uden for scope");
});
