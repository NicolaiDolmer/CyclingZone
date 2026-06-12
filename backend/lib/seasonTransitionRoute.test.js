import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #1166 — season-transition-endpoints skal kunne resume fra
// completed sæson (korrekt rækkefølge: season-end → transition).
// ------------------------------------------------------------
// Rod-årsag: både preview- og udfør-endpointet fandt kildesæsonen
// via et rent `status='active'`-lookup. Efter season-end findes
// ingen 'active' sæson (den er 'completed', næste er 'upcoming'),
// så endpointet 404'ede og admin-knappen "Udfør sæsonskifte" var
// ubrugelig — sæson 1→2 måtte køres via script (#1155). Engine'ns
// resume-sti (#578) accepterer en completed fromSeason når næste
// sæson eksisterer; endpoints skal nå den via
// resolveTransitionSourceSeason (active → fallback seneste completed).
// ============================================================

function isolatePreviewHandler() {
  const match = apiSource.match(
    /router\.get\(\s*"\/admin\/season-transition\/preview"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere GET /admin/season-transition/preview-handler");
  return match[0];
}

function isolateExecuteHandler() {
  const match = apiSource.match(
    /router\.post\(\s*"\/admin\/season-transition"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere POST /admin/season-transition-handler");
  return match[0];
}

test("routes/api.js importerer resolveTransitionSourceSeason fra seasonTransition.js", () => {
  assert.match(
    apiSource,
    /import\s*\{[^}]*resolveTransitionSourceSeason[^}]*\}\s*from\s*"\.\.\/lib\/seasonTransition\.js"/,
    "resolveTransitionSourceSeason skal importeres fra ../lib/seasonTransition.js",
  );
});

test("GET /admin/season-transition/preview er requireAdmin-gated", () => {
  assert.match(
    apiSource,
    /router\.get\(\s*"\/admin\/season-transition\/preview"\s*,\s*requireAdmin/,
  );
});

test("preview-handler resolver kildesæson via resolveTransitionSourceSeason (resume-sti #1166)", () => {
  const block = isolatePreviewHandler();
  assert.match(
    block,
    /resolveTransitionSourceSeason\(\s*\{\s*supabase\s*\}\s*\)/,
    "preview skal bruge resolveTransitionSourceSeason så completed sæson (post season-end) accepteres",
  );
  assert.doesNotMatch(
    block,
    /\.eq\(\s*"status"\s*,\s*"active"\s*\)/,
    "preview må IKKE længere lave et rent status='active'-lookup — det 404'er efter season-end",
  );
});

test("POST /admin/season-transition er requireAdmin + adminWriteLimiter-gated", () => {
  assert.match(
    apiSource,
    /router\.post\(\s*"\/admin\/season-transition"\s*,\s*requireAdmin\s*,\s*adminWriteLimiter/,
  );
});

test("udfør-handler falder tilbage til resolveTransitionSourceSeason når fromSeasonId mangler (#1166)", () => {
  const block = isolateExecuteHandler();
  assert.match(
    block,
    /resolveTransitionSourceSeason\(\s*\{\s*supabase\s*\}\s*\)/,
    "udfør-endpointet skal bruge samme resolver som preview når body ikke angiver fromSeasonId",
  );
  assert.doesNotMatch(
    block,
    /\.eq\(\s*"status"\s*,\s*"active"\s*\)/,
    "udfør må IKKE længere lave et rent status='active'-lookup — det 404'er efter season-end",
  );
  assert.match(
    block,
    /bodyFromSeasonId/,
    "eksplicit fromSeasonId i body skal stadig respekteres (bypass af resolveren)",
  );
});
