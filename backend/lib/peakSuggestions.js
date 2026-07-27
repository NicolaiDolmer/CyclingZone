// Race Engine v3 (#2224), slice S5-follow — Season Planner assistant-forslag (#2455).
// Ejer-ønske 13/7: "alle managers har fået et forslag af assistenten ... udfyldt
// fra start af, sådan at managers selv kan vælge at starte forfra, eller kunne
// lave enkelte ændringer."
//
// REN lib (ingen DB/Date/Math.random) — samme disciplin som riderPeakPlans.js/
// plannerBoard.js. Forslagene ER ALDRIG persisterede rider_peak_plans-rækker;
// de beregnes on-demand i routes/api.js (GET /peak-plans/board) for enhver
// rytter der endnu ikke har en ægte peak-plan, og forsvinder automatisk den
// dag manageren opretter en ægte plan (accept/justering går gennem den
// eksisterende POST/PATCH /peak-plans — se riderPeakPlans.js). Det gør
// "gælder også ryttere/managers der kommer til midt i sæsonen" gratis: der er
// intet at migrere/backfille, kun en ren funktion der køres ved hvert board-kald.
//
// Heuristik (deterministisk + forklarlig, issue #2455 krav — INGEN ML):
//  1. Kandidat-løb = holdets egen divisions FREMTIDIGE løb i den aktive sæson.
//  2. Foretræk løb rytteren allerede er MANUELT tilmeldt (race_entries med
//     is_auto_filled=false — den ægte "løbsprogram"-signal issue'et beder om;
//     auto-fyldte entries opstår kun tæt på løbsdag og er IKKE et program-valg).
//  3. Fyld resterende slots med bedst egnede løb: normaliseret type/evne-match
//     mod løbets demand-vektor (samme formel som frontend riderSuitability,
//     genbruger backend raceSimulator.terrainScore — ét sted for tallet).
//  4. Minimums-mellemrum mellem valgte peak-vindue-centre, så assistenten ikke
//     stabler build→taper for to mål-løb oveni hinanden.
//  5. Alder modulerer ANTAL forslag (ikke hvilke løb): unge/udviklings-ryttere
//     får ét klart sæsonmål frem for et fuldt to-peak-program.

import { ABILITY_KEYS, terrainScore } from "./raceSimulator.js";
import { snapPeakWindow, MAX_PEAK_PLANS_PER_SEASON } from "./riderPeakPlans.js";

export const YOUNG_AGE_THRESHOLD = 23;
export const YOUNG_RIDER_PEAK_COUNT = 1;
export const ADULT_RIDER_PEAK_COUNT = Math.min(2, MAX_PEAK_PLANS_PER_SEASON);

/**
 * Mindste antal dage mellem to foreslåede peak-vindue-CENTRE, så assistenten
 * ikke stabler build→taper for to mål-løb oveni hinanden (periodiserings-
 * hygiejne, addendum §2). leadupDays før + windowRadiusDays i begge ender.
 * @param {number} leadupDays
 * @param {number} windowRadiusDays
 * @returns {number}
 */
export function minPeakSpacingDays(leadupDays, windowRadiusDays) {
  return Math.max(0, Number(leadupDays) || 0) + 2 * (Math.max(0, Number(windowRadiusDays) || 0));
}

// Sæson-forankret alder, IKKE wall-clock (#3081). LAUNCH_REFERENCE_YEAR/
// ageForSeason duplikeres BEVIDST her — samme dokumenterede mønster som
// lib/squadRiskGuard.js — i stedet for at importere riderProgressionEngine.
// ageForSeason (SSOT for selve formlen): riderProgressionEngine.js importerer
// supabasePagination.fetchAllRows + notificationService (DB/side-effects) og,
// via riderValuation.js, node:fs readFileSync af valuerings-modellen. En import
// herfra ville bryde DENNE fils dokumenterede renheds-kontrakt (se topkommentaren:
// "REN lib, ingen DB/Date/Math.random") og trække DB-afhængigheder ind i en
// beregning der køres on-demand pr. rytter i GET /peak-plans/board.
//
// #3081: assistenten regnede tidligere alder på wall-clock (den nu fjernede
// ageFromBirthdate(birthdate, todayDateString) = todayYear − birthYear). Det
// stemte kun overens med sæson-alderen i sæson 1 (launch-året); fra sæson 2
// driftede det, fordi sæson-cutover ikke sker på nytår — wall-clock-året lå
// stadig i 2026 langt ind i sæson 2, mens sæson-alderen allerede skulle regnes
// fra 2027. Se forward-guard-testen nederst i peakSuggestions.test.js.
const LAUNCH_REFERENCE_YEAR = 2026;

/**
 * Alder VED sæsonens referenceår — samme SSOT-formel som
 * riderProgressionEngine.ageForSeason: LAUNCH_REFERENCE_YEAR + (seasonNumber − 1) − fødselsår.
 * @param {string|null} birthdate  "YYYY-MM-DD"
 * @param {number|null} seasonNumber
 * @returns {number|null}
 */
export function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear;
}

/**
 * Hvor mange peaks assistenten foreslår for én rytter. Ukendt alder (ingen
 * fødselsdato på filen) → behandles som voksen (fail-open til det fulde
 * program, ikke et halvt forslag ingen kan forklare).
 * @param {number|null} age
 * @param {{youngThreshold?:number, youngCount?:number, adultCount?:number}} [opts]
 * @returns {number}
 */
export function suggestedPeakCount(age, {
  youngThreshold = YOUNG_AGE_THRESHOLD,
  youngCount = YOUNG_RIDER_PEAK_COUNT,
  adultCount = ADULT_RIDER_PEAK_COUNT,
} = {}) {
  if (age == null) return adultCount;
  return age < youngThreshold ? youngCount : adultCount;
}

/**
 * Normaliseret 0-100 egnethed for én rytter mod ét løbs demand-vektor — spejl
 * af frontend/src/lib/suitability.js's riderSuitability, men genbruger
 * backend raceSimulator.terrainScore for selve rå-summen (ét sted for
 * evne×demand-formlen; kun normaliseringen til et aflæseligt 0-100-tal
 * duplikeres, samme som frontend af nødvendighed må gøre over ledningen).
 * @param {Record<string,number>} abilities
 * @param {Record<string,number>|null} demandVector
 * @returns {number}
 */
export function normalizedSuitability(abilities, demandVector) {
  if (!demandVector || typeof demandVector !== "object") return 0;
  let denom = 0;
  for (const k of ABILITY_KEYS) {
    const w = Number(demandVector[k]);
    if (Number.isFinite(w) && w > 0) denom += w;
  }
  if (denom <= 0) return 0;
  return Math.round((terrainScore(abilities, demandVector) / denom) * 100);
}

/**
 * Vælg op til `maxPeaks` mål-løb for én rytter. Deterministisk rangering:
 * manuelt tilmeldte løb (ægte løbsprogram-signal) slår ren type-match;
 * herefter højest egnethed; stabil tie-break på tidligst dato → race-id.
 * Minimums-mellemrum håndhæves grådigt i rangeret rækkefølge (samme mønster
 * som raceEntryGenerator's kronologiske tildeling — ingen combinatorisk søgning).
 *
 * @param {object} args
 * @param {Array<{id:string, ord:number, demandVector:object|null}>} args.candidateRaces  fremtidige egen-divisions-løb (vilkårlig rækkefølge accepteret; kalderen udelukker løb der allerede er ÆGTE mål)
 * @param {Record<string,number>} [args.abilities]
 * @param {Set<string>} [args.registeredRaceIds]  race-id'er rytteren allerede er manuelt tilmeldt
 * @param {number} args.maxPeaks  resterende ANTAL forslag (allerede fratrukket ægte planer af kalderen)
 * @param {number} args.minSpacingDays
 * @param {number[]} [args.reservedOrds]  ordinaler for ÆGTE peak-vinduers centre (spacing-hensyn, men aldrig selv output)
 * @returns {Array<{raceId:string, ord:number, suitability:number, reason:"registered"|"suitability"}>}  kronologisk sorteret
 */
export function pickTargetRaces({ candidateRaces = [], abilities = {}, registeredRaceIds = new Set(), maxPeaks, minSpacingDays, reservedOrds = [] }) {
  if (!(maxPeaks > 0) || !candidateRaces.length) return [];

  const scored = candidateRaces
    .map((r) => ({
      raceId: r.id,
      ord: r.ord,
      suitability: normalizedSuitability(abilities, r.demandVector),
      registered: registeredRaceIds.has(r.id),
    }))
    .sort((a, b) =>
      (Number(b.registered) - Number(a.registered)) ||
      (b.suitability - a.suitability) ||
      (a.ord - b.ord) ||
      String(a.raceId).localeCompare(String(b.raceId))
    );

  const chosenOrds = [...reservedOrds];
  const chosen = [];
  for (const cand of scored) {
    if (chosen.length >= maxPeaks) break;
    if (chosenOrds.some((o) => Math.abs(o - cand.ord) < minSpacingDays)) continue;
    chosen.push({ raceId: cand.raceId, ord: cand.ord, suitability: cand.suitability, reason: cand.registered ? "registered" : "suitability" });
    chosenOrds.push(cand.ord);
  }
  return chosen.sort((a, b) => a.ord - b.ord);
}

/**
 * Byg de fulde forslag (inkl. vindue-snap) for én rytter — ren orkestrering af
 * ovenstående + snapPeakWindow (samme vindue-radius som ægte planer, addendum
 * §2). `stageDatesByRaceId` undgår endnu et DB-kald pr. kandidat-løb i routen
 * (kalderen slår op i den allerede hentede sæson-schedule).
 *
 * @param {object} args
 * @param {{birthdate?:string|null}} args.rider
 * @param {Record<string,number>} [args.abilities]
 * @param {Array<{id:string, ord:number, demandVector:object|null}>} args.candidateRaces  MÅ IKKE indeholde løb rytteren allerede har en ÆGTE plan mod (kalder-ansvar, samme duplicate_target-regel som POST /peak-plans)
 * @param {Map<string,string[]>} args.stageDatesByRaceId  race-id → etape-datoer ("YYYY-MM-DD")
 * @param {Set<string>} [args.registeredRaceIds]
 * @param {number} [args.existingPeakCount]  ANTAL ægte peak-planer rytteren allerede har (fylder kun resterende slots op til assistentens alders-loft)
 * @param {number[]} [args.reservedOrds]  ordinaler for ægte peak-vinduers centre (spacing mod suggestions)
 * @param {number} args.seasonNumber  sæsonens nummer — SSOT-alderen (#3081) regnes VED denne sæsons referenceår, ikke wall-clock
 * @param {number} args.leadupDays
 * @param {number} args.windowRadiusDays
 * @returns {Array<{targetRaceId:string, windowStart:string, windowEnd:string, reason:"registered"|"suitability"}>}
 */
export function suggestPeaksForRider({
  rider, abilities, candidateRaces, stageDatesByRaceId, registeredRaceIds = new Set(),
  existingPeakCount = 0, reservedOrds = [],
  seasonNumber, leadupDays, windowRadiusDays,
}) {
  const age = ageForSeason(rider?.birthdate, seasonNumber);
  const maxPeaks = Math.max(0, suggestedPeakCount(age) - existingPeakCount);
  const minSpacing = minPeakSpacingDays(leadupDays, windowRadiusDays);
  const picks = pickTargetRaces({ candidateRaces, abilities, registeredRaceIds, maxPeaks, minSpacingDays: minSpacing, reservedOrds });

  const out = [];
  for (const pick of picks) {
    const window = snapPeakWindow(stageDatesByRaceId?.get(pick.raceId) || [], { radiusDays: windowRadiusDays });
    if (!window) continue; // uplanlagt/uden schedule-rækker endnu — spring stille over.
    out.push({ targetRaceId: pick.raceId, windowStart: window.window_start, windowEnd: window.window_end, reason: pick.reason });
  }
  return out;
}
