/**
 * #7917: requireAuth må ikke gøre en fejlet holdlæsning til "intet hold".
 *
 * api.js kræver et fuldt miljø for at loade, så funktionen skæres ud af kilden og
 * køres med fakes. På den måde testes den rigtige kode, ikke en kopi af den.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AUTH_FAILURE_RESPONSES } from "../lib/authTokenVerification.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "api.js"), "utf8");

function loadRequireAuth(supabase, setSentryUser) {
  const start = source.indexOf("async function requireAuth(req, res, next) {");
  assert.ok(start > 0, "requireAuth skal kunne findes i api.js");
  // Funktionens afsluttende klamme står alene i kolonne 0 (CRLF på Windows, LF i CI).
  const closing = /\r?\n}\r?\n/.exec(source.slice(start));
  assert.ok(closing, "slutningen af requireAuth skal kunne findes");
  const build = new Function(
    "supabase",
    "verifyBearerToken",
    "AUTH_FAILURE_RESPONSES",
    "setSentryUser",
    `return (${source.slice(start, start + closing.index)}\n});`,
  );
  const verifyBearerToken = async () => ({ outcome: "authenticated", reason: "ok", user: { id: "user-a" } });
  return build(supabase, verifyBearerToken, AUTH_FAILURE_RESPONSES, setSentryUser);
}

function clientReturning(result) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  };
}

async function run(result) {
  const sentryUsers = [];
  const requireAuth = loadRequireAuth(clientReturning(result), (id) => sentryUsers.push(id));
  const req = { headers: { authorization: "Bearer valid" }, method: "GET", originalUrl: "/api/races/distribution?day=1" };
  const response = { statusCode: null, body: null };
  const res = {
    status(code) { response.statusCode = code; return this; },
    json(body) { response.body = body; return this; },
  };
  let nextCalls = 0;
  await requireAuth(req, res, () => { nextCalls += 1; });
  return { req, response, nextCalls, sentryUsers };
}

test("#7917 fejlet holdopslag svarer 503 og når aldrig ruten", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  const { req, response, nextCalls } = await run({ data: null, error: { message: "<html>522</html>" }, status: 522 });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, AUTH_FAILURE_RESPONSES.teamLookupFailed.body);
  assert.notEqual(response.body.error, "No team found");
  assert.equal(response.body.errorCode, "team_lookup_failed"); // uden den kan danske spillere ikke få teksten
  assert.equal(nextCalls, 0);
  assert.equal(req.team, undefined);

  // Linjen skal kunne ses i loggen, men må ikke bære hele fejlsiden eller query-strengen.
  assert.equal(warnings.mock.callCount(), 1);
  assert.equal(warnings.mock.calls[0].arguments[0], "[auth] 503 team_lookup_failed GET /api/races/distribution (522)");
});

test("#7917 PostgREST-koden står i loggen, når der er en", async (t) => {
  const warnings = t.mock.method(console, "warn", () => {});
  await run({ data: null, error: { code: "PGRST002", message: "schema cache" }, status: 503 });
  assert.match(warnings.mock.calls[0].arguments[0], /\(PGRST002\)$/);
});

test("#7917 ingen række endnu er stadig lovligt: req.team er null og ruten kører", async () => {
  const { req, response, nextCalls, sentryUsers } = await run({ data: null, error: null, status: 200 });
  assert.equal(nextCalls, 1);
  assert.equal(req.team, null);
  assert.deepEqual(req.user, { id: "user-a" });
  assert.equal(response.statusCode, null);
  assert.deepEqual(sentryUsers, ["user-a"]);
});

test("#7917 fundet hold sættes på requestet", async () => {
  const team = { id: "team-a" };
  const { req, nextCalls } = await run({ data: team, error: null, status: 200 });
  assert.equal(nextCalls, 1);
  assert.equal(req.team, team);
});
