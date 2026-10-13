// #6590 · Push-notifikationer: politik + udsendelse (spor 2 af #6584).
//
// Design (ejer-go 13/10, uden aendringer):
//   docs/superpowers/specs/2026-10-13-6584-push-og-twa-design.md §1-§5
//
// Push er en ny KANAL for de notifikationer der allerede skrives
// (notifyUser → notifications). De ~50 kaldsteder roeres ikke: en sweep hvert
// minut laeser nye raekker siden en cursor (samme moenster som
// raceNotifyOutbox.js) og afgoer pr. raekke:
//
//   type → kategori → spillerens valg → stille timer → doegnloft → send / koe
//
// Reglerne (ejer-godkendte, issue #6590):
//   - 5 kategorier, spilleren slaar selv til/fra. Standard efter opt-in:
//     auktioner, loeb, transfers og frister til; akademi fra.
//   - Auktioner: overbudt KUN naar auktionen slutter inden for et kort vindue
//     ("sidste minut"); vundet altid.
//   - Loeb og akademi sendes aldrig enkeltvis, kun som resumé (digest).
//   - Loft: hoejst PUSH_DAILY_CAP push pr. spiller pr. doegn (spillerens
//     kalenderdoegn). Resten venter til naeste resumé.
//   - Stille timer 22-08 i spillerens tidszone (users.timezone, IANA, NULL =
//     Europe/Copenhagen). Ingen undtagelser, heller ikke "sidste minut".
//   - Samme tag pr. kategori (Notification API) og samme Topic (RFC 8030), saa
//     en ny besked erstatter den gamle i stedet for at stable sig.
//
// Teksten genbruger notifikationens egne i18n-noegler
// (metadata.titleCode/messageCode) paa spillerens users.language. Raekker uden
// noegler (aeldre kaldsteder) sendes med deres gemte title/message, praecis som
// indbakken viser dem. De eneste nye tekster er resumé-overskriften og
// kategori-taellerne (backendMessages.json, push.digest.*).
//
// Slukket flag (app_config.push_enabled = off, startstadiet) = sweepen laeser
// intet andet og sender intet. Manglende VAPID-noegler = samme.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { normalizeLanguage, translate } from "./i18nServer.js";
import { captureException } from "./sentry.js";
import { readVapidConfig, sendWebPush, isValidPushEndpoint } from "./webPush.ts";

export const PUSH_FLAG_KEY = "push_enabled";
export const PUSH_CURSOR_KEY = "push_sweep_cursor";

export const PUSH_DAILY_CAP = 6;
export const QUIET_START_MINUTE = 22 * 60;
export const QUIET_END_MINUTE = 8 * 60;
export const DEFAULT_TIMEZONE = "Europe/Copenhagen";
// "Sidste minut" for overbudt-push. Produkt-konstant (spec §2): kan justeres
// uden migration. Et bud senere end dette foer slut giver push; tidligere bud
// bliver i indbakken.
export const AUCTION_LAST_MINUTE_WINDOW_MS = 30 * 60 * 1000;
// Loebs-resuméet sendes "efter dagens sidste etape". Der findes ikke ét signal
// for "dagens etaper er kørt", saa resuméet sendes naar der ikke er kommet et
// nyt loebsresultat til spilleren i dette tidsrum.
export const RACE_DIGEST_SETTLE_MS = 90 * 60 * 1000;
// Sweepen kigger aldrig laengere tilbage end dette. Har flaget vaeret slukket i
// en uge, maa et taend ikke sende ugens gamle notifikationer.
export const SWEEP_MAX_LOOKBACK_MS = 15 * 60 * 1000;
export const DELIVERY_RETENTION_DAYS = 30;
const SWEEP_BATCH = 500;
const QUEUE_BATCH = 2000;
const MAX_SUBSCRIPTION_FAILURES = 10;

export const PUSH_CATEGORIES = Object.freeze([
  {
    key: "auctions",
    types: ["auction_outbid", "auction_proxy_outbid", "auction_won"],
    mode: "instant",
    defaultOn: true,
    url: "/auctions",
    urgency: "high",
    ttlSeconds: AUCTION_LAST_MINUTE_WINDOW_MS / 1000,
  },
  { key: "races", types: ["stage_result", "race_result"], mode: "digest", defaultOn: true, url: "/notifications" },
  { key: "transfers", types: ["transfer_offer_received", "transfer_counter"], mode: "instant", defaultOn: true, url: "/transfers" },
  {
    key: "deadlines",
    types: ["selection_warning", "squad_below_minimum", "deadline_day_warning", "contract_expiring"],
    mode: "instant",
    defaultOn: true,
    url: "/notifications",
  },
  {
    key: "academy",
    types: ["academy_intake_ready", "academy_graduation_ready", "scout_report_ready"],
    mode: "digest",
    defaultOn: false,
    url: "/notifications",
  },
]);

export const PUSH_CATEGORY_KEYS = Object.freeze(PUSH_CATEGORIES.map((c) => c.key));
const CATEGORY_BY_KEY = new Map(PUSH_CATEGORIES.map((c) => [c.key, c]));
const CATEGORY_BY_TYPE = new Map(PUSH_CATEGORIES.flatMap((c) => c.types.map((t) => [t, c])));
export const PUSH_NOTIFICATION_TYPES = Object.freeze(PUSH_CATEGORIES.flatMap((c) => c.types));
const OUTBID_TYPES = new Set(["auction_outbid", "auction_proxy_outbid"]);
const DIGEST_TAG = "digest";

export function categoryForType(type) {
  return CATEGORY_BY_TYPE.get(type) ?? null;
}

// ── Praeferencer ─────────────────────────────────────────────────────────────

/** users.push_prefs → { auctions: true, ... } med standarder for manglende noegler. */
export function resolveCategoryPrefs(pushPrefs) {
  const stored = pushPrefs && typeof pushPrefs === "object" ? pushPrefs.categories : null;
  const out = {};
  for (const category of PUSH_CATEGORIES) {
    const value = stored && typeof stored === "object" ? stored[category.key] : undefined;
    out[category.key] = typeof value === "boolean" ? value : category.defaultOn;
  }
  return out;
}

/** API-graense: kun kendte kategorier med rigtige booleans. */
export function sanitizeCategoryPatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { categories: {}, unknownKeys: [], invalid: input != null };
  const categories = {};
  const unknownKeys = [];
  let invalid = false;
  for (const [key, value] of Object.entries(input)) {
    if (!CATEGORY_BY_KEY.has(key)) unknownKeys.push(key);
    else if (typeof value !== "boolean") invalid = true;
    else categories[key] = value;
  }
  return { categories, unknownKeys, invalid };
}

// ── Tid og tidszoner ─────────────────────────────────────────────────────────

const formatterCache = new Map();
function zonedFormatter(timeZone) {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Gyldig IANA-zone eller DEFAULT_TIMEZONE. Ugyldige vaerdier kaster aldrig. */
export function normalizeTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim() || timeZone.length > 64) return DEFAULT_TIMEZONE;
  try {
    zonedFormatter(timeZone.trim());
    return timeZone.trim();
  } catch {
    // best-effort: en ugyldig zone (fx en gammel browser-streng) falder tilbage til standarden.
    return DEFAULT_TIMEZONE;
  }
}

export function isValidTimeZone(timeZone) {
  return typeof timeZone === "string" && normalizeTimeZone(timeZone) === timeZone.trim() && timeZone.trim() !== "";
}

/** Vaegur-dele i zonen: { year, month, day, hour, minute, second }. */
export function zonedParts(date, timeZone) {
  const parts = {};
  for (const p of zonedFormatter(normalizeTimeZone(timeZone)).formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts;
}

/** Zonens forskydning fra UTC i ms paa et givet tidspunkt. */
function zoneOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Lokal vaeg-tid i zonen → UTC-tidspunkt (to gennemloeb daekker sommertid). */
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = guess - zoneOffsetMs(new Date(guess), timeZone);
  utc = guess - zoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
}

export function localMinuteOfDay(now, timeZone) {
  const p = zonedParts(now, timeZone);
  return p.hour * 60 + p.minute;
}

export function isQuietHours(now, timeZone) {
  const minute = localMinuteOfDay(now, timeZone);
  return minute >= QUIET_START_MINUTE || minute < QUIET_END_MINUTE;
}

function shiftDay({ year, month, day }, delta) {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Seneste gang stille timer sluttede (kl. 08 lokal tid), som UTC-tidspunkt. */
export function lastQuietEnd(now, timeZone) {
  const p = zonedParts(now, timeZone);
  const today = { year: p.year, month: p.month, day: p.day };
  const endHour = Math.floor(QUIET_END_MINUTE / 60);
  const endMinute = QUIET_END_MINUTE % 60;
  const day = p.hour * 60 + p.minute >= QUIET_END_MINUTE ? today : shiftDay(today, -1);
  return zonedTimeToUtc({ ...day, hour: endHour, minute: endMinute }, timeZone);
}

/** Lokal midnat i dag (loftets doegn), som UTC-tidspunkt. */
export function startOfLocalDay(now, timeZone) {
  const p = zonedParts(now, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0 }, timeZone);
}

// ── Beslutninger (rene, testede) ─────────────────────────────────────────────

/** Overbudt taeller kun som "sidste minut" hvis auktionen slutter inden for vinduet. */
export function isLastMinuteOutbid(notification, auction) {
  if (!auction) return false;
  const end = Date.parse(auction.calculated_end ?? "");
  const at = Date.parse(notification.created_at ?? "");
  if (!Number.isFinite(end) || !Number.isFinite(at)) return false;
  const remaining = end - at;
  return remaining >= 0 && remaining <= AUCTION_LAST_MINUTE_WINDOW_MS;
}

/**
 * Afgoer hvad der skal ske med én spillers nye notifikationer i dette tick.
 *
 * @param {object} p
 * @param {Array<object>} p.notifications  nye raekker (sorteret aeldst foerst)
 * @param {object} p.prefs                 resolveCategoryPrefs(...)
 * @param {string} p.timeZone
 * @param {number} p.sentToday             push sendt i spillerens kalenderdoegn
 * @param {Date} p.now
 * @param {Map<string, object>} [p.auctions]  auktion pr. id (til "sidste minut")
 * @returns {{ send: Array<{category: object, notifications: object[]}>,
 *             queue: Array<{notification: object, category: object, reason: string}>,
 *             skipped: number }}
 */
export function planUserNotifications({ notifications, prefs, timeZone, sentToday, now, auctions = new Map() }) {
  const send = [];
  const queue = [];
  let skipped = 0;
  const instantByCategory = new Map();
  for (const notification of notifications) {
    const category = categoryForType(notification.type);
    if (!category || prefs[category.key] !== true) {
      skipped += 1;
      continue;
    }
    if (OUTBID_TYPES.has(notification.type) && !isLastMinuteOutbid(notification, auctions.get(notification.related_id))) {
      skipped += 1; // bliver i indbakken; ikke en grund til at ringe
      continue;
    }
    if (category.mode === "digest") {
      queue.push({ notification, category, reason: "digest" });
      continue;
    }
    if (!instantByCategory.has(category.key)) instantByCategory.set(category.key, []);
    instantByCategory.get(category.key).push(notification);
  }

  const quiet = isQuietHours(now, timeZone);
  let budget = PUSH_DAILY_CAP - sentToday;
  for (const category of PUSH_CATEGORIES) {
    const items = instantByCategory.get(category.key);
    if (!items) continue;
    if (quiet) {
      for (const notification of items) queue.push({ notification, category, reason: "quiet" });
    } else if (budget <= 0) {
      for (const notification of items) queue.push({ notification, category, reason: "cap" });
    } else {
      // Flere i samme kategori i samme tick = ét push (den nyeste), samme tag.
      send.push({ category, notifications: items });
      budget -= 1;
    }
  }
  return { send, queue, skipped };
}

/**
 * Skal spillerens koe sendes som resumé nu?
 *  - aldrig i stille timer, aldrig over loftet
 *  - alt der blev lagt i koe FOER stille timer sluttede sidst (morgen-resuméet):
 *    stille-timer-raekker, loft-raekker og akademi
 *  - loebs-resuméet: naar der ikke er kommet nyt loebsresultat i RACE_DIGEST_SETTLE_MS
 */
export function isDigestDue({ rows, now, timeZone, sentToday }) {
  if (!rows.length) return false;
  if (isQuietHours(now, timeZone)) return false;
  if (sentToday >= PUSH_DAILY_CAP) return false;
  const quietEnd = lastQuietEnd(now, timeZone).getTime();
  const isRaceDigest = (r) => r.reason === "digest" && r.category === "races";
  if (rows.some((r) => !isRaceDigest(r) && Date.parse(r.queued_at) < quietEnd)) return true;
  const raceTimes = rows.filter(isRaceDigest).map((r) => Date.parse(r.queued_at)).filter(Number.isFinite);
  if (raceTimes.length && now.getTime() - Math.max(...raceTimes) >= RACE_DIGEST_SETTLE_MS) return true;
  return false;
}

// ── Tekst ────────────────────────────────────────────────────────────────────

function renderNotificationText(notification, language) {
  const meta = notification.metadata && typeof notification.metadata === "object" ? notification.metadata : {};
  const title = meta.titleCode
    ? translate(meta.titleCode, meta.titleParams ?? {}, { language, fallback: notification.title ?? "" })
    : notification.title ?? "";
  const body = meta.messageCode
    ? translate(meta.messageCode, meta.messageParams ?? {}, { language, fallback: notification.message ?? "" })
    : notification.message ?? "";
  return { title: String(title).slice(0, 120), body: String(body).slice(0, 300) };
}

/** Ét push for én kategori: den nyeste notifikations egen tekst. */
export function buildInstantPayload({ category, notifications, language, unread = null }) {
  const latest = notifications[notifications.length - 1];
  const { title, body } = renderNotificationText(latest, language);
  return { title, body, tag: category.key, url: category.url, unread };
}

/** Resumé: "3 race results · 1 transfer offer" under én overskrift. */
export function buildDigestPayload({ countsByCategory, language, unread = null }) {
  const lang = normalizeLanguage(language);
  const parts = [];
  for (const category of PUSH_CATEGORIES) {
    const count = countsByCategory[category.key] ?? 0;
    if (count > 0) parts.push(translate(`push.digest.count.${category.key}`, { count }, { language: lang }));
  }
  const used = PUSH_CATEGORIES.filter((c) => (countsByCategory[c.key] ?? 0) > 0);
  const tag = used.length === 1 ? used[0].key : DIGEST_TAG;
  const url = used.length === 1 ? used[0].url : "/notifications";
  return { title: translate("push.digest.title", {}, { language: lang }), body: parts.join(" · "), tag, url, unread };
}

// ── Udsendelse ───────────────────────────────────────────────────────────────

export function isUserEligibleForStage(stage, user) {
  if (stage === true || stage === "on") return true;
  return evaluateFlagStage(stage, { isBetaTester: user?.role === "admin" || user?.is_beta_tester === true });
}

async function countUnread(supabase, userId) {
  const { count, error } = await supabase
    .from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("is_read", false);
  if (error) return null;
  return typeof count === "number" ? count : null;
}

/**
 * Send ét payload til alle spillerens abonnementer og opdater dem.
 * @returns {Promise<"sent"|"gone"|"failed">}
 */
async function deliverToUser({ supabase, subscriptions, payload, category, vapid, now, send }) {
  let anyOk = false;
  let allGone = subscriptions.length > 0;
  for (const sub of subscriptions) {
    const result = await send(sub, JSON.stringify(payload), vapid, {
      topic: payload.tag,
      urgency: category?.urgency ?? "normal",
      ttlSeconds: category?.ttlSeconds ?? 12 * 60 * 60,
    });
    if (result.ok) {
      anyOk = true;
      allGone = false;
      await supabase.from("push_subscriptions")
        .update({ last_success_at: now.toISOString(), failure_count: 0 }).eq("id", sub.id);
    } else if (result.gone || (sub.failure_count ?? 0) + 1 >= MAX_SUBSCRIPTION_FAILURES) {
      // 404/410 = abonnementet er vaek (GDPR: slet endpointet med det samme).
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
    } else {
      allGone = false;
      await supabase.from("push_subscriptions")
        .update({ failure_count: (sub.failure_count ?? 0) + 1 }).eq("id", sub.id);
    }
  }
  return anyOk ? "sent" : allGone ? "gone" : "failed";
}

async function readCursor(supabase) {
  const { data, error } = await supabase
    .from("app_config").select("value, updated_at").eq("key", PUSH_CURSOR_KEY).maybeSingle();
  if (error) throw new Error(`push cursor: ${error.message}`);
  const value = data?.value;
  if (value && typeof value === "object" && typeof value.at === "string") {
    return { at: value.at, id: value.id ?? null, version: data.updated_at ?? null };
  }
  return null;
}

async function initCursor(supabase, now) {
  const { error } = await supabase.from("app_config").upsert(
    {
      key: PUSH_CURSOR_KEY,
      value: { at: now.toISOString(), id: null },
      description: "Internal cursor for the web push sweep (#6590): last processed notification. Not a flag.",
      updated_at: now.toISOString(),
    },
    { onConflict: "key", ignoreDuplicates: true },
  );
  if (error) throw new Error(`push cursor init: ${error.message}`);
}

/**
 * Flyt cursoren FOER der sendes (compare-and-swap paa updated_at). Under et
 * deploy koerer den gamle og den nye proces samtidig et kort oejeblik; kun det
 * tick der vinder claim'en sender, saa ingen spiller faar samme push to gange.
 * Doer processen efter claim'en, mistes de push (indbakken har dem stadig):
 * hellere ét for lidt end ét for meget.
 */
async function claimCursor(supabase, next, previousVersion, now) {
  let query = supabase.from("app_config").update({ value: next, updated_at: now.toISOString() }).eq("key", PUSH_CURSOR_KEY);
  query = previousVersion ? query.eq("updated_at", previousVersion) : query.is("updated_at", null);
  const { data, error } = await query.select("key");
  if (error) throw new Error(`push cursor claim: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

async function loadRecipients(supabase, userIds, now) {
  if (!userIds.length) return { users: new Map(), subs: new Map(), sentToday: new Map() };
  const { data: subRows, error: subErr } = await supabase
    .from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth, failure_count").in("user_id", userIds);
  if (subErr) throw new Error(`push_subscriptions: ${subErr.message}`);
  const subs = groupBy(subRows ?? [], "user_id");
  const withSubs = [...subs.keys()];
  if (!withSubs.length) return { users: new Map(), subs, sentToday: new Map() };

  const { data: userRows, error: userErr } = await supabase
    .from("users").select("id, language, timezone, push_prefs, role, is_beta_tester").in("id", withSubs);
  if (userErr) throw new Error(`users: ${userErr.message}`);
  const users = new Map((userRows ?? []).map((u) => [u.id, u]));

  // Lidt over et doegn tilbage; det praecise doegn regnes i spillerens zone.
  const since = new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString();
  const { data: deliveryRows, error: delErr } = await supabase
    .from("push_deliveries").select("user_id, sent_at").in("user_id", withSubs).eq("status", "sent").gte("sent_at", since);
  if (delErr) throw new Error(`push_deliveries: ${delErr.message}`);
  const sentToday = new Map();
  for (const row of deliveryRows ?? []) {
    const user = users.get(row.user_id);
    const dayStart = startOfLocalDay(now, normalizeTimeZone(user?.timezone)).getTime();
    if (Date.parse(row.sent_at) >= dayStart) sentToday.set(row.user_id, (sentToday.get(row.user_id) ?? 0) + 1);
  }
  return { users, subs, sentToday };
}

async function recordDelivery(supabase, { userId, category, notificationIds, status, now }) {
  const { error } = await supabase.from("push_deliveries").insert({
    user_id: userId,
    category,
    notification_ids: notificationIds,
    status,
    sent_at: now.toISOString(),
  });
  if (error) throw new Error(`push_deliveries insert: ${error.message}`);
}

/**
 * Ét tick. Returnerer en lille opsummering til cron-loggen (ingen persondata).
 *
 * @param {object} p
 * @param {object} p.supabase
 * @param {Date} [p.now]
 * @param {object} [p.env]       process.env (VAPID_*)
 * @param {Function} [p.send]    sendWebPush (injiceres i tests)
 */
export async function runPushSweep({ supabase, now = new Date(), env = process.env, send = sendWebPush } = {}) {
  const stage = await readFlagStage(supabase, PUSH_FLAG_KEY);
  if (!evaluateFlagStage(stage, { engineWrite: true })) return { skipped: "flag_off" };
  const vapid = readVapidConfig(env);
  if (!vapid) return { skipped: "vapid_missing" };

  const summary = { scanned: 0, sent: 0, queued: 0, digests: 0, failed: 0 };

  // 1) Nye notifikationer siden cursoren.
  const cursor = await readCursor(supabase);
  const floorIso = new Date(now.getTime() - SWEEP_MAX_LOOKBACK_MS).toISOString();
  if (!cursor) {
    // Foerste koersel: start fra nu. Gamle notifikationer sendes aldrig.
    await initCursor(supabase, now);
  } else {
    const fromCursor = Date.parse(cursor.at) >= Date.parse(floorIso);
    const lowerIso = fromCursor ? cursor.at : floorIso;
    const { data: rows, error } = await supabase
      .from("notifications")
      .select("id, user_id, type, title, message, related_id, created_at, metadata")
      .in("type", PUSH_NOTIFICATION_TYPES)
      .gte("created_at", lowerIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(SWEEP_BATCH);
    if (error) throw new Error(`notifications: ${error.message}`);
    const fresh = (rows ?? []).filter(
      (r) => !(fromCursor && r.created_at === cursor.at && cursor.id && String(r.id) <= String(cursor.id)),
    );
    summary.scanned = fresh.length;
    if (fresh.length) {
      const last = fresh[fresh.length - 1];
      if (await claimCursor(supabase, { at: last.created_at, id: last.id }, cursor.version, now)) {
        await processFresh({ supabase, rows: fresh, stage, vapid, now, send, summary });
      } else {
        summary.scanned = 0; // et andet tick (fx under et deploy) tog dem
      }
    }
  }

  // 2) Resuméer der er klar.
  await flushDigests({ supabase, stage, vapid, now, send, summary });

  // 3) Oprydning én gang i timen.
  if (now.getUTCMinutes() === 0) {
    const cutoff = new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("push_deliveries").delete().lt("sent_at", cutoff);
    if (error) captureException(new Error(`push_deliveries cleanup: ${error.message}`), { tags: { flow: "push", stage: "cleanup" } });
  }
  return summary;
}

// Et langsomt tick (mange abonnementer, langsom push-tjeneste) maa ikke faa det
// naeste minut-tick til at starte oveni i samme proces.
let sweepInFlight = false;

export async function runPushSweepOnce(args) {
  if (sweepInFlight) return { skipped: "in_flight" };
  sweepInFlight = true;
  try {
    return await runPushSweep(args);
  } finally {
    sweepInFlight = false;
  }
}

async function processFresh({ supabase, rows, stage, vapid, now, send, summary }) {
  const byUser = groupBy(rows, "user_id");
  const { users, subs, sentToday } = await loadRecipients(supabase, [...byUser.keys()], now);

  const auctionIds = [
    ...new Set(rows.filter((r) => OUTBID_TYPES.has(r.type) && r.related_id).map((r) => r.related_id)),
  ];
  const auctions = new Map();
  if (auctionIds.length) {
    const { data, error } = await supabase.from("auctions").select("id, calculated_end").in("id", auctionIds);
    if (error) throw new Error(`auctions: ${error.message}`);
    for (const a of data ?? []) auctions.set(a.id, a);
  }

  const queueRows = [];
  for (const [userId, notifications] of byUser) {
    const user = users.get(userId);
    const userSubs = subs.get(userId) ?? [];
    if (!user || !userSubs.length || !isUserEligibleForStage(stage, user)) continue;
    const timeZone = normalizeTimeZone(user.timezone);
    const plan = planUserNotifications({
      notifications,
      prefs: resolveCategoryPrefs(user.push_prefs),
      timeZone,
      sentToday: sentToday.get(userId) ?? 0,
      now,
      auctions,
    });
    for (const item of plan.queue) {
      queueRows.push({
        user_id: userId,
        notification_id: item.notification.id,
        category: item.category.key,
        reason: item.reason,
        queued_at: now.toISOString(),
      });
    }
    for (const { category, notifications: items } of plan.send) {
      try {
        const unread = await countUnread(supabase, userId);
        const payload = buildInstantPayload({ category, notifications: items, language: user.language, unread });
        const status = await deliverToUser({ supabase, subscriptions: userSubs, payload, category, vapid, now, send });
        await recordDelivery(supabase, { userId, category: category.key, notificationIds: items.map((n) => n.id), status, now });
        if (status === "sent") summary.sent += 1;
        else summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        captureException(error, { tags: { flow: "push", stage: "instant" }, extra: { category: category.key } });
      }
    }
  }
  if (queueRows.length) {
    const { error } = await supabase.from("push_queue").upsert(queueRows, { onConflict: "user_id,notification_id", ignoreDuplicates: true });
    if (error) throw new Error(`push_queue insert: ${error.message}`);
    summary.queued += queueRows.length;
  }
}

async function flushDigests({ supabase, stage, vapid, now, send, summary }) {
  const { data: queued, error } = await supabase
    .from("push_queue").select("id, user_id, notification_id, category, reason, queued_at")
    .order("queued_at", { ascending: true }).limit(QUEUE_BATCH);
  if (error) throw new Error(`push_queue: ${error.message}`);
  if (!queued?.length) return;
  const byUser = groupBy(queued, "user_id");
  const { users, subs, sentToday } = await loadRecipients(supabase, [...byUser.keys()], now);

  for (const [userId, rows] of byUser) {
    const user = users.get(userId);
    const userSubs = subs.get(userId) ?? [];
    const queueIds = rows.map((r) => r.id);
    if (!user || !userSubs.length || !isUserEligibleForStage(stage, user)) {
      // Ingen modtager laengere (afmeldt, eller ude af beta): koeen er doed.
      if (!user || !userSubs.length) await supabase.from("push_queue").delete().in("id", queueIds);
      continue;
    }
    const timeZone = normalizeTimeZone(user.timezone);
    if (!isDigestDue({ rows, now, timeZone, sentToday: sentToday.get(userId) ?? 0 })) continue;
    try {
      // Claim: slet koe-raekkerne FOER der sendes. Kun de raekker DETTE tick
      // faktisk slettede kommer med, saa to samtidige tick aldrig sender samme resumé.
      const { data: claimed, error: claimErr } = await supabase.from("push_queue").delete().in("id", queueIds).select("id");
      if (claimErr) throw new Error(`push_queue claim: ${claimErr.message}`);
      const claimedIds = new Set((claimed ?? []).map((r) => r.id));
      const mine = rows.filter((r) => claimedIds.has(r.id));
      if (!mine.length) continue;
      // Kun det spilleren ikke allerede har set i appen kommer med.
      const notificationIds = mine.map((r) => r.notification_id);
      const { data: notes, error: noteErr } = await supabase
        .from("notifications").select("id, is_read").in("id", notificationIds);
      if (noteErr) throw new Error(`notifications (digest): ${noteErr.message}`);
      const unreadIds = new Set((notes ?? []).filter((n) => n.is_read === false).map((n) => n.id));
      const prefs = resolveCategoryPrefs(user.push_prefs);
      const countsByCategory = {};
      const included = [];
      for (const row of mine) {
        if (!unreadIds.has(row.notification_id) || prefs[row.category] !== true) continue;
        countsByCategory[row.category] = (countsByCategory[row.category] ?? 0) + 1;
        included.push(row.notification_id);
      }
      if (included.length) {
        const unread = await countUnread(supabase, userId);
        const payload = buildDigestPayload({ countsByCategory, language: user.language, unread });
        const category = CATEGORY_BY_KEY.get(payload.tag) ?? null;
        const status = await deliverToUser({ supabase, subscriptions: userSubs, payload, category, vapid, now, send });
        await recordDelivery(supabase, { userId, category: payload.tag, notificationIds: included, status, now });
        if (status === "sent") summary.digests += 1;
        else summary.failed += 1;
      }
    } catch (err) {
      summary.failed += 1;
      captureException(err, { tags: { flow: "push", stage: "digest" } });
    }
  }
}

// ── Abonnementer (bruges af routes/pushRoutes.ts) ────────────────────────────

/** Valider et PushSubscription-JSON fra browseren. Returnerer null hvis ugyldigt. */
export function parseSubscription(input) {
  const endpoint = input?.endpoint;
  const p256dh = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  if (!isValidPushEndpoint(endpoint)) return null;
  if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{80,100}={0,2}$/.test(p256dh)) return null;
  if (typeof auth !== "string" || !/^[A-Za-z0-9_-]{16,32}={0,2}$/.test(auth)) return null;
  return { endpoint, p256dh: p256dh.replace(/=+$/, ""), auth: auth.replace(/=+$/, "") };
}

/**
 * Er push slaaet til for denne spiller (flag + VAPID)?
 * @param {any} supabase
 * @param {{ isBetaTester?: boolean, env?: Record<string, string | undefined> }} [opts]
 * @returns {Promise<{ enabled: boolean, publicKey: string | null }>}
 */
export async function readPushAvailability(supabase, { isBetaTester = false, env = process.env } = {}) {
  const stage = await readFlagStage(supabase, PUSH_FLAG_KEY);
  const vapid = readVapidConfig(env);
  const flagOn = evaluateFlagStage(stage, { isBetaTester: Boolean(isBetaTester) });
  return { enabled: Boolean(flagOn && vapid), publicKey: flagOn && vapid ? vapid.publicKey : null };
}
