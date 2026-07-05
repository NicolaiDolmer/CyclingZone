// Slice A (#1441 Fase 3) — facilitets-/staff-konstanter.
// Kalibreret i bølge A2 (facilityInvestmentScorecard + inflationScorecard begge
// HEADLINE ✅) — se docs/audits/2026-07-05-facility-investment-calibration.md.
// FACILITIES_ENABLED flippes stadig kun med ejer-go. Eksporteres enkeltvis så
// economyCalibrationOverrides kan sweepe dem.
//
// Kalibrerings-design (vigtigt for fremtidige justeringer — ændr IKKE enkelt-tal
// isoleret, kør harness igen):
//   • Effekt-stigningen pr. tier er ∝ den løbende drift (upkeep + staff-løn) pr.
//     tier — det er dét der gør ≥3 investerings-rækkefølger konkurrencedygtige
//     (spec §2.3): værdien følger hvad man BINDER i drift, ikke hvad man købte.
//   • Køb er bevidst billige (bånd-undergrænserne i §2.4); driften er den reelle
//     omkostning. Det får kapløbet til at handle om drift-prioritering og holder
//     inflations-sinket inde i mål-kurven (capex-chok undgås).
//   • t2→t3 har fladt upkeep-hop og t5 et stort pris-hop — begge er bevidste og
//     bærende for gates (D3-adgang til tier 3 hhv. D1-aspirationsmål).

// Hård gate: køb/ansæt/payroll-debits er no-ops mens false. Tændes KUN efter
// A2-harness-grøn + ejer-go (kode-konstant (kræver deploy at flippe); om den skal være app_config-runtime-gated som academy afgøres i A2).
export const FACILITIES_ENABLED = false;

export const FACILITY_TRACKS = Object.freeze(["training", "scouting", "medical", "academy", "commercial"]);
export const MAX_FACILITY_TIER = 5;

// Engangs-pris pr. tier (kumulativ opgradering: man betaler ét trin ad gangen).
// Tid-som-valuta-anker (spec §2.4): kumulativ pris i sæsoners repræsentativ
// PRÆMIE-indkomst (D1 160k / D2 70k / D3 25k): T1/D3 = 0,28 · T3-kum/D2 = 0,51 ·
// T5-kum/D1 = 2,12 — alle tre bånd grønne (harness-bevis i audit-rapporten).
export const FACILITY_TIER_PRICE = Object.freeze({ 1: 7_000, 2: 10_500, 3: 18_000, 4: 19_000, 5: 285_000 });

// Løbende tier-upkeep pr. sæson — den PRIMÆRE omkostning ved faciliteter (køb er
// billigt, drift er dyr). t2/t3 deler upkeep-niveau (bevidst: giver D3-hold adgang
// til tier 3 under deres recurring-råderum uden at D1 kan holde alt på max).
export const FACILITY_TIER_UPKEEP = Object.freeze({ 0: 0, 1: 2_700, 2: 11_000, 3: 11_000, 4: 27_000, 5: 40_000 });

// Staff-sæsonløn pr. kvalitets-tier (løbende sink oveni upkeep). Lave niveauer er
// billige (staff skal være opnåelige i alle divisioner); tier 4-5 er specialister.
export const STAFF_SALARY_BY_TIER = Object.freeze({ 1: 1_500, 2: 2_000, 3: 3_000, 4: 8_000, 5: 12_000 });

// Fyring: betal resterende sæsonløn × faktor (spec §2.2, sink + friktion).
export const STAFF_SEVERANCE_FACTOR = 0.5;

// Effekt-model (spec §2.2: facilitet = kapacitet, staff = udnyttelsesgrad).
// effectiveBonus = FACILITY_BASE_EFFECT[track][facilityTier] × staffUtilization(staffTier)
// staffUtilization: 0.5 uden staff; 0.6..1.0 ved staff-tier 1..5.
// Effekt-tallene er per-track multiplikator-bonusser (0 = ingen effekt).
// KUN 'training' og 'commercial' har live effekt-hooks i A1-scope; scouting/medical/academy
// får deres hooks i egne opfølgnings-slices (spec §2.1) — deres base-effekt er defineret
// her så priser/harness kan kalibreres samlet.
// Kurve-formen (∝ drift pr. tier, med kalibrerede tilts) er gate-bærende — se audit.
export const FACILITY_BASE_EFFECT = Object.freeze({
  training:   Object.freeze({ 0: 0, 1: 0.017, 2: 0.0455, 3: 0.0465, 4: 0.076, 5: 0.12 }),
  scouting:   Object.freeze({ 0: 0, 1: 0.14, 2: 0.39, 3: 0.40, 4: 0.64, 5: 1.0 }),   // info-synlighedsgrad
  medical:    Object.freeze({ 0: 0, 1: 0.031, 2: 0.083, 3: 0.086, 4: 0.152, 5: 0.187 }), // form-genopretning
  academy:    Object.freeze({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }),                 // ekstra akademi-slots
  commercial: Object.freeze({ 0: 0, 1: 0.002, 2: 0.0025, 3: 0.0034, 4: 0.008, 5: 0.022 }), // sponsor-multiplikator-bonus
});

// Anti-runaway-invariant (spec §2.1): kommerciel må ALDRIG tjene sig hjem på < ~4 sæsoner.
// Håndhæves som harness-gate i A2 (facilityInvestmentScorecard), dokumenteret her.
// Kalibreret resultat: hurtigste payback 66,7 sæsoner (kommerciel er et loftet sink).
export const COMMERCIAL_MIN_PAYBACK_SEASONS = 4;
