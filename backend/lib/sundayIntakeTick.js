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
// Konservative v1-defaults (2 kandidater; potentiale trækkes geometrisk, faktor
// 0.55) — sæson-budgettet (12+), talent-odds og facilitets-skalering kalibreres i
// S1-sim-slicen (spec §2/§7) FØR de røres.
import { isAcademyEnabled } from "./academyFlag.js";
import {
  seedAcademyCohortForTeam,
  fetchActiveSeason,
  fetchExistingFoldedRiderNames,
  hashStringToSeed,
  referenceYearForSeason,
} from "./academyIntake.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { deriveForRiderIds } from "./backfillCores.js";
import { notifyTeamOwner } from "./notificationService.js";

export const SUNDAY_DRIP_COUNT = 2;
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
  // #3611: DELT definition med academyIntake — var en egen kopi af start_date-året,
  // som driver ét år fra sæson-alderen pr. sæson.
  const referenceYear = referenceYearForSeason(season);

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
  const seededTeamIds = []; // #3576: hold der skal notificeres — FØRST efter derive
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
      const newIds = await seedCohortFn(supabase, {
        teamId: team.id,
        season,
        referenceYear,
        existingNames,
        rng,
        identityBasis: team.season_1_identity_basis || null,
        countOverride: SUNDAY_DRIP_COUNT,
      });
      teamsSeeded += 1;
      for (const id of newIds) allNewIds.push(id);
      // #3576: notifikationen sendes IKKE her — se efter derive-kaldet nedenfor.
      seededTeamIds.push(team.id);
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

  // #3576 — notifikationen sendes FØRST når kandidaterne faktisk er færdige.
  //
  // Før lå notify inde i seed-loopet, altså FØR derive-kaldet ovenfor. En rytter
  // uden derive-lag har hverken physiology, evner, ryttertype eller base_value, så
  // spilleren kunne få "New academy talent has arrived", klikke ind med det samme
  // og se tomme kandidater — og fejlede derive helt, stod de tomme indtil
  // riderDeriveHealSweep tog dem. Ved 192 hold er seed-loopet minutter langt, så
  // vinduet er reelt. Det er den samme klasse som spillerne meldte 9/8: "I got mail
  // that new academy arrived. But going to academy, no player exists."
  //
  // Rækkefølgen er nu: seed alle → derive alle → notificér. Fejler derive, kastes
  // der før nogen notifikation er sendt, og ingen spiller får en besked om et kuld
  // der ikke kan vises. Kuldet står i academy_intake og heales af sweep'en.
  for (const teamId of seededTeamIds) {
    try {
      await notify({
        supabase,
        teamId,
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
      // best-effort: fejlen sluges IKKE reelt — den samles i errors[], som
      // cron-handleren (cron.js runSundayIntakeTickCron) captures aggregeret i
      // Sentry. En fejlet notifikation må ikke rulle kuldet tilbage: kandidaterne
      // ER oprettet og derived, og holdet ser dem næste gang akademiet åbnes.
      errors.push(`notify ${teamId}: ${e?.message ?? e}`);
    }
  }

  return {
    ran: true,
    tickDate,
    teams: teamsSeeded,
    candidates: allNewIds.length,
    ...(errors.length ? { errors } : {}),
  };
}
