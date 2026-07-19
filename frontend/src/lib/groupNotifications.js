// #2401/#2208: "bid_received" (sælgers besked pr. bud på egen rytter) er en
// hyppig kilde til støjende/dobbelte bekræftelses-beskeder — en travl auktion
// kan generere mange bid_received-rækker for samme related_id (auktions-id).
// Samme mønster som auction_outbid: aggregér dem under auktionen ER aktiv, og
// skjul dem HELT når auktionen er afgjort (auction_won/auction_lost findes for
// samme related_id) — så sælgeren kun ser ÉN klar besked pr. hændelse (den
// endelige "solgt for X CZ$"), ikke bud-støjen der førte dertil.
const AGGREGATABLE_TYPES = new Set(["auction_outbid", "bid_received"]);

const TERMINATING_TYPES = {
  auction_outbid: new Set(["auction_won", "auction_lost"]),
  bid_received: new Set(["auction_won", "auction_lost"]),
};

export function aggregateKey(type, relatedId) {
  return `${type}|${relatedId}`;
}

export function groupNotifications(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return [];

  const terminated = new Map();
  for (const n of notifications) {
    if (!n.related_id) continue;
    for (const [aggType, terminators] of Object.entries(TERMINATING_TYPES)) {
      if (terminators.has(n.type)) {
        if (!terminated.has(aggType)) terminated.set(aggType, new Set());
        terminated.get(aggType).add(n.related_id);
      }
    }
  }

  const aggregates = new Map();
  const singles = [];

  for (const n of notifications) {
    if (AGGREGATABLE_TYPES.has(n.type) && n.related_id) {
      if (terminated.get(n.type)?.has(n.related_id)) continue;
      const key = aggregateKey(n.type, n.related_id);
      if (!aggregates.has(key)) {
        aggregates.set(key, { type: n.type, related_id: n.related_id, items: [] });
      }
      aggregates.get(key).items.push(n);
    } else {
      singles.push({ kind: "single", notification: n });
    }
  }

  const result = [...singles];
  for (const agg of aggregates.values()) {
    if (agg.items.length === 1) {
      result.push({ kind: "single", notification: agg.items[0] });
    } else {
      const sorted = [...agg.items].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );
      const latest = sorted[0];
      const earliest = sorted[sorted.length - 1];
      result.push({
        kind: "aggregate",
        key: aggregateKey(agg.type, agg.related_id),
        type: agg.type,
        related_id: agg.related_id,
        items: sorted,
        count: sorted.length,
        latest_at: latest.created_at,
        earliest_at: earliest.created_at,
        any_unread: sorted.some((i) => !i.is_read),
        sample_title: latest.title,
        sample_message: latest.message,
        // #666: carry metadata so aggregate-rendering can use i18n via
        // renderBackendMessage. Falls back to title/message if absent.
        sample_metadata: latest.metadata ?? null,
      });
    }
  }

  result.sort((a, b) => {
    const aTs = a.kind === "single" ? a.notification.created_at : a.latest_at;
    const bTs = b.kind === "single" ? b.notification.created_at : b.latest_at;
    return new Date(bTs) - new Date(aTs);
  });

  return result;
}
