import test from "node:test";
import assert from "node:assert/strict";
import { runEmailWelcomeSweep, WELCOME_WINDOW_MS } from "./emailWelcomeSweep.js";

// Mocks the two tables the sweep touches:
//   teams: select("id, name, user_id, created_at").eq(is_ai/is_bank/is_frozen/
//          is_test_account, false).gte("created_at", cutoff).not("user_id","is",null)
//   users: select("email").eq("id", userId).maybeSingle()
function makeSupabase(teamRows, userEmails = {}) {
  return {
    from(table) {
      if (table === "teams") {
        const eqFilters = [];
        let gteFilter = null;
        let notNullCol = null;
        const b = {
          select() { return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          gte(col, val) { gteFilter = [col, val]; return b; },
          not(col, op, val) { if (op === "is" && val === null) notNullCol = col; return b; },
          order() { return b; },
          range() {
            let out = [...teamRows];
            for (const [col, val] of eqFilters) out = out.filter((r) => (r[col] ?? false) === val);
            if (gteFilter) out = out.filter((r) => r[gteFilter[0]] >= gteFilter[1]);
            if (notNullCol) out = out.filter((r) => r[notNullCol] != null);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      // #2853: sundhedsrapportens koerselslog. Ikke det disse tests handler om
      // -- accepter skrivningen og kassér den.
      if (table === "email_sweep_runs") return { insert: async () => ({ error: null }) };
      if (table === "users") {
        let userId = null;
        return {
          select() { return this; },
          eq(_col, id) { userId = id; return this; },
          // userEmails values may be a bare email string (language omitted,
          // legacy fixture shape) or { email, language } for the language-
          // selection tests below.
          maybeSingle: async () => {
            const entry = userEmails[userId];
            if (!entry) return { data: null, error: null };
            const data = typeof entry === "string" ? { email: entry } : { email: entry.email, language: entry.language };
            return { data, error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const mk = (id, extra) => ({
  id, name: `Team ${id}`, user_id: `user-${id}`, created_at: extra?.created_at,
  is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, ...extra,
});

test("targets only teams created within the last 48h", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const fresh = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
  const stale = new Date(now.getTime() - WELCOME_WINDOW_MS - 60 * 60 * 1000).toISOString(); // 49h ago
  const rows = [mk("fresh", { created_at: fresh }), mk("stale", { created_at: stale })];
  const supabase = makeSupabase(rows, { "user-fresh": "fresh@example.com", "user-stale": "stale@example.com" });

  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailWelcomeSweep({
    supabase, now, readStage: async () => "on", send, unsubSecret: "test-secret",
  });

  assert.deepEqual(sendCalls.map((c) => c.teamId), ["fresh"]);
  assert.equal(result.candidates, 1);
  assert.equal(result.sent, 1);
});

test("excludes AI/bank/frozen/test-account teams (human-team filter discipline)", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [
    mk("human", { created_at: recent }),
    mk("ai", { created_at: recent, is_ai: true }),
    mk("bank", { created_at: recent, is_bank: true }),
    mk("frozen", { created_at: recent, is_frozen: true }),
    mk("test", { created_at: recent, is_test_account: true }),
  ];
  const supabase = makeSupabase(rows, { "user-human": "human@example.com" });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailWelcomeSweep({ supabase, now, readStage: async () => "on", send, unsubSecret: "test-secret" });

  assert.deepEqual(sendCalls.map((c) => c.teamId), ["human"]);
  assert.equal(result.candidates, 1);
});

test("dedupeKey is deterministic (welcome:<userId>) so sendLoopEmail's own dedupe check is the guard", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("t1", { created_at: recent, user_id: "user-42" })];
  const supabase = makeSupabase(rows, { "user-42": "player@example.com" });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailWelcomeSweep({ supabase, now, readStage: async () => "on", send, unsubSecret: "test-secret" });

  assert.equal(sendCalls[0].dedupeKey, "welcome:user-42");
  assert.equal(sendCalls[0].type, "welcome");
  assert.equal(sendCalls[0].to, "player@example.com");
});

test("is a no-op (0 db work signaled via candidates=0) when the flag is not active", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const supabase = makeSupabase([{ id: "should-not-be-queried" }]);
  const send = async () => { throw new Error("send must not be called when flag is inactive"); };

  const result = await runEmailWelcomeSweep({ supabase, now, readStage: async () => "off", send });
  assert.deepEqual(result, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

test("per-team failures are isolated (one throws, the rest still send)", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("a", { created_at: recent }), mk("b", { created_at: recent })];
  const supabase = makeSupabase(rows, { "user-a": "a@example.com", "user-b": "b@example.com" });
  const send = async (args) => {
    if (args.teamId === "a") throw new Error("resend down");
    return { status: "dry_run" };
  };

  const result = await runEmailWelcomeSweep({
    supabase, now, readStage: async () => "on", send, unsubSecret: "test-secret", captureExceptionFn: () => {},
  });

  assert.equal(result.candidates, 2);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
});

// ─── #2853 DA follow-up: users.language selects the mail's copy ───────────

test("users.language 'da' renders the Danish welcome copy", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("da-user", { created_at: recent })];
  const supabase = makeSupabase(rows, { "user-da-user": { email: "da@example.com", language: "da" } });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailWelcomeSweep({ supabase, now, readStage: async () => "on", send, unsubSecret: "test-secret" });

  assert.equal(sendCalls[0].subject, "Dit hold er på startlinjen");
  assert.ok(sendCalls[0].html.includes("Velkommen til Cycling Zone"));
});

test("any users.language other than 'da' (including missing) renders the English welcome copy", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [
    mk("no-lang", { created_at: recent }),
    mk("unknown-lang", { created_at: recent }),
  ];
  const supabase = makeSupabase(rows, {
    "user-no-lang": { email: "a@example.com" }, // language omitted
    "user-unknown-lang": { email: "b@example.com", language: "fr" },
  });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  await runEmailWelcomeSweep({ supabase, now, readStage: async () => "on", send, unsubSecret: "test-secret" });

  for (const call of sendCalls) {
    assert.equal(call.subject, "Your team is on the start line");
  }
});

test("skips (does not throw) a team whose user has no email on file", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("no-email", { created_at: recent })];
  const supabase = makeSupabase(rows, {}); // no email registered
  const send = async () => { throw new Error("send must not be called without an email"); };

  const result = await runEmailWelcomeSweep({ supabase, now, readStage: async () => "on", send, unsubSecret: "test-secret" });
  assert.equal(result.candidates, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
});

// ─── #2853 (fund 8/9): dry_run uden unsub-hemmelighed + samlet ops-alarm ─────

test("dry_run koerer helt igennem UDEN EMAIL_UNSUB_SECRET og skriver dry_run-raekker", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("a", { created_at: recent }), mk("b", { created_at: recent })];
  const supabase = makeSupabase(rows, { "user-a": "a@example.com", "user-b": "b@example.com" });
  const sendCalls = [];
  const send = async (args) => { sendCalls.push(args); return { status: "dry_run" }; };

  const result = await runEmailWelcomeSweep({
    supabase, now, readStage: async () => "dry_run", send, unsubSecret: undefined,
  });

  assert.equal(result.sent, 2, "begge kandidater naaede en dry_run-raekke");
  assert.equal(result.failed, 0, "ingen 'secret required'-fejl pr. hold");
  for (const call of sendCalls) {
    assert.ok(call.unsubscribeUrl.endsWith("token=dry-run"), "dummy-token i dry_run");
    assert.equal(call.stage, "dry_run", "stage gives videre saa sendLoopEmail ikke laeser app_config igen");
  }
});

test("stage=on uden hemmelighed kaster ÉN gang for hele koerslen, foer nogen kandidat hentes", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("a", { created_at: recent }), mk("b", { created_at: recent }), mk("c", { created_at: recent })];
  const supabase = makeSupabase(rows, { "user-a": "a@x.dk", "user-b": "b@x.dk", "user-c": "c@x.dk" });
  const captured = [];

  await assert.rejects(
    () => runEmailWelcomeSweep({
      supabase, now, readStage: async () => "on", unsubSecret: undefined,
      send: async () => { throw new Error("maa ikke naa til afsendelse"); },
      captureExceptionFn: (e) => captured.push(e),
    }),
    /EMAIL_UNSUB_SECRET/
  );
  assert.equal(captured.length, 0, "ingen per-hold-alarmer - kastet foer loopet");
});

test("permanente fejl i én koersel giver PRAECIS én ops-besked", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const rows = [mk("a", { created_at: recent }), mk("b", { created_at: recent })];
  const supabase = makeSupabase(rows, { "user-a": "a@x.dk", "user-b": "b@x.dk" });
  const posts = [];

  // Simulerer sendLoopEmail's egen opsamling: to permanente fejl i samme koersel.
  const send = async ({ failureCollector, dedupeKey }) => {
    failureCollector.permanent.push({ dedupeKey, reason: "config-error", error: "invalid address" });
    return { status: "failed", error: "invalid address", retryable: false };
  };

  await runEmailWelcomeSweep({
    supabase, now, readStage: async () => "on", send, unsubSecret: "test-secret",
    sendWebhookFn: async (url, payload) => posts.push({ url, payload }),
    getOpsWebhookFn: async () => "https://discord.example/ops",
  });

  assert.equal(posts.length, 1);
  assert.ok(posts[0].payload.embeds[0].title.includes("2 permanent"));
});

test("koerslens tal logges til sundhedsrapporten - men kun naar der var kandidater", async () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const runs = [];
  const recordRun = async (args) => { runs.push(args); return { recorded: true }; };

  await runEmailWelcomeSweep({
    supabase: makeSupabase([mk("a", { created_at: recent })], { "user-a": "a@x.dk" }),
    now, readStage: async () => "dry_run", send: async () => ({ status: "dry_run" }), recordRun,
  });
  await runEmailWelcomeSweep({
    supabase: makeSupabase([], {}), now, readStage: async () => "dry_run",
    send: async () => ({ status: "dry_run" }), recordRun,
  });

  assert.equal(runs.length, 2, "sweepen rapporterer altid; recordEmailSweepRun filtrerer selv de tomme fra");
  assert.deepEqual(
    { type: runs[0].emailType, stage: runs[0].stage, candidates: runs[0].candidates, sent: runs[0].sent },
    { type: "welcome", stage: "dry_run", candidates: 1, sent: 1 }
  );
  assert.equal(runs[1].candidates, 0);
});

test("en kastende ops-webhook vaelter ikke sweepen - recordRun naas stadig", async () => {
  // Fund 8/9 (review-runde 2): postPermanentFailureAlert laa uden for try/catch
  // (modsat emailRetrySweep.js). Kastede getOpsWebhookFn, doede sweepen EFTER
  // at mailene var sendt, og koerslens tal naaede aldrig sundhedsrapporten.
  const now = new Date("2026-07-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const runs = [];

  const result = await runEmailWelcomeSweep({
    supabase: makeSupabase([mk("a", { created_at: recent })], { "user-a": "a@x.dk" }),
    now,
    readStage: async () => "on",
    unsubSecret: "test-secret",
    send: async ({ failureCollector, dedupeKey }) => {
      failureCollector.permanent.push({ dedupeKey, reason: "config-error" });
      return { status: "failed", error: "invalid address", retryable: false };
    },
    recordRun: async (args) => { runs.push(args); return { recorded: true }; },
    sendWebhookFn: async () => {},
    getOpsWebhookFn: async () => { throw new Error("ops-webhook nede"); },
  });

  assert.equal(runs.length, 1, "koerslens tal SKAL stadig logges");
  assert.equal(runs[0].candidates, 1);
  assert.deepEqual(result, { candidates: 1, sent: 0, skipped: 1, failed: 0 });
});
