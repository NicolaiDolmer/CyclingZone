import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

// ============================================================
// #879 — POST /admin/transfer-window/open: pending_team_id-flush
//        skal paginere forbi PostgREST's 1000-row-loft.
// ------------------------------------------------------------
// Rod-årsag: flushen loadede alle non-null pending_team_id-ryttere med et
// naivt .select().not(...) uden .range(). PostgREST returnerer maks 1000
// rækker → parkerede ryttere ud over de første 1000 blev stille tabt og
// aldrig flyttet til deres team_id (samme klasse som #772/#774).
// Fix: fetchAllRows-helperen (kræver stabil .order() for konsistente sider).
// ============================================================

function isolateOpenHandler() {
  const match = apiSource.match(
    /router\.post\(\s*"\/admin\/transfer-window\/open"[\s\S]*?\n\}\);/,
  );
  assert.ok(match, "Kunne ikke isolere POST /admin/transfer-window/open-handler-block");
  return match[0];
}

test("api.js importerer fetchAllRows fra pagineringshelperen", () => {
  assert.match(
    apiSource,
    /import\s*\{\s*fetchAllRows\s*\}\s*from\s*"\.\.\/lib\/supabasePagination\.js"/,
    "fetchAllRows skal importeres fra ../lib/supabasePagination.js",
  );
});

test("pending_team_id-flushen wrapper riders-select'et i fetchAllRows", () => {
  const block = isolateOpenHandler();
  assert.match(
    block,
    /fetchAllRows\(\s*\(\)\s*=>\s*supabase\.from\("riders"\)[\s\S]*?pending_team_id[\s\S]*?\)/,
    "pending_team_id-flushen skal loade riders via fetchAllRows(() => supabase.from(\"riders\")...)",
  );
});

test("den pagineret riders-query har en stabil .order() (krav fra fetchAllRows)", () => {
  const block = isolateOpenHandler();
  // Isolér selve fetchAllRows-kaldet og kræv .order() inden i det — uden en
  // stabil sortering kan PostgREST returnere rækker i forskellig rækkefølge
  // mellem sider → gaps/dubletter.
  const flushMatch = block.match(/fetchAllRows\(\s*\(\)\s*=>\s*supabase\.from\("riders"\)[\s\S]*?\)\)/);
  assert.ok(flushMatch, "Kunne ikke isolere fetchAllRows-kaldet for pending_team_id-flushen");
  assert.match(
    flushMatch[0],
    /\.order\(/,
    "Den pagineret riders-query skal inkludere .order() for stabile sider",
  );
});

test("flushen bruger IKKE et naivt upagineret riders-select (regression-guard)", () => {
  const block = isolateOpenHandler();
  // Det gamle mønster: `const { data: pendingRiders } = await supabase.from("riders")`
  // — et bart, upagineret select bundet til { data }. Det må ikke vende tilbage.
  assert.doesNotMatch(
    block,
    /\{\s*data:\s*pendingRiders\s*\}\s*=\s*await\s+supabase\.from\("riders"\)/,
    "pending_team_id-flushen må ikke bruge et upagineret `{ data: pendingRiders } = await supabase.from(\"riders\")`-select",
  );
});
