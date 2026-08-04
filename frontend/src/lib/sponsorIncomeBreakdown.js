// Sponsor income breakdown — Finance-sidens "Sponsor income"-sektion (ejer-godkendt mockup 4/8).
//
// Ren, DB-fri gruppering/summering af sæsonens sponsor-transaktioner. Backend
// (GET /api/sponsor/contract → `season.transactions`) leverer kun RÅ, ugrupperede
// finance_transactions-rækker (type/amount/description/metadata/createdAt/
// raceId/raceName) + den aktive kontrakt — al fortolkning sker her, så logikken
// er unit-testbar uden en DB (jf. AGENTS.md TDD-kravet).
//
// Kilde-typer (finance_transactions.type):
//   'sponsor'                 → garanteret sæson-base (season_start_sponsor)
//   'sponsor_race_day'        → pr.-etape-indkomst, ét beløb pr. (race, team)
//   'sponsor_result_bonus'    → etapesejr-/podie-bonus, KAN dække BEGGE i én
//                                række (payload bærer wins+podiums samlet,
//                                loft-begrænset) — se splitResultBonusRows.
//   'sponsor_signing_bonus'   → engangsbeløb ved kontrakt-aktivering
//   'sponsor_objective_bonus' → engangsbeløb ved sæsonafslutning (top-X klausul)

const RACE_DAY_TYPE = "sponsor_race_day";
const BASE_TYPE = "sponsor";
const RESULT_BONUS_TYPE = "sponsor_result_bonus";
const SIGNING_BONUS_TYPE = "sponsor_signing_bonus";
const OBJECTIVE_BONUS_TYPE = "sponsor_objective_bonus";

function toAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sortByCreatedAtDesc(a, b) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

// Grupperer 'sponsor_race_day'-rækker pr. løb (normalt allerede én række pr.
// (race, team) — summeres defensivt hvis flere findes). `days` udledes som
// amount/rate (rate er kontraktens NUVÆRENDE per_race_day_rate, konstant for
// alle rækker i den aktive sæson, jf. #2913 — raten genberegnes kun ved
// sæson-aktivering). rate <= 0 → days = null (kan ikke udledes; vis kun beløb).
export function groupRaceDaysByRace(transactions, rate) {
  const groups = new Map();
  for (const tx of transactions || []) {
    if (tx?.type !== RACE_DAY_TYPE) continue;
    const key = tx.raceId || tx.id;
    const amount = toAmount(tx.amount);
    const existing = groups.get(key);
    if (existing) {
      existing.amount += amount;
      if (new Date(tx.createdAt) > new Date(existing.createdAt)) existing.createdAt = tx.createdAt;
      if (!existing.raceName && tx.raceName) existing.raceName = tx.raceName;
    } else {
      groups.set(key, {
        raceId: tx.raceId || null,
        raceName: tx.raceName || null,
        amount,
        createdAt: tx.createdAt,
      });
    }
  }
  const numericRate = toAmount(rate);
  const rows = [...groups.values()]
    .map((g) => ({
      ...g,
      rate: numericRate,
      days: numericRate > 0 ? Math.round(g.amount / numericRate) : null,
    }))
    .sort(sortByCreatedAtDesc);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return { total, count: rows.length, rows };
}

// Én 'sponsor_result_bonus'-transaktion kan dække BÅDE etapesejr- og
// podie-bonus i samme beløb (og beløbet kan være loft-beskåret). Vi kender
// wins/podiums fra metadata.params (skrevet af sponsorRaceDayIncome.js) og
// klausul-satserne fra kontrakten — det giver os de RÅ (u-beskårne) andele,
// som vi skalerer proportionalt ned til den faktiske krediterede sum. Det
// garanterer at de udstillede linjer altid summer PRÆCIS til tx.amount, også
// når loftet har beskåret beløbet.
//
// Fallback til én generisk linje når vi ikke kan afgøre andelen sikkert
// (manglende metadata, eller begge klausul-satser er 0/ukendte mens begge
// tælletal er > 0 — kan ikke proportionere).
export function splitResultBonusRow(tx, contract) {
  const amount = toAmount(tx?.amount);
  const clauses = contract?.bonus_clauses || [];
  const winClauseAmount = toAmount(clauses.find((c) => c?.type === "stage_win")?.amount);
  const podiumClauseAmount = toAmount(clauses.find((c) => c?.type === "podium")?.amount);
  const wins = toAmount(tx?.metadata?.params?.wins);
  const podiums = toAmount(tx?.metadata?.params?.podiums);

  const base = { raceId: tx?.raceId ?? null, raceName: tx?.raceName ?? null, createdAt: tx?.createdAt };

  if (wins > 0 && podiums <= 0) {
    return [{ ...base, id: `${tx.id}:stageWin`, kind: "stageWin", amount, count: wins }];
  }
  if (podiums > 0 && wins <= 0) {
    return [{ ...base, id: `${tx.id}:podium`, kind: "podium", amount, count: podiums }];
  }
  if (wins > 0 && podiums > 0) {
    const rawWin = wins * winClauseAmount;
    const rawPodium = podiums * podiumClauseAmount;
    const rawTotal = rawWin + rawPodium;
    if (rawTotal > 0) {
      const winShare = Math.round(amount * (rawWin / rawTotal));
      const podiumShare = amount - winShare;
      return [
        { ...base, id: `${tx.id}:stageWin`, kind: "stageWin", amount: winShare, count: wins },
        { ...base, id: `${tx.id}:podium`, kind: "podium", amount: podiumShare, count: podiums },
      ];
    }
  }
  // Ukendt fordeling (ingen metadata, eller begge klausul-satser 0) → én
  // generisk linje for hele beløbet i stedet for at gætte forkert.
  return [{ ...base, id: `${tx.id}:generic`, kind: "resultBonus", amount, wins, podiums }];
}

// Bygger den flade, sorterede (nyeste først) liste af bonus-linjer for
// Bonuses-gruppen: signing (1 linje), objective (1 linje pr. sæson opnået),
// result_bonus (0-2 linjer pr. transaktion, se splitResultBonusRow).
export function buildBonusRows(transactions, contract) {
  const rows = [];
  for (const tx of transactions || []) {
    if (tx?.type === SIGNING_BONUS_TYPE) {
      rows.push({ id: tx.id, kind: "signing", amount: toAmount(tx.amount), createdAt: tx.createdAt, raceName: null });
    } else if (tx?.type === OBJECTIVE_BONUS_TYPE) {
      rows.push({ id: tx.id, kind: "objective", amount: toAmount(tx.amount), createdAt: tx.createdAt, raceName: null });
    } else if (tx?.type === RESULT_BONUS_TYPE) {
      rows.push(...splitResultBonusRow(tx, contract));
    }
  }
  return rows.sort(sortByCreatedAtDesc);
}

// Resultatbonus-loftets forbrug (results_cap-klausulen, jf. sponsorRaceDayIncome.js
// remainingCapByTeam). Loftet er KONTRAKT-livstid, ikke sæson-scoped — samme tal
// som faktisk håndhæves server-side (contract.results_bonus_paid). Returnerer
// null når kontrakten ingen results_cap-klausul har (ingen loft-linje at vise).
export function computeResultsCapUsage(contract) {
  const clauses = contract?.bonus_clauses || [];
  const capClause = clauses.find((c) => c?.type === "results_cap");
  if (!capClause) return null;
  const limit = toAmount(capClause.amount);
  const used = Math.max(0, toAmount(contract?.results_bonus_paid));
  return { used, limit };
}

// Har kontrakten reelle bonusklausuler ('results_cap' er selv IKKE en bonus,
// den er blot loftet på resultat-klausulerne)? Styrer bund-forklaringens
// korte vs. fulde tekst.
export function hasBonusClauses(contract) {
  const clauses = contract?.bonus_clauses || [];
  return clauses.some((c) => c?.type !== "results_cap");
}

// Hovedfunktion: samler alt ovenstående til den shape UI-komponenten
// renderer direkte. `transactions` = RÅ sæson-scoped rækker fra
// GET /api/sponsor/contract (`season.transactions`); `contract` = samme
// endpoints `contract`-felt (aktiv kontrakt, kan være null).
export function buildSponsorIncomeBreakdown({ contract = null, seasonNumber = null, transactions = [] } = {}) {
  const rows = transactions || [];
  const rate = toAmount(contract?.per_race_day_rate);

  const fixedRows = rows
    .filter((r) => r?.type === BASE_TYPE)
    .map((r) => ({ id: r.id, amount: toAmount(r.amount), createdAt: r.createdAt }))
    .sort(sortByCreatedAtDesc);
  const guaranteed = fixedRows.reduce((sum, r) => sum + r.amount, 0);

  const raceDays = groupRaceDaysByRace(rows, rate);

  const bonusTx = rows.filter(
    (r) => r?.type === RESULT_BONUS_TYPE || r?.type === SIGNING_BONUS_TYPE || r?.type === OBJECTIVE_BONUS_TYPE,
  );
  const bonusRows = buildBonusRows(bonusTx, contract);
  const bonusesTotal = bonusTx.reduce((sum, tx) => sum + toAmount(tx.amount), 0);

  const earnedOnTop = raceDays.total + bonusesTotal;
  const total = guaranteed + earnedOnTop;

  return {
    seasonNumber,
    sponsorName: contract?.sponsor_name ?? null,
    guaranteed,
    earnedOnTop,
    total,
    hasBonusClauses: hasBonusClauses(contract),
    fixed: { total: guaranteed, rows: fixedRows },
    raceDays,
    bonuses: { total: bonusesTotal, rows: bonusRows, cap: computeResultsCapUsage(contract) },
  };
}
