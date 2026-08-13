// Udviklings-projektion (#2100) — RENE funktioner, ingen DB/potentiale/Math.random.
//
// Projektionen konvergerer type-ratingen fra NU (eksakt, allerede publiceret) mod
// det MASKEREDE loft-bånd (ceilLo/ceilHi fra scoutingReport.buildTypeCeilingBands —
// allerede ikke-inverterbart, #1543/#1162) via den OFFENTLIGE aldersbaserede
// vækstkurve growthFractionByAge (PROGRESSION_CONFIG). Fald efter peak bruger den
// tilsvarende offentlige declineByYearsPastPeak.
//
// NON-INVERTIBILITET (#1162): hvert projektionspunkt er en konveks kombination af to
// størrelser klienten ALLEREDE har i scouting-rapporten (nu-rating + ceilLo/ceilHi).
// Projektionen er dermed en deterministisk funktion af allerede-emitteret output og
// tilføjer NUL ny information — en angriber kan udregne den selv. Den potentiale-
// afhængige rate-multiplikator (rateByPotential) er BEVIDST udeladt: det er netop den
// kanal der ellers ville lække "sæsoner til loft" → potentiale (samme talent kan så
// ikke skelnes hurtigt vs. langsomt). Se scripts/developmentProjectionHarness.js
// (coverage-scorecard) + scripts/scoutingInversionHarness.js (inverterbarheds-gate).

import { PROGRESSION_CONFIG } from "./riderProgression.js";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Peak-alder (genbrugt fra motoren) — frontend skelner "efter peak" fra "langtidsprojekt".
export const PEAK_AGE = PROGRESSION_CONFIG.peakAge;

// Rest-bånd må ikke kunne inverteres til en eksakt loft-ETA: kræv at loftet nås
// inden for LOFT_REACH_EPS rating-point, og cap projektions-horisonten.
export const LOFT_REACH_EPS = 1;      // rating-point regnet som "ved loft"
export const MAX_PROJECTION_SEASONS = 12;  // timing-søgnings-horisont (til-loft-ETA)
export const DISPLAY_SEASONS = 6;          // tegnet bånd-horisont (længere = ren støj)

// Tempo-usikkerhed: den ægte motor skalerer vækst-fraktionen med en potentiale-afhængig
// rate (riderProgression.youthRateForPotential ∈ [0.6, 1.35]). Vi kender IKKE rytterens
// potentiale (og må ikke lække den) → projektionen bracketterer HELE spændet med to
// ærlige envelopes. Fordi de SAMME globale parametre bruges for ALLE ryttere, afslører
// bredden intet om DENNE rytters potentiale — men rytterens faktiske trajektorie ligger
// i intervallet per konstruktion. Kalibreret empirisk mod den ægte motor i
// scripts/developmentProjectionHarness.js (coverage-gate).
//
// Nedre envelope (pessimistisk): den langsomste rytter vokser LANGSOMT (rate 0.5 <
// motorens min-rate 0.6 → nedre kant forbliver under reality = 0% over-lovende, men
// stiger så båndet viser forventet vækst frem for et fladt gulv). Efter peak falder han.
// Øvre envelope (optimistisk): hurtig vækst mod ceilHi; efter peak falder han mildt.
// Ejer-valgt "smalt" bånd (2026-07-09): tættere/mere informativt end det flade gulv,
// samme sikkerhed (validér i developmentProjectionHarness.js: median 1.0, 0% over-lovende).
export const RATE_GROWTH_LO = 0.5;   // nedre: langsom-men-reel vækst (< motorens min 0.6)
export const RATE_GROWTH_HI = 1.15;  // øvre: lidt under max-rate → strammere top

// Rating-niveau decline pr. sæson efter peak.
//
// #3666 — DEN ER NU MOTORENS EGEN KURVE, ikke en separat kalibrering.
//
// Før stod her 2,5 / 3,5 / 4,5 med begrundelsen "re-ratet type-decline er ~2-4
// pt/sæson, IKKE de 1-2,6 ability-point motoren bruger pr. evne". Det var sandt
// på den gamle skala: normaliseringen strakte ability-faldet op, så et fald på
// 1 evne-point kom ud som 2,5 rating-point. Den forstærkning findes ikke mere.
// Rating ER nu det vægtede snit af rollens evner — falder hver evne med X, falder
// snittet med X. Den dedikerede kurve var altså ikke længere en oversættelse; den
// var bare et forkert tal.
//
// MÅLT 14/8 mod 1.200 ægte prod-ryttere over peak, ved at køre motorens egen
// stepAbility ét sæsonskridt og regne rolle-ratingen før og efter:
//
//   1-3 år forbi peak:  faktisk 0,97   (kurven påstod 2,5)
//   4-6 år forbi peak:  faktisk 1,70   (kurven påstod 3,5)
//   7+  år forbi peak:  faktisk 2,63   (kurven påstod 4,5)
//
// Konsekvensen af de gamle tal på den nye skala var ikke kosmetisk: en rytter på
// median-rating 15 blev projekteret til NUL på seks sæsoner. Spilleren fik at
// vide at hans 30-årige var færdig, mens motoren i virkeligheden ville tage ~15
// sæsoner om det samme.
//
// Tallene aflæses derfor DIREKTE af motoren i stedet for at blive kopieret.
// Ændrer nogen motorens decline, følger projektionen med af sig selv — og de to
// kan ikke længere drifte fra hinanden i tavshed. Afvigelsen mellem målingen og
// motorens tal (0,97 mod 1,0) er off-type-evnerne, der falder 0,7× og trækker
// det vægtede snit en anelse ned; den er under 6 % og kræver ingen korrektion.
export const RATING_DECLINE_BY_YEARS_PAST_PEAK = PROGRESSION_CONFIG.declineByYearsPastPeak;
export const DECLINE_MULT_STEEP = 0.9;   // nedre envelope (worst case)
export const DECLINE_MULT_MILD = 0.6;    // øvre envelope (best case)

function growthFracForAge(age, cfg) {
  for (const row of cfg.growthFractionByAge) if (age <= row.maxAge) return row.frac;
  return cfg.growthFractionByAge[cfg.growthFractionByAge.length - 1].frac;
}

function ratingDeclineForYearsPastPeak(years) {
  for (const row of RATING_DECLINE_BY_YEARS_PAST_PEAK) if (years <= row.maxYears) return row.drop;
  return RATING_DECLINE_BY_YEARS_PAST_PEAK[RATING_DECLINE_BY_YEARS_PAST_PEAK.length - 1].drop;
}

// Ét sæson-skridt på RATING-niveau (ikke ability-niveau) mod et loft. Kun offentlig
// kurve: < peak lukker `growthMult` × en aldersbestemt brøkdel af (ceil − rating);
// ≥ peak falder `declineMult` × den kalibrerede rating-decline (rate-uafhængigt —
// decline skaleres ikke af potentiale i motoren).
//
// #3666: skalaens bund er 0, ikke 1. Den gamle normaliserede skala kunne ikke
// producere 0; den nye kan (målt: 2 levende ryttere har rolle-rating præcis 0).
// Med gulvet på 1 ville projektionen for dem tegne en linje der lå over
// virkeligheden — og en spiller der ser 1 hvor tallet er 0, har fået et forkert
// svar, uanset hvor lille forskellen er.
export function stepRating(rating, ceil, age, cfg = PROGRESSION_CONFIG, growthMult = 1, declineMult = 1) {
  const peak = cfg.peakAge;
  if (age <= peak) {
    const gap = ceil - rating;
    if (gap <= 0) return rating; // på/over loft → flad indtil peak
    const frac = clamp(growthFracForAge(age, cfg) * growthMult, 0, 1);
    return rating + gap * frac;
  }
  return rating - ratingDeclineForYearsPastPeak(age - peak) * declineMult;
}

// Projektér ét spor (nu → ceil) frem `seasons` sæsoner ved givne vækst-/decline-
// multiplikatorer. Returnerer [{ season, value }] inkl. season 0 (= nu).
export function projectTrack(now, ceil, age, seasons, cfg = PROGRESSION_CONFIG, growthMult = 1, declineMult = 1) {
  const out = [{ season: 0, value: clamp(now, 0, 99) }];
  let r = now;
  let a = age;
  for (let s = 1; s <= seasons; s++) {
    r = clamp(stepRating(r, ceil, a, cfg, growthMult, declineMult), 0, 99);
    a += 1;
    out.push({ season: s, value: r });
  }
  return out;
}

// Projektions-BÅND fra to ærlige envelopes:
//   • nedre (pessimistisk): fladt gulv i vækst (RATE_GROWTH_LO) mod ceilLo + stejl decline
//   • øvre (optimistisk): hurtig vækst (RATE_GROWTH_HI) mod ceilHi + mild decline
// Per-punkt min/max så lo ≤ hi, afrundet til HELTAL (rating-skalaen er 1-99 heltal, så
// et heltals-bånd matcher den faktiske rating og undgår sub-punkt afrundings-misses).
// Returnerer [{ season, lo, hi }] (season 0..seasons).
export function projectCeilingBand({ now, ceilLo, ceilHi, age, seasons = MAX_PROJECTION_SEASONS, cfg = PROGRESSION_CONFIG }) {
  const lower = projectTrack(now, ceilLo, age, seasons, cfg, RATE_GROWTH_LO, DECLINE_MULT_STEEP);
  const upper = projectTrack(now, ceilHi, age, seasons, cfg, RATE_GROWTH_HI, DECLINE_MULT_MILD);
  return lower.map((p, i) => ({
    season: p.season,
    lo: clamp(Math.floor(Math.min(p.value, upper[i].value)), 0, 99),
    hi: clamp(Math.ceil(Math.max(p.value, upper[i].value)), 0, 99),
  }));
}

// "Til loft"- + "alder ved loft"-timing — udledt DIREKTE af det viste projektions-bånd,
// så tal og billede altid stemmer overens. "Når loftet" = den optimistiske øvre envelope
// træder ind i den skraverede loft-zone (rating ≥ ceilLo):
//   • lo (tidligst): sæson hvor øvre envelope når ceilLo (ind i zonen)
//   • hi (senest):   sæson hvor øvre envelope når ceilHi (zonens top) — ofte null fordi
//                    envelopen nærmer sig ceilHi asymptotisk (→ "~X+ sæsoner")
// Returnerer:
//   { seasons:{lo,hi}, ageAt:{lo,hi} } — lo=0 ⇒ allerede i zonen; hi=null ⇒ åben ("+").
//   null — øvre envelope når aldrig zonen i display-vinduet (decline eller plateau under
//          loftet). Frontend skelner de to via `pastPeak`-flaget.
export function ceilingTiming({ now, ceilLo, ceilHi, age, seasons = DISPLAY_SEASONS, cfg = PROGRESSION_CONFIG }) {
  const band = projectCeilingBand({ now, ceilLo, ceilHi, age, seasons, cfg });
  const reachLo = band.findIndex((p) => p.hi >= ceilLo); // ind i zonen
  const reachHi = band.findIndex((p) => p.hi >= ceilHi); // zonens top
  if (reachLo === -1) return null;
  const lo = reachLo; // band[i].season === i
  const hi = reachHi === -1 ? null : reachHi;
  return {
    seasons: { lo, hi },
    ageAt: { lo: age + lo, hi: hi == null ? null : age + hi },
  };
}
