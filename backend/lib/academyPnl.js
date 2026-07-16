// Akademi-regnskabet (#2485, addendum V3 fra 2026-07-16-traening-ungdom-
// verdensklasse-addendum-design.md §3). Ren aggregerings-logik for GET
// /api/academy/pnl — INGEN Supabase-kald her (routen henter rows, denne fil
// beregner), så det er testbart uden DB-mock. INGEN nye økonomi-mekanikker:
// alt læses af eksisterende data (finance_transactions, academy_graduation,
// auctions, riders.salary). Viser KUN realiseret markedsværdi (faktiske salg),
// aldrig projektion af fremtidig værdi (#2100 er ejer-udskudt).

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

/**
 * Byg den realiserede salgs-liste. Den ENESTE vej en akademi-udviklet rytter
 * sælges på i dag er graduerings-flowet (academyGraduation.js "sell"): en
 * academy_graduation-row med status='sold' opretter en almindelig senior-
 * auktion (is_youth=false, seller_team_id=holdet). auctionRows er allerede
 * filtreret til completed+seller_team_id=hold+is_youth=false+rider_id IN
 * (solgte graduate-rider-id'er) af kalderen. gradByRider bruges kun til at
 * berige med rytternavn + fallback-dato.
 *
 * "Salgspræmie" = current_price - starting_price: beløbet budt op over
 * rytterens markedsværdi PÅ SALGSTIDSPUNKTET (auctions.starting_price =
 * calculateRiderMarketValue ved auktions-oprettelse) — realiseret, historisk,
 * ingen fremskrivning.
 */
export function buildAcademySales(auctionRows = [], gradByRider = new Map()) {
  const sales = [];
  for (const a of auctionRows) {
    if (!isRealizedSale(a)) continue;
    const price = Number(a.current_price) || 0;
    const listed = Number(a.starting_price) || 0;
    const grad = gradByRider.get(a.rider_id);
    const rider = grad?.riders ?? {};
    const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
    sales.push({
      riderId: a.rider_id,
      riderName: riderName || null,
      soldAt: a.actual_end || grad?.resolved_at || null,
      price,
      listedValue: listed,
      premium: price - listed,
    });
  }
  sales.sort((a, b) => new Date(b.soldAt || 0) - new Date(a.soldAt || 0));
  return sales;
}

/** Saml det fulde P&L-payload. Kappet til de 20 seneste salg i UI-listen (drill-down, ikke krævet for summerne). */
export function summarizeAcademyPnl({ current, driftPaid, signingFeesPaid, sales }) {
  const salesProceeds = sales.reduce((sum, s) => sum + s.price, 0);
  const valueCreation = sales.reduce((sum, s) => sum + s.premium, 0);
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
