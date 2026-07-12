// #2187/#2377 — self-heal-sweep for udskudte AI-hold-trims.
//
// teamProfileEngine trimmer AI-fyld ved hvert nyt signup (reconcileAiTeamsForPool),
// men kan IKKE slette et AI-hold hvis dets ryttere sidder i et igangværende
// etapeløb (låst felt, block_rider_delete_with_inflight_entries, #2074). removeAiTeams
// (#2269) springer sådanne kandidater over i stedet for at kaste, og markerer dem nu
// med teams.pending_removal_at (#2187-migrationen 2026-07-12-ai-team-pending-removal.sql)
// — "dette AI-hold burde trimmes, men er udskudt". Uden en retry-mekanisme sad puljen
// fast på 25/26 hold i stedet for 24 (ejer-krav: PRÆCIS 24 hold/gruppe) indtil en helt
// NY manager tilfældigvis joinede SAMME pulje igen — prod-evidens: Division 4 B+C, 2
// fejlede/udskudte trims hver, aldrig selv-helet (#2187/#2377).
//
// Denne sweep kører periodisk (samme 5-min-kadence som de andre heal-sweeps i cron.js),
// finder alle markerede AI-hold og forsøger sletningen igen. Er det blokerende løb
// afviklet færdigt siden sidst, lykkes sletningen nu (teamHasInflightEntries tjekker
// live DB-tilstand hver gang — idempotent). Er holdet STADIG blokeret, efterlades
// markøren urørt (næste sweep prøver igen); har markøren stået >staleHours (default
// 48t — længere end noget realistisk etapeløb varer), rapporteres holdet som "stale"
// så cron-wrapperen kan Sentry-alarmere — det signalerer et strukturelt problem
// (fx en race-scheduler der er gået i stå), ikke bare "løbet er ikke færdigt endnu".
//
// Rører ALDRIG afviklede resultater eller ægte hold — kun AI-hold denne sweep selv
// (via removeAiTeams) tidligere har forsøgt at fjerne.

import { fetchAllRows } from "./supabasePagination.js";
import {
  getInflightRaceIds,
  teamHasInflightEntries,
  teamHasUnpaidPrizeResults,
  deleteAiTeamById,
} from "./aiTeamGenerator.js";

// Længere end noget realistisk etapeløb varer (Cycling Zone's længste løb er ugelange
// etapeløb) — en udskudt trim ældre end dette er ikke "vent på løbet", men et signal om
// at noget andet er gået galt (fx en race-scheduler der er stallet, #2077-klassen).
export const STALE_PENDING_HOURS = 48;

export async function runAiTeamTrimHealSweep({
  supabase,
  now = new Date(),
  staleHours = STALE_PENDING_HOURS,
  isBlocked = teamHasInflightEntries,
  // #2389 (Sentry CYCLINGZONE-26/2E/2F): uudbetalte præmier blokerer også trim.
  // Sletning FØR auto-prize-sweepen har krediteret løbet gav P0002 midt i payout-
  // ticket + FK-fejl i standings-recalc. Auto-prize sweeper hvert 5. minut, så
  // blokeringen løfter sig selv kort efter løbets finalization.
  hasUnpaidPrizes = teamHasUnpaidPrizeResults,
  removeTeam = deleteAiTeamById,
  getInflightIds = getInflightRaceIds,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // Kun AI-hold kan nogensinde have markøren sat (markPendingRemoval i
  // aiTeamGenerator.js sætter den udelukkende for is_ai=true-kandidater) — men
  // filteret gentages her eksplicit som forsvar i dybden: ægte hold må ALDRIG
  // rammes af denne sweep, uanset hvordan markøren skulle ende sat.
  const candidates = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, name, league_division_id, pending_removal_at")
      .eq("is_ai", true)
      .not("pending_removal_at", "is", null)
      .order("pending_removal_at"));

  if (!candidates.length) {
    return { candidates: 0, healed: 0, failed: 0, stale: [], errors: [] };
  }

  const inflightRaceIds = await getInflightIds(supabase);
  const staleMs = staleHours * 60 * 60 * 1000;

  let healed = 0;
  let failed = 0;
  const stale = [];
  const errors = [];

  for (const team of candidates) {
    try {
      const blocked = await isBlocked(supabase, team.id, inflightRaceIds)
        || await hasUnpaidPrizes(supabase, team.id);
      if (!blocked) {
        await removeTeam(supabase, team.id);
        healed += 1;
        continue;
      }
      const ageMs = now.getTime() - new Date(team.pending_removal_at).getTime();
      if (ageMs > staleMs) {
        stale.push({
          teamId: team.id,
          name: team.name,
          poolId: team.league_division_id,
          pendingSince: team.pending_removal_at,
          ageHours: Math.round(ageMs / (60 * 60 * 1000)),
        });
      }
    } catch (err) {
      failed += 1;
      errors.push({ teamId: team.id, message: err?.message || String(err) });
      // Per-hold isolation: én fejl må ikke stoppe resten af sweep'en.
      console.error(`[aiTeamTrimHealSweep] hold ${team.id} fejlede:`, err?.message || err);
    }
  }

  return { candidates: candidates.length, healed, failed, stale, errors };
}
