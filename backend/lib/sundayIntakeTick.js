// backend/lib/sundayIntakeTick.js
// #2064 S0 — Søndags-drip: hvert menneske-hold får SUNDAY_DRIP_COUNT nye
// akademi-kandidater (offered) hver søndag (Europe/Copenhagen).
//
// Idempotens: claim-FØRST pr. (hold, søndags-dato) i academy_intake_ticks
// (PK-collision → allerede kørt). Boot-runs/replicas er dermed no-ops
// (#2646-lærdommen: dagsmarkør, aldrig pr.-boot-kvote). Fejler seeding EFTER
// claim, misser holdet denne søndag (bevidst valg: hellere miss end dobbelt-kuld);
// fejlen surfaces i errors[] → cron-log/Sentry.
//
// Konservative v1-defaults (2 kandidater, ~35 % chance for 1 seriøs) — sæson-
// budgettet (12+), talent-odds og facilitets-skalering kalibreres i S1-sim-slicen
// (spec §2/§7) FØR de røres.
import { isAcademyEnabled } from "./academyFlag.js";
import {
  seedAcademyCohortForTeam,
  fetchActiveSeason,
  fetchExistingFoldedRiderNames,
  hashStringToSeed,
} from "./academyIntake.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { deriveForRiderIds } from "./backfillCores.js";
import { notifyTeamOwner } from "./notificationService.js";

export const SUNDAY_DRIP_COUNT = 2;
export const SUNDAY_DRIP_SERIOUS_PROB = 0.35;
const DRIP_SEED_BASE = 2064;

export function copenhagenDateString(now = new Date()) {
  // en-CA giver YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(now);
}

export function isCopenhagenSunday(now = new Date()) {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Copenhagen", weekday: "short" })
      .format(now) === "Sun"
  );
}

export async function runSundayIntakeTick({
  supabase,
  now = new Date(),
  isEnabled = isAcademyEnabled,
  seedCohortFn = seedAcademyCohortForTeam,
  deriveRiders = deriveForRiderIds,
  notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!isCopenhagenSunday(now)) return { ran: false, reason: "not_sunday" };
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };

  const season = await fetchActiveSeason(supabase);
  if (!season) return { ran: false, reason: "no_active_season" };

  const tickDate = copenhagenDateString(now);
  const referenceYear = parseInt(String(season.start_date).slice(0, 4), 10) || 2026;

  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, season_1_identity_basis")
    .eq("is_ai", false)
    .eq("is_bank", false)
    .eq("is_frozen", false)
    .eq("is_test_account", false);
  if (teamsErr) throw new Error(`sunday-intake teams lookup: ${teamsErr.message}`);
  if (!teams?.length) return { ran: true, tickDate, teams: 0, candidates: 0 };

  const existingNames = await fetchExistingFoldedRiderNames(supabase);

  let teamsSeeded = 0;
  const allNewIds = [];
  const errors = [];

  for (const team of teams) {
    // Claim-først: PK (team_id, tick_date). ignoreDuplicates → tom data = allerede claimet.
    const { data: claim, error: claimErr } = await supabase
      .from("academy_intake_ticks")
      .upsert(
        { team_id: team.id, tick_date: tickDate },
        { onConflict: "team_id,tick_date", ignoreDuplicates: true }
      )
      .select("team_id");
    if (claimErr) {
      errors.push(`claim ${team.id}: ${claimErr.message}`);
      continue;
    }
    if (!claim?.length) continue; // allerede kørt i dag (boot-run/replica)

    try {
      const rng = makeRng(((DRIP_SEED_BASE ^ hashStringToSeed(`${team.id}:${tickDate}`)) >>> 0));
      const seriousCount = rng() < SUNDAY_DRIP_SERIOUS_PROB ? 1 : 0;
      const newIds = await seedCohortFn(supabase, {
        teamId: team.id,
        season,
        referenceYear,
        existingNames,
        rng,
        identityBasis: team.season_1_identity_basis || null,
        countOverride: SUNDAY_DRIP_COUNT,
        seriousCountOverride: seriousCount,
      });
      teamsSeeded += 1;
      for (const id of newIds) allNewIds.push(id);

      await notify({
        supabase,
        teamId: team.id,
        type: "academy_drip",
        title: "New academy talent has arrived",
        message: "New candidates are waiting in your academy - sign or reject them.",
        relatedId: null,
        metadata: {
          titleCode: "notif.academyDrip.title",
          messageCode: "notif.academyDrip.message",
        },
      });
    } catch (e) {
      // best-effort: fejlen sluges IKKE reelt — den samles i errors[] som
      // returneres til cron-handleren og captures aggregeret i Sentry dér.
      // Ét holds fejl må ikke vælte de andre holds drip (claimet står, så
      // holdet retries ikke i dag — bevidst: hellere miss end dobbelt-kuld).
      errors.push(`${team.id}: ${e?.message ?? e}`);
    }
  }

  // Afled-pipeline (#1478) i ÉT kald for alle nye ryttere.
  if (allNewIds.length > 0) {
    await deriveRiders(supabase, allNewIds, { dryRun: false });
  }

  return {
    ran: true,
    tickDate,
    teams: teamsSeeded,
    candidates: allNewIds.length,
    ...(errors.length ? { errors } : {}),
  };
}
