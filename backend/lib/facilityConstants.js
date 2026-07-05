// Slice A (#1441 Fase 3) — facilitets-/staff-konstanter.
// ALLE tal er START-KANDIDATER (spec §2.4 tid-som-valuta): kalibreres i bølge A2
// (facilityInvestmentScorecard) FØR FACILITIES_ENABLED sættes true. Eksporteres
// enkeltvis så economyCalibrationOverrides kan sweepe dem.

// Hård gate: køb/ansæt/payroll-debits er no-ops mens false. Tændes KUN efter
// A2-harness-grøn + ejer-go (kode-konstant (kræver deploy at flippe); om den skal være app_config-runtime-gated som academy afgøres i A2).
export const FACILITIES_ENABLED = false;

export const FACILITY_TRACKS = Object.freeze(["training", "scouting", "medical", "academy", "commercial"]);
export const MAX_FACILITY_TIER = 5;

// Engangs-pris pr. tier (kumulativ opgradering: man betaler ét trin ad gangen).
// Tid-som-valuta-anker (spec §2.4): prissat mod repræsentativ PRÆMIE-indkomst
// (ambitions-laget: D1 ~160k / D2 ~70k / D3 ~25k pr. sæson, jf. economyConstants
// A6-kalibreringsnoten) — IKKE mod fresh-net-overskuddet (som er ~break-even by design).
export const FACILITY_TIER_PRICE = Object.freeze({ 1: 25_000, 2: 60_000, 3: 140_000, 4: 300_000, 5: 600_000 });

// Løbende tier-upkeep pr. sæson (lille, løbende sink oveni engangs-prisen).
export const FACILITY_TIER_UPKEEP = Object.freeze({ 0: 0, 1: 2_000, 2: 5_000, 3: 10_000, 4: 20_000, 5: 35_000 });

// Staff-sæsonløn pr. kvalitets-tier (løbende sink).
export const STAFF_SALARY_BY_TIER = Object.freeze({ 1: 10_000, 2: 22_000, 3: 40_000, 4: 70_000, 5: 120_000 });

// Fyring: betal resterende sæsonløn × faktor (spec §2.2, sink + friktion).
export const STAFF_SEVERANCE_FACTOR = 0.5;

// Effekt-model (spec §2.2: facilitet = kapacitet, staff = udnyttelsesgrad).
// effectiveBonus = FACILITY_BASE_EFFECT[track][facilityTier] × staffUtilization(staffTier)
// staffUtilization: 0.5 uden staff; 0.6..1.0 ved staff-tier 1..5.
// Effekt-tallene er per-track multiplikator-bonusser (0 = ingen effekt).
// KUN 'training' og 'commercial' har live effekt-hooks i A1-scope; scouting/medical/academy
// får deres hooks i egne opfølgnings-slices (spec §2.1) — deres base-effekt er defineret
// her så priser/harness kan kalibreres samlet.
export const FACILITY_BASE_EFFECT = Object.freeze({
  training:   Object.freeze({ 0: 0, 1: 0.02, 2: 0.04, 3: 0.06, 4: 0.08, 5: 0.10 }),
  scouting:   Object.freeze({ 0: 0, 1: 0.20, 2: 0.40, 3: 0.60, 4: 0.80, 5: 1.00 }), // info-synlighedsgrad
  medical:    Object.freeze({ 0: 0, 1: 0.03, 2: 0.06, 3: 0.09, 4: 0.12, 5: 0.15 }), // form-genopretning
  academy:    Object.freeze({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }),                // ekstra akademi-slots
  commercial: Object.freeze({ 0: 0, 1: 0.01, 2: 0.02, 3: 0.03, 4: 0.04, 5: 0.05 }), // sponsor-multiplikator-bonus
});

// Anti-runaway-invariant (spec §2.1): kommerciel må ALDRIG tjene sig hjem på < ~4 sæsoner.
// Håndhæves som harness-gate i A2 (facilityInvestmentScorecard), dokumenteret her.
export const COMMERCIAL_MIN_PAYBACK_SEASONS = 4;
