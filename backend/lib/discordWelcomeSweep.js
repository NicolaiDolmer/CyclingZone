// #5130 (ejer-direktiv 10/9): sweep der sender Discord-velkomstbeskeden.
//
// TIDSPUNKT (orkestrator-valg, se PR-body #5211): naar holdet er oprettet OG
// har rundet loebs-klar-taersklen (MIN_RIDERS_FOR_RACE, samme graense som
// squadBelowMinimumCheck.js/starterSquadAllocator.js) — dvs. den foerste
// draft er gennemfoert — ELLERS senest 24t efter oprettelse uanset
// trupstoerrelse (dette sweeps naeste tick fanger den fallback, ingen
// separat route-hook noedvendig).
//
// IDEMPOTENS (dedupe paa team_id) — haerdet 15/9 (CodeRabbit major, PR
// #5211, discordWelcomeSweep.js:105): raekkefoelgen er notifikation FOERST,
// markering af teams.discord_welcome_sent_at BAGEFTER. Den omvendte
// raekkefoelge (marker sent_at FOER notify() kaldes, saadan denne fil
// startede) har en usynlig fejlvej: doer processen (crash/OOM/deploy-
// genstart) MELLEM claim-updaten og notify()-kaldet, staar holdet for evigt
// som "sendt" uden at beskeden nogensinde blev skrevet — kandidat-
// forespoergslen filtrerer netop paa at kolonnen er NULL, saa der findes
// ingen naeste tick der proever igen.
//
// Med raekkefoelgen byttet om er det vaerste udfald ved samme crash i
// stedet: notify() er gennemfoert (beskeden ER skrevet til notifications),
// men markeringen naar aldrig at committe. Holdet ses som kandidat igen
// naeste tick, sweepen kalder notify() igen — og notifyUser's EGEN 24t-dedup
// (matcher paa type + title + message + related_id,
// RECENT_DUPLICATE_WINDOW_MS i notificationService.js) fanger det og
// returnerer deduped:true UDEN at skrive en ny raekke. Denne tick markerer
// saa discord_welcome_sent_at. Selv-helende, ingen dobbelt besked, intet
// hold tabt permanent.
//
// RACE-SIKRING mod parallelle sweep-ticks der begge naar notify() for samme
// hold FOER nogen af dem markerer: samme forsvar som ovenfor —
// notifyUser's dedup-opslag er det der forhindrer to raekker i
// notifications, ikke markeringen. Markeringen er nu ren bogfoering (den
// forhindrer at holdet FORTSAT ses som kandidat), ikke en laas mod dobbelt
// afsendelse. Den bruger stadig en betinget UPDATE (WHERE
// discord_welcome_sent_at IS NULL), saa en tick der taber loebet mod en
// anden ikke unoedvendigt overskriver en allerede sat markering.
//
// SCHEMA-READINESS (CodeRabbit minor, PR #5211, discordWelcomeSweep.js:31):
// auto-migrate (#2642) koerer
// database/2026-09-14-5130-discord-welcome-sent-at.sql foerst ca. 180s
// EFTER deploy, og selve kolonnen kan derfor mangle i op til 120s efter
// appen er live (cron'en der driver denne sweep starter efter 300s).
// isDiscordWelcomeSchemaPending fanger den fejl og springer tick'en over med
// et log-varsel i stedet for at raabe stoej i Sentry i det vindue.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { notifyUser as defaultNotifyUser } from "./notificationService.js";
import { buildDiscordWelcomeNotification } from "./discordWelcomeNotification.js";
import { captureException } from "./sentry.js";

export const DISCORD_WELCOME_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Er fejlen "discord_welcome_sent_at findes ikke endnu"? Samme recipe som
 * isSelectionReminderMigrationPending (selectionDeadlineReminder.js) og
 * isMissingRetryColumnError (emailRetrySweep.js): SQLSTATE + PostgRESTs egne
 * schema-cache-koder tjekkes foerst (stabile signal), beskeden er sidste
 * vaern hvis koden mangler i et fremtidigt driver-skift.
 */
export function isDiscordWelcomeSchemaPending(error) {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42703" || code === "PGRST204" || code === "PGRST205") return true;
  return /discord_welcome_sent_at|schema cache/i.test(String(error.message ?? ""));
}

async function defaultFetchCandidateTeams({ supabase }) {
  return fetchAllRows(() =>
    applyHumanTeamFilter(supabase.from("teams").select("id, name, user_id, created_at"))
      .not("user_id", "is", null)
      .is("discord_welcome_sent_at", null)
      .order("id"),
  );
}

// Samme filter + chunked-in-moenster som squadBelowMinimumCheck.js's
// defaultFetchActiveRiderCounts: akademi- og pensionerede ryttere taeller
// ikke mod loebs-klar trupstoerrelse.
async function defaultFetchActiveRiderCounts({ supabase, teamIds }) {
  if (!teamIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase
      .from("riders")
      .select("id, team_id")
      .in("team_id", chunk)
      .eq("is_academy", false)
      .eq("is_retired", false)
      .order("id"),
  );
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.team_id, (counts.get(row.team_id) || 0) + 1);
  }
  return counts;
}

/**
 * Ren beslutningsfunktion (unit-testbar uden database): er holdet moden til
 * Discord-velkomstbeskeden lige nu?
 */
export function isDiscordWelcomeDue({
  team,
  activeRiders,
  now,
  minRiders = MIN_RIDERS_FOR_RACE,
  windowMs = DISCORD_WELCOME_FALLBACK_WINDOW_MS,
}) {
  if (!team?.created_at) return false;
  if ((activeRiders || 0) >= minRiders) return true;
  const createdAtMs = Date.parse(team.created_at);
  if (!Number.isFinite(createdAtMs)) return false;
  return now.getTime() - createdAtMs >= windowMs;
}

export async function runDiscordWelcomeSweep({
  supabase,
  now = new Date(),
  minRiders = MIN_RIDERS_FOR_RACE,
  windowMs = DISCORD_WELCOME_FALLBACK_WINDOW_MS,
  notify = defaultNotifyUser,
  fetchCandidateTeams = defaultFetchCandidateTeams,
  fetchActiveRiderCounts = defaultFetchActiveRiderCounts,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  let teams;
  try {
    teams = await fetchCandidateTeams({ supabase });
  } catch (err) {
    if (isDiscordWelcomeSchemaPending(err)) {
      console.warn(
        "[discord-welcome] discord_welcome_sent_at findes ikke endnu (migration ikke anvendt) — springer tick over",
      );
      return { candidates: 0, sent: 0, skipped: 0, failed: 0 };
    }
    throw err;
  }
  const stats = { candidates: teams.length, sent: 0, skipped: 0, failed: 0 };
  if (!teams.length) return stats;

  const counts = await fetchActiveRiderCounts({ supabase, teamIds: teams.map((t) => t.id) });

  for (const team of teams) {
    const activeRiders = counts.get(team.id) || 0;
    if (!isDiscordWelcomeDue({ team, activeRiders, now, minRiders, windowMs })) {
      stats.skipped += 1;
      continue;
    }
    try {
      // notify() FOERST — se filens toppkommentar for hvorfor denne
      // raekkefoelge er selv-helende ved en process-crash, mens det
      // omvendte (markering foer notify) kunne tabe et hold permanent.
      const payload = buildDiscordWelcomeNotification();
      const result = await notify({ supabase, userId: team.user_id, now, ...payload });
      if (!result?.delivered && !result?.deduped) {
        stats.skipped += 1;
        continue;
      }

      stats.sent += 1;

      // Ren bogfoering herfra: notifikationen ER skrevet (leveret eller
      // deduplikeret af notifyUser). Betinget paa IS NULL saa en tick der
      // taber loebet mod en anden ikke unoedvendigt overskriver
      // markeringen — men uanset udfald her er der INGEN dobbelt besked,
      // for det er notifyUser's egen dedup der garanterer det, ikke denne
      // UPDATE.
      const { error: markError } = await supabase
        .from("teams")
        .update({ discord_welcome_sent_at: now.toISOString() })
        .eq("id", team.id)
        .is("discord_welcome_sent_at", null);
      if (markError) {
        // Notifikationen ER leveret. En fejlet markering betyder KUN at
        // holdet fejlagtigt ses som kandidat igen naeste tick —
        // notifyUser's dedup fanger det uden en ny besked, og den tick
        // markerer saa korrekt. Ikke tabt data, men skal stadig raabe
        // hoejt frem for at fejle stille.
        captureExceptionFn(
          new Error(`discord-welcome: kunne ikke markere hold ${team.id} som sendt: ${markError.message}`),
          { tags: { cron: "discord-welcome", stage: "mark-failed" }, extra: { teamId: team.id } },
        );
      }
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ discord-welcome-sweep fejlede for hold ${team.id}:`, err?.message || err);
      captureExceptionFn(err, { tags: { cron: "discord-welcome" }, extra: { teamId: team.id } });
    }
  }

  return stats;
}
