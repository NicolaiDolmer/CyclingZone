// #2401/#2208: "bid_received" (sælgers besked pr. bud på egen rytter) er en
// hyppig kilde til støjende/dobbelte bekræftelses-beskeder — en travl auktion
// kan generere mange bid_received-rækker for samme related_id (auktions-id).
// Samme mønster som auction_outbid: aggregér dem under auktionen ER aktiv, og
// skjul dem HELT når auktionen er afgjort (auction_won/auction_lost findes for
// samme related_id) — så sælgeren kun ser ÉN klar besked pr. hændelse (den
// endelige "solgt for X CZ$"), ikke bud-støjen der førte dertil.
//
// #4981: PR #5363 tilføjede "auction_proxy_outbid" — beskeden man får når ens
// EGET autobud måtte hæve sig for at beholde føringen. Den deler related_id
// (auktions-id) med auction_outbid og opstår i samme budkrig, så en aktiv
// byder fik én indbakke-linje pr. udfordring. De to typer lægges derfor i
// SAMME bøtte ("auction_bidding"): én linje pr. auktion, ikke én pr. type.
// Bøtten findes netop fordi nøglen ikke må være selve typen — så ville et
// tabt/genvundet føringsskifte splitte auktionen i to linjer igen.
const AGGREGATE_GROUPS = {
  auction_outbid: "auction_bidding",
  auction_proxy_outbid: "auction_bidding",
  bid_received: "bid_received",
};

// #3549: sælgerens "afsluttet"-besked skiftede type fra "auction_won" til
// "auction_sold" (sælgeren er selv ikke KØBER, så "won" var forkert delt type
// med køberens besked — se auctionFinalization.js). bid_received er
// SÆLGERENS aggregerede bud-støj, så dens terminator skal matche sælgerens
// faktiske afsluttet-type, ellers "hænger" bud-aggregatet uendeligt hos
// sælgeren efter et salg.
const TERMINATING_TYPES = {
  auction_bidding: new Set(["auction_won", "auction_lost"]),
  bid_received: new Set(["auction_won", "auction_lost", "auction_sold"]),
};

export function aggregateKey(type, relatedId) {
  return `${type}|${relatedId}`;
}

// Bøtten en type aggregeres under, eller null hvis typen aldrig aggregeres.
// Eksporteret så kalderen kan gruppere/teste uden at kende bøtte-tabellen.
export function aggregateGroup(type) {
  return AGGREGATE_GROUPS[type] ?? null;
}

export function groupNotifications(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return [];

  const terminated = new Map();
  for (const n of notifications) {
    if (!n.related_id) continue;
    for (const [group, terminators] of Object.entries(TERMINATING_TYPES)) {
      if (terminators.has(n.type)) {
        if (!terminated.has(group)) terminated.set(group, new Set());
        terminated.get(group).add(n.related_id);
      }
    }
  }

  const aggregates = new Map();
  const singles = [];

  for (const n of notifications) {
    const group = aggregateGroup(n.type);
    if (group && n.related_id) {
      if (terminated.get(group)?.has(n.related_id)) continue;
      const key = aggregateKey(group, n.related_id);
      if (!aggregates.has(key)) {
        aggregates.set(key, { group, related_id: n.related_id, items: [] });
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
      // #4981: bøtten kan rumme flere typer (auction_outbid +
      // auction_proxy_outbid). `type` er DEN NYESTE beskeds type, så ikon,
      // farve, titel og tekst altid beskriver den aktuelle tilstand — et reelt
      // tab af føringen må aldrig gemme sig bag en "du fører stadig"-tekst.
      // `type_counts` lader kalderen sige sandheden om resten af bøtten.
      const typeCounts = {};
      for (const item of sorted) {
        typeCounts[item.type] = (typeCounts[item.type] ?? 0) + 1;
      }
      result.push({
        kind: "aggregate",
        key: aggregateKey(agg.group, agg.related_id),
        group: agg.group,
        type: latest.type,
        type_counts: typeCounts,
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
