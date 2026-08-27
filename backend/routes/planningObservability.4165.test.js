/**
 * #4165 — forward-guard for observerbarheden af de to fejl-grene bag den tomme
 * planlægnings-flade.
 *
 * En spiller kunne ikke komme ind i planlægningen 23/8. Symptomet blev fikset i
 * frontenden (tavs null-gren), men UDLØSEREN kunne ikke bestemmes bagudrettet:
 * de to mest sandsynlige svar — 401 "Invalid token" fra requireAuth og 400 "No
 * team found" fra GET /races/distribution — havde hverken log eller Sentry, og
 * klienten kastede svaret væk. Nul spor i alle tre observations-lag.
 *
 * Denne test pinner at begge grene nu efterlader en log-linje, OG at de gør det
 * uden at bryde de to regler der gør netop den slags logning farlig:
 *   1. aldrig selve token'et eller authorization-headeren i loggen,
 *   2. ingen Sentry-issue på 400 "No team found" — onboarding opretter holdet
 *      asynkront (#3722), så tilstanden er lovlig. Et issue pr. forekomst ville
 *      være samme falske positiv som #4299.
 *
 * Rå kilde-scan (statisk analyse) frem for import: api.js er hele HTTP-fladen og
 * kræver et fuldt miljø for at loade, og det der skal pinnes ER kode-struktur.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "api.js"), "utf8");

// requireAuth-kroppen: fra funktions-signaturen til næste top-level function.
function requireAuthBody() {
  const start = source.indexOf("async function requireAuth(req, res, next) {");
  assert.ok(start > 0, "requireAuth skal kunne findes — ellers tester regexen intet");
  const end = source.indexOf("async function requireAdmin", start);
  assert.ok(end > start, "requireAdmin skal ligge efter requireAuth");
  return source.slice(start, end);
}

// Selve /races/distribution-handleren, kun de første linjer (guard-grenen).
function distributionGuard() {
  const start = source.indexOf('router.get("/races/distribution", requireAuth,');
  assert.ok(start > 0, "GET /races/distribution skal kunne findes");
  return source.slice(start, start + 1200);
}

test("401 Invalid token efterlader en log-linje med metode, sti og fejlkode", () => {
  const body = requireAuthBody();
  assert.match(body, /console\.warn\(/, "det afviste token skal være synligt i Railway-loggen");
  assert.match(body, /\[auth\] 401 invalid_token \$\{req\.method\}/);
  assert.match(body, /error\?\.code \|\| error\?\.name \|\| "no_user"/);
});

test("401-loggen indeholder ALDRIG token'et eller authorization-headeren", () => {
  const body = requireAuthBody();
  const warnCalls = [...body.matchAll(/console\.warn\([\s\S]*?\);/g)].map((m) => m[0]);
  assert.ok(warnCalls.length > 0, "der skal være mindst ét warn-kald at kontrollere");
  for (const call of warnCalls) {
    assert.doesNotMatch(call, /\$\{token\}/, "token'et må aldrig i loggen (hard rule: ingen secret-værdier)");
    assert.doesNotMatch(call, /authorization/i, "authorization-headeren må aldrig i loggen");
  }
});

test("401-loggen bærer stien UDEN query-streng", () => {
  const body = requireAuthBody();
  assert.match(
    body,
    /req\.originalUrl\.split\("\?"\)\[0\]/,
    "query-parametre hører ikke i en log-linje (personlige data i URL'er)",
  );
});

test("400 No team found efterlader en log-linje med user_id", () => {
  const guard = distributionGuard();
  assert.match(guard, /console\.warn\(`\[races\/distribution\] 400 no_team user=\$\{req\.user\?\.id\}`\)/);
  assert.match(guard, /res\.status\(400\)\.json\(\{ error: "No team found" \}\)/, "kontrakten er uændret");
});

test("400 No team found opretter IKKE et Sentry-issue (lovlig onboarding-tilstand)", () => {
  const guard = distributionGuard();
  assert.doesNotMatch(
    guard,
    /captureException/,
    "holdet oprettes asynkront efter signup (#3722) — et issue pr. forekomst er en falsk positiv (#4299)",
  );
});

test("grenen 'intet token' logges bevidst ikke (scanner-støj)", () => {
  const body = requireAuthBody();
  assert.doesNotMatch(
    body,
    /missing_token/,
    "vores egen SPA sender aldrig et request uden token, så grenen er stort set kun probes",
  );
});
