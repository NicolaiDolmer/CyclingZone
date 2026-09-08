// #3200 · DM v1 — tests af de tre ejer-valg som adfærd, ikke som kommentarer.
//
// Det der SKAL være rødt hvis nogen bryder det:
//   1. Par-nøglen er uordnet: A→B og B→A er ÉN samtale.
//   2. En blokeret afsender får et normalt svar, beskeden GEMMES, men der
//      sendes ingen notifikation, og modtageren ser den ikke.
//   3. Ingen sletning: skjul rammer kun den der skjulte.
//   4. Admin-adgangen kræver en anmeldelse (RLS-siden er dokumenteret; her
//      testes at anmeldelsen faktisk skrives og er idempotent).

import assert from "node:assert/strict";
import test from "node:test";

import {
  DM_BODY_MAX_LENGTH,
  blockManager,
  countUnread,
  ensureConversation,
  filterMessagesBlockedForViewer,
  findConversationWith,
  getConversation,
  hideConversation,
  listConversations,
  markConversationRead,
  normalizeMessageBody,
  normalizeMessageContext,
  orderedPair,
  otherParticipant,
  reportConversation,
  resolveCounterpartUserId,
  resolveManagerUserId,
  sendDirectMessage,
  unblockManager,
} from "./directMessages.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CARLA = "33333333-3333-4333-8333-333333333333";

const ALICE_TEAM = "aaaa1111-1111-4111-8111-111111111111";
const BOB_TEAM = "bbbb2222-2222-4222-8222-222222222222";
const AI_TEAM = "cccc3333-3333-4333-8333-333333333333";
const AI_USER = "44444444-4444-4444-8444-444444444444";

function baseState(overrides = {}) {
  return {
    teams: [
      { id: ALICE_TEAM, user_id: ALICE, name: "Team Alice", manager_name: "Alice", is_ai: false, is_bank: false },
      { id: BOB_TEAM, user_id: BOB, name: "Team Bob", manager_name: "Bob", is_ai: false, is_bank: false },
      { id: AI_TEAM, user_id: AI_USER, name: "AI Squad", manager_name: null, is_ai: true, is_bank: false },
    ],
    dm_conversations: [],
    dm_messages: [],
    dm_reads: [],
    dm_blocks: [],
    dm_reports: [],
    dm_conversation_hides: [],
    notifications: [],
    ...overrides,
  };
}

// ── Rene helpers ────────────────────────────────────────────────────────────

test("orderedPair er uordnet: samme par uanset kalder-rækkefølge", () => {
  const forward = orderedPair(ALICE, BOB);
  const backward = orderedPair(BOB, ALICE);
  assert.deepEqual(forward, backward);
  assert.equal(forward.participantA < forward.participantB, true);
});

test("orderedPair afviser en samtale med sig selv og manglende id", () => {
  assert.equal(orderedPair(ALICE, ALICE), null);
  assert.equal(orderedPair(ALICE, null), null);
  assert.equal(orderedPair(null, BOB), null);
});

test("otherParticipant returnerer null for en der ikke er part", () => {
  const conversation = { participant_a: ALICE, participant_b: BOB };
  assert.equal(otherParticipant(conversation, ALICE), BOB);
  assert.equal(otherParticipant(conversation, BOB), ALICE);
  assert.equal(otherParticipant(conversation, CARLA), null);
});

test("countUnread tæller kun den ANDEN parts beskeder efter last_read_at", () => {
  const messages = [
    { sender_id: BOB, created_at: "2026-09-08T10:00:00.000Z" },
    { sender_id: BOB, created_at: "2026-09-08T12:00:00.000Z" },
    { sender_id: ALICE, created_at: "2026-09-08T13:00:00.000Z" },
  ];
  assert.equal(countUnread(messages, { userId: ALICE, lastReadAt: null }), 2);
  assert.equal(countUnread(messages, { userId: ALICE, lastReadAt: "2026-09-08T11:00:00.000Z" }), 1);
  assert.equal(countUnread(messages, { userId: ALICE, lastReadAt: "2026-09-08T23:00:00.000Z" }), 0);
  // Egne beskeder tælles aldrig, heller ikke uden læsemarkør.
  assert.equal(countUnread(messages, { userId: BOB, lastReadAt: null }), 1);
});

test("blok-filteret skjuler beskeder EFTER blokeringen, men bevarer historikken", () => {
  const messages = [
    { sender_id: BOB, created_at: "2026-09-08T09:00:00.000Z", body: "før" },
    { sender_id: BOB, created_at: "2026-09-08T11:00:00.000Z", body: "efter" },
  ];
  const blocks = new Map([[BOB, "2026-09-08T10:00:00.000Z"]]);
  const visible = filterMessagesBlockedForViewer(messages, blocks);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].body, "før");
});

test("normalizeMessageBody trimmer, afviser tom og afviser over 2000 tegn", () => {
  assert.equal(normalizeMessageBody("  hej  "), "hej");
  assert.equal(normalizeMessageBody("   "), null);
  assert.equal(normalizeMessageBody(null), null);
  assert.equal(normalizeMessageBody("x".repeat(DM_BODY_MAX_LENGTH)).length, DM_BODY_MAX_LENGTH);
  assert.equal(normalizeMessageBody("x".repeat(DM_BODY_MAX_LENGTH + 1)), null);
});

test("normalizeMessageContext kaster ukendte felter og ukendte kinds væk", () => {
  const clean = normalizeMessageContext({
    kind: "transfer_offer",
    refId: "offer-1",
    riderName: "  Rider  ",
    amount: "125000.4",
    occurredAt: "2026-09-08T10:00:00.000Z",
    secretPotential: 92,
  });
  assert.deepEqual(clean, {
    kind: "transfer_offer",
    refId: "offer-1",
    riderName: "Rider",
    amount: 125000,
    occurredAt: "2026-09-08T10:00:00.000Z",
  });
  assert.equal(normalizeMessageContext({ kind: "board_secret", refId: "x" }), null);
  assert.equal(normalizeMessageContext({ kind: "auction" }), null);
  assert.equal(normalizeMessageContext(null), null);
});

// ── Samtale-nøglen ──────────────────────────────────────────────────────────

test("ensureConversation genbruger samtalen uanset hvem der starter", async () => {
  const supabase = createFakeSupabase(baseState());
  const first = await ensureConversation({ supabase, userOne: ALICE, userTwo: BOB });
  const second = await ensureConversation({ supabase, userOne: BOB, userTwo: ALICE });
  assert.equal(first.id, second.id);
  assert.equal(supabase.state.dm_conversations.length, 1);
  assert.equal(supabase.state.dm_conversations[0].participant_a < supabase.state.dm_conversations[0].participant_b, true);
});

// ── Afsendelse ──────────────────────────────────────────────────────────────

test("send opretter samtalen, gemmer beskeden og notificerer modtageren", async () => {
  const supabase = createFakeSupabase(baseState());
  const notified = [];
  const result = await sendDirectMessage({
    supabase,
    senderUserId: ALICE,
    recipientUserId: BOB,
    body: "Interested in your sprinter?",
    notify: async (args) => { notified.push(args); },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.delivered, true);
  assert.equal(supabase.state.dm_messages.length, 1);
  assert.equal(supabase.state.dm_messages[0].sender_id, ALICE);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].recipientUserId, BOB);
});

test("send afviser tom og for lang tekst med 400", async () => {
  const supabase = createFakeSupabase(baseState());
  const empty = await sendDirectMessage({ supabase, senderUserId: ALICE, recipientUserId: BOB, body: "   " });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.errorCode, "dm_body_invalid");

  const long = await sendDirectMessage({
    supabase, senderUserId: ALICE, recipientUserId: BOB, body: "x".repeat(DM_BODY_MAX_LENGTH + 1),
  });
  assert.equal(long.status, 400);
  assert.equal(supabase.state.dm_messages.length, 0);
});

test("send afviser sig selv og et AI-hold som modtager", async () => {
  const supabase = createFakeSupabase(baseState());
  const self = await sendDirectMessage({ supabase, senderUserId: ALICE, recipientUserId: ALICE, body: "hej" });
  assert.equal(self.status, 400);

  const ai = await sendDirectMessage({ supabase, senderUserId: ALICE, recipientUserId: AI_USER, body: "hej" });
  assert.equal(ai.status, 404);
  assert.equal(ai.body.errorCode, "dm_recipient_not_found");
  assert.equal(supabase.state.dm_messages.length, 0);
});

test("BLOK: beskeden gemmes, men der notificeres ikke og svaret ligner et normalt 200", async () => {
  const supabase = createFakeSupabase(baseState({
    dm_blocks: [{ blocker_id: BOB, blocked_id: ALICE, created_at: "2026-09-08T08:00:00.000Z" }],
  }));
  const notified = [];
  const result = await sendDirectMessage({
    supabase,
    senderUserId: ALICE,
    recipientUserId: BOB,
    body: "Let me in",
    notify: async (args) => { notified.push(args); },
  });

  // Afsenderen ser et helt normalt svar med sin egen besked.
  assert.equal(result.status, 200);
  assert.ok(result.body.message.id);
  // Loggen er komplet — det er evidensen i #3131.
  assert.equal(supabase.state.dm_messages.length, 1);
  // Men modtageren mærker intet.
  assert.equal(notified.length, 0);
  assert.equal(result.body.delivered, false);
});

test("BLOK: modtageren ser ikke beskeden i tråden", async () => {
  const supabase = createFakeSupabase(baseState({
    dm_blocks: [{ blocker_id: BOB, blocked_id: ALICE, created_at: "2026-09-08T08:00:00.000Z" }],
  }));
  await sendDirectMessage({
    supabase, senderUserId: ALICE, recipientUserId: BOB, body: "Let me in",
    now: new Date("2026-09-08T09:00:00.000Z"),
  });
  const conversationId = supabase.state.dm_conversations[0].id;

  const asBob = await getConversation({ supabase, userId: BOB, conversationId });
  assert.equal(asBob.body.messages.length, 0);

  // Afsenderen ser stadig sin egen besked stå i tråden.
  const asAlice = await getConversation({ supabase, userId: ALICE, conversationId });
  assert.equal(asAlice.body.messages.length, 1);
});

test("en notifikationsfejl vælter ALDRIG selve beskeden", async () => {
  const supabase = createFakeSupabase(baseState());
  const result = await sendDirectMessage({
    supabase,
    senderUserId: ALICE,
    recipientUserId: BOB,
    body: "still saved",
    notify: async () => { throw new Error("notification backend nede"); },
  });
  assert.equal(result.status, 200);
  assert.equal(supabase.state.dm_messages.length, 1);
});

// ── Læsning ─────────────────────────────────────────────────────────────────

test("en fremmed får 404 på en samtale han ikke er part i, ikke 403", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({ supabase, senderUserId: ALICE, recipientUserId: BOB, body: "privat" });
  const conversationId = supabase.state.dm_conversations[0].id;

  const asStranger = await getConversation({ supabase, userId: CARLA, conversationId });
  assert.equal(asStranger.status, 404);
  assert.equal(asStranger.body.errorCode, "dm_not_found");
});

test("samtalelisten viser modpart, sidste linje og ulæst-tal", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({
    supabase, senderUserId: ALICE, recipientUserId: BOB, body: "First",
    now: new Date("2026-09-08T09:00:00.000Z"),
  });
  await sendDirectMessage({
    supabase, senderUserId: ALICE, recipientUserId: BOB, body: "Second",
    now: new Date("2026-09-08T10:00:00.000Z"),
  });

  const asBob = await listConversations({ supabase, userId: BOB });
  assert.equal(asBob.body.conversations.length, 1);
  const row = asBob.body.conversations[0];
  assert.equal(row.otherManagerName, "Alice");
  assert.equal(row.otherTeamName, "Team Alice");
  assert.equal(row.lastMessagePreview, "Second");
  assert.equal(row.unreadCount, 2);
  assert.equal(row.lastMessageFromMe, false);
});

test("markér læst nulstiller ulæst-tallet", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({
    supabase, senderUserId: ALICE, recipientUserId: BOB, body: "Ping",
    now: new Date("2026-09-08T09:00:00.000Z"),
  });
  const conversationId = supabase.state.dm_conversations[0].id;
  await markConversationRead({
    supabase, userId: BOB, conversationId, now: new Date("2026-09-08T10:00:00.000Z"),
  });

  const asBob = await listConversations({ supabase, userId: BOB });
  assert.equal(asBob.body.conversations[0].unreadCount, 0);
});

// ── Skjul, blokér, anmeld ───────────────────────────────────────────────────

test("skjul rammer KUN den der skjulte, og sletter ingen beskeder", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({
    supabase, senderUserId: ALICE, recipientUserId: BOB, body: "Hej",
    now: new Date("2026-09-08T09:00:00.000Z"),
  });
  const conversationId = supabase.state.dm_conversations[0].id;
  await hideConversation({ supabase, userId: BOB, conversationId, now: new Date("2026-09-08T10:00:00.000Z") });

  const asBob = await listConversations({ supabase, userId: BOB });
  assert.equal(asBob.body.conversations.length, 0);
  const asAlice = await listConversations({ supabase, userId: ALICE });
  assert.equal(asAlice.body.conversations.length, 1);
  // Ingen sletning: beskederne ligger der stadig.
  assert.equal(supabase.state.dm_messages.length, 1);
});

test("en ny besked henter en skjult samtale tilbage i listen", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({
    supabase, senderUserId: ALICE, recipientUserId: BOB, body: "Første",
    now: new Date("2026-09-08T09:00:00.000Z"),
  });
  const conversationId = supabase.state.dm_conversations[0].id;
  await hideConversation({ supabase, userId: BOB, conversationId, now: new Date("2026-09-08T10:00:00.000Z") });
  await sendDirectMessage({
    supabase, senderUserId: ALICE, conversationId, body: "Er du der?",
    now: new Date("2026-09-08T11:00:00.000Z"),
  });

  const asBob = await listConversations({ supabase, userId: BOB });
  assert.equal(asBob.body.conversations.length, 1);
});

test("blokér og ophæv blokering skriver og fjerner præcis én række", async () => {
  const supabase = createFakeSupabase(baseState());
  await blockManager({ supabase, userId: BOB, targetUserId: ALICE });
  assert.equal(supabase.state.dm_blocks.length, 1);
  await unblockManager({ supabase, userId: BOB, targetUserId: ALICE });
  assert.equal(supabase.state.dm_blocks.length, 0);
});

test("anmeld kræver en begrundelse og er idempotent mens sagen er åben", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({ supabase, senderUserId: ALICE, recipientUserId: BOB, body: "grim besked" });
  const conversationId = supabase.state.dm_conversations[0].id;

  const tooShort = await reportConversation({ supabase, userId: BOB, conversationId, reason: "grim" });
  assert.equal(tooShort.status, 400);
  assert.equal(supabase.state.dm_reports.length, 0);

  const first = await reportConversation({ supabase, userId: BOB, conversationId, reason: "Han truer mig i traaden" });
  assert.equal(first.status, 200);
  assert.equal(first.body.alreadyReported, false);

  const second = await reportConversation({ supabase, userId: BOB, conversationId, reason: "Han truer mig i traaden" });
  assert.equal(second.body.alreadyReported, true);
  // Én sag, ikke to — et dobbeltklik laver ikke to admin-opgaver.
  assert.equal(supabase.state.dm_reports.length, 1);
});

test("en fremmed kan ikke anmelde en samtale han ikke er part i", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({ supabase, senderUserId: ALICE, recipientUserId: BOB, body: "privat" });
  const conversationId = supabase.state.dm_conversations[0].id;
  const result = await reportConversation({
    supabase, userId: CARLA, conversationId, reason: "Jeg vil bare se traaden",
  });
  assert.equal(result.status, 404);
  assert.equal(supabase.state.dm_reports.length, 0);
});

// ── Indgangene ──────────────────────────────────────────────────────────────

test("findConversationWith opretter ALDRIG en tom tråd", async () => {
  const supabase = createFakeSupabase(baseState());
  const result = await findConversationWith({ supabase, userId: ALICE, targetUserId: BOB });
  assert.equal(result.status, 200);
  assert.equal(result.body.conversationId, null);
  assert.equal(result.body.otherManagerName, "Bob");
  assert.equal(supabase.state.dm_conversations.length, 0);
});

test("resolveManagerUserId afviser AI-hold og ukendt hold", async () => {
  const supabase = createFakeSupabase(baseState());
  assert.equal(await resolveManagerUserId({ supabase, teamId: BOB_TEAM }), BOB);
  assert.equal(await resolveManagerUserId({ supabase, teamId: AI_TEAM }), null);
  assert.equal(await resolveManagerUserId({ supabase, teamId: ALICE }), null);
});

test("modparten kan udledes af samtalen, ogsaa uden hold (CodeRabbit 8/9)", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({ supabase, senderUserId: ALICE, recipientUserId: BOB, body: "Hi" });
  const conversationId = supabase.state.dm_conversations[0].id;

  // Begge veje: samtalen kender modparten uanset hvem der spoerger.
  assert.equal(await resolveCounterpartUserId({ supabase, userId: ALICE, conversationId }), BOB);
  assert.equal(await resolveCounterpartUserId({ supabase, userId: BOB, conversationId }), ALICE);

  // Det er hele pointen: blokering virker selv om modparten ikke har et hold,
  // hvor den team-noeglede vej ville give null.
  supabase.state.teams = supabase.state.teams.filter(t => t.id !== BOB_TEAM);
  assert.equal(await resolveManagerUserId({ supabase, teamId: BOB_TEAM }), null);
  assert.equal(await resolveCounterpartUserId({ supabase, userId: ALICE, conversationId }), BOB);
});

test("en fremmed faar null for en samtale han ikke er part i", async () => {
  const supabase = createFakeSupabase(baseState());
  await sendDirectMessage({ supabase, senderUserId: ALICE, recipientUserId: BOB, body: "Hi" });
  const conversationId = supabase.state.dm_conversations[0].id;
  assert.equal(await resolveCounterpartUserId({ supabase, userId: CARLA, conversationId }), null);
  // Ukendt samtale svarer det samme som "ikke din samtale": de to maa ikke
  // kunne skelnes udefra.
  assert.equal(
    await resolveCounterpartUserId({ supabase, userId: ALICE, conversationId: CARLA }),
    null,
  );
});

test("den citerede handel følger med den første besked", async () => {
  const supabase = createFakeSupabase(baseState());
  const result = await sendDirectMessage({
    supabase,
    senderUserId: ALICE,
    recipientUserId: BOB,
    body: "Would you take 120k?",
    context: { kind: "transfer_offer", refId: "offer-9", riderName: "J. Rider", amount: 120000, occurredAt: "2026-09-08T08:00:00.000Z" },
  });
  assert.equal(result.status, 200);
  assert.equal(supabase.state.dm_messages[0].context.kind, "transfer_offer");
  assert.equal(supabase.state.dm_messages[0].context.amount, 120000);
});
