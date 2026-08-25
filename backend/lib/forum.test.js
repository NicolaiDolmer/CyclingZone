// #3199/#3201 — Forum v1: opslag, svar, ejer-polls, rapportering.
import test from "node:test";
import assert from "node:assert/strict";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";
import {
  FORUM_CATEGORIES,
  FORUM_LIST_DEFAULT_LIMIT,
  FORUM_LIST_MAX_LIMIT,
  parseForumLimit,
  parseForumCursor,
  parseForumActivityCursor,
  isValidForumCategory,
  listForumPosts,
  getForumPost,
  createForumPost,
  createForumReply,
  voteForumPoll,
  reportForumContent,
  listForumReports,
  resolveForumReport,
  setForumPostPinned,
  deleteForumPost,
  deleteForumReply,
  getForumReportCounts,
  markForumThreadRead,
  getForumUnreadStatus,
  toggleForumReaction,
} from "./forum.js";

function post(overrides = {}) {
  return {
    id: "p1",
    seq: 1,
    created_at: "2026-08-01T10:00:00Z",
    user_id: "u1",
    team_id: "t1",
    category: "general",
    title: "First post",
    body: "Hello everyone",
    is_pinned: false,
    reply_count: 0,
    last_reply_at: null,
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  };
}

function seedState(overrides = {}) {
  return {
    forum_posts: [],
    forum_replies: [],
    forum_reports: [],
    forum_poll_options: [],
    forum_poll_votes: [],
    forum_thread_reads: [],
    forum_reactions: [],
    users: [
      { id: "u1", username: "alice", email: "alice@example.com", role: "manager" },
      { id: "u2", username: "bob", email: "bob@example.com", role: "manager" },
      { id: "admin1", username: "dolmer", email: "owner@example.com", role: "admin" },
    ],
    teams: [
      { id: "t1", name: "Team Alpha" },
      { id: "t2", name: "Team Beta" },
    ],
    ...overrides,
  };
}

// ── Input-klemning ──────────────────────────────────────────────────────────

test("parseForumLimit klemmer til [1, MAX] og falder tilbage til default", () => {
  assert.equal(parseForumLimit(undefined), FORUM_LIST_DEFAULT_LIMIT);
  assert.equal(parseForumLimit("abc"), FORUM_LIST_DEFAULT_LIMIT);
  assert.equal(parseForumLimit("0"), FORUM_LIST_DEFAULT_LIMIT);
  assert.equal(parseForumLimit("10"), 10);
  assert.equal(parseForumLimit("100000"), FORUM_LIST_MAX_LIMIT);
});

test("parseForumCursor accepterer kun positive heltal, ellers null (ingen 500)", () => {
  assert.equal(parseForumCursor(undefined), null);
  assert.equal(parseForumCursor(""), null);
  assert.equal(parseForumCursor("0"), null);
  assert.equal(parseForumCursor("' OR 1=1"), null);
  assert.equal(parseForumCursor("42"), 42);
});

test("isValidForumCategory matcher DB-CHECK'en", () => {
  assert.deepEqual(FORUM_CATEGORIES, ["general", "feedback_ideas"]);
  assert.ok(isValidForumCategory("general"));
  assert.ok(isValidForumCategory("feedback_ideas"));
  assert.ok(!isValidForumCategory("random"));
});

// ── Liste ───────────────────────────────────────────────────────────────────

test("listForumPosts: pinned i egen blok på side 1, hovedliste nyeste først, forfattere opløst", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [
      post({ id: "p1", seq: 1, title: "Old", user_id: "u1", team_id: "t1" }),
      post({ id: "p2", seq: 2, title: "New", user_id: "u2", team_id: "t2", category: "feedback_ideas" }),
      post({ id: "p3", seq: 3, title: "Pinned announcement", user_id: "admin1", team_id: null, is_pinned: true }),
    ],
    forum_poll_options: [{ id: "o1", post_id: "p3", idx: 0, label: "Yes" }],
  }));

  const result = await listForumPosts({ supabase: fake });
  assert.equal(result.pinned.length, 1);
  assert.equal(result.pinned[0].id, "p3");
  assert.equal(result.pinned[0].has_poll, true);
  assert.equal(result.pinned[0].author.username, "dolmer");
  assert.deepEqual(result.items.map((p) => p.id), ["p2", "p1"]);
  assert.equal(result.items[0].author.username, "bob");
  assert.equal(result.items[0].author.team_name, "Team Beta");
  assert.equal(result.items[0].has_poll, false);
  assert.equal(result.next_cursor, null);
});

test("listForumPosts: kategori-filter + keyset-cursor (sammensat aktivitet+seq), pinned kun på side 1", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [
      post({ id: "p1", seq: 1, category: "general" }),
      post({ id: "p2", seq: 2, category: "feedback_ideas" }),
      post({ id: "p3", seq: 3, category: "general" }),
      post({ id: "p4", seq: 4, category: "general", is_pinned: true }),
    ],
  }));

  const page1 = await listForumPosts({ supabase: fake, category: "general", limit: "1" });
  assert.deepEqual(page1.items.map((p) => p.id), ["p3"]);
  assert.equal(page1.pinned.length, 1);
  assert.ok(page1.next_cursor); // sammensat streng, ikke længere et rå seq-tal
  assert.deepEqual(parseForumActivityCursor(page1.next_cursor), { ts: Date.parse("2026-08-01T10:00:00Z"), seq: 3 });

  const page2 = await listForumPosts({ supabase: fake, category: "general", limit: "1", cursor: page1.next_cursor });
  assert.deepEqual(page2.items.map((p) => p.id), ["p1"]);
  assert.equal(page2.pinned.length, 0);
  assert.equal(page2.next_cursor, null);
});

// #4118: kernen i sorterings-skiftet — en NY tråd uden svar overhales af en
// GAMMEL tråd der lige har fået et FRISKT svar, men en tråd med et svar der
// stadig er ældre end en helt ny tråd forbliver under den.
test("listForumPosts: sorterer efter seneste aktivitet, ikke oprettelse", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [
      // Gammel tråd, men svar for 5 minutter siden — skal ligge ØVERST.
      post({ id: "old-fresh-reply", seq: 1, created_at: "2026-08-01T08:00:00Z", last_reply_at: "2026-08-20T11:55:00Z" }),
      // Helt ny tråd, ingen svar endnu — skal ligge i MIDTEN (nyere end den
      // stille tråd, men ældre end trådens friske svar ovenfor).
      post({ id: "new-no-reply", seq: 2, created_at: "2026-08-20T12:00:00Z", last_reply_at: null }),
      // Gammel tråd, gammelt svar — skal ligge NEDERST.
      post({ id: "old-stale-reply", seq: 3, created_at: "2026-08-02T09:00:00Z", last_reply_at: "2026-08-05T10:00:00Z" }),
    ],
  }));

  const result = await listForumPosts({ supabase: fake });
  assert.deepEqual(result.items.map((p) => p.id), ["new-no-reply", "old-fresh-reply", "old-stale-reply"]);
});

// Delt aktivitets-tidsstempel (fx to opslag oprettet samme sekund, ingen svar)
// skal stadig give en stabil, ikke-gentagende/ikke-tabende side 2 — seq er
// tiebreak'et.
test("listForumPosts: side 2 gentager eller taber aldrig rækker ved delt aktivitets-tidsstempel", async () => {
  const shared = "2026-08-10T10:00:00Z";
  const fake = createFakeSupabase(seedState({
    forum_posts: [
      post({ id: "p1", seq: 1, created_at: shared }),
      post({ id: "p2", seq: 2, created_at: shared }),
      post({ id: "p3", seq: 3, created_at: shared }),
    ],
  }));

  const page1 = await listForumPosts({ supabase: fake, limit: "2" });
  assert.deepEqual(page1.items.map((p) => p.id), ["p3", "p2"]);
  const page2 = await listForumPosts({ supabase: fake, limit: "2", cursor: page1.next_cursor });
  assert.deepEqual(page2.items.map((p) => p.id), ["p1"]);
  assert.equal(page2.next_cursor, null);
});

test("listForumPosts: slettede opslag vises aldrig", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [
      post({ id: "p1", seq: 1 }),
      post({ id: "p2", seq: 2, deleted_at: "2026-08-02T10:00:00Z" }),
    ],
  }));
  const result = await listForumPosts({ supabase: fake });
  assert.deepEqual(result.items.map((p) => p.id), ["p1"]);
});

// ── Ulæst-status pr. tråd (#3451) ───────────────────────────────────────────

test("listForumPosts: is_unread pr. tråd — ingen læse-række, nyere aktivitet end last_read_at, eller læst", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [
      post({ id: "never-read", seq: 1, created_at: "2026-08-20T10:00:00Z" }),
      post({ id: "read-then-replied", seq: 2, created_at: "2026-08-20T09:00:00Z", last_reply_at: "2026-08-21T10:00:00Z" }),
      post({ id: "fully-read", seq: 3, created_at: "2026-08-19T10:00:00Z" }),
    ],
    forum_thread_reads: [
      { user_id: "u1", post_id: "read-then-replied", last_read_at: "2026-08-20T09:30:00Z" }, // før svaret
      { user_id: "u1", post_id: "fully-read", last_read_at: "2026-08-19T12:00:00Z" }, // efter oprettelse
    ],
  }));

  const result = await listForumPosts({ supabase: fake, userId: "u1" });
  const byId = Object.fromEntries(result.items.map((p) => [p.id, p.is_unread]));
  assert.equal(byId["never-read"], true); // ingen forum_thread_reads-række
  assert.equal(byId["read-then-replied"], true); // svaret kom EFTER last_read_at
  assert.equal(byId["fully-read"], false);
});

test("listForumPosts: uden userId (fx tests) er intet markeret ulæst", async () => {
  const fake = createFakeSupabase(seedState({ forum_posts: [post({ id: "p1" })] }));
  const result = await listForumPosts({ supabase: fake });
  assert.equal(result.items[0].is_unread, false);
});

test("markForumThreadRead: upserter last_read_at pr. (bruger, tråd)", async () => {
  const fake = createFakeSupabase(seedState({ forum_posts: [post({ id: "p1" })] }));
  const first = new Date("2026-08-20T10:00:00Z");
  await markForumThreadRead({ supabase: fake, userId: "u1", postId: "p1", now: first });
  assert.equal(fake.state.forum_thread_reads.length, 1);
  assert.equal(fake.state.forum_thread_reads[0].last_read_at, first.toISOString());

  const second = new Date("2026-08-21T10:00:00Z");
  await markForumThreadRead({ supabase: fake, userId: "u1", postId: "p1", now: second });
  assert.equal(fake.state.forum_thread_reads.length, 1); // upsert, ingen dublet
  assert.equal(fake.state.forum_thread_reads[0].last_read_at, second.toISOString());
});

test("getForumUnreadStatus: has_unread er false uden brugte tråde/manglende userId, true ved mindst én ulæst tråd", async () => {
  const fake = createFakeSupabase(seedState());
  assert.deepEqual(await getForumUnreadStatus({ supabase: fake, userId: null }), { has_unread: false });
  assert.deepEqual(await getForumUnreadStatus({ supabase: fake, userId: "u1" }), { has_unread: false });

  const withPosts = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1", seq: 1, created_at: "2026-08-20T10:00:00Z" })],
    forum_thread_reads: [{ user_id: "u1", post_id: "p1", last_read_at: "2026-08-21T10:00:00Z" }],
  }));
  assert.deepEqual(await getForumUnreadStatus({ supabase: withPosts, userId: "u1" }), { has_unread: false });
  assert.deepEqual(await getForumUnreadStatus({ supabase: withPosts, userId: "u2" }), { has_unread: true }); // u2 har aldrig læst p1
});

// ── Detalje + poll ──────────────────────────────────────────────────────────

test("getForumPost: 404 på ukendt og på slettet opslag", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1", deleted_at: "2026-08-02T10:00:00Z" })],
  }));
  assert.equal((await getForumPost({ supabase: fake, id: "nope", userId: "u1" })).status, 404);
  assert.equal((await getForumPost({ supabase: fake, id: "p1", userId: "u1" })).status, 404);
});

test("getForumPost: svar i seq-orden, slettede svar udeladt, poll aggregeret uden stemme-identiteter", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1", user_id: "admin1", team_id: null, reply_count: 2 })],
    forum_replies: [
      { id: "r2", seq: 2, created_at: "2026-08-01T12:00:00Z", post_id: "p1", user_id: "u2", team_id: "t2", body: "Second", deleted_at: null },
      { id: "r1", seq: 1, created_at: "2026-08-01T11:00:00Z", post_id: "p1", user_id: "u1", team_id: "t1", body: "First", deleted_at: null },
      { id: "r3", seq: 3, created_at: "2026-08-01T13:00:00Z", post_id: "p1", user_id: "u1", team_id: "t1", body: "Removed", deleted_at: "2026-08-02T10:00:00Z" },
    ],
    forum_poll_options: [
      { id: "o1", post_id: "p1", idx: 0, label: "Yes" },
      { id: "o2", post_id: "p1", idx: 1, label: "No" },
    ],
    forum_poll_votes: [
      { post_id: "p1", option_id: "o1", user_id: "u1", created_at: "2026-08-01T11:00:00Z" },
      { post_id: "p1", option_id: "o1", user_id: "u2", created_at: "2026-08-01T11:05:00Z" },
      { post_id: "p1", option_id: "o2", user_id: "admin1", created_at: "2026-08-01T11:10:00Z" },
    ],
  }));

  const result = await getForumPost({ supabase: fake, id: "p1", userId: "u2" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.replies.map((r) => r.id), ["r1", "r2"]);
  assert.equal(result.body.replies[0].author.username, "alice");

  const poll = result.body.poll;
  assert.equal(poll.total_votes, 3);
  assert.equal(poll.my_option_id, "o1");
  assert.deepEqual(poll.options.map((o) => [o.label, o.votes]), [["Yes", 2], ["No", 1]]);
  // Individuelle stemmer må aldrig forlade backend — kun aggregater + egen stemme.
  assert.equal(JSON.stringify(result.body).includes("admin1"), false);
});

// #3517 · getForumPost: opbaknings-tal på post + svar, opløst i det eksisterende
// trådkald (ingen separate N+1-kald pr. indlæg).
test("getForumPost: support_count/supported_by_me på post og svar", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1", user_id: "admin1", team_id: null })],
    forum_replies: [
      { id: "r1", seq: 1, created_at: "2026-08-01T11:00:00Z", post_id: "p1", user_id: "u1", team_id: "t1", body: "First", deleted_at: null, quoted_reply_id: null },
    ],
    forum_reactions: [
      { target_type: "post", target_id: "p1", user_id: "u1", created_at: "2026-08-01T10:00:00Z" },
      { target_type: "post", target_id: "p1", user_id: "u2", created_at: "2026-08-01T10:01:00Z" },
      { target_type: "reply", target_id: "r1", user_id: "u2", created_at: "2026-08-01T11:05:00Z" },
    ],
  }));

  const asU1 = await getForumPost({ supabase: fake, id: "p1", userId: "u1" });
  assert.equal(asU1.body.post.support_count, 2);
  assert.equal(asU1.body.post.supported_by_me, true);
  assert.equal(asU1.body.replies[0].support_count, 1);
  assert.equal(asU1.body.replies[0].supported_by_me, false);

  const asU2 = await getForumPost({ supabase: fake, id: "p1", userId: "u2" });
  assert.equal(asU2.body.post.supported_by_me, true);
  assert.equal(asU2.body.replies[0].supported_by_me, true);
});

// #3517 · citér-svar: kompakt uddrag med forfatter, ALDRIG indhold fra et slettet svar.
test("getForumPost: citeret svar giver uddrag+forfatter, citeret SLETTET svar lækker aldrig indhold", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1", user_id: "admin1", team_id: null })],
    forum_replies: [
      { id: "r1", seq: 1, created_at: "2026-08-01T11:00:00Z", post_id: "p1", user_id: "u1", team_id: "t1", body: "Original point", deleted_at: null, quoted_reply_id: null },
      { id: "r2", seq: 2, created_at: "2026-08-01T12:00:00Z", post_id: "p1", user_id: "u2", team_id: "t2", body: "Agreed", deleted_at: null, quoted_reply_id: "r1" },
      { id: "r3", seq: 3, created_at: "2026-08-01T13:00:00Z", post_id: "p1", user_id: "u1", team_id: "t1", body: "Secret", deleted_at: "2026-08-02T09:00:00Z", quoted_reply_id: null },
      { id: "r4", seq: 4, created_at: "2026-08-01T14:00:00Z", post_id: "p1", user_id: "u2", team_id: "t2", body: "Quoting removed", deleted_at: null, quoted_reply_id: "r3" },
    ],
  }));

  const result = await getForumPost({ supabase: fake, id: "p1", userId: "u1" });
  const [r1, r2, r4] = ["r1", "r2", "r4"].map((id) => result.body.replies.find((r) => r.id === id));
  assert.equal(r1.quoted, null);

  assert.equal(r2.quoted.id, "r1");
  assert.equal(r2.quoted.removed, false);
  assert.equal(r2.quoted.excerpt, "Original point");
  assert.equal(r2.quoted.author.username, "alice");

  // r3 (den citerede kilde) er soft-deleted og er derfor slet ikke i replies-listen —
  // klienten kan ikke selv rekonstruere citatet, derfor SKAL backend shape det.
  assert.equal(result.body.replies.some((r) => r.id === "r3"), false);
  assert.deepEqual(r4.quoted, { id: "r3", removed: true });
  assert.equal(JSON.stringify(r4).includes("Secret"), false);
});

// ── Opret opslag ────────────────────────────────────────────────────────────

test("createForumPost: validering af kategori/titel/body", async () => {
  const fake = createFakeSupabase(seedState());
  const base = { supabase: fake, userId: "u1", teamId: "t1" };
  assert.equal((await createForumPost({ ...base, category: "nope", title: "T", body: "B" })).body.errorCode, "forum_invalid_category");
  assert.equal((await createForumPost({ ...base, category: "general", title: "  ", body: "B" })).body.errorCode, "forum_title_required");
  assert.equal((await createForumPost({ ...base, category: "general", title: "x".repeat(121), body: "B" })).body.errorCode, "forum_title_too_long");
  assert.equal((await createForumPost({ ...base, category: "general", title: "T", body: "" })).body.errorCode, "forum_body_required");
  assert.equal((await createForumPost({ ...base, category: "general", title: "T", body: "x".repeat(4001) })).body.errorCode, "forum_body_too_long");
  assert.equal(fake.state.forum_posts.length, 0);
});

test("createForumPost: almindelig spiller kan oprette; poll kræver admin (403, intet opslag)", async () => {
  const fake = createFakeSupabase(seedState());
  const ok = await createForumPost({
    supabase: fake, userId: "u1", teamId: "t1", category: "feedback_ideas", title: " My idea ", body: " Body ",
  });
  assert.equal(ok.status, 200);
  assert.equal(fake.state.forum_posts.length, 1);
  assert.equal(fake.state.forum_posts[0].title, "My idea");
  assert.equal(fake.state.forum_posts[0].user_id, "u1");

  const denied = await createForumPost({
    supabase: fake, userId: "u1", teamId: "t1", isAdmin: false,
    category: "general", title: "Sneaky poll", body: "B", pollOptions: ["A", "B"],
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.errorCode, "forum_poll_admin_only");
  // Stille scope-klip (opslag uden poll) ville skjule fejlen — intet opslag oprettes.
  assert.equal(fake.state.forum_posts.length, 1);
});

test("createForumPost: admin-poll oprettes med options i rækkefølge; ugyldige options afvises", async () => {
  const fake = createFakeSupabase(seedState());
  const invalid = await createForumPost({
    supabase: fake, userId: "admin1", isAdmin: true,
    category: "general", title: "Poll", body: "Vote!", pollOptions: ["Only one"],
  });
  assert.equal(invalid.body.errorCode, "forum_poll_invalid_options");

  const ok = await createForumPost({
    supabase: fake, userId: "admin1", isAdmin: true,
    category: "general", title: "Poll", body: "Vote!", pollOptions: [" Yes ", "No", ""],
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(fake.state.forum_poll_options.map((o) => [o.idx, o.label]), [[0, "Yes"], [1, "No"]]);
});

test("createForumPost: fejlet options-insert rydder opslaget op (intet halvt opslag)", async () => {
  const fake = createFakeSupabase(seedState(), { errors: { forum_poll_options: { insert: "boom" } } });
  await assert.rejects(() => createForumPost({
    supabase: fake, userId: "admin1", isAdmin: true,
    category: "general", title: "Poll", body: "Vote!", pollOptions: ["A", "B"],
  }));
  assert.equal(fake.state.forum_posts.length, 0);
});

// ── Svar ────────────────────────────────────────────────────────────────────

test("createForumReply: 404 på slettet opslag; ellers indsætter + genberegner reply_count/last_reply_at", async () => {
  const now = new Date("2026-08-03T10:00:00Z");
  const fake = createFakeSupabase(seedState({
    forum_posts: [
      post({ id: "p1" }),
      post({ id: "p2", seq: 2, deleted_at: "2026-08-02T10:00:00Z" }),
    ],
  }));

  const gone = await createForumReply({ supabase: fake, postId: "p2", userId: "u1", body: "Hi" });
  assert.equal(gone.status, 404);

  const ok = await createForumReply({ supabase: fake, postId: "p1", userId: "u2", teamId: "t2", body: " Hi there ", now });
  assert.equal(ok.status, 200);
  assert.equal(ok.post.title, "First post");
  assert.equal(fake.state.forum_replies.length, 1);
  assert.equal(fake.state.forum_replies[0].body, "Hi there");
  assert.equal(fake.state.forum_posts[0].reply_count, 1);
  assert.equal(fake.state.forum_posts[0].last_reply_at, now.toISOString());
});

// #3517 · citér-svar: kun tilladt inden for SAMME tråd; returnerer forfatter-id
// til routens notifikation (aldrig selve UUID'en lækket til klienten — kun brugt
// server-side i api.js).
test("createForumReply: quotedReplyId skal høre til samme tråd, ellers 400; ellers gemmes den + quotedUserId returneres", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1" }), post({ id: "p2", seq: 2 })],
    forum_replies: [
      { id: "r1", seq: 1, created_at: "2026-08-01T11:00:00Z", post_id: "p1", user_id: "u1", team_id: "t1", body: "Original", deleted_at: null, quoted_reply_id: null },
      { id: "r-other-thread", seq: 2, created_at: "2026-08-01T11:00:00Z", post_id: "p2", user_id: "u2", team_id: "t2", body: "Elsewhere", deleted_at: null, quoted_reply_id: null },
    ],
  }));

  const unknown = await createForumReply({ supabase: fake, postId: "p1", userId: "u2", body: "Hi", quotedReplyId: "nope" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.errorCode, "forum_invalid_quote");

  const crossThread = await createForumReply({ supabase: fake, postId: "p1", userId: "u2", body: "Hi", quotedReplyId: "r-other-thread" });
  assert.equal(crossThread.status, 400);
  assert.equal(crossThread.body.errorCode, "forum_invalid_quote");
  assert.equal(fake.state.forum_replies.length, 2, "ingen af de afviste citater må have indsat et svar");

  const ok = await createForumReply({ supabase: fake, postId: "p1", userId: "u2", body: "I agree", quotedReplyId: "r1" });
  assert.equal(ok.status, 200);
  assert.equal(ok.quotedUserId, "u1");
  const insertedReply = fake.state.forum_replies.find((r) => r.body === "I agree");
  assert.equal(insertedReply.quoted_reply_id, "r1");
});

// ── Poll-afstemning ─────────────────────────────────────────────────────────

test("voteForumPoll: option skal høre til opslaget; genafstemning overskriver (én stemme pr. bruger)", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1" }), post({ id: "p2", seq: 2 })],
    forum_poll_options: [
      { id: "o1", post_id: "p1", idx: 0, label: "Yes" },
      { id: "o2", post_id: "p1", idx: 1, label: "No" },
      { id: "oX", post_id: "p2", idx: 0, label: "Other poll" },
    ],
  }));

  const wrongPost = await voteForumPoll({ supabase: fake, postId: "p1", userId: "u1", optionId: "oX" });
  assert.equal(wrongPost.status, 404);
  assert.equal(wrongPost.body.errorCode, "forum_poll_option_not_found");

  assert.equal((await voteForumPoll({ supabase: fake, postId: "p1", userId: "u1", optionId: "o1" })).status, 200);
  assert.equal((await voteForumPoll({ supabase: fake, postId: "p1", userId: "u1", optionId: "o2" })).status, 200);
  assert.equal(fake.state.forum_poll_votes.length, 1);
  assert.equal(fake.state.forum_poll_votes[0].option_id, "o2");
});

// ── Rapportering ────────────────────────────────────────────────────────────

test("reportForumContent: validering + 404 på slettet target", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1", deleted_at: "2026-08-02T10:00:00Z" })],
  }));
  assert.equal((await reportForumContent({ supabase: fake, reporterUserId: "u1", targetType: "meme", targetId: "p1" })).body.errorCode, "forum_invalid_target_type");
  assert.equal((await reportForumContent({ supabase: fake, reporterUserId: "u1", targetType: "post", targetId: "" })).body.errorCode, "forum_missing_id");
  assert.equal((await reportForumContent({ supabase: fake, reporterUserId: "u1", targetType: "post", targetId: "p1", reason: "Looks like spam" })).status, 404);
});

// #3452 (ejer-direktiv 6/8): rapport uden begrundelse — påkrævet, min. 10 tegn.
test("reportForumContent: begrundelse er påkrævet (min. 10 tegn)", async () => {
  const fake = createFakeSupabase(seedState({ forum_posts: [post({ id: "p1" })] }));
  const base = { supabase: fake, reporterUserId: "u1", targetType: "post", targetId: "p1" };
  assert.equal((await reportForumContent({ ...base })).body.errorCode, "forum_reason_required");
  assert.equal((await reportForumContent({ ...base, reason: "   " })).body.errorCode, "forum_reason_required");
  assert.equal((await reportForumContent({ ...base, reason: "too short" })).body.errorCode, "forum_reason_too_short");
  assert.equal((await reportForumContent({ ...base, reason: "x".repeat(501) })).body.errorCode, "forum_reason_too_long");
  assert.equal(fake.state.forum_reports.length, 0);
  const ok = await reportForumContent({ ...base, reason: "Spam links in every post" });
  assert.equal(ok.status, 200);
});

test("reportForumContent: idempotent pr. (reporter, target) — already=true anden gang, ingen dublet", async () => {
  const fake = createFakeSupabase(seedState({ forum_posts: [post({ id: "p1" })] }));
  const first = await reportForumContent({ supabase: fake, reporterUserId: "u1", targetType: "post", targetId: "p1", reason: "Spam links" });
  assert.equal(first.status, 200);
  assert.equal(first.body.already, false);

  const second = await reportForumContent({ supabase: fake, reporterUserId: "u1", targetType: "post", targetId: "p1", reason: "Still spam links" });
  assert.equal(second.body.already, true);
  assert.equal(fake.state.forum_reports.length, 1);
  assert.equal(fake.state.forum_reports[0].reason, "Still spam links");
});

// ── Opbakning (#3517: ÉN tæller, ingen emoji-palet) ─────────────────────────

test("toggleForumReaction: validering + 404 på ukendt/slettet mål", async () => {
  const fake = createFakeSupabase(seedState({ forum_posts: [post({ id: "p1" }), post({ id: "p2", seq: 2, deleted_at: "2026-08-02T10:00:00Z" })] }));
  assert.equal((await toggleForumReaction({ supabase: fake, targetType: "nope", targetId: "p1", userId: "u1" })).body.errorCode, "forum_invalid_target_type");
  assert.equal((await toggleForumReaction({ supabase: fake, targetType: "post", targetId: "", userId: "u1" })).body.errorCode, "forum_missing_id");
  assert.equal((await toggleForumReaction({ supabase: fake, targetType: "post", targetId: "unknown", userId: "u1" })).status, 404);
  assert.equal((await toggleForumReaction({ supabase: fake, targetType: "post", targetId: "p2", userId: "u1" })).status, 404);
});

// Kernekrav: toggle er idempotent — samme bruger/mål skifter mellem
// "bakket op" og "ikke bakket op", giver ALDRIG en dublet-række.
test("toggleForumReaction: toggle-idempotens — til, fra, til igen ændrer aldrig antal ud over 0/1", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1" })],
    forum_replies: [{ id: "r1", seq: 1, created_at: "2026-08-01T11:00:00Z", post_id: "p1", user_id: "u2", team_id: "t2", body: "Reply", deleted_at: null, quoted_reply_id: null }],
  }));

  const on = await toggleForumReaction({ supabase: fake, targetType: "post", targetId: "p1", userId: "u1" });
  assert.equal(on.body.active, true);
  assert.equal(on.body.support_count, 1);
  assert.equal(fake.state.forum_reactions.length, 1);

  const off = await toggleForumReaction({ supabase: fake, targetType: "post", targetId: "p1", userId: "u1" });
  assert.equal(off.body.active, false);
  assert.equal(off.body.support_count, 0);
  assert.equal(fake.state.forum_reactions.length, 0);

  const onAgain = await toggleForumReaction({ supabase: fake, targetType: "post", targetId: "p1", userId: "u1" });
  assert.equal(onAgain.body.active, true);
  assert.equal(onAgain.body.support_count, 1);
  assert.equal(fake.state.forum_reactions.length, 1, "toggle må aldrig efterlade dubletter for samme (bruger, mål)");

  // Reaktion på et SVAR bruger samme kode-sti — target_type-adskillelsen holder.
  const replyOn = await toggleForumReaction({ supabase: fake, targetType: "reply", targetId: "r1", userId: "u1" });
  assert.equal(replyOn.body.active, true);
  assert.equal(replyOn.body.support_count, 1);
  assert.equal(fake.state.forum_reactions.length, 2, "post- og reply-opbakning fra samme bruger er to uafhængige rækker");
});

test("toggleForumReaction: to brugere der bakker op tæller uafhængigt af hinanden", async () => {
  const fake = createFakeSupabase(seedState({ forum_posts: [post({ id: "p1" })] }));
  await toggleForumReaction({ supabase: fake, targetType: "post", targetId: "p1", userId: "u1" });
  const secondUser = await toggleForumReaction({ supabase: fake, targetType: "post", targetId: "p1", userId: "u2" });
  assert.equal(secondUser.body.support_count, 2);
  assert.equal(fake.state.forum_reactions.length, 2);
});

// ── Admin: rapport-indbakke + moderation ────────────────────────────────────

test("listForumReports: opløser target-uddrag + rapportør, keyset-cursor", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1", title: "Offensive title" })],
    forum_replies: [
      { id: "r1", seq: 1, created_at: "2026-08-01T11:00:00Z", post_id: "p1", user_id: "u2", team_id: null, body: "Rude reply", deleted_at: null },
    ],
    forum_reports: [
      { id: "rep1", seq: 1, created_at: "2026-08-03T10:00:00Z", reporter_user_id: "u1", target_type: "post", target_id: "p1", reason: "spam", status: "new", resolved_at: null },
      { id: "rep2", seq: 2, created_at: "2026-08-03T11:00:00Z", reporter_user_id: "u2", target_type: "reply", target_id: "r1", reason: null, status: "new", resolved_at: null },
    ],
  }));

  const result = await listForumReports({ supabase: fake });
  assert.deepEqual(result.items.map((r) => r.id), ["rep2", "rep1"]);
  assert.equal(result.items[0].reporter_username, "bob");
  assert.equal(result.items[0].target.excerpt, "Rude reply");
  assert.equal(result.items[0].target.post_id, "p1");
  assert.equal(result.items[1].target.excerpt, "Offensive title");

  const page1 = await listForumReports({ supabase: fake, limit: "1" });
  assert.equal(page1.next_cursor, 2);
});

test("resolveForumReport + setForumPostPinned: 404 på ukendt id, ellers opdateret", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1" })],
    forum_reports: [
      { id: "rep1", seq: 1, created_at: "2026-08-03T10:00:00Z", reporter_user_id: "u1", target_type: "post", target_id: "p1", reason: null, status: "new", resolved_at: null },
    ],
  }));

  assert.equal((await resolveForumReport({ supabase: fake, id: "nope", adminUserId: "admin1" })).status, 404);
  const resolved = await resolveForumReport({ supabase: fake, id: "rep1", adminUserId: "admin1" });
  assert.equal(resolved.status, 200);
  assert.equal(fake.state.forum_reports[0].status, "resolved");
  assert.equal(fake.state.forum_reports[0].resolved_by, "admin1");

  assert.equal((await setForumPostPinned({ supabase: fake, id: "p1", pinned: "yes" })).body.errorCode, "forum_invalid_pinned");
  const pinned = await setForumPostPinned({ supabase: fake, id: "p1", pinned: true });
  assert.equal(pinned.body.is_pinned, true);
  assert.equal(fake.state.forum_posts[0].is_pinned, true);
});

test("deleteForumPost: soft delete, idempotent 404 anden gang, auto-resolver åbne rapporter", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1" })],
    forum_reports: [
      { id: "rep1", seq: 1, created_at: "2026-08-03T10:00:00Z", reporter_user_id: "u1", target_type: "post", target_id: "p1", reason: null, status: "new", resolved_at: null },
    ],
  }));

  const ok = await deleteForumPost({ supabase: fake, id: "p1", adminUserId: "admin1" });
  assert.equal(ok.status, 200);
  assert.ok(fake.state.forum_posts[0].deleted_at);
  assert.equal(fake.state.forum_posts[0].deleted_by, "admin1");
  assert.equal(fake.state.forum_reports[0].status, "resolved");

  assert.equal((await deleteForumPost({ supabase: fake, id: "p1", adminUserId: "admin1" })).status, 404);
});

test("deleteForumReply: soft delete + genberegner postens reply_count", async () => {
  const fake = createFakeSupabase(seedState({
    forum_posts: [post({ id: "p1", reply_count: 2 })],
    forum_replies: [
      { id: "r1", seq: 1, created_at: "2026-08-01T11:00:00Z", post_id: "p1", user_id: "u1", team_id: null, body: "One", deleted_at: null },
      { id: "r2", seq: 2, created_at: "2026-08-01T12:00:00Z", post_id: "p1", user_id: "u2", team_id: null, body: "Two", deleted_at: null },
    ],
  }));

  const ok = await deleteForumReply({ supabase: fake, id: "r1", adminUserId: "admin1" });
  assert.equal(ok.status, 200);
  assert.ok(fake.state.forum_replies[0].deleted_at);
  assert.equal(fake.state.forum_posts[0].reply_count, 1);
});

test("getForumReportCounts: tæller kun åbne rapporter", async () => {
  const fake = createFakeSupabase(seedState({
    forum_reports: [
      { id: "rep1", seq: 1, created_at: "2026-08-03T10:00:00Z", reporter_user_id: "u1", target_type: "post", target_id: "p1", reason: null, status: "new", resolved_at: null },
      { id: "rep2", seq: 2, created_at: "2026-08-03T11:00:00Z", reporter_user_id: "u2", target_type: "post", target_id: "p1", reason: null, status: "resolved", resolved_at: "2026-08-04T10:00:00Z" },
    ],
  }));
  assert.deepEqual(await getForumReportCounts({ supabase: fake }), { new: 1 });
});
