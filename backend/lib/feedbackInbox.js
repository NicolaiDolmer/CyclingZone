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

// Kolonner indbakken læser. `message` er med (det er hele pointen), men
// user_agent udelades bevidst fra listen: den er ren diagnostik, den er den
// mest fingerprint-agtige kolonne i tabellen, og den fylder listen uden at
// hjælpe triagen. Den kan hentes på detalje-niveau hvis en bug kræver det.
const INBOX_COLUMNS =
  "id, seq, created_at, user_id, team_id, category, status, message, page_path, viewport, reply_message, replied_at";

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

function shapeItem(row, usersById, teamsById) {
  const user = usersById.get(row.user_id) || null;
  const team = row.team_id ? teamsById.get(row.team_id) || null : null;
  return {
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

  return {
    items: pageRows.map((row) => shapeItem(row, usersById, teamsById)),
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
