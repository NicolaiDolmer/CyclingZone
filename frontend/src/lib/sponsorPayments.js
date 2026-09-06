// Sponsors-sidens Payments-fane (#4265, ejer-godkendt mockup 6/9).
//
// Ren, DB-fri model af "hvad er der udbetalt i denne sæson, og hvorfor" —
// samme holdning som sponsorIncomeBreakdown.js: backend leverer RÅ
// finance_transactions-rækker (GET /api/sponsor/contract → `season`), al
// fortolkning sker her, så den kan unit-testes uden en DB.
//
// Forskellen på denne og buildSponsorIncomeBreakdown:
//   · Finance-sidens breakdown er en udfoldelig gruppe-liste med LIVSTIDS-
//     semantik på earnings og uden divisions-tillægget.
//   · Denne bygger mockuppens FLADE tabel: Guaranteed (base + divisions-tillæg)
//     · Stages at <rate> (én række pr. løb med etapetal) · Bonuses · Total.
// De to deler de rene hjælpere (groupRaceDaysByRace / buildBonusRows /
// computeResultsCapUsage) i stedet for at kopiere dem.
//
// P11: intet tal opfindes. Kan etapetallet ikke udledes (rate <= 0), er `days`
// null og kolonnen står tom — der gættes aldrig et antal.
import {
  buildBonusRows,
  computeResultsCapUsage,
  groupRaceDaysByRace,
} from "./sponsorIncomeBreakdown.js";

const BASE_TYPE = "sponsor";
const DIVISION_ADJUSTMENT_TYPE = "division_adjustment";
const RESULT_BONUS_TYPE = "sponsor_result_bonus";
const SIGNING_BONUS_TYPE = "sponsor_signing_bonus";
const OBJECTIVE_BONUS_TYPE = "sponsor_objective_bonus";

function toAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} args
 * @param {object|null} args.contract  aktiv kontrakt (GET /api/sponsor/contract → contract)
 * @param {number|null} args.seasonNumber
 * @param {Array} args.transactions    sæson-scopede rå-rækker (season.transactions)
 * @param {number|null} args.stagesTotal  sæsonens etapetal for holdets pulje (season.stagesTotal)
 */
export function buildSponsorPayments({
  contract = null,
  seasonNumber = null,
  transactions = [],
  stagesTotal = null,
} = {}) {
  const rows = transactions || [];
  const rate = toAmount(contract?.per_race_day_rate);

  const baseTotal = rows
    .filter((r) => r?.type === BASE_TYPE)
    .reduce((sum, r) => sum + toAmount(r.amount), 0);
  const divisionAdjustmentTotal = rows
    .filter((r) => r?.type === DIVISION_ADJUSTMENT_TYPE)
    .reduce((sum, r) => sum + toAmount(r.amount), 0);

  const guaranteedRows = [];
  if (baseTotal !== 0) guaranteedRows.push({ kind: "base", amount: baseTotal });
  if (divisionAdjustmentTotal !== 0) {
    guaranteedRows.push({ kind: "divisionAdjustment", amount: divisionAdjustmentTotal });
  }
  const guaranteedTotal = baseTotal + divisionAdjustmentTotal;

  const raceDays = groupRaceDaysByRace(rows, rate);
  // Etaper kørt i sæsonen: summen af de udledte etapetal. Kan ét løb ikke
  // udledes (rate <= 0), kender vi ikke summen og siger det i stedet for at
  // rapportere en for lav værdi.
  const stagesRidden = raceDays.rows.some((r) => r.days == null)
    ? null
    : raceDays.rows.reduce((sum, r) => sum + r.days, 0);

  const bonusTx = rows.filter(
    (r) =>
      r?.type === RESULT_BONUS_TYPE ||
      r?.type === SIGNING_BONUS_TYPE ||
      r?.type === OBJECTIVE_BONUS_TYPE,
  );
  const bonusRows = buildBonusRows(bonusTx, contract);
  const bonusesTotal = bonusTx.reduce((sum, tx) => sum + toAmount(tx.amount), 0);

  const earnedOnTop = raceDays.total + bonusesTotal;

  return {
    seasonNumber,
    sponsorName: contract?.sponsor_name ?? null,
    rate,
    stagesTotal: Number(stagesTotal) > 0 ? Number(stagesTotal) : null,
    stagesRidden,
    guaranteed: { total: guaranteedTotal, rows: guaranteedRows },
    stages: { total: raceDays.total, rows: raceDays.rows },
    bonuses: { total: bonusesTotal, rows: bonusRows },
    cap: computeResultsCapUsage(contract),
    earnedOnTop,
    total: guaranteedTotal + earnedOnTop,
    isEmpty: guaranteedRows.length === 0 && raceDays.rows.length === 0 && bonusRows.length === 0,
  };
}

/**
 * Etaper tilbage i sæsonen og hvad de er værd ved fuld deltagelse.
 * Returnerer null når enten etapetallet eller raten mangler — linjen vises
 * simpelthen ikke frem for at stå med et gæt (P11).
 */
export function projectRemainingStages({ stagesTotal = null, stagesRidden = null, rate = 0 } = {}) {
  if (stagesRidden == null) return null;
  const total = Number(stagesTotal);
  const ridden = Number(stagesRidden);
  const perStage = Number(rate);
  if (!(total > 0) || !Number.isFinite(ridden) || ridden < 0 || !(perStage > 0)) return null;
  const left = Math.max(0, total - ridden);
  return { left, worth: left * perStage };
}
