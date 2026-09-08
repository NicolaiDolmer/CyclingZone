// #3200 — Beskeder mellem managers (DM v1).
//
// Ejer-designvalg 8/9: kun 1:1, blokér + anmeld + log, og handels-koblingen
// med fra start. Design: docs/superpowers/specs/2026-09-08-manager-dm-v1-design.md
//
// Handler-logikken bor her og ikke inline i api.js, af samme grund som
// forum.js og feedbackInbox.js: api.js kræver en live Supabase-klient og kan
// ikke unit-testes direkte, mens rene handlere kan køres mod createFakeSupabase.
//
// SIKKERHED: alt herinde forudsætter en service-role-klient bag requireAuth.
// Klienten sender ALDRIG sit eget bruger-id — det udledes af req.user.
// Fordi service_role bypasser RLS, spejler denne fil de tre gates fra
// migrationen i JS. De to lag er bevidst redundante: RLS er sidste værn hvis
// nogen en dag læser tabellerne direkte fra frontenden.
//
//   1. Adgang: kun de to deltagere kan læse en samtale.
//   2. Blok: en besked fra en jeg har blokeret, sendt EFTER blokeringen, er
//      usynlig for mig og udløser ingen notifikation. Beskeden GEMMES
//      alligevel — tabellen er loggen og evidensen i fair-play-sager (#3131).
//   3. Ingen sletning: en bruger kan kun skjule samtalen for sig selv.
//
// YDELSE: samtalelisten laver ÉT bounded scan over beskederne i brugerens
// samtaler (DM_LIST_SCAN_LIMIT) og udleder både sidste-linje og ulæst-tal i
// JS — samme filosofi som forum.js' ACTIVITY_SCAN_LIMIT, og modsat en
// forespørgsel pr. samtale (N+1). Konsekvensen står ved konstanten.

import { captureException } from "./sentry.js";

export const DM_BODY_MAX_LENGTH = 2000;
export const DM_REPORT_REASON_MAX_LENGTH = 1000;
export const DM_REPORT_REASON_MIN_LENGTH = 10;

// Samtalelisten. Bevidst lav: fanen viser de nyeste samtaler, ikke et arkiv.
export const DM_LIST_LIMIT = 50;
// Tråd-visningen henter de nyeste beskeder; ældre hentes med `before`-cursor.
export const DM_THREAD_PAGE_LIMIT = 50;
export const DM_THREAD_MAX_LIMIT = 200;

// Bounded scan bag samtalelisten: sidste-linje + ulæst-tal for op til
// DM_LIST_LIMIT samtaler udledes af ÉT kald. Rammer en bruger loftet (2.000
// beskeder fordelt på sine 50 nyeste samtaler), er sidste-linjen stadig
// korrekt for de travleste samtaler, mens ulæst-tallet for de stilleste kan
// være undervurderet. Alternativet er en forespørgsel pr. samtale, og v1's
// skala (én sæson, under hundrede aktive managere) er milevidt fra loftet.
export const DM_LIST_SCAN_LIMIT = 2000;
// Nav-badgen viser "9+" over dette tal, så et præcist tal aldrig er nødvendigt.
export const DM_UNREAD_BADGE_CAP = 9;

export const DM_CONTEXT_KINDS = ["transfer_offer", "auction"];

// ── Rene helpers (unit-testes uden database) ────────────────────────────────

/**
 * Den uordnede par-nøgle. participant_a er ALTID den leksikografisk mindste
 * af de to bruger-id'er, participant_b den største — præcis som CHECK'en
 * `participant_a < participant_b` i migrationen. Uden den ville (A,B) og
 * (B,A) blive to samtaler mellem de samme to mennesker.
 */
export function orderedPair(userOne, userTwo) {
  if (!userOne || !userTwo) return null;
  if (userOne === userTwo) return null;
  return userOne < userTwo
    ? { participantA: userOne, participantB: userTwo }
    : { participantA: userTwo, participantB: userOne };
}

/** Den anden part i en samtale, set fra `userId`. */
export function otherParticipant(conversation, userId) {
  if (!conversation) return null;
  if (conversation.participant_a === userId) return conversation.participant_b;
  if (conversation.participant_b === userId) return conversation.participant_a;
  return null;
}

export function isParticipant(conversation, userId) {
  return Boolean(conversation) && (conversation.participant_a === userId || conversation.participant_b === userId);
}

/**
 * Ulæst = beskeder fra den ANDEN part med created_at > last_read_at. Ingen
 * læse-række betyder at alt fra den anden part er ulæst. Egne beskeder tælles
 * aldrig: man har set det man selv har skrevet.
 */
export function countUnread(messages, { userId, lastReadAt = null }) {
  const readCutoff = lastReadAt ? Date.parse(lastReadAt) : null;
  let count = 0;
  for (const msg of messages || []) {
    if (msg.sender_id === userId) continue;
    if (readCutoff != null && Date.parse(msg.created_at) <= readCutoff) continue;
    count += 1;
  }
  return count;
}

/**
 * Blok-filteret, spejlet fra RLS-policyen. En besked fra en bruger jeg har
 * blokeret er usynlig for mig hvis den er sendt EFTER at jeg blokerede.
 * Historik fra før blokeringen bevares — ellers ville en blokering slette
 * konteksten for den anmeldelse man typisk laver i samme åndedrag.
 *
 * @param {Array} messages
 * @param {Map<string, string>} blockedSinceBySender bruger-id → blokeringens created_at
 */
export function filterMessagesBlockedForViewer(messages, blockedSinceBySender) {
  if (!blockedSinceBySender || blockedSinceBySender.size === 0) return messages || [];
  return (messages || []).filter((msg) => {
    const blockedSince = blockedSinceBySender.get(msg.sender_id);
    if (!blockedSince) return true;
    return Date.parse(msg.created_at) < Date.parse(blockedSince);
  });
}

/** Trimmet beskedtekst, eller null hvis den er tom eller for lang. */
export function normalizeMessageBody(body) {
  if (typeof body !== "string") return null;
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > DM_BODY_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * Den citerede handel på den første besked fra "Skriv til modparten".
 * Kun felter begge parter i forvejen kan se: rytter, beløb, dato og et
 * deep link. Ukendte felter kastes væk, så klienten ikke kan smugle
 * vilkårlig JSON ind i en besked der ligger i loggen for evigt.
 */
export function normalizeMessageContext(context) {
  if (!context || typeof context !== "object") return null;
  const kind = typeof context.kind === "string" ? context.kind : null;
  if (!DM_CONTEXT_KINDS.includes(kind)) return null;
  const refId = typeof context.refId === "string" ? context.refId : null;
  if (!refId) return null;
  const amount = Number.isFinite(Number(context.amount)) ? Math.round(Number(context.amount)) : null;
  const riderName = typeof context.riderName === "string" ? context.riderName.trim().slice(0, 120) : null;
  const occurredAt = typeof context.occurredAt === "string" ? context.occurredAt : null;
  return { kind, refId, riderName: riderName || null, amount, occurredAt };
}

// ── Databasehjælpere ────────────────────────────────────────────────────────

/**
 * Manager-visningen af en bruger: managernavn + holdnavn. Deltagerne er
 * brugere (#4379), men spilleren kender hinanden på hold. AI- og bank-hold
 * er ikke managere og kan hverken skrives til eller vises som modpart.
 */
async function loadManagerProfiles(supabase, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("teams")
    .select("id, user_id, name, manager_name, is_ai, is_bank")
    .in("user_id", ids)
    .eq("is_ai", false)
    .eq("is_bank", false)
    .limit(ids.length);
  if (error) throw new Error(`dm: could not load manager profiles: ${error.message}`);
  const byUser = new Map();
  for (const row of data || []) {
    if (!byUser.has(row.user_id)) {
      byUser.set(row.user_id, {
        userId: row.user_id,
        teamId: row.id,
        teamName: row.name || null,
        managerName: row.manager_name || null,
      });
    }
  }
  return byUser;
}

/** Bruger-id → blokeringens created_at, for de blokeringer `userId` selv har lavet. */
async function loadBlocksByViewer(supabase, userId) {
  const { data, error } = await supabase
    .from("dm_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", userId)
    .limit(1000);
  if (error) throw new Error(`dm: could not load blocks: ${error.message}`);
  return new Map((data || []).map((row) => [row.blocked_id, row.created_at]));
}

/**
 * Har `recipientUserId` blokeret `senderUserId`?
 *
 * NB om `.limit(1)` frem for `.maybeSingle()` i hele denne fil: dm_*-tabellerne
 * er nye og star derfor endnu ikke i database/schema-snapshot.json, som
 * genereres fra prod. `check-maybesingle-unique-scope.mjs` (#4496) fejler
 * bevidst hojlydt pa en tabel den ikke kan finde i snapshottet, fordi et
 * stille skip ville kunne skjule en reelt under-scopet enkelt-raekke-hentning.
 * At handredigere et prod-snapshot for at tilfredsstille en lint er varre end
 * at skrive forespurgslen pa den form der er semantisk identisk. Efter naste
 * snapshot-refresh kan de skrives om, hvis nogen vil.
 */
async function isBlockedBy(supabase, { blockerId, blockedId }) {
  const { data, error } = await supabase
    .from("dm_blocks")
    .select("blocker_id")
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId)
    .limit(1);
  if (error) throw new Error(`dm: could not check block: ${error.message}`);
  return Boolean(data?.[0]);
}

/**
 * Brugerens samtaler. To .eq()-forespørgsler i stedet for ét .or(): et
 * bruger-id interpoleret i en .or()-filterstreng er en injektions-flade
 * (samme grund som UUID_RE-guarden på route-niveau, api.js), og de to
 * kolonner er hver især indekserede. Sorteringen sker i JS, fordi
 * last_message_at er null indtil den første besked er sendt.
 */
async function loadConversationsForUser(supabase, userId) {
  const columns = "id, participant_a, participant_b, created_at, last_message_at";
  const [asA, asB] = await Promise.all([
    supabase.from("dm_conversations").select(columns).eq("participant_a", userId).limit(DM_LIST_LIMIT),
    supabase.from("dm_conversations").select(columns).eq("participant_b", userId).limit(DM_LIST_LIMIT),
  ]);
  if (asA.error) throw new Error(`dm: could not load conversations: ${asA.error.message}`);
  if (asB.error) throw new Error(`dm: could not load conversations: ${asB.error.message}`);

  const seen = new Set();
  const rows = [];
  for (const row of [...(asA.data || []), ...(asB.data || [])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  rows.sort((left, right) => {
    const leftAt = Date.parse(left.last_message_at || left.created_at || 0);
    const rightAt = Date.parse(right.last_message_at || right.created_at || 0);
    return rightAt - leftAt;
  });
  return rows.slice(0, DM_LIST_LIMIT);
}

async function loadConversationById(supabase, conversationId) {
  const { data, error } = await supabase
    .from("dm_conversations")
    .select("id, participant_a, participant_b, created_at, last_message_at")
    .eq("id", conversationId)
    .limit(1);
  if (error) throw new Error(`dm: could not load conversation: ${error.message}`);
  return data?.[0] || null;
}

async function loadReads(supabase, { userId, conversationIds }) {
  if (!conversationIds?.length) return new Map();
  const { data, error } = await supabase
    .from("dm_reads")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId)
    .in("conversation_id", conversationIds)
    .limit(conversationIds.length);
  if (error) throw new Error(`dm: could not load read markers: ${error.message}`);
  return new Map((data || []).map((row) => [row.conversation_id, row.last_read_at]));
}

async function loadHides(supabase, { userId, conversationIds }) {
  if (!conversationIds?.length) return new Map();
  const { data, error } = await supabase
    .from("dm_conversation_hides")
    .select("conversation_id, hidden_at")
    .eq("user_id", userId)
    .in("conversation_id", conversationIds)
    .limit(conversationIds.length);
  if (error) throw new Error(`dm: could not load hides: ${error.message}`);
  return new Map((data || []).map((row) => [row.conversation_id, row.hidden_at]));
}

// ── Handlere ────────────────────────────────────────────────────────────────

/**
 * Samtalelisten til Beskeder-fanen: modpart (managernavn + holdnavn), sidste
 * linje, tidspunkt og ulæst-tal. Skjulte samtaler udelades, indtil en ny
 * besked er kommet efter hidden_at — da dukker samtalen op igen.
 */
export async function listConversations({ supabase, userId }) {
  const conversations = await loadConversationsForUser(supabase, userId);
  if (conversations.length === 0) return { status: 200, body: { conversations: [] } };

  const ids = conversations.map((c) => c.id);
  const [reads, hides, blocks] = await Promise.all([
    loadReads(supabase, { userId, conversationIds: ids }),
    loadHides(supabase, { userId, conversationIds: ids }),
    loadBlocksByViewer(supabase, userId),
  ]);

  const { data: messageRows, error: messageError } = await supabase
    .from("dm_messages")
    .select("id, conversation_id, sender_id, body, created_at, context")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false })
    .limit(DM_LIST_SCAN_LIMIT);
  if (messageError) throw new Error(`dm: could not load messages: ${messageError.message}`);

  const visible = filterMessagesBlockedForViewer(messageRows || [], blocks);
  const byConversation = new Map();
  for (const msg of visible) {
    const bucket = byConversation.get(msg.conversation_id);
    if (bucket) bucket.push(msg);
    else byConversation.set(msg.conversation_id, [msg]);
  }

  const profiles = await loadManagerProfiles(
    supabase,
    conversations.map((c) => otherParticipant(c, userId)),
  );

  const items = [];
  for (const conversation of conversations) {
    const messages = byConversation.get(conversation.id) || [];
    const latest = messages[0] || null;
    const hiddenAt = hides.get(conversation.id) || null;
    // Skjult samtale kommer først tilbage når der er en NYERE besked end
    // skjulningen. Rækken i dm_conversation_hides bliver liggende.
    if (hiddenAt && (!latest || Date.parse(latest.created_at) <= Date.parse(hiddenAt))) continue;

    const otherUserId = otherParticipant(conversation, userId);
    const profile = profiles.get(otherUserId) || null;
    items.push({
      id: conversation.id,
      otherUserId,
      otherManagerName: profile?.managerName || null,
      otherTeamName: profile?.teamName || null,
      otherTeamId: profile?.teamId || null,
      lastMessageAt: latest?.created_at || conversation.last_message_at || null,
      lastMessagePreview: latest?.body ? latest.body.slice(0, 140) : null,
      lastMessageFromMe: latest ? latest.sender_id === userId : false,
      unreadCount: countUnread(messages, { userId, lastReadAt: reads.get(conversation.id) || null }),
      blocked: blocks.has(otherUserId),
    });
  }

  return { status: 200, body: { conversations: items } };
}

/**
 * Nav-badgen: antal samtaler med mindst én ulæst besked. Bevidst "samtaler",
 * ikke "beskeder" — badgen svarer på "hvor mange steder venter nogen på mig".
 */
export async function getUnreadSummary({ supabase, userId }) {
  const { body } = await listConversations({ supabase, userId });
  const conversationsWithUnread = body.conversations.filter((c) => c.unreadCount > 0);
  const total = conversationsWithUnread.reduce((sum, c) => sum + c.unreadCount, 0);
  return {
    status: 200,
    body: {
      unreadConversations: conversationsWithUnread.length,
      unreadMessages: total,
      hasUnread: conversationsWithUnread.length > 0,
    },
  };
}

/**
 * Én tråd. Nyeste beskeder først fra databasen, vendt til kronologisk orden i
 * svaret, så klienten kan rendere direkte. `before` er en created_at-cursor
 * til at hente ældre beskeder.
 */
export async function getConversation({ supabase, userId, conversationId, limit, before = null }) {
  const conversation = await loadConversationById(supabase, conversationId);
  if (!conversation) return { status: 404, body: { error: "Conversation not found", errorCode: "dm_not_found" } };
  if (!isParticipant(conversation, userId)) {
    // 404 og ikke 403: en fremmed skal ikke kunne aflæse at samtalen findes.
    return { status: 404, body: { error: "Conversation not found", errorCode: "dm_not_found" } };
  }

  const pageSize = Math.min(
    Math.max(Number.parseInt(limit, 10) || DM_THREAD_PAGE_LIMIT, 1),
    DM_THREAD_MAX_LIMIT,
  );

  let query = supabase
    .from("dm_messages")
    .select("id, conversation_id, sender_id, body, created_at, context")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);
  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error) throw new Error(`dm: could not load thread: ${error.message}`);

  const blocks = await loadBlocksByViewer(supabase, userId);
  const rows = filterMessagesBlockedForViewer(data || [], blocks);
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const otherUserId = otherParticipant(conversation, userId);
  const profiles = await loadManagerProfiles(supabase, [otherUserId]);
  const profile = profiles.get(otherUserId) || null;

  return {
    status: 200,
    body: {
      conversation: {
        id: conversation.id,
        otherUserId,
        otherManagerName: profile?.managerName || null,
        otherTeamName: profile?.teamName || null,
        otherTeamId: profile?.teamId || null,
        blocked: blocks.has(otherUserId),
      },
      messages: page
        .slice()
        .reverse()
        .map((msg) => ({
          id: msg.id,
          body: msg.body,
          createdAt: msg.created_at,
          fromMe: msg.sender_id === userId,
          context: msg.context || null,
        })),
      hasMore,
      nextBefore: hasMore ? page[page.length - 1]?.created_at || null : null,
    },
  };
}

/**
 * Find eller opret samtalen mellem to brugere. Race-sikker: to samtidige
 * første-beskeder rammer den unikke par-nøgle, og taberen læser bare den
 * række vinderen lige har lavet.
 */
export async function ensureConversation({ supabase, userOne, userTwo, now = new Date() }) {
  const pair = orderedPair(userOne, userTwo);
  if (!pair) return null;

  const { data: existing, error: findError } = await supabase
    .from("dm_conversations")
    .select("id, participant_a, participant_b, created_at, last_message_at")
    .eq("participant_a", pair.participantA)
    .eq("participant_b", pair.participantB)
    .limit(1);
  if (findError) throw new Error(`dm: could not look up conversation: ${findError.message}`);
  if (existing?.[0]) return existing[0];

  const { data: inserted, error: insertError } = await supabase
    .from("dm_conversations")
    .insert({
      participant_a: pair.participantA,
      participant_b: pair.participantB,
      created_at: now.toISOString(),
      last_message_at: null,
    })
    .select("id, participant_a, participant_b, created_at, last_message_at")
    .single();

  if (insertError) {
    // 23505 = unique_violation: nogen nåede at oprette samtalen imens.
    if (insertError.code === "23505") {
      const { data: raced, error: reReadError } = await supabase
        .from("dm_conversations")
        .select("id, participant_a, participant_b, created_at, last_message_at")
        .eq("participant_a", pair.participantA)
        .eq("participant_b", pair.participantB)
        .limit(1);
      if (reReadError) throw new Error(`dm: could not re-read conversation: ${reReadError.message}`);
      if (raced?.[0]) return raced[0];
    }
    throw new Error(`dm: could not create conversation: ${insertError.message}`);
  }
  return inserted;
}

/**
 * Send en besked.
 *
 * BLOK-SEMANTIKKEN (ejer-valg 2, 8/9): har modtageren blokeret afsenderen,
 * gemmes beskeden alligevel — loggen skal være komplet, den er evidensen i
 * fair-play-sager (#3131) — men der sendes ingen notifikation, og modtagerens
 * læsninger filtrerer beskeden fra. Svaret til afsenderen er et helt normalt
 * 200. En skjult knap eller en 403 ville fortælle den blokerede direkte at
 * han er blokeret, og det er præcis det ejeren ikke vil.
 *
 * `notify` er injicérbar for test; en fejlet notifikation må ALDRIG vælte
 * selve beskeden (samme isolerings-mønster som notificationService.js).
 */
export async function sendDirectMessage({
  supabase,
  senderUserId,
  recipientUserId = null,
  conversationId = null,
  body,
  context = null,
  now = new Date(),
  notify = null,
}) {
  const trimmed = normalizeMessageBody(body);
  if (!trimmed) {
    return { status: 400, body: { error: "Message must be between 1 and 2000 characters", errorCode: "dm_body_invalid" } };
  }

  let conversation = null;
  let recipientId = recipientUserId;

  if (conversationId) {
    conversation = await loadConversationById(supabase, conversationId);
    if (!conversation || !isParticipant(conversation, senderUserId)) {
      return { status: 404, body: { error: "Conversation not found", errorCode: "dm_not_found" } };
    }
    recipientId = otherParticipant(conversation, senderUserId);
  }

  if (!recipientId || recipientId === senderUserId) {
    return { status: 400, body: { error: "Pick a manager to write to", errorCode: "dm_invalid_recipient" } };
  }

  // Modtageren skal være en rigtig manager. AI- og bank-hold har ingen
  // menneskelig ejer og må aldrig kunne stå som modpart i en samtale.
  const profiles = await loadManagerProfiles(supabase, [recipientId]);
  if (!profiles.has(recipientId)) {
    return { status: 404, body: { error: "Manager not found", errorCode: "dm_recipient_not_found" } };
  }

  if (!conversation) {
    conversation = await ensureConversation({ supabase, userOne: senderUserId, userTwo: recipientId, now });
    if (!conversation) {
      return { status: 400, body: { error: "Pick a manager to write to", errorCode: "dm_invalid_recipient" } };
    }
  }

  const blocked = await isBlockedBy(supabase, { blockerId: recipientId, blockedId: senderUserId });

  const { data: inserted, error: insertError } = await supabase
    .from("dm_messages")
    .insert({
      conversation_id: conversation.id,
      sender_id: senderUserId,
      body: trimmed,
      context: normalizeMessageContext(context),
      created_at: now.toISOString(),
    })
    .select("id, created_at")
    .single();
  if (insertError) throw new Error(`dm: could not send message: ${insertError.message}`);

  // last_message_at holder samtalelistens sortering korrekt uden at scanne
  // beskederne. Den bumpes OGSÅ for en blokeret besked: afsenderen skal se
  // sin egen tråd stige til tops, ellers lækker blokeringen gennem listen.
  const { error: bumpError } = await supabase
    .from("dm_conversations")
    .update({ last_message_at: inserted.created_at })
    .eq("id", conversation.id);
  if (bumpError) throw new Error(`dm: could not bump conversation: ${bumpError.message}`);

  if (!blocked && notify) {
    try {
      await notify({
        supabase,
        recipientUserId: recipientId,
        senderUserId,
        conversationId: conversation.id,
        now,
      });
    } catch (err) {
      console.error("  ❌ dm-notifikation fejlede (samtale %s):", conversation.id, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "dm-message" } });
    }
  }

  return {
    status: 200,
    body: {
      conversationId: conversation.id,
      message: {
        id: inserted.id,
        body: trimmed,
        createdAt: inserted.created_at,
        fromMe: true,
        context: normalizeMessageContext(context),
      },
      // Kun til intern brug/tests. Feltet er bevidst udeladt af det svar
      // frontenden læser på, så intet i UI'et kan komme til at afsløre en
      // blokering ved et uheld.
      delivered: !blocked,
    },
  };
}

/** Markér samtalen læst frem til nu. */
export async function markConversationRead({ supabase, userId, conversationId, now = new Date() }) {
  const conversation = await loadConversationById(supabase, conversationId);
  if (!conversation || !isParticipant(conversation, userId)) {
    return { status: 404, body: { error: "Conversation not found", errorCode: "dm_not_found" } };
  }
  const { error } = await supabase
    .from("dm_reads")
    .upsert(
      { conversation_id: conversationId, user_id: userId, last_read_at: now.toISOString() },
      { onConflict: "conversation_id,user_id" },
    );
  if (error) throw new Error(`dm: could not mark read: ${error.message}`);
  return { status: 200, body: { ok: true, lastReadAt: now.toISOString() } };
}

export async function blockManager({ supabase, userId, targetUserId, now = new Date() }) {
  if (!targetUserId || targetUserId === userId) {
    return { status: 400, body: { error: "Pick a manager to block", errorCode: "dm_invalid_block_target" } };
  }
  const { error } = await supabase
    .from("dm_blocks")
    .upsert(
      { blocker_id: userId, blocked_id: targetUserId, created_at: now.toISOString() },
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`dm: could not block: ${error.message}`);
  return { status: 200, body: { ok: true, blocked: true } };
}

export async function unblockManager({ supabase, userId, targetUserId }) {
  if (!targetUserId) {
    return { status: 400, body: { error: "Pick a manager to unblock", errorCode: "dm_invalid_block_target" } };
  }
  const { error } = await supabase
    .from("dm_blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", targetUserId);
  if (error) throw new Error(`dm: could not unblock: ${error.message}`);
  return { status: 200, body: { ok: true, blocked: false } };
}

/**
 * Anmeld en samtale. Rækken i dm_reports ER admin-nøglen til tråden: uden den
 * kan admin ikke læse samtalen, hverken i UI'et eller gennem RLS.
 * Idempotent pr. (anmelder, samtale) så længe den forrige anmeldelse er åben —
 * ellers ville en dobbeltklikkende spiller lave to sager ud af én.
 */
export async function reportConversation({ supabase, userId, conversationId, reason, now = new Date() }) {
  const conversation = await loadConversationById(supabase, conversationId);
  if (!conversation || !isParticipant(conversation, userId)) {
    return { status: 404, body: { error: "Conversation not found", errorCode: "dm_not_found" } };
  }
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < DM_REPORT_REASON_MIN_LENGTH) {
    return { status: 400, body: { error: "Tell me what is wrong, in a sentence or two", errorCode: "dm_report_reason_required" } };
  }
  if (trimmed.length > DM_REPORT_REASON_MAX_LENGTH) {
    return { status: 400, body: { error: "Reason is too long", errorCode: "dm_report_reason_too_long" } };
  }

  const { data: open, error: findError } = await supabase
    .from("dm_reports")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("reporter_id", userId)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (findError) throw new Error(`dm: could not check existing report: ${findError.message}`);
  if (open?.[0]) return { status: 200, body: { ok: true, reportId: open[0].id, alreadyReported: true } };

  const { data: inserted, error: insertError } = await supabase
    .from("dm_reports")
    .insert({
      conversation_id: conversationId,
      reporter_id: userId,
      reason: trimmed,
      created_at: now.toISOString(),
      resolved_at: null,
      resolved_by: null,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`dm: could not report conversation: ${insertError.message}`);
  return { status: 200, body: { ok: true, reportId: inserted.id, alreadyReported: false } };
}

/**
 * Skjul samtalen for kalderen. Erstatningen for sletning: beskederne bliver
 * liggende i dm_messages, og en ny besked bringer samtalen tilbage i listen.
 */
export async function hideConversation({ supabase, userId, conversationId, now = new Date() }) {
  const conversation = await loadConversationById(supabase, conversationId);
  if (!conversation || !isParticipant(conversation, userId)) {
    return { status: 404, body: { error: "Conversation not found", errorCode: "dm_not_found" } };
  }
  const { error } = await supabase
    .from("dm_conversation_hides")
    .upsert(
      { conversation_id: conversationId, user_id: userId, hidden_at: now.toISOString() },
      { onConflict: "conversation_id,user_id" },
    );
  if (error) throw new Error(`dm: could not hide conversation: ${error.message}`);
  return { status: 200, body: { ok: true } };
}

/**
 * Slå samtalen med en bestemt manager op — indgangen fra managerprofilen,
 * forumnavnet og "Skriv til modparten". Opretter IKKE en samtale: den fødes
 * først når nogen faktisk skriver, så en tom tråd aldrig kan stå og fylde i
 * modpartens liste.
 */
export async function findConversationWith({ supabase, userId, targetUserId }) {
  const pair = orderedPair(userId, targetUserId);
  if (!pair) return { status: 400, body: { error: "Pick a manager to write to", errorCode: "dm_invalid_recipient" } };

  const profiles = await loadManagerProfiles(supabase, [targetUserId]);
  const profile = profiles.get(targetUserId);
  if (!profile) return { status: 404, body: { error: "Manager not found", errorCode: "dm_recipient_not_found" } };

  const { data, error } = await supabase
    .from("dm_conversations")
    .select("id")
    .eq("participant_a", pair.participantA)
    .eq("participant_b", pair.participantB)
    .limit(1);
  if (error) throw new Error(`dm: could not look up conversation: ${error.message}`);

  const blocks = await loadBlocksByViewer(supabase, userId);
  return {
    status: 200,
    body: {
      conversationId: data?.[0]?.id || null,
      otherUserId: targetUserId,
      otherManagerName: profile.managerName,
      otherTeamName: profile.teamName,
      otherTeamId: profile.teamId,
      blocked: blocks.has(targetUserId),
    },
  };
}

/**
 * Modpartens bruger-id i en samtale jeg selv er part i.
 *
 * CodeRabbit 8/9: blokeringen var kun team-noeglet, og `otherTeamId` kan vaere
 * null (linje 325/401) for en modpart uden hold — en manager der har forladt
 * sit hold kunne dermed ikke blokeres. Blokering er en sikkerhedsfunktion og
 * skal altid virke, saa den kan nu ogsaa noegles paa selve samtalen, hvor
 * modparten udledes paa serveren. Returnerer null hvis samtalen ikke findes
 * eller jeg ikke er part i den — kalderen maa ikke kunne skelne de to.
 */
export async function resolveCounterpartUserId({ supabase, userId, conversationId }) {
  const conversation = await loadConversationById(supabase, conversationId);
  if (!conversation || !isParticipant(conversation, userId)) return null;
  return conversation.participant_a === userId
    ? conversation.participant_b
    : conversation.participant_a;
}

/**
 * Bruger-id'et bag et hold. Managerprofilen kender kun holdet, men samtalen
 * hænger på personen (#4379).
 */
export async function resolveManagerUserId({ supabase, teamId }) {
  const { data, error } = await supabase
    .from("teams")
    .select("id, user_id, is_ai, is_bank")
    .eq("id", teamId)
    .limit(1);
  if (error) throw new Error(`dm: could not resolve manager: ${error.message}`);
  const team = data?.[0];
  if (!team || team.is_ai || team.is_bank || !team.user_id) return null;
  return team.user_id;
}
