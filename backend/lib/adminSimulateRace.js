// Admin-runtime-entrypoint for race-motoren (#1102) — tyndt handler-lib der
// spejler adminImportResultsHandler-mønstret: routes i api.js er ren transport.
//
// Fail-safe: ægte afvikling kræver RACE_ENGINE_V2_ENABLED; preview er altid tilladt.
//
// notifyDiscord-callback modtager { race, resultRows } — samme payload som
// buildRaceSimEmbed forventer (verificeret raceRunner.js linje ~443).
//
// N+1-note: getRaceEngineStatus laver 2 count-queries pr. løb. Acceptabel trade-off:
// sjælden admin-handling, ~10-30 løb pr. sæson — optimer ikke.

import { isRaceEngineV2Enabled, RACE_ENGINE_V2_FLAG_KEY } from "./raceEngineFlag.js";
import { simulateRace as simulateRaceDefault, simulateStageByIndex as simulateStageByIndexDefault } from "./raceRunner.js";

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export async function getRaceEngineStatus({ supabase }) {
  // Admin-only sti (requireAdmin): admins er implicit beta → beta-stage tæller som ON.
  const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester: true });

  const { data: season } = await supabase
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .maybeSingle();

  if (!season) {
    return { enabled, flag_key: RACE_ENGINE_V2_FLAG_KEY, season: null, races: [] };
  }

  const { data: races, error } = await supabase
    .from("races")
    .select("id, name, race_type, race_class, stages, status")
    .eq("season_id", season.id)
    .eq("status", "scheduled")
    .order("name");

  if (error) throw new Error(error.message);

  const out = [];
  for (const race of races || []) {
    const [profiles, entries] = await Promise.all([
      supabase
        .from("race_stage_profiles")
        .select("id", { count: "exact", head: true })
        .eq("race_id", race.id),
      supabase
        .from("race_entries")
        .select("rider_id", { count: "exact", head: true })
        .eq("race_id", race.id),
    ]);
    const profileCount = profiles.count ?? 0;
    out.push({
      ...race,
      profile_count: profileCount,
      entry_count: entries.count ?? 0, // 0 er OK — loadEntrantsForRace auto-fill'er
      // ready: alle krævede stage-profiler er til stede (samme betingelse som runAdminSimulateRace).
      ready: profileCount >= (race.stages || 1),
    });
  }

  return { enabled, flag_key: RACE_ENGINE_V2_FLAG_KEY, season, races: out };
}

export async function runAdminSimulateRace({
  supabase,
  raceId,
  dryRun = false,
  ensureSeasonStandings,
  updateStandings,
  notifyDiscord = null,
  simulateRace = simulateRaceDefault,
}) {
  if (!raceId) throw httpError(400, "race_id påkrævet");

  const { data: race, error } = await supabase
    .from("races")
    .select("id, season_id, name, race_type, race_class, stages, edition_year, status")
    .eq("id", raceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!race) throw httpError(404, "Løb ikke fundet");

  if (race.status === "completed") {
    throw httpError(
      409,
      "Løbet er allerede afviklet — sæt status tilbage via løbs-redigering hvis gen-afvikling er bevidst",
    );
  }

  // Delvise profiler må ikke kunne simuleres — motoren ville stille afvikle
  // færre etaper end løbet definerer (raceRunner kaster kun ved nul profiler).
  const { count: profileCount } = await supabase
    .from("race_stage_profiles")
    .select("id", { count: "exact", head: true })
    .eq("race_id", race.id);
  const expectedStages = race.stages || 1;
  if ((profileCount ?? 0) < expectedStages) {
    throw httpError(409, `Delvise stage-profiles (${profileCount ?? 0}/${expectedStages}) — kør backfillRaceStageProfiles før afvikling`);
  }

  if (!dryRun) {
    const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester: true });
    if (!enabled) {
      throw httpError(
        409,
        "RACE_ENGINE_V2_ENABLED er OFF — ægte afvikling blokeret (preview er tilladt)",
      );
    }
  }

  return simulateRace({
    supabase,
    race,
    dryRun,
    ensureSeasonStandings,
    updateStandings,
    notifyDiscord,
  });
}

/**
 * Stage-by-stage admin-entrypoint (WS1 Fase 3): fremtving PRÆCIS én etape af et løb.
 * stageIndex udledes af races.stages_completed (= næste etape, 0-indekseret). 409
 * hvis løbet er completed eller alle etaper allerede er kørt. Samme flag-/profil-guard
 * som runAdminSimulateRace. Bruges af stage-scheduleren OG som manuel fallback/test-trigger.
 */
export async function runAdminSimulateStage({
  supabase,
  raceId,
  dryRun = false,
  ensureSeasonStandings,
  updateStandings,
  notifyDiscord = null,
  simulateStageByIndex = simulateStageByIndexDefault,
}) {
  if (!raceId) throw httpError(400, "race_id påkrævet");

  const { data: race, error } = await supabase
    .from("races")
    .select("id, season_id, name, race_type, race_class, stages, stages_completed, edition_year, status")
    .eq("id", raceId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!race) throw httpError(404, "Løb ikke fundet");

  if (race.status === "completed") {
    throw httpError(409, "Løbet er allerede afviklet — alle etaper kørt");
  }

  const totalStages = race.stages || 1;
  const stageIndex = race.stages_completed || 0;
  if (stageIndex >= totalStages) {
    throw httpError(409, `Alle ${totalStages} etaper er allerede afviklet (stages_completed=${race.stages_completed})`);
  }

  // Delvise profiler må ikke kunne afvikles — samme guard som runAdminSimulateRace.
  const { count: profileCount } = await supabase
    .from("race_stage_profiles")
    .select("id", { count: "exact", head: true })
    .eq("race_id", race.id);
  if ((profileCount ?? 0) < totalStages) {
    throw httpError(409, `Delvise stage-profiles (${profileCount ?? 0}/${totalStages}) — kør backfillRaceStageProfiles før afvikling`);
  }

  if (!dryRun) {
    const enabled = await isRaceEngineV2Enabled(supabase, { isBetaTester: true });
    if (!enabled) {
      throw httpError(409, "RACE_ENGINE_V2_ENABLED er OFF — ægte afvikling blokeret (preview er tilladt)");
    }
  }

  return simulateStageByIndex({
    supabase,
    race,
    stageIndex,
    dryRun,
    ensureSeasonStandings,
    updateStandings,
    notifyDiscord,
  });
}

export function buildRaceSimEmbed({ race, resultRows }) {
  const rows = resultRows || [];
  const gcWinner = rows.find((r) => r.result_type === "gc" && r.rank === 1);
  const stageWinners = rows
    .filter((r) => r.result_type === "stage" && r.rank === 1)
    .sort((a, b) => (a.stage_number || 1) - (b.stage_number || 1));

  return {
    title: `🏁 ${race.name} afviklet (race-motor V2)`,
    description: [
      gcWinner ? `**Vinder:** ${gcWinner.rider_name ?? "Ukendt rytter"}` : null,
      stageWinners.length > 1
        ? `**Etapevindere:** ${stageWinners.map((r) => `${r.stage_number}. ${r.rider_name ?? "Ukendt rytter"}`).join(" · ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    color: 0x2ecc71,
  };
}
