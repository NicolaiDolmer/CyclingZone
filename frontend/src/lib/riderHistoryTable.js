// Historik-fanens rækkemodel (#2000): normalisér buildRiderHistory-events
// (GET /api/riders/:id/history — auction/transfer/swap) + auktionsbud fra
// bid-timelinen (GET /api/riders/:id/bid-timeline) til ÉN kronologisk tabel.
//
// Bud-rækker dækker kun rytterens SENESTE auktion — det er alt endpointet
// udstiller, og ældre auktioners bud er bevidst ikke offentlig historik.
// Afviste/pending transferbud er private (privacy-kontrakten i backend/lib/
// riderHistory.js) og optræder aldrig her.
//
// BEVIDST SCOPE ift. handoff-prototypens rækketyper: prototypen viser også
// Resultat/Scouting/Interesse/Kontrakt/Oprindelse-rækker. Resultater lever i
// Resultater-fanen og scouting-/interesse-events i Interesse-fanen (dubletter
// på tværs af faner giver støj); Kontrakt- og Oprindelse-events har intet
// datalag endnu (kontraktændringer logges ikke historisk) — de kan tilføjes
// når/hvis et event-lag findes, frem for at opfinde rækker.

export const HISTORY_KINDS = ["auction", "bid", "transfer", "swap"];

// Beløbet pr. kind — null → "—" i tabellen.
export function historyRowAmount(row) {
  switch (row?.kind) {
    case "auction": return row.price ?? null;
    case "bid": return row.amount ?? null;
    case "transfer": return row.price ?? null;
    case "swap": return row.cash_adjustment || null; // 0 = intet mellemværende → "—"
    default: return null;
  }
}

export function buildHistoryRows({ events = [], bidTimeline = null } = {}) {
  const rows = [];
  for (const e of events || []) {
    if (!e || typeof e !== "object") continue;
    // #3708: en gennemført auktion uden bud er ikke en handel — bare støj i
    // rytterens offentlige historik (samme princip som TeamTransferHistoryTab
    // /#2400, blot uden toggle her: denne fane er ikke ejerens egen, og der er
    // ingen grund til at kunne slå "ingen bud"-rækker til igen).
    if (e.type === "auction" && e.no_sale) continue;
    const kind = e.type;
    if (!HISTORY_KINDS.includes(kind)) continue;
    rows.push({ ...e, kind });
  }
  for (const b of bidTimeline?.bid_timeline ?? []) {
    if (!b || typeof b !== "object") continue;
    rows.push({
      kind: "bid",
      date: b.bid_time ?? null,
      amount: b.amount ?? null,
      team_id: b.team_id ?? null,
      team_name: b.team_name ?? null,
      is_proxy: Boolean(b.is_proxy),
    });
  }
  // Nyeste først; rækker uden dato sidst (drop aldrig ægte events).
  return rows.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : -Infinity;
    const tb = b.date ? new Date(b.date).getTime() : -Infinity;
    return tb - ta;
  });
}
