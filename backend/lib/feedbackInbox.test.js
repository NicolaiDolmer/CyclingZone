// #2842 — admin-indbakke for spillerfeedback.
import test from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_INBOX_DEFAULT_LIMIT,
  FEEDBACK_INBOX_MAX_LIMIT,
  parseInboxLimit,
  parseInboxCursor,
  isValidFeedbackStatus,
  listFeedbackInbox,
  getFeedbackCounts,
  setFeedbackStatus,
  replyToFeedback,
  submitTradeReport,
  TRADE_REPORT_CATEGORY,
  TRADE_REPORT_TYPES,
  TRADE_REPORT_MESSAGE_MAX_LENGTH,
} from "./feedbackInbox.js";

function seedState({ rows = null } = {}) {
  const feedback = rows || [
    { id: "f1", seq: 1, created_at: "2026-07-20T10:00:00Z", user_id: "u1", team_id: "t1", category: "bug", status: "new", message: "first", page_path: "/transfers", viewport: "390x844", user_agent: "UA", reply_message: null, replied_at: null },
    { id: "f2", seq: 2, created_at: "2026-07-21T10:00:00Z", user_id: "u1", team_id: null, category: "idea", status: "new", message: "second", page_path: "/team", viewport: null, user_agent: "UA", reply_message: null, replied_at: null },
    { id: "f3", seq: 3, created_at: "2026-07-22T10:00:00Z", user_id: "u2", team_id: "t1", category: "feedback", status: "closed", message: "third", page_path: null, viewport: null, user_agent: "UA", reply_message: "thanks", replied_at: "2026-07-23T10:00:00Z" },
  ];
  return {
    player_feedback: feedback,
    users: [
      { id: "u1", username: "alice", email: "alice@example.com", role: "manager" },
      { id: "u2", username: "bob", email: "bob@example.com", role: "manager" },
    ],
    teams: [{ id: "t1", name: "Team Alpha", balance: 5 }],
    notifications: [],
  };
}

// ── Input-klemning ──────────────────────────────────────────────────────────

test("parseInboxLimit klemmer til [1, MAX] og falder tilbage til default", () => {
  assert.equal(parseInboxLimit(undefined), FEEDBACK_INBOX_DEFAULT_LIMIT);
  assert.equal(parseInboxLimit(""), FEEDBACK_INBOX_DEFAULT_LIMIT);
  assert.equal(parseInboxLimit("abc"), FEEDBACK_INBOX_DEFAULT_LIMIT);
  assert.equal(parseInboxLimit("0"), FEEDBACK_INBOX_DEFAULT_LIMIT);
  assert.equal(parseInboxLimit("-5"), FEEDBACK_INBOX_DEFAULT_LIMIT);
  assert.equal(parseInboxLimit("10"), 10);
  // Uden clamp kunne en klient bede om hele tabellen i ét kald.
  assert.equal(parseInboxLimit("100000"), FEEDBACK_INBOX_MAX_LIMIT);
});

test("parseInboxCursor accepterer kun positive heltal, ellers null (ingen 500)", () => {
  assert.equal(parseInboxCursor(undefined), null);
  assert.equal(parseInboxCursor(""), null);
  assert.equal(parseInboxCursor("0"), null);
  assert.equal(parseInboxCursor("-3"), null);
  assert.equal(parseInboxCursor("' OR 1=1"), null);
  assert.equal(parseInboxCursor("42"), 42);
});

test("isValidFeedbackStatus er et lukket sæt der matcher DB-CHECK'en", () => {
  assert.deepEqual(FEEDBACK_STATUSES, ["new", "in_progress", "closed"]);
  assert.ok(isValidFeedbackStatus("new"));
  assert.ok(isValidFeedbackStatus("in_progress"));
  assert.ok(isValidFeedbackStatus("closed"));
  assert.equal(isValidFeedbackStatus("deleted"), false);
  assert.equal(isValidFeedbackStatus(""), false);
});

// ── Listning + keyset-paginering ────────────────────────────────────────────

test("listFeedbackInbox returnerer nyeste først med afsender og hold opløst", async () => {
  const supabase = createFakeSupabase(seedState());
  const page = await listFeedbackInbox({ supabase });

  assert.deepEqual(page.items.map((i) => i.id), ["f3", "f2", "f1"]);
  assert.equal(page.next_cursor, null, "kun én side → ingen cursor");

  const newest = page.items[0];
  assert.equal(newest.user.username, "bob");
  assert.equal(newest.user.email, "bob@example.com");
  assert.equal(newest.team.name, "Team Alpha");
  assert.equal(newest.message, "third", "beskeden er hele pointen med fladen");

  // team_id er nullable (spiller uden hold endnu) — må ikke kaste.
  assert.equal(page.items[1].team, null);
});

test("listFeedbackInbox pagerer via keyset på seq, aldrig OFFSET", async () => {
  const supabase = createFakeSupabase(seedState());
  const first = await listFeedbackInbox({ supabase, limit: 2 });
  assert.deepEqual(first.items.map((i) => i.id), ["f3", "f2"]);
  assert.equal(first.next_cursor, 2, "cursor = sidste seq på siden");

  const second = await listFeedbackInbox({ supabase, limit: 2, cursor: first.next_cursor });
  assert.deepEqual(second.items.map((i) => i.id), ["f1"]);
  assert.equal(second.next_cursor, null, "sidste side → ingen cursor");
});

test("listFeedbackInbox filtrerer på status og kategori", async () => {
  const supabase = createFakeSupabase(seedState());

  const open = await listFeedbackInbox({ supabase, status: "new" });
  assert.deepEqual(open.items.map((i) => i.id), ["f2", "f1"]);

  const bugs = await listFeedbackInbox({ supabase, category: "bug" });
  assert.deepEqual(bugs.items.map((i) => i.id), ["f1"]);
});

test("listFeedbackInbox ignorerer et ugyldigt status-filter i stedet for at kaste", async () => {
  const supabase = createFakeSupabase(seedState());
  const page = await listFeedbackInbox({ supabase, status: "bogus" });
  assert.equal(page.items.length, 3, "ukendt status filtrerer ikke alt væk");
});

test("listFeedbackInbox eksponerer ikke user_agent i listen", async () => {
  const supabase = createFakeSupabase(seedState());
  const page = await listFeedbackInbox({ supabase });
  for (const item of page.items) {
    assert.equal("user_agent" in item, false, "user_agent er den mest fingerprint-agtige kolonne og hører ikke til i listen");
  }
});

test("listFeedbackInbox kaster med kontekst når Supabase fejler", async () => {
  const supabase = createFakeSupabase(seedState(), {
    errors: { player_feedback: { select: "boom" } },
  });
  await assert.rejects(() => listFeedbackInbox({ supabase }), /could not list feedback: boom/);
});

// ── Status-tællere ──────────────────────────────────────────────────────────

test("getFeedbackCounts tæller pr. status som head-count (ingen rækker over wire)", async () => {
  const calls = [];
  const supabase = {
    from(table) {
      return {
        select(columns, opts) {
          calls.push({ table, columns, opts });
          return {
            eq(_col, value) {
              const byStatus = { new: 2, in_progress: 0, closed: 1 };
              return Promise.resolve({ data: null, count: byStatus[value], error: null });
            },
          };
        },
      };
    },
  };

  const counts = await getFeedbackCounts({ supabase });
  assert.deepEqual(counts, { new: 2, in_progress: 0, closed: 1, total: 3 });
  for (const call of calls) {
    assert.equal(call.opts.head, true, "head:true → PostgREST returnerer nul rækker");
    assert.equal(call.opts.count, "exact");
  }
});

// ── Triage ──────────────────────────────────────────────────────────────────

test("setFeedbackStatus flytter status og stempler status_changed_at", async () => {
  const state = seedState();
  const supabase = createFakeSupabase(state);
  const now = new Date("2026-07-26T09:00:00Z");

  const result = await setFeedbackStatus({ supabase, id: "f1", status: "in_progress", now });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "in_progress");

  const row = state.player_feedback.find((r) => r.id === "f1");
  assert.equal(row.status, "in_progress");
  assert.equal(row.status_changed_at, now.toISOString());
});

test("setFeedbackStatus afviser en status uden for det lukkede sæt", async () => {
  const state = seedState();
  const supabase = createFakeSupabase(state);
  const result = await setFeedbackStatus({ supabase, id: "f1", status: "deleted" });
  assert.equal(result.status, 400);
  assert.equal(result.body.errorCode, "feedback_invalid_status");
  assert.equal(state.player_feedback.find((r) => r.id === "f1").status, "new", "må ikke have skrevet noget");
});

test("setFeedbackStatus giver 404 på ukendt id", async () => {
  const supabase = createFakeSupabase(seedState());
  const result = await setFeedbackStatus({ supabase, id: "nope", status: "closed" });
  assert.equal(result.status, 404);
  assert.equal(result.body.errorCode, "feedback_not_found");
});

// ── Svar-sløjfen ────────────────────────────────────────────────────────────

test("replyToFeedback notificerer spilleren, persisterer svaret og lukker sagen", async () => {
  const state = seedState();
  const supabase = createFakeSupabase(state);
  const now = new Date("2026-07-26T09:00:00Z");
  const sent = [];

  const result = await replyToFeedback({
    supabase,
    id: "f1",
    adminUserId: "admin-1",
    reply: "  Fixed in the next patch. Thanks for the report.  ",
    notify: async (args) => { sent.push(args); return { delivered: true }; },
    now,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.status, "closed");

  assert.equal(sent.length, 1);
  assert.equal(sent[0].userId, "u1", "svaret går til den spiller der skrev");
  assert.equal(sent[0].type, "admin_notice", "typen findes allerede i notifications_type_check");
  assert.equal(sent[0].message, "Fixed in the next patch. Thanks for the report.", "trimmet");
  assert.equal(sent[0].relatedId, "f1", "related_id bærer dedupe ved retry");
  assert.equal(sent[0].metadata.titleCode, "notif.admin.feedbackReply.title");

  const row = state.player_feedback.find((r) => r.id === "f1");
  assert.equal(row.reply_message, "Fixed in the next patch. Thanks for the report.");
  assert.equal(row.replied_at, now.toISOString());
  assert.equal(row.replied_by, "admin-1");
  assert.equal(row.status, "closed");
});

test("replyToFeedback sender notifikationen FØR den markerer rækken besvaret", async () => {
  const state = seedState();
  const supabase = createFakeSupabase(state);
  let rowAtNotifyTime = null;

  await replyToFeedback({
    supabase,
    id: "f1",
    adminUserId: "admin-1",
    reply: "on it",
    notify: async () => {
      // Omvendt rækkefølge ville kunne markere et svar som leveret der aldrig
      // nåede frem til spilleren.
      rowAtNotifyTime = { ...state.player_feedback.find((r) => r.id === "f1") };
      return { delivered: true };
    },
  });

  assert.equal(rowAtNotifyTime.reply_message, null, "rækken må endnu ikke være markeret besvaret");
});

test("replyToFeedback markerer ikke rækken besvaret hvis notifikationen fejler", async () => {
  const state = seedState();
  const supabase = createFakeSupabase(state);

  await assert.rejects(() =>
    replyToFeedback({
      supabase,
      id: "f1",
      adminUserId: "admin-1",
      reply: "on it",
      notify: async () => { throw new Error("notify down"); },
    })
  , /notify down/);

  const row = state.player_feedback.find((r) => r.id === "f1");
  assert.equal(row.reply_message, null);
  assert.equal(row.status, "new", "sagen står stadig åben, så ejeren kan prøve igen");
});

test("replyToFeedback afviser tomt eller whitespace-only svar", async () => {
  const supabase = createFakeSupabase(seedState());
  for (const reply of ["", "   ", null, undefined]) {
    const result = await replyToFeedback({ supabase, id: "f1", reply, notify: async () => {} });
    assert.equal(result.status, 400);
    assert.equal(result.body.errorCode, "feedback_reply_required");
  }
});

test("replyToFeedback afviser for langt svar", async () => {
  const supabase = createFakeSupabase(seedState());
  const result = await replyToFeedback({
    supabase, id: "f1", reply: "x".repeat(4001), notify: async () => {},
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.errorCode, "feedback_reply_too_long");
});

test("replyToFeedback giver 409 hvis der allerede er svaret (ingen dobbelt-besked)", async () => {
  const supabase = createFakeSupabase(seedState());
  const sent = [];
  const result = await replyToFeedback({
    supabase, id: "f3", reply: "again", notify: async (a) => { sent.push(a); },
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.errorCode, "feedback_already_replied");
  assert.equal(sent.length, 0, "må ikke sende notifikationen");
});

test("replyToFeedback giver 404 på ukendt id", async () => {
  const supabase = createFakeSupabase(seedState());
  const result = await replyToFeedback({ supabase, id: "nope", reply: "hi", notify: async () => {} });
  assert.equal(result.status, 404);
  assert.equal(result.body.errorCode, "feedback_not_found");
});

// ── Handel-rapport (#4346) ───────────────────────────────────────────────────

function seedTradeState() {
  return {
    player_feedback: [],
    auctions: [
      { id: "a1", status: "completed", seller_team_id: "t1", current_bidder_id: "t2" },
      { id: "a-nosale", status: "completed", seller_team_id: "t1", current_bidder_id: null },
      { id: "a-open", status: "active", seller_team_id: "t1", current_bidder_id: "t2" },
    ],
    transfer_offers: [
      { id: "o1", status: "accepted", seller_team_id: "t1", buyer_team_id: "t3" },
      { id: "o-pending", status: "pending", seller_team_id: "t1", buyer_team_id: "t3" },
    ],
    swap_offers: [
      { id: "s1", status: "window_pending", proposing_team_id: "t2", receiving_team_id: "t3" },
    ],
  };
}

test("TRADE_REPORT_TYPES udelader academy — den har ingen modpart at rapportere mod", () => {
  assert.deepEqual(TRADE_REPORT_TYPES, ["auction", "transfer", "swap"]);
});

test("submitTradeReport gemmer transfer_id + begge hold-id'er i metadata (auktion)", async () => {
  const state = seedTradeState();
  const supabase = createFakeSupabase(state);
  const result = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "a1",
    message: "This looked suspicious to me.",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.alreadyReported, false);

  const row = state.player_feedback.find((r) => r.id === result.body.id);
  assert.equal(row.category, TRADE_REPORT_CATEGORY);
  assert.equal(row.team_id, "t9", "den RAPPORTERENDE hold — ikke nødvendigvis part i handlen");
  assert.equal(row.user_id, "u1");
  assert.deepEqual(row.metadata, {
    transfer_type: "auction",
    transfer_id: "a1",
    reporting_team_id: "t9",
    team_a_id: "t1",
    team_b_id: "t2",
  }, "begge hold-id'er skal komme fra DATABASE-rækken, ikke fra klienten");
});

test("submitTradeReport kræver ikke at det rapporterende hold er part i handlen", async () => {
  // #4346's egen baggrund: spilleren rapporterede en handel nævnt på Discord,
  // ikke nødvendigvis sin egen. Reglen er "hold X rapporterer handel Y",
  // ikke "hold X var med i handel Y".
  const supabase = createFakeSupabase(seedTradeState());
  const result = await submitTradeReport({
    supabase, teamId: "t-bystander", userId: "u9", transferType: "transfer", transferId: "o1",
    message: "Someone flagged this trade in Discord.",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test("submitTradeReport afviser en no_sale-auktion (ingen rigtig modpart)", async () => {
  const supabase = createFakeSupabase(seedTradeState());
  const result = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "a-nosale",
    message: "Reporting this trade for review.",
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.errorCode, "trade_report_not_found");
});

test("submitTradeReport afviser en auktion der ikke er afsluttet endnu", async () => {
  const supabase = createFakeSupabase(seedTradeState());
  const result = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "a-open",
    message: "Reporting this trade for review.",
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.errorCode, "trade_report_not_found");
});

test("submitTradeReport afviser et transfer-tilbud der ikke er accepteret/window_pending", async () => {
  const supabase = createFakeSupabase(seedTradeState());
  const result = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "transfer", transferId: "o-pending",
    message: "Reporting this trade for review.",
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.errorCode, "trade_report_not_found");
});

test("submitTradeReport henter swap-modparter fra proposing/receiving_team_id", async () => {
  const state = seedTradeState();
  const supabase = createFakeSupabase(state);
  const result = await submitTradeReport({
    supabase, teamId: "t2", userId: "u1", transferType: "swap", transferId: "s1",
    message: "Reporting this swap for review.",
  });
  assert.equal(result.status, 200);
  const row = state.player_feedback.find((r) => r.id === result.body.id);
  assert.equal(row.metadata.team_a_id, "t2");
  assert.equal(row.metadata.team_b_id, "t3");
});

test("submitTradeReport giver 404 på en ukendt handel-id (aldrig 500)", async () => {
  const supabase = createFakeSupabase(seedTradeState());
  const result = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "does-not-exist",
    message: "Reporting this trade for review.",
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.errorCode, "trade_report_not_found");
});

test("submitTradeReport afviser en ugyldig transferType", async () => {
  const supabase = createFakeSupabase(seedTradeState());
  const result = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "academy", transferId: "a1",
    message: "Reporting this trade for review.",
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.errorCode, "trade_report_invalid_type");
});

test("submitTradeReport kræver et hold", async () => {
  const supabase = createFakeSupabase(seedTradeState());
  const result = await submitTradeReport({
    supabase, teamId: null, userId: "u1", transferType: "auction", transferId: "a1", message: "x".repeat(20),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.errorCode, "trade_report_no_team");
});

test("submitTradeReport afviser en for kort/tom besked", async () => {
  const supabase = createFakeSupabase(seedTradeState());
  for (const message of ["", "   ", "too short", null, undefined]) {
    const result = await submitTradeReport({
      supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "a1", message,
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.errorCode, "trade_report_message_too_short");
  }
});

test("submitTradeReport afviser en for lang besked", async () => {
  const supabase = createFakeSupabase(seedTradeState());
  const result = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "a1",
    message: "x".repeat(TRADE_REPORT_MESSAGE_MAX_LENGTH + 1),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.errorCode, "trade_report_message_too_long");
});

test("submitTradeReport er idempotent pr. (handel, rapporterende hold) — maks 1 rapport pr. handel pr. hold", async () => {
  const state = seedTradeState();
  const supabase = createFakeSupabase(state);

  const first = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "a1",
    message: "First report.",
  });
  assert.equal(first.body.alreadyReported, false);

  const second = await submitTradeReport({
    supabase, teamId: "t9", userId: "u2", transferType: "auction", transferId: "a1",
    message: "Trying again.",
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.ok, true);
  assert.equal(second.body.alreadyReported, true, "samme hold, samme handel — ingen ny sag");
  assert.equal(second.body.id, first.body.id, "peger på den EKSISTERENDE rapport");

  const tradeReports = state.player_feedback.filter(
    (r) => r.metadata?.transfer_type === "auction" && r.metadata?.transfer_id === "a1"
  );
  assert.equal(tradeReports.length, 1, "må ikke have insertet en ny række ved dobbelt-rapport");
});

test("submitTradeReport dedupe er PR. HOLD, ikke globalt — et andet hold kan stadig rapportere samme handel", async () => {
  const state = seedTradeState();
  const supabase = createFakeSupabase(state);

  await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "a1", message: "First report.",
  });
  const second = await submitTradeReport({
    supabase, teamId: "t-other", userId: "u2", transferType: "auction", transferId: "a1", message: "Also reporting.",
  });
  assert.equal(second.body.alreadyReported, false, "et ANDET holds rapport om samme handel er ikke en dublet");

  const tradeReports = state.player_feedback.filter(
    (r) => r.metadata?.transfer_type === "auction" && r.metadata?.transfer_id === "a1"
  );
  assert.equal(tradeReports.length, 2);
});

test("submitTradeReport dedupe skelner på transferId, ikke bare kategori+hold", async () => {
  const state = seedTradeState();
  const supabase = createFakeSupabase(state);

  await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "auction", transferId: "a1", message: "First report.",
  });
  const second = await submitTradeReport({
    supabase, teamId: "t9", userId: "u1", transferType: "transfer", transferId: "o1", message: "Different trade.",
  });
  assert.equal(second.body.alreadyReported, false, "en anden handel er ikke en dublet, selvom samme hold rapporterede før");
});
