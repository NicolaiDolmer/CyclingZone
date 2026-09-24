// #4850 spor C2 · Praecist etape-opslag pr. LOEBSDAG (spec
// docs/drafts/spec-lobsdag-udbytte-2026-09-24.md punkt 5 + risiko 1).
//
// SPOERGSMAALET: "Hvilken etape koerte hver af holdets ryttere paa loebsdag N?"
//
// KILDEN ER `race_results` ⋈ `race_stage_schedule`, IKKE `race_entry_days`.
//   · `race_results (result_type='stage')` siger hvem der faktisk KOERTE hvilken
//     (race_id, stage_number). Raekken skrives af finaliseringen og forsvinder aldrig.
//   · `race_stage_schedule.game_day` siger hvilken LOEBSDAG den etape hoerte til.
//     Én etape pr. loeb pr. loebsdag (CALENDAR_RULES), saa parret (race_id, game_day)
//     peger paa praecis ét stage_number.
//   · `race_stage_profiles.profile_type` er BERIGELSEN (hvilke evner loebsdagen
//     traener, RACE_PROFILE_ABILITY_MAP). Mangler den, falder motoren til 'rolling'.
//
// HVORFOR IKKE race_entry_days (risiko 1): `race_entry_days_rebuild` fjerner
// bindingen naar loebet faar status `completed`
// (database/2026-08-24-4191-race-entry-days-diff-rebuild.sql), og sweepen koerer
// EFTER dagens sidste finalisering. For et endagsloeb og for et etapeloebs sidste
// etape kan bindingen derfor vaere vaek, naar tick'et koerer. Hang "koerte han i
// dag" paa bindingen, fik rytteren almindelig traening oven i loebet (ejerens
// regel 2, 18/9: "loeb ELLER traening, aldrig begge"). Dette opslag kender ingen
// binding og svarer det samme foer og efter finaliseringen.
//
// HVORFOR IKKE `race_results.imported_at` (den gamle kalenderdags-noegle i
// dailyTrainingEngine.js' loadRacedRiderIdsToday): en kalenderdato baerer fra S4
// fem loebsdage (D1), og "sidste raekke vinder" gav den forkerte etapes profil,
// naar en rytter koerte to loebsdage samme dato. Loebsdagen er den praecise akse.
//
// SCOPING: `game_day` er saeson- OG divisions-relativ og `race_stage_schedule` har
// ingen season_id. Uden scoping ville S2's loebsdag 12 matche S3's loebsdag 12, og
// en rytter med et gammelt resultat paa "samme" (race, etape) ville taelle som
// "koerte i dag". Derfor: hold → division → saesonens loeb i den division → etaper
// paa loebsdagen → resultater. Fire smaa, holds-scopede queries.
//
// FEJL-KONTRAKT: som `loadBoundRiderIdsForRaceDay` (trainingRaceDayTick.js), IKKE
// som den gamle berigelse. Svaret afgoer om rytteren maa traene i dag; et gaet er
// enten traening oven i et loeb eller en taget dag. Derfor returneres fejlen
// ({ data: null, error }), og kald-stedet KASTER i stedet for at gaette. Kun
// profil-opslaget er best-effort (fallback 'rolling' hos kalderen).

/**
 * Ren sammenkobling, ingen I/O. Eksporteret saa den kan testes uden mock-client.
 *
 * @param {object} args
 * @param {Array<{race_id: string, stage_number: number, game_day: number}>} args.scheduleRows
 *   etaper i holdets division paa loebsdagen (allerede filtreret paa game_day)
 * @param {Array<{rider_id: string, race_id: string, stage_number: number}>} args.resultRows
 *   etaperesultater for holdets ryttere i de loeb
 * @param {Array<{race_id: string, stage_number: number, profile_type: string}>} [args.profileRows]
 * @returns {Map<string, {raceId: string, stageNumber: number, profileType: string|null}>}
 */
export function buildRaceDayStageByRider({ scheduleRows = [], resultRows = [], profileRows = [] } = {}) {
  const stageKey = (raceId, stageNumber) => `${raceId}:${Number(stageNumber)}`;
  const stagesOnDay = new Set(scheduleRows.map((s) => stageKey(s.race_id, s.stage_number)));
  const profileByStage = new Map(profileRows.map((p) => [stageKey(p.race_id, p.stage_number), p.profile_type ?? null]));

  const out = new Map();
  for (const row of resultRows) {
    if (!row?.rider_id) continue;
    const key = stageKey(row.race_id, row.stage_number);
    if (!stagesOnDay.has(key)) continue;
    // 1 rytter = 1 loeb pr. loebsdag (laast, #4209): der KAN kun vaere ét match.
    // Skulle en dublet alligevel findes, vinder den foerste — deterministisk.
    if (out.has(row.rider_id)) continue;
    out.set(row.rider_id, {
      raceId: row.race_id,
      stageNumber: Number(row.stage_number),
      profileType: profileByStage.get(key) ?? null,
    });
  }
  return out;
}

/**
 * Slaa op hvilken etape hver af holdets ryttere koerte paa loebsdagen.
 *
 * @param {object} args
 * @param {object} args.supabase   service-role client
 * @param {string} args.teamId
 * @param {string} args.seasonId
 * @param {number} args.gameDay    loebsdagen (1-baseret, divisions-relativ)
 * @param {string[]} args.riderIds holdets ryttere (typisk < 30)
 * @param {boolean} [args.withProfiles=true]  hent profil-typen (kun noedvendig naar
 *   udviklingen er taendt; uden den bruges maengden kun til "koerte" vs. "hvilede")
 * @returns {Promise<{
 *   data: Map<string, {raceId: string, stageNumber: number, profileType: string|null}>|null,
 *   error: unknown,
 *   profileError: unknown,
 * }>}
 *   `error` sat ⇒ svaret er UKENDT (kald-stedet skal kaste, ikke gaette).
 *   `profileError` sat ⇒ etaperne er kendte, men profilerne er det ikke (fallback).
 */
export async function loadRaceDayStagesByRider({
  supabase, teamId, seasonId, gameDay, riderIds, withProfiles = true,
}) {
  const empty = () => ({ data: new Map(), error: null, profileError: null });
  if (!supabase?.from) return { data: null, error: new Error("supabase client required"), profileError: null };
  if (!teamId) return { data: null, error: new Error("teamId required"), profileError: null };
  if (!seasonId) return { data: null, error: new Error("seasonId required"), profileError: null };
  // `Number(null)` er 0, ikke NaN — en manglende loebsdag maa ikke slippe igennem
  // som loebsdag 0 (samme vagt som loadBoundRiderIdsForRaceDay).
  if (gameDay === null || gameDay === undefined || !Number.isFinite(Number(gameDay))) {
    return { data: null, error: new Error("finite gameDay required"), profileError: null };
  }
  if (!riderIds?.length) return empty();

  try {
    // 1) Holdets division. Uden division findes der ingen loebsdags-akse for holdet
    //    (spec §3.2), og saa kan ingen af dets ryttere have koert paa "loebsdag N".
    const { data: team, error: teamError } = await supabase
      .from("teams").select("league_division_id").eq("id", teamId).maybeSingle();
    if (teamError) return { data: null, error: teamError, profileError: null };
    const divisionId = team?.league_division_id ?? null;
    if (!divisionId) return empty();

    // 2) Saesonens loeb i den division. pagination-safe: én pulje i én saeson
    //    (32-37 i S4-dry-runnet), langt under PostgREST's 1000-raekkers-loft.
    const { data: races, error: racesError } = await supabase
      .from("races").select("id").eq("season_id", seasonId).eq("league_division_id", divisionId);
    if (racesError) return { data: null, error: racesError, profileError: null };
    const raceIds = (races ?? []).map((r) => r.id).filter(Boolean);
    if (!raceIds.length) return empty();

    // 3) Etaperne paa loebsdagen. LAESER den lagrede game_day, udleder den aldrig af
    //    scheduled_at (akse-faelden, CALENDAR_RULES §0). pagination-safe: hoejst én
    //    etape pr. loeb pr. loebsdag.
    const { data: scheduleRows, error: scheduleError } = await supabase
      .from("race_stage_schedule")
      .select("race_id, stage_number, game_day")
      .in("race_id", raceIds)
      .eq("game_day", Number(gameDay));
    if (scheduleError) return { data: null, error: scheduleError, profileError: null };
    const stages = scheduleRows ?? [];
    if (!stages.length) return empty();
    const raceIdsOnDay = [...new Set(stages.map((s) => s.race_id))];

    // 4) Hvem af holdets ryttere har et etaperesultat i de loeb? Filtreret paa
    //    (race_id, stage_number) i JS: PostgREST har ingen tuple-IN. pagination-safe:
    //    holdets egne ryttere (< 30) × etaperne i hoejst et par loeb (≤ 21 hver).
    const { data: resultRows, error: resultsError } = await supabase
      .from("race_results")
      .select("rider_id, race_id, stage_number")
      .eq("result_type", "stage")
      .in("race_id", raceIdsOnDay)
      .in("rider_id", riderIds);
    if (resultsError) return { data: null, error: resultsError, profileError: null };

    // 5) Profil-typen (berigelse). Kun for loeb hvor mindst én af holdets ryttere
    //    faktisk koerte. pagination-safe: hoejst et par loeb pr. hold pr. loebsdag
    //    (1 rytter = 1 loeb pr. loebsdag), hvert med ≤ 21 profil-raekker.
    let profileRows = [];
    let profileError = null;
    const riddenRaceIds = [...new Set((resultRows ?? []).map((r) => r.race_id))];
    if (withProfiles && riddenRaceIds.length) {
      const { data: profiles, error: profilesError } = await supabase
        .from("race_stage_profiles") // pagination-safe: se punkt 5 ovenfor
        .select("race_id, stage_number, profile_type")
        .in("race_id", riddenRaceIds);
      if (profilesError) profileError = profilesError;
      else profileRows = profiles ?? [];
    }

    return {
      data: buildRaceDayStageByRider({ scheduleRows: stages, resultRows: resultRows ?? [], profileRows }),
      error: null,
      profileError,
    };
  } catch (err) {
    // best-effort HER, men ikke hos kalderen (samme moenster som
    // loadBoundRiderIdsForRaceDay): fejlen sluges ikke, den RETURNERES
    // (data: null = "ved det ikke"), og dailyTrainingEngine.js kaster paa den.
    // Én form ({ data, error }) saa kald-stedet har ét sted at traeffe sin beslutning.
    return { data: null, error: err, profileError: null };
  }
}
