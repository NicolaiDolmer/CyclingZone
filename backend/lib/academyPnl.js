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

/**
 * Nuværende akademi-trup: run-rate løn + pladser brugt. Et øjebliksbillede,
 * IKKE kumulativt betalt-til-dato — løn opkræves som ét samlet 'salary'-beløb
 * pr. hold pr. sæson og kan ikke splittes akademi/senior i finance_transactions.
 */
export function computeAcademyCurrent(rosterRows = [], { slotsMax } = {}) {
  const payroll = rosterRows.reduce((sum, r) => sum + (Number(r.salary) || 0), 0);
  return { slotsUsed: rosterRows.length, slotsMax, payroll };
}

/** Kumulative akademi-specifikke pengebevægelser (drift + signing-fees), hele holdets historik. */
export function computeAcademyCumulative(financeRows = []) {
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
export function isRealizedSale(auction) {
  return Boolean(auction?.current_bidder_id) || Boolean(auction?.is_guaranteed_sale);
}

function nameOf(rider) {
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
export function buildAcademySales(auctionRows = [], transferRows = [], riderById = new Map()) {
  const sales = [];
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
  sales.sort((a, b) => new Date(b.soldAt || 0) - new Date(a.soldAt || 0));
  return sales;
}

/** Saml det fulde P&L-payload. Kappet til de 20 seneste salg i UI-listen (drill-down, ikke krævet for summerne). */
export function summarizeAcademyPnl({ current, driftPaid, signingFeesPaid, sales }) {
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
