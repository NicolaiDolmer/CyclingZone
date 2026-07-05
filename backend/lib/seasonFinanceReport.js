// Slice 07h · Pure helpers for /api/teams/:teamId/finance-report.
// Holdes ude af api.js så aggregeringen kan unit-testes uden HTTP/Supabase.
//
// Privatlivs-invariant: alle helpers opererer på rows der allerede er filtreret
// til ÉT specifikt team_id + season_id. Endpoint'et håndhæver auth-gaten;
// helperne stoler på at input er pre-filtered.

import { FINANCE_REASON } from "./economyConstants.js";

// Mapping fra reason_code → menneskelæsbar label til donut-segmenter.
// #2174 · EN-first fallback (ingen rå dansk i backend): frontend resolver den
// locale-aware via finance.json report.reasonCode.<code>; disse værdier vises
// kun hvis en kode mangler en frontend-oversættelse. Holdes her (ikke kun i UI)
// så backend-output er self-describing i logs/admin.
export const REASON_LABEL = Object.freeze({
  [FINANCE_REASON.SEASON_START_SPONSOR]: "Sponsor",
  [FINANCE_REASON.SPONSOR_RACE_DAY]: "Sponsor (race day)",
  [FINANCE_REASON.SEASON_END_SALARY]: "Salaries",
  [FINANCE_REASON.SEASON_END_DIVISION_BONUS]: "Division bonus",
  [FINANCE_REASON.SEASON_END_NEGATIVE_INTEREST]: "Negative interest",
  [FINANCE_REASON.SEASON_END_LOAN_INTEREST]: "Loan interest",
  [FINANCE_REASON.STARTING_BUDGET]: "Starting budget",
  [FINANCE_REASON.RACE_PRIZE_PAYOUT]: "Prize money",
  [FINANCE_REASON.AUCTION_WINNER_PAYMENT]: "Auction purchase",
  [FINANCE_REASON.AUCTION_SELLER_PAYOUT]: "Auction sale",
  [FINANCE_REASON.AUCTION_GUARANTEED_BANK_SALE]: "Bank-guaranteed sale",
  [FINANCE_REASON.TRANSFER_PURCHASE]: "Transfer purchase",
  [FINANCE_REASON.TRANSFER_SALE]: "Transfer sale",
  [FINANCE_REASON.SWAP_CASH_DELTA]: "Swap (cash difference)",
  [FINANCE_REASON.RIDER_RELEASE_BUYOUT]: "Release fee",
  [FINANCE_REASON.LOAN_FEE_PAID]: "Loan fee paid",
  [FINANCE_REASON.LOAN_FEE_RECEIVED]: "Loan fee received",
  [FINANCE_REASON.LOAN_FEE_REFUNDED]: "Loan fee refunded",
  [FINANCE_REASON.LOAN_PRINCIPAL_RECEIVED]: "Loan taken out",
  [FINANCE_REASON.LOAN_REPAYMENT]: "Loan repayment",
  [FINANCE_REASON.LOAN_BUYOUT]: "Loan bought out",
  [FINANCE_REASON.LOAN_ORIGINATION_FEE]: "Loan origination fee",
  [FINANCE_REASON.EMERGENCY_LOAN_RECEIVED]: "Emergency loan",
  [FINANCE_REASON.SQUAD_AUTO_PURCHASE]: "Forced rider purchase",
  [FINANCE_REASON.SQUAD_AUTO_SALE]: "Forced rider sale",
  [FINANCE_REASON.SQUAD_VIOLATION_FINE]: "Squad-composition fine",
  [FINANCE_REASON.BOARD_BONUS_ACCEPTED]: "Board bonus",
  [FINANCE_REASON.ADMIN_BALANCE_ADJUSTMENT]: "Admin adjustment",
  [FINANCE_REASON.ADMIN_FORCE_PRIZE]: "Admin prize award",
  [FINANCE_REASON.ADMIN_BETA_RESET]: "Beta reset",
  [FINANCE_REASON.SEASON_START_UPKEEP]: "Upkeep & maintenance",
  [FINANCE_REASON.SEASON_START_ACADEMY_DRIFT]: "Academy drift",
});

const FALLBACK_LABEL = "Other";

function labelFor(reasonCode) {
  return REASON_LABEL[reasonCode] || FALLBACK_LABEL;
}

/**
 * Hero-kort: totalIn, totalOut, net cashflow.
 * Konvention: amount > 0 = indtægt, amount < 0 = udgift (matcher
 * finance_transactions.amount-konventionen i v2.92+ og pre-v2.92 backfill).
 */
export function computeHeroCashflow(transactions) {
  let totalIn = 0;
  let totalOut = 0;
  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    if (amount > 0) totalIn += amount;
    else if (amount < 0) totalOut += amount; // bevarer negativt fortegn
  }
  return {
    total_in: totalIn,
    total_out: totalOut, // negativt
    net: totalIn + totalOut,
    transaction_count: transactions.length,
  };
}

/**
 * Donut-data: aggregér rows per reason_code, separat for indtægt og udgift.
 * Returnerer to lister sorteret descending efter abs(value) — så største skive
 * kommer først i recharts-rendering.
 */
export function aggregateByReason(transactions) {
  const incomeMap = new Map();
  const expenseMap = new Map();

  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    if (amount === 0) continue;
    const code = tx.reason_code || "unknown";
    const target = amount > 0 ? incomeMap : expenseMap;
    const prev = target.get(code) || 0;
    target.set(code, prev + Math.abs(amount));
  }

  const toList = (map) =>
    [...map.entries()]
      .map(([reason_code, value]) => ({
        reason_code,
        label: labelFor(reason_code),
        value,
      }))
      .sort((a, b) => b.value - a.value);

  return {
    income: toList(incomeMap),
    expense: toList(expenseMap),
  };
}

/**
 * Top N største transaktioner i hver retning. Klikbart i UI til drill-down.
 * Returnerer kun whitelistede felter — ingen audit-internals lækker.
 */
export function topTransactions(transactions, n = 3) {
  const sorted = [...transactions].sort(
    (a, b) => Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0)
  );
  const top_in = [];
  const top_out = [];
  for (const tx of sorted) {
    const amount = Number(tx.amount) || 0;
    if (amount > 0 && top_in.length < n) {
      top_in.push(toPublicTx(tx));
    } else if (amount < 0 && top_out.length < n) {
      top_out.push(toPublicTx(tx));
    }
    if (top_in.length >= n && top_out.length >= n) break;
  }
  return { top_in, top_out };
}

function toPublicTx(tx) {
  return {
    id: tx.id,
    type: tx.type,
    amount: Number(tx.amount) || 0,
    description: tx.description || "",
    // #1483: medsend struktureret metadata { code, params } så UI kan rendere
    // locale-aware (rytternavn) i stedet for den rå danske description.
    metadata: tx.metadata || null,
    reason_code: tx.reason_code || null,
    label: labelFor(tx.reason_code),
    created_at: tx.created_at,
  };
}

/**
 * Loan-portfolio: aktive lån med remaining + estimeret rente næste sæson.
 */
export function summarizeLoans(loans) {
  const active = (loans || []).filter((l) => l.status === "active");
  return active.map((l) => {
    const interest_rate = Number(l.interest_rate) || 0;
    const amount_remaining = Number(l.amount_remaining) || 0;
    return {
      id: l.id,
      loan_type: l.loan_type,
      principal: Number(l.principal) || 0,
      amount_remaining,
      interest_rate,
      seasons_remaining: Number(l.seasons_remaining) || 0,
      next_season_interest: Math.round(amount_remaining * interest_rate),
    };
  });
}

/**
 * Top-level: kombinerer alt. Tager pre-filtered rows for ÉT team + ÉN sæson
 * og bygger hele rapport-payload'en.
 */
export function buildSeasonFinanceReport({ transactions = [], loans = [] }) {
  return {
    hero: computeHeroCashflow(transactions),
    donuts: aggregateByReason(transactions),
    top: topTransactions(transactions, 3),
    loans: summarizeLoans(loans),
  };
}
