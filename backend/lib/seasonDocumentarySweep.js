// #3402 — Sæsondokumentaren: batch-genereringssweep. Kører periodisk (cron.js),
// finder de seneste COMPLETED sæsoner og genererer dokumentaren for ethvert
// menneskehold der endnu ikke har en cachet række — idempotent (upsert i
// generateSeasonDocumentary), så en genkørsel efter en delvis fejl bare
// fylder hullerne op uden at dublere eller genskrive allerede-færdige rækker.
//
// "BATCH NATTEN OVER"-SEMANTIK: issue-teksten beder om nat-batch ved
// sæsonskifte. I stedet for en engangs-trigger PÅ selve transitionen (som
// ville kræve et nyt hook i seasonTransition.js/seasonAutoTransition.js —
// scope-udvidelse denne slice bevidst undgår, jf. "nul engine-ændringer" i
// #3395's bølge 1-mål), poller denne sweep periodisk (60 min, samme kadence
// som discord-race-digest/entry-generator) efter COMPLETED sæsoner med
// manglende dokumentar-rækker. Resultatet er det samme: alle hold i en netop
// afsluttet sæson får deres dokumentar inden for sweepens vindue, ÉN gang,
// og efterfølgende ticks er billige no-ops (ingen manglende rækker → intet
// arbejde). LLM-flaget er default OFF, så "natten over" for poleringslaget
// er i praksis moot indtil ejeren aktivt slår det til.
//
// SCOPE: kun de to NYESTE completed sæsoner (order by number desc limit 2) —
// undgår at scanne en voksende historik af gamle sæsoner for evigt; en ældre
// sæsons dokumentar der mangler (fx pga. en fejl under en tidligere sweep)
// kan stadig fyldes op manuelt af ejeren, men er ikke sweepens ansvar
// fremadrettet (samme "recency window"-mønster som andre sweeps i denne fil).
//
// "RIGTIGE HOLD"-DISKRIMINATOR: samme fire-felts filter som discordRaceDigestSweep.js
// (is_ai/is_bank/is_frozen/is_test_account) — season_standings/teams har ingen
// RLS-begrænsning på service_role, så filteret skal gentages her (jf.
// feedback_match_ui_filter_for_capacity_logic).

import { generateSeasonDocumentaryAutoFlag } from "./seasonDocumentaryGenerate.js";

const RECENT_SEASONS_LIMIT = 2;

async function defaultFetchRecentCompletedSeasons({ supabase }) {
  const { data, error } = await supabase
    .from("seasons")
    .select("id, number")
    .eq("status", "completed")
    .order("number", { ascending: false })
    .limit(RECENT_SEASONS_LIMIT);
  if (error) throw new Error(`season-documentary sweep: seasons fetch failed: ${error.message}`);
  return data || [];
}

async function defaultFetchHumanTeamsForSeason({ supabase, seasonId }) {
  const { data, error } = await supabase
    .from("season_standings")
    .select("team_id, team:team_id!inner(id, name, is_ai, is_bank, is_frozen, is_test_account)")
    .eq("season_id", seasonId)
    .eq("team.is_ai", false)
    .eq("team.is_bank", false)
    .eq("team.is_frozen", false)
    .eq("team.is_test_account", false);
  if (error) throw new Error(`season-documentary sweep: standings fetch failed (season ${seasonId}): ${error.message}`);
  return (data || []).map((row) => ({ teamId: row.team_id, teamName: row.team?.name || "—" }));
}

async function defaultFetchExistingDocumentaryTeamIds({ supabase, seasonId }) {
  const { data, error } = await supabase
    .from("season_documentaries")
    .select("team_id")
    .eq("season_id", seasonId);
  if (error) throw new Error(`season-documentary sweep: existing-rows fetch failed (season ${seasonId}): ${error.message}`);
  return new Set((data || []).map((r) => r.team_id));
}

/**
 * Kør sweepen. Injicerbare fetch-funktioner + generate til test uden DB/netværk
 * (mirror discordRaceDigestSweep.js's DI-mønster).
 *
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @returns {Promise<{seasonsChecked:number, generated:number, failed:number, errors:Array<{seasonId:string, teamId:string, message:string}>}>}
 */
export async function runSeasonDocumentarySweep({
  supabase,
  fetchRecentCompletedSeasons = defaultFetchRecentCompletedSeasons,
  fetchHumanTeamsForSeason = defaultFetchHumanTeamsForSeason,
  fetchExistingDocumentaryTeamIds = defaultFetchExistingDocumentaryTeamIds,
  generate = generateSeasonDocumentaryAutoFlag,
}) {
  const seasons = await fetchRecentCompletedSeasons({ supabase });
  let generated = 0;
  let failed = 0;
  const errors = [];

  for (const season of seasons) {
    const [teams, existingTeamIds] = await Promise.all([
      fetchHumanTeamsForSeason({ supabase, seasonId: season.id }),
      fetchExistingDocumentaryTeamIds({ supabase, seasonId: season.id }),
    ]);

    for (const team of teams) {
      if (existingTeamIds.has(team.teamId)) continue;
      try {
        await generate({
          supabase,
          seasonId: season.id,
          teamId: team.teamId,
          teamName: team.teamName,
          seasonNumber: season.number,
        });
        generated += 1;
      } catch (e) {
        // best-effort: ét holds fejl må ikke stoppe resten af sweepen (partial-
        // failure-isolation — samme mønster som discordRaceDigestSweep.js).
        // Fejlen SLUGES ikke tavst: den samles i `errors` og returneres til
        // kaldestedet (backend/cron.js's runSeasonDocumentarySweepCron), som
        // sender hver til Sentry via captureException — se cron.js.
        failed += 1;
        errors.push({ seasonId: season.id, teamId: team.teamId, message: e.message });
      }
    }
  }

  return { seasonsChecked: seasons.length, generated, failed, errors };
}
