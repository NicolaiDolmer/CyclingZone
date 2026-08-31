// Sæson-optagelse til akademiet (#2911) — NYT MODUL, rører ikke academyIntake.js.
//
// PROBLEMET: runAcademyIntake kaldes fra relaunch, signup og en heal-sweep — aldrig
// fra sæsonskiftet. Ved S1→S2 forlader 21 akademiryttere akademiet (de fylder 22) og
// nul kommer ind AF SKIFTET. Søndags-drippet (#2064, live siden 19/7) leverer et
// løbende inflow, men det er ikke koblet til årgangs-skiftet, så "ny sæson = ny
// årgang" findes ikke som begivenhed.
//
// Modulet genbruger den DELTE kerne seedAcademyCohortForTeam (samme generator, samme
// owner-godkendte potentiale-fordeling og alders-træk som drip/relaunch/signup) — det
// eneste nye håndtag er ANTAL pr. hold og HVEM der får et kuld.
//
// Idempotens: egen claim-tabel academy_season_intake_runs (PK team_id, season_id).
// academy_intake-rækkerne kan IKKE bruges som guard (søndags-drippet skriver dem
// også), og academy_intake_ticks kan ikke bruges fordi skiftet selv kører på en
// søndag — drippet ville have claimet dagen først.
//
// Flag: season_academy_intake_enabled. FAIL-SAFE off → nuværende adfærd.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { ACADEMY, isAcademyEnabled } from "./academyFlag.js";
import {
  seedAcademyCohortForTeam,
  fetchActiveSeason,
  fetchExistingFoldedRiderNames,
  hashStringToSeed,
} from "./academyIntake.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { deriveForRiderIds } from "./backfillCores.js";
import { notifyTeamOwner } from "./notificationService.js";
import { fetchAllPaged } from "./dbChunk.js";
import { captureException } from "./sentry.js";
import { LAUNCH_REFERENCE_YEAR, seasonReferenceYear } from "./riderSeasonAge.js";

export const SEASON_ACADEMY_INTAKE_FLAG_KEY = "season_academy_intake_enabled";

export const SEASON_ACADEMY_INTAKE = Object.freeze({
  // "fixed"  → alle menneskehold får COUNT kandidater
  // "top_up" → hvert hold fyldes op til TARGET_PIPELINE (akademiryttere + åbne
  //            tilbud), maks COUNT pr. sæson. Selvbegrænsende: et hold med
  //            fyldt akademi (8/8) får NUL, så optagelsen ikke lander oven på
  //            en indbakke der allerede har uafgjorte tilbud.
  //
  // TARGET_PIPELINE = ACADEMY.SLOTS er valgt på scorecardet (seasonStartScorecard.js,
  // 25/7): target 6 var reelt et no-op (søndags-drippet fylder allerede pipelinen
  // til 6), target 8 giver +314 tilbud/sæson og løfter bestanden fra 872 → 915
  // ryttere ved S6 hvis underskrivningsraten falder til 15 %.
  MODE: "top_up",
  COUNT: 3,
  TARGET_PIPELINE: ACADEMY.SLOTS,
  SEED_BASE: 2911,
});

const VALID_MODES = new Set(["fixed", "top_up"]);

export async function isSeasonAcademyIntakeEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, SEASON_ACADEMY_INTAKE_FLAG_KEY), opts);
}

/**
 * REN KERNE — hvor mange kandidater hvert hold skal tilbydes ved sæsonstart.
 * Deterministisk, ingen DB, ingen tilfældighed. Hold med 0 sorteres fra.
 *
 * @param {{teams: Array<{teamId:string, academyCount?:number, openOffers?:number}>,
 *          mode?:string, count?:number, targetPipeline?:number}} args
 * @returns {Array<{teamId:string, count:number}>} sorteret på teamId (stabil rækkefølge)
 */
export function planSeasonAcademyIntake({
  teams = [],
  mode = SEASON_ACADEMY_INTAKE.MODE,
  count = SEASON_ACADEMY_INTAKE.COUNT,
  targetPipeline = SEASON_ACADEMY_INTAKE.TARGET_PIPELINE,
} = {}) {
  if (!VALID_MODES.has(mode)) throw new Error(`planSeasonAcademyIntake: ukendt mode '${mode}'`);
  const max = Math.max(0, Math.floor(Number(count) || 0));

  const out = [];
  for (const t of teams) {
    if (!t?.teamId) continue;
    let n;
    if (mode === "fixed") {
      n = max;
    } else {
      const pipeline = Math.max(0, Number(t.academyCount) || 0) + Math.max(0, Number(t.openOffers) || 0);
      n = Math.min(max, Math.max(0, Math.floor(Number(targetPipeline) || 0) - pipeline));
    }
    if (n > 0) out.push({ teamId: t.teamId, count: n });
  }
  return out.sort((a, b) => String(a.teamId).localeCompare(String(b.teamId)));
}

/**
 * Kør sæson-optagelsen for den aktive (netop åbnede) sæson.
 *
 * Kræver BÅDE academy_enabled (akademiet findes overhovedet) og
 * season_academy_intake_enabled (denne mekanik). Begge fail-safe off.
 *
 * Fejl pr. hold isoleres i errors[] — ét holds fejl må ikke vælte de andres kuld
 * (samme disciplin som sundayIntakeTick.js).
 */
export async function runSeasonAcademyIntake({
  supabase,
  dryRun = false,
  mode = SEASON_ACADEMY_INTAKE.MODE,
  count = SEASON_ACADEMY_INTAKE.COUNT,
  targetPipeline = SEASON_ACADEMY_INTAKE.TARGET_PIPELINE,
  seedBase = SEASON_ACADEMY_INTAKE.SEED_BASE,
  isEnabled = isSeasonAcademyIntakeEnabled,
  academyEnabled = isAcademyEnabled,
  seedCohortFn = seedAcademyCohortForTeam,
  deriveRiders = deriveForRiderIds,
  notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  // EGET flag først: er mekanikken slukket, må vi hverken læse videre eller lægge
  // en fase-række i transition-loggen (flag-off skal være bit-identisk med før).
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };
  if (!(await academyEnabled(supabase))) return { ran: false, reason: "academy_flag_off" };

  const season = await fetchActiveSeason(supabase);
  if (!season) return { ran: false, reason: "no_active_season" };

  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, season_1_identity_basis")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false);
  if (teamsErr) throw new Error(`season academy intake teams lookup: ${teamsErr.message}`);
  if (!teams?.length) return { ran: true, seasonNumber: season.number, teams: 0, candidates: 0 };

  const teamIds = new Set(teams.map((t) => t.id));

  // Nuværende akademi-bestand pr. hold (is_academy=true, ikke pensioneret).
  const { data: academyRiders, error: acErr } = await fetchAllPaged(() =>
    supabase.from("riders").select("id, team_id")
      .eq("is_academy", true).eq("is_retired", false).order("id")
  );
  if (acErr) throw new Error(`season academy intake bestand: ${acErr.message}`);
  const academyCount = new Map();
  for (const r of academyRiders || []) {
    if (!teamIds.has(r.team_id)) continue;
    academyCount.set(r.team_id, (academyCount.get(r.team_id) || 0) + 1);
  }

  // Åbne (uafgjorte) tilbud pr. hold — tæller med i "pipeline" så top_up ikke
  // stabler tilbud oven på tilbud holdet ikke har taget stilling til endnu.
  const { data: openRows, error: openErr } = await fetchAllPaged(() =>
    supabase.from("academy_intake").select("team_id").eq("status", "offered").order("team_id")
  );
  if (openErr) throw new Error(`season academy intake open offers: ${openErr.message}`);
  const openOffers = new Map();
  for (const r of openRows || []) {
    openOffers.set(r.team_id, (openOffers.get(r.team_id) || 0) + 1);
  }

  const plan = planSeasonAcademyIntake({
    teams: teams.map((t) => ({
      teamId: t.id,
      academyCount: academyCount.get(t.id) || 0,
      openOffers: openOffers.get(t.id) || 0,
    })),
    mode,
    count,
    targetPipeline,
  });

  if (dryRun) {
    return {
      ran: true, dryRun: true, seasonNumber: season.number, mode,
      teams: plan.length,
      candidates: plan.reduce((s, p) => s + p.count, 0),
    };
  }

  const identityByTeam = new Map(teams.map((t) => [t.id, t.season_1_identity_basis || null]));
  const existingNames = await fetchExistingFoldedRiderNames(supabase);
  const allNewIds = [];
  const errors = [];
  let teamsSeeded = 0;

  for (const entry of plan) {
    // Claim-FØRST pr. (hold, sæson) — ignoreDuplicates → tom data = allerede kørt.
    const { data: claim, error: claimErr } = await supabase
      .from("academy_season_intake_runs")
      .upsert(
        { team_id: entry.teamId, season_id: season.id },
        { onConflict: "team_id,season_id", ignoreDuplicates: true }
      )
      .select("team_id");
    if (claimErr) {
      errors.push(`claim ${entry.teamId}: ${claimErr.message}`);
      continue;
    }
    if (!claim?.length) continue; // allerede kørt for denne sæson

    try {
      const rng = makeRng((seedBase ^ hashStringToSeed(`${entry.teamId}:${season.id}`)) >>> 0);
      const newIds = await seedCohortFn(supabase, {
        teamId: entry.teamId,
        season,
        // SSOT-referenceåret (#4485) — IKKE et årstal udledt af seasons.start_date
        // (wall-clock-tidspunktet for sæsonskiftet, ikke sæsonens alders-år).
        referenceYear: seasonReferenceYear(season.number) ?? LAUNCH_REFERENCE_YEAR,
        existingNames,
        rng,
        identityBasis: identityByTeam.get(entry.teamId),
        countOverride: entry.count,
      });
      teamsSeeded++;
      for (const id of newIds) allNewIds.push(id);

      await notify({
        supabase,
        teamId: entry.teamId,
        type: "academy_drip",
        title: "A new academy intake has arrived",
        message: "The new season brought fresh candidates to your academy - sign or reject them.",
        relatedId: null,
        metadata: {
          titleCode: "notif.academySeasonIntake.title",
          messageCode: "notif.academySeasonIntake.message",
        },
      });
    } catch (e) {
      // Pr. hold isoleret: ét holds fejlede seeding må ikke vælte optagelsen for
      // resten. Fejlen surfacer to steder — i det returnerede errors[] (og dermed
      // i transitionens fase-log) OG i Sentry, så en fejl under et rigtigt
      // sæsonskifte ikke kun kan ses af den der læser fase-loggen bagefter.
      // NB: holdet er allerede claimet, så en gen-kørsel springer det over —
      // fejlede hold skal håndteres manuelt, ikke ved at køre skiftet igen.
      errors.push(`${entry.teamId}: ${e?.message ?? e}`);
      captureException(e, {
        tags: { phase: "season_academy_intake" },
        extra: { teamId: entry.teamId, seasonId: season.id },
      });
    }
  }

  // Afled-pipelinen (#1478) i ÉT kald — uden den mangler kandidaterne physiology,
  // abilities, ryttertype og base_value.
  if (allNewIds.length > 0) {
    await deriveRiders(supabase, allNewIds, { dryRun: false });
  }

  return {
    ran: true,
    dryRun: false,
    seasonNumber: season.number,
    mode,
    teams: teamsSeeded,
    candidates: allNewIds.length,
    ...(errors.length ? { errors } : {}),
  };
}
