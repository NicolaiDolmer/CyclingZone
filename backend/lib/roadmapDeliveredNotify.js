// #7792 (ejer 6/11): naar et roadmap-punkt er leveret, faar de managere der
// stemte hoejt paa det en besked i indbakken. EN er primaer (fallback-teksten),
// DA rendres af frontend ud fra metadata-koderne i modtagerens sprog.
//
// HVORFOR en sweep og ikke et kald fra et sted: et punkt bliver leveret paa flere
// maader (databasens kontakt-triggere naar ejeren flipper et flag, resync, admin-
// fanen). Ingen af dem gaar gennem backend-koden, saa den eneste sti der rammer
// dem alle er at kigge paa punkter med status shipped, som endnu ikke er behandlet.
//
// HVEM: en manager der gav 5 eller 6 paa en af de to akser (idé eller vigtighed).
// "Ved ikke" (ingen tal) og lavere tal udloeser intet.
//
// IDEMPOTENS (hoejst en besked pr. manager pr. punkt):
//   1. roadmap_delivery_receipts har PRIMARY KEY (item_id, user_id). Sweepet
//      claimer raekken med ON CONFLICT DO NOTHING FOER det sender, saa to
//      samtidige sweeps eller et gentaget statusskift (leveret, tilbage, leveret)
//      aldrig giver en ekstra besked. Kvitteringen slettes ikke naar beskeden
//      slettes i indbakken.
//   2. roadmap_items.delivery_notified_at lukker punktet, saa sweepet ikke ser
//      paa det igen. Migrationen saetter den paa alle punkter der var leveret
//      foer denne feature, saa ingen faar besked om gammelt nyt.
//
// En fejlet afsendelse ruller KUN sin egen claim tilbage og efterlader punktet
// aabent, saa naeste tick proever igen; de der allerede har faaet beskeden
// springes over via deres kvittering.
import { fetchAllRows } from "./supabasePagination.js";
import { notifyUserWithKeys } from "./notificationService.js";
import { captureException } from "./sentry.js";

export const ROADMAP_DELIVERED_TYPE = "roadmap_delivered";
export const ROADMAP_HIGH_VOTE_MIN = 5;
export const ROADMAP_DELIVERED_ITEMS_PER_TICK = 10;
// En claim, en ANDEN koersel skrev for nylig, kan stadig vente paa sin afsendelse
// (og blive rullet tilbage ved fejl). Punktet lukkes foerst, naar alle andres
// claims er aeldre end dette vindue, saa et overlappende sweep aldrig lukker et
// punkt med en uafsluttet levering (Codex P2 paa #7846).
export const ROADMAP_DELIVERED_PENDING_GRACE_MS = 10 * 60 * 1000;
const RECEIPTS_TABLE = "roadmap_delivery_receipts";

/**
 * Tabel eller kolonne findes ikke endnu: reelt i vinduet mellem deploy og
 * auto-migrate (#2642). Stille skip, ingen Sentry-stoej.
 */
export function isRoadmapDeliveredSchemaPending(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (["42703", "42P01", "PGRST204", "PGRST205"].includes(code)) return true;
  return /delivery_notified_at|roadmap_delivery_receipts|could not find the/i.test(String(error.message || ""));
}

/** Afsenderen findes ikke laengere (FK): kvitteringen beholdes, ingen retry. */
function isForeignKeyViolation(error) {
  return String(error?.code || "") === "23503";
}

/** Noeglerne og parametrene. EN-fallbacken udledes af locale-filen i buildKeyedNotification. */
export function roadmapDeliveredKeys(item) {
  return {
    titleCode: "notif.roadmapDelivered.title",
    titleParams: {},
    messageCode: "notif.roadmapDelivered.message",
    // DA-teksten bruger itemDa, saa titlen staar paa modtagerens sprog.
    messageParams: { item: item.title_en, itemDa: item.title_da || item.title_en },
    metadata: { itemId: item.id },
  };
}

export const defaultRoadmapDeliveredStore = Object.freeze({
  async listOpenItems({ supabase, limit }) {
    const { data, error } = await supabase
      .from("roadmap_items")
      .select("id, title_en, title_da")
      .eq("status", "shipped")
      .eq("approved", true)
      .is("delivery_notified_at", null)
      .order("shipped_at", { ascending: true, nullsFirst: false })
      .order("id")
      .limit(limit);
    if (error) throw error;
    return data || [];
  },
  async listHighVoters({ supabase, itemId }) {
    const rows = await fetchAllRows(() =>
      supabase
        .from("roadmap_votes")
        .select("user_id")
        .eq("item_id", itemId)
        .or(`importance_score.gte.${ROADMAP_HIGH_VOTE_MIN},idea_score.gte.${ROADMAP_HIGH_VOTE_MIN}`)
        .order("user_id")
    );
    return rows.map((row) => row.user_id);
  },
  // true = denne koersel skrev kvitteringen og maa sende.
  async claim({ supabase, itemId, userId, sentAtIso }) {
    const { data, error } = await supabase
      .from(RECEIPTS_TABLE)
      .upsert({ item_id: itemId, user_id: userId, sent_at: sentAtIso }, { onConflict: "item_id,user_id", ignoreDuplicates: true })
      .select("user_id");
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  },
  // sent_at matcher kun denne koersels egen claim.
  async release({ supabase, itemId, userId, sentAtIso }) {
    const { error } = await supabase
      .from(RECEIPTS_TABLE)
      .delete()
      .eq("item_id", itemId)
      .eq("user_id", userId)
      .eq("sent_at", sentAtIso);
    if (error) throw error;
  },
  async listReceiptTimes({ supabase, itemId }) {
    const rows = await fetchAllRows(() =>
      supabase
        .from(RECEIPTS_TABLE)
        .select("user_id, sent_at")
        .eq("item_id", itemId)
        .order("user_id")
    );
    return new Map(rows.map((row) => [row.user_id, row.sent_at]));
  },
  async markItemDone({ supabase, itemId, nowIso }) {
    const { error } = await supabase
      .from("roadmap_items")
      .update({ delivery_notified_at: nowIso })
      .eq("id", itemId)
      .is("delivery_notified_at", null);
    if (error) throw error;
  },
});

/**
 * Behandl leverede punkter der endnu ikke er meldt ud.
 *
 * @param {{ supabase: object, now?: Date, notify?: typeof notifyUserWithKeys,
 *           store?: typeof defaultRoadmapDeliveredStore, limit?: number }} args
 */
export async function runRoadmapDeliveredNotify({
  supabase,
  now = new Date(),
  notify = notifyUserWithKeys,
  store = defaultRoadmapDeliveredStore,
  limit = ROADMAP_DELIVERED_ITEMS_PER_TICK,
}) {
  const nowIso = now.toISOString();
  const result = { items: 0, sent: 0, skipped: 0, failed: 0, pending: false };

  let items;
  try {
    items = await store.listOpenItems({ supabase, limit });
  } catch (error) {
    if (isRoadmapDeliveredSchemaPending(error)) {
      result.pending = true;
      console.warn("  roadmap-delivered: migration ikke applied endnu, springer over");
      return result;
    }
    throw error;
  }

  for (const item of items) {
    result.items += 1;
    let itemFailed = false;
    const claimedByOthers = [];
    try {
      const voters = await store.listHighVoters({ supabase, itemId: item.id });
      for (const userId of voters) {
        let claimed = false;
        try {
          claimed = await store.claim({ supabase, itemId: item.id, userId, sentAtIso: nowIso });
        } catch (error) {
          if (isRoadmapDeliveredSchemaPending(error)) {
            result.pending = true;
            return result;
          }
          throw error;
        }
        if (!claimed) { result.skipped += 1; claimedByOthers.push(userId); continue; }
        try {
          await notify({
            supabase, userId, type: ROADMAP_DELIVERED_TYPE, relatedId: item.id, now,
            ...roadmapDeliveredKeys(item),
          });
          result.sent += 1;
        } catch (error) {
          if (isForeignKeyViolation(error)) { result.skipped += 1; continue; }
          itemFailed = true;
          result.failed += 1;
          captureException(error, { tags: { flow: "notifications", stage: "roadmap-delivered-notify" }, extra: { itemId: item.id } });
          try {
            await store.release({ supabase, itemId: item.id, userId, sentAtIso: nowIso });
          } catch (releaseError) {
            captureException(releaseError, { tags: { flow: "notifications", stage: "roadmap-delivered-release" }, extra: { itemId: item.id } });
          }
        }
      }
      if (!itemFailed && await othersSettled({ store, supabase, itemId: item.id, userIds: claimedByOthers, now })) {
        await store.markItemDone({ supabase, itemId: item.id, nowIso });
      }
    } catch (error) {
      result.failed += 1;
      captureException(error, { tags: { flow: "notifications", stage: "roadmap-delivered-item" }, extra: { itemId: item.id } });
    }
  }
  return result;
}

/** Alle andres claims er aeldre end vinduet, saa ingen af dem kan rulles tilbage laengere. */
async function othersSettled({ store, supabase, itemId, userIds, now }) {
  if (userIds.length === 0) return true;
  const times = await store.listReceiptTimes({ supabase, itemId });
  const cutoff = now.getTime() - ROADMAP_DELIVERED_PENDING_GRACE_MS;
  return userIds.every((userId) => {
    const sentAt = Date.parse(times.get(userId) ?? "");
    return Number.isFinite(sentAt) && sentAt <= cutoff;
  });
}
