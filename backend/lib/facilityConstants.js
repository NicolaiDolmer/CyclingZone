// Slice A (#1441 Fase 3) — facilitets-/staff-konstanter.
// Rekalibreret i bølge A2 efter review af første kalibrering (8235bc46): den gamle
// inflations-gate (100% adoption all-in) pressede konstanterne ud i degenererede
// former; nu gælder 0,6-adoption-gaten + form-gates (§2.1-intent) i harnesset.
// Begge scorecards (facilityInvestmentScorecard + inflationScorecard) HEADLINE ✅ —
// se docs/audits/2026-07-05-facility-investment-calibration.md.
// FACILITIES_ENABLED flippes stadig kun med ejer-go. Eksporteres enkeltvis så
// economyCalibrationOverrides kan sweepe dem.
//
// Kalibrerings-design (vigtigt for fremtidige justeringer — ændr IKKE enkelt-tal
// isoleret, kør harness igen):
//   • Engangs-pris er den PRIMÆRE omkostning (spec §2.1: "engangs-pris + mindre
//     løbende upkeep") — form-gaten håndhæver 5 sæsoners upkeep < kumulativ pris.
//   • Effekt-kurverne er konvekse (~×1,5-2 pr. tier) så dybde-strategier kan
//     konkurrere med bredde ("balanced") trods breddens tidsforspring; t3-niveauet
//     er løftet let og t5 sænket let ift. ren geometri (bærende for at BÅDE
//     D3-specialister OG D2/D1-balanced ligger inden for ±10%, spec §2.3).
//   • Per-track-tops kompenserer leverage-antagelserne (training ×3,0 / medical
//     ×1,5 / scouting ×0,3) så trackenes værdi-densitet er sammenlignelig.
//   • Staff-løn er forankret i staff'ens marginale værdi (form-gate: løn ∈ [5%, 40%]
//     af værdi-tilførslen i D2 ved matched tier; kalibreret ~29-36%). Med util-
//     modellen (0,5 → 1,0) er det matematisk umuligt at gøre lønnen meget større
//     uden at staff bliver en fælde (aldrig rentabel) — større "prestige-lønninger"
//     kræver en bredere util-model (ejer-beslutning, uden for A2-scope).

// Hård gate: køb/ansæt/payroll-debits er no-ops mens false. Tændes KUN efter
// A2-harness-grøn + ejer-go (kode-konstant (kræver deploy at flippe); om den skal være app_config-runtime-gated som academy afgøres i A2).
export const FACILITIES_ENABLED = false;

export const FACILITY_TRACKS = Object.freeze(["training", "scouting", "medical", "academy", "commercial"]);
export const MAX_FACILITY_TIER = 5;

// Engangs-pris pr. tier (kumulativ opgradering: man betaler ét trin ad gangen).
// Tid-som-valuta-ankre (spec §2.4, kumulativ pris i sæsoners repræsentativ
// PRÆMIE-indkomst D1 160k / D2 70k / D3 25k): T1/D3 = 0,48 · T3-kum/D2 = 1,26 ·
// T5-kum/D1 = 2,67 — alle nær spec-målene (0,5 / ≈1 / 2-3), ikke bånd-bunde.
// Trappen er monoton ×1,9-2,4 pr. tier (form-gate: ∈ [1,5, 4]).
export const FACILITY_TIER_PRICE = Object.freeze({ 1: 12_000, 2: 26_000, 3: 50_000, 4: 100_000, 5: 240_000 });

// Løbende tier-upkeep pr. sæson — det MINDRE, løbende sink (spec §2.1): 5 sæsoners
// upkeep ved tier T er 35-63% af den kumulative pris til T (form-gate: < 100%).
export const FACILITY_TIER_UPKEEP = Object.freeze({ 0: 0, 1: 1_500, 2: 3_500, 3: 8_000, 4: 15_000, 5: 30_000 });

// DEPRECATED (#2216 A4): flad tier→løn-tabel. Erstattet af den rating-drevne
// staffSalaryFor(overall)-kurve nedenfor, så løn bider proportionalt med staffens
// faktiske kvalitet (Q1) i stedet for et groft 5-trins-tier. Bevaret som fallback
// indtil A4b (kandidat-/profil-UI) er migreret, og som referenceanker for kurven.
export const STAFF_SALARY_BY_TIER = Object.freeze({ 1: 100, 2: 250, 3: 600, 4: 1_300, 5: 2_600 });

// ── Ability-drevet effekt-model (#2216 A4, Task 6 · KALIBRERET Task 8, REKALIBRERET
//    efter ejer-valg 2026-07-05: ±15%-gate) ───────────────────────────────────────
// Erstatter A3's tier→udnyttelses-skalar (staffUtilization) med en overall-drevet
// faktor: staffEffectFactor(staff) = FLOOR + SLOPE·(overall/99). Range [0.5, 1.0].
//   • FLOOR (0.5) = udnyttelsen UDEN chef — en facilitet uden ansat kører på 50%.
//   • SLOPE (0.5) = span en overall-99-chef tilfører → faktor PRÆCIS 1.0 ved overall 99.
// Lineær + monoton i overall. HISTORIK: Task 8 sænkede FLOOR til 0.4 for at få anti-
// optimal-path-D3-cellen grøn under den STRAMME ±10%-gate (den ability-drevne faktor er
// fladere mellem tiers end den gamle skalar, så gulv 0.5 gjorde "ingen chef" for stærkt).
// EJER-VALG 2026-07-05: gaten løsnet til ±15% (se COMPETITIVE_THRESHOLD i
// facilityInvestmentModel.js) → FLOOR kan nu restaureres til 0.5 med KOMFORTABEL margin
// (D3-worst-cell 0,871 = 2,1pp over 0,85-tærsklen; før razor-thin 0,901/0,90). Det giver
// den rene semantik "ingen chef = 50%" + faktor 1.0 ved en perfekt overall-99-chef.
export const STAFF_EFFECT_FACTOR_FLOOR = 0.5;
export const STAFF_EFFECT_FACTOR_SLOPE = 0.5;

// Per-rytter specialiserings-multiplikator (specializationMatch) — IKKE i facilitets-
// display-magnituden; bruges af trænings-hooket i Task 7 (dimension×niveau pr. rytter).
// baseline 1.0 for en generalist / manglende akse; > 1.0 når chefens dimension OG
// niveau er stærke; loftet ved `cap`. baselineOverall = det referencepunkt hvor en
// "flad" chef giver præcis 1.0 (akser over/under skubber match op/ned).
//   contribution = 1 + weightDimension·norm(dim − baseline) + weightLevel·norm(lvl − baseline)
// hvor norm(x) = x / (99 − baseline) klippes til [-1, +1]; resultatet clampes [floor, cap].
// EJER-VALG 2026-07-05: weightDimension/weightLevel restaureret til 0.25/0.15 (de
// oprindelige Task-6-værdier). Med den løsnede ±15%-specialiserings-balance-gate (§7)
// SKAL specialisering være en REEL strategisk løftestang: en matchet specialist er nu
// +14% bedre end en generalist (inden for ±15%, ~1pp fra loftet — bevidst tæt på for at
// UDNYTTE headroom'et; ejeren ville have specialisering til at "føles konsekvensfuld").
// Task 8 havde sænket dem til 0.15/0.08 (+8,6%) for at holde ±10%-gaten, men det gjorde
// specialisering til en nuance snarere end en beslutning. floor/cap uændrede (cap 1.4
// ikke bindende: max-akser giver 1 + 0.25 + 0.15 = 1.4 = præcis cap).
export const STAFF_SPECIALIZATION = Object.freeze({
  baselineOverall: 50,
  weightDimension: 0.25,
  weightLevel: 0.15,
  floor: 0.85,
  cap: 1.4,
});

// Rating-drevet staff-løn (staffSalaryFor) — erstatter STAFF_SALARY_BY_TIER.
// Konveks potens-kurve forankret i de gamle tier-lønninger ved tier-båndenes
// midtpunkter: salary = round(floor + base·(overall/ref)^exp). Løn bider dermed med
// staffens faktiske overall (Q1) i stedet for et groft tier-trin.
// REKALIBRERET (ejer-valg 2026-07-05, floor→0.5): base 2600→2400. Med et effekt-gulv på
// 0.5 (i stedet for Task-8's 0.4) er en ansættelses MARGINALE værdi mindre (chefen løfter
// fra 0.5, ikke 0.4), så løn/værdi-forholdet stiger. base 2400 holder staff-relevans-gaten
// komfortabelt inden for [0.05, 0.40] (t4-topper på 0.371 mod tidligere 0.401-overskridelse).
// floor/cap = kalibrerings-bånd (positiv bund, loftet top).
export const STAFF_SALARY_CURVE = Object.freeze({
  base: 2400,
  refOverall: 81,
  exponent: 4,
  floor: 50,
  cap: 6000,
  minOverall: 20,
});

// Rating-drevet staff-sæsonløn. Monoton stigende i overall, clampet til [floor, cap].
export function staffSalaryFor(overall) {
  const c = STAFF_SALARY_CURVE;
  const o = Math.max(0, overall ?? 0);
  const raw = c.floor + c.base * Math.pow(o / c.refOverall, c.exponent);
  return Math.round(Math.min(c.cap, raw));
}

// Fyring: betal resterende sæsonløn × faktor (spec §2.2, sink + friktion).
export const STAFF_SEVERANCE_FACTOR = 0.5;

// Effekt-model (spec §2.2: facilitet = kapacitet, staff = udnyttelsesgrad).
// effectiveBonus = FACILITY_BASE_EFFECT[track][facilityTier] × staffUtilization(staffTier)
// staffUtilization: 0.5 uden staff; 0.6..1.0 ved staff-tier 1..5.
// Effekt-tallene er per-track multiplikator-bonusser (0 = ingen effekt).
// KUN 'training' og 'commercial' har live effekt-hooks i A1-scope; scouting/medical/academy
// får deres hooks i egne opfølgnings-slices (spec §2.1) — deres base-effekt er defineret
// her så priser/harness kan kalibreres samlet.
// Kurve-formen (konveks, strengt stigende — form-gate: hvert step ≥ 20% af
// gennemsnitssteppet) er gate-bærende — se audit-rapporten før justering.
export const FACILITY_BASE_EFFECT = Object.freeze({
  training:   Object.freeze({ 0: 0, 1: 0.03, 2: 0.045, 3: 0.074, 4: 0.11, 5: 0.165 }),
  scouting:   Object.freeze({ 0: 0, 1: 0.015, 2: 0.032, 3: 0.07, 4: 0.145, 5: 0.30 }),  // info-synlighedsgrad
  medical:    Object.freeze({ 0: 0, 1: 0.06, 2: 0.09, 3: 0.148, 4: 0.22, 5: 0.33 }),    // form-genopretning
  academy:    Object.freeze({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }),                    // ekstra akademi-slots
  commercial: Object.freeze({ 0: 0, 1: 0.0006, 2: 0.0013, 3: 0.0027, 4: 0.0057, 5: 0.012 }), // sponsor-multiplikator-bonus
});

// Anti-runaway-invariant (spec §2.1): kommerciel må ALDRIG tjene sig hjem på < ~4 sæsoner.
// Håndhæves som harness-gate i A2 (facilityInvestmentScorecard), dokumenteret her.
// Kalibreret resultat: payback ∞ i alle tier/staff/divisions-kombinationer —
// kommerciel er et rent, loftet sink (indtægten dækker aldrig driften).
export const COMMERCIAL_MIN_PAYBACK_SEASONS = 4;

// Hvilke spor har en LIVE gameplay-effekt (motor-hook findes). UI'et bruger det til
// ærlig "live vs. target"-mærkning, så vi aldrig lover en effekt der ikke virker.
// Plan B (#1441 pre-flip engine-slice): training = true — facilitets-magnitude
// (effectiveBonus) + chef-specialisering er wired ind i dailyTrainingEngine
// (loadTrainingStaffContext → dailyAbilityDelta). Øvrige spor aktiveres i takt
// med deres motorer (medical=form/skade, scouting=scouting-fane, commercial=Fase 4).
// #2530 (17/7): scouting = true. Motoren var allerede live (Talentspejder Fase 3
// #2244, scoutAssignmentService.js/scoutEngine.js) — den var blot ikke KØBBAR fra
// Klub-UI'et. Facilitetens FACILITY_BASE_EFFECT.scouting-tal er stadig ren display-
// kalibrering (ingen effectiveBonus-hook), men den REELLE gameplay-effekt er ægte:
// facilitets-tieret bounder hvilken hire-tier chefscout du kan ansætte
// (facilityEngine.validateHire), og chefens overall driver scoutEngine's kapacitet
// (1/2 opgaver) + præcisions-gulv direkte via scoutAssignmentService.loadScout().
// Kommerciel er BEVIDST et rent sink (ejer-valg Q2 5/7, payback ∞) — flip den ALDRIG
// live uden Fase-4-merchandise-motoren + ny harness-kørsel.
export const EFFECT_LIVE_BY_TRACK = Object.freeze({
  training: true, scouting: true, medical: false, academy: false, commercial: false,
});
