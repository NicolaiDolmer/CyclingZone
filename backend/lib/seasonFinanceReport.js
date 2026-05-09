// Slice 07h · Pure helpers for /api/teams/:teamId/finance-report.
// Holdes ude af api.js så aggregeringen kan unit-testes uden HTTP/Supabase.
//
// Privatlivs-invariant: alle helpers opererer på rows der allerede er filtreret
// til ÉT specifikt team_id + season_id. Endpoint'et håndhæver auth-gaten;
// helperne stoler på at input er pre-filtered.

import { FINANCE_REASON } from "./economyConstants.js";

// Mapping fra reason_code → menneskelæsbar dansk label til donut-segmenter.
// Holdes her (ikke i UI) så backend-output er self-describing.
export const REASON_LABEL = Object.freeze({
  [FINANCE_REASON.SEASON_START_SPONSOR]: "Sponsor",
  [FINANCE_REASON.SEASON_END_SALARY]: "Løn",
  [FINANCE_REASON.SEASON_END_DIVISION_BONUS]: "Divisionsbonus",
  [FINANCE_REASON.SEASON_END_NEGATIVE_INTEREST]: "Negativ rente",
  [FINANCE_REASON.SEASON_END_LOAN_INTEREST]: "Lånerente",
  [FINANCE_REASON.STARTING_BUDGET]: "Startbudget",
  [FINANCE_REASON.RACE_PRIZE_PAYOUT]: "Præmiepenge",
  [FINANCE_REASON.AUCTION_WINNER_PAYMENT]: "Auktion-køb",
  [FINANCE_REASON.AUCTION_SELLER_PAYOUT]: "Auktion-salg",
  [FINANCE_REASON.AUCTION_GUARANTEED_BANK_SALE]: "Bank-garanti-salg",
  [FINANCE_REASON.TRANSFER_PURCHASE]: "Transfer-køb",
  [FINANCE_REASON.TRANSFER_SALE]: "Transfer-salg",
  [FINANCE_REASON.SWAP_CASH_DELTA]: "Bytte (kontant-difference)",
  [FINANCE_REASON.LOAN_FEE_PAID]: "Lejegebyr betalt",
  [FINANCE_REASON.LOAN_FEE_RECEIVED]: "Lejegebyr modtaget",
  [FINANCE_REASON.LOAN_FEE_REFUNDED]: "Lejegebyr refunderet",
  [FINANCE_REASON.LOAN_PRINCIPAL_RECEIVED]: "Lån optaget",
  [FINANCE_REASON.LOAN_REPAYMENT]: "Låneafdrag",
  [FINANCE_REASON.LOAN_BUYOUT]: "Lån indfriet",
  [FINANCE_REASON.LOAN_ORIGINATION_FEE]: "Låne-oprettelsesgebyr",
  [FINANCE_REASON.EMERGENCY_LOAN_RECEIVED]: "Nødlån",
  [FINANCE_REASON.SQUAD_AUTO_PURCHASE]: "Tvungent rytter-køb",
  [FINANCE_REASON.SQUAD_AUTO_SALE]: "Tvungent rytter-salg",
  [FINANCE_REASON.SQUAD_VIOLATION_FINE]: "Sammensætnings-bøde",
  [FINANCE_REASON.BOARD_BONUS_ACCEPTED]: "Bestyrelsesbonus",
  [FINANCE_REASON.ADMIN_BALANCE_ADJUSTMENT]: "Admin-justering",
  [FINANCE_REASON.ADMIN_FORCE_PRIZE]: "Admin-præmie-tildeling",
  [FINANCE_REASON.ADMIN_BETA_RESET]: "Beta-reset",
});

const FALLBACK_LABEL = "Andet";

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
