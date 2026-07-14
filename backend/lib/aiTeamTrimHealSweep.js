// #2187/#2377/#2434 — self-heal-sweep for udskudte AI-hold-trims.
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
// afviklet færdigt siden sidst, lykkes sletningen nu (teamInflightRaceIds tjekker
// live DB-tilstand hver gang — idempotent). Er holdet STADIG blokeret, efterlades
// markøren urørt (næste sweep prøver igen).
//
// STALE-DETEKTION (#2434 — løbs-bevidst, erstatter den rene 48t-alders-tærskel):
// et udskudt hold rapporteres kun som "stale" (→ Sentry-alarm) når blokeringen er
// REELT fastlåst, dvs. enten:
//   (a) et af de blokerende løb er SELV stallet (getStalledInflightRaceIds — samme
//       "en etape hænger"-definition som stall-watchdogen), ELLER
//   (b) blokeringen overskrider STALE_BACKSTOP_HOURS (defense-in-depth mod ukendte
//       fejlklasser: fejl-materialiseret schedule, en præmie-blokering auto-prize
//       aldrig løfter).
// Den gamle logik alarmerede rent på alder >48t. Det gav falsk-positiver (Sentry
// CYCLINGZONE-31: 200+ events) fordi et multi-dag etapeløb LOVLIGT holder ryttere
// inflight længere end 48t — holdet krydsede tærsklen mens løbet stadig kørte fint.
//
// Rører ALDRIG afviklede resultater eller ægte hold — kun AI-hold denne sweep selv
// (via removeAiTeams) tidligere har forsøgt at fjerne.

import { fetchAllRows } from "./supabasePagination.js";
import {
  teamInflightRaceIds,
  teamHasUnpaidPrizeResults,
  getInflightRaceIds,
  getStalledInflightRaceIds,
  deleteAiTeamById,
} from "./aiTeamGenerator.js";

// #2434: defense-in-depth-backstop. Den PRIMÆRE stale-detektion er løbs-bevidst
// (alarmér når det blokerende løb selv er stallet). Denne backstop fanger blokeringer
// der hænger uforklarligt længe UDEN at det blokerende løb ser stallet ud. Sat langt
// over det længste etapeløbs kalender-spredning, så et lovligt kørende løb ALDRIG
// udløser den — netop dét (en 48t-tærskel kortere end den spredning) var rod-årsagen
// til CYCLINGZONE-31's falsk-positive spam.
export const STALE_BACKSTOP_HOURS = 120;

export async function runAiTeamTrimHealSweep({
  supabase,
  now = new Date(),
  backstopHours = STALE_BACKSTOP_HOURS,
  getInflightIds = getInflightRaceIds,
  // #2434: hvilke inflight-løb er selv stallet (næste etape hænger). Injicerbar for test.
  getStalledIds = getStalledInflightRaceIds,
  // #2434: hvilke af inflight-løbene blokerer DETTE hold (distinkte race_ids).
  teamBlockingRaceIds = teamInflightRaceIds,
  // #2389: uudbetalte præmier blokerer også trim (sletning før auto-prize krediterer
  // løbet gav P0002 + FK-fejl i standings-recalc). Auto-prize sweeper hvert 5. minut.
  hasUnpaidPrizes = teamHasUnpaidPrizeResults,
  removeTeam = deleteAiTeamById,
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
  const stalledRaceIds = new Set(await getStalledIds(supabase, now));
  const backstopMs = backstopHours * 60 * 60 * 1000;

  let healed = 0;
  let failed = 0;
  const stale = [];
  const errors = [];

  for (const team of candidates) {
    try {
      const blockingInflight = await teamBlockingRaceIds(supabase, team.id, inflightRaceIds);
      // Præmie-blokering er en SELVSTÆNDIG grund (#2389); tjek den kun hvis holdet ikke
      // allerede er inflight-blokeret (spar den dyrere præmie-query — mirror originalens `||`).
      const prizeBlocked = blockingInflight.length > 0
        ? false
        : await hasUnpaidPrizes(supabase, team.id);
      const blocked = blockingInflight.length > 0 || prizeBlocked;

      if (!blocked) {
        await removeTeam(supabase, team.id);
        healed += 1;
        continue;
      }

      // Løbs-bevidst stale-detektion (#2434): reelt fastlåst = blokerende løb selv
      // stallet, ELLER blokeringen har overskredet backstoppen.
      const blockingStalled = blockingInflight.filter((id) => stalledRaceIds.has(id));
      const ageMs = now.getTime() - new Date(team.pending_removal_at).getTime();

      let reason = null;
      if (blockingStalled.length > 0) reason = "blocking_race_stalled";
      else if (ageMs > backstopMs) reason = "pending_exceeds_backstop";

      if (reason) {
        stale.push({
          teamId: team.id,
          name: team.name,
          poolId: team.league_division_id,
          pendingSince: team.pending_removal_at,
          ageHours: Math.round(ageMs / (60 * 60 * 1000)),
          reason,
          stalledRaceIds: blockingStalled,
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
