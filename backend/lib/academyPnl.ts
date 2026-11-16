// Akademi-regnskabet (#2485, addendum V3 fra 2026-07-16-traening-ungdom-
// verdensklasse-addendum-design.md §3). Ren aggregerings-logik for GET
// /api/academy/pnl — INGEN Supabase-kald her (routen henter rows, denne fil
// beregner), så det er testbart uden DB-mock. INGEN nye økonomi-mekanikker:
// alt læses af eksisterende data (finance_transactions, academy_intake,
// auctions, transfer_offers, riders.salary). Viser KUN realiseret markedsværdi
// (faktiske salg), aldrig projektion af fremtidig værdi (#2100 er ejer-udskudt).
//
// #2793: salgs-detektionen matcher IKKE længere på academy_graduation (den
// tabel er praktisk talt tom/uverificeret i prod — kun graduerings-flowets
// "sell"-handling skrev til den, og en akademi-signet rytter kan lige så godt
// sælges på almindelig auktion eller transfermarkedet UDEN at gå gennem
// graduering). Salgs-poolen er nu ALLE nogensinde signede academy_intake-rækker
// for holdet, matchet mod gennemførte auktioner/transfers.
//
// #3845 (17/8, "akademi-ryttere kan listes direkte") lukkede sidste hul: en
// akademi-rytter kan nu SÆLGES uden først at være promoveret til senior — han
// er stadig is_academy=true på oprettelsestidspunktet, og graduerer atomisk
// ved handlens gennemførelse (auctionFinalization.js/transferExecution.js's
// graduatePatch). Kræver INGEN ændring her: matchingen nedenfor er allerede
// is_academy-agnostisk (kun rider_id ∈ nogensinde-signede academy_intake +
// completed auction/accepted transfer), og en direkte akademi-auktion får
// samme is_youth=false-default som enhver anden senior-auktion (POST
// /auctions sætter den ikke eksplicit). Se academyPnl.test.js.

type NumericInput = number | string | null | undefined;
type RosterRow = { salary?: NumericInput };
type FinanceRow = { type?: string | null; amount?: NumericInput };
type RiderName = { firstname?: string | null; lastname?: string | null };
export type AuctionSaleInput = {
  rider_id: string;
  current_bidder_id?: string | null;
  is_guaranteed_sale?: boolean | null;
  current_price?: NumericInput;
  starting_price?: NumericInput;
  actual_end?: string | null;
};
export type TransferSaleInput = {
  rider_id: string;
  counter_amount?: NumericInput;
  offer_amount?: NumericInput;
  updated_at?: string | null;
};
type AcademySale = {
  riderId: string;
  riderName: string | null;
  soldAt: string | null;
  price: number;
  listedValue: number | null;
  premium: number | null;
  source: "auction" | "transfer";
};

/**
 * Nuværende akademi-trup: run-rate løn + pladser brugt. Et øjebliksbillede,
 * IKKE kumulativt betalt-til-dato — løn opkræves som ét samlet 'salary'-beløb
 * pr. hold pr. sæson og kan ikke splittes akademi/senior i finance_transactions.
 */
export function computeAcademyCurrent(
  rosterRows: readonly RosterRow[] = [],
  { slotsMax }: { slotsMax?: number | null } = {}
) {
  const payroll = rosterRows.reduce((sum, r) => sum + (Number(r.salary) || 0), 0);
  return { slotsUsed: rosterRows.length, slotsMax, payroll };
}

/** Kumulative akademi-specifikke pengebevægelser (drift + signing-fees), hele holdets historik. */
export function computeAcademyCumulative(financeRows: readonly FinanceRow[] = []) {
  let driftPaid = 0;
  let signingFeesPaid = 0;
  for (const row of financeRows) {
    const amt = Math.abs(Number(row.amount) || 0);
    if (row.type === "academy_drift") driftPaid += amt;
    else if (row.type === "academy_signing") signingFeesPaid += amt;
  }
  return { driftPaid, signingFeesPaid };
}

/**
 * #785: en gennemført auktion uden vinder (og uden garanteret salg) er intet
 * salg — current_price er den umødte startpris og må ikke tælle som pengestrøm.
 * Samme regel som teamTransferHistory.js.
 */
export function isRealizedSale(
  auction: Pick<AuctionSaleInput, "current_bidder_id" | "is_guaranteed_sale"> | null | undefined
) {
  return Boolean(auction?.current_bidder_id) || Boolean(auction?.is_guaranteed_sale);
}

function nameOf(rider: RiderName | null | undefined) {
  const name = `${rider?.firstname ?? ""} ${rider?.lastname ?? ""}`.trim();
  return name || null;
}

/**
 * Byg den realiserede salgs-liste (#2793). En akademi-udviklet rytter er
 * enhver rytter der nogensinde stod i academy_intake med status='signed' for
 * holdet — IKKE kun dem der passerede graduerings-flowet (academy_graduation
 * er praktisk talt tom/uverificeret i prod, se #2793). Matches derfor direkte
 * mod holdets GENNEMFØRTE salg, uanset om salget skete via en almindelig
 * senior-auktion ELLER via transfermarkedet:
 *
 *   - auctionRows: completed, seller_team_id=hold, is_youth=false,
 *     rider_id ∈ signede akademiryttere. #785-reglen (isRealizedSale)
 *     ekskluderer auktioner uden vinder/garanteret salg.
 *   - transferRows: transfer_offers med status='accepted' (den terminale
 *     gennemførte tilstand — 'window_pending' er endnu IKKE eksekveret, se
 *     transferExecution.js), seller_team_id=hold, rider_id ∈ signede
 *     akademiryttere.
 *
 * riderById kommer fra academy_intake-joinet (rider_id → {firstname,lastname}).
 *
 * "Salgspræmie" (premium) = current_price - starting_price for AUKTIONER: beløbet
 * budt op over rytterens markedsværdi PÅ SALGSTIDSPUNKTET (auctions.starting_price
 * = calculateRiderMarketValue ved auktions-oprettelse). Transfermarkedet har INGEN
 * tilsvarende markedsværdi-ved-oprettelse-baseline (asking_price sættes frit af
 * sælger) — premium er derfor `null` for transfer-salg, og tælles ikke med i
 * valueCreation (kun i salesProceeds, som er en ægte pengestrøm uanset kilde).
 */
export function buildAcademySales(
  auctionRows: readonly AuctionSaleInput[] = [],
  transferRows: readonly TransferSaleInput[] = [],
  riderById: ReadonlyMap<string, RiderName | null | undefined> = new Map()
) {
  const sales: AcademySale[] = [];
  for (const a of auctionRows) {
    if (!isRealizedSale(a)) continue;
    const price = Number(a.current_price) || 0;
    const listed = Number(a.starting_price) || 0;
    sales.push({
      riderId: a.rider_id,
      riderName: nameOf(riderById.get(a.rider_id)),
      soldAt: a.actual_end || null,
      price,
      listedValue: listed,
      premium: price - listed,
      source: "auction",
    });
  }
  for (const o of transferRows) {
    const price = Number(o.counter_amount ?? o.offer_amount) || 0;
    if (price <= 0) continue;
    sales.push({
      riderId: o.rider_id,
      riderName: nameOf(riderById.get(o.rider_id)),
      soldAt: o.updated_at || null,
      price,
      listedValue: null,
      premium: null,
      source: "transfer",
    });
  }
  // Preserve JavaScript Date subtraction coercion; these assertions erase at runtime.
  sales.sort(
    (a, b) =>
      (new Date(b.soldAt || 0) as unknown as number) -
      (new Date(a.soldAt || 0) as unknown as number)
  );
  return sales;
}

/** Saml det fulde P&L-payload. Kappet til de 20 seneste salg i UI-listen (drill-down, ikke krævet for summerne). */
export function summarizeAcademyPnl<
  TCurrent,
  TSale extends { price: number; premium?: number | null },
>({
  current,
  driftPaid,
  signingFeesPaid,
  sales,
}: {
  current: TCurrent;
  driftPaid: number;
  signingFeesPaid: number;
  sales: readonly TSale[];
}) {
  const salesProceeds = sales.reduce((sum, s) => sum + s.price, 0);
  // premium er null for transfer-salg (ingen markedsværdi-baseline) — tæller 0
  // i valueCreation, men prisen indgår stadig fuldt i salesProceeds ovenfor.
  const valueCreation = sales.reduce((sum, s) => sum + (s.premium ?? 0), 0);
  return {
    current,
    cumulative: {
      driftPaid,
      signingFeesPaid,
      salesProceeds,
      valueCreation,
      salesCount: sales.length,
      netCashFlow: salesProceeds - driftPaid - signingFeesPaid,
    },
    sales: sales.slice(0, 20),
  };
}

// ─── #8060: regnskabet pr. sæson med samme rytterkreds på begge sider ────────
//
// Fejlen før #8060: udgiften talte ALLE academy_signing-posteringer, også køb på
// ungdomsauktion, mens salgssiden kun kendte ryttere fra academy_intake. En
// rytter købt på ungdomsauktion og solgt igen gav derfor en udgift uden det
// tilhørende salg, og netto blev for negativ.
//
// Reglen nu: akademiets rytterkreds er alle ryttere holdet har fået ind som
// ungdomsryttere, hentet fra et akademitilbud (academy_intake signed) ELLER
// vundet på ungdomsauktion (auctions.is_youth, holdet som vinder). Udgiften
// deles i "hentet fra tilbud" og "købt på ungdomsauktion", og salget tæller
// enhver senere gennemført handel med en rytter fra kredsen. Alt pr. sæson.
// Porteret fra designudgaven i PR #8249 (academyLedger.ts) med samme tests.
//
// Kun læsning af eksisterende data. Ingen nye økonomi-mekanikker.

export type LedgerOrigin = "offer" | "youthAuction";

export const LEDGER_SOURCE = Object.freeze({ OFFER: "offer", YOUTH_AUCTION: "youthAuction" } as const);

export type SeasonInput = {
  id: string;
  number?: number | null;
  status?: string | null;
  start_date?: string | null;
};
export type LedgerFinanceRow = FinanceRow & {
  season_id?: string | null;
  created_at?: string | null;
  metadata?: { code?: string | null } | null;
  related_entity_type?: string | null;
  idempotency_key?: string | null;
};
export type IntakeInput = { rider_id?: string | null; riders?: RiderName | null };
export type YouthWinInput = {
  rider_id?: string | null;
  current_bidder_id?: string | null;
  is_guaranteed_sale?: boolean | null;
  riders?: RiderName | null;
};
export type PoolMember = { riderId: string; riderName: string | null; origin: LedgerOrigin };
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
export type LedgerTotals = {
  offerSignings: number;
  youthAuctionBuys: number;
  drift: number;
  salesCount: number;
  salesProceeds: number;
  net: number;
};
export type LedgerRow = LedgerTotals & {
  seasonId: string | null;
  seasonNumber: number | null;
  isCurrent: boolean;
};
export type SeasonLedger = {
  rows: LedgerRow[];
  total: LedgerTotals;
  current: LedgerRow | null;
  showDrift: boolean;
  driftIsHistoric: boolean;
};

const YOUTH_AUCTION_CODE = "tx.youthAuctionWin";
const YOUTH_AUCTION_KEY_PREFIX = "youth_auction_winner:";

/**
 * En ungdomsauktions-sejr bogføres som academy_signing (auctionFinalization.js).
 * Kode, entitet eller idempotensnøgle skiller den fra en hentning fra tilbud;
 * én af dem er nok, så ældre rækker uden metadata stadig klassificeres.
 */
export function classifySigning(row: LedgerFinanceRow | null | undefined): LedgerOrigin {
  if (row?.metadata?.code === YOUTH_AUCTION_CODE) return LEDGER_SOURCE.YOUTH_AUCTION;
  if (row?.related_entity_type === "auction") return LEDGER_SOURCE.YOUTH_AUCTION;
  if (typeof row?.idempotency_key === "string" && row.idempotency_key.startsWith(YOUTH_AUCTION_KEY_PREFIX)) {
    return LEDGER_SOURCE.YOUTH_AUCTION;
  }
  return LEDGER_SOURCE.OFFER;
}

function toTime(iso: unknown): number | null {
  if (!iso) return null;
  const ms = new Date(iso as string).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Sæsonen et tidspunkt hører til: den senest startede sæson på tidspunktet.
 * Slutdatoen bruges bevidst ikke: ved et sæsonskifte samme dag overlapper den
 * gamle sæsons slutdato den nyes startdato, og så skal den nye vinde.
 */
export function seasonForDate(seasons: readonly SeasonInput[] | null | undefined, iso: unknown): SeasonInput | null {
  const at = toTime(iso);
  if (at == null || !Array.isArray(seasons) || seasons.length === 0) return null;
  let latest: SeasonInput | null = null;
  let latestStart = -Infinity;
  for (const s of seasons) {
    const start = toTime(s.start_date);
    if (start == null || start > at) continue;
    // Samme startdato (fx en prøvesæson og sæson 1): den højeste nummer vinder.
    const later = start > latestStart || (start === latestStart && (s.number ?? -1) > (latest?.number ?? -1));
    if (later) {
      latest = s;
      latestStart = start;
    }
  }
  return latest;
}

/** Akademiets rytterkreds: hentet fra tilbud + vundet på ungdomsauktion. */
export function buildAcademyRiderPool({
  signedIntake = [],
  youthAuctionWins = [],
}: { signedIntake?: readonly IntakeInput[]; youthAuctionWins?: readonly YouthWinInput[] } = {}): Map<string, PoolMember> {
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
 * Holdets gennemførte salg af ryttere fra kredsen (senior-auktion eller
 * transfermarked), nyeste først, med sæson påsat. Samme salgsregel som
 * buildAcademySales: #785 for auktioner, accepteret og pris > 0 for transfers.
 */
export function buildLedgerSales({
  auctionRows = [],
  transferRows = [],
  pool = new Map(),
  seasons = [],
}: {
  auctionRows?: readonly Partial<AuctionSaleInput>[];
  transferRows?: readonly Partial<TransferSaleInput>[];
  pool?: ReadonlyMap<string, PoolMember>;
  seasons?: readonly SeasonInput[];
} = {}): LedgerSale[] {
  const raw: { riderId: string; soldAt: string | null; price: number; via: "auction" | "transfer" }[] = [];
  for (const a of auctionRows) {
    if (!a?.rider_id || !pool.has(a.rider_id) || !isRealizedSale(a)) continue;
    raw.push({ riderId: a.rider_id, soldAt: a.actual_end || null, price: Number(a.current_price) || 0, via: "auction" });
  }
  for (const o of transferRows) {
    if (!o?.rider_id || !pool.has(o.rider_id)) continue;
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

function emptyLedgerRow(season: SeasonInput | null | undefined, currentSeasonId: string | null): LedgerRow {
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
 * samlet linje. Udgifter er positive beløb (UI'et viser dem med minus).
 * En postering bruger sin bogførte season_id; mangler den, afgør datoen.
 */
export function buildSeasonLedger({
  financeRows = [],
  sales = [],
  seasons = [],
  currentSeasonId = null,
}: {
  financeRows?: readonly LedgerFinanceRow[];
  sales?: readonly Pick<LedgerSale, "price" | "seasonId">[];
  seasons?: readonly SeasonInput[];
  currentSeasonId?: string | null;
} = {}): SeasonLedger {
  const byId = new Map<string, SeasonInput>(seasons.map((s) => [s.id, s]));
  const rows = new Map<string, LedgerRow>();
  const rowFor = (season: SeasonInput | null | undefined): LedgerRow => {
    const key = season?.id ?? "none";
    let row = rows.get(key);
    if (!row) {
      row = emptyLedgerRow(season, currentSeasonId);
      rows.set(key, row);
    }
    return row;
  };
  const current = currentSeasonId ? byId.get(currentSeasonId) : undefined;
  if (current) rowFor(current);

  for (const f of financeRows) {
    if (f.type !== "academy_drift" && f.type !== "academy_signing") continue;
    const season = (f.season_id ? byId.get(f.season_id) : undefined) ?? seasonForDate(seasons, f.created_at);
    const amount = Math.abs(Number(f.amount) || 0);
    const row = rowFor(season);
    if (f.type === "academy_drift") row.drift += amount;
    else if (classifySigning(f) === LEDGER_SOURCE.YOUTH_AUCTION) row.youthAuctionBuys += amount;
    else row.offerSignings += amount;
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

/**
 * Det felt GET /api/academy/pnl lægger på svaret, når akademisiden udgave A er
 * tændt. Rene rækker ind, rent JSON ud.
 */
export function buildAcademyLedgerPayload({
  seasons = [],
  financeRows = [],
  signedIntake = [],
  youthAuctionWins = [],
  auctionRows = [],
  transferRows = [],
}: {
  seasons?: readonly SeasonInput[];
  financeRows?: readonly LedgerFinanceRow[];
  signedIntake?: readonly IntakeInput[];
  youthAuctionWins?: readonly YouthWinInput[];
  auctionRows?: readonly Partial<AuctionSaleInput>[];
  transferRows?: readonly Partial<TransferSaleInput>[];
} = {}) {
  const pool = buildAcademyRiderPool({ signedIntake, youthAuctionWins });
  const sales = buildLedgerSales({ auctionRows, transferRows, pool, seasons });
  const currentSeasonId = seasons.find((s) => s.status === "active")?.id ?? null;
  const ledger = buildSeasonLedger({ financeRows, sales, seasons, currentSeasonId });
  return {
    seasons: ledger.rows,
    total: ledger.total,
    currentSeasonId: ledger.current?.seasonId ?? null,
    showDrift: ledger.showDrift,
    driftIsHistoric: ledger.driftIsHistoric,
    poolSize: pool.size,
    sales,
  };
}

export type AcademyLedgerPayload = ReturnType<typeof buildAcademyLedgerPayload>;
