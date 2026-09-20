// #2842 — admin-indbakke for spillerfeedback (læs + triagér + besvar).
//
// #2602 byggede skrive-stien og stoppede der: player_feedback havde RLS
// ENABLED uden policies, nul .select() i hele repoet og ingen admin-UI. En
// spiller der skrev fik hverken kvittering eller svar. Denne fil er læse- og
// svar-siden af den sløjfe.
//
// Handler-logikken bor her (ikke inline i api.js) af samme grund som
// aluntaWebhook.js / teamPublicProfileHandlers.js: api.js kræver en live
// Supabase-klient og kan ikke unit-testes direkte, mens rene handlere kan
// køres mod createFakeSupabase.
//
// SIKKERHED: alt herinde forudsætter en service-role-klient BAG requireAdmin.
// player_feedback er default-deny for anon/authenticated (ingen RLS-policies
// + eksplicit REVOKE i database/2026-07-26-player-feedback-inbox.sql) fordi
// fritekst fra spillere kan indeholde personoplysninger. Kald ALDRIG disse
// funktioner fra en route uden requireAdmin.
//
// YDELSE: paginering er keyset på `seq` (monotont bigint), aldrig OFFSET.
// Ingen af queries herinde er ubegrænsede — hver select har enten .limit()
// eller er et head-count uden rækker over wire.

import { notifyUser as defaultNotifyUser } from "./notificationService.js";

export const FEEDBACK_STATUSES = ["new", "in_progress", "closed"];
export const FEEDBACK_INBOX_DEFAULT_LIMIT = 25;
export const FEEDBACK_INBOX_MAX_LIMIT = 100;
export const FEEDBACK_REPLY_MAX_LENGTH = 4000;

// #4346 — "Report for review" på en enkelt gennemført handel (transferhistorik).
// Deler player_feedback-kanalen (samme tabel, samme admin-indbakke, samme
// Discord-mirror) med kontaktformularens generiske 'fairplay'-kategori, men
// bærer strukturerede felter i metadata så fair-play-review (#3138) får
// transfer_id + begge hold-id'er gratis i stedet for at skulle rekonstruere
// dem fra fritekst.
export const TRADE_REPORT_CATEGORY = "fairplay";
export const TRADE_REPORT_TYPES = ["auction", "transfer", "swap"];
export const TRADE_REPORT_MESSAGE_MIN_LENGTH = 10;
export const TRADE_REPORT_MESSAGE_MAX_LENGTH = 1000;

const TRADE_REPORT_TABLE_BY_TYPE = {
  auction: "auctions",
  transfer: "transfer_offers",
  swap: "swap_offers",
};

// PUBLIC_OFFER_STATUSES matcher hvad TeamTransferHistoryTab rent faktisk
// viser (teamTransferHistory.js re-eksporterer den fra riderHistory.js) — en
// spiller kan kun rapportere en handel hun kan SE. Importeres ikke direkte
// (ville trække riderHistory.js's Supabase-uafhængige, men alligevel unødvendige,
// kobling ind) — samme to statusser gentaget bevidst lokalt, ligesom
// teamTransferHistory.js selv re-eksporterer dem frem for at duplikere listen
// et tredje sted ville have gjort.
const TRADE_REPORT_OFFER_STATUSES = ["accepted", "window_pending"];

/**
 * Slår handlens to hold op FRA DATABASEN (aldrig fra klienten) og afgør om
 * den overhovedet er en rapporterbar, gennemført to-holds-handel. Returnerer
 * null hvis handlen ikke findes/ikke er afsluttet/ikke har en rigtig modpart
 * (fx en no_sale-auktion eller et garanteret AI-salg uden current_bidder_id —
 * samme udelukkelse som frontend allerede laver, se lib/tradeReport.ts).
 */
function resolveTradeParties(transferType, row) {
  if (!row) return null;
  if (transferType === "auction") {
    if (row.status !== "completed" || !row.current_bidder_id) return null;
    return { teamA: row.seller_team_id, teamB: row.current_bidder_id };
  }
  if (transferType === "transfer") {
    if (!TRADE_REPORT_OFFER_STATUSES.includes(row.status)) return null;
    return { teamA: row.seller_team_id, teamB: row.buyer_team_id };
  }
  if (transferType === "swap") {
    if (!TRADE_REPORT_OFFER_STATUSES.includes(row.status)) return null;
    return { teamA: row.proposing_team_id, teamB: row.receiving_team_id };
  }
  return null;
}

// Kolonner indbakken læser. `message` er med (det er hele pointen), men
// user_agent udelades bevidst fra listen: den er ren diagnostik, den er den
// mest fingerprint-agtige kolonne i tabellen, og den fylder listen uden at
// hjælpe triagen. Den kan hentes på detalje-niveau hvis en bug kræver det.
// `metadata` er med af #5284 — det er den eneste vej til at opløse en
// fairplay-rapports handel (transfer_type/transfer_id/team_a_id/team_b_id,
// se submitTradeReport). null for alle andre kategorier.
const INBOX_COLUMNS =
  "id, seq, created_at, user_id, team_id, category, status, message, metadata, page_path, viewport, reply_message, replied_at";

// Kolonner pr. handelstabel — netop de felter resolveTradeParties()/
// buildTradeObject() bruger, ikke `select("*")`, så et batch-opslag på en
// hel side rapporter aldrig trækker mere over wire end nødvendigt.
const TRADE_TABLE_SELECT_COLUMNS = {
  auction: "id, rider_id, seller_team_id, current_bidder_id, current_price, status, actual_end, created_at",
  transfer: "id, rider_id, seller_team_id, buyer_team_id, offer_amount, counter_amount, status, updated_at",
  swap: "id, offered_rider_id, requested_rider_id, proposing_team_id, receiving_team_id, cash_adjustment, counter_cash, status, updated_at",
};

/**
 * Klem limit ind i [1, MAX]. Ugyldigt/manglende → default.
 * En manglende clamp her er forskellen på en pagineret indbakke og et
 * ubegrænset table-scan som en klient selv kan bede om.
 */
export function parseInboxLimit(raw) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return FEEDBACK_INBOX_DEFAULT_LIMIT;
  return Math.min(n, FEEDBACK_INBOX_MAX_LIMIT);
}

/**
 * Cursor er `seq` for den SIDSTE række på forrige side. Kun positive heltal
 * accepteres; alt andet behandles som "ingen cursor" (= første side) i stedet
 * for at kaste, så en manipuleret query-param aldrig kan give en 500.
 */
export function parseInboxCursor(raw) {
  if (raw == null || raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function isValidFeedbackStatus(status) {
  return FEEDBACK_STATUSES.includes(status);
}

function shapeItem(row, usersById, teamsById, tradeByRowId = null) {
  const user = usersById.get(row.user_id) || null;
  const team = row.team_id ? teamsById.get(row.team_id) || null : null;
  const item = {
    id: row.id,
    seq: row.seq,
    created_at: row.created_at,
    category: row.category,
    status: row.status,
    message: row.message,
    page_path: row.page_path,
    viewport: row.viewport,
    reply_message: row.reply_message,
    replied_at: row.replied_at,
    user: user ? { id: user.id, username: user.username, email: user.email } : { id: row.user_id, username: null, email: null },
    team: team ? { id: team.id, name: team.name } : null,
  };
  // #5284: kun fairplay-rapporter bærer et trade-felt — andre kategorier har
  // ingen metadata-semantik og skal forblive helt uændrede (bagudkompat med
  // eksisterende klienter der aldrig forventer feltet).
  if (row.category === TRADE_REPORT_CATEGORY) {
    const info = tradeByRowId?.get(row.id);
    item.trade = info ? info.trade : null;
    item.trade_missing = info ? info.trade_missing : false;
  }
  return item;
}

function buildTradeRider(rider) {
  if (!rider) return null;
  return {
    id: rider.id,
    firstname: rider.firstname ?? null,
    lastname: rider.lastname ?? null,
    market_value: typeof rider.market_value === "number" ? rider.market_value : null,
  };
}

function buildTradeTeam(team) {
  return team ? { id: team.id, name: team.name } : null;
}

// Ratio = pris / rytterens nuværende markedsværdi (fx 1.35 = solgt for 135%
// af markedsværdien). null når enten prisen eller markedsværdien mangler —
// giver aldrig en misvisende 0 eller Infinity.
function computeMarketValueRatio(price, marketValue) {
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  if (typeof marketValue !== "number" || !(marketValue > 0)) return null;
  return Math.round((price / marketValue) * 100) / 100;
}

/**
 * Bygger ét opløst trade-objekt ud fra en allerede-fundet handel-række +
 * dens verificerede parter (resolveTradeParties). Delt mellem den pagineret
 * batch-opløsning (listFeedbackInbox) og enkelt-opslaget der fodrer
 * Discord-mirroret (resolveTradeForReport) — samme felt-kontrakt begge steder.
 */
function buildTradeObject({ transferType, tradeRow, parties, ridersById, teamsById, reportingTeam }) {
  let rider = null;
  let riders = null;
  let price = null;
  let tradeDate = null;

  if (transferType === "auction") {
    rider = buildTradeRider(ridersById.get(tradeRow.rider_id));
    price = typeof tradeRow.current_price === "number" ? tradeRow.current_price : null;
    tradeDate = tradeRow.actual_end || tradeRow.created_at || null;
  } else if (transferType === "transfer") {
    rider = buildTradeRider(ridersById.get(tradeRow.rider_id));
    price = tradeRow.counter_amount ?? tradeRow.offer_amount ?? null;
    tradeDate = tradeRow.updated_at || null;
  } else if (transferType === "swap") {
    // Swap har to ryttere og ingen entydig "pris" — kontantjusteringen kan
    // være 0 (ren bytte). Ratio giver ikke mening på tværs af to ryttere med
    // forskellig markedsværdi, så den udelades bevidst for swap.
    riders = {
      offered: buildTradeRider(ridersById.get(tradeRow.offered_rider_id)),
      requested: buildTradeRider(ridersById.get(tradeRow.requested_rider_id)),
    };
    price = tradeRow.counter_cash ?? tradeRow.cash_adjustment ?? 0;
    tradeDate = tradeRow.updated_at || null;
  }

  return {
    type: transferType,
    team_a: buildTradeTeam(teamsById.get(parties.teamA)),
    team_b: buildTradeTeam(teamsById.get(parties.teamB)),
    rider,
    riders,
    price,
    market_value_ratio: rider ? computeMarketValueRatio(price, rider.market_value) : null,
    trade_date: tradeDate,
    reporting_team: buildTradeTeam(reportingTeam),
  };
}

/**
 * Batch-opløser trade-objekter for EN sides fairplay-rapporter med metadata.
 * Maks 5 ekstra opslag pr. side uanset hvor mange rapporter siden indeholder
 * (ét .in() pr. handelstype + ét for ryttere + ét for evt. manglende hold) —
 * aldrig ét opslag pr. række. `teamsById` udvides in-place med hold der ikke
 * allerede var hentet af listFeedbackInbox's egen afsender/hold-opslag.
 *
 * En rapport hvor metadata peger på en handel der ikke længere findes/ikke
 * længere er en gyldig to-holds-handel (slettet/annulleret) giver
 * trade:null + trade_missing:true — aldrig en kastet fejl.
 */
async function resolveTradeInfoForPage(supabase, pageRows, teamsById) {
  const tradeByRowId = new Map();
  const fairplayRows = pageRows.filter(
    (row) =>
      row.category === TRADE_REPORT_CATEGORY &&
      row.metadata &&
      TRADE_REPORT_TYPES.includes(row.metadata.transfer_type) &&
      row.metadata.transfer_id
  );
  if (!fairplayRows.length) return tradeByRowId;

  const idsByType = { auction: [], transfer: [], swap: [] };
  for (const row of fairplayRows) idsByType[row.metadata.transfer_type].push(row.metadata.transfer_id);
  for (const type of Object.keys(idsByType)) idsByType[type] = [...new Set(idsByType[type])];

  const types = Object.keys(idsByType).filter((type) => idsByType[type].length);
  const tradeResults = await Promise.all(
    types.map((type) =>
      supabase
        .from(TRADE_REPORT_TABLE_BY_TYPE[type])
        .select(TRADE_TABLE_SELECT_COLUMNS[type])
        .in("id", idsByType[type])
        .limit(idsByType[type].length)
    )
  );
  const rowsByType = {};
  types.forEach((type, i) => {
    const { data, error } = tradeResults[i];
    if (error) throw new Error(`feedbackInbox: could not resolve ${type} trades: ${error.message}`);
    rowsByType[type] = new Map((data || []).map((r) => [r.id, r]));
  });

  const riderIds = new Set();
  const teamIds = new Set();
  const resolvedByRowId = new Map();
  for (const row of fairplayRows) {
    const transferType = row.metadata.transfer_type;
    const tradeRow = rowsByType[transferType]?.get(row.metadata.transfer_id) || null;
    const parties = tradeRow ? resolveTradeParties(transferType, tradeRow) : null;
    resolvedByRowId.set(row.id, { transferType, tradeRow, parties });
    if (!tradeRow || !parties) continue;
    teamIds.add(parties.teamA);
    teamIds.add(parties.teamB);
    if (transferType === "swap") {
      if (tradeRow.offered_rider_id) riderIds.add(tradeRow.offered_rider_id);
      if (tradeRow.requested_rider_id) riderIds.add(tradeRow.requested_rider_id);
    } else if (tradeRow.rider_id) {
      riderIds.add(tradeRow.rider_id);
    }
  }

  const missingTeamIds = [...teamIds].filter((id) => !teamsById.has(id));
  const [ridersResult, extraTeamsResult] = await Promise.all([
    riderIds.size
      ? supabase.from("riders").select("id, firstname, lastname, market_value").in("id", [...riderIds]).limit(riderIds.size)
      : Promise.resolve({ data: [], error: null }),
    missingTeamIds.length
      ? supabase.from("teams").select("id, name").in("id", missingTeamIds).limit(missingTeamIds.length)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ridersResult.error) throw new Error(`feedbackInbox: could not resolve trade riders: ${ridersResult.error.message}`);
  if (extraTeamsResult.error) throw new Error(`feedbackInbox: could not resolve trade teams: ${extraTeamsResult.error.message}`);

  const ridersById = new Map((ridersResult.data || []).map((r) => [r.id, r]));
  for (const t of extraTeamsResult.data || []) teamsById.set(t.id, t);

  for (const row of fairplayRows) {
    const { transferType, tradeRow, parties } = resolvedByRowId.get(row.id);
    if (!tradeRow || !parties) {
      tradeByRowId.set(row.id, { trade: null, trade_missing: true });
      continue;
    }
    const reportingTeam = row.team_id ? teamsById.get(row.team_id) : null;
    tradeByRowId.set(row.id, {
      trade: buildTradeObject({ transferType, tradeRow, parties, ridersById, teamsById, reportingTeam }),
      trade_missing: false,
    });
  }

  return tradeByRowId;
}

/**
 * Opløser ÉT trade-objekt for en netop-indsendt rapport — bruges af
 * POST /transfers/:type/:id/report til at fodre Discord-mirroret (#5284) med
 * de samme opløste felter som admin-indbakken viser, i stedet for kun
 * fritekst. Aldrig en 500 hvis handlen ikke kan slås op igen mellem
 * submitTradeReport's eget opslag og dette (dobbelt-opslag er acceptabelt her
 * — ét kald pr. rapport, ikke pr. side).
 */
export async function resolveTradeForReport({ supabase, transferType, transferId, reportingTeamId }) {
  if (!TRADE_REPORT_TYPES.includes(transferType) || !transferId) {
    return { trade: null, trade_missing: false };
  }

  const table = TRADE_REPORT_TABLE_BY_TYPE[transferType];
  const { data: tradeRow, error } = await supabase
    .from(table)
    .select(TRADE_TABLE_SELECT_COLUMNS[transferType])
    .eq("id", transferId)
    .maybeSingle();
  if (error) throw new Error(`feedbackInbox: could not resolve ${transferType} ${transferId} for report: ${error.message}`);

  const parties = resolveTradeParties(transferType, tradeRow);
  if (!tradeRow || !parties) return { trade: null, trade_missing: true };

  const riderIds =
    transferType === "swap"
      ? [tradeRow.offered_rider_id, tradeRow.requested_rider_id].filter(Boolean)
      : [tradeRow.rider_id].filter(Boolean);
  const teamIds = [...new Set([parties.teamA, parties.teamB, reportingTeamId].filter(Boolean))];

  const [ridersResult, teamsResult] = await Promise.all([
    riderIds.length
      ? supabase.from("riders").select("id, firstname, lastname, market_value").in("id", riderIds).limit(riderIds.length)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("teams").select("id, name").in("id", teamIds).limit(teamIds.length)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ridersResult.error) throw new Error(`feedbackInbox: could not resolve report riders: ${ridersResult.error.message}`);
  if (teamsResult.error) throw new Error(`feedbackInbox: could not resolve report teams: ${teamsResult.error.message}`);

  const ridersById = new Map((ridersResult.data || []).map((r) => [r.id, r]));
  const teamsById = new Map((teamsResult.data || []).map((t) => [t.id, t]));
  const reportingTeam = reportingTeamId ? teamsById.get(reportingTeamId) : null;

  return {
    trade: buildTradeObject({ transferType, tradeRow, parties, ridersById, teamsById, reportingTeam }),
    trade_missing: false,
  };
}

/**
 * GET /api/admin/feedback — én side af indbakken, nyeste først.
 *
 * Afsender og hold opløses med to batch-opslag på netop de id'er siden
 * indeholder (bounded af limit), i stedet for et PostgREST-embed:
 * player_feedback.user_id peger på auth.users, ikke public.users, så der er
 * ingen FK PostgREST kan embedde igennem.
 *
 * @returns {{ items: object[], next_cursor: number|null, limit: number }}
 */
export async function listFeedbackInbox({ supabase, status = null, category = null, limit, cursor }) {
  const pageSize = parseInboxLimit(limit);
  const afterCursor = parseInboxCursor(cursor);

  let query = supabase.from("player_feedback").select(INBOX_COLUMNS);
  if (status && isValidFeedbackStatus(status)) query = query.eq("status", status);
  if (category) query = query.eq("category", category);
  // Keyset: seq er strengt faldende, så "næste side" = alt under forrige sides
  // sidste seq. Ingen OFFSET → prisen er den samme på side 1 og side 400.
  if (afterCursor != null) query = query.lt("seq", afterCursor);

  // +1 række afgør om der findes en side mere, uden et separat count-kald.
  const { data, error } = await query.order("seq", { ascending: false }).limit(pageSize + 1);
  if (error) throw new Error(`feedbackInbox: could not list feedback: ${error.message}`);

  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

  const userIds = [...new Set(pageRows.map((r) => r.user_id).filter(Boolean))];
  const teamIds = [...new Set(pageRows.map((r) => r.team_id).filter(Boolean))];

  const [usersResult, teamsResult] = await Promise.all([
    userIds.length
      ? supabase.from("users").select("id, username, email").in("id", userIds).limit(userIds.length)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("teams").select("id, name").in("id", teamIds).limit(teamIds.length)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (usersResult.error) throw new Error(`feedbackInbox: could not resolve senders: ${usersResult.error.message}`);
  if (teamsResult.error) throw new Error(`feedbackInbox: could not resolve teams: ${teamsResult.error.message}`);

  const usersById = new Map((usersResult.data || []).map((u) => [u.id, u]));
  const teamsById = new Map((teamsResult.data || []).map((t) => [t.id, t]));

  // #5284: opløser trade-metadata for fairplay-rapporter PÅ DENNE SIDE — teamsById
  // udvides in-place med evt. hold der ikke allerede indgik i afsender/hold-opslaget
  // ovenfor (fx en modpart der ikke selv er rapportøren).
  const tradeByRowId = await resolveTradeInfoForPage(supabase, pageRows, teamsById);

  return {
    items: pageRows.map((row) => shapeItem(row, usersById, teamsById, tradeByRowId)),
    next_cursor: hasMore ? pageRows[pageRows.length - 1].seq : null,
    limit: pageSize,
  };
}

/**
 * Antal pr. status til indbakkens filter-chips. Head-counts: PostgREST tæller
 * server-side og returnerer NUL rækker, så det her er ikke et skjult
 * table-scan over wire uanset hvor stor tabellen bliver.
 */
export async function getFeedbackCounts({ supabase }) {
  const results = await Promise.all(
    FEEDBACK_STATUSES.map((status) =>
      supabase.from("player_feedback").select("id", { count: "exact", head: true }).eq("status", status)
    )
  );
  const counts = {};
  FEEDBACK_STATUSES.forEach((status, i) => {
    const { error, count } = results[i];
    if (error) throw new Error(`feedbackInbox: could not count status ${status}: ${error.message}`);
    counts[status] = count ?? 0;
  });
  counts.total = FEEDBACK_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  return counts;
}

/**
 * PATCH /api/admin/feedback/:id/status — flyt new → in_progress → closed.
 * Returnerer { status, body } så api.js-routen forbliver et tyndt lag.
 */
export async function setFeedbackStatus({ supabase, id, status, now = new Date() }) {
  if (!id) return { status: 400, body: { error: "Missing id", errorCode: "feedback_missing_id" } };
  if (!isValidFeedbackStatus(status)) {
    return { status: 400, body: { error: "Invalid status", errorCode: "feedback_invalid_status" } };
  }

  const { data, error } = await supabase
    .from("player_feedback")
    .update({ status, status_changed_at: now.toISOString() })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();

  if (error) throw new Error(`feedbackInbox: could not update status for ${id}: ${error.message}`);
  if (!data) return { status: 404, body: { error: "Feedback not found", errorCode: "feedback_not_found" } };

  return { status: 200, body: { ok: true, id: data.id, status: data.status } };
}

/**
 * POST /api/admin/feedback/:id/reply — send ejerens svar til spilleren.
 *
 * Kanal: in-app-notifikation (type `admin_notice`, findes allerede i
 * notifications_type_check). Valgt frem for e-mail/Discord fordi den genbruger
 * notifyUser(), ikke kræver ny infrastruktur, og lander der hvor spilleren i
 * forvejen læser beskeder. Svaret persisteres samtidig på feedback-rækken, så
 * indbakken kan vise hvad der blev svaret.
 *
 * RÆKKEFØLGE (bevidst): notifikationen sendes FØR rækken markeres besvaret.
 * Omvendt rækkefølge ville kunne markere et svar som leveret der aldrig nåede
 * frem. Dobbelt-levering ved en retry er dækket af notifyUser's dedupe på
 * (type, title, message, related_id) — related_id er feedback-id'et her.
 */
export async function replyToFeedback({
  supabase,
  id,
  adminUserId,
  reply,
  notify = defaultNotifyUser,
  now = new Date(),
}) {
  if (!id) return { status: 400, body: { error: "Missing id", errorCode: "feedback_missing_id" } };

  const trimmed = typeof reply === "string" ? reply.trim() : "";
  if (!trimmed) {
    return { status: 400, body: { error: "Reply is required", errorCode: "feedback_reply_required" } };
  }
  if (trimmed.length > FEEDBACK_REPLY_MAX_LENGTH) {
    return { status: 400, body: { error: "Reply is too long", errorCode: "feedback_reply_too_long" } };
  }

  const { data: row, error: loadError } = await supabase
    .from("player_feedback")
    .select("id, user_id, category, reply_message")
    .eq("id", id)
    .maybeSingle();
  if (loadError) throw new Error(`feedbackInbox: could not load feedback ${id}: ${loadError.message}`);
  if (!row) return { status: 404, body: { error: "Feedback not found", errorCode: "feedback_not_found" } };
  if (row.reply_message) {
    return { status: 409, body: { error: "Already replied", errorCode: "feedback_already_replied" } };
  }

  await notify({
    supabase,
    userId: row.user_id,
    type: "admin_notice",
    // EN-fallback for legacy-renderere; frontend foretrækker titleCode og
    // rammer da/en efter brugerens sprogvalg (#666-mønstret).
    title: "Reply from the developer",
    message: trimmed,
    relatedId: row.id,
    metadata: {
      titleCode: "notif.admin.feedbackReply.title",
      titleParams: {},
      feedbackCategory: row.category,
    },
    now,
  });

  const { error: updateError } = await supabase
    .from("player_feedback")
    .update({
      reply_message: trimmed,
      replied_at: now.toISOString(),
      replied_by: adminUserId || null,
      status: "closed",
      status_changed_at: now.toISOString(),
    })
    .eq("id", id);
  if (updateError) throw new Error(`feedbackInbox: could not persist reply for ${id}: ${updateError.message}`);

  return { status: 200, body: { ok: true, id: row.id, status: "closed", replied_at: now.toISOString() } };
}

/**
 * POST /api/transfers/:type/:id/report — "Report for review" på en enkelt
 * gennemført handel (#4346). ALDRIG en anklage-flade: fritekst lander samme
 * sted som kontaktformularens fairplay-kategori, til admin-gennemsyn.
 *
 * teamId er IKKE nødvendigvis part i handlen — enhver spiller kan rapportere
 * en handel hun har set (fx nævnt andetsteds, #4346's egen baggrund: "mener
 * ikke de var de hold der blev nævnt ... men er ikke 100%"). Derfor er der
 * ingen "er du part i handlen"-tjek her, kun at handlen faktisk FINDES og er
 * en afsluttet to-holds-handel — begge hold-id'er slås op i databasen, aldrig
 * fra klienten, så payloaden ikke kan forfalskes.
 *
 * Dedupe ("maks 1 rapport pr. handel pr. hold", #4346): idempotent som
 * reportConversation (directMessages.js) — en gentaget rapport fra samme hold
 * på samme handel giver 200 + alreadyReported:true, ikke en fejl.
 */
export async function submitTradeReport({ supabase, teamId, userId, transferType, transferId, message }) {
  if (!teamId) {
    return { status: 400, body: { error: "No team", errorCode: "trade_report_no_team" } };
  }
  if (!TRADE_REPORT_TYPES.includes(transferType)) {
    return { status: 400, body: { error: "Invalid transfer type", errorCode: "trade_report_invalid_type" } };
  }
  if (!transferId) {
    return { status: 400, body: { error: "Missing transfer id", errorCode: "trade_report_missing_id" } };
  }
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (trimmed.length < TRADE_REPORT_MESSAGE_MIN_LENGTH) {
    return { status: 400, body: { error: "Tell us what looked off, in a sentence or two", errorCode: "trade_report_message_too_short" } };
  }
  if (trimmed.length > TRADE_REPORT_MESSAGE_MAX_LENGTH) {
    return { status: 400, body: { error: "Message is too long", errorCode: "trade_report_message_too_long" } };
  }

  const table = TRADE_REPORT_TABLE_BY_TYPE[transferType];
  const { data: tradeRow, error: loadError } = await supabase
    .from(table)
    .select("*")
    .eq("id", transferId)
    .maybeSingle();
  if (loadError) throw new Error(`feedbackInbox: could not load ${transferType} ${transferId}: ${loadError.message}`);

  const parties = resolveTradeParties(transferType, tradeRow);
  if (!parties) {
    return { status: 404, body: { error: "Trade not found", errorCode: "trade_report_not_found" } };
  }

  // Dedupe: læs holdets EGNE fairplay-rækker og sammenlign metadata i JS — se
  // migrationens begrundelse for hvorfor ikke en DB-unique-constraint.
  // schema-columns-ok: metadata tilføjes af database/2026-09-14-4346-fairplay-trade-report.sql, applied post-merge.
  const { data: existingRows, error: dupeError } = await supabase
    .from("player_feedback")
    .select("id, metadata")
    .eq("category", TRADE_REPORT_CATEGORY)
    .eq("team_id", teamId);
  if (dupeError) throw new Error(`feedbackInbox: could not check existing trade reports: ${dupeError.message}`);
  const existing = (existingRows || []).find(
    (r) => r.metadata?.transfer_type === transferType && r.metadata?.transfer_id === transferId
  );
  if (existing) {
    return { status: 200, body: { ok: true, id: existing.id, alreadyReported: true } };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("player_feedback")
    .insert({
      user_id: userId,
      team_id: teamId,
      category: TRADE_REPORT_CATEGORY,
      message: trimmed,
      metadata: {
        transfer_type: transferType,
        transfer_id: transferId,
        reporting_team_id: teamId,
        // Bevidst NEUTRALT navngivet (ikke "counterparty") — det rapporterende
        // hold behøver ikke være part i handlen (#4346: en spiller kan
        // rapportere en handel hun har set, ikke kun sine egne), så "hvem er
        // modparten SET FRA rapportøren" giver ikke altid mening.
        team_a_id: parties.teamA,
        team_b_id: parties.teamB,
      },
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`feedbackInbox: could not insert trade report: ${insertError.message}`);

  return { status: 200, body: { ok: true, id: inserted.id, alreadyReported: false } };
}
