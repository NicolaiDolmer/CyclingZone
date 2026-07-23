// backend/lib/squadRiskGuard.js
// #2748 · Kombineret squad-risiko: kontraktudløb (#2744) + pensionsrisiko (#1137)
// rammer S1→S2 SAMME DAG (27/7 09:00 UTC), for FØRSTE gang nogensinde. En manager
// kan i dag sælge/frigive/auktionere sig ned uden at systemet advarer om at
// yderligere ryttere er på vej ud AF SIG SELV ved næste sæsonskifte.
//
// Denne fil er de RENE klassificerings-funktioner (ingen DB) + tynde DB-fetch-
// helpers, i samme stil som riderEligibility.js/marketUtils.js. Bruges af:
//   - marketUtils.getSquadRiskViolation (den faktiske spærre-beregning)
//   - transferExecution.js (sælger-tjek ved direkte handel)
//   - routes/api.js (rytter-frigivelse + auktions-oprettelse af egen rytter)
//   - seasonTransitionNotice.js (#2700 varsel — samme klassifikation, delt per rytter)
//
// Ejer-beslutning 23/7 (#2748, valg A): KONSERVATIV worst-case — en rytter tælles
// som "risiko" så snart han er i pensions-VINDUET (alder ≥ windowStartAge, pt. 36),
// ikke kun ved garanteret pension (≥ guaranteedAge, pt. 40). Spærren skal beskytte
// mod det absolut værste tilfælde (alle 36+ pensionerer samtidig), ikke forvente
// middelværdien — jf. ejerens egen metode i #2748-kommentartråden 23/7.
//
// age beregnes ved NÆSTE sæson (activeSeasonNumber + 1), fordi det er den alder
// retirementDecision() FAKTISK bruger ved den kommende transition: processSeasonStart
// kalder developRidersForSeason({..., seasonNumber}) med seasonNumber = DEN NYE sæson
// (economyEngine.js: `seasonNumber = season?.number` for `seasonId` = to_season.id),
// og developRidersForSeason kalder ageForSeason(birthdate, seasonNumber) — altså
// alderen VED overgangen til den nye sæson, ikke alderen i den nuværende.
//
// ageForSeason/LAUNCH_REFERENCE_YEAR duplikeres bevidst her (samme mønster som
// scripts/salaryDecouplingScorecard.js, scripts/fitRiderValuationV4.js m.fl. —
// se kommentar dér) i stedet for at importere riderProgressionEngine.js, som ville
// lukke en modul-cyklus tilbage til marketUtils.js (academyGraduation.js importerer
// begge veje). SSOT for selve formlen er riderProgressionEngine.ageForSeason.

import { PROGRESSION_CONFIG } from "./riderProgression.js";

const LAUNCH_REFERENCE_YEAR = 2026;

export function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear;
}

// Rytteren frigives til fri agent ved NÆSTE transition (#2744-B): kontrakten er
// allerede udløbet eller udløber netop NU (contract_end_season <= den aktive/
// afsluttende sæson). `<=` (ikke `=`) — samme selv-helende idempotens-valg som
// contractExpiryRelease.js.
export function isContractExpiringAtTransition(rider, activeSeasonNumber) {
  // rider.contract_end_season == null (fri agent / akademi, ingen kontrakt) må
  // ALDRIG tælle som "udløbende" — Number(null) === 0 ville ellers gøre det (0 <=
  // enhver positiv sæson), så null/undefined tjekkes eksplicit FØR Number()-cast.
  if (rider?.contract_end_season == null) return false;
  const end = Number(rider.contract_end_season);
  return Number.isFinite(end) && Number.isFinite(activeSeasonNumber) && end <= activeSeasonNumber;
}

// Rytteren er i pensions-VINDUET (worst-case: tælles som "væk", uanset om han
// rent faktisk ruller under sandsynligheden) VED NÆSTE sæson.
export function isRetirementRiskAtTransition(rider, activeSeasonNumber, cfg = PROGRESSION_CONFIG) {
  if (!Number.isFinite(activeSeasonNumber)) return false;
  const nextAge = ageForSeason(rider?.birthdate, activeSeasonNumber + 1);
  return nextAge != null && nextAge >= cfg.retirement.windowStartAge;
}

// Er rytteren "garanteret væk" (alder ≥ guaranteedAge ved næste sæson), til brug
// for varsel-copy der skal skelne "kan pensionere sig" fra "pensionerer sig helt
// sikkert" — retirementDecision() selv gør præcis denne skelnen.
export function isGuaranteedRetirementAtTransition(rider, activeSeasonNumber, cfg = PROGRESSION_CONFIG) {
  if (!Number.isFinite(activeSeasonNumber)) return false;
  const nextAge = ageForSeason(rider?.birthdate, activeSeasonNumber + 1);
  return nextAge != null && nextAge >= cfg.retirement.guaranteedAge;
}

// Samlet klassifikation: forlader rytteren holdet AF SIG SELV ved næste transition
// (kontraktudløb ELLER pensionsrisiko)? Bruges af squad-spærren (worst-case union).
export function isRiderAtRisk(rider, activeSeasonNumber, cfg = PROGRESSION_CONFIG) {
  return (
    isContractExpiringAtTransition(rider, activeSeasonNumber) ||
    isRetirementRiskAtTransition(rider, activeSeasonNumber, cfg)
  );
}

// Antal ryttere i `riders` der er i risiko (union, ikke sum — en rytter der
// rammer begge mekanikker tælles kun én gang, han kan jo kun forlade holdet én
// gang). Pure — ingen DB.
export function countAtRiskRiders(riders, activeSeasonNumber, cfg = PROGRESSION_CONFIG) {
  return (riders || []).reduce(
    (n, r) => n + (isRiderAtRisk(r, activeSeasonNumber, cfg) ? 1 : 0),
    0
  );
}

// DB-fetch: holdets ejede, løbs-relevante ryttere (samme diskriminator som
// getSquadSnapshot i squadEnforcement.js — #1308 akademi tæller ikke mod cap).
// is_retired ekskluderes IKKE eksplicit her, fordi der pt. (23/7) er 0 pensionerede
// ryttere i prod (mekanikken har aldrig kørt) — men feltet hentes med, så en
// fremtidig caller kan filtrere hvis det bliver relevant.
export async function fetchTeamRiskRows(supabase, teamId) {
  const { data, error } = await supabase
    .from("riders")
    .select("id, birthdate, contract_end_season, is_retired")
    .eq("team_id", teamId)
    .eq("is_academy", false);
  if (error) throw new Error(`fetchTeamRiskRows(${teamId}): ${error.message}`);
  return (data || []).filter((r) => r.is_retired !== true);
}

// Kombineret fetch + tælling for ÉT hold, ekskluderer eksplicit angivne rytter-id'er
// (typisk rytteren DENNE handel allerede flytter — han må ikke tælles som "risiko"
// OVENI at være "outgoing" for samme transaktion, se marketUtils.getSquadRiskViolation).
export async function fetchAtRiskCount(supabase, teamId, activeSeasonNumber, { excludeRiderIds = [] } = {}) {
  const rows = await fetchTeamRiskRows(supabase, teamId);
  const excluded = new Set(excludeRiderIds || []);
  const filtered = excluded.size ? rows.filter((r) => !excluded.has(r.id)) : rows;
  return countAtRiskRiders(filtered, activeSeasonNumber);
}
