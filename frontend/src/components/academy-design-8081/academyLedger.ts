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

// Rå PostgREST-rækker; kun de felter filen selv læser, bruges.
export type Row = Record<string, any>;
export type LedgerOrigin = "offer" | "youthAuction";
export type PoolMember = { riderId: string; riderName: string | null; origin: LedgerOrigin };
export type LedgerSale = {
  riderId: string;
  soldAt: string | null;
  price: number;
  via: "auction" | "transfer";
  riderName: string | null;
  origin: LedgerOrigin;
  seasonId: string | null;
  seasonNumber: number | null;
};
export type LedgerTotals = {
  offerSignings: number;
  youthAuctionBuys: number;
  drift: number;
  salesCount: number;
  salesProceeds: number;
  net: number;
};
export type LedgerRow = LedgerTotals & { seasonId: string | null; seasonNumber: number | null; isCurrent: boolean };
export type SeasonLedger = {
  rows: LedgerRow[];
  total: LedgerTotals;
  current: LedgerRow | null;
  showDrift: boolean;
  driftIsHistoric: boolean;
};

export const LEDGER_SOURCE = Object.freeze({ OFFER: "offer", YOUTH_AUCTION: "youthAuction" } as const);

const YOUTH_AUCTION_CODE = "tx.youthAuctionWin";

/** En ungdomsauktions-sejr bogføres som academy_signing; metadata/entity skiller den fra en hentning. */
export function classifySigning(row: Row | null | undefined): LedgerOrigin {
  if (row?.metadata?.code === YOUTH_AUCTION_CODE) return LEDGER_SOURCE.YOUTH_AUCTION;
  if (row?.related_entity_type === "auction") return LEDGER_SOURCE.YOUTH_AUCTION;
  return LEDGER_SOURCE.OFFER;
}

/** #785: en auktion uden vinder og uden garanteret salg er intet salg. */
export function isRealizedSale(auction: Row | null | undefined): boolean {
  return Boolean(auction?.current_bidder_id) || Boolean(auction?.is_guaranteed_sale);
}

function toTime(iso: unknown): number | null {
  const ms = iso ? new Date(iso as string).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Sæsonen et tidspunkt hører til: den senest startede sæson på det tidspunkt.
 * Slutdatoen bruges bevidst ikke: ved et sæsonskifte samme dag overlapper den
 * gamle sæsons slutdato den nyes startdato, og så skal den nye sæson vinde
 * (Codex-fund på #8249). null når intet kan afgøres. Når regnskabet flyttes til
 * backend, bruges salgets bogførte season_id i stedet for datoen.
 */
export function seasonForDate(seasons: readonly Row[] | null | undefined, iso: unknown): Row | null {
  const at = toTime(iso);
  if (at == null || !Array.isArray(seasons) || seasons.length === 0) return null;
  let latestStarted: Row | null = null;
  for (const s of seasons) {
    const start = toTime(s.start_date);
    if (start == null || start > at) continue;
    if (!latestStarted || start > (toTime(latestStarted.start_date) ?? 0)) latestStarted = s;
  }
  return latestStarted;
}

function nameOf(rider: Row | null | undefined): string | null {
  const name = `${rider?.firstname ?? ""} ${rider?.lastname ?? ""}`.trim();
  return name || null;
}

/** Akademiets rytterkreds: hentet fra tilbud + vundet på ungdomsauktion. */
export function buildAcademyRiderPool(
  { signedIntake = [], youthAuctionWins = [] }: { signedIntake?: readonly Row[]; youthAuctionWins?: readonly Row[] } = {},
): Map<string, PoolMember> {
  const pool = new Map<string, PoolMember>();
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
export function buildLedgerSales({ auctionRows = [], transferRows = [], pool = new Map(), seasons = [] }: {
  auctionRows?: readonly Row[];
  transferRows?: readonly Row[];
  pool?: ReadonlyMap<string, PoolMember>;
  seasons?: readonly Row[];
} = {}): LedgerSale[] {
  const raw: { riderId: string; soldAt: string | null; price: number; via: "auction" | "transfer" }[] = [];
  for (const a of auctionRows) {
    if (!pool.has(a?.rider_id) || !isRealizedSale(a)) continue;
    raw.push({ riderId: a.rider_id, soldAt: a.actual_end || null, price: Number(a.current_price) || 0, via: "auction" });
  }
  for (const o of transferRows) {
    if (!pool.has(o?.rider_id)) continue;
    const price = Number(o.counter_amount ?? o.offer_amount) || 0;
    if (price <= 0) continue;
    raw.push({ riderId: o.rider_id, soldAt: o.updated_at || null, price, via: "transfer" });
  }
  return raw
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

function emptyRow(season: Row | null | undefined, currentSeasonId: string | null): LedgerRow {
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
export function buildSeasonLedger({ financeRows = [], sales = [], seasons = [], currentSeasonId = null }: {
  financeRows?: readonly Row[];
  sales?: readonly (Pick<LedgerSale, "price" | "seasonId"> & Partial<LedgerSale>)[];
  seasons?: readonly Row[];
  currentSeasonId?: string | null;
} = {}): SeasonLedger {
  const byId = new Map<string, Row>(seasons.map((s) => [s.id, s]));
  const rows = new Map<string, LedgerRow>();
  const rowFor = (season: Row | null | undefined): LedgerRow => {
    const key = season?.id ?? "none";
    let row = rows.get(key);
    if (!row) {
      row = emptyRow(season, currentSeasonId);
      rows.set(key, row);
    }
    return row;
  };
  const current = currentSeasonId ? byId.get(currentSeasonId) : undefined;
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

  const total: LedgerTotals = { offerSignings: 0, youthAuctionBuys: 0, drift: 0, salesCount: 0, salesProceeds: 0, net: 0 };
  for (const r of list) {
    total.offerSignings += r.offerSignings;
    total.youthAuctionBuys += r.youthAuctionBuys;
    total.drift += r.drift;
    total.salesCount += r.salesCount;
    total.salesProceeds += r.salesProceeds;
    total.net += r.net;
  }

  const currentRow = list.find((r) => r.isCurrent) ?? null;
  return {
    rows: list,
    total,
    current: currentRow,
    showDrift: total.drift > 0,
    driftIsHistoric: total.drift > 0 && (currentRow?.drift ?? 0) === 0,
  };
}
