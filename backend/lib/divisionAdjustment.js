// backend/lib/divisionAdjustment.js
//
// Divisions-tillægget (#4376). Regel + begrundelser: docs/SPONSOR_RULES.md §3.
//
// PROBLEMET (målt mod prod 29/8): en sponsoraftale prissættes mod den division holdet var
// i DA det valgte — `loadRenownTargetValue` læser `teams.division` på valg-tidspunktet, og
// manageren vælger midt i sæsonen, altså før op-/nedrykningen er skrevet. Basen rebases
// aldrig. 36 af 230 hold lå under deres divisions gulv; 21 af 24 D1-hold kørte på en lavere
// divisions base mens de betalte D1-upkeep fra dag ét.
//
// LØSNINGEN (ejer-besluttet 29/8, justeret 4/9): aftalen røres ikke. `guaranteed_base` og
// `per_race_day_rate` står som underskrevet hele løbetiden — det var netop det spillerne
// sagde de forventede ("det man skriver under på er det man får"). I stedet lægges en
// separat, synlig korrektion oveni.
//
// OPADGÅENDE REGEL — "GULV + 50 %" (ejer-beslutning 4/9 kl. ~15:45, erstatter den oprindelige
// 0,5 × (base[nu] − base[prissat])): et hold der kører i en HØJERE division end aftalen er
// prissat til, løftes FØRST til grundbeløbet for divisionen lige under den nuværende — det
// er gulvet, ingen skal tjene mindre end en frisk aftale i den division ville give — og får
// DEREFTER 50 % af resten op til egen divisions fulde base. For et ét-trins oprykning
// (D-1 = den prissatte division) er gulvet 0, og reglen er uændret 50 % af hele forskellen.
//
//   korrektion = max(0, base[D−1] − base[prissat]) + 0,5 × (base[D] − base[D−1])
//
// hvor D = nuværende division og D−1 = divisionen lige under (D2 for D1, D3 for D2, D4 for
// D3). D4 har ingen D−1 — men det er uden betydning, for D4 er selv den laveste division og
// kan derfor aldrig være modtager af en opadgående korrektion (intet er "under" D4 i basen).
// Eksempel D1 m. D4-aftale: gulv til D2 = 400.000 − 315.000 = 85.000, plus 0,5 × (600.000 −
// 400.000) = 100.000 → 185.000 oveni basen 315.000 = 500.000 (samme total som et hold der
// selv sidder på en D2-aftale i D1).
//
// NEDADGÅENDE REGEL (uændret formel, egen tænd/sluk-flag): et hold prissat i en HØJERE
// division end det nu kører i trækkes 0,5 × (base[prissat] − base[nu]) — samme formel som
// før 4/9, og stadig SYMMETRISK med nedrykningsfaldskærmen (se nedenfor). I sæson 3 er
// nedad slået fra af grandfathering (ejer-valg 5, 29/8). Fra sæson 4 kan ejeren tænde det
// ved sæsonskiftet ved at sætte DOWNWARD_ADJUSTMENT_ENABLED til true — default er FALSE,
// fordi ejeren vil slå det til bevidst, ikke automatisk (#4376, korrektion 4/9).
//
// SYMMETRIEN MED FALDSKÆRMEN ER IKKE TILFÆLDIG — DEN ER HELE DESIGNET FOR NEDAD-REGLEN:
// PARACHUTE_FACTOR (#1980, ejer-låst 5/7) udbetaler 0,5 × (base[gammel] − base[ny]) ved
// nedrykning. Nedad-tillæggets fradrag er nøjagtig samme beløb med modsat fortegn. For et
// nedrykket hold med LØBENDE aftale ophæver de to hinanden eksakt, så holdet beholder sin
// høje base uden også at få faldskærm. Enhver anden faktor end 0,5 for nedad-reglen bryder
// det — derfor er ligheden håndhævet af en test, ikke kun af en kommentar.

import {
  SPONSOR_INCOME_BY_DIVISION,
  PARACHUTE_FACTOR,
  MAX_BOARD_MODIFIER,
} from "./economyConstants.js";

// Ejer-valg 2 af 29/8, videreført 4/9. Bruges af BÅDE 50%-trinnet i opad-reglen og af hele
// nedad-formlen. MÅ IKKE afkobles fra PARACHUTE_FACTOR uden et nyt ejer-valg —
// divisionAdjustment.test.js fejler hvis de to divergerer.
export const DIVISION_ADJUSTMENT_FACTOR = PARACHUTE_FACTOR;

// Ejer-valg 5 af 29/8: S3 var allerede i gang da reglen blev truffet, så kun den
// opadgående halvdel anvendes dér. Ingen mister penge midt i en sæson
// (grandfathering-princippet fra #1234). Fra sæson 4 kan nedad slås til (se flaget nedenfor).
export const FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT = 4;

// Ejer-beslutning 4/9: nedad-korrektionen findes i koden fra sæson 4, men er IKKE
// automatisk. Ejeren tænder den bevidst ved sæsonskiftet ved at sætte denne til `true`.
// Uden dette flag: nedad er altid 0, uanset sæsonnummer.
export const DOWNWARD_ADJUSTMENT_ENABLED = false;

function divisionBase(division) {
  if (!Number.isInteger(division)) return null;
  const base = SPONSOR_INCOME_BY_DIVISION[division];
  return Number.isFinite(base) ? base : null;
}

// Divisionen "lige under" `division` (ét trin dårligere — højere divisionsnummer). D4 har
// ingen: den er selv bunden.
function divisionBelow(division) {
  const below = division + 1;
  return divisionBase(below) !== null ? below : null;
}

/**
 * Det rå tillæg for ét hold, FØR bestyrelsens modifier.
 *
 * `signedDivision` er `sponsor_contracts.signed_division` — den division aftalen blev
 * prissat mod. Den LAGRES ved signering og rekonstrueres aldrig: 23 af 230 hold (målt
 * 29/8) har ingen `season_standings`-række i sæsonen før `start_season`, fordi de blev
 * oprettet midt i en sæson. Mangler den, er svaret 0 — aldrig et gæt.
 *
 * @returns {number} positivt ved oprykning ("gulv + 50 %"), negativt ved nedrykning (kun
 *   når DOWNWARD_ADJUSTMENT_ENABLED er slået til, fra sæson 4), 0 ellers.
 */
export function computeDivisionAdjustment({
  currentDivision = null,
  signedDivision = null,
  seasonNumber = null,
} = {}) {
  const current = divisionBase(currentDivision);
  const signed = divisionBase(signedDivision);
  if (current === null || signed === null) return 0;
  if (current === signed) return 0;

  // Opad: aftalen er prissat i en RINGERE (billigere) division end holdet nu kører i.
  if (signed < current) {
    const belowDiv = divisionBelow(currentDivision);
    // D4 kan aldrig ramme denne gren (intet er billigere end D4's base), men guardes
    // alligevel eksplicit — jf. kommentaren øverst i filen.
    if (belowDiv === null) return 0;
    const baseBelow = divisionBase(belowDiv);
    const floor = Math.max(0, baseBelow - signed);
    const halfStep = DIVISION_ADJUSTMENT_FACTOR * (current - baseBelow);
    return Math.round(floor + halfStep);
  }

  // Nedad: aftalen er prissat i en BEDRE (dyrere) division end holdet nu kører i.
  // Slået fra medmindre ejeren eksplicit har tændt flaget OG vi er i sæson 4+.
  if (!DOWNWARD_ADJUSTMENT_ENABLED) return 0;
  const season = Number(seasonNumber);
  if (!Number.isFinite(season) || season < FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT) return 0;

  return Math.round(DIVISION_ADJUSTMENT_FACTOR * (current - signed));
}

/**
 * Tillægget som det faktisk udbetales: ganget med bestyrelsens modifier (ejer-valg 4 —
 * samme behandling som den garanterede base), med samme forward-guard mod
 * modifier-bypass som sponsor-loftet bruger.
 *
 * Loftet er en no-op så længe `satisfactionToModifier` topper på 1,20; det findes for at
 * en fremtidig modifier-kilde ikke tavst kan skalere tillægget forbi den grænse. Det
 * cappes på ABSOLUTVÆRDIEN, så guarden virker ens i begge retninger.
 */
export function applyModifierToAdjustment(rawAdjustment, modifier) {
  const raw = Number(rawAdjustment);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  const factor = Number.isFinite(Number(modifier)) ? Number(modifier) : 1;

  const scaled = Math.round(raw * factor);
  const ceiling = Math.round(Math.abs(raw) * MAX_BOARD_MODIFIER);
  const capped = Math.min(Math.abs(scaled), ceiling);
  return raw < 0 ? -capped : capped;
}

/**
 * Alt et kaldested behøver for ét hold. Ren funktion — kalderen henter data.
 *
 * @returns {{ raw: number, payout: number, currentDivision: number|null,
 *             signedDivision: number|null, applies: boolean }}
 */
export function resolveDivisionAdjustment({
  team = null,
  contract = null,
  seasonNumber = null,
  modifier = 1,
} = {}) {
  const currentDivision = Number.isInteger(team?.division) ? team.division : null;
  const signedDivision = Number.isInteger(contract?.signed_division)
    ? contract.signed_division
    : null;

  const raw = computeDivisionAdjustment({ currentDivision, signedDivision, seasonNumber });
  const payout = applyModifierToAdjustment(raw, modifier);

  return { raw, payout, currentDivision, signedDivision, applies: payout !== 0 };
}

/** Idempotency-nøgle: ét tillæg pr. hold pr. sæson, uanset hvilken sti der krediterer det. */
export function divisionAdjustmentIdempotencyKey(teamId, seasonId) {
  return `division_adjustment:${teamId}:${seasonId}`;
}
