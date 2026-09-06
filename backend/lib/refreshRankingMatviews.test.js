import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { refreshRankingMatviewsSafe } from "./refreshRankingMatviews.js";

const ALL_RPCS = [
  "refresh_rider_rankings_mv",
  "refresh_team_standings_ext_mv",
  "refresh_team_race_points_mv",
  "refresh_global_rank_mv",
];

function createMockSupabase({ rpcErrors = {}, heartbeatError = null } = {}) {
  const rpcCalls = [];
  const upsertCalls = [];
  return {
    rpcCalls,
    upsertCalls,
    async rpc(name) {
      rpcCalls.push(name);
      if (rpcErrors[name]) return { error: { message: rpcErrors[name] } };
      return { error: null };
    },
    from(table) {
      assert.equal(table, "matview_refresh_heartbeat");
      return {
        async upsert(row, opts) {
          upsertCalls.push({ row, opts });
          if (heartbeatError) return { error: { message: heartbeatError } };
          return { error: null };
        },
      };
    },
  };
}

test("refreshRankingMatviewsSafe — alle fire lykkes: kalder alle RPC'er + upserter heartbeat", async () => {
  const supabase = createMockSupabase();
  const captured = [];
  const result = await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });

  assert.equal(result, true);
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
  assert.equal(supabase.upsertCalls.length, 1);
  assert.equal(supabase.upsertCalls[0].row.matview_group, "ranking");
  assert.equal(supabase.upsertCalls[0].opts.onConflict, "matview_group");
  assert.equal(captured.length, 0);
});

test("refreshRankingMatviewsSafe — én RPC fejler: de andre tre kaldes stadig, heartbeat springes over, Sentry rapporteres", async () => {
  const supabase = createMockSupabase({ rpcErrors: { refresh_team_race_points_mv: "boom" } });
  const captured = [];
  const result = await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });

  assert.equal(result, false);
  // Best-effort pr. matview: alle fire RPC'er kaldes, uanset om en tidligere fejlede.
  assert.deepEqual(supabase.rpcCalls, ALL_RPCS);
  assert.equal(supabase.upsertCalls.length, 0, "heartbeat må IKKE opdateres hvis ikke alle fire lykkedes");
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /1\/4 matview-refresh fejlede/);
  assert.equal(captured[0].ctx.extra.failures.length, 1);
  assert.equal(captured[0].ctx.extra.failures[0].label, "team_race_points_mv");
});

test("refreshRankingMatviewsSafe — alle RPC'er lykkes men heartbeat-upsert fejler: returnerer stadig true (data er frisk)", async () => {
  const supabase = createMockSupabase({ heartbeatError: "connection reset" });
  const captured = [];
  const result = await refreshRankingMatviewsSafe(supabase, { captureExceptionFn: (err, ctx) => captured.push({ err, ctx }) });

  assert.equal(result, true, "matviews ER refreshet — en heartbeat-observability-fejl må ikke fremstå som en data-fejl");
  assert.equal(supabase.upsertCalls.length, 1);
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /heartbeat upsert/);
});

test("refreshRankingMatviewsSafe — uden captureExceptionFn kaster den ikke (best-effort virker uden DI)", async () => {
  const supabase = createMockSupabase({ rpcErrors: { refresh_global_rank_mv: "boom" } });
  const result = await refreshRankingMatviewsSafe(supabase);
  assert.equal(result, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// FORWARD-GUARD (#4866): timeout-budgettet for denne kodesti
//
// Rod-årsagen 5/9 var ikke JS-logik, men en manglende rolle-indstilling i
// databasen: service_role havde ingen rolconfig og arvede authenticator-
// sessionens statement_timeout=8s, så refresh_team_race_points_mv 500'ede.
// Der findes derfor ikke noget "forkert kald" at teste imod i JS — kaldet
// (supabase.rpc) er identisk før og efter fixet. Det der KAN gå tabt igen er
// koblingen: migrationen slettes/omskrives, eller kodestien flyttes til en
// anden transport, og så er 60s-loftet væk uden at nogen opdager det.
//
// Valgt guard = statisk kontrakt-test (ikke en runtime-mock): den læser
// migrationsfilen + kildefilen og kræver at BEGGE stadig beskriver aftalen. En
// runtime-test kunne kun mocke supabase.rpc og ville hverken se rolconfig i
// prod eller opdage at migrationen forsvandt — den ville være grøn i præcis
// den situation vi vil fanges i. SQL-kommentarer strippes før matchning, så
// header-prosa ikke kan snyde testen grøn.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TIMEOUT_MIGRATION = path.join(
  REPO_ROOT,
  "database",
  "2026-09-05-4866-service-role-statement-timeout.sql",
);

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

test("#4866 forward-guard — migrationen der giver service_role sit eget statement_timeout findes og er intakt", () => {
  assert.ok(
    fs.existsSync(TIMEOUT_MIGRATION),
    `Migrationen ${path.basename(TIMEOUT_MIGRATION)} mangler. Uden den arver service_role ` +
      `authenticator-sessionens statement_timeout=8s, og matview-refreshene 500'er igen (#4866).`,
  );

  const statements = stripSqlComments(fs.readFileSync(TIMEOUT_MIGRATION, "utf8"));
  const match = statements.match(
    /ALTER\s+ROLE\s+service_role\s+SET\s+statement_timeout\s*(?:=|TO)\s*'?(\d+)\s*(s|min|ms)?'?/i,
  );
  assert.ok(
    match,
    "Migrationen skal indeholde en faktisk ALTER ROLE service_role SET statement_timeout-sætning " +
      "(ikke kun i en kommentar).",
  );

  const [, rawValue, unit = "ms"] = match;
  const seconds = unit === "min" ? Number(rawValue) * 60 : unit === "s" ? Number(rawValue) : Number(rawValue) / 1000;
  assert.ok(
    seconds >= 30,
    `service_role's statement_timeout er sat til ${rawValue}${unit} (${seconds}s). Målt maksimum for ` +
      `refresh_*_mv lå på 5,3s med cancels over 8s — under 30s er marginen for tynd (#4866).`,
  );

  // Spiller-vendte roller må IKKE flyttes af denne migration: anon (3s) og
  // authenticated (8s) er bevidste værn mod at en enkelt klient-query æder DB'en.
  assert.doesNotMatch(
    statements,
    /ALTER\s+ROLE\s+(anon|authenticated)\b/i,
    "Denne migration må kun røre service_role — anon/authenticated er spiller-vendte lofter (#4866).",
  );
});

test("#4866 forward-guard — kildefilen dokumenterer at den afhænger af service_role-timeouten", () => {
  const source = fs.readFileSync(new URL("./refreshRankingMatviews.js", import.meta.url), "utf8");

  assert.match(
    source,
    /2026-09-05-4866-service-role-statement-timeout\.sql/,
    "refreshRankingMatviews.js skal pege på migrationen den afhænger af, så koblingen ikke går tabt " +
      "ved næste refactor (#4866).",
  );
  assert.match(
    source,
    /service_role/,
    "Kommentaren skal forklare at kaldene kører som service_role — det er dét der bestemmer loftet (#4866).",
  );
  // Den gamle påstand ("loftet er 8s") må ikke stå tilbage som sandhed for denne
  // kodesti: den var netop den fejlantagelse der gjorde 5/9-timeouten usynlig.
  assert.match(
    source,
    /IKKE\s+8s\s+længere/i,
    "Kommentaren skal eksplicit sige at 8s-loftet ikke længere gælder denne kodesti (#4866).",
  );
});
