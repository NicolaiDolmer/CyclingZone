/**
 * #4369 forward-guard — requireAuth må aldrig igen slå de to afvisnings-grene
 * sammen til én 401.
 *
 * Rå kilde-scan (statisk analyse) frem for import: api.js er hele HTTP-fladen
 * og kræver et fuldt miljø for at loade, og det der skal pinnes ER kode-
 * strukturen. Selve afgørelsen er unit-testet i
 * lib/authTokenVerification.test.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "api.js"), "utf8");

function requireAuthBody() {
  const start = source.indexOf("async function requireAuth(req, res, next) {");
  assert.ok(start > 0, "requireAuth skal kunne findes - ellers tester regexen intet");
  const end = source.indexOf("async function requireAdmin", start);
  assert.ok(end > start, "requireAdmin skal ligge efter requireAuth");
  return source.slice(start, end);
}

test("#4369 requireAuth afgør via den testede regel, ikke en lokal if på error", () => {
  const body = requireAuthBody();
  assert.match(body, /verifyBearerToken\(supabase, token\)/, "afgørelsen skal gå gennem lib/authTokenVerification.js");
  assert.doesNotMatch(
    body,
    /if \(error \|\| !user\)/,
    "netop den sammenblanding er bugget: `error` dækker også et netværksudfald mod Supabase",
  );
});

test("#4369 'kunne ikke verificere' svarer 503 med en distinkt kode", () => {
  const body = requireAuthBody();
  assert.match(body, /verdict\.outcome === "unavailable"/);
  assert.match(body, /AUTH_FAILURE_RESPONSES\.unavailable/);
  // Selve tallene og koden ligger i lib'en (og er pinnet der), så guarden her
  // holder sig til at grenen findes og er adskilt fra 401-grenen.
  assert.match(body, /\[auth\] 503 auth_unavailable \$\{req\.method\}/, "udfaldet skal være synligt i Railway-loggen");
});

test("#4369 udfalds-grenen ligger FØR afvisnings-grenen", () => {
  const body = requireAuthBody();
  const unavailableIdx = body.indexOf('verdict.outcome === "unavailable"');
  const rejectedIdx = body.indexOf('verdict.outcome !== "authenticated"');
  assert.ok(unavailableIdx > -1 && rejectedIdx > -1, "begge grene skal findes");
  assert.ok(
    unavailableIdx < rejectedIdx,
    "ellers fanger den brede afvisnings-gren udfaldet først, og vi er tilbage i én-401-verdenen",
  );
});

test("#4369 401-kontrakten er uændret for et ægte afvist token", () => {
  const body = requireAuthBody();
  assert.match(body, /AUTH_FAILURE_RESPONSES\.rejected/);
  assert.match(body, /\[auth\] 401 invalid_token \$\{req\.method\}/, "#4165's log-linje skal blive stående");
});

test("#4369 hverken 401- eller 503-loggen indeholder token eller header", () => {
  const body = requireAuthBody();
  const warnCalls = [...body.matchAll(/console\.warn\([\s\S]*?\);/g)].map((m) => m[0]);
  assert.ok(warnCalls.length >= 2, "begge grene skal logge");
  for (const call of warnCalls) {
    assert.doesNotMatch(call, /\$\{token\}/, "token'et må aldrig i loggen (hard rule: ingen secret-værdier)");
    assert.doesNotMatch(call, /authorization/i, "authorization-headeren må aldrig i loggen");
  }
});

// 503 må ALDRIG give adgang. Den er stadig en afvisning af requestet; det
// eneste der ændrer sig er hvad klienten må konkludere om sessionen.
test("#4369 udfalds-grenen kalder ikke next()", () => {
  const body = requireAuthBody();
  const unavailableIdx = body.indexOf('verdict.outcome === "unavailable"');
  const rejectedIdx = body.indexOf('verdict.outcome !== "authenticated"');
  const branch = body.slice(unavailableIdx, rejectedIdx);
  assert.doesNotMatch(branch, /next\(\)/, "et udfald er stadig ingen adgang");
  assert.match(branch, /return res\.status\(/, "grenen skal svare og stoppe");
});
