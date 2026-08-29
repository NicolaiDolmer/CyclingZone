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
// LØSNINGEN (ejer-besluttet 29/8, fem valg): aftalen røres ikke. `guaranteed_base` og
// `per_race_day_rate` står som underskrevet hele løbetiden — det var netop det spillerne
// sagde de forventede ("det man skriver under på er det man får"). I stedet lægges en
// separat, synlig korrektion oveni.
//
// SYMMETRIEN ER IKKE TILFÆLDIG — DEN ER HELE DESIGNET:
// PARACHUTE_FACTOR (#1980, ejer-låst 5/7) udbetaler 0,5 × (base[gammel] − base[ny]) ved
// nedrykning. Tillæggets fradrag er nøjagtig samme beløb med modsat fortegn. For et
// nedrykket hold med LØBENDE aftale ophæver de to hinanden eksakt, så holdet beholder sin
// høje base uden også at få faldskærm. For et hold hvis aftale er UDLØBET og fornyet i den
// nye division er der ingen forskel, så tillægget er 0 og faldskærmen står uændret.
// Ingen undtagelse i koden, ingen særtilfælde. Enhver anden faktor end 0,5 bryder det —
// derfor er ligheden håndhævet af en test, ikke kun af en kommentar.

import {
  SPONSOR_INCOME_BY_DIVISION,
  PARACHUTE_FACTOR,
  MAX_BOARD_MODIFIER,
} from "./economyConstants.js";

// Ejer-valg 2 af 29/8. MÅ IKKE afkobles fra PARACHUTE_FACTOR uden et nyt ejer-valg —
// divisionAdjustment.test.js fejler hvis de to divergerer.
export const DIVISION_ADJUSTMENT_FACTOR = PARACHUTE_FACTOR;

// Ejer-valg 5 af 29/8: S3 var allerede i gang da reglen blev truffet, så kun den
// opadgående halvdel anvendes dér. Ingen mister penge midt i en sæson
// (grandfathering-princippet fra #1234). Fra sæson 4 gælder reglen begge veje.
export const FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT = 4;

function divisionBase(division) {
  if (!Number.isInteger(division)) return null;
  const base = SPONSOR_INCOME_BY_DIVISION[division];
  return Number.isFinite(base) ? base : null;
}

/**
 * Det rå tillæg for ét hold, FØR bestyrelsens modifier.
 *
 * `signedDivision` er `sponsor_contracts.signed_division` — den division aftalen blev
 * prissat mod. Den LAGRES ved signering og rekonstrueres aldrig: 23 af 230 hold (målt
 * 29/8) har ingen `season_standings`-række i sæsonen før `start_season`, fordi de blev
 * oprettet midt i en sæson. Mangler den, er svaret 0 — aldrig et gæt.
 *
 * @returns {number} positivt ved oprykning, negativt ved nedrykning (fra sæson 4), 0 ellers.
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

  const raw = Math.round(DIVISION_ADJUSTMENT_FACTOR * (current - signed));

  // Nedadgående korrektion er slået fra indtil sæson 4 (ejer-valg 5).
  if (raw < 0) {
    const season = Number(seasonNumber);
    if (!Number.isFinite(season) || season < FIRST_SEASON_WITH_DOWNWARD_ADJUSTMENT) return 0;
  }

  return raw;
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
