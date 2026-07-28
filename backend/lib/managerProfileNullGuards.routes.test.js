import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #2876 — GET /api/managers/:teamId. Forward-guard mod to beslægtede crashes fundet
// under samme audit:
//
// 1) Frontend-siden crashede i error boundary hvis achievements manglede fra svaret
//    (delvist svar eller fremtidig kontraktændring). Achievements er allerede altid
//    et array her (`.map` på `allAchsRes.data || []`) — testen låser den kontrakt.
// 2) Backwards-check: team.user_id er null for AI-styrede hold (is_ai=true, ~57% af
//    alle hold pr. 2026-07-25 — nås reelt via transfer-historikkens køber/sælger-
//    links). userRes.data er da null, og et ubetinget `userData.is_online = false`
//    kastede en TypeError ("Cannot set properties of null") FØR res.json — Express 4
//    fanger ikke en throw fra en async handler uden try/catch, så requesten hang til
//    proxy-timeout i stedet for et svar. Testen låser både null-guarden og at
//    handleren nu er try/catch-indpakket (samme mønster som /riders/:id/history).
//
// Source-assertion-mønster (samme som secretAchievementLeak.routes.test.js) —
// scanner routes/api.js som kildetekst så en regression fanges uden en live DB.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

const managerRouteBlock = (() => {
  const start = apiSource.indexOf('router.get("/managers/:teamId"');
  assert.ok(start !== -1, "GET /managers/:teamId skal findes i routes/api.js");
  const end = apiSource.indexOf('router.get("/riders/:id/watchlist-count"', start);
  assert.ok(end !== -1, "slutningen af /managers/:teamId-handleren skal findes (næste route)");
  return apiSource.slice(start, end);
})();

test("GET /managers/:teamId er try/catch-indpakket (#2876)", () => {
  assert.match(managerRouteBlock, /try\s*\{/, "handleren skal have en try-blok");
  assert.match(
    managerRouteBlock,
    /\}\s*catch\s*\(err\)\s*\{[\s\S]*?res\.status\(500\)\.json\(\{ error: "Kunne ikke hente managerprofil" \}\);/,
    "en fejl i nogen af DB-kaldene skal give et JSON-500-svar, ikke en hængende request",
  );
});

test("userData guardes mod null før is_online sættes (#2876 backwards-check)", () => {
  assert.match(
    managerRouteBlock,
    /const userData = userRes\.data \|\| null;\s*\n\s*if \(userData\) \{/,
    "userData skal tjekkes for null (AI-styret hold uden bruger) før .is_online tilføjes",
  );
  // Den gamle, uguardede variant må ikke overleve regressionen.
  assert.doesNotMatch(
    managerRouteBlock,
    /\}\s*else\s*\{\s*userData\.is_online = false;\s*\}/,
    "den gamle else-gren satte userData.is_online uden at tjekke om userData er null",
  );
});

test("achievements er altid et array — aldrig udeladt fra svaret (#2876)", () => {
  assert.match(
    managerRouteBlock,
    /const achievements = \(allAchsRes\.data \|\| \[\]\)\.map/,
    "achievements skal altid bygges fra et array, også når achievements-query'en fejler/er tom",
  );
});

test("riders/season_history/transfer_activity defaulter til [] i res.json (#2876)", () => {
  assert.match(managerRouteBlock, /riders: ridersRes\.data \|\| \[\]/);
  assert.match(managerRouteBlock, /season_history: historyRes\.data \|\| \[\]/);
  assert.match(managerRouteBlock, /transfer_activity: transfersRes\.data \|\| \[\]/);
});

test("team-objektet i svaret inkluderer is_ai så frontend kan skelne AI-hold (#2876)", () => {
  assert.match(managerRouteBlock, /team:\s*\{\s*id:\s*team\.id,\s*name:\s*team\.name,\s*division:\s*team\.division,\s*is_ai:\s*!!team\.is_ai\s*\}/);
  assert.match(managerRouteBlock, /\.select\("id, name, division, balance, user_id, is_ai"\)/);
});
