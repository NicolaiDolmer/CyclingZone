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
// REVISION 20/8 (read-only kode-revision, ejer-direktiv "perfekt korrekthed
// før merge"): første udgave havde tre rod-fejl, alle rettet her —
//   1. Kvitteringens løn-trin viste et opdigtet "no charge"-beløb. Den
//      RIGTIGE season-start-payroll (economyEngine.processTeamSeasonPayroll)
//      trækker HELE lønnen som cash ved skiftet (SEASON_END_SALARY), og
//      cutover-drejebogen (docs/2026-08-23-cutover-drejebog.md, "Rækkefølgen
//      i vinduet") kører løn-genberegningen (#3999) FØR den charge — så det
//      beløb der reelt trækkes er S3-lønnen (computeFrozenSalary), aldrig de
//      frosne S2-kontrakter. Kvitteringen skal derfor debitere s3.projected_
//      salary, ikke 0.
//   2. S2-sponsor-aggregeringen puttede HELE SEASON_START_SPONSOR-beløbet
//      (kontraktbase ELLER division-flad-base + rang/point-performance-bonus,
//      begge dele i ÉN transaktion, jf. sponsorEngine.computeVariableSponsor)
//      i en "sponsor_base"-bucket der blev sammenlignet med S3's `base`-felt
//      — som UDELUKKENDE er den flade/kontrakt-del, uden performance-bonus.
//      De to tal måler ikke det samme. Et eksakt tilbageregnet split for S2
//      ville kræve forrige sæsons standings OG den kontrakt der reelt var
//      aktiv ved S2's sæsonstart OG den historiske board-modifier på det
//      tidspunkt — ingen af de tre er pålideligt rekonstruerbare fra denne
//      routes tilgængelige data (board_modifier er LIVE, ikke frosset ved
//      sæsonstart, #1187). Løsningen her er derfor bevidst den ÆRLIGE, ikke
//      den nemmeste: S2 vises som ÉT kombineret realiseret sponsor-beløb
//      (samme tal som rent faktisk landede i banken), med en eksplicit UI-
//      fodnote om at S3 splitter beløbet i base/performance-bonus mens S2
//      ikke kan. De løbende løbsdags-/resultat-/mål-/underskriftsbonusser
//      (som slet ikke indgår i S3's forecast, jf. financeForecast.js's
//      FINANCE_FORECAST_TYPE_COVERAGE) får deres EGEN bucket
//      (sponsor_in_season_bonus), aldrig sammenblandet med sponsor-basen.
//   3. Kvitteringen krediterede kun sponsor-BASEN (udelod performance-
//      bonussen), selvom begge dele udbetales i ÉN transaktion ved
//      sæsonstart — samme rod-årsag som (2). Rettet: kvitteringens sponsor-
//      trin krediterer base + performance-bonus SAMLET (præcis det beløb der
//      rent faktisk krediteres), med en detail-linje der viser splittet.
// Se også: Staff/facilities er nu to separate linjer overalt (facility-drift
// og staff-løn er to forskellige strømme, tallene fandtes allerede separat).
// Akademi-trinnet udelades af kvitteringen når beløbet er 0 (konsistent med
// kortets betingede rækker). Rækkefølgen følger nu den FAKTISKE cash-order i
// processSeasonStart → processTeamSeasonPayroll: sponsor (pass A) → lånerente
// → løn → akademi-drift → upkeep → facilitets-upkeep → staff-løn (pass B).
// Negativ-balance-rente og nødlån er BEVIDST udeladt (samme "ikke
// forecastbart"-begrundelse som FINANCE_FORECAST_TYPE_COVERAGE — kontingent
// på om lønnen rent faktisk gør balancen negativ) — nævnt i UI'ets
// udeladelses-fodnote i stedet.
//
// Refs #4011 #3989 #3899 #3236.

import { FINANCE_REASON } from "./economyConstants.js";
import { computeFrozenSalary } from "./contractSeed.js";

// reason_code → hvilken S2-bucket beløbet hører under. Bruges til at
// aggregere INDEVÆRENDE sæsons (S2) REALISEREDE finance_transactions —
// modsat sæson 3-kolonnen, som er en PROGNOSE (computeFinanceForecast).
//
// `sponsor_season_start` er BEVIDST étt kombineret felt (se REVISION 20/8
// punkt 2 ovenfor) — det er den fulde SEASON_START_SPONSOR(+prorata)-
// transaktion, base og performance-bonus uadskilt. `sponsor_in_season_bonus`
// er en HELT ANDEN indtægtsstrøm (løbsdag/resultat/mål/underskrift), som S3
// slet ikke forecaster — den må ALDRIG stå under samme label som S3's
// "variable" (som er rang/point-performance-bonussen inde i sponsor-basen).
export const S2_SOURCE_REASON_CODES = Object.freeze({
  sponsor_season_start: [FINANCE_REASON.SEASON_START_SPONSOR, FINANCE_REASON.MIDSEASON_SPONSOR_PRORATA],
  sponsor_in_season_bonus: [
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
 * Aggregerer sæsonens REALISEREDE finance_transactions op i buckets.
 * Løn er BEVIDST UDELADT herfra — se buildSeasonSwitchPreview: løn er en
 * kontrakt-forpligtelse (riders.salary), ikke en allerede-bogført transaktion,
 * fordi SEASON_END_SALARY først bogføres ved sæsonskiftet selv (samme grund
 * til at kortet viser en "signed contracts"-chip på løn-rækken).
 *
 * Ukendte/ikke-klassificerede reason_codes (transfers, lån, admin osv.) tælles
 * bevidst IKKE med — bucketterne er driftsøkonomien, ikke hele ledgeret.
 */
export function aggregateS2RealizedSources(transactions) {
  const sums = Object.fromEntries(S2_SOURCE_KEYS.map((k) => [k, 0]));
  for (const tx of transactions || []) {
    const key = REASON_TO_SOURCE_KEY.get(tx?.reason_code);
    if (!key) continue;
    sums[key] += Number(tx.amount) || 0;
  }
  return sums;
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

// Kvitterings-flowets ordnede trin (REVISION 20/8 — følger nu den FAKTISKE
// cash-rækkefølge i economyEngine.processSeasonStart → processTeamSeasonPayroll,
// ikke en opdigtet parallel rækkefølge):
//   books close → sponsor (base+performance-bonus, ÉN transaktion, pass A) →
//   lånerente (pass B trin 1) → løn (pass B trin 2, S3-genberegnet) →
//   akademi-drift (pass B trin 4, skjult ved 0) → upkeep (pass B trin 5,
//   skjult ved 0) → facilitets-upkeep (pass B trin 6a, skjult ved 0) →
//   staff-løn (pass B trin 6b, skjult ved 0) → "du starter næste sæson med".
//
// Negativ-balance-rente (pass B trin 3) og eventuelt nødlån er UDELADT: begge
// er kontingente på om lønnen rent faktisk gør balancen negativ — samme
// "ikke forecastbart"-logik som FINANCE_FORECAST_TYPE_COVERAGE bruger for
// præcis disse strømme. Nævnes i stedet i UI'ets udeladelses-fodnote.
//
// `s3Mapped` er de FELT-NAVNE denne fil selv bruger (sponsor_base,
// sponsor_variable, loan_interest, salary, academy_drift, upkeep,
// facility_upkeep, staff_salary) — ÉT sæt navne, ingen dobbelt-mapning
// mellem denne funktion og buildSeasonSwitchPreview.
export function buildSettlementSteps({ startingBalance, s3Mapped }) {
  const steps = [];
  let running = Number(startingBalance) || 0;
  steps.push({ key: "books_close", amount: null, balance_after: running });

  const applyStep = (key, amount, extra) => {
    const amt = Number(amount) || 0;
    running += amt;
    steps.push({ key, amount: amt, balance_after: running, ...extra });
  };

  // 1. Sponsor — pass A, ÉN transaktion (SEASON_START_SPONSOR). Base og
  //    performance-bonus krediteres SAMLET i virkeligheden; trinnet bærer
  //    begge komponenter som ekstra felter så UI'et kan vise splittet uden at
  //    opfinde en charge der ikke findes.
  const sponsorBase = Number(s3Mapped?.sponsor_base) || 0;
  const sponsorVariable = Number(s3Mapped?.sponsor_variable) || 0;
  applyStep("sponsor", sponsorBase + sponsorVariable, { base: sponsorBase, variable: sponsorVariable });

  // 2. Lånerente — pass B trin 1. Kun vist når holdet faktisk har et beløb
  //    (ingen aktive lån ⇒ 0 ⇒ ingen linje, ligesom kortets betingede rækker).
  const loanInterest = Number(s3Mapped?.loan_interest) || 0;
  if (loanInterest !== 0) applyStep("loan_interest", loanInterest);

  // 3. Løn — pass B trin 2. #3999/#3989 (cutover-drejebogen, "Rækkefølgen i
  //    vinduet"): løn-genberegningen kører FØR denne charge søndag, så det
  //    reelt trukne beløb ER S3-formlen — aldrig 0, aldrig de frosne
  //    S2-kontrakter.
  applyStep("salary", s3Mapped?.salary);

  // 4. Akademi-drift — pass B trin 4. Skjult ved 0 (intet akademi).
  const academyDrift = Number(s3Mapped?.academy_drift) || 0;
  if (academyDrift !== 0) applyStep("academy_drift", academyDrift);

  // 5. Upkeep — pass B trin 5. (Sæson-1-udskydelsen, UPKEEP_BEFORE_FIRST_
  //    RACE_ENABLED, gælder kun sæson 1 og er derfor irrelevant for enhver
  //    S2→S3-lignende overgang — men skjules alligevel ved 0 for robusthed.)
  const upkeep = Number(s3Mapped?.upkeep) || 0;
  if (upkeep !== 0) applyStep("upkeep", upkeep);

  // 6a. Facilitets-upkeep — pass B trin 6 (chargeFacilityCosts). Egen linje
  //     (REVISION 20/8 punkt 4) — ikke længere slået sammen med staff-løn.
  const facilityUpkeep = Number(s3Mapped?.facility_upkeep) || 0;
  if (facilityUpkeep !== 0) applyStep("facility_upkeep", facilityUpkeep);

  // 6b. Staff-løn — pass B trin 7 (chargeFacilityCosts). Egen linje.
  const staffSalary = Number(s3Mapped?.staff_salary) || 0;
  if (staffSalary !== 0) applyStep("staff_salary", staffSalary);

  steps.push({ key: "start_s3", amount: null, balance_after: running });

  return steps;
}

export function buildSeasonSwitchPreview({ transactions, riders, startingBalance, s3 }) {
  const s2Sources = aggregateS2RealizedSources(transactions);
  const riderRows = buildRiderSalaryRows(riders);
  const riderSummary = summarizeRiderSalaryRows(riderRows);

  // Ét sæt S3-feltnavne, genbrugt af BÅDE det eksponerede `s3`-output og
  // kvitteringen — undgår at de to kan drifte fra hinanden (REVISION 20/8).
  // #4011-krav: løn-trinnets/-kolonnens beløb SKAL matche rytter-tabellens
  // total 1:1 — begge er derfor literally s3.projected_salary, ingen
  // uafhængig genberegning.
  const s3Mapped = {
    sponsor_base: s3?.projected_sponsor_base ?? 0,
    sponsor_variable: s3?.projected_sponsor_variable ?? 0,
    prize_low: s3?.prize_low ?? 0,
    prize_high: s3?.prize_high ?? 0,
    salary: s3?.projected_salary ?? 0,
    loan_interest: s3?.projected_loan_interest ?? 0,
    upkeep: s3?.projected_upkeep ?? 0,
    facility_upkeep: s3?.projected_facility_upkeep ?? 0,
    staff_salary: s3?.projected_staff_salary ?? 0,
    academy_drift: s3?.projected_academy_drift ?? 0,
    net: s3?.projected_net ?? 0,
  };

  const settlement = buildSettlementSteps({ startingBalance, s3Mapped });

  return {
    s2: {
      ...s2Sources,
      // #3989 (låst design punkt 2 i #4011): kontrakt-forpligtelse, ikke en
      // bogført transaktion — "signed contracts"-chippen i UI'et forklarer
      // hvorfor denne linje ser anderledes ud end de øvrige.
      salary: -riderSummary.total_contract_salary,
      salary_is_contract: true,
    },
    s3: s3Mapped,
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
