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

// Staff-sæsonløn pr. kvalitets-tier (løbende sink oveni upkeep). Forankret i
// staff'ens marginale værdi-tilførsel (se kalibrerings-design ovenfor): ansættelse
// er en god men ikke gratis beslutning i alle divisioner.
export const STAFF_SALARY_BY_TIER = Object.freeze({ 1: 100, 2: 250, 3: 600, 4: 1_300, 5: 2_600 });

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
