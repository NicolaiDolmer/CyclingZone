// Akademi-flag + konstanter (#1308). Flag-mønster spejler dailyTrainingFlag.js
// (app_config, runtime-flip, fail-safe false). Konkrete beløb (DRIFT_PER_SEASON,
// SIGNING_FEE_RATE) kalibreres i sim-harness (academyEconomySimulation.js) og
// godkendes af ejer før flag-flip — placeholders her er sim-startpunkter.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { SALARY_RATE } from "./economyConstants.js";

export const ACADEMY = Object.freeze({
  FLAG_KEY: "academy_enabled",
  SLOTS: 8,                 // pladser pr. akademi (hård cap)
  MIN_AGE: 16,
  MAX_AGE: 21,
  INTAKE_MIN: 3,            // kandidater pr. kuld
  INTAKE_MAX: 5,
  SERIOUS_MIN: 1,           // "seriøse" (høj potentiale) pr. kuld
  SERIOUS_MAX: 3,
  YOUTH_MULT: 1.5,          // ungdoms-multiplikator ved MIN_AGE (aftager mod 1.0 ved 22)
  DRIFT_PER_SEASON: 5_000,  // pr. plads pr. sæson. EJER-GODKENDT 13/6 (Task 9-sim): youth-værdi
                            // er empirisk ~11k (base_value vægter kun current stats), så drift er
                            // den dominerende cost. 5k/plads → delvist akademi (3-4) trygt bæreligt
                            // i alle divisioner; fuldt 8-plads (~40k drift) = bevidst tung satsning.
  SIGNING_FEE_RATE: 0.25,   // signing-fee = rate × market_value (marginal ved lav youth-værdi)
  SALARY_RATE,              // #2083: ungdoms-/akademi-løn ensrettet til den delte senior-rate
                            // (economyConstants.SALARY_RATE = 0.067). Youth har ikke længere en
                            // separat rate — ét fælles løn-system for alle ryttere (ejer-valgt 3/7).
  CONTRACT_LENGTH: 3,       // akademi-kontrakt-længde (sæsoner)

  // #2082/#1938 (ejer-godkendt 5/7): daglig træning for akademi-alder brugte KUN
  // livstids-loftet direkte + en dage-baseret rate → ubegrænset vækst så længe
  // sæsonen varede (S1 var stadig åben efter 57+ dage, se issue-diskussion).
  // Fix: sæson-budget mætter væksten ved sæsonens andel af gappet (afkoblet fra
  // sæsonlængde), med en AFTAGENDE rate pr. alder — matcher ejerens mål om ~50%
  // af ungdomsloft-gappet lukket efter 5-7 sæsoner, men mere synlig fremgang
  // tidligt for nye akademi-spillere end en flad rate ville give.
  // #2437: IKKE i brug i prod-stien længere (dailyTrainingEngine.js sender ikke
  // længere et sæson-loft) — bevares fordi careerCurveSimulation.js bruger den til at
  // modellere "current"-modellen (den gamle sæson-loft-adfærd) i før/efter-
  // sammenligningen mod interim-modellerne (rate/N). Slet ikke uden at opdatere sim'en.
  SEASON_FRAC_BY_AGE: Object.freeze([
    { maxAge: 17, frac: 0.16 },
    { maxAge: 19, frac: 0.11 },
    { maxAge: 99, frac: 0.08 },
  ]),
  // ── HARD_DAILY_CAP + INTERIM_RATE_MULT ER FJERNET (#3709 trin 5, beslutning 13) ──
  //
  // De var:
  //   HARD_DAILY_CAP: 1         maks +1 evne-point/dag/evne for akademi-alder
  //   INTERIM_RATE_MULT: 1/3    dæmpning af akademi-alderens daglige rate
  //
  // Begge fandtes kun for at bremse en model der MÆTTEDE. #2082's prod-empiri
  // (værste tilfælde +156 point på 10 dage) og #2437's interim var symptomer på
  // det samme: når hver evne når sit loft inden for karrieren under alle
  // indstillinger, er en høj ungdoms-rate en spike der skal klippes. Trin 4
  // fjerner mætningen ved roden via rolle-raten, og så bremser de to knapper
  // ikke længere en fejl — de bremser bare væksten.
  //
  // Det er IKKE oprydning, det er bærende. Målt: beholdes 1/3-dæmpningen oven på
  // trin 4, falder kandidatens rating-median fra 28 til 22, altså langt under
  // dagens 27, for alle. Derfor er trin 4 og 5 ét ship.
  //
  // Akademiet adskiller sig herefter KUN ved `youthMultiplier` nedenfor.
  //
  // ⚠ `SEASON_FRAC_BY_AGE` + `academySeasonFracForAge` er BEVARET fordi
  //   careerCurveSimulation.js modellerer den GAMLE adfærd med dem i sine
  //   før/efter-sammenligninger. De er ikke i produktionsstien og har ikke
  //   været det siden #2437.
});

export function isAcademyAge(age) {
  return Number.isFinite(age) && age >= ACADEMY.MIN_AGE && age <= ACADEMY.MAX_AGE;
}

// #2437: IKKE i brug i prod-stien længere — se kommentaren ved SEASON_FRAC_BY_AGE.
// Bruges kun af careerCurveSimulation.js til at modellere "current"-modellen.
export function academySeasonFracForAge(age) {
  const table = ACADEMY.SEASON_FRAC_BY_AGE;
  for (const row of table) {
    if (age <= row.maxAge) return row.frac;
  }
  return table[table.length - 1].frac;
}

// Lineær aftagning fra YOUTH_MULT (ved MIN_AGE) mod 1.0 (ved MAX_AGE+1=22).
// Uden for akademi-alder = 1.0 (ingen boost).
export function youthMultiplier(age) {
  if (!isAcademyAge(age)) return 1.0;
  const span = (ACADEMY.MAX_AGE + 1) - ACADEMY.MIN_AGE; // 22-16 = 6
  const t = (age - ACADEMY.MIN_AGE) / span;             // 0 ved 16 → 5/6 ved 21
  return ACADEMY.YOUTH_MULT - (ACADEMY.YOUTH_MULT - 1.0) * t;
}

export async function isAcademyEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY.FLAG_KEY), opts);
}
