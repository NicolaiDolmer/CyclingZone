// #5130 (ejer-direktiv 10/9): sweep der sender Discord-velkomstbeskeden.
//
// TIDSPUNKT (orkestrator-valg, se PR-body #5211): naar holdet er oprettet OG
// har rundet loebs-klar-taersklen (MIN_RIDERS_FOR_RACE, samme graense som
// squadBelowMinimumCheck.js/starterSquadAllocator.js) — dvs. den foerste
// draft er gennemfoert — ELLERS senest 24t efter oprettelse uanset
// trupstoerrelse (dette sweeps naeste tick fanger den fallback, ingen
// separat route-hook noedvendig).
//
// IDEMPOTENS (dedupe paa team_id): teams.discord_welcome_sent_at (se
// database/2026-09-14-5130-discord-welcome-sent-at.sql) claimes FOER
// notifikationen sendes — en optimistisk update betinget af IS NULL, med
// .select() saa et tabt raceloeb (to sweep-tick der rammer samme hold
// samtidig) opdages og springes over i stedet for at sende to gange.
// notifyUser's egen 24t-dedup (RECENT_DUPLICATE_WINDOW_MS) er et rent
// defensivt andet lag, ligesom i directMessages.js/notificationService.js.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { notifyUser as defaultNotifyUser } from "./notificationService.js";
import { buildDiscordWelcomeNotification } from "./discordWelcomeNotification.js";
import { captureException } from "./sentry.js";

export const DISCORD_WELCOME_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

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

  const teams = await fetchCandidateTeams({ supabase });
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
      // Claim FØRST, betinget af IS NULL — .select() afslører om raekken
      // faktisk blev vores (0 raekker = en anden sweep-tick naaede foerst,
      // spring over i stedet for at risikere en dobbelt notifikation).
      const { data: claimed, error: claimError } = await supabase
        .from("teams")
        .update({ discord_welcome_sent_at: now.toISOString() })
        .eq("id", team.id)
        .is("discord_welcome_sent_at", null)
        .select("id");
      if (claimError) {
        throw new Error(`discord-welcome: could not claim team ${team.id}: ${claimError.message}`);
      }
      if (!claimed?.length) {
        stats.skipped += 1;
        continue;
      }

      // CodeRabbit-fund (denne PR): claimet SKAL kunne rulles tilbage. Fejler
      // notify() efter et vundet claim (netvaerksfejl, midlertidig Supabase-
      // udfald), skal naeste sweep-tick proeve igen — ikke se holdet som
      // "sendt" for evigt. Derfor forsoeges notify() i sin egen try, og et
      // kast der naar helt hertil frigiver claimet FOER det logges som fejlet.
      try {
        const payload = buildDiscordWelcomeNotification();
        const result = await notify({ supabase, userId: team.user_id, now, ...payload });
        if (result?.delivered || result?.deduped) stats.sent += 1;
        else stats.skipped += 1;
      } catch (notifyErr) {
        const { error: revertError } = await supabase
          .from("teams")
          .update({ discord_welcome_sent_at: null })
          .eq("id", team.id);
        if (revertError) {
          // Claimet kunne ikke rulles tilbage — holdet STAAR som sendt uden at
          // vaere det. Sjaeldent (kraever at BAADE notify OG selve rollback-
          // updaten fejler), men skal raabe hoejt frem for at fejle stille:
          // en manuel `UPDATE teams SET discord_welcome_sent_at = NULL WHERE
          // id = '<teamId>'` er reparationen.
          captureExceptionFn(
            new Error(`discord-welcome: kunne IKKE rulle claim tilbage for hold ${team.id} efter fejlet notify: ${revertError.message}`),
            { tags: { cron: "discord-welcome", stage: "claim-revert-failed" }, extra: { teamId: team.id } },
          );
        }
        throw notifyErr;
      }
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ discord-welcome-sweep fejlede for hold ${team.id}:`, err?.message || err);
      captureExceptionFn(err, { tags: { cron: "discord-welcome" }, extra: { teamId: team.id } });
    }
  }

  return stats;
}
