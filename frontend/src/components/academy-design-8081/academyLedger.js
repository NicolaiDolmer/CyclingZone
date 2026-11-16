// #8081 / #8060: akademi-regnskabet pr. sæson, som det tegnes i de tre
// designudgaver (?design8081=a|b|c). Ren beregning uden netværk, så reglen kan
// låses af node --test og senere flyttes uændret til backend (academyPnl.ts).
//
// Reglen fra #8060 del A: udgifts- og indtægtssiden skal tælle de SAMME ryttere.
// Akademiets ryttere er alle, holdet har fået ind som ungdomsryttere: hentet fra
// akademiets tilbud (academy_intake signed) ELLER vundet på ungdomsauktion
// (auctions.is_youth, holdet som vinder). Sælges en af dem senere, tæller salget
// med. Før talte udgiften begge kilder, mens salget kun kendte tilbuddene.
//
// Drift-linjen vises kun, når der er bogført drift i de viste sæsoner; er den kun
// bogført i ældre sæsoner, mærkes den som historisk (#8060 punkt 2).

export const LEDGER_SOURCE = Object.freeze({ OFFER: "offer", YOUTH_AUCTION: "youthAuction" });

const YOUTH_AUCTION_CODE = "tx.youthAuctionWin";

/** En ungdomsauktions-sejr bogføres som academy_signing; metadata/entity skiller den fra en hentning. */
/** @param {any} row */
export function classifySigning(row) {
  if (row?.metadata?.code === YOUTH_AUCTION_CODE) return LEDGER_SOURCE.YOUTH_AUCTION;
  if (row?.related_entity_type === "auction") return LEDGER_SOURCE.YOUTH_AUCTION;
  return LEDGER_SOURCE.OFFER;
}

/** #785: en auktion uden vinder og uden garanteret salg er intet salg. */
/** @param {any} auction */
export function isRealizedSale(auction) {
  return Boolean(auction?.current_bidder_id) || Boolean(auction?.is_guaranteed_sale);
}

/** @param {any} iso */
function toTime(iso) {
  const ms = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Sæsonen et tidspunkt hører til: den sæson hvis periode dækker det, ellers den
 * seneste sæson der var startet. null når intet kan afgøres.
 */
/** @param {any[]} seasons @param {any} iso @returns {any} */
export function seasonForDate(seasons, iso) {
  const at = toTime(iso);
  if (at == null || !Array.isArray(seasons) || seasons.length === 0) return null;
  /** @type {any} */
  let latestStarted = null;
  for (const s of seasons) {
    const start = toTime(s.start_date);
    if (start == null || start > at) continue;
    const end = toTime(s.end_date);
    if (end != null && at <= end + 86_400_000 - 1) return s;
    if (!latestStarted || start > (toTime(latestStarted.start_date) ?? 0)) latestStarted = s;
  }
  return latestStarted;
}

/** @param {any} rider */
function nameOf(rider) {
  const name = `${rider?.firstname ?? ""} ${rider?.lastname ?? ""}`.trim();
  return name || null;
}

/**
 * Akademiets rytterkreds: hentet fra tilbud + vundet på ungdomsauktion.
 * Map riderId -> { riderId, riderName, origin }.
 */
/** @param {any} [args] @returns {Map<string, any>} */
export function buildAcademyRiderPool({ signedIntake = [], youthAuctionWins = [] } = {}) {
  const pool = new Map();
  for (const row of signedIntake) {
    if (!row?.rider_id) continue;
    pool.set(row.rider_id, { riderId: row.rider_id, riderName: nameOf(row.riders), origin: LEDGER_SOURCE.OFFER });
  }
  for (const a of youthAuctionWins) {
    if (!a?.rider_id || !isRealizedSale(a)) continue;
    if (pool.has(a.rider_id)) continue;
    pool.set(a.rider_id, { riderId: a.rider_id, riderName: nameOf(a.riders), origin: LEDGER_SOURCE.YOUTH_AUCTION });
  }
  return pool;
}

/**
 * Holdets gennemførte salg af ryttere fra akademiets kreds (senior-auktion eller
 * transfermarked). Nyeste først, med sæson påsat.
 */
/** @param {any} [args] @returns {any[]} */
export function buildLedgerSales({ auctionRows = [], transferRows = [], pool = new Map(), seasons = [] } = {}) {
  const sales = [];
  for (const a of auctionRows) {
    if (!pool.has(a?.rider_id) || !isRealizedSale(a)) continue;
    const price = Number(a.current_price) || 0;
    sales.push({ riderId: a.rider_id, soldAt: a.actual_end || null, price, via: "auction" });
  }
  for (const o of transferRows) {
    if (!pool.has(o?.rider_id)) continue;
    const price = Number(o.counter_amount ?? o.offer_amount) || 0;
    if (price <= 0) continue;
    sales.push({ riderId: o.rider_id, soldAt: o.updated_at || null, price, via: "transfer" });
  }
  return sales
    .map((s) => {
      const member = pool.get(s.riderId);
      const season = seasonForDate(seasons, s.soldAt);
      return {
        ...s,
        riderName: member?.riderName ?? null,
        origin: member?.origin ?? LEDGER_SOURCE.OFFER,
        seasonId: season?.id ?? null,
        seasonNumber: season?.number ?? null,
      };
    })
    .sort((a, b) => (toTime(b.soldAt) ?? 0) - (toTime(a.soldAt) ?? 0));
}

/** @param {any} season @param {any} currentSeasonId */
function emptyRow(season, currentSeasonId) {
  return {
    seasonId: season?.id ?? null,
    seasonNumber: season?.number ?? null,
    isCurrent: season?.id != null && season.id === currentSeasonId,
    offerSignings: 0,
    youthAuctionBuys: 0,
    drift: 0,
    salesCount: 0,
    salesProceeds: 0,
    net: 0,
  };
}

/**
 * Regnskabet pr. sæson: denne sæson øverst, tidligere sæsoner under, og en
 * samlet linje. Udgifter er positive beløb (vises med minus i UI'et).
 */
/** @param {any} [args] @returns {any} */
export function buildSeasonLedger({ financeRows = [], sales = [], seasons = [], currentSeasonId = null } = {}) {
  const byId = new Map(seasons.map((s) => [s.id, s]));
  const rows = new Map();
  const rowFor = (season) => {
    const key = season?.id ?? "none";
    if (!rows.has(key)) rows.set(key, emptyRow(season, currentSeasonId));
    return rows.get(key);
  };
  const current = byId.get(currentSeasonId) ?? null;
  if (current) rowFor(current);

  for (const f of financeRows) {
    const season = (f.season_id && byId.get(f.season_id)) || seasonForDate(seasons, f.created_at);
    const amount = Math.abs(Number(f.amount) || 0);
    const row = rowFor(season);
    if (f.type === "academy_drift") row.drift += amount;
    else if (f.type === "academy_signing") {
      if (classifySigning(f) === LEDGER_SOURCE.YOUTH_AUCTION) row.youthAuctionBuys += amount;
      else row.offerSignings += amount;
    }
  }
  for (const s of sales) {
    const row = rowFor(s.seasonId != null ? byId.get(s.seasonId) : null);
    row.salesCount += 1;
    row.salesProceeds += s.price;
  }

  const list = [...rows.values()];
  for (const r of list) r.net = r.salesProceeds - r.offerSignings - r.youthAuctionBuys - r.drift;
  list.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return (b.seasonNumber ?? -1) - (a.seasonNumber ?? -1);
  });

  const total = list.reduce((acc, r) => {
    acc.offerSignings += r.offerSignings;
    acc.youthAuctionBuys += r.youthAuctionBuys;
    acc.drift += r.drift;
    acc.salesCount += r.salesCount;
    acc.salesProceeds += r.salesProceeds;
    acc.net += r.net;
    return acc;
  }, { offerSignings: 0, youthAuctionBuys: 0, drift: 0, salesCount: 0, salesProceeds: 0, net: 0 });

  const currentRow = list.find((r) => r.isCurrent) ?? null;
  return {
    rows: list,
    total,
    current: currentRow,
    showDrift: total.drift > 0,
    driftIsHistoric: total.drift > 0 && (currentRow?.drift ?? 0) === 0,
  };
}
