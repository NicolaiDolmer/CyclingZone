// Transfer-profit pr. rytter — Refs #1107.
//
// Udleder købspris vs. salgspris pr. rytter fra holdets transferhistorik
// (GET /api/teams/:id/transfer-history, bygget i backend/lib/teamTransferHistory.js).
// Der findes (endnu) ingen acquisition_price-kolonne (#1101), så købsprisen
// rekonstrueres fra historikkens events:
//
//   • auction/transfer med direction "in"  → køb til `amount`
//   • auction/transfer med direction "out" → salg til `amount`
//     (auktion uden bud har amount 0 / ingen vinder — rytteren blev IKKE solgt)
//   • swap → ejerskifte uden kendt pr.-rytter-pris: event.rider kom IND
//     (køb til ukendt pris), event.rider_swapped røg UD (ingen profit-række —
//     cash_adjustment dækker hele pakken, ikke én rytter)
//   • loan → intet ejerskifte, ignoreres
//
// En rytter solgt uden et forudgående køb i historikken (fx start-trup eller
// swap-erhvervet) får buyAmount=null → profit kan ikke beregnes (vises som
// ukendt i UI, og tæller ikke med i totalen).
//
// Fortegns-/sæsonlogik bygger på den rettede historik (#984/#1226/#1227):
// direction er rytter-centrisk for auction/transfer/loan; for swap er
// event.rider altid den modtagne rytter og event.rider_swapped den afgivne.

const CASH_TRADE_TYPES = new Set(["auction", "transfer"]);

function toTime(date) {
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Beregn realiserede handler (køb→salg) pr. rytter ud fra holdets
 * transferhistorik-events (team-centriske, som API'et leverer dem).
 *
 * @param {Array} events — events fra /api/teams/:id/transfer-history
 * @returns {{ trades: Array, totals: { realizedProfit: number, knownTradeCount: number, tradeCount: number } }}
 *   trades sorteret nyeste salg først. profit er null når købsprisen er ukendt.
 */
export function computeTransferProfit(events) {
  // 1) Byg pr.-rytter-lister af ejerskifte-"ben" (in/out).
  const legsByRider = new Map();

  function addLeg(rider, leg) {
    if (!rider?.id) return;
    if (!legsByRider.has(rider.id)) legsByRider.set(rider.id, { rider, legs: [] });
    legsByRider.get(rider.id).legs.push(leg);
  }

  for (const ev of events || []) {
    if (ev?.type === "loan") continue;

    if (ev?.type === "swap") {
      // event.rider = modtaget rytter, event.rider_swapped = afgivet rytter
      // (uafhængigt af `direction`, som for swaps følger cash-flowet).
      addLeg(ev.rider, { kind: "in", type: "swap", amount: null, date: ev.date, seasonNumber: ev.season_number ?? null });
      addLeg(ev.rider_swapped, { kind: "out", type: "swap", amount: null, date: ev.date, seasonNumber: ev.season_number ?? null });
      continue;
    }

    if (!CASH_TRADE_TYPES.has(ev?.type)) continue;
    const amount = ev.amount ?? 0;

    if (ev.direction === "in") {
      addLeg(ev.rider, { kind: "in", type: ev.type, amount, date: ev.date, seasonNumber: ev.season_number ?? null });
    } else if (ev.direction === "out") {
      // Gennemført auktion uden bud (amount 0, ingen vinder) = intet salg.
      if (ev.type === "auction" && !(amount > 0)) continue;
      addLeg(ev.rider, { kind: "out", type: ev.type, amount, date: ev.date, seasonNumber: ev.season_number ?? null });
    }
  }

  // 2) Gå hver rytters ben igennem kronologisk og par køb→salg.
  const trades = [];

  for (const { rider, legs } of legsByRider.values()) {
    legs.sort((a, b) => {
      const dt = toTime(a.date) - toTime(b.date);
      if (dt !== 0) return dt;
      // Tie-break ved identisk timestamp: køb før salg.
      return (a.kind === "in" ? 0 : 1) - (b.kind === "in" ? 0 : 1);
    });

    let currentBuy = null;
    for (const leg of legs) {
      if (leg.kind === "in") {
        currentBuy = leg;
        continue;
      }
      // kind === "out"
      if (leg.type === "swap") {
        // Rytteren forlod holdet uden kontant salgspris — ingen profit-række.
        currentBuy = null;
        continue;
      }
      const buyAmount = currentBuy ? currentBuy.amount : null;
      trades.push({
        rider,
        buyAmount,
        buyDate: currentBuy ? currentBuy.date : null,
        buyType: currentBuy ? currentBuy.type : null,
        sellAmount: leg.amount,
        sellDate: leg.date,
        sellType: leg.type,
        sellSeasonNumber: leg.seasonNumber,
        profit: buyAmount != null ? leg.amount - buyAmount : null,
      });
      currentBuy = null;
    }
  }

  trades.sort((a, b) => toTime(b.sellDate) - toTime(a.sellDate));

  let realizedProfit = 0;
  let knownTradeCount = 0;
  for (const tr of trades) {
    if (tr.profit != null) {
      realizedProfit += tr.profit;
      knownTradeCount += 1;
    }
  }

  return {
    trades,
    totals: { realizedProfit, knownTradeCount, tradeCount: trades.length },
  };
}
