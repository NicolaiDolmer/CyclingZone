// #4011 — Saesonskifte-afregningen (Finance-siden, ny sektion "C").
//
// Rene, testbare byggeklodser bag GET /api/finance/season-switch-preview.
// INTET HER RØRER EN DATABASE — route-handleren i backend/routes/api.js står
// for al I/O (samme opdeling som backend/scripts/lib/cutover3645.js).
//
// #3989-genbrug (ejer-krav 20/8, #4011): lønprojektionen for sæson 3 må ALDRIG
// have sin egen kopi af formlen — den importeres fra contractSeed.js, præcis
// den funktion salaryRecompute3645.mjs (cutover-værktøjet) og
// computeFinanceForecast (forecast-kortet) begge kalder. Der er kun ÉT sted
// lønformlen bor.
//
// Refs #4011 #3989 #3899 #3236.

import { FINANCE_REASON } from "./economyConstants.js";
import { computeFrozenSalary } from "./contractSeed.js";

// reason_code → hvilken af de 7 kildelinjer (samme linjer som
// FinanceForecastCard's Row/RangeRow-opstilling) beløbet hører under. Bruges
// til at aggregere INDEVÆRENDE sæsons (S2) REALISEREDE finance_transactions —
// modsat sæson 3-kolonnen, som er en PROGNOSE (computeFinanceForecast).
export const S2_SOURCE_REASON_CODES = Object.freeze({
  sponsor_base: [FINANCE_REASON.SEASON_START_SPONSOR, FINANCE_REASON.MIDSEASON_SPONSOR_PRORATA],
  sponsor_variable: [
    FINANCE_REASON.SPONSOR_RACE_DAY,
    FINANCE_REASON.SPONSOR_RESULT_BONUS,
    FINANCE_REASON.SPONSOR_OBJECTIVE_BONUS,
    FINANCE_REASON.SPONSOR_SIGNING_BONUS,
  ],
  prize: [FINANCE_REASON.RACE_PRIZE_PAYOUT, FINANCE_REASON.SEASON_END_DIVISION_BONUS],
  upkeep: [FINANCE_REASON.SEASON_START_UPKEEP],
  facility_upkeep: [FINANCE_REASON.SEASON_START_FACILITY_UPKEEP],
  staff_salary: [FINANCE_REASON.SEASON_START_STAFF_SALARY],
  academy_drift: [FINANCE_REASON.SEASON_START_ACADEMY_DRIFT],
});

const S2_SOURCE_KEYS = Object.keys(S2_SOURCE_REASON_CODES);

function buildReasonCodeIndex() {
  const map = new Map();
  for (const [key, codes] of Object.entries(S2_SOURCE_REASON_CODES)) {
    for (const code of codes) map.set(code, key);
  }
  return map;
}
const REASON_TO_SOURCE_KEY = buildReasonCodeIndex();

/**
 * Aggregerer sæsonens REALISEREDE finance_transactions op i de 7 kildelinjer.
 * Løn er BEVIDST UDELADT herfra — se buildSeasonSwitchPreview: løn er en
 * kontrakt-forpligtelse (riders.salary), ikke en allerede-bogført transaktion,
 * fordi SEASON_END_SALARY først bogføres ved sæsonskiftet selv (samme grund
 * til at kortet viser en "signed contracts"-chip på løn-rækken).
 *
 * Ukendte/ikke-klassificerede reason_codes (transfers, lån, admin osv.) tælles
 * bevidst IKKE med — de 7 kildelinjer er driftsøkonomien, ikke hele ledgeret.
 */
export function aggregateS2RealizedSources(transactions) {
  const sums = Object.fromEntries(S2_SOURCE_KEYS.map((k) => [k, 0]));
  for (const tx of transactions || []) {
    const key = REASON_TO_SOURCE_KEY.get(tx?.reason_code);
    if (!key) continue;
    sums[key] += Number(tx.amount) || 0;
  }
  return {
    ...sums,
    staff_facilities: sums.facility_upkeep + sums.staff_salary,
  };
}

/**
 * Pr.-rytter løn-tabellen til sektion C ("nuværende kontraktløn vs. S3-
 * projektion"). Genbruger computeFrozenSalary 1:1 — samme kald som
 * salaryRecompute3645.mjs's `salaryFn` og financeForecast.js's S3-gren.
 * Kun ryttere PÅ ET HOLD har en kontraktløn at sammenligne (matcher
 * salaryRecompute3645.mjs's afgrænsning, #3645).
 */
export function buildRiderSalaryRows(riders) {
  return (riders || [])
    .filter((r) => r && r.id != null)
    .map((r) => {
      const contract_salary = Number(r.salary) || 0;
      const s3_salary_projection = computeFrozenSalary({
        current_production_value: r.current_production_value,
      });
      return {
        id: r.id,
        firstname: r.firstname ?? "",
        lastname: r.lastname ?? "",
        contract_salary,
        s3_salary_projection,
        delta: s3_salary_projection - contract_salary,
      };
    });
}

export function summarizeRiderSalaryRows(rows) {
  const totalContract = rows.reduce((sum, r) => sum + r.contract_salary, 0);
  const totalProjection = rows.reduce((sum, r) => sum + r.s3_salary_projection, 0);
  return {
    rider_count: rows.length,
    total_contract_salary: totalContract,
    total_s3_salary_projection: totalProjection,
    total_delta: totalProjection - totalContract,
  };
}

// Kvitterings-flowets ordnede trin (#4011 design-go 20/8):
//   books close → sponsor base ind → upkeep → stab/faciliteter → akademi →
//   "salaries switch to S3 rules (no charge)" → "You start season 3 with X".
//
// Beløbene er de SAMME felter som sæson 3-forecastet allerede beregner
// (s3.projected_sponsor_base/projected_upkeep/projected_staff_facilities/
// projected_academy_drift) — ren opsummering, INGEN ny formel. Løn og
// præmie/variabel-sponsor indgår bevidst IKKE i kvitteringen: de er hverken
// sæson-start-opkrævninger (som upkeep/facilities/staff/akademi er, jf.
// economyEngine.processSeasonStart) eller kendte på cutover-tidspunktet
// (præmie/variabel-sponsor er løbsdag-afhængige, samme afgrænsning som
// FINANCE_FORECAST_TYPE_COVERAGE i financeForecast.js).
export function buildSettlementSteps({ startingBalance, s3 }) {
  const steps = [];
  let running = Number(startingBalance) || 0;
  steps.push({ key: "books_close", amount: null, balance_after: running });

  const applyStep = (key, amount) => {
    const amt = Number(amount) || 0;
    running += amt;
    steps.push({ key, amount: amt, balance_after: running });
  };

  applyStep("sponsor_base", s3?.projected_sponsor_base);
  applyStep("upkeep", s3?.projected_upkeep);
  applyStep("staff_facilities", s3?.projected_staff_facilities);
  applyStep("academy_drift", s3?.projected_academy_drift);
  // #3989: lønnen skifter regelsæt VED cutover, men opkræves ikke DER — den
  // forbliver frosset pr. kontrakt indtil hver rytters egen forlængelse/
  // genforhandling bruger den nye formel. Beløbet er derfor altid 0; linjen
  // er ren oplysning ("no charge"), ikke en transaktion.
  steps.push({ key: "salary_switch", amount: 0, balance_after: running });
  steps.push({ key: "start_s3", amount: null, balance_after: running });

  return steps;
}

export function buildSeasonSwitchPreview({ transactions, riders, startingBalance, s3 }) {
  const s2Sources = aggregateS2RealizedSources(transactions);
  const riderRows = buildRiderSalaryRows(riders);
  const riderSummary = summarizeRiderSalaryRows(riderRows);
  const settlement = buildSettlementSteps({ startingBalance, s3 });

  return {
    s2: {
      ...s2Sources,
      // #3989 (låst design punkt 2 i #4011): kontrakt-forpligtelse, ikke en
      // bogført transaktion — "signed contracts"-chippen i UI'et forklarer
      // hvorfor denne linje ser anderledes ud end de øvrige 6.
      salary: -riderSummary.total_contract_salary,
      salary_is_contract: true,
    },
    s3: {
      sponsor_base: s3?.projected_sponsor_base ?? 0,
      sponsor_variable: s3?.projected_sponsor_variable ?? 0,
      prize_low: s3?.prize_low ?? 0,
      prize_high: s3?.prize_high ?? 0,
      salary: s3?.projected_salary ?? 0,
      upkeep: s3?.projected_upkeep ?? 0,
      facility_upkeep: s3?.projected_facility_upkeep ?? 0,
      staff_salary: s3?.projected_staff_salary ?? 0,
      staff_facilities: s3?.projected_staff_facilities ?? 0,
      academy_drift: s3?.projected_academy_drift ?? 0,
      net: s3?.projected_net ?? 0,
    },
    settlement: {
      starting_balance: Number(startingBalance) || 0,
      ending_balance: settlement[settlement.length - 1]?.balance_after ?? (Number(startingBalance) || 0),
      steps: settlement,
    },
    riders: {
      rows: riderRows,
      summary: riderSummary,
    },
  };
}
