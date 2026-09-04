// #3199/#3201 — Forum v1: opslag, svar-tråde, ejer-polls, rapportering.
//
// Plan låst 6/8: to kategorier (General · Feedback & ideas), svar-tråde,
// ejer-opslag kan pinnes og indeholde afstemninger, rapportér-knap +
// admin-sletning (soft delete), ejer notificeres via Discord ved nye
// opslag/svar (#3201 — selve pinget sker i api.js-routen, ikke her).
//
// Handler-logikken bor her (ikke inline i api.js) af samme grund som
// feedbackInbox.js: api.js kræver en live Supabase-klient og kan ikke
// unit-testes direkte, mens rene handlere kan køres mod createFakeSupabase.
//
// SIKKERHED: alt herinde forudsætter en service-role-klient. Læse-funktionerne
// kaldes bag requireAuth (forum er kun for indloggede spillere), admin-
// funktionerne KUN bag requireAdmin. forum_reports/forum_poll_votes er
// deny-all for klienter (database/2026-08-06-3199-forum.sql) — hvem der
// rapporterer/stemmer må aldrig nå en spiller-flade.
//
// YDELSE: paginering er keyset (samme mønster som feedbackInbox, #2842) —
// aldrig OFFSET. Svar-tællere genberegnes med bounded id-selects (limit 1000)
// i stedet for read-modify-write på reply_count: genberegning er selvhelende
// ved races, og 1000+ svar på ét opslag er uden for v1-skala.
//
// #4118 (Forum L1 "puls"): trådlisten sorterer efter SENESTE AKTIVITET
// (coalesce(last_reply_at, created_at) desc), ikke oprettelse — en levende
// tråd med et nyt svar skal ligge over en stille tråd der blot er nyere.
// PostgREST/postgrest-js kan ikke ORDER BY et coalesce-udtryk uden en
// generated kolonne eller en RPC; i stedet hentes et bounded, allerede-
// eksisterende-mønster udsnit (ACTIVITY_SCAN_LIMIT, samme filosofi som
// REPLY_RECOUNT_LIMIT/vote-limit 5000 andetsteds i filen) og sorteres i
// JS. Cursoren er derfor et sammensat (aktivitets-tidsstempel, seq)-par
// kodet som "<epochMs>_<seq>" — ren seq ville ikke længere være en stabil
// keyset-nøgle, fordi to opslag kan dele aktivitets-tidsstempel. Vokser
// forummet forbi denne skala kræver sorteringen en DB-side generated
// `last_activity_at`-kolonne i stedet for JS-scanningen.

export const FORUM_CATEGORIES = ["general", "feedback_ideas"];
export const FORUM_TITLE_MAX_LENGTH = 120;
export const FORUM_BODY_MAX_LENGTH = 4000;
export const FORUM_REPORT_REASON_MAX_LENGTH = 500;
// #3452 (ejer-direktiv 6/8: "gider ikke se rapporter uden grund") — begrundelse
// er nu påkrævet ved rapportering, minimum 10 tegn (nok til "spam i tråden",
// for kort til at stoppe en tom-klik-rapport uden kontekst).
export const FORUM_REPORT_REASON_MIN_LENGTH = 10;
export const FORUM_POLL_MIN_OPTIONS = 2;
export const FORUM_POLL_MAX_OPTIONS = 8;
export const FORUM_POLL_OPTION_MAX_LENGTH = 100;
export const FORUM_LIST_DEFAULT_LIMIT = 25;
export const FORUM_LIST_MAX_LIMIT = 100;
export const FORUM_REPLIES_LOAD_LIMIT = 500;
export const FORUM_REPORT_STATUSES = ["new", "resolved"];

const REPLY_RECOUNT_LIMIT = 1000;
const EXCERPT_LENGTH = 200;
// #4118: bounded scan for aktivitets-sortering — se filhoved-kommentaren.
const ACTIVITY_SCAN_LIMIT = 5000;
// #3451: bounded scan for ulæst-status (nav-prik) — samme filosofi.
const UNREAD_STATUS_SCAN_LIMIT = 2000;
// #3517: bounded scan for opbaknings-tælling pr. tråd-visning — samme
// filosofi som REPLY_RECOUNT_LIMIT/vote-limit 5000. Én tråd har typisk
// ét opslag + <=500 svar (FORUM_REPLIES_LOAD_LIMIT), langt under grænsen.
const REACTIONS_SCAN_LIMIT = 5000;

export function parseForumLimit(raw) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return FORUM_LIST_DEFAULT_LIMIT;
  return Math.min(n, FORUM_LIST_MAX_LIMIT);
}

/** Ugyldig/manipuleret cursor behandles som "første side", aldrig en 500. */
export function parseForumCursor(raw) {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function isValidForumCategory(category) {
  return FORUM_CATEGORIES.includes(category);
}

/** Aktivitets-nøgle for sortering: seneste svar, ellers oprettelse. */
function activityAt(row) {
  return row.last_reply_at || row.created_at;
}

function activityEpoch(row) {
  return Date.parse(activityAt(row));
}

/** Nyeste aktivitet først; seq desc som stabilt tiebreak (delt tidsstempel). */
function sortByActivityDesc(rows) {
  return [...rows].sort((a, b) => {
    const diff = activityEpoch(b) - activityEpoch(a);
    return diff !== 0 ? diff : b.seq - a.seq;
  });
}

/** Ugyldig/manipuleret cursor behandles som "første side", aldrig en 500. */
export function parseForumActivityCursor(raw) {
  if (raw == null || raw === "") return null;
  const str = String(raw);
  const sep = str.lastIndexOf("_");
  if (sep <= 0) return null;
  const ts = Number.parseInt(str.slice(0, sep), 10);
  const seq = Number.parseInt(str.slice(sep + 1), 10);
  if (!Number.isFinite(ts) || !Number.isFinite(seq) || seq <= 0) return null;
  return { ts, seq };
}

function encodeForumActivityCursor(row) {
  return `${activityEpoch(row)}_${row.seq}`;
}

/** Sorterer `row` strengt EFTER `cursor` i aktivitets-desc-rækkefølge. */
function isAfterActivityCursor(row, cursor) {
  const epoch = activityEpoch(row);
  if (epoch !== cursor.ts) return epoch < cursor.ts;
  return row.seq < cursor.seq;
}

function excerpt(text) {
  if (typeof text !== "string") return "";
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text;
}

/**
 * Batch-opslag af afsendere (users) + hold (teams) for en mængde rækker.
 * Ingen PostgREST-embeds: user_id peger på auth.users, ikke public.users,
 * så der er ingen FK at embedde igennem (samme begrundelse som feedbackInbox).
 * Spiller-fladen får KUN username + holdnavn — aldrig email.
 */
async function resolveAuthors({ supabase, rows }) {
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))];

  const [usersResult, teamsResult] = await Promise.all([
    userIds.length
      ? supabase.from("users").select("id, username").in("id", userIds).limit(userIds.length)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("teams").select("id, name").in("id", teamIds).limit(teamIds.length)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (usersResult.error) throw new Error(`forum: could not resolve authors: ${usersResult.error.message}`);
  if (teamsResult.error) throw new Error(`forum: could not resolve teams: ${teamsResult.error.message}`);

  return {
    usersById: new Map((usersResult.data || []).map((u) => [u.id, u])),
    teamsById: new Map((teamsResult.data || []).map((t) => [t.id, t])),
  };
}

function shapeAuthor(row, usersById, teamsById) {
  const user = usersById.get(row.user_id) || null;
  const team = row.team_id ? teamsById.get(row.team_id) || null : null;
  return {
    username: user?.username ?? null,
    team_name: team?.name ?? null,
    // #4649: team_id (ikke-sensitivt — allerede en offentlig FK) så fronten kan
    // slå Founder-mærket op via useFounderTeams uden en ekstra rundtur.
    team_id: row.team_id ?? null,
  };
}

const POST_LIST_COLUMNS =
  "id, seq, created_at, user_id, team_id, category, title, body, is_pinned, reply_count, last_reply_at";

// #3451: ulæst = ingen forum_thread_reads-række for (bruger, tråd), ELLER
// trådens seneste aktivitet er nyere end brugerens last_read_at. `lastReadAt`
// er null når kaldet ikke kender brugeren (fx tests uden userId) — falder
// til "ulæst", som er den korrekte default for en bruger der aldrig har set
// tråden.
function isThreadUnread(row, lastReadAt) {
  if (!lastReadAt) return true;
  return activityAt(row) > lastReadAt;
}

function shapeListPost(row, usersById, teamsById, pollPostIds, readsByPostId, userId) {
  return {
    id: row.id,
    seq: row.seq,
    created_at: row.created_at,
    category: row.category,
    title: row.title,
    excerpt: excerpt(row.body),
    is_pinned: row.is_pinned,
    reply_count: row.reply_count ?? 0,
    last_reply_at: row.last_reply_at,
    has_poll: pollPostIds.has(row.id),
    // Uden userId (ingen indlogget bruger — kun tests kalder listForumPosts
    // sådan) er der ingen "ulæst for hvem", så feltet falder til false i
    // stedet for at gætte via isThreadUnread's "ingen række = ulæst"-regel.
    is_unread: userId ? isThreadUnread(row, readsByPostId.get(row.id)) : false,
    author: shapeAuthor(row, usersById, teamsById),
  };
}

/**
 * Batch-opslag af "sidst læst"-tidsstempler for én bruger over en mængde
 * tråde — bounded IN-select, samme mønster som resolveAuthors (aldrig N+1
 * pr. tråd). Returnerer et tomt map hvis der ikke er nogen bruger/rækker.
 */
async function resolveThreadReads({ supabase, userId, postIds }) {
  const map = new Map();
  if (!userId || !postIds.length) return map;
  const { data, error } = await supabase
    .from("forum_thread_reads")
    .select("post_id, last_read_at")
    .eq("user_id", userId)
    .in("post_id", postIds)
    .limit(postIds.length);
  if (error) throw new Error(`forum: could not resolve thread reads: ${error.message}`);
  for (const row of data || []) map.set(row.post_id, row.last_read_at);
  return map;
}

/**
 * #3517 · Batch-opslag af opbaknings-tal for en mængde mål af SAMME type
 * (alle posts, eller alle replies) — bounded IN-select, samme mønster som
 * resolveAuthors/resolveThreadReads (aldrig N+1 pr. indlæg). Returnerer
 * counts (target_id -> antal) + mine (Set af target_id'er requesteren selv
 * har bakket op). `userId` er valgfri — uden den er `mine` altid tom.
 */
async function resolveReactionSummaries({ supabase, targetType, targetIds, userId = null }) {
  const counts = new Map();
  const mine = new Set();
  if (!targetIds.length) return { counts, mine };
  const { data, error } = await supabase
    .from("forum_reactions")
    .select("target_id, user_id")
    .eq("target_type", targetType)
    .in("target_id", targetIds)
    .limit(REACTIONS_SCAN_LIMIT);
  if (error) throw new Error(`forum: could not resolve reactions (${targetType}): ${error.message}`);
  for (const row of data || []) {
    counts.set(row.target_id, (counts.get(row.target_id) ?? 0) + 1);
    if (userId && row.user_id === userId) mine.add(row.target_id);
  }
  return { counts, mine };
}

/**
 * GET /api/forum/posts — én side, SENESTE AKTIVITET først (#4118: coalesce
 * (last_reply_at, created_at) desc — se filhoved-kommentaren for hvorfor
 * sorteringen sker i JS over et bounded udsnit). Pinnede opslag serveres i en
 * separat `pinned`-blok på FØRSTE side (ingen cursor) og er udeladt af den
 * paginerede hovedliste. `userId` (valgfri — tests kan udelade den) driver
 * pr.-tråd is_unread (#3451).
 */
export async function listForumPosts({ supabase, category = null, limit, cursor, userId = null }) {
  const pageSize = parseForumLimit(limit);
  const afterCursor = parseForumActivityCursor(cursor);
  const categoryFilter = isValidForumCategory(category) ? category : null;

  let query = supabase.from("forum_posts").select(POST_LIST_COLUMNS)
    .is("deleted_at", null)
    .eq("is_pinned", false);
  if (categoryFilter) query = query.eq("category", categoryFilter);

  // Bounded scan, sorteret + keyset-filtreret i JS (ikke OFFSET — se
  // filhoved-kommentaren for begrundelsen).
  const { data, error } = await query.order("seq", { ascending: false }).limit(ACTIVITY_SCAN_LIMIT);
  if (error) throw new Error(`forum: could not list posts: ${error.message}`);

  const sortedRows = sortByActivityDesc(data || []);
  const afterFiltered = afterCursor == null
    ? sortedRows
    : sortedRows.filter((row) => isAfterActivityCursor(row, afterCursor));
  const hasMore = afterFiltered.length > pageSize;
  const pageRows = afterFiltered.slice(0, pageSize);

  let pinnedRows = [];
  if (afterCursor == null) {
    let pinnedQuery = supabase.from("forum_posts").select(POST_LIST_COLUMNS)
      .is("deleted_at", null)
      .eq("is_pinned", true);
    if (categoryFilter) pinnedQuery = pinnedQuery.eq("category", categoryFilter);
    const pinnedResult = await pinnedQuery.order("seq", { ascending: false }).limit(20);
    if (pinnedResult.error) throw new Error(`forum: could not list pinned posts: ${pinnedResult.error.message}`);
    // Pins ligger stadig ØVERST (egen blok, uafhængig af hovedlistens cursor);
    // internt sorteres de også efter aktivitet, samme recipe som hovedlisten.
    pinnedRows = sortByActivityDesc(pinnedResult.data || []);
  }

  const allRows = [...pinnedRows, ...pageRows];
  const { usersById, teamsById } = await resolveAuthors({ supabase, rows: allRows });

  const postIds = allRows.map((r) => r.id);
  let pollPostIds = new Set();
  if (postIds.length) {
    const { data: pollRows, error: pollError } = await supabase
      .from("forum_poll_options")
      .select("post_id")
      .in("post_id", postIds)
      .limit(postIds.length * FORUM_POLL_MAX_OPTIONS);
    if (pollError) throw new Error(`forum: could not resolve polls: ${pollError.message}`);
    pollPostIds = new Set((pollRows || []).map((r) => r.post_id));
  }

  const readsByPostId = await resolveThreadReads({ supabase, userId, postIds });

  return {
    pinned: pinnedRows.map((row) => shapeListPost(row, usersById, teamsById, pollPostIds, readsByPostId, userId)),
    items: pageRows.map((row) => shapeListPost(row, usersById, teamsById, pollPostIds, readsByPostId, userId)),
    next_cursor: hasMore ? encodeForumActivityCursor(pageRows[pageRows.length - 1]) : null,
    limit: pageSize,
  };
}

/**
 * GET /api/forum/posts/:id — opslag + alle svar (asc) + evt. poll med
 * aggregerede stemmetal og brugerens egen stemme. Individuelle stemmer
 * forlader ALDRIG backend — kun tal pr. option + requesterens eget valg.
 */
export async function getForumPost({ supabase, id, userId }) {
  if (!id) return { status: 400, body: { error: "Missing id", errorCode: "forum_missing_id" } };

  const { data: post, error: postError } = await supabase
    .from("forum_posts")
    .select("id, seq, created_at, user_id, team_id, category, title, body, is_pinned, reply_count, last_reply_at, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (postError) throw new Error(`forum: could not load post ${id}: ${postError.message}`);
  if (!post || post.deleted_at) {
    return { status: 404, body: { error: "Post not found", errorCode: "forum_post_not_found" } };
  }

  const { data: replyRows, error: replyError } = await supabase
    .from("forum_replies")
    .select("id, seq, created_at, post_id, user_id, team_id, body, quoted_reply_id")
    .eq("post_id", id)
    .is("deleted_at", null)
    .order("seq", { ascending: true })
    .limit(FORUM_REPLIES_LOAD_LIMIT);
  if (replyError) throw new Error(`forum: could not load replies for ${id}: ${replyError.message}`);
  const replies = replyRows || [];

  // #3517: citér-svar — de citerede rækker er ofte IKKE en del af `replies`
  // (soft-slettede svar filtreres væk ovenfor af `.is("deleted_at", null)"),
  // så klienten kan ikke selv rekonstruere citatet fra den aktuelle side.
  // Slås op batch-vist (bounded IN, samme mønster som resolveAuthors) og
  // shapes serverside — en slettet kilde lækker ALDRIG body/forfatter, kun
  // { id, removed: true }.
  const quotedReplyIds = [...new Set(replies.map((r) => r.quoted_reply_id).filter(Boolean))];
  let quotedById = new Map();
  if (quotedReplyIds.length) {
    const { data: quotedRows, error: quotedError } = await supabase
      .from("forum_replies")
      .select("id, user_id, team_id, body, deleted_at")
      .in("id", quotedReplyIds)
      .limit(quotedReplyIds.length);
    if (quotedError) throw new Error(`forum: could not resolve quoted replies for ${id}: ${quotedError.message}`);
    quotedById = new Map((quotedRows || []).map((r) => [r.id, r]));
  }

  const { data: optionRows, error: optionError } = await supabase
    .from("forum_poll_options")
    .select("id, post_id, idx, label")
    .eq("post_id", id)
    .order("idx", { ascending: true })
    .limit(FORUM_POLL_MAX_OPTIONS);
  if (optionError) throw new Error(`forum: could not load poll for ${id}: ${optionError.message}`);
  const options = optionRows || [];

  let poll = null;
  if (options.length) {
    const { data: voteRows, error: voteError } = await supabase
      .from("forum_poll_votes")
      .select("option_id, user_id")
      .eq("post_id", id)
      .limit(5000);
    if (voteError) throw new Error(`forum: could not load votes for ${id}: ${voteError.message}`);
    const votes = voteRows || [];
    const countsByOption = new Map();
    let myOptionId = null;
    for (const vote of votes) {
      countsByOption.set(vote.option_id, (countsByOption.get(vote.option_id) ?? 0) + 1);
      if (userId && vote.user_id === userId) myOptionId = vote.option_id;
    }
    poll = {
      total_votes: votes.length,
      my_option_id: myOptionId,
      options: options.map((o) => ({
        id: o.id,
        idx: o.idx,
        label: o.label,
        votes: countsByOption.get(o.id) ?? 0,
      })),
    };
  }

  const { usersById, teamsById } = await resolveAuthors({
    supabase,
    rows: [post, ...replies, ...quotedById.values()],
  });

  // #3517: opbaknings-tal — post og svar er to forskellige target_type'r,
  // hentet i to bounded kald (samme "det eksisterende trådkald"-krav som
  // resolveThreadReads: ingen N+1 pr. indlæg).
  //
  // #3451: samme kald slår også brugerens FORRIGE last_read_at op — dvs.
  // tidspunktet FØR dette besøg. Routen kalder markForumThreadRead som en
  // best-effort side-effekt EFTER at have afventet getForumPost færdig (se
  // routes/api.js), så denne læsning sker altid FØR den skrivning: værdien
  // herunder er aldrig "forurenet" af selve dette kalds egen markering.
  // Klienten bruger den til at beregne fold/scroll til første ulæste svar,
  // FØR den (visuelt) betragter tråden som læst.
  const [postReactions, replyReactions, readsByPostId] = await Promise.all([
    resolveReactionSummaries({ supabase, targetType: "post", targetIds: [id], userId }),
    resolveReactionSummaries({ supabase, targetType: "reply", targetIds: replies.map((r) => r.id), userId }),
    resolveThreadReads({ supabase, userId, postIds: [id] }),
  ]);
  const viewerLastReadAt = readsByPostId.get(id) ?? null;

  function shapeQuoted(quotedReplyId) {
    if (!quotedReplyId) return null;
    const quoted = quotedById.get(quotedReplyId);
    if (!quoted || quoted.deleted_at) return { id: quotedReplyId, removed: true };
    return {
      id: quoted.id,
      removed: false,
      excerpt: excerpt(quoted.body),
      author: shapeAuthor(quoted, usersById, teamsById),
    };
  }

  return {
    status: 200,
    body: {
      post: {
        id: post.id,
        seq: post.seq,
        created_at: post.created_at,
        category: post.category,
        title: post.title,
        body: post.body,
        is_pinned: post.is_pinned,
        reply_count: post.reply_count ?? 0,
        last_reply_at: post.last_reply_at,
        author: shapeAuthor(post, usersById, teamsById),
        // auth-UUID'er eksponeres aldrig til spiller-fladen — kun "er det mig".
        is_mine: Boolean(userId && post.user_id === userId),
        support_count: postReactions.counts.get(post.id) ?? 0,
        supported_by_me: postReactions.mine.has(post.id),
      },
      replies: replies.map((r) => ({
        id: r.id,
        seq: r.seq,
        created_at: r.created_at,
        body: r.body,
        author: shapeAuthor(r, usersById, teamsById),
        is_mine: Boolean(userId && r.user_id === userId),
        support_count: replyReactions.counts.get(r.id) ?? 0,
        supported_by_me: replyReactions.mine.has(r.id),
        quoted: shapeQuoted(r.quoted_reply_id),
      })),
      poll,
      // #3451: null ved første besøg (ingen forum_thread_reads-række endnu).
      viewer_last_read_at: viewerLastReadAt,
    },
  };
}

/**
 * POST-side-effekt af GET /api/forum/posts/:id (#3451): opdatér brugerens
 * "sidst læst"-tidsstempel for tråden. Upsert på (user_id, post_id), samme
 * mønster som voteForumPoll. Kaldes best-effort fra routen — en fejl her må
 * ALDRIG blokere selve trådvisningen (route fanger og captureException'er).
 */
export async function markForumThreadRead({ supabase, userId, postId, now = new Date() }) {
  if (!userId || !postId) return;
  const { error } = await supabase.from("forum_thread_reads").upsert(
    { user_id: userId, post_id: postId, last_read_at: now.toISOString() },
    { onConflict: "user_id,post_id" }
  );
  if (error) throw new Error(`forum: could not mark thread read for ${postId}: ${error.message}`);
}

/**
 * GET /api/forum/unread-status — billig kilde til nav-prikken (#3451): ÉT
 * kald fra klienten, to bounded queries på backend (posts + reads, samme
 * ikke-N+1-mønster som resolveAuthors) i stedet for én forespørgsel pr.
 * tråd. Stopper ved første ulæste tråd — behøver ikke tælle alle.
 */
export async function getForumUnreadStatus({ supabase, userId }) {
  if (!userId) return { has_unread: false };

  const { data: postRows, error } = await supabase
    .from("forum_posts")
    .select("id, seq, created_at, last_reply_at")
    .is("deleted_at", null)
    .order("seq", { ascending: false })
    .limit(UNREAD_STATUS_SCAN_LIMIT);
  if (error) throw new Error(`forum: could not load posts for unread-status: ${error.message}`);
  const rows = postRows || [];
  if (!rows.length) return { has_unread: false };

  const readsByPostId = await resolveThreadReads({ supabase, userId, postIds: rows.map((r) => r.id) });
  const hasUnread = rows.some((row) => isThreadUnread(row, readsByPostId.get(row.id)));
  return { has_unread: hasUnread };
}

/**
 * PATCH /api/forum/threads/read-all (#3451 — spillerønske 26/8: "a button,
 * like in the inbox, where you can mark all threads as read"). Samme
 * bounded-scan-grænse som getForumUnreadStatus (én kilde til "alle tråde"),
 * men i modsætning til den stopper vi IKKE ved første ulæste — hver tråd skal
 * have sin egen (bruger, tråd)-række opdateret. Bulk-upsert i ét kald, samme
 * onConflict-mønster som markForumThreadRead. Idempotent: kør den to gange i
 * træk og resultatet er det samme (last_read_at rykker bare frem).
 */
export async function markAllForumThreadsRead({ supabase, userId, now = new Date() }) {
  if (!userId) return { status: 401, body: { error: "Missing user", errorCode: "forum_missing_user" } };

  const { data: postRows, error } = await supabase
    .from("forum_posts")
    .select("id")
    .is("deleted_at", null)
    .limit(UNREAD_STATUS_SCAN_LIMIT);
  if (error) throw new Error(`forum: could not list posts for mark-all-read: ${error.message}`);
  const postIds = (postRows || []).map((r) => r.id);
  if (!postIds.length) return { status: 200, body: { ok: true, marked: 0 } };

  const nowIso = now.toISOString();
  const { error: upsertError } = await supabase.from("forum_thread_reads").upsert(
    postIds.map((postId) => ({ user_id: userId, post_id: postId, last_read_at: nowIso })),
    { onConflict: "user_id,post_id" }
  );
  if (upsertError) throw new Error(`forum: could not mark all threads read: ${upsertError.message}`);

  return { status: 200, body: { ok: true, marked: postIds.length } };
}

function validatePollOptions(pollOptions) {
  if (!Array.isArray(pollOptions)) return null;
  const labels = pollOptions
    .map((o) => (typeof o === "string" ? o.trim() : ""))
    .filter((label) => label.length > 0);
  if (labels.length < FORUM_POLL_MIN_OPTIONS || labels.length > FORUM_POLL_MAX_OPTIONS) return null;
  if (labels.some((label) => label.length > FORUM_POLL_OPTION_MAX_LENGTH)) return null;
  return labels;
}

/**
 * POST /api/forum/posts — nyt opslag. Polls er EJER-funktionalitet (plan 6/8):
 * kun admin må vedhæfte afstemning; en almindelig spiller med poll_options i
 * payloaden får 403, ikke et opslag uden poll (stille scope-klip skjuler fejl).
 */
export async function createForumPost({
  supabase,
  userId,
  teamId = null,
  isAdmin = false,
  category,
  title,
  body,
  pollOptions = null,
  now = new Date(),
}) {
  if (!isValidForumCategory(category)) {
    return { status: 400, body: { error: "Invalid category", errorCode: "forum_invalid_category" } };
  }
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (!trimmedTitle) {
    return { status: 400, body: { error: "Title is required", errorCode: "forum_title_required" } };
  }
  if (trimmedTitle.length > FORUM_TITLE_MAX_LENGTH) {
    return { status: 400, body: { error: "Title is too long", errorCode: "forum_title_too_long" } };
  }
  const trimmedBody = typeof body === "string" ? body.trim() : "";
  if (!trimmedBody) {
    return { status: 400, body: { error: "Body is required", errorCode: "forum_body_required" } };
  }
  if (trimmedBody.length > FORUM_BODY_MAX_LENGTH) {
    return { status: 400, body: { error: "Body is too long", errorCode: "forum_body_too_long" } };
  }

  const wantsPoll = pollOptions != null && (!Array.isArray(pollOptions) || pollOptions.length > 0);
  let pollLabels = null;
  if (wantsPoll) {
    if (!isAdmin) {
      return { status: 403, body: { error: "Only the admin can attach polls", errorCode: "forum_poll_admin_only" } };
    }
    pollLabels = validatePollOptions(pollOptions);
    if (!pollLabels) {
      return { status: 400, body: { error: "Invalid poll options", errorCode: "forum_poll_invalid_options" } };
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("forum_posts")
    .insert({
      user_id: userId,
      team_id: teamId,
      category,
      title: trimmedTitle,
      body: trimmedBody,
      created_at: now.toISOString(),
      // DB-defaults gentaget eksplicit: filtre som .is("deleted_at", null) og
      // .eq("is_pinned", false) skal også matche i test-fakes uden defaults.
      is_pinned: false,
      reply_count: 0,
      last_reply_at: null,
      deleted_at: null,
    })
    .select("id, seq")
    .single();
  if (insertError) throw new Error(`forum: could not create post: ${insertError.message}`);

  if (pollLabels) {
    const { error: optionError } = await supabase.from("forum_poll_options").insert(
      pollLabels.map((label, idx) => ({ post_id: inserted.id, idx, label }))
    );
    if (optionError) {
      // Halvt opslag (poll lovet, poll mangler) er værre end intet opslag —
      // best-effort oprydning før fejlen propageres til 500. En fejlet cleanup
      // må ikke skygge for rod-fejlen; den føjes til fejlbeskeden i stedet.
      const { error: cleanupError } = await supabase.from("forum_posts").delete().eq("id", inserted.id);
      throw new Error(
        `forum: could not create poll options: ${optionError.message}` +
        (cleanupError ? ` (post cleanup also failed: ${cleanupError.message})` : "")
      );
    }
  }

  return { status: 200, body: { ok: true, id: inserted.id, seq: inserted.seq } };
}

/** Genberegn reply_count (ekskl. slettede) — selvhelende frem for +1/-1. */
async function recountReplies({ supabase, postId, now = null }) {
  const { data: idRows, error } = await supabase
    .from("forum_replies")
    .select("id")
    .eq("post_id", postId)
    .is("deleted_at", null)
    .limit(REPLY_RECOUNT_LIMIT);
  if (error) throw new Error(`forum: could not recount replies for ${postId}: ${error.message}`);
  const patch = { reply_count: (idRows || []).length };
  if (now) patch.last_reply_at = now.toISOString();
  const { error: updateError } = await supabase.from("forum_posts").update(patch).eq("id", postId);
  if (updateError) throw new Error(`forum: could not update reply count for ${postId}: ${updateError.message}`);
  return patch.reply_count;
}

/**
 * POST /api/forum/posts/:id/replies — nyt svar. Returnerer post-titel/kategori
 * til routens Discord-ping (#3201), så routen ikke skal lave et ekstra opslag.
 *
 * #3517 · `quotedReplyId` (valgfri): et svar kan citere et andet svar — men
 * KUN i samme tråd (afvises ellers med 400, ikke et tavst-ignoreret felt).
 * `quotedUserId` returneres til routen så den kan notificere den citerede
 * (samme forum_thread_reply-dedupe som trådejer-notifikationen, aldrig ved
 * citat af egen kommentar — se notifyForumThreadReply's own_reply-guard).
 */
export async function createForumReply({ supabase, postId, userId, teamId = null, body, quotedReplyId = null, now = new Date() }) {
  if (!postId) return { status: 400, body: { error: "Missing id", errorCode: "forum_missing_id" } };
  const trimmedBody = typeof body === "string" ? body.trim() : "";
  if (!trimmedBody) {
    return { status: 400, body: { error: "Body is required", errorCode: "forum_body_required" } };
  }
  if (trimmedBody.length > FORUM_BODY_MAX_LENGTH) {
    return { status: 400, body: { error: "Body is too long", errorCode: "forum_body_too_long" } };
  }

  const { data: post, error: postError } = await supabase
    .from("forum_posts")
    .select("id, title, category, user_id, deleted_at")
    .eq("id", postId)
    .maybeSingle();
  if (postError) throw new Error(`forum: could not load post ${postId}: ${postError.message}`);
  if (!post || post.deleted_at) {
    return { status: 404, body: { error: "Post not found", errorCode: "forum_post_not_found" } };
  }

  let quotedUserId = null;
  if (quotedReplyId) {
    const { data: quoted, error: quotedError } = await supabase
      .from("forum_replies")
      .select("id, post_id, user_id")
      .eq("id", quotedReplyId)
      .maybeSingle();
    if (quotedError) throw new Error(`forum: could not load quoted reply ${quotedReplyId}: ${quotedError.message}`);
    // Citat på tværs af tråde afvises — ikke bare tavst droppet, en klient der
    // sender en fremmed reply-id skal se en 400, ikke et svar uden citat.
    if (!quoted || quoted.post_id !== postId) {
      return { status: 400, body: { error: "Invalid quoted reply", errorCode: "forum_invalid_quote" } };
    }
    quotedUserId = quoted.user_id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("forum_replies")
    .insert({
      post_id: postId,
      user_id: userId,
      team_id: teamId,
      body: trimmedBody,
      quoted_reply_id: quotedReplyId || null,
      created_at: now.toISOString(),
      deleted_at: null,
    })
    .select("id, seq")
    .single();
  if (insertError) throw new Error(`forum: could not create reply: ${insertError.message}`);

  await recountReplies({ supabase, postId, now });

  return {
    status: 200,
    body: { ok: true, id: inserted.id, seq: inserted.seq },
    // `post.user_id` (trådejeren) forlader ALDRIG body — kun brugt server-side
    // i api.js's #3517-notifikationskald (og Discord-pinget).
    post: { id: post.id, title: post.title, category: post.category, user_id: post.user_id },
    quotedUserId,
  };
}

/**
 * POST /api/forum/posts/:id/vote — single choice; genafstemning = upsert på
 * (post_id, user_id). option valideres mod post_id, så en klient ikke kan
 * stemme en fremmed options-id ind på et andet opslag.
 */
export async function voteForumPoll({ supabase, postId, userId, optionId, now = new Date() }) {
  if (!postId || !optionId) {
    return { status: 400, body: { error: "Missing id", errorCode: "forum_missing_id" } };
  }

  const { data: post, error: postError } = await supabase
    .from("forum_posts")
    .select("id, deleted_at")
    .eq("id", postId)
    .maybeSingle();
  if (postError) throw new Error(`forum: could not load post ${postId}: ${postError.message}`);
  if (!post || post.deleted_at) {
    return { status: 404, body: { error: "Post not found", errorCode: "forum_post_not_found" } };
  }

  const { data: option, error: optionError } = await supabase
    .from("forum_poll_options")
    .select("id, post_id")
    .eq("id", optionId)
    .eq("post_id", postId)
    .maybeSingle();
  if (optionError) throw new Error(`forum: could not load option ${optionId}: ${optionError.message}`);
  if (!option) {
    return { status: 404, body: { error: "Poll option not found", errorCode: "forum_poll_option_not_found" } };
  }

  const { error: upsertError } = await supabase.from("forum_poll_votes").upsert(
    { post_id: postId, user_id: userId, option_id: optionId, created_at: now.toISOString() },
    { onConflict: "post_id,user_id" }
  );
  if (upsertError) throw new Error(`forum: could not save vote: ${upsertError.message}`);

  return { status: 200, body: { ok: true } };
}

/**
 * POST /api/forum/report — rapportér opslag/svar. Idempotent pr. (reporter,
 * target): gen-rapportering opdaterer bare reason i stedet for at fejle på
 * UNIQUE-constrainten. `already` fortæller routen om Discord-pinget skal
 * springes over (ingen ping-spam ved gentagne klik). #3452: `reason` er
 * PÅKRÆVET (min. FORUM_REPORT_REASON_MIN_LENGTH tegn) — ejer-direktiv 6/8,
 * "gider ikke se rapporter uden grund".
 */
export async function reportForumContent({ supabase, reporterUserId, targetType, targetId, reason = null, now = new Date() }) {
  if (targetType !== "post" && targetType !== "reply") {
    return { status: 400, body: { error: "Invalid target type", errorCode: "forum_invalid_target_type" } };
  }
  if (!targetId || typeof targetId !== "string") {
    return { status: 400, body: { error: "Missing target id", errorCode: "forum_missing_id" } };
  }
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  // #3452: begrundelse er obligatorisk (ejer-direktiv 6/8) — 400 med et
  // dedikeret errorCode pr. fejlklasse, samme mønster som titel/body ovenfor.
  if (!trimmedReason) {
    return { status: 400, body: { error: "A reason is required", errorCode: "forum_reason_required" } };
  }
  if (trimmedReason.length < FORUM_REPORT_REASON_MIN_LENGTH) {
    return { status: 400, body: { error: "The reason is too short", errorCode: "forum_reason_too_short" } };
  }
  if (trimmedReason.length > FORUM_REPORT_REASON_MAX_LENGTH) {
    return { status: 400, body: { error: "Reason is too long", errorCode: "forum_reason_too_long" } };
  }

  const table = targetType === "post" ? "forum_posts" : "forum_replies";
  const { data: target, error: targetError } = await supabase
    .from(table)
    .select("id, deleted_at")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) throw new Error(`forum: could not load report target: ${targetError.message}`);
  if (!target || target.deleted_at) {
    return { status: 404, body: { error: "Target not found", errorCode: "forum_target_not_found" } };
  }

  const { data: existing, error: existingError } = await supabase
    .from("forum_reports")
    .select("id")
    .eq("reporter_user_id", reporterUserId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();
  if (existingError) throw new Error(`forum: could not check existing report: ${existingError.message}`);

  const { error: upsertError } = await supabase.from("forum_reports").upsert(
    {
      reporter_user_id: reporterUserId,
      target_type: targetType,
      target_id: targetId,
      reason: trimmedReason || null,
      ...(existing ? {} : { created_at: now.toISOString() }),
    },
    { onConflict: "reporter_user_id,target_type,target_id" }
  );
  if (upsertError) throw new Error(`forum: could not save report: ${upsertError.message}`);

  return { status: 200, body: { ok: true, already: Boolean(existing) } };
}

/**
 * POST /api/forum/react — opbakning (#3517, ejer-designvalg 25/8: ÉN
 * tæller, ikke en emoji-palet). Toggle pr. (bruger, mål): findes rækken
 * allerede fjernes den (opbakning trukket tilbage), ellers oprettes den.
 * Find-så-slet/insert i stedet for upsert, fordi vi netop skal kunne FJERNE
 * opbakningen igen — en upsert ville kun kunne sætte den, aldrig toggle den.
 * Ingen notifikation ved opbakning (v1-scope, ejer-direktiv).
 */
export async function toggleForumReaction({ supabase, targetType, targetId, userId, now = new Date() }) {
  if (targetType !== "post" && targetType !== "reply") {
    return { status: 400, body: { error: "Invalid target type", errorCode: "forum_invalid_reaction_target_type" } };
  }
  if (!targetId || typeof targetId !== "string") {
    return { status: 400, body: { error: "Missing target id", errorCode: "forum_missing_id" } };
  }

  const table = targetType === "post" ? "forum_posts" : "forum_replies";
  const { data: target, error: targetError } = await supabase
    .from(table)
    .select("id, deleted_at")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) throw new Error(`forum: could not load reaction target: ${targetError.message}`);
  if (!target || target.deleted_at) {
    // Egen errorCode (ikke forum_target_not_found — den tekst er skrevet til
    // rapportér-flowet, "det rapporterede indhold", som ville være misvisende
    // her).
    return { status: 404, body: { error: "Target not found", errorCode: "forum_reaction_target_not_found" } };
  }

  const { data: existing, error: existingError } = await supabase
    .from("forum_reactions")
    .select("user_id")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw new Error(`forum: could not check existing reaction: ${existingError.message}`);

  if (existing) {
    const { error: deleteError } = await supabase
      .from("forum_reactions")
      .delete()
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .eq("user_id", userId);
    if (deleteError) throw new Error(`forum: could not remove reaction: ${deleteError.message}`);
  } else {
    // Idempotent mod race (to hurtige klik): ignoreDuplicates gør et dobbelt
    // "tilføj"-kald selvhelende i stedet for at fejle på PK'en.
    const { error: insertError } = await supabase.from("forum_reactions").upsert(
      { target_type: targetType, target_id: targetId, user_id: userId, created_at: now.toISOString() },
      { onConflict: "target_type,target_id,user_id", ignoreDuplicates: true }
    );
    if (insertError) throw new Error(`forum: could not add reaction: ${insertError.message}`);
  }

  const { counts } = await resolveReactionSummaries({ supabase, targetType, targetIds: [targetId], userId });
  return { status: 200, body: { ok: true, active: !existing, support_count: counts.get(targetId) ?? 0 } };
}

// ── Admin (#3201: rapport-indbakke + moderation) ─────────────────────────────

/**
 * GET /api/admin/forum/reports — keyset-pagineret rapport-indbakke.
 * Target-indhold (titel/uddrag + slette-state) opløses batch-vist, så admin
 * kan triagere uden at åbne hvert opslag.
 */
export async function listForumReports({ supabase, status = null, limit, cursor }) {
  const pageSize = parseForumLimit(limit);
  const afterCursor = parseForumCursor(cursor);

  let query = supabase.from("forum_reports")
    .select("id, seq, created_at, reporter_user_id, target_type, target_id, reason, status, resolved_at");
  if (status && FORUM_REPORT_STATUSES.includes(status)) query = query.eq("status", status);
  if (afterCursor != null) query = query.lt("seq", afterCursor);

  const { data, error } = await query.order("seq", { ascending: false }).limit(pageSize + 1);
  if (error) throw new Error(`forum: could not list reports: ${error.message}`);

  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  const postIds = [...new Set(pageRows.filter((r) => r.target_type === "post").map((r) => r.target_id))];
  const replyIds = [...new Set(pageRows.filter((r) => r.target_type === "reply").map((r) => r.target_id))];

  const [postsResult, repliesResult, { usersById }] = await Promise.all([
    postIds.length
      ? supabase.from("forum_posts").select("id, title, deleted_at").in("id", postIds).limit(postIds.length)
      : Promise.resolve({ data: [], error: null }),
    replyIds.length
      ? supabase.from("forum_replies").select("id, post_id, body, deleted_at").in("id", replyIds).limit(replyIds.length)
      : Promise.resolve({ data: [], error: null }),
    resolveAuthors({ supabase, rows: pageRows.map((r) => ({ user_id: r.reporter_user_id, team_id: null })) }),
  ]);
  if (postsResult.error) throw new Error(`forum: could not resolve reported posts: ${postsResult.error.message}`);
  if (repliesResult.error) throw new Error(`forum: could not resolve reported replies: ${repliesResult.error.message}`);

  const postsById = new Map((postsResult.data || []).map((p) => [p.id, p]));
  const repliesById = new Map((repliesResult.data || []).map((r) => [r.id, r]));

  return {
    items: pageRows.map((row) => {
      const post = row.target_type === "post" ? postsById.get(row.target_id) : null;
      const reply = row.target_type === "reply" ? repliesById.get(row.target_id) : null;
      const reporter = usersById.get(row.reporter_user_id) || null;
      return {
        id: row.id,
        seq: row.seq,
        created_at: row.created_at,
        target_type: row.target_type,
        target_id: row.target_id,
        reason: row.reason,
        status: row.status,
        resolved_at: row.resolved_at,
        reporter_username: reporter?.username ?? null,
        target: post
          ? { post_id: post.id, excerpt: excerpt(post.title), deleted: Boolean(post.deleted_at) }
          : reply
            ? { post_id: reply.post_id, excerpt: excerpt(reply.body), deleted: Boolean(reply.deleted_at) }
            : { post_id: null, excerpt: null, deleted: true },
      };
    }),
    next_cursor: hasMore ? pageRows[pageRows.length - 1].seq : null,
    limit: pageSize,
  };
}

/** PATCH /api/admin/forum/reports/:id/resolve */
export async function resolveForumReport({ supabase, id, adminUserId, now = new Date() }) {
  if (!id) return { status: 400, body: { error: "Missing id", errorCode: "forum_missing_id" } };
  const { data, error } = await supabase
    .from("forum_reports")
    .update({ status: "resolved", resolved_at: now.toISOString(), resolved_by: adminUserId || null })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();
  if (error) throw new Error(`forum: could not resolve report ${id}: ${error.message}`);
  if (!data) return { status: 404, body: { error: "Report not found", errorCode: "forum_report_not_found" } };
  return { status: 200, body: { ok: true, id: data.id, status: data.status } };
}

/** PATCH /api/admin/forum/posts/:id/pin — pin/unpin (ejer-opslag øverst). */
export async function setForumPostPinned({ supabase, id, pinned }) {
  if (!id) return { status: 400, body: { error: "Missing id", errorCode: "forum_missing_id" } };
  if (typeof pinned !== "boolean") {
    return { status: 400, body: { error: "Invalid pinned value", errorCode: "forum_invalid_pinned" } };
  }
  const { data, error } = await supabase
    .from("forum_posts")
    .update({ is_pinned: pinned })
    .eq("id", id)
    .select("id, is_pinned")
    .maybeSingle();
  if (error) throw new Error(`forum: could not pin post ${id}: ${error.message}`);
  if (!data) return { status: 404, body: { error: "Post not found", errorCode: "forum_post_not_found" } };
  return { status: 200, body: { ok: true, id: data.id, is_pinned: data.is_pinned } };
}

/** Auto-resolver åbne rapporter på et target der netop er modereret væk. */
async function resolveReportsForTarget({ supabase, targetType, targetId, adminUserId, now }) {
  const { error } = await supabase
    .from("forum_reports")
    .update({ status: "resolved", resolved_at: now.toISOString(), resolved_by: adminUserId || null })
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("status", "new");
  if (error) throw new Error(`forum: could not resolve reports for ${targetType} ${targetId}: ${error.message}`);
}

/**
 * DELETE /api/admin/forum/posts/:id — soft delete. Svar under opslaget
 * forbliver i tabellen men er utilgængelige (detail-endpointet 404'er på
 * slettede posts). Åbne rapporter på opslaget auto-resolves.
 */
export async function deleteForumPost({ supabase, id, adminUserId, now = new Date() }) {
  if (!id) return { status: 400, body: { error: "Missing id", errorCode: "forum_missing_id" } };
  const { data, error } = await supabase
    .from("forum_posts")
    .update({ deleted_at: now.toISOString(), deleted_by: adminUserId || null })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`forum: could not delete post ${id}: ${error.message}`);
  if (!data) return { status: 404, body: { error: "Post not found", errorCode: "forum_post_not_found" } };
  await resolveReportsForTarget({ supabase, targetType: "post", targetId: id, adminUserId, now });
  return { status: 200, body: { ok: true, id: data.id } };
}

/** DELETE /api/admin/forum/replies/:id — soft delete + recount af posten. */
export async function deleteForumReply({ supabase, id, adminUserId, now = new Date() }) {
  if (!id) return { status: 400, body: { error: "Missing id", errorCode: "forum_missing_id" } };
  const { data, error } = await supabase
    .from("forum_replies")
    .update({ deleted_at: now.toISOString(), deleted_by: adminUserId || null })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, post_id")
    .maybeSingle();
  if (error) throw new Error(`forum: could not delete reply ${id}: ${error.message}`);
  if (!data) return { status: 404, body: { error: "Reply not found", errorCode: "forum_reply_not_found" } };
  await recountReplies({ supabase, postId: data.post_id });
  await resolveReportsForTarget({ supabase, targetType: "reply", targetId: id, adminUserId, now });
  return { status: 200, body: { ok: true, id: data.id } };
}

/**
 * Antal åbne rapporter til admin-badge (#3201). Bounded id-select frem for
 * head-count: forum_reports med status new er pr. definition en lille mængde
 * (admin arbejder den ned), og fakeSupabase understøtter ikke head-counts.
 */
export async function getForumReportCounts({ supabase }) {
  const { data, error } = await supabase
    .from("forum_reports")
    .select("id")
    .eq("status", "new")
    .limit(REPLY_RECOUNT_LIMIT);
  if (error) throw new Error(`forum: could not count reports: ${error.message}`);
  return { new: (data || []).length };
}
