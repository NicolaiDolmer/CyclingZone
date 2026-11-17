// #8060: visningsmodellen for akademi-regnskabet pr. sæson. Tallene regnes i
// backend (backend/lib/academyPnl.ts, feltet `ledger` på GET /api/academy/pnl);
// her læses svaret defensivt og lægges i den rækkefølge fanen tegner det.

export type LedgerOrigin = "offer" | "youthAuction";

export type LedgerTotals = {
  offerSignings: number;
  youthAuctionBuys: number;
  drift: number;
  salesCount: number;
  salesProceeds: number;
  net: number;
};

export type LedgerSeasonRow = LedgerTotals & {
  seasonId: string | null;
  seasonNumber: number | null;
  isCurrent: boolean;
};

export type LedgerSale = {
  riderId: string;
  riderName: string | null;
  soldAt: string | null;
  price: number;
  via: "auction" | "transfer";
  origin: LedgerOrigin;
  seasonId: string | null;
  seasonNumber: number | null;
};

export type AcademyLedger = {
  seasons: LedgerSeasonRow[];
  total: LedgerTotals;
  currentSeasonId: string | null;
  showDrift: boolean;
  driftIsHistoric: boolean;
  poolSize: number;
  sales: LedgerSale[];
};

export type LineKey = "offerSignings" | "youthAuctionBuys" | "drift" | "salesProceeds";
export type LineDef = { key: LineKey; labelKey: string; sign: 1 | -1 };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

function totalsOf(raw: Record<string, unknown> | null | undefined): LedgerTotals {
  return {
    offerSignings: num(raw?.offerSignings),
    youthAuctionBuys: num(raw?.youthAuctionBuys),
    drift: num(raw?.drift),
    salesCount: num(raw?.salesCount),
    salesProceeds: num(raw?.salesProceeds),
    net: num(raw?.net),
  };
}

/**
 * Læs `ledger` ud af /api/academy/pnl-svaret. null når feltet mangler, dvs.
 * kontakten academy_page_v2_8081 er slukket for vieweren.
 */
export function parseAcademyLedger(body: unknown): AcademyLedger | null {
  const raw = (body as { ledger?: unknown } | null | undefined)?.ledger as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.seasons)) return null;
  const seasons = (raw.seasons as Record<string, unknown>[]).map((r) => ({
    ...totalsOf(r),
    seasonId: typeof r?.seasonId === "string" ? r.seasonId : null,
    seasonNumber: typeof r?.seasonNumber === "number" ? r.seasonNumber : null,
    isCurrent: r?.isCurrent === true,
  }));
  const sales = (Array.isArray(raw.sales) ? (raw.sales as Record<string, unknown>[]) : [])
    .filter((s) => typeof s?.riderId === "string")
    .map((s) => ({
      riderId: s.riderId as string,
      riderName: typeof s.riderName === "string" ? s.riderName : null,
      soldAt: typeof s.soldAt === "string" ? s.soldAt : null,
      price: num(s.price),
      via: s.via === "transfer" ? "transfer" as const : "auction" as const,
      origin: s.origin === "youthAuction" ? "youthAuction" as const : "offer" as const,
      seasonId: typeof s.seasonId === "string" ? s.seasonId : null,
      seasonNumber: typeof s.seasonNumber === "number" ? s.seasonNumber : null,
    }));
  return {
    seasons,
    total: totalsOf(raw.total as Record<string, unknown> | undefined),
    currentSeasonId: typeof raw.currentSeasonId === "string" ? raw.currentSeasonId : null,
    showDrift: raw.showDrift === true,
    driftIsHistoric: raw.driftIsHistoric === true,
    poolSize: num(raw.poolSize),
    sales,
  };
}

/**
 * Kolonnerne/linjerne i den rækkefølge de tegnes. Drift står kun med, når der
 * er bogført drift i de viste sæsoner, og mærkes historisk når den ikke
 * længere opkræves (#8060 punkt 2). Udgifter har fortegn -1 (vises med minus).
 */
export function ledgerLines(ledger: Pick<AcademyLedger, "showDrift" | "driftIsHistoric">): LineDef[] {
  return [
    { key: "offerSignings", labelKey: "offerSignings", sign: -1 },
    { key: "youthAuctionBuys", labelKey: "youthAuctionBuys", sign: -1 },
    ...(ledger.showDrift
      ? [{ key: "drift" as const, labelKey: ledger.driftIsHistoric ? "driftHistoric" : "drift", sign: -1 as const }]
      : []),
    { key: "salesProceeds", labelKey: "sales", sign: 1 },
  ];
}

/** Et beløb med fortegn som tekst-signal; 0 vises uden minus. */
export function signedAmount(value: number, sign: 1 | -1): number {
  const v = sign * value;
  return Object.is(v, -0) ? 0 : v;
}

/** Tone for netto: farven er ekstra signal, minus-tegnet står altid i tallet. */
export function netTone(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

export const SALES_PREVIEW = 8;
